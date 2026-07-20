import type { AsyncSubscription, Event } from '@parcel/watcher'
import type { NextConfig } from 'next'

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import watcher from '@parcel/watcher'

import type { Logger } from '../logger.js'
import type { PluginConfig, Tags } from '../types.js'
import { collect, flattenTags, isENOENT, writeTypes } from '../index.js'

const nextDir = path.dirname(fileURLToPath(import.meta.url))
const loader = path.join(nextDir, 'cxx-loader.cjs')

// keep the latest extracted tags per file so one edit can rebuild the full type surface
const tagsByFile: Map<string, Tags> = new Map()

// directory watches are shared, but rebuilds still need the file's config and logger
const watchedFiles = new Map<string, { pluginConfig: PluginConfig; logger: Logger }>()
const subscriptionsByDir = new Map<string, Promise<AsyncSubscription>>()

/**
 * Rebuild the generated type surface for one watched file after a Parcel event
 */
async function rebuildFile(filePath: string, event: Event['type']) {
	const watchedFile = watchedFiles.get(filePath)
	if (!watchedFile) return

	const { pluginConfig, logger } = watchedFile
	const hadTags = tagsByFile.has(filePath)

	if (event === 'delete') {
		tagsByFile.delete(filePath)
		if (!hadTags) return

		await writeTypes(flattenTags(tagsByFile))
		logger.info(`updated types from ${filePath}`)

		return
	}

	try {
		const source = await fs.readFile(filePath, 'utf-8')
		const { tags } = collect(source, filePath, pluginConfig)
		const hasTags = tags.size > 0

		if (hasTags) {
			tagsByFile.set(filePath, tags)
		} else {
			tagsByFile.delete(filePath)
		}

		if (!hadTags && !hasTags) return

		await writeTypes(flattenTags(tagsByFile))
		logger.info(`updated types from ${filePath}`)
	} catch (err) {
		if (!isENOENT(err)) throw err
		if (!hadTags) return

		tagsByFile.delete(filePath)
		await writeTypes(flattenTags(tagsByFile))

		logger.info(`updated types from ${filePath}`)
	}
}

/**
 * Transform one module and, in development, register it with the shared watcher state
 */
export function processFile(
	source: string,
	filePath: string,
	pluginConfig: PluginConfig,
	logger: Logger,
) {
	const resolvedFilePath = path.resolve(filePath)
	const directoryPath = path.dirname(resolvedFilePath)
	let subscription = subscriptionsByDir.get(directoryPath)

	if (process.env.NODE_ENV !== 'production') {
		// Parcel watches directories, so remember the exact file inputs we care about
		watchedFiles.set(resolvedFilePath, { pluginConfig, logger })

		if (!subscription) {
			// one subscription per directory is enough; the callback filters back down to watched files
			subscription = watcher.subscribe(directoryPath, async (err, events) => {
				if (err) {
					logger.error(`failed to update types from ${directoryPath}`, err)
					return
				}

				// Parcel can report unrelated files from the same directory, so ignore anything unregistered
				for (const event of events) {
					const eventFilePath = path.resolve(event.path)
					if (!watchedFiles.has(eventFilePath)) continue

					try {
						await rebuildFile(eventFilePath, event.type)
					} catch (watchErr) {
						logger.error(`failed to update types from ${eventFilePath}`, watchErr)
					}
				}
			})

			subscriptionsByDir.set(directoryPath, subscription)
		}
	}

	const result = collect(source, filePath, pluginConfig)

	if (result.tags.size > 0) {
		tagsByFile.set(filePath, result.tags)
	} else {
		tagsByFile.delete(filePath)
	}

	void writeTypes(flattenTags(tagsByFile))

	return result
}

/**
 * Close all active Parcel subscriptions before the process exits
 */
async function cleanup() {
	await Promise.all(
		[...subscriptionsByDir].map(async ([directoryPath, subPromise]) => {
			subscriptionsByDir.delete(directoryPath)
			await (await subPromise).unsubscribe()
		}),
	)

	subscriptionsByDir.clear()
}

process.once('SIGINT', () => {
	cleanup().finally(() => process.exit(130))
})

process.once('SIGTERM', () => {
	cleanup().finally(() => process.exit(143))
})

export async function withCxx(
	nextConfig: NextConfig = {},
	pluginConfig: PluginConfig = {},
) {
	const TURBOPACK_GLOB = '*.{tsx,jsx,ts,js}'

	const loaderItem = {
		loader,
		options: {
			pluginConfig,
		},
	}

	const currentRule = nextConfig.turbopack?.rules?.[TURBOPACK_GLOB]

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
	}
}
