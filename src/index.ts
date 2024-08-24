import { cyrb53 } from "./cyrb53"

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

const $id = (cls: string, path: string) =>
	`cxx-${cyrb53(`${cls}${path.replace(/\.[^/.]+$/, '')}`)}`

const varMatch = /(?:const|var|let)\s*\[(\w+),\s*(\w+),\s*(\w+)\]\s*=\s*cxx\s*`([\s\S]*?)`/gm
const clsMatch = /\.([a-zA-Z][a-zA-Z0-9]*)\s*{/g

export function inject(source: string, path: string) {
	const clsMap = new Map()

	const code = source.replace(varMatch, (_: string, ...args: string[]) => {
		const [varOne, varTwo, varThree, tmpl] = args

		const css = tmpl.replace(clsMatch, (_: string, cls: string) => {
			const id = $id(cls, path)
			clsMap.set(cls, id)

			return `.${id} {`
		})

		const classes = Object.fromEntries(clsMap)
		const href = cyrb53([...Object.keys(classes), path].join(''))

		return `const ${varOne} = ${JSON.stringify(classes)}\nconst ${varTwo} = \`${css}\`\nconst ${varThree} = \`${href}\``
	})

	return code
}