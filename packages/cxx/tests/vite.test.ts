import { describe, expect, it } from 'vitest'

import cxx from '../src/vite/index.js'

type VitePluginDouble = {
	config: (
		config: Record<string, unknown>,
		env: { command: string; mode: string },
	) => { server?: { watch?: { ignored?: string[] } } } | null
	transform: (code: string, id: string) => unknown
}

function plugin(config = {}) {
	return cxx(config) as unknown as VitePluginDouble
}

describe('vite plugin', () => {
	const env = { command: 'serve', mode: 'development' }

	it('adds custom watch globs through the config hook', () => {
		const partial = plugin({ watch: { ignore: ['**/*.test.ts'] } }).config({}, env)

		expect(partial?.server?.watch?.ignored).toEqual(['**/*.test.ts'])
	})

	it('leaves the config untouched when no ignore globs are set', () => {
		expect(plugin().config({}, env)).toBeNull()
	})

	it('bails out of transform for modules without cxx', () => {
		expect(plugin().transform('const a = 1', '/src/App.tsx')).toBeNull()
	})
})
