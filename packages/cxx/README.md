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

The `cxx` tag is a build-time marker. Use the Vite plugin so the placeholders are replaced before runtime. String interpolation inside the template is not supported.

Named blocks can opt into generated class-key types:

```tsx
import { cxx, type HeroClasses } from '@jk2908/cxx'

const [css, styles, href] = cxx.tag<HeroClasses>('hero')`
	.hero {
		display: flex;
	}

	.copy {
		max-width: 60ch;
	}
`

export function Hero() {
	return (
		<section className={styles.hero}>
			<p className={styles.copy}>Type-safe class names.</p>
		</section>
	)
}

// `styles.coppy` is a type error
```

The string passed to `cxx.tag(...)` is turned into the exported type name by appending `typeSuffix` and then normalising the whole result into Pascal Case. With the default suffix, `cxx.tag('hero')` becomes `HeroClasses`, and `cxx.tag('marketing-banner')` becomes `MarketingBannerClasses`. If `typeSuffix` is `false`, those become `Hero` and `MarketingBanner` instead.

Generated class-key types are imported from the root package, not a separate generated subpath.

Because `.cxx` is generated, it is recommended to add `.cxx` to your `.gitignore`.

## Vite

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cxx from '@jk2908/cxx/vite'

export default defineConfig({
	plugins: [react(), cxx({ typeSuffix: 'Classes' })],
})
```

The transform always emits minified CSS and CSS Modules class mappings.

`typeSuffix` controls the generated exported type name suffix. It defaults to `'Classes'`. Set it to `false` to omit the suffix.

## Next

```ts
import { withCxx } from '@jk2908/cxx/next'

/** @type {import('next').NextConfig} */
const nextConfig = {}

export default withCxx(nextConfig, { typeSuffix: 'Classes' })
```

Use the Next integration when you want `cxx` transforms and generated class-key types inside a Next app. 

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Syntax highlighting

The [`vscode-cxx`](../vscode-cxx) extension provides syntax highlighting for `cxx` and `cxx.tag()` tagged template literals in VS Code. See its [README](../vscode-cxx) for install instructions.

## License

MIT