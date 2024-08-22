import { inject } from '../'

export default function loader(source) {
	return inject(source, this.resourcePath)
}