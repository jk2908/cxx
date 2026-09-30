import { describe, expect, it } from 'vitest'

import { collect, DuplicateTagError, InvalidTagError, tagsToType } from '../src/build.js'

let counter = 0

/**
 * `collect` caches by id and source, not config, so each case uses a fresh id to make sure the
 * assertion on `config.typeSuffix` reflects that case rather than a cached result.
 */
function getId() {
	counter += 1
	return `/test/component-${counter}.tsx`
}

describe('collect — plain cxx template', () => {
	it('returns a template that redeclares every destructured variable', () => {
		const source = `
			const [css, styles, href] = cxx\`
				.header { color: red; }
			\`
		`

		const { template, tags } = collect(source, getId(), {})

		expect(template).toContain('const css = ')
		expect(template).toContain('const styles = ')
		expect(template).toContain('const href = ')
		expect(tags.size).toBe(0)
	})

	it('emits a stable, hashed href prefixed with cxx-', () => {
		const source = `const [css, styles, href] = cxx\`.a { color: red; }\``

		const { template } = collect(source, getId(), {})

		// pull `href` value out of template
		const match = template.match(/const href = "cxx-([A-Za-z0-9_-]{12})"/)
		expect(match).not.toBeNull()
		expect(match?.[1]).toHaveLength(12)
	})

	it('produces deterministic hrefs for identical input', () => {
		const src = `const [css, styles, href] = cxx\`.a { color: red; }\``
		const id = getId()
		const first = collect(src, id, {}).template
		const second = collect(src, id, {}).template
		expect(first).toBe(second)
	})

	it('handles partial destructuring (skip middle slot)', () => {
		const source = `const [css, , href] = cxx\`.a { color: red; }\``
		const { template } = collect(source, getId(), {})

		expect(template).toMatch(/const css = "[^"]+"/)
		expect(template).not.toContain('const styles = ')
		expect(template).toContain('const href = ')
	})

	it('reads class names out of the CSS Modules exports', () => {
		const source = `const [css, styles, href] = cxx\`
			.header { display: flex; }
			.body { padding: 1rem; }
		\``

		const { template } = collect(source, getId(), {})

		// JSON-parse the emitted styles object literal
		const stylesJson = template.match(/const styles = (\{[^]*?\})\nconst href/)![1]
		const styles = JSON.parse(stylesJson)
		expect(Object.keys(styles)).toEqual(expect.arrayContaining(['header', 'body']))
	})
})

describe('collect — cxx.tag', () => {
	it('collects the tag with the default "Classes" suffix and reports its class keys', () => {
		const source = `
			const [css, styles, href] = cxx.tag<HeroClasses>('hero')\`
				.hero { display: flex; }
				.copy { max-width: 60ch; }
			\`
		`

		const { tags } = collect(source, getId(), {})

		expect(tags.has('HeroClasses')).toBe(true)
		expect(tags.get('HeroClasses')?.toSorted()).toEqual(['copy', 'hero'])
	})

	it('respects a custom typeSuffix', () => {
		const src = `const [css, styles, href] = cxx.tag<Hero>('hero')\`.x { color: red; }\``
		expect([...collect(src, getId(), { typeSuffix: 'X' }).tags.keys()]).toEqual(['HeroX'])
	})

	it('omits the suffix when typeSuffix is false', () => {
		const src = `const [css, styles, href] = cxx.tag<Hero>('hero')\`.x { color: red; }\``
		expect([...collect(src, getId(), { typeSuffix: false }).tags.keys()]).toEqual([
			'Hero',
		])
	})

	it('pascalises kebab-case tags before appending the suffix', () => {
		const src = `const [css, styles, href] = cxx.tag<B>('marketing-banner')\`.x {} \``
		const { tags } = collect(src, getId(), {})
		expect([...tags.keys()]).toEqual(['MarketingBannerClasses'])
	})

	it('throws DuplicateTagError when the same tag is collected twice in one file', () => {
		const src = `
			const [a] = cxx.tag<A>('t')\`.x {} \`
			const [b] = cxx.tag<A>('t')\`.y {} \`
		`
		expect(() => collect(src, getId(), {})).toThrow(DuplicateTagError)
		expect(() => collect(src, getId(), {})).toThrow(/TClasses has already been seen/)
	})

	it('keeps the cache stable when called with identical source', () => {
		const src = `const [css, styles, href] = cxx.tag<X>('x')\`.x { color: red; }\``
		const id = getId()
		const first = collect(src, id, {})
		const second = collect(src, id, {})

		// second call returns the cached object; same template and tags reference
		expect(second.template).toBe(first.template)
		expect(second.tags).toBe(first.tags)
	})
})

