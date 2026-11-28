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
 * `key={href}` gives every stylesheet its own identity, so repeated renders
 * produce a single `<style>`, disposed once the last component using it unmounts.
 */
export function Style(props: StyleProps) {
	const { mode: _mode, href, css, ...rest } = props

	return createComponent(HeadStyle, {
		...rest,
		key: href,
		children: css,
	})
}
