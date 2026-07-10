/// <reference types="@types/bun" />

import fs from 'node:fs/promises'
import path from 'node:path'

const rootDir = import.meta.dir
const distDir = path.join(rootDir, 'dist')

await fs.rm(distDir, {
	recursive: true,
	force: true,
})

const esmResult = await Bun.build({
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

const loaderResult = await Bun.build({
	entrypoints: [path.join(rootDir, './src/next/cxx-loader.js')],
	format: 'cjs',
	naming: '[name].cjs',
	outdir: path.join(distDir, 'next'),
	packages: 'external',
	sourcemap: 'external',
	target: 'node',
})

for (const result of [esmResult, loaderResult]) {
	if (result.success) {
		continue
	}

	for (const log of result.logs) {
		console.error(log)
	}

	process.exit(1)
}
