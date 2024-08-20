import { useId } from 'react'

declare module 'react' {
	interface StyleHTMLAttributes<T> extends React.HTMLAttributes<T> {
		href?: string
		precedence?: 'low' | 'medium' | 'high'
	}
}

export const cxx = (_: TemplateStringsArray): readonly [Record<string, string>, ''] => [{}, '']

export type StyleProps = {
	children: React.ReactNode
	precedence?: 'low' | 'medium' | 'high'
} & React.HTMLAttributes<HTMLStyleElement>

export function Style({ children, precedence = 'medium' }: StyleProps) {
	const id = useId()

	return (
		<style href={id} precedence={precedence}>
			{children}
		</style>
	)
}
