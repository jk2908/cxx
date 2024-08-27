import { Deduped } from './deduped'

function App() {
  return (
    <>
      <Deduped>
        <h1>Yo</h1>
      </Deduped>

      <Deduped>
        <p>What&apos;s up</p>
      </Deduped>

      <Deduped>
        <p>Bye</p>
      </Deduped>
    </>
  )
}

export default App
