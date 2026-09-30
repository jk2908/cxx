import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { transform } from 'lightningcss'
import MagicString, { type SourceMap } from 'magic-string'

import type { BuildContext, PluginConfig, Tags } from './types.js'
import { AUTOGEN_MSG, GENERATED_DIR, PKG_NAME } from './config.js'
import { LruCache } from './lru.js'
import { pascalise } from './utils.js'

// decode bytes to a string, then stringify into a safe literal. `${bytes}` only
// works by accident for Buffer; a plain Uint8Array stringifies as `97,123,125`
const decoder = new TextDecoder()

/**
 * LRU cache of `collect` results by file id + last seen source + config so watcher and transform
 * can reuse the same parsed template/tags.
 */
const collectCache = new LruCache<{
	source: string
	config: string
	template: string
	tags: Tags
	map: SourceMap | null
}>()

/**
 * LRU cache for file content. Stores the last written content per file path so `maybeWrite`
 * can skip disk i/o when nothing has changed.
 */
const fileCache = new LruCache<string>()

/**
 * Serialises type file writes inside a single process so overlapping `writeTypes` calls can't
 * interleave or land out of order.
 */
let writeChain: Promise<void> = Promise.resolve()

/**
 * Returns whether the error was caused by a missing file or directory.
 */
export function isENOENT(err: unknown) {
	return err instanceof Error && 'code' in err && err.code === 'ENOENT'
}

/**
 * Write a file by first writing to a unique temporary file and then renaming it into place, so
 * concurrent writers (e.g. Turbopack loader workers) never observe a partial file.
 */
async function writeFileAtomic(filePath: string, content: string) {
	const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

	await fs.writeFile(tmp, content)
	await fs.rename(tmp, filePath)
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
 * Write a file only if the content actually differs from what is already on disk.
 */
export async function maybeWrite(filePath: string, content: string) {
	const cached = fileCache.get(filePath)
	// fast path: already wrote this exact content in this process
	if (cached === content) return false

	// verify against disk on a cold start (or when the cache is stale) so we
	// don't needlessly bump the mtime and invalidate downstream watchers
	try {
		if ((await fs.readFile(filePath, 'utf-8')) === content) {
			fileCache.set(filePath, content)
			return false
		}
	} catch (err) {
		if (!isENOENT(err)) throw err
	}

	await writeFileAtomic(filePath, content)
	fileCache.set(filePath, content)

	return true
}

// matches `[css, classes, href] = cxx\`...\`` and `cxx.tag<T>('name')\`...\``
// capture groups: 1 optional `export `, 2-4 assigned variable names, 5 plain
// css body, 6 quote kind, 7 tag name, 8 tagged css body
const regex =
	/((?:export\s+)?)(?:const|var|let)\s*\[(\w*)\s*,?\s*(\w*)\s*,?\s*(\w*)\s*\]\s*=\s*cxx(?:\s*`([\s\S]*?)`|\s*\.\s*tag(?:\s*<[^>]+>)?\s*\(\s*(['"])(.*?)\6\s*\)\s*`([\s\S]*?)`)/gm

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Hash transformed CSS into a stable href for style deduplication.
 */
function hashCss(code: Uint8Array) {
	return `cxx-${createHash('sha256').update(code).digest('base64url').slice(0, 12)}`
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

		// compile the CSS to minified CSS Modules
		const { code, exports = {} } = transform({
			minify: true,
			cssModules: true,
			filename: id,
			code: new TextEncoder().encode(css),
		})

		const href = hashCss(code)
		// map each class name to its generated (scoped) name
		const styles = Object.fromEntries(
			Object.entries(exports).map(([k, v]) => [k, v.name]),
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
		magic.overwrite(match.index, match.index + match[0].length, statements.join('\n'))
	}

	const template = magic.toString()
	// only build a map when something was actually rewritten
	const map = matched
		? magic.generateMap({ source: id, includeContent: true, hires: true })
		: null
	const result = { source, config: configKey, template, tags, map }

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
		// `force` makes this a no-op when the file is already absent
		await fs.rm(filePath, { force: true })
		fileCache.delete(filePath)

		return
	}

	await fs.mkdir(GENERATED_DIR, { recursive: true })
	await maybeWrite(filePath, renderTypes(tags))
}

/**
 * Write the generated declaration file for the current set of collected tags.
 */
export function writeTypes(tags: Tags) {
	return enqueueWrite(() => writeRenderedTypes(tags))
}

const PARTIAL_DIR = path.join(GENERATED_DIR, 'tags')

function partialPath(filePath: string) {
	return path.join(
		PARTIAL_DIR,
		`${createHash('sha1').update(filePath).digest('hex')}.json`,
	)
}

/**
 * Read every per-file partial written by the Next loader workers and merge them into one tag map.
 * Partials whose source file no longer exists are pruned so deleted files drop out of the types.
 */
async function readPartials() {
	let entries: string[]

	try {
		entries = await fs.readdir(PARTIAL_DIR)
	} catch (err) {
		if (isENOENT(err)) return new Map()
		throw err
	}

	const tags: Tags = new Map()

	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue

		const partial = path.join(PARTIAL_DIR, entry)
		let parsed: { file: string; tags: Record<string, string[]> }

		try {
			parsed = JSON.parse(await fs.readFile(partial, 'utf-8'))
		} catch {
			continue
		}

		try {
			await fs.access(parsed.file)
		} catch {
			await fs.rm(partial, { force: true })
			continue
		}

		for (const [name, classes] of Object.entries(parsed.tags)) {
			if (tags.has(name)) throw new DuplicateTagError(name)
			tags.set(name, classes)
		}
	}

	return tags
}

/**
 * Next-specific write path. Turbopack spreads loaders across worker processes, so each worker
 * persists its own per-file partial and rebuilds the shared declaration file from all of them.
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

		await writeRenderedTypes(await readPartials())
	})
}

/**
 * Render collected tags as a module augmentation for the package entrypoint.
 */
export function tagsToType(tags: Tags) {
	return [...tags]
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

/**
 * Merge per-file tag maps into one application-wide tag map.
 */
export function flattenTags(tagsByFile: BuildContext['tagsByFile']) {
	const tags = new Map<string, string[]>()

	for (const fileTags of tagsByFile.values()) {
		for (const [name, classes] of fileTags) {
			if (tags.has(name)) throw new DuplicateTagError(name)
			tags.set(name, classes)
		}
	}

	return tags
}
