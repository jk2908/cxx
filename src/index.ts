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
const clsMatch = /\.([a-zA-Z][a-zA-Z0-9]*)\s*{/g

type Config<C extends CustomAtRules> = {
	process: 'lightningcss' | false | undefined
	lightningcss: TransformOptions<C>
}

export function inject(source: string, id: string, config?: Config<CustomAtRules>) {
	const { process, lightningcss } = config ?? {
		process: 'lightningcss',
		lightningcss: {
			filename: id,
			minify: true,
		},
	}

	const decoder = new TextDecoder('utf-8')
	const clsMap = new Map()

	try {
		const code = source.replace(varMatch, (_: string, ...args: string[]) => {
			const [varOne, varTwo, varThree, tmpl] = args

			let css = tmpl.replace(clsMatch, (_: string, cls: string) => {
				const hashedCls = `cxx-${cyrb53(`${cls}${id.replace(/\.[^/.]+$/, '')}`)}`
				clsMap.set(cls, hashedCls)

				return `.${hashedCls} {`
			})

			css =
				process === 'lightningcss' && lightningcss
					? decoder.decode(transform({ ...lightningcss, code: Buffer.from(css) }).code)
					: css

			const classes = Object.fromEntries(clsMap)
			const href = cyrb53([...Object.keys(classes), id].join(''))

			return `const ${varOne} = ${JSON.stringify(classes)}\nconst ${varTwo} = \`${css}\`\nconst ${varThree} = \`${href}\``
		})

		return code
	} catch (err) {
		console.error('cxx error :(', err)
		return source
	}
}
