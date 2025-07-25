import { tool, Tool, ToolsProviderController } from "@lmstudio/sdk";
import { z } from "zod";

const headers = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
};

export async function toolsProvider(ctl:ToolsProviderController):Promise<Tool[]> {
	const tools: Tool[] = [];

	const visitWebsiteTool = tool({
		name: "Visit Website",
		description: "Visit a website and return its HTML contents.",
		parameters: {
			url: z.string().url().describe("The URL of the website to visit"),
			max_links: z.number().int().min(0).max(200).optional().default(40).describe("Maximum number of links to extract from the page"),
			max_images: z.number().int().min(0).max(200).optional().default(10).describe("Maximum number of image URLs to extract from the page"),
			content_limit: z.number().int().min(0).max(10_000).optional().default(2_000).describe("Maximum content length to extract from the page"),
		},
		implementation: async ({ url, max_links, max_images, content_limit }, { status, warn, signal }) => {
			status("Visiting website...");
			try {
				// Perform the fetch request with abort signal
				const response = await fetch(url, {
					method: "GET",
					signal,
					headers,
				});
				if (!response.ok) {
					warn(`Failed to fetch website: ${response.statusText}`);
					return `Error: Failed to fetch website: ${response.statusText}`;
				}
				const html = await response.text();
				status("Website visited successfully.");
				
				const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || ""
				const bodyStart = html.match(/<body[^>]*>/)?.index || 0;
				const bodyEnd = html.lastIndexOf("</body>") || html.length - 1;
				const body = html.substring(bodyStart, bodyEnd);
				const h1 = body.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1] || "";
				const h2 = body.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1] || "";
				const h3 = body.match(/<h3[^>]*>([^<]*)<\/h3>/)?.[1] || "";
				const links = max_links && [...body.matchAll(/<a\s+[^>]*?href="([^"]+)"[^>]*>([^<]*)/g)]
					.map((match, index) => [
						match[2]?.replace(/\\[ntr]|\s/g, " ").trim(),
						match[1]?.startsWith("/")
							? new URL(match[1], url).href
							: match[1],
						index
					] as [string, string, number])
					.filter(([label, link]) => label?.length > 4 && link?.startsWith("http"))
					.sort((a, b) => b[0].length - a[0].length) // prioritize longer labels
					.slice(0, max_links) // Limit number of links
					.sort((a, b) => Number(a[2]) - Number(b[2])) // Sort by original order in the body
					.map(([label, link]) => [label, link] as [string, string]);
				const images = max_images && [...body.matchAll(/<img\s+[^>]*?src="([^"]+)/g)]
					.map(match => match[1]?.startsWith("/")
						? new URL(match[1], url).href
						: match[1]
					)
					.filter(src => src && src.startsWith('http') && src.match(/\.(svg|png|gif|jpe?g)$/i)) // Filter valid image URLs
					.slice(0, max_images); // Limit number of images

				// fetch the text content from the body using DOMParser
				const content = content_limit && body
					.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
					.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags
					.replace(/<[^>]+>/g, '') // Remove all HTML tags
					.replace(/\s+/g, ' ') // Normalize whitespace
					.trimStart()
					.slice(0, content_limit) // Limit text length
					.trimEnd();
					
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
				warn(`Error during website visit: ${error.message}`);
				return `Error: ${error.message}`;
			}
		},
	});

	tools.push(visitWebsiteTool);
	return tools;
}
