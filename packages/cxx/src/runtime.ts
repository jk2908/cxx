import type {
	Cxx,
	EmbedResult,
	EmbedStyleTag,
	ExtractResult,
	ExtractStyleTag,
} from './types.js'

/**
 * A template that reaches runtime was not transformed, so fail loudly rather than render nothing.
 */
function untransformed(): never {
	throw new Error(
		'cxx template was not transformed. Make sure the cxx Vite plugin or Next integration is configured and applies to this file.',
	)
}

function tag(_: string) {
	return (_strings: TemplateStringsArray): never => untransformed()
}

const embed: EmbedStyleTag = Object.assign(
	(_: TemplateStringsArray): EmbedResult => untransformed(),
	{ tag },
)

const extract: ExtractStyleTag = Object.assign(
	(_: TemplateStringsArray): ExtractResult => untransformed(),
	{ tag },
)

export const cxx: Cxx = { embed, extract }
