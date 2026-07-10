import type { LogLevel } from './logger.js'

export type Result<ClassName extends string = string> = readonly [
	css: string,
	classes: Readonly<Record<ClassName, string>>,
	href: string,
]

export type Tags = Map<string, string[]>

export type PluginConfig = {
	typeSuffix?: string | false
	logger?: {
		level?: LogLevel
	}
}

export type BuildContext = {
	tagsByFile: Map<string, Tags>
}

export type Tag = <ClassName extends string = string>(
	name: string,
) => (_: TemplateStringsArray) => Result<ClassName>

export type Cxx = ((_: TemplateStringsArray) => Result) & {
	tag: Tag
}
