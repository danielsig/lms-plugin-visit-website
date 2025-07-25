import { createConfigSchematics } from "@lmstudio/sdk";

export const configSchematics = createConfigSchematics()
	.field(
		"max_links",
		"numeric",
		{
			displayName: "Max Links",
			min: 0,
			max: 200,
			subtitle: "Maximum number of links returned by the Visit Website tool",
		},
		40
)
	.field(
		"max_images",
		"numeric",
		{
			displayName: "Max Images",
			min: 0,
			max: 200,
			subtitle: "Maximum number of image URLs returned by the Visit Website tool",
		},
		10
	)
	.field(
		"content_limit",
		"numeric",
		{
			displayName: "Max Content",
			min: 0,
			max: 10_000,
			subtitle: "Maximum content size returned by the Visit Website tool",
		},
		2000
	)
	.build();