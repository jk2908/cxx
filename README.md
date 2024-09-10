cxx

library based on experiments with React 19 suspenseful style hoisting and deduping. `cxx` intakes CSS via a template literal arg and returns a three item tuple; the processed CSS, if configured (on by default) a CSS Modules exports object, and also optionally for usage, an id to pass to the href attribute of a style tag for deduping see [React docs](https://react.dev/reference/react-dom/components/style#noun-labs-1201738-(2)). The function actually just returns placeholders for the above items which will be replaced at build time. No string interpolation is supported within the CSS template tag input at the moment.

example usage:
In ui templates `cmp.tsx`:
```
  import { cxx } from '@jk2908/cxx'

  const [css, styles, href] = cxx`
    .header {
      display: flex;
    }
  ` 

  function Cmp() {
    return (
      <header className={styles.header}>
        ...

        <style href={href} precedence="medium">
          {css}
        </style>
      </header>
    )
  }

  // without CSS Modules exports but with href
  const [css,, href] = cxx`...`

  // plain CSS
  const [css] = cxx`...`
```

CSS is transformed using [lightningcss](https://www.npmjs.com/package/lightningcss). There is access to the full lightningcss config. 

vite `vite.config.ts`:
```
  import cxx from '@jk2908/cxx/vite-plugin-cxx'

  export default defineConfig({
    plugins: [react(), cxx({ ...optional cxx config })],
  })

  // turn off default config
  export default defineConfig({
    plugins: [cxx({
      lightningcss: {
        minify: false,
        cssModules: false,
        ...other transform options
      }
    })]
  })
```

next `next.config.ts`:
```
  import { withCxx } from '@jk2908/cxx/next'

  const nextConfig = {}

  export default withCxx(nextConfig, { ...optional cxx config })
```

with inspiration from:
- https://github.com/bluskript/vite-plugin-inline-css-modules/

using:
- https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
- https://www.npmjs.com/package/lightningcss