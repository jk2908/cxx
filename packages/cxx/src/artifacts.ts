import type { Dirent } from 'node:fs'

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginConfig, Tags } from './types.js'
import {
	AUTOGEN_MSG,
	GENERATED_DIR,
	MANIFESTS_DIR,
	NAME,
	PKG_NAME,
	SKIP_DIRS,
	SOURCE_EXTENSIONS,
} from './config.js'
import { isEEXIST, isENOENT, maybeWrite, readdirOrEmpty, writeFileAtomic } from './fs.js'
import { Logger } from './logger.js'
import { collect, type StyleSheet } from './transform.js'
import { runWithConcurrency } from './utils.js'

const logger = new Logger(NAME)

/**
 * What one source file generated: the class keys behind each exported tag type, and the hashes of
 * the sheets it owns.
 */
type FileManifest = {
	file: string
	tags: Record<string, string[]>
	names: Record<string, string>
	sheets: string[]
}

/**
 * A generated tag type that more than one file defines.
 */
type DuplicateTag = {
	tag: string
	files: string[]
}

// wait this long after the last write before regenerating outputs
const FLUSH_WAIT = 100

/**
 * The path to a generated sheet, relative to the importing source file.
 */
function importPath(fromFile: string, toFile: string) {
	const relative = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/')

	return relative.startsWith('../') ? relative : `./${relative}`
}

/**
 * Generated output for one project root.
 *
 * `write()` and `update()` save per-file manifests. `flush()` reads those manifests, merges them
 * into `index.d.ts`, and, when asked, removes sheets no manifest references.
 */
export class Artifacts {
	readonly root: string

	readonly #generatedDir: string
	readonly #manifestsDir: string

	// pending debounced flush
	#timer: ReturnType<typeof setTimeout> | null = null
	// serialises flushes so they never overlap
	#queue: Promise<void> = Promise.resolve()

	/**
	 * Create the artifact state for a project. `root` is the directory `.cxx` is written under.
	 */
	constructor(root: string) {
		this.root = path.resolve(root)
		this.#generatedDir = path.join(this.root, GENERATED_DIR)
		this.#manifestsDir = path.join(this.#generatedDir, MANIFESTS_DIR)
	}

