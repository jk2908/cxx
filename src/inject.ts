import { promises as fs } from 'node:fs'
import { cyrb53 } from './cyrb53'

import { type TransformOptions, type CustomAtRules, transform } from 'lightningcss'

const varMatch =
	/(?:const|var|let)\s*\[(\w+|)\s*,?\s*(\w+|)\s*,?\s*(\w+|)\s*\]\s*=\s*cxx\s*`([\s\S]*?)`/gm

type Mode = 'inline' | 'extract'

export type Config<C extends CustomAtRules = CustomAtRules> = {
	mode?: Mode
	lightningcss?: Partial<TransformOptions<C>>
}

const DEFAULT_CONFIG: Config = {
	mode: 'inline',
	lightningcss: {
		minify: true,
		cssModules: true,
	},
} as const

const EXTRACT_DIR = 'cxx' as const

const clean = (str: string) =>
	str
		.split(/[\\/]/)
		.pop()
		?.replace(/\.(?=[^.]*$).*/, '')
		.replace(/\./g, '') ?? ''

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

			const hashed = cyrb53([...Object.keys(exports ?? {}), id].join(''))
			const href =
				config?.mode === 'extract' ? `./${EXTRACT_DIR}/${clean(id)}-${hashed}.css` : `${hashed}`

			const classes = exports
				? Object.fromEntries(Object.entries(exports).map(([key, value]) => [key, value.name]))
				: {}

			if (config?.mode === 'extract') extract(clean(id), href, code)

			return [
				varOne && `const ${varOne} = \`${code}\``,
				varTwo && `const ${varTwo} = \`${href}\``,
				varThree && `const ${varThree} = ${JSON.stringify(classes)}`,
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

async function extract(id: string, href: string, code: Uint8Array) {
	await fs.mkdir(EXTRACT_DIR, { recursive: true })

	const files = await fs.readdir(EXTRACT_DIR)
	const existing = files.filter(f => f.startsWith(id))

	if (existing.length) {
		await Promise.all(existing.map(f => fs.rm(`${EXTRACT_DIR}/${f}`)))
	}

	await fs.writeFile(href, code)
}
