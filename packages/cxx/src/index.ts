import type { Cxx, Result } from './types.js'

export type { Cxx, Result, Tag } from './types.js'

/**
 * Hit when a `cxx` template reaches runtime, which means the build transform did
 * not run. Throws so the problem is obvious instead of rendering empty styles.
 *
 * @example
 * ```ts
 * // no cxx plugin configured
 * const [css, styles, href] = cxx`.a { color: red; }`
 * // Error: cxx template was not transformed ...
 * ```
 */
function untransformed(): never {
	throw new Error(
		'cxx template was not transformed. Make sure the cxx Vite plugin or Next integration is configured and applies to this file.',
	)
}

/**
 * Build-time template tag placeholder used by the transform to emit CSS, classes and href values.
 */
export const cxx: Cxx = Object.assign(
	(_: TemplateStringsArray): Result => untransformed(),
	{
		tag:
			<ClassName extends string = string>(_: string) =>
			(_strings: TemplateStringsArray): Result<ClassName> =>
				untransformed(),
	},
)
