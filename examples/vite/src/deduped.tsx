import { cxx } from '@jk2908/cxx'

const [styles, css, href] = cxx`
  .deduped {
    color: red;
    font-size: var(--text-lg);
    margin-block: var(--space-10x);
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