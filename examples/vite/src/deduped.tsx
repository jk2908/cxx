import { cxx } from '@jk2908/cxx'

const [css, styles, href] = cxx`
  .deduped {
    color: red;
    font-size: 32px;
  }
`

export function Deduped({ children }: { children: React.ReactNode }) {
	return (
		<div className={styles.deduped}>
			{children}

			<style href={href} precedence="medium">
				{css}
			</style>
		</div>
	)
}
