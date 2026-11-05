import { describe, expect, it } from 'vitest'

import { collect, DuplicateTagError, InvalidTagError, tagsToType } from '../src/build.js'

let counter = 0

/**
 * `collect` caches by id and source, so each case uses a fresh id to make sure
 * assertions reflect that case rather than a cached result.
 */
function getId() {
	counter += 1
	return `/test/component-${counter}.tsx`
}

function evaluate<Value>(template: string, name = 'button') {
	// eslint-disable-next-line no-new-func
	return new Function(`${template}\nreturn ${name}`)() as Value
}

type Result =
	| {
			mode: 'embed'
			styles: Record<string, string>
			styleProps: {
				href: string
				css: string
				precedence: string
			}
	  }
	| { mode: 'extract'; styles: Record<string, string> }

describe('collect — embed cxx template', () => {
	it('replaces the template with styles and embed style props', () => {
		const source = `const button = cxx.embed\`
			.header { color: red; }
			.body { padding: 1rem; }
		\``

		const { template, tags } = collect(source, getId(), {})
		const result = evaluate<Result>(template)

		expect(tags.size).toBe(0)
		expect(Object.keys(result.styles)).toEqual(expect.arrayContaining(['header', 'body']))
		expect(result.styleProps.mode).toBe('embed')
		expect(result.styleProps.precedence).toBe('default')
		expect(result.styleProps.href).toMatch(/^cxx-[A-Za-z0-9_-]{12}$/)
		expect(result.styleProps.css).toContain(result.styles.header)
	})

	it('supports destructuring the result object', () => {
		const source = `const { styles, styleProps } = cxx.embed\`.card { color: red; }\``

		const { template } = collect(source, getId(), {})
		const result = evaluate<Result>(template, '{ styles, styleProps }')

		expect(result.styles.card).toMatch(/^[A-Za-z0-9_-]+_card$/)
		expect(result.styleProps.mode).toBe('embed')
	})

	it('emits a stable href for identical input', () => {
		const source = `const button = cxx.embed\`.a { color: red; }\``
		const id = getId()

		expect(collect(source, id, {}).template).toBe(collect(source, id, {}).template)
	})

	it('supports cxx.embed explicitly', () => {
		const source = `const button = cxx.embed\`.a { color: red; }\``
		const { template } = collect(source, getId(), {})
		const result = evaluate<Result>(template)

		expect(result.styleProps.mode).toBe('embed')
	})
})

describe('collect — extract cxx template', () => {
	it('emits extract styles and a stylesheet', () => {
		const source = `const button = cxx.extract\`.a { color: red; }\``
		const { template, sheets } = collect(source, getId(), {})
		const result = evaluate<Result>(template)

		expect(result.mode).toBe('extract')
		expect('styleProps' in result).toBe(false)
		expect(sheets).toHaveLength(1)
		expect(sheets[0].css).toContain(result.styles.a)
	})
})

describe('collect — cxx.embed.tag', () => {
	it('collects the tag and reports its class keys', () => {
		const source = `
			const button = cxx.embed.tag<HeroClasses>('hero')\`
				.hero { display: flex; }
				.copy { max-width: 60ch; }
			\`
		`

		const { tags } = collect(source, getId(), {})

		expect(tags.has('HeroClasses')).toBe(true)
		expect(tags.get('HeroClasses')?.toSorted()).toEqual(['copy', 'hero'])
	})

	it('supports extract tagged styles', () => {
		const source = `const button = cxx.extract.tag<HeroClasses>('hero')\`.x { color: red; }\``

		const { tags } = collect(source, getId(), {})

		expect(tags.has('HeroClasses')).toBe(true)
	})

	it('respects a custom typeSuffix', () => {
		const source = `const button = cxx.embed.tag<Hero>('hero')\`.x { color: red; }\``
		expect([...collect(source, getId(), { typeSuffix: 'X' }).tags.keys()]).toEqual([
			'HeroX',
		])
	})

	it('omits the suffix when typeSuffix is false', () => {
		const source = `const button = cxx.embed.tag<Hero>('hero')\`.x { color: red; }\``
		expect([...collect(source, getId(), { typeSuffix: false }).tags.keys()]).toEqual([
			'Hero',
		])
	})

	it('pascalises kebab-case tags before appending the suffix', () => {
		const source = `const button = cxx.embed.tag<B>('marketing-banner')\`.x {} \``
		const { tags } = collect(source, getId(), {})
		expect([...tags.keys()]).toEqual(['MarketingBannerClasses'])
	})

	it('throws DuplicateTagError when the same tag is collected twice in one file', () => {
		const source = `
			const a = cxx.embed.tag<A>('t')\`.x {} \`
			const b = cxx.embed.tag<A>('t')\`.y {} \`
		`
		expect(() => collect(source, getId(), {})).toThrow(DuplicateTagError)
		expect(() => collect(source, getId(), {})).toThrow(/TClasses has already been seen/)
	})

	it('rejects tag names that do not form a valid identifier', () => {
		const source = `const button = cxx.embed.tag<X>('a.b')\`.x { color: red; }\``

		expect(() => collect(source, getId(), {})).toThrow(InvalidTagError)
	})

	it('keeps the cache stable when called with identical source', () => {
		const source = `const button = cxx.embed.tag<X>('x')\`.x { color: red; }\``
		const id = getId()
		const first = collect(source, id, {})
		const second = collect(source, id, {})

		expect(second.template).toBe(first.template)
		expect(second.tags).toBe(first.tags)
	})
})

describe('collect — emitted code safety', () => {
	it('emits CSS as a JSON string literal so escapes are not re-interpreted', () => {
		const source =
			'const button = cxx.embed`.a{content:"\\f101"} .b{content:"\\e900"} .c{content:"\\2014"}`'

		const { template } = collect(source, getId(), {})
		const result = evaluate<Result>(template)

		expect(result.styleProps.css).toContain('\uf101')
		expect(result.styleProps.css).toContain('\ue900')
		expect(result.styleProps.css).toContain('\u2014')
	})

	it('preserves the export keyword', () => {
		const source = 'export const button = cxx.embed`.a{color:red}`'

		const { template } = collect(source, getId(), {})

		expect(template).toContain('export const button = {')
	})

	it('emits a source map that points back at the original file', () => {
		const id = getId()
		const source = [
			'const button = cxx.embed`',
			'  .a {',
			'    color: red;',
			'  }',
			'`',
			'',
			'console.log(button)',
		].join('\n')

		const { map } = collect(source, id, {})

		expect(map).not.toBeNull()
		expect(map?.sources).toEqual([id])
		expect(map?.sourcesContent?.[0]).toBe(source)
		expect(map?.mappings.length).toBeGreaterThan(0)
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
