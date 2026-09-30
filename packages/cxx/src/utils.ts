export function capitalise(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1)
}

export function pascalise(str: string) {
	return str
		.split(/[ _-]+/)
		.map(capitalise)
		.join('')
}

export type Batcher<K, V> = {
	/**
	 * Queue a value for a key. Queueing the same key again replaces the previous value.
	 */
	add: (key: K, value: V) => void
	/**
	 * Run any waiting work now and resolve once it has finished.
	 */
	flush: () => Promise<void>
}

/**
 * Group bursts of work and run them together. Every key queued within `wait` is
 * included once, and a key queued while a batch is running is handled in the next
 * batch instead of replacing the one in progress.
 */
export function createBatcher<K, V>(
	wait: number,
	flush: (batch: Map<K, V>) => void | Promise<void>,
): Batcher<K, V> {
	// work waiting to run, keyed so each key is only queued once
	const pending = new Map<K, V>()
	// waits for a burst of changes to settle before running
	let timer: ReturnType<typeof setTimeout> | null = null
	// true while a batch is running, so we never start a second one
	let running = false

	async function drain() {
		// a run is already going, so let it pick up the new work
		if (running) return
		running = true

		try {
			// keep looping while there is work, including work added during a flush
			while (pending.size > 0) {
				// snapshot the queued work
				const batch = new Map(pending)
				// empty the queue right away, so anything added during flush waits for the next loop
				pending.clear()

				await flush(batch)
			}
		} finally {
			// always allow the next run, even if flush threw
			running = false
		}
	}

	function schedule() {
		// cancel the previous wait, so the timer restarts from now
		if (timer) clearTimeout(timer)

		// run once the calls stop coming for `wait` ms
		timer = setTimeout(() => {
			// the timer has fired, so drop the stale handle
			timer = null
			// start the run without waiting for it (this is a timer callback)
			void drain()
		}, wait)
	}

	return {
		add(key, value) {
			// the newest value for this key wins
			pending.set(key, value)
			schedule()
		},
		flush() {
			// run now instead of waiting out the timer
			if (timer) {
				clearTimeout(timer)
				timer = null
			}

			return drain()
		},
	}
}
