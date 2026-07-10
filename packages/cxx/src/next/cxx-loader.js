import { Logger } from '../logger.js'
import { processFile } from './index.js'

const loader = function (source) {
	const { pluginConfig } = this.getOptions()
	const logger = new Logger(
		(pluginConfig?.logger?.level ?? process.env.NODE_ENV === 'production')
			? 'error'
			: 'debug',
	)

	const { template } = processFile(source, this.resourcePath, pluginConfig, logger)

	return template
}

export default loader
