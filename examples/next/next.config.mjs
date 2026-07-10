import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { withCxx } from '@jk2908/cxx/next'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const turbopackRoot = path.resolve(rootDir, '../..')

/** @type {import('next').NextConfig} */
const nextConfig = {
	turbopack: {
		root: turbopackRoot,
	},
}

export default withCxx(nextConfig)
