import { cyrb53 } from './cyrb53'

import { type TransformOptions, type CustomAtRules, transform } from 'lightningcss'

const varMatch =
	/(?:const|var|let)\s*\[(\w+|)\s*,?\s*(\w+|)\s*,?\s*(\w+|)\s*\]\s*=\s*cxx\s*`([\s\S]*?)`/gm

export type Config<C extends CustomAtRules = CustomAtRules> = {
	lightningcss?: Partial<TransformOptions<C>>
}

const DEFAULT_CONFIG: Config = {
	lightningcss: {
		minify: true,
		cssModules: true,
	},
} as const

export function inject<C extends CustomAtRules = CustomAtRules>(
	source: string,
	id: string,
	config: Config<C> = {},
) {
	try {
		const tmpl = source.replace(varMatch, (_: string, ...args: string[]) => {
			const [varOne, varTwo, varThree, css] = args

			const { code, exports } = transform({
				...DEFAULT_CONFIG.lightningcss,
				...config.lightningcss,
				filename: id,
				code: Buffer.from(css),
			})

			const href = cyrb53([...Object.keys(exports ?? {}), id].join(''))
			const classes = exports
				? Object.fromEntries(Object.entries(exports).map(([key, value]) => [key, value.name]))
				: {}

			return [
				varOne && `const ${varOne} = \`${code}\``,
				varTwo && `const ${varTwo} = ${JSON.stringify(classes)}`,
				varThree && `const ${varThree} = \`${href}\``,
			]
				.filter(Boolean)
				.join('\n')
		})

		return tmpl
	} catch (err) {
		console.error('cxx error :(', err)
		return source
	}
}
