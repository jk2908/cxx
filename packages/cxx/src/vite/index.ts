import { realpathSync } from 'node:fs'
import path from 'node:path'

import { type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite'

import type { PluginConfig } from '../types.js'
import {
	collect,
	flushStyles,
	flushTypes,
	refreshFile,
	seedTypes,
	SOURCE_EXTENSIONS,
	writeStylesForFile,
	writeTypesForFile,
} from '../build.js'
import { GENERATED_DIR } from '../config.js'
import { Logger } from '../logger.js'

type WatchEvent = 'add' | 'change' | 'unlink'

function normaliseWatchPath(p: string) {
	return p.replace(/\\/g, '/')
}

export default function cxx(pluginConfig: PluginConfig = {}) {
	const logger = new Logger()

	// resolved from Vite's root in `configResolved`, not from `process.cwd()`
	let watchRoot = normaliseWatchPath(process.cwd())
	let seeded = false

	// realpath is synchronous, so cache it per directory to keep it off the transform hot path
	const realpaths = new Map<string, string>()

	function resolveWatchFile(filePath: string) {
		const absolutePath = path.resolve(watchRoot, filePath)
		const parentPath = path.dirname(absolutePath)

		let resolvedParentPath = realpaths.get(parentPath)

		if (resolvedParentPath === undefined) {
			try {
				resolvedParentPath = normaliseWatchPath(realpathSync.native(parentPath))
			} catch {
				resolvedParentPath = normaliseWatchPath(parentPath)
			}

			realpaths.set(parentPath, resolvedParentPath)
		}

		return normaliseWatchPath(path.join(resolvedParentPath, path.basename(absolutePath)))
	}

	/**
	 * Returns the canonical, watchable path, or null when the file is irrelevant.
	 */
	function watchedFile(filePath: string) {
		const resolvedPath = resolveWatchFile(filePath)

		if (
			resolvedPath.startsWith(`${watchRoot}/`) &&
			!resolvedPath.includes(`/${GENERATED_DIR}/`) &&
			SOURCE_EXTENSIONS.has(path.extname(resolvedPath))
		) {
			return resolvedPath
		}

		return null
	}

	async function handleEvent(event: WatchEvent, file: string) {
		if (event === 'unlink') {
			await Promise.all([
				writeTypesForFile(file, new Map()),
				writeStylesForFile(file, [], watchRoot),
			])
		} else {
			await refreshFile(file, pluginConfig, watchRoot)
		}

		logger.info(`updated types and styles from ${file}`)
	}

	function onWatch(event: WatchEvent) {
		return (p: string) => {
			const file = watchedFile(p)
			if (!file) return

			void handleEvent(event, file).catch(err => {
				logger.error(`failed to update metadata from ${file}`, err)
			})
		}
	}

	async function seed() {
		if (seeded) return
		seeded = true

		await seedTypes(watchRoot, pluginConfig)
	}

	return {
		name: 'cxx',
		enforce: 'pre',
		configResolved(config: ResolvedConfig) {
			const root = pluginConfig.watch?.root ?? config.root

			try {
				watchRoot = normaliseWatchPath(realpathSync.native(root))
			} catch {
				watchRoot = normaliseWatchPath(root)
			}

			realpaths.clear()
		},
		async buildStart() {
			await seed()
		},
		transform(code, id) {
			if (id.startsWith('\0') || id.includes('/node_modules/')) return null
			// cheap bail-out before running the regex/lightningcss on every module
			if (!code.includes('cxx')) return null

			const cleanId = id.split('?')[0]

			if (!SOURCE_EXTENSIONS.has(path.extname(cleanId))) return null

			const { template, tags, styles, map } = collect(code, cleanId, pluginConfig)

			if (template === code) return null

			const file = resolveWatchFile(cleanId)

			void writeTypesForFile(file, tags)
			void writeStylesForFile(file, styles, watchRoot)

			return {
				code: template,
				map,
			}
		},
		configureServer(server: ViteDevServer) {
			logger.info('Watching for changes...')

			server.watcher
				.on('add', onWatch('add'))
				.on('change', onWatch('change'))
				.on('unlink', onWatch('unlink'))
		},
		async writeBundle() {
			await Promise.all([flushTypes(), flushStyles(watchRoot)])
		},
	} satisfies Plugin
}
