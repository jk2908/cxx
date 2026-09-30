export function capitalise(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1)
}

export function pascalise(str: string) {
	return str
		.split(/[ _-]+/)
		.map(capitalise)
		.join('')
}
