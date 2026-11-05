import type { StyleProps } from './types.js'

/**
 * Render an embedded style descriptor as a hoisted style element.
 */
export function Style(props: StyleProps) {
	const { mode: _mode, href, css, precedence, ...rest } = props

	return (
		<style {...rest} href={href} precedence={precedence}>
			{css}
		</style>
	)
}