describe('collect — emitted code safety', () => {
	it('emits CSS as a JSON string literal so escapes are not re-interpreted', () => {
		const source =
			'const [css] = cxx`.a{content:"\\f101"} .b{content:"\\e900"} .c{content:"\\2014"}`'

		const { template } = collect(source, getId(), {})

		// the old output interpolated raw CSS into a template literal, which turned
		// \f101 into a form feed, \e900 into the text e900 and \2014 into a syntax error
		expect(template).toContain('const css = "')

		// and the emitted source still evaluates to the decoded CSS
		// eslint-disable-next-line no-new-func
		const css = new Function(`${template}\nreturn css`)() as string
		expect(css).toContain('\uf101')
		expect(css).toContain('\ue900')
		expect(css).toContain('\u2014')
	})

	it('preserves the export keyword for every destructured binding', () => {
		const source = 'export const [css, styles, href] = cxx`.a{color:red}`'

		const { template } = collect(source, getId(), {})

		expect(template).toContain('export const css =')
		expect(template).toContain('export const styles =')
		expect(template).toContain('export const href =')
	})

	it('emits a source map that points back at the original file', () => {
		const id = getId()
		const source = [
			'const [css, styles, href] = cxx`',
			'  .a {',
			'    color: red;',
			'  }',
			'`',
			'',
			'console.log(css)',
		].join('\n')

		const { map } = collect(source, id, {})

		expect(map).not.toBeNull()
		expect(map?.sources).toEqual([id])
		expect(map?.sourcesContent?.[0]).toBe(source)
		expect(map?.mappings.length).toBeGreaterThan(0)
	})

	it('rejects tag names that do not form a valid identifier', () => {
		const source = `const [css] = cxx.tag<X>('a.b')\`.x { color: red; }\``

		expect(() => collect(source, getId(), {})).toThrow(InvalidTagError)
	})
})

describe('tagsToType ordering', () => {
	it('sorts tags by name so the output is stable', () => {
		const out = tagsToType(
			new Map([
				['B', ['y']],
				['A', ['x']],
			]),
		)

		expect(out.indexOf('export type A')).toBeLessThan(out.indexOf('export type B'))
	})
})

describe('tagsToType', () => {
	it('renders a "never" type for tags with no classes', () => {
		const tags = new Map([['Empty', []]])
		expect(tagsToType(tags).trim()).toBe('export type Empty = never'.trim())
	})

	it('joins class keys sorted by ascending length', () => {
		// lengths 4, 3, 1 → ascending order: 'x', 'uno', 'hero'
		const tags = new Map([['Hero', ['hero', 'uno', 'x']]])
		expect(tagsToType(tags).replace(/\s+/g, ' ').trim()).toBe(
			"export type Hero = 'x' | 'uno' | 'hero'",
		)
	})

	it('preserves insertion order for equal-length class keys', () => {
		const tags = new Map([['Hero', ['hero', 'copy']]])
		expect(tagsToType(tags).replace(/\s+/g, ' ').trim()).toBe(
			"export type Hero = 'hero' | 'copy'",
		)
	})

	it('renders a separate export per tag', () => {
		const tags = new Map([
			['A', ['x']],
			['B', ['y']],
		])
		const out = tagsToType(tags)
		expect(out).toContain('export type A')
		expect(out).toContain('export type B')
	})
})
