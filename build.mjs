import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  loader: { '.css': 'text', '.md': 'text' },
  logLevel: 'info',
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