	/**
	 * Save a file's manifest and write any extracted sheets, returning the paths to import them.
	 * The manifest is written first so a sweep can't delete a sheet it hasn't seen referenced.
	 */
	write(
		filePath: string,
		tags: Tags,
		sheets: StyleSheet[],
		tagNames: Map<string, string> = new Map(),
	) {
		this.#writeManifest(filePath, tags, sheets, tagNames)

		if (!sheets.length) return []

		mkdirSync(this.#generatedDir, { recursive: true })

		return sheets.map(sheet => {
			const file = path.join(this.#generatedDir, `${sheet.hash}.css`)

			// `wx` creates the file only if absent. The name is the content hash, so an existing sheet
			// already has the right content
			try {
				writeFileSync(file, sheet.css, { flag: 'wx' })
			} catch (err) {
				if (!isEEXIST(err)) throw err
			}

			return importPath(filePath, file)
		})
	}

	/**
	 * Re-read a source file and update its manifest. A deleted or cxx-free file loses its manifest,
	 * so its types disappear on the next flush.
	 */
	async update(filePath: string, config: PluginConfig) {
		let source: string

		try {
			source = await fs.readFile(filePath, 'utf-8')
		} catch (err) {
			if (!isENOENT(err)) throw err
			this.#removeManifest(filePath)
			return
		}

		// the file no longer uses cxx, so drop its generated types
		if (!source.includes(NAME)) {
			this.#removeManifest(filePath)
			return
		}

		const { tags, tagNames, sheets } = collect(source, filePath, config)
		this.#writeManifest(filePath, tags, sheets, tagNames)
	}

	/**
	 * Read every source under `scanRoot` and rebuild the outputs. Used at startup so types exist
	 * before the first transform.
	 */
	async seed(scanRoot: string, config: PluginConfig) {
		await this.#scan(scanRoot, config)
		await this.flush({ sweep: true })
	}

	/**
	 * Rebuild `index.d.ts` from the manifests. With `sweep`, also delete unused sheets and leftover
	 * temp files.
	 */
	flush(options: { sweep?: boolean } = {}) {
		if (this.#timer) {
			clearTimeout(this.#timer)
			this.#timer = null
		}

		const run = this.#queue.then(() => this.#generate({ sweep: options.sweep ?? false }))
		this.#queue = run.catch(() => {})

		return run
	}

	/**
	 * Walk `dir` and update a manifest for every source file. Skips hidden, dependency, and build
	 * folders.
	 */
	async #scan(dir: string, config: PluginConfig) {
		let entries: Dirent[]

		try {
			entries = await fs.readdir(dir, { withFileTypes: true })
		} catch {
			return
		}

		await runWithConcurrency(entries, 8, async entry => {
			if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return

			const full = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				await this.#scan(full, config)
				return
			}

			if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return

			await this.update(full, config)
		})
	}

	/**
	 * The path to a source file's manifest, named by a hash of its absolute path. Hashing keeps the
	 * name safe and stable; the manifest itself stores the real path.
	 */
	#getManifestPath(filePath: string) {
		const id = createHash('sha1').update(path.resolve(filePath)).digest('hex')

		return path.join(this.#manifestsDir, `${id}.json`)
	}

	/**
	 * Write a file's manifest, or delete it if the file generated nothing. Skips the write when the
	 * manifest is unchanged.
	 */
	#writeManifest(
		filePath: string,
		tags: Tags,
		sheets: StyleSheet[],
		tagNames: Map<string, string>,
	) {
		if (!tags.size && !sheets.length) {
			this.#removeManifest(filePath)
			return
		}

		const manifestPath = this.#getManifestPath(filePath)
		const content = JSON.stringify({
			file: path.resolve(filePath),
			tags: Object.fromEntries(tags),
			names: Object.fromEntries(tagNames),
			sheets: sheets.map(sheet => sheet.hash),
		} satisfies FileManifest)

		// an unchanged manifest means the tag surface and sheets are untouched, so skip the flush
		try {
			if (readFileSync(manifestPath, 'utf-8') === content) return
		} catch (err) {
			if (!isENOENT(err)) throw err
		}

		mkdirSync(this.#manifestsDir, { recursive: true })
		writeFileAtomic(manifestPath, content)

		this.#schedule()
	}

	/**
	 * Delete a file's manifest and schedule a rebuild. Does nothing if it was already absent.
	 */
	#removeManifest(filePath: string) {
		try {
			rmSync(this.#getManifestPath(filePath))
		} catch (err) {
			if (!isENOENT(err)) throw err
			return
		}

		this.#schedule()
	}

	/**
	 * Queue a rebuild after a short delay, so a burst of writes rebuilds once. The timer does not
	 * keep the process alive.
	 */
	#schedule() {
		if (this.#timer) clearTimeout(this.#timer)

		this.#timer = setTimeout(() => {
			this.#timer = null

			void this.flush().catch(err => {
				logger.error('failed to regenerate cxx outputs', err)
			})
		}, FLUSH_WAIT)

