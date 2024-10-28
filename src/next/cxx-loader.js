import { inject } from '../inject'

export default function loader(source) {
	return inject(source, this.resourcePath, this.getOptions())
}