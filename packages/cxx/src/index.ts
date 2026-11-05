import type {
	Cxx,
	EmbedResult,
	EmbedStyleTag,
	ExtractResult,
	ExtractStyleTag,
} from './types.js'

export { Style } from './style.js'
export type {
	Cxx,
	EmbedResult,
	EmbedStyleDescriptor,
	EmbedStyleTag,
	ExtractResult,
	ExtractStyleTag,
	Result,
	StyleMode,
	StyleProps,
} from './types.js'

/**
 * Hit when a `cxx` template reaches runtime, which means the build transform did
 * not run. Throws so the problem is obvious instead of rendering empty styles.
 *
 * @example
 * ```ts
 * // no cxx plugin configured
 * const button = cxx.embed`.a { color: red; }`
 * // error: cxx template was not transformed ...
 * ```
 */
function untransformed(): never {
	throw new Error(
		'cxx template was not transformed. Make sure the cxx Vite plugin or Next integration is configured and applies to this file.',
	)
}

function tag<_ClassName extends string = string>(_: string) {
	return (_strings: TemplateStringsArray): never => untransformed()
}

function embedTag(): EmbedStyleTag {
	return Object.assign((_: TemplateStringsArray): EmbedResult => untransformed(), { tag })
}

function extractTag(): ExtractStyleTag {
	return Object.assign((_: TemplateStringsArray): ExtractResult => untransformed(), {
		tag,
	})
}

const embed = embedTag()
const extract = extractTag()

/**
 * Build-time template tag namespace used by the transform to emit class maps
 * and style descriptors.
 */
export const cxx: Cxx = { embed, extract }
