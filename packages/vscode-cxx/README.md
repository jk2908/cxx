# vscode-cxx

Syntax highlighting for [`@jk2908/cxx`](../cxx) tagged template literals in VS Code.

Highlights the CSS inside:

```ts
cxx.embed`...`
cxx.extract`...`
cxx.embed.tag<HeroClasses>('hero')`...`
cxx.extract.tag<HeroClasses>('hero')`...`
```

using VS Code's built-in CSS grammar.

## Install

Download the latest `vscode-cxx-*.vsix` from the [GitHub release](https://github.com/jk2908/cxx/releases) and install it:

```sh
code --install-extension vscode-cxx-0.2.0.vsix
```

Or drag the `.vsix` file into the VS Code Extensions panel.

## How it works

This extension contributes a TextMate injection grammar (`source.css.cxx-injection`) that targets `source.ts`, `source.tsx`, `source.js`, `source.jsx`, and the modern module scope variants (`.mts` / `.mjs` / `.cjs`). When VS Code tokenises a TypeScript or JavaScript file, the injection rule re-scopes the body of a `cxx.embed` / `cxx.extract` tagged template — including the optional `.tag<T>('name')` form — as `source.css`, so VS Code's bundled CSS grammar kicks in and you get selector, property, value and at-rule highlighting for free.

## License

MIT
