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

export function inject(source: string, id: string) {
	const clsMap = new Map()

	const code = source.replace(varMatch, (_: string, ...args: string[]) => {
		const [varOne, varTwo, varThree, tmpl] = args

		const css = tmpl.replace(clsMatch, (_: string, cls: string) => {
			const hashedCls = `cxx-${cyrb53(`${cls}${id.replace(/\.[^/.]+$/, '')}`)}`
			clsMap.set(cls, hashedCls)

			return `.${hashedCls} {`
		})

		const classes = Object.fromEntries(clsMap)
		const href = cyrb53([...Object.keys(classes), id].join(''))

		return `const ${varOne} = ${JSON.stringify(classes)}\nconst ${varTwo} = \`${css}\`\nconst ${varThree} = \`${href}\``
	})

	return code
}
