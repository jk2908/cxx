import { resolve } from 'path'
import { env } from 'process'
import type { Options } from 'tsup'

export const tsup: Options = {
  clean: true,
  dts: true,
  entryPoints: [resolve(__dirname, 'src', 'index.ts')],
  minify: env.NODE_ENV === 'production',
  sourcemap: true,
  splitting: false,
  format: ['esm'],
}