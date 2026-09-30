import type { AsyncSubscription, Event } from '@parcel/watcher'
import type { NextConfig } from 'next'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PluginConfig } from '../types.js'
import { collect, refreshFile, seedTypes, writeTypesForFile } from '../build.js'
import { GENERATED_DIR } from '../config.js'
import { Logger } from '../logger.js'

const typeLogger = new Logger('cxx')

const nextDir = path.dirname(fileURLToPath(import.meta.url))
const loader = path.join(nextDir, 'cxx-loader.cjs')

// keep the exact file inputs and their config so a single recursive watcher can filter events
const watchedFiles = new Map<string, { pluginConfig: PluginConfig; logger: Logger }>()

let subscription: AsyncSubscription | null = null
let subscriptionPromise: Promise<void> | null = null
let cleanupRegistered = false
let watcherLogger: Logger | null = null

// a single recursive watch avoids overlapping per-directory watchers; ignore the parts of the
// tree that never contain source we transform
const DEFAULT_IGNORE = [
	'**/node_modules/**',
	'**/.next/**',
	`**/${GENERATED_DIR}/**`,
	'**/.git/**',
]

async function onEvent(event: Event['type'], filePath: string) {
	const watched = watchedFiles.get(filePath)
	if (!watched) return

	const { pluginConfig, logger } = watched

	if (event === 'delete') {
		await writeTypesForFile(filePath, new Map())
	} else {
		await refreshFile(filePath, pluginConfig)
	}

	logger.info(`updated types from ${filePath}`)
}

/**
 * Start the watcher lazily, on the first file we actually process, so merely importing this module
 * has no side effects.
 */
function ensureWatcher(pluginConfig: PluginConfig, logger: Logger) {
	watcherLogger = logger

	if (subscriptionPromise) return

	const root = pluginConfig.watch?.root ?? process.cwd()

	subscriptionPromise = (async () => {
		// lazily imported so the native module is only loaded when watching is needed
		const { subscribe } = await import('@parcel/watcher')

		subscription = await subscribe(
			root,
			(watchErr, events) => {
				if (watchErr) {
					watcherLogger?.error(`failed to watch ${root}`, watchErr)

					return
				}

				for (const event of events) {
					const filePath = path.resolve(event.path)
					if (!watchedFiles.has(filePath)) continue

					void onEvent(event.type, filePath).catch(err => {
						watcherLogger?.error(`failed to update types from ${filePath}`, err)
					})
				}
			},
			{ ignore: DEFAULT_IGNORE },
		)

		registerCleanup()
	})().catch(err => {
		watcherLogger?.error('failed to start cxx watcher', err)
		subscriptionPromise = null
	})
}

/**
 * Close all active Parcel subscriptions.
 */
async function cleanup() {
	const active = subscription

	subscription = null
	subscriptionPromise = null
	watchedFiles.clear()

	if (active) await active.unsubscribe()
}

/**
 * Restore the host process's default signal behaviour instead of forcing an exit from a library.
 */
async function shutdown(signal: NodeJS.Signals) {
	try {
		await cleanup()
	} finally {
		// our `once` handlers have already been removed, so re-raising lets Node terminate as usual
		process.kill(process.pid, signal)
	}
}

function registerCleanup() {
	if (cleanupRegistered) return

	cleanupRegistered = true
	process.once('SIGINT', () => void shutdown('SIGINT'))
	process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

/**
 * Transform one module and, in development, register it with the shared watcher state.
 */
export function processFile(
	source: string,
	filePath: string,
	pluginConfig: PluginConfig,
	logger: Logger,
) {
	const resolvedFilePath = path.resolve(filePath)

	// skip files that cannot contain a template, including node_modules
	if (!source.includes('cxx') || /[\\/]node_modules[\\/]/.test(resolvedFilePath)) {
		return { template: source, tags: new Map(), map: null }
	}

	if (process.env['NODE_ENV'] !== 'production') {
		watchedFiles.set(resolvedFilePath, { pluginConfig, logger })
		ensureWatcher(pluginConfig, logger)
	}

	const result = collect(source, resolvedFilePath, pluginConfig)

	void writeTypesForFile(resolvedFilePath, result.tags)

	return result
}

const TURBOPACK_GLOB = '*.{tsx,jsx,ts,js}'

export function withCxx(nextConfig: NextConfig = {}, pluginConfig: PluginConfig = {}) {
	const watchRoot =
		pluginConfig.watch?.root ?? nextConfig.turbopack?.root ?? process.cwd()

	// Seed on dev startup only, matching Vite. A production build is covered by the loader, and
	// `next start` must not scan or write at runtime.
	if (process.env['NODE_ENV'] !== 'production') {
		// the app directory, not the whole Turbopack root, so sibling apps in a monorepo do not
		// leak into this app's types
		const seedRoot = pluginConfig.watch?.root ?? process.cwd()

		void seedTypes(seedRoot, pluginConfig).catch(err =>
			typeLogger.error('failed to seed cxx types', err),
		)
	}

	const loaderItem = {
		loader,
		options: {
			pluginConfig: {
				...pluginConfig,
				watch: { ...pluginConfig.watch, root: watchRoot },
			},
		},
	}

	const currentRule = nextConfig.turbopack?.rules?.[TURBOPACK_GLOB]
	const userWebpack = nextConfig.webpack

	return {
		...nextConfig,
		turbopack: {
			...nextConfig.turbopack,
			rules: {
				...nextConfig.turbopack?.rules,
				[TURBOPACK_GLOB]: Array.isArray(currentRule)
					? [...currentRule, loaderItem]
					: currentRule
						? {
								...currentRule,
								loaders: [...(currentRule.loaders ?? []), loaderItem],
							}
						: { loaders: [loaderItem] },
			},
		},
		// webpack builds (Next without `--turbopack`) would otherwise silently skip the transform
		webpack(config: unknown, context: unknown) {
			const next = (
				userWebpack ? userWebpack(config as never, context as never) : config
			) as {
				module?: { rules?: unknown[] }
			}

			next.module ??= {}
			next.module.rules ??= []
			next.module.rules.push({
				test: /\.[jt]sx?$/,
				exclude: /node_modules/,
				enforce: 'pre',
				use: [loaderItem],
			})

			return next
		},
	}
}
