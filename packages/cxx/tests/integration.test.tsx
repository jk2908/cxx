import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Style } from '../src/index.js'
import { collect as _collect } from '../src/transform.js'

let counter = 0

function getId() {
	counter += 1
	return `/test/integration-${counter}.tsx`
}

type Result =
	| {
			mode: 'embed'
			styles: Record<string, string>
			styleProps: { href: string; css: string; precedence: string }
	  }
	| { mode: 'extract'; styles: Record<string, string> }

function collect(source: string) {
	const { template } = _collect(source, getId(), {})
	// eslint-disable-next-line no-new-func
	return new Function(`${template}\nreturn button`)() as Result
}

describe('cxx transform + render', () => {
	it('renders an embed style from the generated descriptor', () => {
		const result = collect(`
			const button = cxx.embed\`
				.btn { color: red; padding: 0.5rem 1rem; }
			\`
		`)

		expect(result.styles.btn).toMatch(/^[A-Za-z0-9_]+_btn$/)
		expect(result.styleProps.mode).toBe('embed')

		const html = renderToString(
			<button className={result.styles.btn}>
				<Style {...result.styleProps} media="(min-width: 600px)" />
				click me
			</button>,
		)

		expect(html).toContain(result.styles.btn)
		expect(html).toContain(
			result.styleProps.mode === 'embed' ? result.styleProps.css : '',
		)
	})

	it('does not return a style component contract for extracted styles', () => {
		const result = collect(`const button = cxx.extract\`.card { background: white; }\``)

		expect(result.mode).toBe('extract')
		expect('styleProps' in result).toBe(false)
		expect(result.styles.card).toMatch(/^[A-Za-z0-9_-]+_card$/)
	})

	it('yields stable class names so renders can dedup', () => {
		const result = collect(`const button = cxx.embed\`.card { background: white; }\``)
		const html = renderToString(
			<>
				<div className={result.styles.card}>a</div>
				<div className={result.styles.card}>b</div>
			</>,
		)
		const occurrences = html.split(`class="${result.styles.card}"`).length - 1
		expect(occurrences).toBe(2)
	})

	it('exports the result object so another module can import it', async () => {
		const { template } = _collect(
			`export const button = cxx.embed\`.a { color: red; }\``,
			getId(),
			{},
		)

		const mod = (await import(
			`data:text/javascript,${encodeURIComponent(template)}`
		)) as { button: Result }

		expect(typeof mod.button.styles.a).toBe('string')
		expect(mod.button.styleProps.mode).toBe('embed')
	})
})
