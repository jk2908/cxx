import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Artifacts } from '../src/artifacts.js'
import { GENERATED_DIR, MANIFESTS_DIR } from '../src/config.js'
import { maybeWrite } from '../src/fs.js'
import { injectStyleImports } from '../src/transform.js'

describe('maybeWrite', () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cxx-'))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('does not rewrite content that already matches the disk', async () => {
		const file = path.join(dir, 'index.d.ts')

		await fs.writeFile(file, 'same')

		expect(await maybeWrite(file, 'same')).toBe(false)
		expect(await maybeWrite(file, 'same')).toBe(false)
	})

	it('writes when the content actually changes', async () => {
		const file = path.join(dir, 'index.d.ts')

		expect(await maybeWrite(file, 'one')).toBe(true)
		expect(await maybeWrite(file, 'two')).toBe(true)
		expect(await fs.readFile(file, 'utf-8')).toBe('two')
	})
})

describe('artifact manifests', () => {
	let dir: string
	let artifacts: Artifacts

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cxx-'))
		artifacts = new Artifacts(dir)
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('merges per-file manifests and prunes deleted sources', async () => {
		const fileA = path.join(dir, 'a.tsx')
		const fileB = path.join(dir, 'b.tsx')

		await fs.writeFile(fileA, "const a = cxx.embed.tag<AClasses>('a')`.a{}`")
		await fs.writeFile(fileB, "const b = cxx.embed.tag<BClasses>('b')`.b{}`")

		await artifacts.update(fileA, {})
		await artifacts.update(fileB, {})
		await artifacts.flush()

		const typeFile = path.join(dir, GENERATED_DIR, 'index.d.ts')
		const merged = await fs.readFile(typeFile, 'utf-8')

		expect(merged).toContain('export type AClasses')
		expect(merged).toContain('export type BClasses')
		expect(merged).toContain('export interface TagMap')
		expect(merged).toContain('"a": AClasses')
		expect(merged).toContain('"b": BClasses')

		// removing a source file drops its tags from the merged surface
		await fs.rm(fileA, { force: true })
		await artifacts.update(fileA, {})
		await artifacts.flush()

		const pruned = await fs.readFile(typeFile, 'utf-8')

		expect(pruned).not.toContain('export type AClasses')
		expect(pruned).toContain('export type BClasses')
	})

	it('sweeps orphaned temp files when seeding', async () => {
		const tmpInRoot = path.join(dir, GENERATED_DIR, 'index.d.ts.tmp')
		const tmpInManifests = path.join(dir, GENERATED_DIR, MANIFESTS_DIR, 'abc.tmp')

		await fs.mkdir(path.join(dir, GENERATED_DIR, MANIFESTS_DIR), {
			recursive: true,
		})
		await fs.writeFile(tmpInRoot, 'x')
		await fs.writeFile(tmpInManifests, 'x')

		await artifacts.seed(dir, {})

		await expect(fs.access(tmpInRoot)).rejects.toThrow()
		await expect(fs.access(tmpInManifests)).rejects.toThrow()
	})

	it('drops the manifest for a file that no longer uses cxx', async () => {
		const file = path.join(dir, 'a.tsx')
		const typeFile = path.join(dir, GENERATED_DIR, 'index.d.ts')

		await fs.writeFile(file, "const a = cxx.embed.tag<AClasses>('a')`.a{}`")
		await artifacts.update(file, {})
		await artifacts.flush()

		expect(await fs.readFile(typeFile, 'utf-8')).toContain('AClasses')

		// the source no longer uses cxx
		await fs.writeFile(file, 'const a = 1')
		await artifacts.update(file, {})
		await artifacts.flush()

		const after = await fs.readFile(typeFile, 'utf-8').catch(() => '')
		expect(after).not.toContain('AClasses')
	})

	it('keeps unrelated tags and reports the files when a tag is duplicated', async () => {
		const fileA = path.join(dir, 'a.tsx')
		const fileB = path.join(dir, 'b.tsx')
		const fileC = path.join(dir, 'c.tsx')

		await Promise.all([
			fs.writeFile(fileA, "const a = cxx.embed.tag<A>('dup')`.a{}`"),
			fs.writeFile(fileB, "const b = cxx.embed.tag<B>('dup')`.b{}`"),
			fs.writeFile(fileC, "const c = cxx.embed.tag<C>('solo')`.c{}`"),
		])

		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

		try {
			await artifacts.update(fileA, {})
			await artifacts.update(fileB, {})
			await artifacts.update(fileC, {})
			await artifacts.flush()

			const merged = await fs.readFile(
				path.join(dir, GENERATED_DIR, 'index.d.ts'),
				'utf-8',
			)

			expect(merged).toContain('export type SoloClasses')
			expect(merged).toContain('export type DupClasses')

			const logged = spy.mock.calls.flat().join(' ')
			expect(logged).toContain('DupClasses')
			expect(logged).toContain('a.tsx')
			expect(logged).toContain('b.tsx')
		} finally {
			spy.mockRestore()
		}
	})
})

