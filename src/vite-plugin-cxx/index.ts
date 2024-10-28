import type { Plugin } from 'vite'

import { inject, type Config } from '../inject'

export default function vitePluginCxx(config?: Config): Plugin {
  return {
    name: 'cxx',
    enforce: 'pre',
    transform(code, id) {
      return {
        code: inject(code, id, config),
        map: null
      }
    }
  }
}