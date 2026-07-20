import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { transform } from 'lightningcss'

import type { BuildContext, Cxx, PluginConfig, Result, Tags } from './types.js'
import { AUTOGEN_MSG, GENERATED_DIR, PKG_NAME } from './config.js'
import { LruCache } from './lru.js'
import { pascalise } from './utils.js'

/**
 * LRU cache of `collect` results by file id and last seen source so watcher and transform can
 * reuse the same parsed template/tags
 */
const collectCache = new LruCache<{ source: string; template: string; tags: Tags }>()

/**
 * LRU cache for file content. Stores the last written content per file path so `maybeWrite`
 * can skip disk i/o when nothing has changed
 */
const fileCache = new LruCache<string>()

/**
 * Returns whether the error was caused by a missing file or directory
 */
export function isENOENT(err: unknown) {
	return err instanceof Error && 'code' in err && err.code === 'ENOENT'
}

/**
 * Write a file only if the content has changed since the last build
 */
export async function maybeWrite(filePath: string, content: string) {
	const cached = fileCache.get(filePath)

	if (cached !== content) {
		// cache says content changed, write without reading
		await fs.writeFile(filePath, content)
		fileCache.set(filePath, content)

		return true
	}

	// cache miss or cache hit with same content — verify on disk
	try {
		if ((await fs.readFile(filePath, 'utf-8')) === content) {
			fileCache.set(filePath, content)
			return false
		}
	} catch (err) {
		if (!isENOENT(err)) throw err
	}

	await fs.writeFile(filePath, content)
	fileCache.set(filePath, content)

	return true
}

// matches `[css, classes, href] = cxx\`...\`` and `cxx.tag<T>('name')\`...\``
// capture groups: 1-3 assigned variable names, 4 plain css body, 5 quote
// kind, 6 tag name, 7 tagged css body
const regex =
	/(?:const|var|let)\s*\[(\w+|)\s*,?\s*(\w+|)\s*,?\s*(\w+|)\s*\]\s*=\s*cxx(?:\s*`([\s\S]*?)`|\s*\.\s*tag(?:\s*<[^>]+>)?\s*\(\s*(['"])(.*?)\5\s*\)\s*`([\s\S]*?)`)/gm

/**
 * Hash transformed CSS into a stable href for style deduplication
 */
function hashCss(code: Uint8Array) {
	return `cxx-${createHash('sha256').update(code).digest('base64url').slice(0, 12)}`
}

export class TagDuplicateError extends Error {
	constructor(tag: string) {
		super(`Tag ${tag} has already been seen. Tags must be unique across your application`)
	}
}

/**
 * Transform `cxx` templates in one source file and collect any exported tag types
 */
export function collect(source: string, id: string, config: PluginConfig) {
	const tags: Tags = new Map()

	const cached = collectCache.get(id)
	if (cached?.source === source) return cached

	const template = source.replace(
		regex,
		(_match, varOne, varTwo, varThree, plainCss, _quote, tag, taggedCss) => {
			const css = plainCss ?? taggedCss

			const { code, exports = {} } = transform({
				minify: true,
				cssModules: true,
				filename: id,
				code: new TextEncoder().encode(css),
			})

			const href = hashCss(code)
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

				if (tags.has(tagWithSuffix)) throw new TagDuplicateError(tagWithSuffix)

				// side effect but neccessary
				tags.set(tagWithSuffix, Object.keys(styles))
			}

			return [
				varOne && `const ${varOne} = \`${code}\``,
				varTwo && `const ${varTwo} = ${JSON.stringify(styles)}`,
				varThree && `const ${varThree} = \`${href}\``,
			]
				.filter(Boolean)
				.join('\n')
		},
	)

	// cache
	collectCache.set(id, { source, template, tags })

	return {
		template,
		tags,
	}
}

/**
 * Write the generated declaration file for the current set of collected tags
 */
export async function writeTypes(tags: Tags) {
	const filePath = path.join(GENERATED_DIR, 'index.d.ts')

	if (!tags.size) {
		try {
			await fs.rm(filePath, { force: true })
			fileCache.delete(filePath)
		} catch (err) {
			if (!isENOENT(err)) throw err
		}

		return
	}

	await fs.mkdir(GENERATED_DIR, { recursive: true })

	await maybeWrite(
		filePath,
		`${AUTOGEN_MSG}

			import '${PKG_NAME}'

			declare module '${PKG_NAME}' {
				${tagsToType(tags)}
			}
		`,
	)
}

/**
 * Render collected tags as a module augmentation for the package entrypoint
 */
export function tagsToType(tags: Tags) {
	return [...tags]
		.map(
			([tag, classes]) => `
		export type ${tag} = ${
			classes.length > 0
				? classes
						.toSorted((a, b) => a.length - b.length)
						.map(c => `'${c}'`)
						.join(' | ')
				: 'never'
		}
	`,
		)
		.join('\n')
}

/**
 * Merge per-file tag maps into one application-wide tag map
 */
export function flattenTags(tagsByFile: BuildContext['tagsByFile']) {
	const tags = new Map<string, string[]>()

	for (const fileTags of tagsByFile.values()) {
		for (const [name, classes] of fileTags) {
			if (tags.has(name)) throw new TagDuplicateError(name)
			tags.set(name, classes)
		}
	}

	return tags
}

/**
 * Build-time template tag placeholder used by the transform to emit CSS, classes and href values
 */
export const cxx: Cxx = Object.assign((_: TemplateStringsArray): Result => ['', {}, ''], {
	tag:
		<ClassName extends string = string>(_: string) =>
		(_strings: TemplateStringsArray): Result<ClassName> => [
			'',
			{} as Readonly<Record<ClassName, string>>,
			'',
		],
})
