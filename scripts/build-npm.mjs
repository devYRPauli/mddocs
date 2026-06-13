// Bundle the mddocs CLI + engine + vendored @proof/* code into one self-contained
// file for npm. The editor serializer is loaded in source via a runtime variable
// specifier (to keep our strict typecheck decoupled from @milkdown); here we
// rewrite that one import to a literal so esbuild bundles the headless Milkdown
// serializer too. The editor dist/ is shipped separately and located at runtime
// via MDDOCS_DIST (set by the bin launcher).
import esbuild from 'esbuild'
import { readFileSync } from 'node:fs'

const literalizeSerializer = {
  name: 'literalize-serializer',
  setup(build) {
    build.onLoad({ filter: /[\\/]serialize\.ts$/ }, (args) => {
      const code = readFileSync(args.path, 'utf8').replace(
        'import(HEADLESS_SPECIFIER)',
        "import('../../../server/milkdown-headless.js')",
      )
      return { contents: code, loader: 'ts' }
    })
  },
}

await esbuild.build({
  entryPoints: ['packages/mddocs-cli/src/bin.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'publish/cli.mjs',
  plugins: [literalizeSerializer],
  // Bundled CJS deps (e.g. commander) call require() for node builtins; provide a
  // real require in the ESM output so those calls resolve.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
})

console.log('built publish/cli.mjs')
