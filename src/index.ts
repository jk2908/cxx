import { cyrb53 } from './cyrb53'

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
const clsMatch = /\.([a-zA-Z][a-zA-Z0-9]*)\s*{/g

export type Config = {
	minify?: boolean
}

const DEFAULT_CONFIG: Config = {
	minify: true,
} as const

export function inject(source: string, id: string, config: Config = DEFAULT_CONFIG) {
	const { minify } = config
	const clsMap = new Map()

	const code = source.replace(varMatch, (_: string, ...args: string[]) => {
		const [varOne, varTwo, varThree, tmpl] = args

		const css = tmpl.replace(clsMatch, (_: string, cls: string) => {
			const hashedCls = `cxx-${cyrb53(`${cls}${id.replace(/\.[^/.]+$/, '')}`)}`
			clsMap.set(cls, hashedCls)

			return `.${hashedCls} {`
		})

		if (minify) {
			css
				.replace(/\s+/g, ' ')
				.replace(/\s*{\s*/g, '{')
				.replace(/\s*}\s*/g, '}')
				.replace(/;\s*/g, ';')
				.replace(/:\s*/g, ':')
				.trim()
		}

		const classes = Object.fromEntries(clsMap)
		const href = cyrb53([...Object.keys(classes), id].join(''))

		return `const ${varOne} = ${JSON.stringify(classes)}\nconst ${varTwo} = \`${css}\`\nconst ${varThree} = \`${href}\``
	})

	return code
}
