import { cxx, Style, type TaggedClasses } from '@jk2908/cxx'

const button = cxx.embed.tag<TaggedClasses>('Tagged')`
  .tagged {
    color: green;
    font-size: 32px;
  }

  .thing2 {
    color: yellow;
	}
`

export function Tagged({ children }: { children: React.ReactNode }) {
	return (
		<div className={button.styles.tagged}>
			{children}

			<br />

			<span className={button.styles.thing}>This span creates a TypeScript error</span>

			<span className={button.styles.thing2}>...but this one does not</span>

			<Style {...button.styleProps} precedence="medium" />
		</div>
	)
}
