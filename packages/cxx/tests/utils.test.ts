import { describe, expect, it, vi } from 'vitest'

import { createBatcher } from '../src/utils.js'

function createResolvable() {
	let resolve: (() => void) | undefined
	const promise = new Promise<void>(r => {
		resolve = r
	})

	return {
		promise,
		resolve: () => resolve?.(),
	}
}

describe('createBatcher', () => {
	it('processes every distinct key queued within the debounce window', async () => {
		vi.useFakeTimers()

		const flush = vi.fn()
		const batcher = createBatcher<string, string>(75, flush)

		batcher.add('a', 'change')
		await vi.advanceTimersByTimeAsync(20)
		batcher.add('b', 'change')

		await vi.advanceTimersByTimeAsync(75)

		expect(flush).toHaveBeenCalledTimes(1)
		expect([...flush.mock.calls[0]![0].keys()].toSorted()).toEqual(['a', 'b'])

		vi.useRealTimers()
	})

	it('drains changes that arrive during a flush instead of dropping or re-running them', async () => {
		vi.useFakeTimers()

		const calls: string[] = []
		const gate = createResolvable()

		const batcher = createBatcher<string, string>(75, async batch => {
			for (const [key] of batch) {
				calls.push(key)
				if (key === 'a') await gate.promise
			}
		})

		batcher.add('a', 'change')

		// let the first batch start and block on the gate
		await vi.advanceTimersByTimeAsync(75)

		// b arrives while a is still being processed
		batcher.add('b', 'change')

		gate.resolve()
		await vi.advanceTimersByTimeAsync(150)

		expect(calls).toEqual(['a', 'b'])

		vi.useRealTimers()
	})
})
