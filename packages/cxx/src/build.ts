import type { Dirent } from 'node:fs'

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { transform } from 'lightningcss'
import MagicString, { type SourceMap } from 'magic-string'

import type { StyleHash, StyleManifest, StyleManifestEntry } from './manifest.js'
import type { PluginConfig, Tags } from './types.js'
import {
	AUTOGEN_MSG,
	GENERATED_DIR,
	NAME,
	PKG_NAME,
	STYLE_MANIFEST_FILE,
} from './config.js'
import { Logger } from './logger.js'
import { LruCache } from './lru.js'
import { hashStyle } from './style-hash.js'
import { pascalise } from './utils.js'

const logger = new Logger(NAME)

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/**
 * LRU cache of `collect` results by file id + last seen source + config so watcher and transform
 * can reuse the same parsed template/tags.
 */
const collectCache = new LruCache<{
	source: string
	config: string
	template: string
	tags: Tags
	styles: StyleHash[]
	map: SourceMap | null
}>()

/**
 * Serialises type file writes inside a single process so overlapping writes can't interleave or
 * land out of order.
 */
let writeChain: Promise<void> = Promise.resolve()

/**
 * Returns whether the error was caused by a missing file or directory.
 */
export function isENOENT(err: unknown) {
	return err instanceof Error && 'code' in err && err.code === 'ENOENT'
}

/**
 * Write a file by writing to a unique temporary file and renaming it into place, so concurrent
 * writers never observe a partial file. The temp file is cleaned up if the rename fails.
 */
async function writeFileAtomic(filePath: string, content: string) {
	const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

	await fs.writeFile(tmp, content)

	try {
		await fs.rename(tmp, filePath)
	} catch (err) {
		await fs.rm(tmp, { force: true })
		throw err
	}
}

/**
 * Run a write task after all previously queued writes have settled. A rejection doesn't break the
 * chain for later tasks.
 */
function enqueueWrite<T>(task: () => Promise<T>) {
	// wait for the previous write to finish, then run this one, even if the previous one failed
	const run = writeChain.then(task, task)

	// move the queue on to this write, but turn either outcome into success so it never rejects
	writeChain = run.then(
		() => undefined,
		() => undefined,
	)

	// return the real promise, so the caller still sees this write's value or error
	return run
}

/**
 * Write a file only if the content differs from what is already on disk, so watchers are not woken
 * by a needless mtime change.
 */
export async function maybeWrite(filePath: string, content: string) {
	try {
		if ((await fs.readFile(filePath, 'utf-8')) === content) return false
	} catch (err) {
		if (!isENOENT(err)) throw err
	}

	await writeFileAtomic(filePath, content)

	return true
}

