import path from 'node:path'

import type { Configuration } from 'webpack'
import type { NextConfig } from 'next'
import type { WebpackConfigContext } from 'next/dist/server/config-shared'

import type { Config } from '../inject'

export function withCxx(nextConfig: NextConfig = {}, config?: Config) {
	const IS_CANARY = require('next/package.json').version?.includes('canary') ?? false
	const CXX_LOADER = path.resolve(__dirname, 'cxx-loader.js')

	const turbo = {
		...nextConfig.turbo,
		rules: {
			...(nextConfig.turbo?.rules ?? {}),
			'./app/**/*.tsx': {
				loaders: [CXX_LOADER],
				as: './tsx',
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
					loader: CXX_LOADER,
					options: {
						...config,
					},
				},
			})

			return resolvedWebpackConfig
		},
		...(IS_CANARY ? { experimental: turbo } : { turbo }),
	}
}