		this.#timer.unref?.()
	}

	/**
	 * Read all manifests, drop stale ones, and write `index.d.ts`. With `sweep`, also remove unused
	 * sheets and temp files.
	 */
	async #generate(options: { sweep: boolean }) {
		const { sweep } = options
		const manifests = await this.#readManifests()
		const tags: Tags = new Map()
		const tagNames = new Map<string, string>()
		const fileByTag = new Map<string, string>()
		const duplicates: DuplicateTag[] = []
		const referenced = new Set<string>()

		for (const manifest of manifests) {
			const source = await fs.readFile(manifest.file, 'utf-8').catch(() => null)

			// clean up
			if (!source?.includes(NAME)) {
				await fs.rm(this.#getManifestPath(manifest.file), { force: true })
				continue
			}

			for (const [name, classes] of Object.entries(manifest.tags)) {
				const existing = fileByTag.get(name)

				if (existing) {
					duplicates.push({ tag: name, files: [existing, manifest.file] })
					continue
				}

				fileByTag.set(name, manifest.file)
				tags.set(name, classes)
			}

			for (const [name, type] of Object.entries(manifest.names ?? {})) {
				if (!tagNames.has(name)) tagNames.set(name, type)
			}

			if (sweep) {
				for (const hash of manifest.sheets) referenced.add(hash)
			}
		}

		const typeFile = path.join(this.#generatedDir, 'index.d.ts')

		if (!tags.size) {
			await fs.rm(typeFile, { force: true })
		} else {
			await fs.mkdir(this.#generatedDir, { recursive: true })
			await maybeWrite(typeFile, renderTypes(tags, tagNames))
		}

		for (const duplicate of duplicates) {
			logger.error(
				`Tag "${duplicate.tag}" is defined in multiple files: ${duplicate.files.join(', ')}`,
			)
		}

		if (sweep) await this.#cleanup(referenced)
	}

	/**
	 * Remove temp files left by interrupted writes and sheets that no manifest references. Runs
	 * only during a sweeping flush.
	 */
	async #cleanup(referenced: Set<string>) {
		const generated = await readdirOrEmpty(this.#generatedDir)

		for (const entry of generated) {
			if (entry.endsWith('.tmp')) {
				await fs.rm(path.join(this.#generatedDir, entry), { force: true })
				continue
			}

			if (!entry.endsWith('.css')) continue
			if (referenced.has(path.basename(entry, '.css'))) continue

			await fs.rm(path.join(this.#generatedDir, entry), { force: true })
		}

		for (const entry of await readdirOrEmpty(this.#manifestsDir)) {
			if (entry.endsWith('.tmp')) {
				await fs.rm(path.join(this.#manifestsDir, entry), { force: true })
			}
		}
	}

	/**
	 * Read every manifest. Files that cannot be parsed are deleted and skipped.
	 */
	async #readManifests() {
		const entries = await readdirOrEmpty(this.#manifestsDir)
		const manifests: FileManifest[] = []

		await runWithConcurrency(entries, 8, async entry => {
			if (!entry.endsWith('.json')) return

			const file = path.join(this.#manifestsDir, entry)

			try {
				const raw = await fs.readFile(file, 'utf-8')
				manifests.push(JSON.parse(raw) as FileManifest)
			} catch {
				// a corrupt manifest cannot describe anything, so drop it
				await fs.rm(file, { force: true })
			}
		})

		return manifests
	}
}

/**
 * Render the generated declaration file contents for a set of collected tags.
 */
function renderTypes(tags: Tags, tagNames: Map<string, string>) {
	const body = [tagsToType(tags), tagNamesToType(tagNames)].filter(Boolean).join('\n')

	return `${AUTOGEN_MSG}

import '${PKG_NAME}'

declare module '${PKG_NAME}' {
${body}
}
`
}

/**
 * Render the raw tag names as an interface so the tag functions can infer their class keys.
 */
function tagNamesToType(tagNames: Map<string, string>) {
	if (!tagNames.size) return ''

	const entries = [...tagNames]
		.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([name, type]) => `\t\t${JSON.stringify(name)}: ${type}`)

	return ['\texport interface TagMap {', ...entries, '\t}'].join('\n')
}

/**
 * The class names for one tag type, as a TypeScript union.
 */
function toClassUnion(classes: string[]) {
	if (!classes.length) return 'never'

	return classes
		.toSorted((a, b) => a.length - b.length)
		.map(c => `'${c}'`)
		.join(' | ')
}

/**
 * Render collected tags as a module augmentation for the package entrypoint.
 */
export function tagsToType(tags: Tags) {
	return [...tags]
		.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([tag, classes]) => `\texport type ${tag} = ${toClassUnion(classes)}`)
		.join('\n')
}
