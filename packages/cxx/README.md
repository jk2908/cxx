# @jk2908/cxx

Build-time CSS template tag utilities for React 19.

- CSS Modules without a separate stylesheet file.
- Typed class keys generated from the tagged block.
- Two delivery modes: `extract` hands CSS to the bundler, while `embed` renders `<style />` tags that React 19 hoists into the head.

## Install

```sh
npm install @jk2908/cxx react react-dom
```

## Requirements

Recommended: Node.js 20 or newer, React 19, and Vite 7+ or Next 15+ with the App Router.

Generated types live in `.cxx/index.d.ts`, so `.cxx` must be included in your `tsconfig`:

```json
{
	"include": ["src", ".cxx"]
}
```

Without it, the generated types and tag inference are not part of the TypeScript program.

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
	// class map and style descriptor
	const { styles, styleProps } = button

	return (
		<button className={styles.button}>
			<Style {...styleProps} />
			Click me
		</button>
	)
}
```

`cxx.embed` and `cxx.extract` are build-time markers. Enable the Vite or Next integration so they are replaced before runtime. You can't interpolate strings inside the template.

`cxx.embed` returns `{ styles, styleProps }`:

- `styles` is the generated CSS Modules class map.
- `styleProps` describes the embedded stylesheet. Pass it to `<Style />`.

`<Style />` renders a `<style>` element for embedded styles. `styleProps` already includes `precedence: 'default'`, so spread it first and set `precedence` after to override it:

```tsx
<Style {...styleProps} precedence="medium" />
```

Other `<style>` props like `media` pass straight through.

### Typed class names

Named blocks generate class-key types, and the tag functions infer them from the tag name:

```tsx
import { cxx, Style } from '@jk2908/cxx'

const hero = cxx.embed.tag('hero')`
	.hero {
		display: flex;
	}

	.copy {
		max-width: 60ch;
	}
`

export function Hero() {
	const { styles, styleProps } = hero

	return (
		<section className={styles.hero}>
			<Style {...styleProps} />
			<p className={styles.copy}>Type-safe class names.</p>
		</section>
	)
}

// `styles.coppy` is a type error
```

You can also pass the type explicitly. The generated type is exported from the package root:

```tsx
import { cxx, type HeroClasses } from '@jk2908/cxx'

const hero = cxx.embed.tag<HeroClasses>('hero')`
	.hero {
		display: flex;
	}
`
```

The name passed to `cxx.embed.tag(...)` becomes the exported type name: the `typeSuffix` is appended, then the result is converted to Pascal Case. With the default suffix, `cxx.embed.tag('hero')` becomes `HeroClasses`, and `cxx.embed.tag('marketing-banner')` becomes `MarketingBannerClasses`. If `typeSuffix` is `false`, they become `Hero` and `MarketingBanner`.

Import generated types from the package root, not a separate generated subpath.

`.cxx` is generated, so add it to your `.gitignore`. It contains `index.d.ts`, the per-file manifests, and extracted stylesheets.

## Embedded and extracted styles

There is no implicit default, choose how the CSS is delivered:

```tsx
// CSS stays in the module and renders through <Style />
const button = cxx.embed`
	.button { color: red; }
`
```

`cxx.embed` keeps the CSS text in the module and renders it as a hoisted `<style>` element via `<Style />`.

```tsx
const button = cxx.extract`
	.button { color: red; }
`

export function Button() {
	// extract returns only the class map
	const { styles } = button

	return <button className={styles.button}>Click me</button>
}
```

`cxx.extract` hands the CSS to the bundler as a stylesheet. It returns only `{ mode: 'extract', styles }` — no `styleProps`, and no `<Style />` to render.

With both modes, the integration injects an import into the module, pointing at the generated sheet in `.cxx`. The bundler handles emitting the stylesheet, chunk association, preload, and HMR.

## Limitations

- No interpolation. `${...}` is rejected at build time; use CSS custom properties for values that change.
- The Next integration targets the App Router.
- `.cxx` is generated in the project and should be gitignored.

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

`typeSuffix` sets the suffix for generated type names. It defaults to `'Classes'`; set it to `false` to omit it.

## Next

Supported with the Next App Router.

```ts
import { withCxx } from '@jk2908/cxx/next'

/** @type {import('next').NextConfig} */
const nextConfig = {}

export default withCxx(nextConfig, { typeSuffix: 'Classes' })
```

Use the Next integration to get `cxx` transforms and generated class-key types in a Next app.

## Watch options

`watch.root` sets the directory tree scanned for `cxx` tags. It defaults to the Vite root, and to the app directory (`process.cwd()`) in Next.

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

The [`vscode-cxx`](https://github.com/jk2908/cxx/tree/main/packages/vscode-cxx) extension adds syntax highlighting for `cxx.embed` and `cxx.extract` tagged templates, including the `.tag()` form, in VS Code. See its [README](https://github.com/jk2908/cxx/tree/main/packages/vscode-cxx) for install instructions.

## License

MIT
