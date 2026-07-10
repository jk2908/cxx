export const CACHE_MAX_SIZE = 100

export class LruCache<T> {
	#cache: Map<string, T> = new Map()
	#maxSize: number

	constructor(maxSize = CACHE_MAX_SIZE) {
		this.#maxSize = maxSize
	}

	get size() {
		return this.#cache.size
	}

	/**
	 * Retrieve a cached value and promote it to most-recently-used so it won't
	 * be evicted while still actively referenced
	 */
	get(key: string) {
		const cached = this.#cache.get(key)
		if (this.#cache.has(key)) this.set(key, cached as T)

		return cached
	}

	/**
	 * Promote an existing cache entry to most-recently-used by deleting and
	 * re-inserting it, which moves it to the end of the Map's iteration
	 * order. If the cache is at capacity, evict the least recently used
	 * entry (front) before inserting
	 */
	set(key: string, value: T) {
		// drop any existing entry
		this.#cache.delete(key)

		if (this.#cache.size >= this.#maxSize) {
			const lru = this.#cache.keys().next().value
			if (lru !== undefined) this.#cache.delete(lru)
		}

		this.#cache.set(key, value)
	}

	delete(key: string) {
		return this.#cache.delete(key)
	}

	clear() {
		return this.#cache.clear()
	}
}
