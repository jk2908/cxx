export type Result<ClassName extends string = string> = readonly [
	css: string,
	classes: Readonly<Record<ClassName, string>>,
	href: string,
]

export type Tags = Map<string, string[]>

export type PluginConfig = {
	typeSuffix?: string | false
	watch?: {
		/** Root used for type-regeneration watching. Defaults to the Vite root or Next Turbopack root. */
		root?: string
		/** Extra globs to ignore on top of the defaults. */
		ignore?: string[]
	}
}

export type Tag = <ClassName extends string = string>(
	name: string,
) => (_: TemplateStringsArray) => Result<ClassName>

export type Cxx = ((_: TemplateStringsArray) => Result) & {
	tag: Tag
}
