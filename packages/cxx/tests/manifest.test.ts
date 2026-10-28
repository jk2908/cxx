import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { collect, flushStyles, writeStylesForFile } from '../src/build.js'
import { createStyleHash } from '../src/manifest.js'
import { hashStyle } from '../src/style-hash.js'

let root: string

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'cxx-manifest-'))
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

async function source(name: string, css: string) {
	const file = path.join(root, name)
	await fs.writeFile(file, `const [css, styles, href] = cxx\`${css}\``)

	return file
}

async function write(file: string) {
	const { styles } = collect(await fs.readFile(file, 'utf-8'), file, {})
	await writeStylesForFile(file, styles, root)
	return styles
}

async function manifest() {
	await flushStyles(root)
	return JSON.parse(await fs.readFile(path.join(root, '.cxx/styles.json'), 'utf-8')) as {
		schema: number
		hashes: string[]
		styles: Record<string, { hash: string; files: string[] }>
	}
}

describe('createStyleHash', () => {
	it('returns the same base64 SHA-256 hash a CSP style-src needs', () => {
		const css = '.a{color:red}'
		const expected = `sha256-${createHash('sha256').update(css).digest('base64')}`

		expect(createStyleHash(css)).toBe(expected)
		expect(createStyleHash(Buffer.from(css))).toBe(expected)
	})

	it('uses the same digest as the href', () => {
		const { hash, href } = hashStyle('.a{color:red}')

		expect(href).toMatch(/^cxx-[A-Za-z0-9_-]{12}$/)
		expect(href.slice(4)).toBe(
			createHash('sha256').update('.a{color:red}').digest('base64url').slice(0, 12),
		)
		expect(hash).toBe(createStyleHash('.a{color:red}'))
	})
})

describe('style manifest', () => {
	it('writes every style with its source file and hash', async () => {
		const a = await source('a.tsx', '.a{color:red}')
		const b = await source('b.tsx', '.a{color:red}')
		const c = await source('c.tsx', '.b{color:blue}')

		const [aStyles, bStyles, cStyles] = await Promise.all([write(a), write(b), write(c)])

		const result = await manifest()
		const styles = [aStyles[0], bStyles[0], cStyles[0]]

		expect(result.schema).toBe(1)
		expect(result.hashes).toEqual(styles.map(style => style.hash).toSorted())
		expect(Object.keys(result.styles).toSorted()).toEqual(
			styles.map(style => style.href).toSorted(),
		)
		expect(result.styles[aStyles[0].href].files).toEqual(['a.tsx'])
		expect(result.styles[bStyles[0].href].files).toEqual(['b.tsx'])
	})

	it('dedupes repeated style hashes within a file', async () => {
		const file = path.join(root, 'repeat.tsx')
		const content = [
			'const [a] = cxx`.a{color:red}`',
			'const [b] = cxx`.a{color:red}`',
		].join('\n')

		await fs.writeFile(file, content)

		const { styles } = collect(content, file, {})
		await writeStylesForFile(file, styles, root)

		const result = await manifest()

		expect(styles).toHaveLength(2)
		expect(result.hashes).toEqual([styles[0].hash])
		expect(result.styles[styles[0].href].files).toEqual(['repeat.tsx'])
	})

	it('prunes styles when their source file is deleted', async () => {
		const a = await source('a.tsx', '.a{color:red}')
		const b = await source('b.tsx', '.b{color:blue}')

		const [aStyles, bStyles] = await Promise.all([write(a), write(b)])
		await fs.rm(a)

		const result = await manifest()

		expect(result.hashes).toEqual([bStyles[0].hash])
		expect(result.styles[aStyles[0].href]).toBe(undefined)
	})

	it('writes an empty manifest when there are no styles', async () => {
		expect(await manifest()).toEqual({ schema: 1, hashes: [], styles: {} })
	})
})
