import { describe, expect, it, vi } from 'vitest'

import { Logger } from '../src/logger.js'

describe('Logger', () => {
	it('defaults to the info level outside production', () => {
		expect(new Logger().level).toBe('info')
	})

	it('drops messages below the active level', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

		try {
			const logger = new Logger()
			logger.level = 'warn'
			logger.info('hidden')
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})
})
