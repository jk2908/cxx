import path from 'node:path'

import type { Configuration } from 'webpack'
import type { NextConfig } from 'next'
import type { WebpackConfigContext } from 'next/dist/server/config-shared'

import type { Config } from '../inject'

export function withCxx(nextConfig: NextConfig = {}, config?: Config) {
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
					loader: path.resolve(__dirname, 'cxx-loader.js'),
					options: {
						...config,
					},
				},
			})

			return resolvedWebpackConfig
		},
		turbo: {
			...nextConfig.turbo,
			rules: {
				...(nextConfig.turbo?.rules ?? {}),
				'./app/**/*.tsx': {
					loaders: [path.resolve(__dirname, 'cxx-loader.js')],
					as: './tsx',
				},
			},
		},
	}
}
