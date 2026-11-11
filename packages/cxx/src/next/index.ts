import type { NextConfig } from 'next'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PluginConfig } from '../types.js'
import { Artifacts } from '../artifacts.js'
import { Logger } from '../logger.js'
import { collect, injectStyleImports } from '../transform.js'

const logger = new Logger('cxx')

const nextDir = path.dirname(fileURLToPath(import.meta.url))
const loader = path.join(nextDir, 'cxx-loader.cjs')

// loaders can run in worker processes, so each one keeps its own artifact state
let loaderArtifacts: Artifacts

/**
 * Transform one module and persist its manifest. The next flush drops manifests whose source is
 * gone, so deleted files do not linger in the generated types or sheets.
 */
export function processFile(
	source: string,
	filePath: string,
	projectRoot: string,
	pluginConfig: PluginConfig,
) {
	const resolvedFilePath = path.resolve(filePath)

	// skip files that cannot contain a template, including node_modules
	if (!source.includes('cxx') || /[\\/]node_modules[\\/]/.test(resolvedFilePath)) {
		return { template: source, tags: new Map(), map: null }
	}

	// Turbopack runs loaders in separate processes, so this instance may be distinct from the one
	// `withCxx` seeded. It only flushes types, sheet sweeps stay with the seed/build process
	loaderArtifacts ??= new Artifacts(projectRoot)

	const result = collect(source, resolvedFilePath, pluginConfig)
	const imports = loaderArtifacts.write(
		resolvedFilePath,
		result.tags,
		result.sheets,
		result.tagNames,
	)
	const template = injectStyleImports(result.template, imports)

	return { ...result, template }
}

type WebpackConfig = { module?: { rules?: unknown[] } }

const TURBOPACK_GLOB = '*.{tsx,jsx,ts,js}'

export function withCxx(nextConfig: NextConfig = {}, pluginConfig: PluginConfig = {}) {
	// the Next app directory is the project root the generated artifacts belong to
	const artifacts = new Artifacts(process.cwd())

	if (process.env['NODE_ENV'] !== 'production') {
		const seedRoot = pluginConfig.watch?.root ?? process.cwd()

		void artifacts.seed(seedRoot, pluginConfig).catch(err => {
			logger.error('failed to seed cxx artifacts', err)
		})
	}

	const loaderItem = {
		loader,
		options: {
			projectRoot: artifacts.root,
			pluginConfig,
		},
	}

	const currentRule = nextConfig.turbopack?.rules?.[TURBOPACK_GLOB]
	const rule = Array.isArray(currentRule)
		? [...currentRule, loaderItem]
		: { ...currentRule, loaders: [...(currentRule?.loaders ?? []), loaderItem] }
	const userWebpack = nextConfig.webpack

	return {
		...nextConfig,
		turbopack: {
			...nextConfig.turbopack,
			rules: {
				...nextConfig.turbopack?.rules,
				[TURBOPACK_GLOB]: rule,
			},
		},
		// webpack builds (Next without `--turbopack`) would otherwise silently skip the transform
		webpack(config: unknown, context: unknown) {
			const next = (userWebpack?.(config as never, context as never) ??
				config) as WebpackConfig

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
