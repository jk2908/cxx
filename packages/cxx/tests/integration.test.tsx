import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { collect as _collect } from '../src/build.js'

let counter = 0

function getId() {
	counter += 1
	return `/test/integration-${counter}.tsx`
}

function collect(source: string) {
	const { template } = _collect(source, getId(), {})
	// eslint-disable-next-line no-new-func
	const fn = new Function(`${template}\nreturn [css, styles, href]`) as () => [
		string,
		Record<string, string>,
		string,
	]
	return fn()
}

describe('cxx transform + render', () => {
	it('produces hashed class names that a component renders with', () => {
		const [css, styles, href] = collect(`
			const [css, styles, href] = cxx\`
				.btn { color: red; padding: 0.5rem 1rem; }
			\`
		`)

		expect(css).toMatch(/\.[A-Za-z0-9_]+_btn\{color:red/)
		expect(styles.btn).toMatch(/^[A-Za-z0-9_]+_btn$/)
		expect(href).toMatch(/^cxx-[A-Za-z0-9_-]{12}$/)

		const html = renderToString(
			<button className={styles.btn}>
				<style href={href} precedence="medium">
					{css}
				</style>
				click me
			</button>,
		)
		expect(html).toContain(styles.btn)
		expect(html).toContain(css)
	})

	it('yields stable hrefs and class names so renders can dedup', () => {
		const [_css, styles, _href] = collect(
			`const [css, styles, href] = cxx\`.card { background: white; }\``,
		)
		const html = renderToString(
			<>
				<div className={styles.card}>a</div>
				<div className={styles.card}>b</div>
			</>,
		)
		const occurrences = html.split(`class="${styles.card}"`).length - 1
		expect(occurrences).toBe(2)
	})

	it('cxx.tag produces the same runtime shape as cxx', () => {
		const [css, styles, href] = collect(
			`const [css, styles, href] = cxx.tag<Test>('test')\`.x { color: blue; }\``,
		)
		expect(typeof css).toBe('string')
		expect(typeof styles).toBe('object')
		expect(typeof href).toBe('string')
		expect(href).toMatch(/^cxx-/)
	})

	it('exports every destructured binding so another module can import them', async () => {
		const { template } = _collect(
			`export const [css, styles, href] = cxx\`.a { color: red; }\``,
			getId(),
			{},
		)

		// evaluate the transformed module the same way a bundler would
		const mod = (await import(
			`data:text/javascript,${encodeURIComponent(template)}`
		)) as {
			css: string
			styles: Record<string, string>
			href: string
		}

		expect(typeof mod.css).toBe('string')
		expect(typeof mod.styles.a).toBe('string')
		expect(mod.href).toMatch(/^cxx-/)
	})
})
