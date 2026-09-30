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
	typescript: {
		// Next's built-in tsc step stalls unpredictably on Vercel; we run an
		// explicit tsgo gate in the build script instead so this is redundant.
		ignoreBuildErrors: true,
	},
	eslint: {
		ignoreDuringBuilds: true,
	},
}

export default withCxx(nextConfig)