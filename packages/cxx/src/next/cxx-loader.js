import { Logger } from '../logger.js'
import { processFile } from './index.js'

const loader = function (source) {
	const { pluginConfig } = this.getOptions()
	const logger = new Logger()

	const { template, map } = processFile(source, this.resourcePath, pluginConfig, logger)

	// hand the transform's source map back to webpack/turbopack when they support it
	if (map && typeof this.callback === 'function') {
		this.callback(null, template, map)

		return
	}

	return template
}

export default loader
