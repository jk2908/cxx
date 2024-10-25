declare module 'react' {
	interface StyleHTMLAttributes<T> extends React.HTMLAttributes<T> {
		href?: string
		precedence?: 'reset' | 'low' | 'medium' | 'high'
	}
}

export const cxx = (_: TemplateStringsArray): readonly ['', '', Record<string, string>] => [
	'',
	'',
	{},
]
