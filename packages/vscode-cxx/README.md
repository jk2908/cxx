# vscode-cxx

Syntax highlighting for [`@jk2908/cxx`](../cxx) tagged template literals in VS Code.

Highlights the CSS inside `cxx\`...\`` and `cxx.tag<T>('name')\`...\`` blocks in TypeScript and JavaScript files using VS Code's built-in CSS grammar. 

## Install

Download the latest `vscode-cxx-*.vsix` from the [GitHub release](https://github.com/jk2908/cxx/releases) and install it:

```sh
code --install-extension vscode-cxx-0.1.0.vsix
```

Or drag the `.vsix` file into the VS Code Extensions panel.

## How it works

This extension contributes a TextMate injection grammar (`source.css.cxx-injection`) that targets `source.ts`, `source.tsx`, `source.js`, `source.jsx`, and the modern module scope variants (`.mts` / `.mjs` / `.cjs`). When VS Code tokenises a TypeScript or JavaScript file, the injection rule re-scopes the body of any `cxx` or `cxx.tag<...>('...')` tagged template literal as `source.css`, so VS Code's bundled CSS grammar kicks in and you get selector, property, value and at-rule highlighting for free.

## License

MIT