import { realpathSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { type Plugin, type ResolvedConfig, type ViteDevServer } from 'vite'

import type { PluginConfig } from '../types.js'
import {
	collect,
	flushTypes,
	isENOENT,
	takeRebuildError,
	writeTypesForFile,
} from '../build.js'
import { GENERATED_DIR } from '../config.js'
import { Logger } from '../logger.js'
import { createBatcher } from '../utils.js'

const ACCEPTED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

type WatchEvent = 'add' | 'change' | 'unlink'

function normaliseWatchPath(p: string) {
	return p.replace(/\\/g, '/')
}

/** Tiny glob matcher for the ignore patterns we support (`**`, `*`, `?`). */
function globToRegExp(glob: string) {
	const pattern = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*(\/|$)/g, '.*$1')
		.replace(/\*/g, '[^/]*')
		.replace(/\?/g, '[^/]')

	return new RegExp(`^${pattern}$`)
}

export default function cxx(pluginConfig: PluginConfig = {}) {
	const logger = new Logger()

	// resolved from Vite's root in `configResolved`, not from `process.cwd()`
	let watchRoot = normaliseWatchPath(process.cwd())
	const ignored = (pluginConfig.watch?.ignore ?? []).map(globToRegExp)

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

	/** Returns the canonical, watchable path, or null when the file is irrelevant. */
	function watchedFile(filePath: string): string | null {
		const resolvedPath = resolveWatchFile(filePath)

		if (
			resolvedPath.startsWith(`${watchRoot}/`) &&
			!resolvedPath.includes(`/${GENERATED_DIR}/`) &&
			ACCEPTED_EXTENSIONS.has(path.extname(resolvedPath)) &&
			!ignored.some(regexp => regexp.test(resolvedPath))
		) {
			return resolvedPath
		}

		return null
	}

	async function recordFile(file: string) {
		let source: string

		try {
			source = await fs.readFile(file, 'utf-8')
		} catch (err) {
			if (!isENOENT(err)) throw err
			await writeTypesForFile(file, new Map())
			return
		}

		const tags = source.includes('cxx')
			? collect(source, file, pluginConfig).tags
			: new Map()
		await writeTypesForFile(file, tags)
	}

	/**
	 * Seed the type surface from the source tree, so a fresh checkout has types before any file is
	 * transformed or edited.
	 */
	async function scan(dir: string) {
		let entries

		try {
			entries = await fs.readdir(dir, { withFileTypes: true })
		} catch {
			return
		}

		await Promise.all(
			entries.map(async entry => {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') return

				const full = path.join(dir, entry.name)

				if (entry.isDirectory()) {
					await scan(full)
					return
				}

				if (!ACCEPTED_EXTENSIONS.has(path.extname(entry.name))) return

				const resolved = resolveWatchFile(full)
				if (ignored.some(regexp => regexp.test(resolved))) return

				await recordFile(resolved)
			}),
		)
	}

	// collect change events that arrive close together and handle each file once.
	// The file path is the key, so changes to different files are all kept, and a
	// change that arrives during a rebuild runs after that rebuild finishes.
	const queue = createBatcher<string, WatchEvent>(75, async batch => {
		for (const [file, event] of batch) {
			try {
				if (event === 'unlink') {
					await writeTypesForFile(file, new Map())
				} else {
					await recordFile(file)
				}

				logger.info(`updated types from ${file}`)
			} catch (err) {
				logger.error(`failed to update types from ${file}`, err)
			}
		}
	})

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
		},
		transform(code, id) {
			if (id.startsWith('\0') || id.includes('/node_modules/')) return null

			// cheap bail-out before running the regex/lightningcss on every module
			if (!code.includes('cxx')) return null

			const cleanId = id.split('?')[0]

			if (!ACCEPTED_EXTENSIONS.has(path.extname(cleanId))) return null

			const { template, tags, map } = collect(code, cleanId, pluginConfig)

			if (template === code) return null

			void writeTypesForFile(resolveWatchFile(cleanId), tags)

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

			void scan(watchRoot)
				.then(() => flushTypes())
				.then(() => {
					const err = takeRebuildError()
					if (err) logger.error('failed to generate types', err)
				})
				.catch(err => logger.error('failed to scan for cxx templates', err))
		},
		async writeBundle() {
			await flushTypes()
		},
	} satisfies Plugin
}
