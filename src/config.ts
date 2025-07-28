import { createConfigSchematics } from "@lmstudio/sdk";

export const configSchematics = createConfigSchematics()
	.field(
		"maxLinks",
		"numeric",
		{
			displayName: "Max Links",
			min: -1,
			max: 200,
			int: true,
			subtitle: "Maximum number of links returned by the Visit Website tool (0 = Exclude links, -1 = Auto)",
		},
		-1
	)
	.field(
		"maxImages",
		"numeric",
		{
			displayName: "Max Images",
			min: -1,
			max: 200,
			int: true,
			subtitle: "Maximum number of image URLs returned by the Visit Website tool (0 = Exclude image URLs, -1 = Auto)",
		},
		-1
	)
	.field(
		"contentLimit",
		"numeric",
		{
			displayName: "Max Content",
			min: -1,
			max: 10_000,
			int: true,
			subtitle: "Maximum content size returned by the Visit Website tool (0 = Exclude content, -1 = Auto)",
		},
		-1
	)
	.build();