import type { Expression, Program, TaggedTemplateExpression } from 'oxc-parser'

import { createHash } from 'node:crypto'

import { transform } from 'lightningcss'
import MagicString, { type SourceMap } from 'magic-string'
import { parseSync, Visitor } from 'oxc-parser'

import type { EmbedStyleDescriptor, PluginConfig, Tags } from './types.js'
import { NAME, PKG_NAME } from './config.js'
import { LruCache } from './lru.js'
import { pascalise } from './utils.js'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export type StyleSheet = {
	hash: string
	css: string
}

type CollectResult = {
	source: string
	config: string
	template: string
	tags: Tags
	tagNames: Map<string, string>
	sheets: StyleSheet[]
	map: SourceMap | null
}

/**
 * Caches by file id + last seen source + config, so the watcher and transform can reuse a result.
 */
const collectCache = new LruCache<CollectResult>()

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
			`Tag "${tag}" does not map to a valid TypeScript identifier. Use letters, numbers, spaces, "_" or "-"`,
		)
	}
}

export class InvalidTagNameError extends Error {
	name = 'InvalidTagNameError'

	constructor(where: string) {
		super(`cxx tag names must be a string literal at ${where}`)
	}
}

export class InterpolationError extends Error {
	name = 'InterpolationError'

	constructor(where: string) {
		super(
			`cxx templates do not support interpolation at ${where}. Use a literal or a CSS variable`,
		)
	}
}

/**
 * The fixed property name of a member expression.
 *
 * `cxx.embed` and `cxx['embed']` both return `"embed"`; `cxx[name]` and non-member nodes return
 * `null`.
 */
function getMemberName(node?: Expression | null) {
	// nothing to read if this is not a member access like `x.x` or `x['x']`
	if (node?.type !== 'MemberExpression') return null

	// dot access: the property must be an identifier to have a readable name
	if (!node.computed) {
		return node.property.type === 'Identifier' ? node.property.name : null
	}

	// bracket access: only a string literal is knowable at build time
	if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
		return node.property.value
	}

	// dynamic key such as `x[name]` cannot be resolved statically
	return null
}

/**
 * The member name if its object is the cxx namespace, for example `cxx.embed` or `styles['embed']`.
 * Returns `null` for any other object or an unresolvable member.
 */
function getCxxMemberName(node: Expression | null | undefined, cxxNames: Set<string>) {
	// the node must be a member access such as `cxx.embed` or `styles['embed']`
	if (node?.type !== 'MemberExpression') return null

	// the object must be the imported cxx namespace, or one of its local aliases
	if (node.object.type !== 'Identifier' || !cxxNames.has(node.object.name)) return null

	// now read the property: `.embed`, `['embed']`, and so on
	return getMemberName(node)
}

/**
 * The cxx mode for a member name, or `null` when it is not `embed` or `extract`.
 */
function getMode(name: string) {
	if (name === 'embed' || name === 'extract') return name

	return null
}

/**
 * Local names that refer to the cxx namespace.
 *
 * @example
 * ```ts
 * import { cxx } from '@jk2908/cxx'           // → cxx
 * import { cxx as styles } from '@jk2908/cxx' // → styles
 * import * as cxx from '@jk2908/cxx'          // → cxx
 * ```
 *
 * Falls back to `cxx` when there is no matching import.
 */
function getCxxNamespaceNames(program: Program) {
	const locals = new Set<string>()

	// only top-level import declarations can bind the cxx namespace
	for (const statement of program.body) {
		if (statement.type !== 'ImportDeclaration') continue

		// ignore imports from other packages
		if (statement.source.value !== PKG_NAME) continue

		for (const specifier of statement.specifiers) {
			// `import { cxx }` or `import { cxx as styles }`
			if (specifier.type === 'ImportSpecifier') {
				// the imported binding must be `cxx`, not some other export
				if (
					specifier.imported.type !== 'Identifier' ||
					specifier.imported.name !== NAME
				) {
					continue
				}

				// keep the local name, which may be an alias
				locals.add(specifier.local.name)
			} else if (specifier.type === 'ImportNamespaceSpecifier') {
				// `import * as styles`
				locals.add(specifier.local.name)
			}
		}
	}

	// no matching import: keep the literal `cxx` working
	return locals.size ? locals : new Set([NAME])
}

/**
 * Format a source offset as `file:line:column` (both 1-based).
 */
function formatLocation(source: string, id: string, offset: number) {
	const lines = source.slice(0, offset).split('\n')

	return `${id}:${lines.length}:${(lines[lines.length - 1]?.length ?? 0) + 1}`
}

/**
 * Identify a cxx template marker.
 *
 * Returns `{ mode }` for `cxx.embed` / `cxx.extract`, or `{ mode, name }` for
 * `cxx.embed.tag('name')`. Returns `null` for any other tagged template.
 */
