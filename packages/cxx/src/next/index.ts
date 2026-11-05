import type { NextConfig } from 'next'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PluginConfig } from '../types.js'
import { collect, seedTypes, writeTypesForFile } from '../build.js'
import { Logger } from '../logger.js'

const typeLogger = new Logger('cxx')

const nextDir = path.dirname(fileURLToPath(import.meta.url))
const loader = path.join(nextDir, 'cxx-loader.cjs')

/**
 * Transform one module and persist its tag types. Deleted files are pruned from the types on the
 * next rebuild, since `readPartials` drops any partial whose source is gone.
 */
export function processFile(
	source: string,
	filePath: string,
	pluginConfig: PluginConfig,
) {
	const resolvedFilePath = path.resolve(filePath)

	// skip files that cannot contain a template, including node_modules
	if (!source.includes('cxx') || /[\\/]node_modules[\\/]/.test(resolvedFilePath)) {
		return { template: source, tags: new Map(), map: null }
	}

	const result = collect(source, resolvedFilePath, pluginConfig)

	void writeTypesForFile(resolvedFilePath, result.tags)

	return result
}

const TURBOPACK_GLOB = '*.{tsx,jsx,ts,js}'

export function withCxx(nextConfig: NextConfig = {}, pluginConfig: PluginConfig = {}) {
	if (process.env['NODE_ENV'] !== 'production') {
		const seedRoot = pluginConfig.watch?.root ?? process.cwd()

		void seedTypes(seedRoot, pluginConfig).catch(err =>
			typeLogger.error('failed to seed cxx types', err),
		)
	}

	const loaderItem = {
		loader,
		options: {
			pluginConfig,
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
