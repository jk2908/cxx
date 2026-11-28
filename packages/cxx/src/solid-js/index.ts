import { Style as HeadStyle } from '@solidjs/meta'
import { createComponent } from 'solid-js'
import type { JSX } from '@solidjs/web'

import type { EmbedStyleDescriptor } from '../types.js'

export type StyleProps = Omit<
	JSX.StyleHTMLAttributes<HTMLStyleElement>,
	'href' | 'children'
> &
	EmbedStyleDescriptor

/**
 * Render an embedded style descriptor into the document head.
 *
 * Solid's head registry keeps one tag per identity, so `key={href}` gives every
 * stylesheet its own identity: repeated renders produce a single `<style>`, and
 * it is disposed once the last component using it unmounts.
 *
 * There is no `precedence` on Solid — that is React's ordering hint, and it is
 * absent from the descriptor entirely. `href` is consumed as the key and never
 * reaches the DOM.
 */
export function Style(props: StyleProps) {
	const { mode: _mode, href, css, ...rest } = props

	return createComponent(HeadStyle, {
		...rest,
		key: href,
		children: css,
	})
}
