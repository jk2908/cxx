import { resolve } from 'node:path'
import { env } from 'node:process'
import type { Options } from 'tsup'

export const tsup: Options = {
  clean: true,
  dts: true,
  entryPoints: [resolve(__dirname, 'src', 'index.ts')],
  minify: env.NODE_ENV === 'production',
  sourcemap: true,
  splitting: true,
  format: ['esm'],
  target: ['esnext'],
  external: ['react', 'react-dom', 'next'],
}