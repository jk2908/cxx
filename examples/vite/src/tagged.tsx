import { cxx, type TaggedClasses } from '@jk2908/cxx'

const [css, styles, href] = cxx.tag<TaggedClasses>('Tagged')`
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
		<div className={styles.tagged}>
			{children}

			<br />

			<span className={styles.thing}>This span creates a TypeScript error</span>

			<span className={styles.thing2}>...but this one does not</span>

			<style href={href} precedence="medium">
				{css}
			</style>
		</div>
	)
}
