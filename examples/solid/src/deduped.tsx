import { cxx } from '@jk2908/cxx'
import type { JSX } from '@solidjs/web'

const button = cxx.extract`
  .deduped {
    color: red;
    font-size: 32px;
  }
`

export function Deduped(props: { children: JSX.Element }) {
	return <div class={button.styles.deduped}>{props.children}</div>
}
