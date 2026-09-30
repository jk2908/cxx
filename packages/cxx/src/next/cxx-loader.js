import { processFile } from './index.js'

const loader = function (source) {
	const { pluginConfig } = this.getOptions()

	const { template } = processFile(source, this.resourcePath, pluginConfig)

	return template
}

export default loader
