import { tool, Tool, ToolsProviderController } from "@lmstudio/sdk";
import { writeFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { configSchematics } from "./config";

export async function toolsProvider(ctl:ToolsProviderController):Promise<Tool[]> {
	const tools: Tool[] = [];

	const fetchHTML = async (url:string, signal:AbortSignal, warn:(msg:string) => void) => {
		// Perform the fetch request with abort signal
		const headers = spoofHeaders(url);
		const response = await fetch(url, {
			method: "GET",
			signal,
			headers,
		});
		if (!response.ok) {
			warn(`Failed to fetch website: ${response.statusText}`);
			throw new Error(`Failed to fetch website: ${response.statusText}`);
		}
		const html = await response.text();
		const headStart = html.indexOf("<head>");
		const headEnd = html.indexOf("</head>") + 7;
		const head = html.substring(headStart, headEnd);
		const bodyStart = html.match(/<body[^>]*>/)?.index || 0;
		const bodyEnd = html.lastIndexOf("</body>") || html.length - 1;
		const body = html.substring(bodyStart, bodyEnd);
		return { html, head, body };
	}

	const extractLinks = (body:string, url:string, maxLinks:number, searchTerms?:string[]) =>
		[...body.matchAll(/<a\s+[^>]*?href="([^"]+)"[^>]*>((?:\n|.)*?)<\/a>/g)]
			.map((match, index) => ({
				index,
				label: match[2]?.replace(/\\[ntr]|\s|<(?:[^>"]|"[^"]*")+>/g, " ").trim() || "",
				link: match[1]?.startsWith("/")
					? new URL(match[1], url).href
					: match[1],
			}))
			.filter(({ link }) => link?.startsWith("http"))
			.map((x, index, { length }) => {
				// Prioritize links fitting the search terms
				// Followed by short navigation links and content links with long labels
				// Fewer digits = more likely a navigation link than a content link
				const ratio = 1 / Math.min(1, /\d/g.exec(x.link)?.length || 1);
				const score
					= ratio * (100 - (x.label.length + x.link.length + (20 * index / length)))
					+ (1 - ratio) * x.label.split(/\s+/).length;
				return {
					...x,
					score: searchTerms?.length
						&& searchTerms.reduce((acc, term) => acc + (x.label.toLowerCase().includes(term.toLowerCase()) ? 1000 : 0), score)
						|| score,
				};
			})
			.sort((a, b) => b.score - a.score) // Sort by score in descending order
			.filter((x, i, arr) =>
				// Filter out duplicates based on link, keeping the first occurrence
				!arr.find((y, j) => j < i && y.link === x.link)
			)
			.slice(0, maxLinks) // Limit number of links
			// .sort((a, b) => a.index - b.index) // Sort by original order in the body
			.map(({ label, link }) => [label, link] as [string, string]);

	const extractImages = (body:string, url:string, maxImages:number, searchTerms?:string[]) =>
		[...body.matchAll(/<img(\s+[^>]*)/g)]
			.filter(x => x[1])
			.map(([, attributes], index) => {
				const alt = attributes.match(/\salt="([^"]+)"/)?.[1] || "";
				const src = attributes.match(/\ssrc="([^"]+)"/)?.[1];
				return {
					index,
					alt,
					src: src?.startsWith("/")
						? new URL(src, url).href
						: src,
					score: searchTerms?.length
						&& searchTerms.reduce((acc, term) => acc + (alt.toLowerCase().includes(term.toLowerCase()) ? 1000 : 0), alt.length)
						|| alt.length,
				};
			})
			.filter(({ src }) => src && src.startsWith('http') && src.match(/\.(svg|png|webp|gif|jpe?g)(\?.*)?$/i)) // Filter valid image URLs
			.sort((a, b) => b.score - a.score) // Sort by score in descending order
			.slice(0, maxImages) // Limit number of images
			.sort((a, b) => a.index - b.index) // Sort by original order in the body
			.map(({ src, alt }) => [alt, src] as [string, string]);

	const viewImagesTool = tool({
		name: "View Images",
		description: "Download images from a website or a list of image URLs to make them viewable.",
		parameters: {
			imageURLs: z.array(z.string().url()).optional().describe("List of image URLs to view that were not obtained via the Visit Website tool."),
			websiteURL: z.string().url().optional().describe("The URL of the website, whose images to view."),
			maxImages: z.number().int().min(1).max(200).optional().describe("Maximum number of images to view when websiteURL is provided."),
		},
		implementation: async ({ imageURLs, websiteURL, maxImages }, { status, warn, signal }) => {
			try {

				maxImages = undefinedIfAuto(ctl.getPluginConfig(configSchematics).get("maxImages"), -1)
					?? maxImages
					?? 10;

				const imageURLsToDownload = imageURLs || [];

				if(websiteURL) {
					status("Fetching image URLs from website...");
					const { body } = await fetchHTML(websiteURL, signal, warn);
					const images = extractImages(body, websiteURL, maxImages).map(x => x[1]);
					imageURLsToDownload.push(...images);
				}

				status("Downloading images...");
				const workingDirectory = ctl.getWorkingDirectory();
				const timestamp = Date.now();
				const downloadPromises = imageURLsToDownload.map(async (url:string, i:number) => {
					if(url.startsWith(workingDirectory))
						return url; // Skip if the URL is already a local file path
					
					const index = i + 1;
					try {
						const headers = spoofHeaders(url);
						const imageResponse = await fetch(url, {
							method: "GET",
							signal,
							headers,
						});
						if (!imageResponse.ok) {
							warn(`Failed to fetch image ${index}: ${imageResponse.statusText}`);
							return null; // Skip this image if download fails
						}
						const bytes = await imageResponse.bytes();
						if (bytes.length === 0) {
							warn(`Image ${index} is empty: ${url}`);
							return null; // Skip empty images
						}
						// save the image to a file in the working directory
						const fileExtension = /image\/([\w]+)/.exec(imageResponse.headers.get('content-type') || '')?.[1]
							|| /\.([\w]+)(?:\?.*)$/.exec(url)?.[1] // Extract extension from URL if content type is not available
							|| 'jpg'; // Default to jpg if no content type
						const fileName = `${timestamp}-${index}.${fileExtension}`;
						const filePath = join(workingDirectory, fileName);
						const localPath = filePath.replace(/\\/g, '/').replace(/^C:/, '') // Normalize path for web compatibility
						await writeFile(filePath, bytes, 'binary');
						return localPath;
					} catch (error: any) {
						if (error instanceof DOMException && error.name === "AbortError")
							return null; // Skip if download was aborted
						warn(`Error fetching image ${index}: ${error.message}`);
						return null; // Skip this image on error
					}
				});
				const downloadedImageMarkdowns = (await Promise.all(downloadPromises))
					.map((x, i) => x
						?
						`![Image ${i + 1}](${x})`
						: 'Error fetching image from URL: ' + imageURLsToDownload[i]
					);
				if (downloadedImageMarkdowns.length === 0) {
					warn('Error fetching images');
					return imageURLsToDownload;
				}

				status(`Downloaded ${downloadedImageMarkdowns.length} images successfully.`);

				return downloadedImageMarkdowns;
			} catch (error: any) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return "Image download aborted by user.";
				}
				console.error(error);
				warn(`Error during image download: ${error.message}`);
				return `Error: ${error.message}`;
			}
		}
	});

	const visitWebsiteTool = tool({
		name: "Visit Website",
		description: "Visit a website and return its title, headings, links, images, and text content. Images are automatically downloaded and viewable.",
		parameters: {
			url: z.string().url().describe("The URL of the website to visit"),
			findInPage: z.array(z.string()).optional().describe("Highly recommended! Optional search terms to prioritize which links, images, and content to return."),
			maxLinks: z.number().int().min(0).max(200).optional().describe("Maximum number of links to extract from the page."),
			maxImages: z.number().int().min(0).max(200).optional().describe("Maximum number of images to extract from the page."),
			contentLimit: z.number().int().min(0).max(10_000).optional().describe("Maximum text content length to extract from the page."),
		},
		implementation: async ({ url, maxLinks, maxImages, contentLimit, findInPage: searchTerms }, context) => {
			const { status, warn, signal } = context;
			status("Visiting website...");

			try {
				maxLinks = undefinedIfAuto(ctl.getPluginConfig(configSchematics).get("maxLinks"), -1)
					?? maxLinks
					?? 40;
				maxImages = undefinedIfAuto(ctl.getPluginConfig(configSchematics).get("maxImages"), -1)
					?? maxImages
					?? 10;
				contentLimit = undefinedIfAuto(ctl.getPluginConfig(configSchematics).get("contentLimit"), -1)
					?? contentLimit
					?? 2000;

				const { head, body } = await fetchHTML(url, signal, warn);
				status("Website visited successfully.");
				
				const title = head.match(/<title>([^<]*)<\/title>/)?.[1] || ""
				const h1 = body.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] || "";
				const h2 = body.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1] || "";
				const h3 = body.match(/<h3[^>]*>([^<]*)<\/h3>/)?.[1] || "";
				const links = maxLinks && extractLinks(body, url, maxLinks, searchTerms);
				const imagesToFetch = maxImages ? extractImages(body, url, maxImages, searchTerms) : [];
				const images = maxImages &&
					(await viewImagesTool.implementation({ imageURLs: imagesToFetch.map(x => x[1]) }, context) as string[])
					.map((markdown, index) => [imagesToFetch[index][0], markdown] as [string, string]);

				// fetch the text content from the body using DOMParser
				const allContent = contentLimit && body
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags
					.replace(/<[^>]+>/g, '') // Remove all HTML tags
					.replace(/\s+/g, ' ') // Normalize whitespace
					.trim() || '';
				
				let content = "";
				if(searchTerms?.length && contentLimit < allContent.length) {
					const padding = `.{0,${contentLimit / (searchTerms.length * 2)}}`;
					const matches = searchTerms
						.map(term => new RegExp(padding + term + padding, 'gi').exec(allContent))
						.filter(match => !!match)
						.sort((a, b) => a.index - b.index); // Sort by index in the content
					let nextMinIndex = 0;
					for(const match of matches) {
						// Ensure we don't return duplicates by merging overlapping matches
						content += match.index >= nextMinIndex
							// The Match does not overlap with the previous one
							? match[0]
							// The match overlaps so we just extend the content to include it
							: match[0].slice(nextMinIndex - match.index);
						nextMinIndex = match.index + match[0].length;
					}
				}
				else content = allContent.slice(0, contentLimit) // Limit text length
					
				return {
					url, title, h1, h2, h3,
					...(links ? { links } : {}),
					...(images ? { images } : {}),
					...(content ? { content } : {}),
				};
			} catch (error: any) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return "Website visit aborted by user.";
				}
				console.error(error);
				warn(`Error during website visit: ${error.message}`);
				return `Error: ${error.message}`;
			}
		},
	});


	tools.push(visitWebsiteTool);
	tools.push(viewImagesTool);
	return tools;
}

