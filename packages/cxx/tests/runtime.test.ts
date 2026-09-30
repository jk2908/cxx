import { describe, expect, it } from 'vitest'

import { cxx } from '../src/index.js'

describe('runtime placeholder', () => {
	it('throws when a cxx template reaches runtime untransformed', () => {
		expect(() => cxx`color: red`).toThrow(/not transformed/)
	})

	it('throws when a tagged cxx template reaches runtime untransformed', () => {
		expect(() => cxx.tag('hero')`color: red`).toThrow(/not transformed/)
	})
})
