import { hashStyle } from './style-hash.js'

export type { StyleHash } from './style-hash.js'

export type StyleManifestEntry = {
	hash: string
	files: string[]
}

export type StyleManifest = {
	schema: 1
	hashes: string[]
	styles: Record<string, StyleManifestEntry>
}

/**
 * Create a CSP hash-source for inline style content. Quotes are added by the
 * consumer when building a policy.
 */
export function createStyleHash(css: string | Uint8Array) {
	return hashStyle(css).hash
}
