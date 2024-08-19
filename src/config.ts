import type { Configuration } from 'webpack'
import type { NextConfig } from 'next'
import type { WebpackConfigContext,  } from 'next/dist/server/config-shared'

const $id = (cls: string, path: string) => `${cls}_${path.replace(/\\/g, '/').split('/').pop()?.replace(/\./, '_')}`

function loader(source: string) {
	const varMatch = /(?:const|var|let)\s*\[(\w+),\s*(\w+)\]\s*=\s*c\$\$3\s*`([\s\S]*?)`/gm
	const clsMatch = /\.([a-zA-Z][a-zA-Z0-9]*)\s*{/g

	const map = new Map()

	const code = source.replaceAll(varMatch, (_, ...args) => {
		const [varOne, varTwo, ...rest] = args

		const tmpl = rest.slice(0, -2)
		const strs = tmpl.map(str =>
			str.replace(/^`|`$/g, '').replace(/\\`/g, '`').replace(/\s+/g, ' ').trim(),
		)

		const css = strs.reduce((acc, str) => {			
			const processed = str.replace(clsMatch, (_: string, cls: string) => {
				// @ts-expect-error
				const id = $id(cls, this.resourcePath)
				map.set(cls, id)

				return `.${id} {`
			})

			return `${acc}${processed}`
		}, '')

		return `const ${varOne} = ${JSON.stringify(Object.fromEntries(map))}\nconst ${varTwo} = ${JSON.stringify(css)}`
	})

	return code
}

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
					loader
				},
			})

			return config
		},
	}
}