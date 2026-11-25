import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

const typescriptExtensions = new Set(['.ts', '.tsx', '.mts', '.cts'])

async function copyNonTsFiles(from, to) {
	for (const entry of await readdir(from, { withFileTypes: true })) {
		const source = join(from, entry.name)
		const destination = join(to, entry.name)

		if (entry.isDirectory()) {
			await copyNonTsFiles(source, destination)
			continue
		}

		if (typescriptExtensions.has(extname(entry.name))) continue

		await mkdir(to, { recursive: true })
		await copyFile(source, destination)
	}
}

await copyNonTsFiles('src', 'dist')
