import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');
const site = process.argv.includes('--site');

/** @type {esbuild.BuildOptions} */
const base = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

if (site) {
  // The site generator reuses the pure markdown renderer from src/core, so it goes
  // through the same bundler as the tests instead of duplicating it in plain JS.
  await esbuild.build({
    ...base,
    entryPoints: ['scripts/build-site.ts'],
    outfile: '.site/build.cjs',
  });
} else if (test) {
  await esbuild.build({
    ...base,
    entryPoints: ['test/run.ts'],
    outfile: '.test/run.mjs',
    format: 'esm',
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  });
} else {
  const ctx = await esbuild.context({
    ...base,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
    minify: !watch,
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}
