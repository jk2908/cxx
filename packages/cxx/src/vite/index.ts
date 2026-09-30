import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite'

import type { BuildContext, PluginConfig } from '../types.js'
import { collect, flattenTags, isENOENT, writeTypes } from '../build.js'
import { GENERATED_DIR } from '../config.js'
import { Logger } from '../logger.js'
import { createBatcher } from '../utils.js'

const ACCEPTED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

type WatchEvent = 'add' | 'change' | 'unlink'

function normaliseWatchPath(p: string) {
	return p.replace(/\\/g, '/')
}

export default function cxx(pluginConfig: PluginConfig = {}) {
	const buildContext = {
		tagsByFile: new Map(),
	} satisfies BuildContext

	const logger = new Logger()

	// resolved from Vite's root in `configResolved`, not from `process.cwd()`
	let watchRoot = normaliseWatchPath(process.cwd())

	function resolveWatchFile(filePath: string) {
		const absolutePath = path.resolve(watchRoot, filePath)
		const parentPath = path.dirname(absolutePath)

		try {
			const resolvedParentPath = normaliseWatchPath(realpathSync.native(parentPath))

			return normaliseWatchPath(
				path.join(resolvedParentPath, path.basename(absolutePath)),
			)
		} catch {
			return normaliseWatchPath(absolutePath)
		}
	}

	// returns the canonical, watchable path or null when the file is irrelevant
	function watchedFile(filePath: string): string | null {
		const resolvedPath = resolveWatchFile(filePath)

		if (
			resolvedPath.startsWith(`${watchRoot}/`) &&
			!resolvedPath.includes(`/${GENERATED_DIR}/`) &&
			ACCEPTED_EXTENSIONS.has(path.extname(resolvedPath))
		) {
			return resolvedPath
		}

		return null
	}

	async function onEvent(event: WatchEvent, file: string) {
		const hadTags = buildContext.tagsByFile.has(file)

		if (event === 'unlink') {
			if (!hadTags) return

			buildContext.tagsByFile.delete(file)
			await writeTypes(flattenTags(buildContext.tagsByFile))
			logger.info(`updated types from ${file}`)

			return
		}

		let source: string

		try {
			source = await fs.readFile(file, 'utf-8')
		} catch (err) {
			if (!isENOENT(err)) throw err
			if (!hadTags) return

			buildContext.tagsByFile.delete(file)
			await writeTypes(flattenTags(buildContext.tagsByFile))
			logger.info(`updated types from ${file}`)

			return
		}

		const { tags } = collect(source, file, pluginConfig)
		const hasTags = tags.size > 0

		if (hasTags) {
			buildContext.tagsByFile.set(file, tags)
		} else {
			buildContext.tagsByFile.delete(file)
		}

		if (!hadTags && !hasTags) return

		await writeTypes(flattenTags(buildContext.tagsByFile))
		logger.info(`updated types from ${file}`)
	}

	// collect change events that arrive close together and handle each file once.
	// The file path is the key, so changes to different files are all kept, and a
	// change that arrives during a rebuild runs after that rebuild finishes.
	const queue = createBatcher<string, WatchEvent>(75, async batch => {
		for (const [file, event] of batch) {
			try {
				await onEvent(event, file)
			} catch (err) {
				logger.error(`failed to update types from ${file}`, err)
			}
		}
	})

	return {
		name: 'cxx',
		enforce: 'pre',
		config() {
			const ignore = pluginConfig.watch?.ignore
			if (!ignore?.length) return null

			// Vite concatenates `server.watch.ignored`, so only return the additions
			return {
				server: {
					watch: {
						ignored: ignore,
					},
				},
			}
		},
		configResolved(config: ResolvedConfig) {
			const root = pluginConfig.watch?.root ?? config.root

			try {
				watchRoot = normaliseWatchPath(realpathSync.native(root))
			} catch {
				watchRoot = normaliseWatchPath(root)
			}
		},
		transform(code, id) {
			if (id.startsWith('\0') || id.includes('/node_modules/')) return null
			// cheap bail-out before running the regex/lightningcss on every module
			if (!code.includes('cxx')) return null

			const cleanId = id.split('?')[0]
			if (!ACCEPTED_EXTENSIONS.has(path.extname(cleanId))) return null

			const { template, tags, map } = collect(code, cleanId, pluginConfig)
			if (template === code) return null

			const resolved = resolveWatchFile(cleanId)

			if (tags.size) {
				buildContext.tagsByFile.set(resolved, tags)
			} else {
				buildContext.tagsByFile.delete(resolved)
			}

			return {
				code: template,
				map,
			}
		},
		configureServer(server: ViteDevServer) {
			logger.info('Watching for changes...')

			server.watcher
				.on('add', (p: string) => {
					const file = watchedFile(p)
					if (file) queue.add(file, 'add')
				})
				.on('change', (p: string) => {
					const file = watchedFile(p)
					if (file) queue.add(file, 'change')
				})
				.on('unlink', (p: string) => {
					const file = watchedFile(p)
					if (file) queue.add(file, 'unlink')
				})
		},
		async writeBundle() {
			await writeTypes(flattenTags(buildContext.tagsByFile))
		},
	} satisfies Plugin
}
