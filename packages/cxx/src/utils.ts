function capitalise(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1)
}

export function pascalise(str: string) {
	return str
		.split(/[ _-]+/)
		.map(capitalise)
		.join('')
}

/**
 * Run `fn` for every item, with at most `concurrency` calls in flight.
 */
export async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>,
) {
	let cursor = 0

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			while (cursor < items.length) {
				const index = cursor++
				await fn(items[index])
			}
		},
	)

	await Promise.all(workers)
}
