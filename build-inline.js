#!/usr/bin/env node
// Reads the Vite build output and creates inline-ui.js —
// a single module.exports with the full self-contained HTML string.
// This avoids any static file serving in the pkg executable.

const fs   = require('fs');
const path = require('path');

const publicDir  = path.join(__dirname, 'public');
const assetsDir  = path.join(publicDir, 'assets');
const outFile    = path.join(__dirname, 'inline-ui.js');

const indexHtml  = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const assetFiles = fs.readdirSync(assetsDir);

const cssFile = assetFiles.find(f => f.endsWith('.css'));
const jsFile  = assetFiles.find(f => f.endsWith('.js'));

if (!cssFile || !jsFile) {
  console.error('Could not find CSS/JS in public/assets/. Run the Vite build first.');
  process.exit(1);
}

const css = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
const js  = fs.readFileSync(path.join(assetsDir, jsFile),  'utf8');

// Escape </script> inside JS so the HTML parser never closes the tag early
const jsSafe = js.replace(/<\/script/gi, '<\\/script');

// Inline all static assets referenced in index.html.
// Use function replacements so that $& / $' / $` patterns in CSS/JS are
// never interpreted as replacement specifiers by String.prototype.replace.
let html = indexHtml
  .replace(/<link[^>]*rel="stylesheet"[^>]*href="[^"]*"[^>]*>/,
    () => `<style>${css}</style>`)
  .replace(/<script[^>]*type="module"[^>]*src="[^"]*"[^>]*><\/script>/,
    () => `<script>${jsSafe}</script>`);

// Inline the Netwrix logo as base64 (used by /218769606.png route)
const logoPath = path.join(publicDir, '218769606.png');
if (fs.existsSync(logoPath)) {
  const logoB64  = fs.readFileSync(logoPath).toString('base64');
  const logoData = `data:image/png;base64,${logoB64}`;
  // Replace every occurrence of the logo URL in the inlined JS
  html = html.split('/218769606.png').join(logoData);
}

// Write as a CommonJS module so pkg can bundle it as a script
fs.writeFileSync(outFile,
  `// AUTO-GENERATED — do not edit. Run: node build-inline.js\nmodule.exports = ${JSON.stringify(html)};\n`
);

const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`inline-ui.js written (${kb} KB)`);
