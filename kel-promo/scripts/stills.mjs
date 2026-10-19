// 검수용 정지 화면: node scripts/stills.mjs <출력폴더> <초> [<초> ...]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [outDir, ...times] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { server, url } = await serve(ROOT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
await page.goto(`${url}/index.html?render=1`);
await page.evaluate(() => window.__ready);
for (const s of times) {
  await page.evaluate(t => window.renderFrame(t), +s);
  await page.screenshot({ path: path.join(outDir, `t${String(s).padStart(6, '0')}.png`) });
}
await browser.close();
server.close();
