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
	transforms?: {
		minify?: boolean
	}
}

const DEFAULT_CONFIG: Config = {
	transforms: {
		minify: true,
	}
} as const

export function inject(source: string, id: string, config: Config = {}) {
	const resolvedConfig = { ...DEFAULT_CONFIG, ...config }
	const clsMap = new Map()

	const code = source.replace(varMatch, (_: string, ...args: string[]) => {
		const [varOne, varTwo, varThree, tmpl] = args

		let css = tmpl.replace(clsMatch, (_: string, cls: string) => {
			const hashedCls = `cxx-${cyrb53(`${cls}${id.replace(/\.[^/.]+$/, '')}`)}`
			clsMap.set(cls, hashedCls)

			return `.${hashedCls} {`
		})

		if (resolvedConfig?.transforms?.minify) {
			css = css
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
