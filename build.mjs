import * as esbuild from 'esbuild';
import { cp, mkdir } from 'fs/promises';

// Files the preview document loads at runtime, copied next to the bundle so the
// packaged app doesn't need node_modules.
async function copyVendor() {
  await mkdir('dist/vendor', { recursive: true });
  await cp('node_modules/pagedjs/dist/paged.polyfill.min.js', 'dist/vendor/paged.polyfill.min.js');
  await cp('node_modules/katex/dist/katex.min.css', 'dist/vendor/katex/katex.min.css');
  await cp('node_modules/katex/dist/fonts', 'dist/vendor/katex/fonts', { recursive: true });
}

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  target: 'chrome120',
  minify: !watch,
  sourcemap: watch,
  loader: { '.css': 'text', '.md': 'text' },
  logLevel: 'info',
});
await copyVendor();
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