describe('style sheet generation', () => {
	it('writes sheets and injects imports after a module directive', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cxx-styles-'))
		const file = path.join(dir, 'component.tsx')
		const artifacts = new Artifacts(dir)

		await fs.writeFile(file, 'const a = cxx.extract`.a{}`')

		const imports = artifacts.write(file, new Map(), [{ hash: 'abc', css: '.a{}' }])

		const sheet = `./${GENERATED_DIR}/abc.css`

		expect(imports).toEqual([sheet])
		expect(await fs.readFile(path.join(dir, sheet), 'utf-8')).toBe('.a{}')
		expect(injectStyleImports("'use client'\nconst a = 1", imports)).toBe(
			`'use client'\nimport "${sheet}";\n\nconst a = 1`,
		)
	})

	it('inserts imports after framework and compiler directives', () => {
		const imports = ['./.cxx/a.css']
		const directives = [
			"'use client'",
			"'use server'",
			"'use cache'",
			"'use cache: private'",
			"'use memo'",
			"'use no memo'",
			"'use strict'",
		]

		for (const directive of directives) {
			expect(injectStyleImports(`${directive}\nconst a = 1`, imports)).toBe(
				`${directive}\nimport "./.cxx/a.css";\n\nconst a = 1`,
			)
		}

		expect(injectStyleImports("'use client'\n'use memo'\nconst a = 1", imports)).toBe(
			"'use client'\n'use memo'\nimport \"./.cxx/a.css\";\n\nconst a = 1",
		)
	})

	it('removes sheets that no source file references any more', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cxx-styles-'))
		const fileA = path.join(dir, 'a.tsx')
		const fileB = path.join(dir, 'b.tsx')
		const sheetsDir = path.join(dir, GENERATED_DIR)
		const artifacts = new Artifacts(dir)

		try {
			await fs.writeFile(fileA, 'const a = cxx.extract`.a{}`')
			await fs.writeFile(fileB, 'const b = cxx.extract`.b{}`')

			artifacts.write(fileA, new Map(), [
				{ hash: 'a', css: '.a{}' },
				{ hash: 'stale', css: '.stale{}' },
			])
			artifacts.write(fileB, new Map(), [{ hash: 'b', css: '.b{}' }])
			await artifacts.flush()

			// a no longer references "stale", so it must go while its other sheet stays
			artifacts.write(fileA, new Map(), [{ hash: 'a', css: '.a{}' }])
			await artifacts.flush({ sweep: true })

			await expect(fs.access(path.join(sheetsDir, 'a.css'))).resolves.toBeUndefined()
			await expect(fs.access(path.join(sheetsDir, 'b.css'))).resolves.toBeUndefined()
			await expect(fs.access(path.join(sheetsDir, 'stale.css'))).rejects.toThrow()

			// b stops using cxx, so only a's sheet should remain
			await fs.writeFile(fileB, 'const b = 1')
			await artifacts.update(fileB, {})
			await artifacts.flush({ sweep: true })

			await expect(fs.access(path.join(sheetsDir, 'a.css'))).resolves.toBeUndefined()
			await expect(fs.access(path.join(sheetsDir, 'b.css'))).rejects.toThrow()

			// a source deleted outside the watcher is dropped by the flush, then swept
			await fs.rm(fileA, { force: true })
			await artifacts.flush({ sweep: true })

			await expect(fs.access(path.join(sheetsDir, 'a.css'))).rejects.toThrow()
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})
})
