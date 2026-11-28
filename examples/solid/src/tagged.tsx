import { cxx, type TaggedClasses } from '@jk2908/cxx'
import { Style } from '@jk2908/cxx/solid-js'
import type { JSX } from '@solidjs/web'

const button = cxx.embed.tag<TaggedClasses>('Tagged')`
  .tagged {
    color: green;
    font-size: 32px;
  }

  .thing2 {
    color: yellow;
	}
`

export function Tagged(props: { children: JSX.Element }) {
	return (
		<div class={button.styles.tagged}>
			{props.children}

			<br />

			<span class={button.styles.thing}>This span creates a TypeScript error</span>

			<span class={button.styles.thing2}>...but this one does not</span>

			<Style {...button.styleProps} />
		</div>
	)
}
