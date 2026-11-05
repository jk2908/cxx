import { cxx } from '@jk2908/cxx'

const button = cxx.extract`
  .deduped {
    color: red;
    font-size: 32px;
  }
`

export function Deduped({ children }: { children: React.ReactNode }) {
	return <div className={button.styles.deduped}>{children}</div>
}
