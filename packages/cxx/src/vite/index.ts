import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { type Plugin, type ViteDevServer } from 'vite'

import type { BuildContext, PluginConfig } from '../types.js'
import { GENERATED_DIR } from '../config.js'
import { collect, flattenTags, isENOENT, writeTypes } from '../index.js'
import { Logger } from '../logger.js'
import { debounce } from '../utils.js'

const ACCEPTED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

function normaliseWatchPath(p: string) {
	return p.replace(/\\/g, '/')
}

export default function cxx(pluginConfig: PluginConfig = {}) {
	const buildContext = {
		tagsByFile: new Map(),
	} satisfies BuildContext

	const logger = new Logger(
		(pluginConfig?.logger?.level ?? process.env.NODE_ENV === 'production')
			? 'error'
			: 'debug',
	)

	// write generated files into a hidden folder at the project root
	// keep the generated surface out of src
	const watchRoot = normaliseWatchPath(realpathSync.native(process.cwd()))
	const watchedRoots = [`${watchRoot}/`]

	let rebuildRunning = false
	let rebuildQueued = false

	// watcher events can arrive through symlinked paths like /var while cwd has
	// already resolved to /private/var, so canonicalise the parent dir once and
	// reattach the file name for stable prefix checks
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

	function watchedFile(filePath: string) {
		const resolvedPath = resolveWatchFile(filePath)

		return (
			watchedRoots.some(root => resolvedPath.startsWith(root)) &&
			!resolvedPath.includes(`/${GENERATED_DIR}/`) &&
			ACCEPTED_EXTENSIONS.has(path.extname(resolvedPath))
		)
	}

	const rebuild = debounce((event: 'add' | 'change' | 'unlink', filePath: string) => {
		function queue() {
			void (async () => {
				// collapse bursts of file events into one active rebuild plus a single
				// queued rerun when changes land mid-build
				if (rebuildRunning) {
					rebuildQueued = true
					return
				}

				rebuildRunning = true

				do {
					rebuildQueued = false

					try {
						const hadTags = buildContext.tagsByFile.has(file)
						let hasTags = false

						if (event === 'unlink') {
							buildContext.tagsByFile.delete(file)
						} else {
							const source = await fs.readFile(file, 'utf-8')
							const { tags } = collect(source, file, pluginConfig)

							hasTags = tags.size > 0

							if (hasTags) {
								buildContext.tagsByFile.set(file, tags)
							} else {
								buildContext.tagsByFile.delete(file)
							}
						}

						if (!hadTags && !hasTags) continue

						await writeTypes(flattenTags(buildContext.tagsByFile))
						logger.info(`updated types from ${file}`)
					} catch (err) {
						if (isENOENT(err)) {
							if (!buildContext.tagsByFile.has(file)) continue

							buildContext.tagsByFile.delete(file)
							await writeTypes(flattenTags(buildContext.tagsByFile))

							logger.info(`updated types from ${file}`)

							continue
						}

						logger.error(`failed to update types from ${file}`, err)
					}
				} while (rebuildQueued)

				rebuildRunning = false
			})()
		}

		// ignore anything outside the watched content dirs
		if (!watchedFile(filePath)) return

		const file = resolveWatchFile(filePath)
		queue()
	}, 75)

	return {
		name: 'cxx',
		enforce: 'pre',
		transform(code, id) {
			const { template, tags } = collect(code, id, pluginConfig)

			if (tags.size) buildContext.tagsByFile.set(id, tags)

			return {
				code: template,
				map: null,
			}
		},
		configureServer(server: ViteDevServer) {
			logger.info('Watching for changes...')

			server.watcher
				.on('add', (p: string) => rebuild('add', p))
				.on('change', (p: string) => rebuild('change', p))
				.on('unlink', (p: string) => rebuild('unlink', p))
		},
		async writeBundle() {
			await writeTypes(flattenTags(buildContext.tagsByFile))
		},
	} satisfies Plugin
}
