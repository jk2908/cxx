import { Deduped } from './deduped'
import { Tagged } from './tagged'

function App() {
	return (
		<>
			<Deduped>
				<h1>Deduped CSS 1</h1>
			</Deduped>

			<Deduped>
				<p>Deduped CSS 2</p>
			</Deduped>

			<Deduped>
				<p>Deduped CSS 3</p>
			</Deduped>

			<Tagged>Type safe CSS</Tagged>
		</>
	)
}

export default App
