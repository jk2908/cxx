# Changelog

## 0.3.1

- Removed a stale npm `package-lock.json` that produced false Dependabot alerts
- Bumped `next` to `^16.3.7` and patched transitive `postcss`, `sharp` and `baseline-browser-mapping`
- Renamed the `next` example workspace to `next-example` to avoid a hoist collision with the `next` package

## 0.3.0

- Fixed emitted CSS being corrupted by unescaped CSS escapes such as `\f101`, `\e900` and `\2014`
- Removed the `logger.level` plugin option
- Fixed the shared debounce dropping file changes and rebuilding the wrong file
- Fixed `maybeWrite` rewriting unchanged files on a cold start
- Fixed `export const [css, classes, href] = cxx` only exporting `css`
- Added a webpack loader rule so Next builds without Turbopack are transformed
- Made Next type generation atomic and merged across Turbopack worker processes
- Removed import-time signal handlers, dropped `process.exit` and made `withCxx` synchronous
- Made `@parcel/watcher` optional and lazily loaded, and replaced overlapping watchers with one recursive watcher
- Added `watch.root` and `watch.ignore` options, defaulting the Next watch root to the Turbopack root
- Added a cheap `cxx` bail-out and Vite root resolution to the Vite plugin, and replaced the hand-rolled source maps with `magic-string`
- Validated tag names and made the runtime placeholder throw when a template reaches runtime untransformed
- Widened the Vite peer range to cover versions 4 through 8

## 0.2.6

- Split the root package entry from the build-time transform helpers so browser consumers no longer pull Node-only code into `@jk2908/cxx`
- Kept the Vite and Next integrations on the internal build module while preserving the root runtime API

## 0.2.5

- Renamed `TagDuplicateError` to `DuplicateTagError`
- Added test suite (vitest)
- Renamed the `vite` example workspace to `vite-example` to avoid hoist collision with the `vite` package

## 0.2.4

- Fix README links

## 0.2.3

- Renamed the Vite plugin export from `@jk2908/cxx/vite-plugin-cxx` to `@jk2908/cxx/vite`
- Added Next usage documentation to the package README

## 0.2.0

- Added `cxx.tag(...)` for named blocks with generated class-key types
- Re-added Next support via `@jk2908/cxx/next`
- Added proper development file watching so generated types stay in sync as watched files change
- Added `typeSuffix` to plugin configuration
- Added `logger.level` to plugin configuration
