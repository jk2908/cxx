import {
	createElement,
	type ComponentPropsWithRef,
	type ReactElement,
} from 'react'

import type { EmbedStyleDescriptor } from '../types.js'

export type StyleProps = Omit<
	ComponentPropsWithRef<'style'>,
	'href' | 'children'
> & {
	/**
	 * Hoisted stylesheet order. Defaults to `'default'`.
	 */
	precedence?: string
} & EmbedStyleDescriptor

/**
 * Render an embedded style descriptor as a hoisted style element.
 *
 * `<style href precedence>` is hoisted into the document head, deduped by
 * `href` and ordered by `precedence`, which defaults to `'default'`.
 */
export function Style(props: StyleProps): ReactElement {
	const { mode: _mode, href, css, precedence = 'default', ...rest } = props

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
