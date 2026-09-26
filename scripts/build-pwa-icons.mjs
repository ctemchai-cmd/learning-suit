// Builds the PNG app icons for the PWA manifest and iOS from src/app/icon.svg (run after changing the icon):
//   node scripts/build-pwa-icons.mjs
// “any” icons keep the rounded corners (transparent outside); maskable/Apple icons are full-bleed squares
// because the platform cuts its own shape, with the mark scaled to 85% so it stays inside the safe zone.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const background = svg.match(/<rect[^>]*\/>/)[0];
const fullBleed = svg
  .replace(background, `${background.replace(/\srx="[^"]*"/, "")}<g transform="translate(4.8 4.8) scale(0.85)">`)
  .replace("</svg>", "</g></svg>");
const outputs = [
  { file: "public/icons/icon-192.png", size: 192, source: svg },
  { file: "public/icons/icon-512.png", size: 512, source: svg },
  { file: "public/icons/icon-maskable-512.png", size: 512, source: fullBleed },
  { file: "src/app/apple-icon.png", size: 180, source: fullBleed },
];

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage();
for (const { file, size, source } of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  await page.screenshot({ path: new URL(`../${file}`, import.meta.url).pathname, omitBackground: true });
  console.log("wrote", file);
}
await browser.close();
