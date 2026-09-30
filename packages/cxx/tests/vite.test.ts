import { describe, expect, it } from 'vitest'

import cxx from '../src/vite/index.js'

type VitePluginDouble = {
	transform: (code: string, id: string) => unknown
}

function plugin(config = {}) {
	return cxx(config) as unknown as VitePluginDouble
}

describe('vite plugin', () => {
	it('bails out of transform for modules without cxx', () => {
		expect(plugin().transform('const a = 1', '/src/App.tsx')).toBeNull()
	})

	it('bails out of transform for node_modules', () => {
		expect(plugin().transform('cxx`.a{}`', '/src/node_modules/x/index.js')).toBeNull()
	})

	it('bails out of transform for virtual modules', () => {
		expect(plugin().transform('cxx`.a{}`', '\0virtual:thing')).toBeNull()
	})
})
