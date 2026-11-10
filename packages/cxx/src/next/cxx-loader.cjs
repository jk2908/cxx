const loader = function (source) {
	const callback = this.async()
	const { projectRoot, pluginConfig } = this.getOptions()
	const resourcePath = this.resourcePath

	// oxc-parser is ESM-only, so load the ESM integration dynamically from this CJS loader
	import('./index.js')
		.then(({ processFile }) => {
			const { template, map } = processFile(
				source,
				resourcePath,
				projectRoot,
				pluginConfig,
			)

			callback(null, template, map ?? undefined)
		})
		.catch(callback)
}

module.exports = loader
