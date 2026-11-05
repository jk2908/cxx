import { createElement } from 'react'

import type { StyleProps } from './types.js'

/**
 * Render an embedded style descriptor as a hoisted style element.
 */
export function Style(props: StyleProps) {
	const { mode: _mode, href, css, precedence, ...rest } = props

	return createElement(
		'style',
		{
			...rest,
			href,
			precedence,
		},
		css,
	)
}
