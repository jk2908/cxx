import path from 'node:path'

import type { Configuration } from 'webpack'
import type { NextConfig } from 'next'
import type { WebpackConfigContext } from 'next/dist/server/config-shared'

import type { Config } from '../inject'

export function withCxx(nextConfig: NextConfig = {}, config: Config = {}) {
	const pkg = require('next/package.json')

	const IS_CANARY = pkg.version?.includes('canary') ?? false
	const IS_TURBO = process.env.TURBOPACK === '1'
	const TURBO_GLOB = '*.{tsx,jsx,ts,js}'

	const loader = path.resolve(__dirname, `cxx-loader.${IS_TURBO ? 'cjs' : 'js'}`)

	const turboConfig = {
		...nextConfig.turbo,
		rules: {
			...(nextConfig.turbo?.rules ?? {}),
			[TURBO_GLOB]: {
				loaders: [
					...(nextConfig.turbo?.rules?.[TURBO_GLOB]?.loaders ?? []),
					{
						loader,
						options: config,
					},
				],
			},
		},
	}

	return {
		...nextConfig,
		webpack(conf: Configuration, options: WebpackConfigContext) {
			const resolvedWebpackConfig = (
				typeof nextConfig?.webpack === 'function' ? nextConfig?.webpack(conf, options) : conf
			) satisfies Configuration

			resolvedWebpackConfig?.module?.rules?.push({
				test: /\.(js|jsx|ts|tsx)$/,
				exclude: /node_modules/,
				use: {
					loader,
					options: config,
				},
			})

			return resolvedWebpackConfig
		},
		...(IS_CANARY
			? { experimental: { ...nextConfig?.experimental, turbo: turboConfig } }
			: { turbo: turboConfig }),
	}
}
