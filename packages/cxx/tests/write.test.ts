import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { flushTypes, maybeWrite, writeTypesForFile } from '../src/build.js'

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

describe('writeTypesForFile', () => {
	let dir: string
	let previousCwd: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cxx-'))
		previousCwd = process.cwd()
		process.chdir(dir)
	})

	afterEach(async () => {
		process.chdir(previousCwd)
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('merges per-file partials and prunes partials for deleted sources', async () => {
		const fileA = path.join(dir, 'a.tsx')
		const fileB = path.join(dir, 'b.tsx')

		await fs.writeFile(fileA, '')
		await fs.writeFile(fileB, '')

		await writeTypesForFile(fileA, new Map([['AClasses', ['a']]]))
		await writeTypesForFile(fileB, new Map([['BClasses', ['b']]]))
		await flushTypes()

		const typeFile = path.join(dir, '.cxx', 'index.d.ts')
		const merged = await fs.readFile(typeFile, 'utf-8')

		expect(merged).toContain('export type AClasses')
		expect(merged).toContain('export type BClasses')

		// removing a source file drops its tags from the merged surface
		await fs.rm(fileA, { force: true })
		await writeTypesForFile(fileB, new Map([['BClasses', ['b']]]))
		await flushTypes()

		const pruned = await fs.readFile(typeFile, 'utf-8')

		expect(pruned).not.toContain('export type AClasses')
		expect(pruned).toContain('export type BClasses')
	})
})
