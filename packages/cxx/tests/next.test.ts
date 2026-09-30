import { describe, expect, it } from 'vitest'

import { withCxx } from '../src/next/index.js'

type LoaderItem = {
	loader: string
	options: {
		pluginConfig: {
			watch?: {
				root?: string
				ignore?: string[]
			}
		}
	}
}

type TurbopackRule = { loaders?: LoaderItem[] } | LoaderItem[]

type WebpackRule = {
	test: RegExp
	exclude: RegExp
	enforce: string
	use: LoaderItem[]
}

type NextConfigDouble = {
	turbopack: { rules: Record<string, TurbopackRule> }
	webpack: (
		config: { module: { rules: WebpackRule[] } },
		context: unknown,
	) => { module: { rules: WebpackRule[] } }
}

function build(
	nextConfig: Record<string, unknown> = {},
	pluginConfig: Record<string, unknown> = {},
) {
	return withCxx(
		nextConfig as never,
		pluginConfig as never,
	) as unknown as NextConfigDouble
}

describe('withCxx', () => {
	it('returns the config synchronously', () => {
		const config = withCxx({})

		expect(config).not.toBeInstanceOf(Promise)
		expect(config).toBeTypeOf('object')
	})

	it('adds a turbopack loader rule', () => {
		const rule = build().turbopack.rules['*.{tsx,jsx,ts,js}'] as { loaders: LoaderItem[] }

		expect(rule.loaders).toHaveLength(1)
		expect(rule.loaders[0]!.loader).toMatch(/cxx-loader\.cjs$/)
	})

	it('defaults the watch root to the turbopack root', () => {
		const rule = build({ turbopack: { root: '/repo' } }).turbopack.rules[
			'*.{tsx,jsx,ts,js}'
		] as { loaders: LoaderItem[] }

		expect(rule.loaders[0]!.options.pluginConfig.watch?.root).toBe('/repo')
	})

	it('lets an explicit watch config override the turbopack root', () => {
		const rule = build(
			{ turbopack: { root: '/repo' } },
			{ watch: { root: '/app', ignore: ['**/*.test.ts'] } },
		).turbopack.rules['*.{tsx,jsx,ts,js}'] as { loaders: LoaderItem[] }
		const watch = rule.loaders[0]!.options.pluginConfig.watch

		expect(watch?.root).toBe('/app')
		expect(watch?.ignore).toEqual(['**/*.test.ts'])
	})

	it('preserves an existing turbopack rule instead of replacing it', () => {
		const rule = build({ turbopack: { rules: { '*.{tsx,jsx,ts,js}': { loaders: [] } } } })
			.turbopack.rules['*.{tsx,jsx,ts,js}'] as { loaders: LoaderItem[] }

		expect(rule.loaders).toHaveLength(1)
	})

	it('registers a webpack pre-loader and chains to the user webpack config', () => {
		let called = false
		const userWebpack = (webpackConfig: unknown) => {
			called = true

			return webpackConfig
		}

		const out = build({ webpack: userWebpack as never }).webpack(
			{ module: { rules: [] } },
			{},
		)
		const rule = out.module.rules.at(-1)!

		expect(called).toBe(true)
		expect(rule.enforce).toBe('pre')
		expect(rule.use[0]!.loader).toMatch(/cxx-loader\.cjs$/)
	})
})
