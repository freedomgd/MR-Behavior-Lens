const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

// Mermaid must be served from media/ because the webview CSP blocks CDNs.
function copyMermaid() {
  const src = path.join(__dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  const dest = path.join(__dirname, 'media', 'mermaid.min.js');
  fs.copyFileSync(src, dest);
  console.log('copied mermaid.min.js -> media/');
}

async function main() {
  copyMermaid();
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    minify: false,
  });
  if (watch) {
    await ctx.watch();
    console.log('watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('build done');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
