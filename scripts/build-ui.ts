import { build } from 'esbuild';

await build({
  entryPoints: ['ui/app.tsx'],
  bundle: true,
  outfile: 'ui/dist/app.js',
  jsx: 'automatic',
  format: 'esm',
  target: 'es2022',
});

console.log('ui/dist/app.js gebaut');
