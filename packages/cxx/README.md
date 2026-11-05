# @jk2908/cxx

Build-time CSS template tag utilities for React 19.

## Install

```sh
npm install @jk2908/cxx lightningcss react react-dom
```

## Usage

```tsx
import { cxx, Style } from '@jk2908/cxx'

const button = cxx.embed`
	.button {
		display: inline-flex;
		gap: 0.75rem;
	}
`

export function Button() {
	return (
		<button className={button.styles.button}>
			<Style {...button.styleProps} />
			Click me
		</button>
	)
}
```

`cxx.embed` and `cxx.extract` are build-time markers. Use the Vite or Next integration so the placeholders are replaced before runtime. String interpolation inside the template is not supported.

`cxx.embed` returns `{ styles, styleProps }`:

- `styles` is the generated CSS Modules class map.
- `styleProps` describes the embedded style resource. Pass it to `Style`.

`Style` renders a `<style>` element for embedded resources. `styleProps` includes `precedence: 'default'`; pass another value after spreading to override it: `<Style {...button.styleProps} precedence="medium" />`. Other native `<style>` props such as `media` are passed through.

Named blocks can opt into generated class-key types:

```tsx
import { cxx, Style, type HeroClasses } from '@jk2908/cxx'

const hero = cxx.embed.tag<HeroClasses>('hero')`
	.hero {
		display: flex;
	}

	.copy {
		max-width: 60ch;
	}
`

export function Hero() {
	return (
		<section className={hero.styles.hero}>
			<Style {...hero.styleProps} />
			<p className={hero.styles.copy}>Type-safe class names.</p>
		</section>
	)
}

// `hero.styles.coppy` is a type error
```

The string passed to `cxx.embed.tag(...)` is turned into the exported type name by appending `typeSuffix` and then normalising the whole result into Pascal Case. With the default suffix, `cxx.embed.tag('hero')` becomes `HeroClasses`, and `cxx.embed.tag('marketing-banner')` becomes `MarketingBannerClasses`. If `typeSuffix` is `false`, those become `Hero` and `MarketingBanner` instead.

Generated class-key types are imported from the root package, not a separate generated subpath.

Because `.cxx` is generated, it is recommended to add `.cxx` to your `.gitignore`.

## Embedded and extracted styles

There is no implicit default. Choose how the CSS is delivered:

```tsx
const button = cxx.embed`
	.button { color: red; }
`
```

`cxx.embed` keeps the CSS text in the module and renders it as a hoisted `<style>` element through `Style`.

```tsx
const button = cxx.extract`
	.button { color: red; }
`

export function Button() {
	return <button className={button.styles.button}>Click me</button>
}
```

`cxx.extract` hands the CSS to the bundler as a stylesheet. It returns only `{ mode: 'extract', styles }`; there is no `styleProps` and no `Style` to render.

Both the Vite and Next integrations generate a CSS import next to the source file. The bundler owns the emitted stylesheet, chunk association, preload, and HMR.

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

## Watch options

`watch.root` sets the tree scanned for `cxx` tags. It defaults to the Vite root, and to the app directory (`process.cwd()`) in Next.

```ts
export default withCxx(nextConfig, {
	typeSuffix: 'Classes',
	watch: {
		root: '../../',
	},
})
```

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Syntax highlighting

The [`vscode-cxx`](https://github.com/jk2908/cxx/tree/main/packages/vscode-cxx) extension provides syntax highlighting for `cxx.embed.tag()` and `cxx.extract.tag()` tagged template literals in VS Code. See its [README](https://github.com/jk2908/cxx/tree/main/packages/vscode-cxx) for install instructions.

## License

MIT
