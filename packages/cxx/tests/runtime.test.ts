import { describe, expect, it } from 'vitest'

import { cxx } from '../src/index.js'

describe('runtime placeholder', () => {
	it('throws when a cxx template reaches runtime untransformed', () => {
		expect(() => cxx.embed`color: red`).toThrow(/not transformed/)
	})

	it('throws when a tagged cxx template reaches runtime untransformed', () => {
		expect(() => cxx.embed.tag('hero')`color: red`).toThrow(/not transformed/)
	})
})
