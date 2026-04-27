# @jk2908/cxx

Build-time CSS template tag utilities for React 19.

## Install

```sh
npm install @jk2908/cxx lightningcss react react-dom
```

## Usage

```tsx
import { cxx } from '@jk2908/cxx'

const [css, styles, href] = cxx`
	.header {
		display: flex;
		gap: 0.75rem;
	}
`

export function Header() {
	return (
		<header className={styles.header}>
			<style href={href} precedence="medium">
				{css}
			</style>
		</header>
	)
}
```

The `cxx` tag is a build-time marker. Use the Vite plugin or Next helper so the placeholders are replaced before runtime. String interpolation inside the template is not supported.

## Vite

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cxx from '@jk2908/cxx/vite-plugin-cxx'

export default defineConfig({
	plugins: [react(), cxx()],
})
```

## Next

```ts
import { withCxx } from '@jk2908/cxx/next'

const nextConfig = {}

export default withCxx(nextConfig)
```

Both integrations accept an optional config object with `lightningcss` options. The default transform enables minification and CSS Modules output.

```ts
cxx({
	lightningcss: {
		minify: false,
		cssModules: false,
	},
})
```

## License

MIT