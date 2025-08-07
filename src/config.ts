import { createConfigSchematics } from "@lmstudio/sdk";

export const configSchematics = createConfigSchematics()
	.field(
		"maxLinks",
		"numeric",
		{
			displayName: "Max Links",
			min: -1,
			max: 500,
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
			max: 500,
			int: true,
			subtitle: "Maximum number of images downloaded and returned by the Visit Website tool (0 = Exclude images, -1 = Auto)",
		},
		-1
	)
	.field(
		"contentLimit",
		"numeric",
		{
			displayName: "Max Content",
			min: -1,
			max: 50_000,
			int: true,
			subtitle: "Maximum text content size returned by the Visit Website tool (0 = Exclude text content, -1 = Auto)",
		},
		-1
	)
	.build();