/// <reference types="@types/bun" />

import fs from 'node:fs/promises'
import path from 'node:path'

const rootDir = import.meta.dir
const distDir = path.join(rootDir, 'dist')

await fs.rm(distDir, { recursive: true, force: true })

async function build(options: Parameters<typeof Bun.build>[0]) {
	const result = await Bun.build(options)

	if (result.success) return

	for (const log of result.logs) console.error(log)
	process.exit(1)
}

await build({
	entrypoints: [
		path.join(rootDir, './src/index.ts'),
		path.join(rootDir, './src/vite/index.ts'),
		path.join(rootDir, './src/next/index.ts'),
	],
	format: 'esm',
	outdir: distDir,
	packages: 'external',
	sourcemap: 'external',
	target: 'node',
})

await fs.mkdir(path.join(distDir, 'next'), { recursive: true })
await fs.copyFile(
	path.join(rootDir, './src/next/cxx-loader.cjs'),
	path.join(distDir, 'next', 'cxx-loader.cjs'),
)
