// 프레임 단위 렌더러: 헤드리스 Chromium으로 renderFrame(t)를 호출해 캡처하고 x264로 인코딩합니다.
// 사용: node scripts/render.mjs [--workers 3] [--from 0] [--to 132] [--fps 60] [--crf 17] [--out out/kel_championship_final_promo.mp4]
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const FPS = +(args.fps || 60);
const FROM = +(args.from || 0);
const TO = +(args.to || 132);
const WORKERS = +(args.workers || 3);
const CRF = args.crf || '17';
const PRESET = args.preset || 'slow';
const OUT = path.resolve(ROOT, args.out || 'out/kel_championship_final_promo.mp4');
const TMP = path.resolve(ROOT, 'out/.segments');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const f0 = Math.round(FROM * FPS), f1 = Math.round(TO * FPS);
const total = f1 - f0;
const { server, url } = await serve(ROOT);

function run(cmd, argv, stdin = 'ignore') {
  const p = spawn(cmd, argv, { stdio: [stdin, 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.done = new Promise((res, rej) => p.on('close', c => (c === 0 ? res() : rej(new Error(`${cmd} 실패(${c}): ${err.slice(-800)}`)))));
  return p;
}

let rendered = 0;
const t0 = Date.now();
async function worker(k, a, b) {
  const seg = path.join(TMP, `seg_${String(k).padStart(2, '0')}.mp4`);
  const ff = run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    // 필름 그레인은 브라우저 대신 여기서 넣습니다(휘도에만, 프레임마다 변화).
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,noise=c0s=5:c0f=t',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-profile:v', 'high', '-x264-params', `keyint=${FPS * 2}:min-keyint=${FPS}`,
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', seg], 'pipe');
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.error(`[w${k}] PAGE ERROR`, e.message));
  await page.goto(`${url}/index.html?render=1&nograin=1`);
  await page.evaluate(() => window.__ready);
  const cdp = await page.context().newCDPSession(page);
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.renderFrame(t), f / FPS);
    // CDP 직접 캡처(무손실 PNG, 빠른 압축 설정)
    const png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64');
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    rendered++;
    if (rendered % 120 === 0) {
      const el = (Date.now() - t0) / 1000;
      process.stderr.write(`\r${rendered}/${total} frames · ${(rendered / el).toFixed(1)} fps · 남은 시간 약 ${Math.round((total - rendered) / (rendered / el))}초   `);
    }
  }
  ff.stdin.end();
  await ff.done;
  await browser.close();
  return seg;
}

const per = Math.ceil(total / WORKERS);
const segs = await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k, f0 + k * per, Math.min(f1, f0 + (k + 1) * per))).filter(Boolean));
server.close();
process.stderr.write('\n');

const list = path.join(TMP, 'list.txt');
fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
const audio = path.join(ROOT, 'audio/kel_promo_mix.wav');
const mux = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (fs.existsSync(audio)) mux.push('-ss', String(FROM), '-t', String(TO - FROM), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k');
mux.push('-c:v', 'copy', '-movflags', '+faststart', '-metadata', 'title=2026 KEL 챔피언십 결승전 홍보영상 (Fan-made)', OUT);
await run('ffmpeg', mux).done;
segs.forEach(s => fs.rmSync(s));
console.log(`완료: ${OUT} · ${total}프레임 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
