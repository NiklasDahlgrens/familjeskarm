// Renderar PNG-ikoner från public/icon.svg (Chrome/Playwright)
import { chromium } from 'playwright-core';
import fs from 'fs';

const svg = fs.readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

async function renderFull(name, size) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#fffaf3}svg{width:${size}px;height:${size}px;display:block}</style></head><body>${svg}</body></html>`,
    { waitUntil: 'load' },
  );
  await p.screenshot({ path: 'public/' + name, omitBackground: false });
  await p.close();
  console.log(name, size);
}

/** Maskable: bakgrund fyller canvas, hela motivet skalas in i safe zone (~78 %). */
async function renderMaskable(name, size, safe = 0.78) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // Extrahera bakgrundsfärg från SVG-gradientens start; fyll hela ytan, skala innehållet
  const scaled = svg.replace(
    '<rect width="512" height="512" fill="url(#bg3)"/>',
    `<rect width="512" height="512" fill="url(#bg3)"/><g transform="translate(256 256) scale(${safe}) translate(-256 -256)">`,
  ).replace('</svg>', '</g></svg>');
  await p.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#fffaf3}svg{width:${size}px;height:${size}px;display:block}</style></head><body>${scaled}</body></html>`,
    { waitUntil: 'load' },
  );
  await p.screenshot({ path: 'public/' + name, omitBackground: false });
  await p.close();
  console.log(name, size, 'safe', safe);
}

await renderFull('icon-192.png', 192);
await renderFull('icon-512.png', 512);
await renderFull('favicon-32.png', 32);
await renderFull('apple-touch-icon.png', 180);
await renderMaskable('icon-maskable-512.png', 512, 0.78);

await b.close();
console.log('icons ok');
