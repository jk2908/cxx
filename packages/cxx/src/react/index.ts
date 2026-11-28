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
	 * React orders hoisted stylesheets by precedence. Defaults to `'default'`.
	 */
	precedence?: string
} & EmbedStyleDescriptor

/**
 * Render an embedded style descriptor as a hoisted style element.
 *
 * React 19 hoists `<style href precedence>` into the document head, dedupes by
 * `href` and orders by `precedence`. `precedence` is a React concern, so the
 * transform does not emit one and this component supplies the default.
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
