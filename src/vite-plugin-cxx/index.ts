import type { Plugin } from 'vite'

import { inject } from '../'

export default function vitePluginCxx(): Plugin {
  return {
    name: 'cxx',
    enforce: 'pre',
    transform(code, id) {
      return {
        code: inject(code, id),
        map: null
      }
    }
  }
}