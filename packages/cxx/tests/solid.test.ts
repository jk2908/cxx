import { describe, expect, it, vi } from 'vitest'

vi.mock('@solidjs/meta', () => ({ Style: () => null }))
vi.mock('solid-js', () => ({
	createComponent: (_component: unknown, props: unknown) => props,
}))

const { Style } = await import('../src/solid-js/index.js')

const descriptor = {
	mode: 'embed' as const,
	href: 'cxx-abc123',
	css: '.a{color:red}',
}

describe('solid Style', () => {
	it('keys the head tag by href so each stylesheet has one identity', () => {
		const props = Style(descriptor) as Record<string, unknown>

		expect(props.key).toBe('cxx-abc123')
	})

	it('never forwards the descriptor or React-only fields to the DOM', () => {
		const props = Style({ ...descriptor, media: 'screen' }) as Record<
			string,
			unknown
		>

		expect(props).not.toHaveProperty('href')
		expect(props).not.toHaveProperty('precedence')
		expect(props).not.toHaveProperty('mode')
		expect(props.media).toBe('screen')
	})

	it('renders the compiled css as the style children', () => {
		const props = Style(descriptor) as Record<string, unknown>

		expect(props.children).toBe('.a{color:red}')
	})
})