// matches `[css, classes, href] = cxx\`...\`` and `cxx.tag<T>('name')\`...\``
// capture groups: 1 optional `export `, 2-4 assigned variable names, 5 plain
// css body, 6 quote kind, 7 tag name, 8 tagged css body
const regex =
	/((?:export\s+)?)(?:const|var|let)\s*\[(\w*)\s*,?\s*(\w*)\s*,?\s*(\w*)\s*\]\s*=\s*cxx(?:\s*`([\s\S]*?)`|\s*\.\s*tag(?:\s*<[^>]+>)?\s*\(\s*(['"])(.*?)\6\s*\)\s*`([\s\S]*?)`)/gm

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export class DuplicateTagError extends Error {
	name = 'DuplicateTagError'

	constructor(tag: string) {
		super(`Tag ${tag} has already been seen. Tags must be unique across your application`)
	}
}

export class InvalidTagError extends Error {
	name = 'InvalidTagError'

	constructor(tag: string) {
		super(
			`Tag "${tag}" does not map to a valid TypeScript identifier. ` +
				`Use letters, numbers, spaces, "_" or "-"`,
		)
	}
}

/**
 * Transform `cxx` templates in one source file and collect any exported tag types.
 */
export function collect(source: string, id: string, config: PluginConfig) {
	const configKey = JSON.stringify(config)

	// reuse the last result when the source and config are unchanged
	const cached = collectCache.get(id)
	if (cached?.source === source && cached.config === configKey) return cached

	const tags: Tags = new Map()
	const collectedStyles: StyleHash[] = []
	const magic = new MagicString(source)

	let matched = false

	// the regex is global, so reset its cursor before scanning
	regex.lastIndex = 0

	let match: RegExpExecArray | null

	// walk every cxx template and replace it in place
	while ((match = regex.exec(source))) {
		matched = true

		// capture groups: export, three bindings, plain css, (quote), tag, tagged css
		const [, exp, varOne, varTwo, varThree, plainCss, , tag, taggedCss] = match
		const css = plainCss ?? taggedCss
		const matchIndex = match.index

		// compile the CSS to minified CSS Modules, reporting the source line on failure
		const { code, exports: classExports = {} } = (() => {
			try {
				return transform({
					minify: true,
					cssModules: true,
					filename: id,
					code: encoder.encode(css),
				})
			} catch (err) {
				const line = source.slice(0, matchIndex).split('\n').length
				throw new Error(`Failed to compile cxx CSS at ${id}:${line}`, { cause: err })
			}
		})()

		const { href, hash } = hashStyle(code)
		collectedStyles.push({ href, hash })

		// map each class name to its generated (scoped) name
		const styles = Object.fromEntries(
			Object.entries(classExports).map(([k, v]) => [k, v.name]),
		)

		if (tag) {
			const suffix =
				typeof config.typeSuffix === 'string'
					? config.typeSuffix
					: config.typeSuffix === false
						? ''
						: 'Classes'
			const tagWithSuffix = pascalise(`${tag}${suffix}`)

			if (!IDENTIFIER.test(tagWithSuffix)) throw new InvalidTagError(tag)
			if (tags.has(tagWithSuffix)) throw new DuplicateTagError(tagWithSuffix)

			// side effect but necessary
			tags.set(tagWithSuffix, Object.keys(styles))
		}

		const statements: string[] = []

		if (varOne) {
			statements.push(`${exp}const ${varOne} = ${JSON.stringify(decoder.decode(code))}`)
		}

		if (varTwo) {
			statements.push(`${exp}const ${varTwo} = ${JSON.stringify(styles)}`)
		}

		if (varThree) {
			statements.push(`${exp}const ${varThree} = ${JSON.stringify(href)}`)
		}

		// swap the template for the generated declarations, keeping the export keyword
		magic.overwrite(matchIndex, matchIndex + match[0].length, statements.join('\n'))
	}

	const template = magic.toString()
	// only build a map when something was actually rewritten
	const map = matched
		? magic.generateMap({ source: id, includeContent: true, hires: true })
		: null
	const result = {
		source,
		config: configKey,
		template,
		tags,
		styles: collectedStyles,
		map,
	}

	collectCache.set(id, result)

	return result
}

/**
 * Render the generated declaration file contents for a set of collected tags.
 */
function renderTypes(tags: Tags) {
	return [
		AUTOGEN_MSG,
		'',
		`import '${PKG_NAME}'`,
		'',
		`declare module '${PKG_NAME}' {`,
		tagsToType(tags),
		'}',
		'',
	].join('\n')
}

/**
 * Write (or remove) the generated `index.d.ts` for a full tag surface.
 */
async function writeRenderedTypes(tags: Tags) {
	const filePath = path.join(GENERATED_DIR, 'index.d.ts')

	if (!tags.size) {
		await fs.rm(filePath, { force: true })
		return
	}

	await fs.mkdir(GENERATED_DIR, { recursive: true })
	await maybeWrite(filePath, renderTypes(tags))
}

const PARTIAL_DIR = path.join(GENERATED_DIR, 'tags')

// wait this long after the last file before rebuilding, so a burst of files
// only re-reads the partials once
const REBUILD_WAIT = 100

let rebuildTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Map a source file to its partial file, named by a hash of the absolute path so each file has
 * exactly one partial.
 */
function partialPath(filePath: string) {
	return path.join(
		PARTIAL_DIR,
		`${createHash('sha1').update(filePath).digest('hex')}.json`,
	)
}

type DuplicateTag = {
	tag: string
	files: string[]
}

/**
 * Read every per-file partial and merge them into one tag map. Partials whose source file no
 * longer exists are pruned, and duplicate tag names are reported with the files that define them.
 */
async function readPartials(): Promise<{ tags: Tags; duplicates: DuplicateTag[] }> {
	let entries: string[]

	try {
		entries = await fs.readdir(PARTIAL_DIR)
	} catch (err) {
		if (isENOENT(err)) return { tags: new Map(), duplicates: [] }
		throw err
	}

	const tags: Tags = new Map()
	const fileByTag = new Map<string, string>()
	const duplicates: DuplicateTag[] = []

	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue

		const partial = path.join(PARTIAL_DIR, entry)
		let parsed: { file: string; tags: Record<string, string[]> }

		try {
			parsed = JSON.parse(await fs.readFile(partial, 'utf-8'))
		} catch {
			continue
		}

		let source: string

		try {
			source = await fs.readFile(parsed.file, 'utf-8')
		} catch {
			await fs.rm(partial, { force: true })
			continue
		}

		// drop partials for files that no longer use cxx, so their tags do not linger
		if (!source.includes('cxx')) {
			await fs.rm(partial, { force: true })
			continue
		}

		for (const [name, classes] of Object.entries(parsed.tags)) {
			const existing = fileByTag.get(name)

			if (existing) {
				duplicates.push({ tag: name, files: [existing, parsed.file] })
				continue
			}

			fileByTag.set(name, parsed.file)
			tags.set(name, classes)
		}
	}

	return { tags, duplicates }
}

/**
 * Persist one file's tags to its own partial, then rebuild the shared types soon. Rebuilding is
 * debounced and serialised, so a large build does not re-read every partial per file.
 */
export function writeTypesForFile(filePath: string, tags: Tags) {
	return enqueueWrite(async () => {
		await fs.mkdir(PARTIAL_DIR, { recursive: true })

		const partial = partialPath(filePath)

		if (!tags.size) {
			await fs.rm(partial, { force: true })
		} else {
			await writeFileAtomic(
				partial,
				JSON.stringify({ file: filePath, tags: Object.fromEntries(tags) }),
			)
		}
	})
		.then(() => scheduleRebuild())
		.catch(err => {
			logger.error(`failed to write types for ${filePath}`, err)
		})
}

/**
 * Queue a rebuild of `index.d.ts` after a short delay, so a burst of writes only rebuilds once.
 */
function scheduleRebuild() {
	if (rebuildTimer) clearTimeout(rebuildTimer)

	rebuildTimer = setTimeout(() => {
		rebuildTimer = null
		flushTypes().catch(err => {
			logger.error('failed to generate types', err)
		})
	}, REBUILD_WAIT)
}

/**
 * Rebuild `index.d.ts` from every partial.
 */
export function flushTypes() {
	if (rebuildTimer) {
		clearTimeout(rebuildTimer)
		rebuildTimer = null
	}

	return enqueueWrite(async () => {
		const { tags, duplicates } = await readPartials()
		await writeRenderedTypes(tags)

		for (const duplicate of duplicates) {
			logger.error(
				`Tag "${duplicate.tag}" is defined in multiple files: ${duplicate.files.join(', ')}`,
			)
		}
	})
}

const STYLE_PARTIAL_DIR = 'styles'
const STYLE_REBUILD_WAIT = 100

let styleRebuildTimer: ReturnType<typeof setTimeout> | null = null

function styleManifestPath(root: string) {
	return path.join(root, GENERATED_DIR, STYLE_MANIFEST_FILE)
}

function stylePartialDir(root: string) {
	return path.join(root, GENERATED_DIR, STYLE_PARTIAL_DIR)
}

function stylePartialPath(root: string, filePath: string) {
	return path.join(
		stylePartialDir(root),
		`${createHash('sha1').update(filePath).digest('hex')}.json`,
	)
}

/**
 * Persist one file's style hashes, then rebuild the shared manifest after a
 * short delay so a burst of transforms only merges the partials once.
 */
export function writeStylesForFile(
	filePath: string,
	styles: StyleHash[],
	root: string = process.cwd(),
) {
	return enqueueWrite(async () => {
		const dir = stylePartialDir(root)
		await fs.mkdir(dir, { recursive: true })

		const partial = stylePartialPath(root, filePath)

		if (styles.length === 0) {
			await fs.rm(partial, { force: true })
			return
		}

		await writeFileAtomic(partial, JSON.stringify({ file: filePath, styles }))
	})
		.then(() => scheduleStyleRebuild(root))
		.catch(err => {
			logger.error(`failed to write styles for ${filePath}`, err)
		})
}

function scheduleStyleRebuild(root: string) {
	if (styleRebuildTimer) clearTimeout(styleRebuildTimer)

	styleRebuildTimer = setTimeout(() => {
		styleRebuildTimer = null

		flushStyles(root).catch(err => {
			logger.error('failed to generate style manifest', err)
		})
	}, STYLE_REBUILD_WAIT)
}

/**
 * Merge every per-file style partial into the style manifest.
 */
export function flushStyles(root: string = process.cwd()) {
	if (styleRebuildTimer) {
		clearTimeout(styleRebuildTimer)
		styleRebuildTimer = null
	}

	return enqueueWrite(async () => {
		const manifestPath = styleManifestPath(root)
		const manifest = await readStylePartials(root)

		await fs.mkdir(path.dirname(manifestPath), { recursive: true })
		await maybeWrite(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`)
	})
}

async function readStylePartials(root: string): Promise<StyleManifest> {
	let entries: string[]

	try {
		entries = await fs.readdir(stylePartialDir(root))
	} catch (err) {
		if (isENOENT(err)) return emptyStyleManifest()
		throw err
	}

	const styles = new Map<string, StyleManifestEntry>()

	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue

		const filePartial = path.join(stylePartialDir(root), entry)
		let parsed: { file: string; styles: StyleHash[] }

		try {
			parsed = JSON.parse(await fs.readFile(filePartial, 'utf-8'))
		} catch {
			continue
		}

		if (
			typeof parsed.file !== 'string' ||
			!Array.isArray(parsed.styles) ||
			parsed.styles.length === 0
		) {
			await fs.rm(filePartial, { force: true })
			continue
		}

		let source: string

		try {
			source = await fs.readFile(parsed.file, 'utf-8')
		} catch {
			await fs.rm(filePartial, { force: true })
			continue
		}

		if (!source.includes('cxx')) {
			await fs.rm(filePartial, { force: true })
			continue
		}

		const file = path.relative(root, parsed.file).split(path.sep).join('/')

		for (const style of parsed.styles) {
			if (
				typeof style !== 'object' ||
				style === null ||
				typeof style.href !== 'string' ||
				typeof style.hash !== 'string'
			) {
				continue
			}

			const existing = styles.get(style.href)

			if (existing) {
				if (existing.hash !== style.hash) {
					logger.error(
						`style hash collision for ${style.href}: ${existing.hash} and ${style.hash}`,
					)
					continue
				}

				if (!existing.files.includes(file)) existing.files.push(file)
				continue
			}

			styles.set(style.href, { hash: style.hash, files: [file] })
		}
	}

	for (const style of styles.values()) style.files = style.files.toSorted()

	const sortedStyles = Object.fromEntries(
		[...styles.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
	)
	const hashes = [...new Set([...styles.values()].map(style => style.hash))].toSorted()

	return { schema: 1, hashes, styles: sortedStyles }
}

function emptyStyleManifest(): StyleManifest {
	return { schema: 1, hashes: [], styles: {} }
}

export const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

// directories that never contain source we transform
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out'])

/**
 * Run `fn` for every item, with at most `concurrency` calls in flight.
 */
async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>,
) {
	let cursor = 0

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			while (cursor < items.length) {
				const index = cursor++
				await fn(items[index])
			}
		},
	)

	await Promise.all(workers)
}

/**
 * Read one file, collect its tags and styles, and persist them. A file with no `cxx` usage has its
 * partials removed, so stale entries drop out.
 */
export async function refreshFile(
	file: string,
	config: PluginConfig,
	root: string = config.watch?.root ?? process.cwd(),
) {
	let source: string

	try {
		source = await fs.readFile(file, 'utf-8')
	} catch (err) {
		if (!isENOENT(err)) throw err
		await Promise.all([
			writeTypesForFile(file, new Map()),
			writeStylesForFile(file, [], root),
		])
		return
	}

	const result = source.includes('cxx')
		? collect(source, file, config)
		: { tags: new Map(), styles: [] }

	await Promise.all([
		writeTypesForFile(file, result.tags),
		writeStylesForFile(file, result.styles, root),
	])
}

/**
 * Remove orphaned `.tmp` files left by a write that was killed before its rename. Only the seed
 * does this, because it runs once at startup before any write is in flight.
 */
async function sweepTmpFiles(root: string) {
	for (const dir of [GENERATED_DIR, PARTIAL_DIR, stylePartialDir(root)]) {
		let entries: string[]

		try {
			entries = await fs.readdir(dir)
		} catch (err) {
			if (isENOENT(err)) continue
			throw err
		}

		for (const entry of entries) {
			if (entry.endsWith('.tmp')) {
				await fs.rm(path.join(dir, entry), { force: true })
			}
		}
	}
}

/**
 * Walk every source file under `root` and seed types and styles, so a fresh checkout (and a build
 * with no edits) has metadata without waiting for a transform.
 */
export async function seedTypes(root: string, config: PluginConfig) {
	await sweepTmpFiles(root)

	async function scan(dir: string) {
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
				await scan(full)
				return
			}

			if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return

			await refreshFile(full, config, root)
		})
	}

	await scan(root)
	await Promise.all([flushTypes(), flushStyles(root)])
}

/**
 * Render collected tags as a module augmentation for the package entrypoint.
 */
export function tagsToType(tags: Tags) {
	return [...tags]
		.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([tag, classes]) => {
			const union =
				classes.length > 0
					? classes
							.toSorted((a, b) => a.length - b.length)
							.map(c => `'${c}'`)
							.join(' | ')
					: 'never'

			return `\texport type ${tag} = ${union}`
		})
		.join('\n')
}
