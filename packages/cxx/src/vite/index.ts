import { realpathSync } from 'node:fs'
import path from 'node:path'

import { type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite'

import type { PluginConfig } from '../types.js'
import { Artifacts } from '../artifacts.js'
import { GENERATED_DIR, SOURCE_EXTENSIONS } from '../config.js'
import { Logger } from '../logger.js'
import { collect, injectStyleImports } from '../transform.js'

function normaliseWatchPath(p: string) {
	return p.replace(/\\/g, '/')
}

export default function cxx(pluginConfig: PluginConfig = {}) {
	const logger = new Logger()

	// resolved from Vite's root in `configResolved`, not from `process.cwd()`
	let watchRoot = normaliseWatchPath(process.cwd())
	let artifacts: Artifacts
	let seeded = false

	function resolveWatchFile(filePath: string) {
		const absolutePath = path.resolve(watchRoot, filePath)
		const parentPath = path.dirname(absolutePath)

		let resolvedParentPath: string

		try {
			resolvedParentPath = normaliseWatchPath(realpathSync.native(parentPath))
		} catch {
			resolvedParentPath = normaliseWatchPath(parentPath)
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

	function onWatch(p: string) {
		const file = watchedFile(p)
		if (!file) return

		// add, change and unlink all update the manifest; a missing file simply loses it
		void artifacts.update(file, pluginConfig).catch(err => {
			logger.error(`failed to update cxx artifacts from ${file}`, err)
		})
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

			// artifacts belong to the project root, not to a wider watch scope
			artifacts = new Artifacts(config.root)
		},
		async buildStart() {
			if (seeded) return
			seeded = true

			await artifacts.seed(watchRoot, pluginConfig)
		},
		transform(code, id) {
			if (id.startsWith('\0') || id.includes('/node_modules/')) return null
			// cheap bail-out before running the regex/lightningcss on every module
			if (!code.includes('cxx')) return null

			const cleanId = id.split('?')[0]

			if (!SOURCE_EXTENSIONS.has(path.extname(cleanId))) return null

			const result = collect(code, cleanId, pluginConfig)

			if (result.template === code) return null

			const file = resolveWatchFile(cleanId)
			const imports = artifacts.write(file, result.tags, result.sheets)
			const template = injectStyleImports(result.template, imports)

			return {
				code: template,
				map: result.map,
			}
		},
		configureServer(server: ViteDevServer) {
			server.watcher.on('add', onWatch).on('change', onWatch).on('unlink', onWatch)
		},
		async writeBundle() {
			await artifacts.flush({ sweep: true })
		},
	} satisfies Plugin
}
