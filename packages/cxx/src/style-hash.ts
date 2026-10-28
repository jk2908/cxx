import { createHash } from 'node:crypto'

const encoder = new TextEncoder()

/**
 * A style's full hash and the short href cxx emits for deduplication.
 */
export type StyleHash = {
	/** Full SHA-256 digest, formatted as a CSP hash-source without quotes. */
	hash: string
	/** Stable href used by the <style> element. */
	href: string
}

/**
 * Hash transformed CSS bytes. The digest is used for both the CSP hash and the
 * short cxx href, so they can never disagree.
 */
export function hashStyle(css: string | Uint8Array): StyleHash {
	const bytes = typeof css === 'string' ? encoder.encode(css) : css
	const digest = createHash('sha256').update(bytes).digest()

	return {
		hash: `sha256-${digest.toString('base64')}`,
		href: `cxx-${digest.toString('base64url').slice(0, 12)}`,
	}
}