function resolveTemplateMarker(
	tagged: TaggedTemplateExpression,
	cxxNames: Set<string>,
	source: string,
	id: string,
) {
	// the expression in front of the backtick
	const tag = tagged.tag

	// the tag itself is the marker: cxx.embed or cxx.extract
	const directName = getCxxMemberName(tag, cxxNames)
	const directMode = directName ? getMode(directName) : null

	if (directMode) return { mode: directMode }

	// otherwise the tag is a call: cxx.embed.tag('hero')
	if (tag.type !== 'CallExpression') return null

	// the call must be `.tag(...)`, not some other method
	if (tag.callee.type !== 'MemberExpression' || getMemberName(tag.callee) !== 'tag') {
		return null
	}

	// `.tag` must be called on `cxx.embed` or `cxx.extract`
	const markerName = getCxxMemberName(tag.callee.object, cxxNames)
	const mode = markerName ? getMode(markerName) : null

	// anything other than embed or extract is not a cxx marker
	if (!mode) return null

	// the only argument is the name used to generate the type
	const nameArg = tag.arguments[0]

	// it must be a literal; a variable or computed name cannot become a type name
	if (!nameArg || nameArg.type !== 'Literal' || typeof nameArg.value !== 'string') {
		throw new InvalidTagNameError(formatLocation(source, id, nameArg?.start ?? tag.start))
	}

	return { mode, name: nameArg.value }
}

/**
 * Transform `cxx` templates in one source file and collect any exported tag types.
 */
export function collect(source: string, id: string, config: PluginConfig) {
	const configKey = JSON.stringify(config)

	// reuse the last result when the source and config are unchanged
	const cached = collectCache.get(id)
	if (cached?.source === source && cached.config === configKey) return cached

	// drop paren nodes so `(cxx.embed)` still arrives as a plain member expression
	const parsed = parseSync(id, source, { preserveParens: false })

	if (parsed.errors.length) {
		const error = parsed.errors[0]
		const label = error.labels[0]
		const where = label ? formatLocation(source, id, label.start) : id

		throw new Error(`Failed to parse ${where}: ${error.message}`)
	}

	const cxxNames = getCxxNamespaceNames(parsed.program)
	const nodes: TaggedTemplateExpression[] = []

	// walk the AST and collect every tagged template in source order
	new Visitor({
		TaggedTemplateExpression(node) {
			nodes.push(node)
		},
	}).visit(parsed.program)

	const tags: Tags = new Map()
	const tagNames = new Map<string, string>()
	const sheets: StyleSheet[] = []
	const magic = new MagicString(source)
	const typeSuffix = config.typeSuffix === false ? '' : (config.typeSuffix ?? 'Classes')

	for (const node of nodes) {
		const templateMarker = resolveTemplateMarker(node, cxxNames, source, id)
		if (!templateMarker) continue

		if (node.quasi.expressions.length) {
			throw new InterpolationError(
				formatLocation(source, id, node.quasi.expressions[0]!.start),
			)
		}

		// the raw text between the backticks; CSS escapes stay intact for lightningcss
		const css = node.quasi.quasis[0]?.value.raw ?? ''

		let compiled: ReturnType<typeof transform>

		try {
			compiled = transform({
				minify: true,
				cssModules: true,
				filename: id,
				code: encoder.encode(css),
			})
		} catch (err) {
			throw new Error(
				`Failed to compile cxx CSS at ${formatLocation(source, id, node.start)}`,
				{
					cause: err,
				},
			)
		}

		const { code, exports: classExports = {} } = compiled
		const hash = createHash('sha256').update(code).digest('base64url').slice(0, 12)
		const cssText = decoder.decode(code)

		// map each class name to its generated (scoped) name
		const styles = Object.fromEntries(
			Object.entries(classExports).map(([k, v]) => [k, v.name]),
		)

		if (templateMarker.name) {
			const tagWithSuffix = pascalise(`${templateMarker.name}${typeSuffix}`)

			if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tagWithSuffix)) {
				throw new InvalidTagError(templateMarker.name)
			}

			if (tags.has(tagWithSuffix)) throw new DuplicateTagError(tagWithSuffix)

			tags.set(tagWithSuffix, Object.keys(styles))
			tagNames.set(templateMarker.name, tagWithSuffix)
		}

		let replacement: string

		if (templateMarker.mode === 'extract') {
			sheets.push({ hash, css: cssText })
			replacement = `{\n\tmode: 'extract',\n\tstyles: ${JSON.stringify(styles)}\n}`
		} else {
			const styleProps: EmbedStyleDescriptor = {
				mode: 'embed',
				href: `cxx-${hash}`,
				css: cssText,
				precedence: 'default',
			}

			replacement = `{\n\tmode: 'embed',\n\tstyles: ${JSON.stringify(styles)},\n\tstyleProps: ${JSON.stringify(styleProps)}\n}`
		}

		magic.overwrite(node.start, node.end, replacement)
	}

	const template = magic.toString()

	const map = magic.hasChanged()
		? magic.generateMap({ source: id, includeContent: true, hires: true })
		: null

	const result: CollectResult = {
		source,
		config: configKey,
		template,
		tags,
		tagNames,
		sheets,
		map,
	}

	collectCache.set(id, result)

	return result
}

// `'use client'` is the supported case. `'use server'` is preserved defensively; injecting an
// import before a directive invalidates it, even if CSS in a server-action module is unlikely
const USE_DIRECTIVE =
	/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use (?:client|server)\1;?/

/**
 * Insert style imports after any leading module directive.
 */
export function injectStyleImports(template: string, imports: string[]) {
	if (!imports.length) return template

	const insertAt = USE_DIRECTIVE.exec(template)?.[0].length ?? 0
	const lines = imports
		.map(specifier => `import ${JSON.stringify(specifier)};`)
		.join('\n')

	return `${template.slice(0, insertAt)}\n${lines}\n${template.slice(insertAt)}`
}
