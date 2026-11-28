import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'
import cxx from '@jk2908/cxx/vite'

export default defineConfig({
	plugins: [cxx(), solid()],
})
