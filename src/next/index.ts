import path from 'node:path'

import type { Configuration } from 'webpack'
import type { NextConfig } from 'next'
import type { WebpackConfigContext } from 'next/dist/server/config-shared'

export function withCxx(nextConfig: NextConfig) {
	return {
		...nextConfig,
		webpack(conf: Configuration, options: WebpackConfigContext) {
			const config = (
				typeof nextConfig.webpack === 'function' ? nextConfig.webpack(conf, options) : conf
			) satisfies Configuration

			config?.module?.rules?.push({
				test: /\.(js|jsx|ts|tsx)$/,
				exclude: /node_modules/,
				use: {
					loader: path.resolve(__dirname, 'cxx-loader.js'),
				},
			})

			return config
		},
	}
}
