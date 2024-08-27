import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cxx from '@jk2908/cxx/vite-plugin-cxx'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cxx()],
})