const undefinedIfAuto = (value: unknown, autoValue: unknown) =>
	value === autoValue ? undefined : value as undefined;

const spoofedUserAgents = [
	// Random spoofed realistic user agents for DuckDuckGo
	"Mozilla/5.0 (Linux; Android 10; SM-M515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Mobile Safari/537.36",
	"Mozilla/5.0 (Linux; Android 6.0; E5533) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.101 Mobile Safari/537.36",
	"Mozilla/5.0 (Linux; Android 8.1.0; AX1082) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.83 Mobile Safari/537.36",
	"Mozilla/5.0 (Linux; Android 8.1.0; TM-MID1020A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.96 Safari/537.36",
	"Mozilla/5.0 (Linux; Android 9; POT-LX1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.80 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:97.0) Gecko/20100101 Firefox/97.0",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36 Edg/97.0.1072.71",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.80 Safari/537.36 Edg/98.0.1108.62",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.80 Safari/537.36",
	"Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36",
	"Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:97.0) Gecko/20100101 Firefox/97.0",
	"Opera/9.80 (Android 7.0; Opera Mini/36.2.2254/119.132; U; id) Presto/2.12.423 Version/12.16",
]

function spoofHeaders(url:string) {
	const domain = new URL(url).hostname;
	return {
		'User-Agent': spoofedUserAgents[Math.floor(Math.random() * spoofedUserAgents.length)],
		'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Accept-Encoding': 'gzip, deflate, br',
		'Referer': 'https://' + domain + '/',
		'Origin': 'https://' + domain,
		'Connection': 'keep-alive',
		'Upgrade-Insecure-Requests': '1',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Cache-Control': 'max-age=0',
	};
}