import type { ComponentPropsWithRef } from 'react'

export type StyleMode = 'embed' | 'extract'

export type EmbedStyleDescriptor = {
	mode: 'embed'
	href: string
	css: string
	precedence: string
}

export type EmbedResult<ClassName extends string = string> = {
	mode: 'embed'
	styles: Readonly<Record<ClassName, string>>
	styleProps: EmbedStyleDescriptor
}

export type ExtractResult<ClassName extends string = string> = {
	mode: 'extract'
	styles: Readonly<Record<ClassName, string>>
}

export type Result<ClassName extends string = string> =
	| EmbedResult<ClassName>
	| ExtractResult<ClassName>

type StyleElementProps = Omit<
	ComponentPropsWithRef<'style'>,
	'href' | 'precedence' | 'children'
> & {
	href: string
	precedence: string
}

export type StyleProps = EmbedStyleDescriptor & StyleElementProps

export type Tags = Map<string, string[]>

export type PluginConfig = {
	typeSuffix?: string | false
	watch?: {
		/** Root used for type-regeneration watching. Defaults to the Vite root or Next Turbopack root. */
		root?: string
	}
}

export type EmbedTag = <ClassName extends string = string>(
	name: string,
) => (_: TemplateStringsArray) => EmbedResult<ClassName>

export type ExtractTag = <ClassName extends string = string>(
	name: string,
) => (_: TemplateStringsArray) => ExtractResult<ClassName>

export type EmbedStyleTag = ((_: TemplateStringsArray) => EmbedResult) & {
	tag: EmbedTag
}

export type ExtractStyleTag = ((_: TemplateStringsArray) => ExtractResult) & {
	tag: ExtractTag
}

export type Cxx = {
	embed: EmbedStyleTag
	extract: ExtractStyleTag
}
