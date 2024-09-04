import { cyrb53 } from './cyrb53'

import { type TransformOptions, type CustomAtRules, transform } from 'lightningcss'

declare module 'react' {
	interface StyleHTMLAttributes<T> extends React.HTMLAttributes<T> {
		href?: string
		precedence?: 'low' | 'medium' | 'high'
	}
}

export const cxx = (_: TemplateStringsArray): readonly [Record<string, string>, '', ''] => [
	{},
	'',
	'',
]

const varMatch = /(?:const|var|let)\s*\[(\w+),\s*(\w+),\s*(\w+)\]\s*=\s*cxx\s*`([\s\S]*?)`/gm

export type Config = {
	lightningcss?: Partial<TransformOptions<CustomAtRules>>
}

const DEFAULT_CONFIG: Config = {
	lightningcss: {
		minify: true,
		cssModules: true,
	},
} as const

export function inject(source: string, id: string, config: Config = {}) {
	const { lightningcss } = config

	try {
		const tmpl = source.replace(varMatch, (_: string, ...args: string[]) => {
			const [varOne, varTwo, varThree, css] = args

			const { code, exports } = transform({
				...DEFAULT_CONFIG.lightningcss,
				...lightningcss,
				filename: id,
				code: Buffer.from(css),
			})

			const href = cyrb53([...Object.keys(exports ?? {}), id].join(''))
			const classes = exports
				? Object.fromEntries(Object.entries(exports).map(([key, value]) => [key, value.name]))
				: {}

			return `const ${varOne} = ${JSON.stringify(classes)}\nconst ${varTwo} = \`${code}\`\nconst ${varThree} = \`${href}\``
		})

		return tmpl
	} catch (err) {
		console.error('cxx error :(', err)
		return source
	}
}
