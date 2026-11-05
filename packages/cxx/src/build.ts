import type { Dirent } from 'node:fs'

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { transform } from 'lightningcss'
import MagicString, { type SourceMap } from 'magic-string'

import type { EmbedStyleDescriptor, PluginConfig, Tags } from './types.js'
import { AUTOGEN_MSG, GENERATED_DIR, NAME, PKG_NAME } from './config.js'
import { Logger } from './logger.js'
import { LruCache } from './lru.js'
import { pascalise } from './utils.js'

const logger = new Logger(NAME)

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/**
 * LRU cache of `collect` results by file id + last seen source + config so watcher and transform
 * can reuse the same parsed template/tags.
 */
export type StyleSheet = {
	hash: string
	css: string
}

const collectCache = new LruCache<{
	source: string
	config: string
	template: string
	tags: Tags
	sheets: StyleSheet[]
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

// matches cxx.embed and cxx.extract, with an optional `.tag('name')`.
// capture groups: 1 mode, 2 quote kind, 3 tag name, 4 css body
const regex =
	/\bcxx\.(embed|extract)(?:\.tag(?:\s*<[^>]+>)?\s*\(\s*(['"])(.*?)\2\s*\))?\s*`([\s\S]*?)`/g

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Hash transformed CSS into a stable href and asset key.
 */
function hashCss(code: Uint8Array) {
	const hash = createHash('sha256').update(code).digest('base64url').slice(0, 12)

	return { href: `cxx-${hash}`, key: hash }
}

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
	const sheets: StyleSheet[] = []
	const magic = new MagicString(source)

	let matched = false

	// the regex is global, so reset its cursor before scanning
	regex.lastIndex = 0

	let match: RegExpExecArray | null

	// walk every cxx template and replace it in place
	while ((match = regex.exec(source))) {
		matched = true

		const [, rawMode, , tag, css] = match
		const mode = rawMode === 'extract' ? 'extract' : 'embed'
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

		const { href, key } = hashCss(code)
		const cssText = decoder.decode(code)

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

		let replacement: string

		if (mode === 'extract') {
			sheets.push({ hash: key, css: cssText })
			replacement = `{\n\tmode: 'extract',\n\tstyles: ${JSON.stringify(styles)}\n}`
		} else {
			const styleProps: EmbedStyleDescriptor = {
				mode: 'embed',
				href,
				css: cssText,
				precedence: 'default',
			}

			replacement = `{\n\tmode: 'embed',\n\tstyles: ${JSON.stringify(styles)},\n\tstyleProps: ${JSON.stringify(styleProps)}\n}`
		}

		magic.overwrite(matchIndex, matchIndex + match[0].length, replacement)
	}

	const template = magic.toString()
	// only build a map when something was actually rewritten
	const map = matched
		? magic.generateMap({ source: id, includeContent: true, hires: true })
		: null
	const result = { source, config: configKey, template, tags, sheets, map }

	collectCache.set(id, result)

	return result
}

/**
 * Write generated styles next to their source file and return relative import specifiers.
 */
export function writeStyleSheets(filePath: string, sheets: StyleSheet[]) {
	if (sheets.length === 0) return []

	const dir = path.join(path.dirname(filePath), '.cxx')
	mkdirSync(dir, { recursive: true })

	return sheets.map(sheet => {
		writeFileSync(path.join(dir, `${sheet.hash}.css`), sheet.css)
		return `./.cxx/${sheet.hash}.css`
	})
}

/**
 * Insert style imports after any leading module directive.
 */
export function injectStyleImports(template: string, imports: string[]) {
	if (imports.length === 0) return template

	const directive =
		/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use (?:client|server)\1;?/.exec(template)
	const at = directive ? directive[0].length : 0
	const lines = imports
		.map(specifier => `import ${JSON.stringify(specifier)};`)
		.join('\n')

	return `${template.slice(0, at)}\n${lines}\n${template.slice(at)}`
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
 * Read one file, collect its tags, and persist them. A file with no `cxx` usage has its partial
 * removed, so stale tags drop out.
 */
export async function refreshFile(file: string, config: PluginConfig) {
	let source: string

	try {
		source = await fs.readFile(file, 'utf-8')
	} catch (err) {
		if (!isENOENT(err)) throw err
		await writeTypesForFile(file, new Map())
		return
	}

	const tags = source.includes('cxx') ? collect(source, file, config).tags : new Map()
	await writeTypesForFile(file, tags)
}

/**
 * Remove orphaned `.tmp` files left by a write that was killed before its rename. Only the seed
 * does this, because it runs once at startup before any write is in flight.
 */
async function sweepTmpFiles() {
	for (const dir of [GENERATED_DIR, PARTIAL_DIR]) {
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
 * Walk every source file under `root` and seed the type surface, so a fresh checkout (and a build
 * with no edits) has types without waiting for a transform.
 */
export async function seedTypes(root: string, config: PluginConfig) {
	await sweepTmpFiles()

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

			await refreshFile(full, config)
		})
	}

	await scan(root)
	await flushTypes()
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
