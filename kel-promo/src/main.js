/* 2026 KEL 챔피언십 결승전 홍보영상 · 장면 엔진
 * 모든 움직임은 renderFrame(t) 한 함수가 시각 t(초)만으로 계산합니다.
 * 같은 t에는 항상 같은 화면이 나오므로 프레임 단위 렌더와 실시간 미리보기가 일치합니다.
 */
(() => {
'use strict';

const TL = window.TL, K = window.KOREA;
const DUR = TL.duration, FREEZE = TL.freezeAt;
const qs = new URLSearchParams(location.search);
const RENDER = qs.has('render');
if (RENDER) document.body.classList.add('render');
if (qs.has('placeholders')) document.body.classList.add('placeholders');
// 렌더 시에는 그레인을 ffmpeg 후처리로 넣습니다(브라우저 합성 비용 절감).
if (qs.has('nograin')) document.body.classList.add('nograin');

/* ------------------------------------------------------------------ 수학 */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  lin: x => x,
  inCubic: x => x * x * x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inOutCubic: x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuint: x => 1 - Math.pow(1 - x, 5),
  inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: x => (x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pad2 = n => String(n).padStart(2, '0');
// 박자 기준(120 BPM): 마지막 박으로부터 지난 시간
const BEAT = 60 / TL.bpm;
const sinceBeat = t => t - Math.floor(t / BEAT) * BEAT;

/* ------------------------------------------------------------------ DOM */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function css(e, k, v) { const c = e.__c || (e.__c = {}); if (c[k] !== v) { c[k] = v; e.style[k] = v; } }
const show = (e, on) => css(e, 'display', on ? '' : 'none');
const op = (e, v) => css(e, 'opacity', v <= 0.001 ? '0' : v >= 0.999 ? '1' : v.toFixed(3));
const tf = (e, s) => css(e, 'transform', s);
function txt(e, s) { if (e.__t !== s) { e.__t = s; e.textContent = s; } }
function attr(e, k, v) { const c = e.__a || (e.__a = {}); if (c[k] !== v) { c[k] = v; e.setAttribute(k, v); } }

const stage = $('#stage'), world = $('#world'), scenes = $('#scenes');

/* --------------------------------------------------------- 애니메이션 도구 */
// 브리프 공통 키프레임: 텍스트 등장 18f(0.3초) 동안 +28px → 0px, 불투명도 0 → 100%
function rise(e, t, t0, o = {}) {
  const { dur = 0.3, dist = 28, out = null, outDur = 0.25, outDist = -24 } = o;
  const k = E.outCubic(prog(t, t0, t0 + dur));
  let y = (1 - k) * dist, a = k;
  if (out !== null) { const q = E.inCubic(prog(t, out, out + outDur)); y += q * outDist; a *= 1 - q; }
  op(e, a); tf(e, `translate3d(0,${y.toFixed(2)}px,0)`);
}
// 마스크 안에서 아래 → 제자리로 올라오는 헤드라인
function maskIn(e, t, t0, o = {}) {
  const { dur = 0.5, out = null, outDur = 0.32 } = o;
  const k = E.outExpo(prog(t, t0, t0 + dur));
  let y = (1 - k) * 110;
  if (out !== null) y -= E.inCubic(prog(t, out, out + outDur)) * 110;
  tf(e, `translate3d(0,${y.toFixed(2)}%,0)`);
}
// 색수차 글리치 (text-shadow)
function glitch(e, t, t0, dur = 0.2, amt = 12) {
  const k = prog(t, t0, t0 + dur);
  if (k <= 0 || k >= 1) { css(e, 'textShadow', 'none'); return 0; }
  const f = Math.floor(t * 60), a = amt * (1 - k);
  const d1 = (hash(f) * 2 - 1) * a, d2 = (hash(f + 3.3) * 2 - 1) * a;
  css(e, 'textShadow', `${d1.toFixed(1)}px 0 rgba(255,40,96,.8), ${d2.toFixed(1)}px 0 rgba(17,230,230,.8)`);
  return a;
}
// 글자를 순서대로 찍어내는 타자 효과
function typeOn(e, full, t, t0, dur) {
  const n = Math.round(full.length * prog(t, t0, t0 + dur));
  const cursor = n < full.length && n > 0 && Math.floor(t * 16) % 2 === 0 ? '▍' : '';
  txt(e, full.slice(0, n) + cursor);
}
// 일정 시각에 터지는 감쇠 펄스 (0~1)
function pulse(t, t0, dur) { const k = (t - t0) / dur; return k < 0 || k > 1 ? 0 : 1 - E.outCubic(k); }

/* ------------------------------------------------------------- 공용 데이터 */
const teamByNo = Object.fromEntries(K.teams.map(t => [t.no, t]));
const ORDER = TL.teamOrder.map(n => teamByNo[n]);
const provByCode = Object.fromEntries(K.provinces.map(p => [p.code, p]));
const SLOTS = ORDER.map((team, i) => {
  const t0 = i < 8 ? TL.teamStartA + i * TL.teamDur : TL.teamStartB + (i - 8) * TL.teamDur;
  return { team, i, t0, exit: t0 + TL.teamDur - TL.teamTravel };
});
const fmtLL = tm => `${tm.lat.toFixed(2)}°N ${tm.lon.toFixed(2)}°E`;

// 경로 문자열에서 부분 도형별 꼭짓점을 꺼내 본토 기준 경계 상자를 구합니다(멀리 떨어진 작은 섬 제외).
function mainBBox(d) {
  const subs = d.split('M').filter(Boolean).map(s => s.replace('Z', '').split('L').map(p => p.split(',').map(Number)));
  const area = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
  const big = Math.max(...subs.map(area));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  subs.filter(s => area(s) > big * 0.12).forEach(s => s.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/* ======================================================= 1. 훅 + 대회 로고 */
const hook = el(`<div class="layer" id="sHook">
  <img id="hkLumia" class="abs" src="assets/img/lumia_satellite_OFFICIAL_FANKIT_OLD_REFERENCE.png" style="left:510px;top:-43px;width:900px;height:1166px;">
  <div id="hkLine" class="abs" style="left:360px;top:652px;width:1200px;height:2px;background:var(--teal);box-shadow:0 0 18px var(--teal)"></div>
  ${[['KEL 2026 · SEASON', '16개의 <span class="teal">연고</span>.'], ['BATTLEFIELD', '하나의 섬, <span class="teal">루미아</span>.'], ['THE LAST ONE', '마지막에 남는 팀은']].map(([c, h], i) => `
  <div class="abs hkw" id="hkW${i}" style="left:0;right:0;top:380px;text-align:center">
    <div class="chip">${c}</div>
    <div class="mask" style="margin-top:30px"><div class="in h-xl kr nowrap">${h}</div></div>
  </div>`).join('')}
  <div id="hkNumWrap" class="abs" style="left:0;right:0;top:250px;text-align:center">
    <div id="hkNum" class="bc" style="font:900 420px/1 BarlowC;letter-spacing:-.02em">16</div>
    <div id="hkNumLbl" class="mono" style="font-size:30px;letter-spacing:.4em;color:var(--teal);margin-top:6px">SEASON</div>
  </div>
  <div id="lkWrap" class="layer">
    <div id="lkRing" class="abs" style="left:560px;top:140px;width:800px;height:800px;border-radius:50%;border:3px solid var(--teal)"></div>
    <div id="lkSparks" class="layer"></div>
    <div id="lkKel" class="abs bc" style="left:0;right:0;top:150px;text-align:center;font:900 330px/1 BarlowC;letter-spacing:.01em">KEL</div>
    <div class="abs mask" style="left:0;right:0;top:480px;text-align:center">
      <div class="in bc" id="lkChamp" style="font:800 italic 118px/1.05 BarlowC;letter-spacing:.05em"><span class="teal">2026</span> CHAMPIONSHIP</div>
    </div>
    <div id="lkRule" class="abs" style="left:610px;top:640px;width:700px;height:2px;background:linear-gradient(90deg,transparent,var(--teal),transparent)"></div>
    <div id="lkKr" class="abs" style="left:0;right:0;top:672px;text-align:center;font:800 46px/1.2 Pretendard;letter-spacing:-.01em">이터널 리턴 · KEL 챔피언십 결승전</div>
    <div id="lkMono" class="abs mono" style="left:0;right:0;top:746px;text-align:center;font-size:26px;letter-spacing:.32em;color:var(--teal)"></div>
  </div>
</div>`);
scenes.appendChild(hook);
const hk = {
  lumia: $('#hkLumia'), line: $('#hkLine'), words: [0, 1, 2].map(i => $('#hkW' + i)),
  numWrap: $('#hkNumWrap'), num: $('#hkNum'), numLbl: $('#hkNumLbl'),
  lk: $('#lkWrap'), ring: $('#lkRing'), kel: $('#lkKel'), champ: $('#lkChamp'), rule: $('#lkRule'), kr: $('#lkKr'), mono: $('#lkMono'),
};
const SPARKS = (() => {
  const R = mulberry32(8), box = $('#lkSparks'), arr = [];
  for (let i = 0; i < 56; i++) {
    const a = R() * Math.PI * 2, len = 14 + R() * 46, e = el(`<i class="abs" style="left:960px;top:540px;width:${len.toFixed(0)}px;height:3px;margin-top:-1.5px;background:${R() < .25 ? '#fff' : 'var(--teal)'};transform-origin:0 50%"></i>`);
    box.appendChild(e);
    arr.push({ e, a, d: 260 + R() * 760, delay: R() * 0.08, life: 0.7 + R() * 0.9 });
  }
  return arr;
})();
const HOOK_NUMS = [['16', 'SEASON'], ['12', 'CHAMPIONSHIP'], ['8', 'FINAL'], ['1', 'CHAMPION']];

function renderHook(t) {
  const on = t < 12.05;
  show(hook, on); if (!on) return;
  // 가운데 가로선
  const lk = E.outExpo(prog(t, 0.2, 1.0));
  tf(hk.line, `scaleX(${lk.toFixed(3)})`);
  op(hk.line, (0.85 * (1 - prog(t, 5.9, 6.0))) * (0.75 + 0.25 * Math.sin(t * 9)));
  // 세 단어
  TL.hookWords.forEach((w, i) => {
    const e = hk.words[i], next = i < 2 ? TL.hookWords[i + 1] : TL.hookNums[0];
    const vis = t > w - 0.05 && t < next;
    show(e, vis); if (!vis) return;
    rise(e.children[0], t, w, { out: next - 0.2, outDur: 0.15 });
    const head = e.querySelector('.in');
    maskIn(head, t, w + 0.06, { dur: 0.55, out: next - 0.22, outDur: 0.2 });
    glitch(head, t, w + 0.06, 0.22, 14);
  });
  // 루미아 섬 실루엣 (실제 공식 팬키트 지도)
  const lv = t > 2.3 && t < 4.5;
  show(hk.lumia, lv);
  if (lv) {
    op(hk.lumia, 0.26 * prog(t, 2.35, 2.7) * (1 - prog(t, 4.0, 4.4)));
    tf(hk.lumia, `scale(${lerp(1.3, 1.1, E.outCubic(prog(t, 2.35, 4.4))).toFixed(4)}) rotate(${lerp(-3, 0, prog(t, 2.35, 4.4)).toFixed(2)}deg)`);
  }
  // 16 → 12 → 8 → 1
  const nv = t >= TL.hookNums[0] && t < 8.0;
  show(hk.numWrap, nv);
  if (nv) {
    let idx = 0; TL.hookNums.forEach((n, i) => { if (t >= n) idx = i; });
    const tn = TL.hookNums[idx];
    txt(hk.num, HOOK_NUMS[idx][0]); txt(hk.numLbl, HOOK_NUMS[idx][1]);
    const last = idx === 3;
    css(hk.num, 'color', last ? 'var(--gold)' : 'var(--white)');
    css(hk.numLbl, 'color', last ? 'var(--gold)' : 'var(--teal)');
    const punch = 1 + 0.28 * (1 - E.outExpo(prog(t, tn, tn + 0.16)));
    const grow = last ? lerp(1, 1.7, E.inCubic(prog(t, 6.9, 7.98))) : 1;
    tf(hk.num, `scale(${(punch * grow).toFixed(4)})`);
    glitch(hk.num, t, tn, 0.16, 26);
    op(hk.numLbl, last ? 1 - prog(t, 7.3, 7.7) : 1);
    css(hk.num, 'filter', last && t > 7.5 ? `blur(${(prog(t, 7.5, 8) * 10).toFixed(1)}px) brightness(${(1 + prog(t, 7.5, 8) * 1.5).toFixed(2)})` : 'none');
  }
  // 로고 잠금
  const L = TL.logoHit, lv2 = t >= L;
  show(hk.lk, lv2);
  if (lv2) {
    const exitK = E.inCubic(prog(t, 11.55, 11.95));
    tf(hk.lk, `scale(${(lerp(1, 1.035, prog(t, L, 11.55)) + exitK * 0.12).toFixed(4)})`);
    op(hk.lk, 1 - exitK);
    const s = 1 + 0.65 * (1 - E.outExpo(prog(t, L, L + 0.3)));
    tf(hk.kel, `scale(${s.toFixed(4)})`);
    css(hk.kel, 'letterSpacing', `${lerp(0.25, 0.01, E.outExpo(prog(t, L, L + 0.5))).toFixed(3)}em`);
    glitch(hk.kel, t, L, 0.32, 30);
    const rk = prog(t, L, L + 0.9);
    tf(hk.ring, `scale(${lerp(0.05, 2.6, E.outCubic(rk)).toFixed(3)})`);
    op(hk.ring, (1 - rk) * 0.9); css(hk.ring, 'borderWidth', `${lerp(14, 1, rk).toFixed(1)}px`);
    SPARKS.forEach(sp => {
      const k = prog(t, L + sp.delay, L + sp.delay + sp.life);
      if (k <= 0 || k >= 1) { op(sp.e, 0); return; }
      const d = sp.d * E.outExpo(k);
      tf(sp.e, `rotate(${sp.a}rad) translateX(${d.toFixed(1)}px) scaleX(${(1 - k).toFixed(3)})`);
      op(sp.e, 1 - k);
    });
    maskIn(hk.champ, t, L + 0.22, { dur: 0.55 });
    tf(hk.rule, `scaleX(${E.outExpo(prog(t, L + 0.45, L + 1.1)).toFixed(3)})`);
    rise(hk.kr, t, L + 0.55, { dur: 0.35 });
    typeOn(hk.mono, '2026.11.08 · DAEJEON', t, L + 0.85, 0.7);
  }
}

/* ============================================================ 2. 대회 소개 */
const intro = el(`<div class="layer" id="sIntro">
  <div id="inMarq" class="layer">${[0, 1, 2].map(i => `<div class="abs bc nowrap" style="left:0;top:${150 + i * 300}px;font:900 italic 230px/1 BarlowC;color:transparent;-webkit-text-stroke:2px rgba(17,207,208,.075);letter-spacing:.02em">${'KEL CHAMPIONSHIP 2026 — THE FINAL — '.repeat(4)}</div>`).join('')}</div>
  <div class="abs" style="left:120px;top:250px;width:1120px">
    <div class="chip" id="inChip">THE FINAL STAGE</div>
    <div style="position:relative;margin-top:34px;height:240px">
      <div class="abs" style="left:0;top:0"><div class="mask"><div class="in kr nowrap" id="inA0" style="font:840 98px/1.12 Pretendard;letter-spacing:-.03em">모든 서킷의 결과가</div></div><div class="mask"><div class="in kr nowrap teal" id="inA1" style="font:840 98px/1.12 Pretendard;letter-spacing:-.03em">하나의 무대로.</div></div></div>
      <div class="abs" style="left:0;top:0"><div class="mask"><div class="in kr nowrap" id="inB0" style="font:840 98px/1.12 Pretendard;letter-spacing:-.03em">시즌 우승을 결정하는</div></div><div class="mask"><div class="in kr nowrap teal" id="inB1" style="font:840 98px/1.12 Pretendard;letter-spacing:-.03em">마지막 무대.</div></div></div>
    </div>
    <div id="inSub" class="body" style="margin-top:44px">2026 KEL 챔피언십 결승전 · 이터널 리턴</div>
  </div>
  <div id="inEm" class="abs" style="left:1290px;top:255px;width:520px;height:520px">
    <svg width="520" height="520" viewBox="-260 -260 520 520" style="position:absolute;left:0;top:0;overflow:visible">
      <defs><path id="emPath" d="M0,-222 A222,222 0 1 1 -0.01,-222"/></defs>
      <circle r="250" fill="none" stroke="rgba(17,207,208,.25)" stroke-width="1.5"/>
      <circle id="emArc" r="250" fill="none" stroke="#11CFD0" stroke-width="4" stroke-dasharray="1571" stroke-dashoffset="1571" transform="rotate(-90)"/>
      <circle r="190" fill="rgba(17,207,208,.05)" stroke="rgba(17,207,208,.35)" stroke-width="1.5" stroke-dasharray="4 8"/>
      <g id="emRot"><text font-family="BarlowC" font-weight="800" font-size="27" letter-spacing="7.5" fill="#11CFD0"><textPath href="#emPath">2026 KEL CHAMPIONSHIP · ETERNAL RETURN · THE FINAL · 2026 KEL CHAMPIONSHIP · ETERNAL RETURN ·</textPath></text></g>
      <g id="emTicks">${Array.from({ length: 60 }, (_, i) => `<line x1="0" y1="-${i % 5 ? 160 : 150}" x2="0" y2="-170" stroke="rgba(245,248,250,${i % 5 ? .2 : .6})" stroke-width="2" transform="rotate(${i * 6})"/>`).join('')}</g>
    </svg>
    <div class="abs" style="left:0;right:0;top:170px;text-align:center">
      <div class="mono" style="font-size:22px;letter-spacing:.5em;color:var(--teal)">THE</div>
      <div id="emFinal" class="bc" style="font:900 italic 150px/1 BarlowC;letter-spacing:.02em">FINAL</div>
      <div class="mono" style="font-size:20px;letter-spacing:.3em;color:var(--muted);margin-top:6px">2026 · KEL</div>
    </div>
  </div>
</div>`);
scenes.appendChild(intro);
const inn = { chip: $('#inChip'), a: [$('#inA0'), $('#inA1')], b: [$('#inB0'), $('#inB1')], sub: $('#inSub'), em: $('#inEm'), arc: $('#emArc'), rot: $('#emRot'), ticks: $('#emTicks'), fin: $('#emFinal'), marq: $$('#inMarq > div') };

function renderIntro(t) {
  const on = t >= 11.95 && t < 20.05;
  show(intro, on); if (!on) return;
  const out = 19.55;
  inn.marq.forEach((m, i) => { tf(m, `translate3d(${((i % 2 ? -1 : 1) * (t - 12) * 38 - (i % 2 ? 0 : 900)).toFixed(1)}px,0,0)`); });
  rise(inn.chip, t, 12.1, { out, outDur: 0.3 });
  maskIn(inn.a[0], t, 12.2, { out: 15.55 }); maskIn(inn.a[1], t, 12.5, { out: 15.62 });
  glitch(inn.a[1], t, 12.5, 0.2, 10);
  maskIn(inn.b[0], t, 16.0, { out }); maskIn(inn.b[1], t, 16.5, { out: out + 0.06 });
  glitch(inn.b[1], t, 16.5, 0.2, 10);
  rise(inn.sub, t, 17.0, { out, outDur: 0.3 });
  // 원형 엠블럼: 등장 후 박자마다 살짝 튐
  const ek = E.outExpo(prog(t, 12.3, 13.1));
  const bp = t > 13 ? pulse(sinceBeat(t), 0, 0.3) * 0.018 : 0;
  tf(inn.em, `scale(${(lerp(0.7, 1, ek) + bp - E.inCubic(prog(t, out, out + 0.4)) * 0.2).toFixed(4)})`);
  op(inn.em, ek * (1 - prog(t, out, out + 0.4)));
  attr(inn.arc, 'stroke-dashoffset', (1571 * (1 - E.inOutCubic(prog(t, 12.3, 14.2)))).toFixed(1));
  attr(inn.rot, 'transform', `rotate(${((t - 12) * 14).toFixed(2)})`);
  attr(inn.ticks, 'transform', `rotate(${(-(t - 12) * 6).toFixed(2)})`);
  glitch(inn.fin, t, 16.0, 0.22, 16);
}

/* ============================================================ 3. 대한민국 지도 */
const PANEL = { x: 820, y: 130, w: 1040, h: 860 };
const OV = { cx: 480, cy: 585, vh: 930 };
const mapLayer = el(`<div id="mapLayer">
  <div id="mapPanel">
    <svg id="mapSvg" viewBox="0 0 1000 1180" preserveAspectRatio="xMidYMid meet">
      <defs><pattern id="dotPat" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="0.95" fill="rgba(17,207,208,.22)"/></pattern></defs>
      <g id="gGlow">${K.provinces.map(p => `<path class="provGlow" d="${p.d}"/>`).join('')}</g>
      <g id="gProv">${K.provinces.map(p => `<path class="prov" data-code="${p.code}" d="${p.d}"/>`).join('')}</g>
      <g id="gDots">${K.provinces.map(p => `<path class="provDots" d="${p.d}"/>`).join('')}</g>
      <path id="hl0" class="hl" d=""/><path id="hl1" class="hl" d=""/>
    </svg>
    <svg id="leaders"></svg>
    <div id="pins"></div>
    <div id="mapScan" class="abs" style="left:0;width:1040px;height:3px;background:var(--teal);box-shadow:0 0 22px 4px rgba(17,207,208,.7)"></div>
  </div>
</div>`);
scenes.appendChild(mapLayer);
const mp = { panel: $('#mapPanel'), svg: $('#mapSvg'), hl: [$('#hl0'), $('#hl1')], pins: $('#pins'), leaders: $('#leaders'), scan: $('#mapScan') };
const camScale = c => PANEL.h / c.vh;
function toPanel(c, x, y) { const s = camScale(c), vw = c.vh * PANEL.w / PANEL.h; return [(x - (c.cx - vw / 2)) * s, (y - (c.cy - c.vh / 2)) * s]; }
function setCam(c) { const vw = c.vh * PANEL.w / PANEL.h; attr(mp.svg, 'viewBox', `${(c.cx - vw / 2).toFixed(2)} ${(c.cy - c.vh / 2).toFixed(2)} ${vw.toFixed(2)} ${c.vh.toFixed(2)}`); }
const lerpCam = (a, b, k) => ({ cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), vh: Math.exp(lerp(Math.log(a.vh), Math.log(b.vh), k)) });

// 핀 · 라벨 · 연결선
const PINS = K.teams.map(tm => {
  const pin = el(`<div class="pin"><i></i><i></i><b></b></div>`);
  const side = [16, 14, 3, 7, 9, 6, 4, 10, 13].includes(tm.no) ? 'L' : 'R';
  const lab = el(`<div class="plabel ${side}"><div class="pn kr">${tm.name}</div><div class="pr">${tm.short}</div></div>`);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  mp.pins.appendChild(pin); mp.pins.appendChild(lab); mp.leaders.appendChild(line);
  return { tm, pin, dot: pin.querySelector('b'), rings: $$('i', pin), lab, line, side, ly: 0 };
});
const pinByNo = Object.fromEntries(PINS.map(p => [p.tm.no, p]));
// 개요 지도용 라벨 세로 위치(겹침 방지): 같은 쪽 라벨끼리 최소 간격을 둡니다.
(function layoutLabels() {
  const cam = { ...OV, vh: 900 };
  ['L', 'R'].forEach(side => {
    const list = PINS.filter(p => p.side === side).map(p => ({ p, y: toPanel(cam, p.tm.x, p.tm.y)[1] })).sort((a, b) => a.y - b.y);
    let prev = -1e9;
    list.forEach(o => { o.y = Math.max(o.y, prev + 60); prev = o.y; });
    const over = prev - 820; if (over > 0) list.forEach(o => { o.y -= over; });
    list.forEach(o => { o.p.ly = o.y; });
  });
})();
const LABEL_X = { L: 238, R: 742 };
// 팀별 카메라: 도 단위는 본토 경계 상자에 맞추고, 시 단위는 핀 위치로 바짝 다가갑니다.
SLOTS.forEach(s => {
  const tm = s.team;
  if (tm.kind === 'city') { s.cam = { cx: tm.x, cy: tm.y, vh: 250 }; s.hlCode = '31'; s.hlAlpha = 0.35; return; }
  const b = mainBBox(provByCode[tm.code].d);
  s.cam = { cx: b.cx, cy: b.cy, vh: clamp(Math.max(b.h, b.w * PANEL.h / PANEL.w) * 1.55, 250, 760) };
  s.hlCode = tm.code; s.hlAlpha = 1;
  s.bbox = b;
});
// 포커스 라벨(현재 팀) 2개를 번갈아 씁니다.
const FOCUS = [0, 1].map(() => {
  const f = el(`<div class="focusLabel"><div class="a kr"></div><div class="b"></div></div>`);
  mp.pins.appendChild(f); return { f, a: f.children[0], b: f.children[1] };
});
const RETICLE = el(`<div class="reticle"><svg width="10" height="10" viewBox="-1 -1 2 2" style="left:-5px;top:-5px;width:10px;height:10px">
  <g id="rtRot"><circle r="0.96" fill="none" stroke="#11CFD0" stroke-width="0.012" stroke-dasharray="0.16 0.06"/></g>
  <circle r="0.8" fill="none" stroke="rgba(245,248,250,.35)" stroke-width="0.008"/>
  ${[0, 90, 180, 270].map(a => `<line x1="0" y1="-1.08" x2="0" y2="-0.9" stroke="#11CFD0" stroke-width="0.03" transform="rotate(${a})"/>`).join('')}
</svg></div>`);
mp.pins.appendChild(RETICLE);
const rtSvg = RETICLE.querySelector('svg'), rtRot = RETICLE.querySelector('#rtRot');
// 결승 장소 핀
const VPIN = el(`<div class="pin" style="z-index:3"><i></i><i></i><i></i><b style="background:var(--gold);box-shadow:0 0 0 4px rgba(6,23,34,.8),0 0 30px rgba(244,195,90,.95)"></b></div>`);
mp.pins.appendChild(VPIN);
const VLAB = el(`<div class="focusLabel"><div class="a kr" style="border-left-color:var(--gold)">대전 이스포츠 경기장</div><div class="b" style="color:var(--gold)">FINAL VENUE · DAEJEON</div></div>`);
mp.pins.appendChild(VLAB);
$$('i', VPIN).forEach(r => css(r, 'borderColor', 'var(--gold)'));

// 레티클 반경과 중심: 도 단위는 본토 경계 상자, 그 밖은 핀 위치 기준
const reticleR = (s, cam) => (s.bbox && s.team.kind === 'province' ? clamp(Math.max(s.bbox.w, s.bbox.h) * camScale(cam) * 0.5, 120, 330) : 92);
const reticleC = (s, cam) => (s.bbox && s.team.kind === 'province' ? toPanel(cam, s.bbox.cx, s.bbox.cy) : toPanel(cam, s.team.x, s.team.y));

// 시각 t의 지도 상태
function mapState(t) {
  const A0 = SLOTS[0], A7 = SLOTS[7], B0 = SLOTS[8], B7 = SLOTS[15];
  if (t >= 20 && t < A0.t0 - TL.teamTravel) {
    return { mode: 'overview', cam: { ...OV, vh: lerp(930, 890, E.inOutCubic(prog(t, 21, 31.5))) }, alpha: 1, scale: 1 };
  }
  const inA = t >= A0.t0 - TL.teamTravel && t < A7.exit + 0.45;
  const inB = t >= B0.t0 - TL.teamTravel && t < B7.exit + 0.45;
  if (inA || inB) {
    let cur = SLOTS[inA ? 0 : 8];
    SLOTS.forEach(s => { if ((inA ? s.i < 8 : s.i >= 8) && t >= s.t0 - TL.teamTravel) cur = s; });
    const prev = cur.i === 0 ? { ...OV, vh: 890 } : cur.i === 8 ? cur.cam : SLOTS[cur.i - 1].cam;
    const k = E.inOutCubic(prog(t, cur.t0 - TL.teamTravel, cur.t0));
    const last = inA ? A7 : B7;
    const ex = prog(t, last.exit, last.exit + 0.45);
    const en = inB ? prog(t, B0.t0 - TL.teamTravel, B0.t0) : 1;
    const drift = 1 - 0.04 * prog(t, cur.t0, cur.t0 + 3);
    const cam = lerpCam(prev, cur.cam, k); cam.vh *= drift;
    return { mode: 'team', slot: cur, k, cam, alpha: Math.min(1 - E.inCubic(ex), E.outCubic(en)), scale: 1 + E.inCubic(ex) * 0.18 + (1 - E.outExpo(en)) * 0.25 };
  }
  if (t >= 100 && t < 108) {
    const V = { cx: K.venue.x, cy: K.venue.y + 18, vh: OV.vh / 1.45 };
    let cam;
    if (t < 100.8) cam = lerpCam(OV, V, E.inOutCubic(prog(t, 100, 100.8)));               // 0.8초 100% → 145%
    else if (t < 107.3) cam = { ...V, vh: lerp(V.vh, V.vh * 0.82, prog(t, 100.8, 107.3)) };
    else cam = { ...V, cy: K.venue.y, vh: lerp(V.vh * 0.82, 22, E.inExpo(prog(t, 107.3, 108))) };
    return { mode: 'venue', cam, alpha: 1, scale: 1 };
  }
  if (t >= 116.5) {
    const k = E.outExpo(prog(t, 116.6, 117.6));
    return { mode: 'cta', cam: { cx: 470, cy: 590, vh: lerp(1150, 980, k) }, alpha: k, scale: 1 };
  }
  return null;
}

function renderMap(t) {
  const st = mapState(t);
  show(mapLayer, !!st); if (!st) return;
  setCam(st.cam);
  op(mapLayer, st.alpha);
  // 지도 드로우-인: 위에서 아래로 스캔
  const rv = st.mode === 'overview' ? E.inOutCubic(prog(t, 20.05, 21.4)) : 1;
  css(mp.panel, 'clipPath', rv < 1 ? `inset(0 0 ${((1 - rv) * 100).toFixed(2)}% 0)` : 'none');
  show(mp.scan, rv > 0 && rv < 1 || (st.mode === 'overview' && t > 26 && t < 28.2));
  if (rv < 1) { tf(mp.scan, `translate3d(0,${(rv * PANEL.h).toFixed(1)}px,0)`); op(mp.scan, 1); }
  else if (st.mode === 'overview') { const sk = prog(t, 26, 28.2); tf(mp.scan, `translate3d(0,${(sk * PANEL.h).toFixed(1)}px,0)`); op(mp.scan, 0.45 * Math.sin(sk * Math.PI)); }
  // 팀 슬램마다 패널이 살짝 튀는 펀치
  let punch = 0;
  if (st.mode === 'team') punch = pulse(t, st.slot.t0, 0.35) * 0.025;
  tf(mp.panel, `scale(${(st.scale + punch).toFixed(4)})`);

  // 하이라이트
  mp.hl.forEach((h, j) => {
    let a = 0;
    if (st.mode === 'team') {
      SLOTS.forEach(s => {
        if (s.i % 2 !== j) return;
        const vis = t >= s.t0 - 0.2 && t < s.exit + 0.4;
        if (!vis) return;
        attr(h, 'd', provByCode[s.hlCode].d);
        a = s.hlAlpha * E.outCubic(prog(t, s.t0 - 0.2, s.t0)) * (1 - prog(t, s.exit, s.exit + 0.4));
        a *= 1 + 0.8 * pulse(t, s.t0, 0.5);
      });
    } else if (st.mode === 'venue' || st.mode === 'cta') {
      if (j === 0) { attr(h, 'd', provByCode['25'].d); a = st.mode === 'venue' ? E.outCubic(prog(t, 100.3, 100.9)) : 0.9; }
    }
    css(h, 'fill', `rgba(17,207,208,${(0.26 * Math.min(a, 1.6)).toFixed(3)})`);
    op(h, Math.min(1, a));
  });

  // 핀
  const cam = st.cam;
  PINS.forEach((P, idx) => {
    const [x, y] = toPanel(cam, P.tm.x, P.tm.y);
    const ord = TL.teamOrder.indexOf(P.tm.no);
    let a = 0, sc = 1, ringK = -1, labA = 0, isOn = false;
    if (st.mode === 'overview') {
      const td = TL.pinDropStart + ord * TL.pinDropStep;
      const k = prog(t, td, td + 0.4);                     // 핀 등장 24f(0.4초): 한 번 강조 후 정지
      a = k > 0 ? 1 : 0; sc = k > 0 ? E.outBack(k) : 0;
      ringK = prog(t, td, td + 0.7);
      labA = prog(t, td + 0.05, td + 0.35) * (1 - prog(t, 30.6, 31.1));
      a *= 1 - 0.6 * prog(t, 31.0, 31.5);
      sc *= 1 - 0.35 * prog(t, 31.0, 31.5);
    } else if (st.mode === 'team') {
      const cur = st.slot.team.no === P.tm.no;
      a = cur ? 1 : 0.4; sc = cur ? 1 + 0.6 * pulse(t, st.slot.t0, 0.4) : 0.6; isOn = cur;
      if (cur) ringK = ((t - st.slot.t0) % 1.0) / 1.0;
    } else {
      a = st.mode === 'cta' ? 0.35 : 0.3; sc = 0.55;
    }
    show(P.pin, a > 0);
    if (a > 0) { tf(P.pin, `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${sc.toFixed(3)})`); op(P.pin, a); P.pin.classList.toggle('on', isOn); }
    P.rings.forEach((r, ri) => {
      const k = ringK < 0 ? -1 : (ringK + ri * 0.5) % 1;
      if (k < 0 || (st.mode === 'overview' && ri > 0)) { op(r, 0); return; }
      tf(r, `scale(${lerp(0.3, 2.0, E.outCubic(k)).toFixed(3)})`); op(r, (1 - k) * 0.9);
    });
    // 개요 라벨 + 연결선
    show(P.lab, labA > 0); show(P.line, labA > 0);
    if (labA > 0) {
      const lx = LABEL_X[P.side], ly = P.ly;
      const w = P.lab.offsetWidth || 160;
      const left = P.side === 'L' ? lx - w : lx;
      tf(P.lab, `translate3d(${left.toFixed(1)}px,${(ly - 26 + (1 - labA) * 12).toFixed(1)}px,0)`); op(P.lab, labA);
      const ex = P.side === 'L' ? lx + 6 : lx - 6;
      const k = E.outCubic(labA);
      attr(P.line, 'x1', x.toFixed(1)); attr(P.line, 'y1', y.toFixed(1));
      attr(P.line, 'x2', lerp(x, ex, k).toFixed(1)); attr(P.line, 'y2', lerp(y, ly, k).toFixed(1));
      op(P.line, labA);
    }
  });

  // 팀 포커스 라벨 + 레티클
  FOCUS.forEach((F, j) => {
    let vis = false;
    if (st.mode === 'team') {
      SLOTS.forEach(s => {
        if (s.i % 2 !== j || !(t >= s.t0 - 0.05 && t < s.exit + 0.3)) return;
        vis = true;
        const [x, y] = toPanel(cam, s.team.x, s.team.y);
        txt(F.a, s.team.home); txt(F.b, `HOME · ${s.team.en}`);
        // 레티클 바깥 오른쪽 위 → 왼쪽 위 → 레티클 안쪽 위 순서로 들어갈 자리를 찾습니다.
        const R = reticleR(s, cam), c = reticleC(s, cam);
        const w = F.f.offsetWidth || 300, hgt = 100;
        const cands = [[c[0] + R * 0.72 + 24, c[1] - R * 0.72 - 70, true], [c[0] - R * 0.72 - 24 - w, c[1] - R * 0.72 - 70, false], [c[0] + R * 0.25, c[1] - R * 0.9, true]];
        const fits = ([x0, y0]) => x0 >= 150 && x0 + w <= PANEL.w - 20 && y0 >= 10 && y0 + hgt <= PANEL.h - 10;
        const [fx0, fy0, right] = cands.find(fits) || cands[2];
        const fx = clamp(fx0, 150, PANEL.w - 20 - w), fy = clamp(fy0, 10, PANEL.h - hgt - 10);
        const k = E.outExpo(prog(t, s.t0 + 0.08, s.t0 + 0.5)), q = E.inCubic(prog(t, s.exit, s.exit + 0.3));
        tf(F.f, `translate3d(${(fx + (1 - k) * (right ? -20 : 20)).toFixed(1)}px,${fy.toFixed(1)}px,0)`);
        op(F.f, k * (1 - q));
        css(F.f, 'alignItems', right ? 'flex-start' : 'flex-end');
      });
    }
    show(F.f, vis);
  });
  let rv2 = false;
  if (st.mode === 'team') {
    const s = st.slot;
    const r = reticleR(s, cam);
    const k = E.outExpo(prog(t, s.t0, s.t0 + 0.5)), q = prog(t, s.exit, s.exit + 0.3);
    if (k > 0 && q < 1) {
      rv2 = true;
      const cx = reticleC(s, cam);
      tf(RETICLE, `translate3d(${cx[0].toFixed(1)}px,${cx[1].toFixed(1)}px,0)`);
      const R = r * lerp(1.5, 1, k);
      css(rtSvg, 'width', `${(R * 2).toFixed(1)}px`); css(rtSvg, 'height', `${(R * 2).toFixed(1)}px`);
      css(rtSvg, 'left', `${(-R).toFixed(1)}px`); css(rtSvg, 'top', `${(-R).toFixed(1)}px`);
      attr(rtRot, 'transform', `rotate(${((t - s.t0) * 40).toFixed(1)})`);
      op(RETICLE, k * (1 - q) * 0.9);
    }
  }
  show(RETICLE, rv2);
  // 결승 장소 핀
  const vOn = st.mode === 'venue' || st.mode === 'cta';
  show(VPIN, vOn); show(VLAB, vOn);
  if (vOn) {
    const [x, y] = toPanel(cam, K.venue.x, K.venue.y);
    const t0 = st.mode === 'venue' ? 100.5 : 117.2;
    const k = prog(t, t0, t0 + 0.4);
    tf(VPIN, `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(k > 0 ? E.outBack(k) * 1.25 : 0).toFixed(3)})`);
    $$('i', VPIN).forEach((r, ri) => {
      if (k <= 0) { op(r, 0); return; }
      const rk = ((t - t0) / (BEAT * 2) + ri / 3) % 1;
      tf(r, `scale(${lerp(0.4, 3.2, E.outCubic(rk)).toFixed(3)})`); op(r, (1 - rk) * 0.85);
    });
    const lk = E.outExpo(prog(t, t0 + 0.3, t0 + 0.8));
    tf(VLAB, `translate3d(${(x + 60 + (1 - lk) * -20).toFixed(1)}px,${(y - 110).toFixed(1)}px,0)`);
    op(VLAB, lk * (st.mode === 'venue' ? 1 - prog(t, 107.2, 107.5) : 1));
  }
}

/* --------------------------------------------- 개요 지도 왼쪽 문구 */
const mapText = el(`<div class="layer" id="sMap">
  <div class="abs" style="left:120px;top:205px;width:700px">
    <div class="chip" id="mtChip">SEASON 16 TEAMS</div>
    <div class="mask" style="margin-top:34px"><div class="in h-xl kr" id="mtA">우리 지역<span class="teal">.</span></div></div>
    <div class="mask"><div class="in h-xl kr teal" id="mtB">우리 팀<span style="color:var(--white)">.</span></div></div>
    <div id="mtCount" style="margin-top:46px;display:flex;align-items:baseline;gap:14px">
      <span id="mtN" class="bc teal" style="font:900 200px/0.86 BarlowC">00</span><span class="bc muted" style="font:800 60px/1 BarlowC">/16</span>
    </div>
    <div id="mtSub" class="body" style="margin-top:30px">시즌 참가 16팀 · 공식 연고 기준</div>
  </div>
</div>`);
scenes.appendChild(mapText);
const mt = { chip: $('#mtChip'), a: $('#mtA'), b: $('#mtB'), count: $('#mtCount'), n: $('#mtN'), sub: $('#mtSub') };
function renderMapText(t) {
  const on = t >= 19.95 && t < 31.6;
  show(mapText, on); if (!on) return;
  const out = 30.95;
  rise(mt.chip, t, 20.3, { out });
  maskIn(mt.a, t, 20.5, { out }); maskIn(mt.b, t, 21.0, { out: out + 0.05 });
  glitch(mt.b, t, 21.0, 0.2, 10);
  rise(mt.count, t, 21.3, { out }); rise(mt.sub, t, 21.6, { out });
  const n = clamp(Math.floor((t - TL.pinDropStart) / TL.pinDropStep) + 1, 0, 16);
  txt(mt.n, pad2(n));
  const last = TL.pinDropStart + Math.max(0, n - 1) * TL.pinDropStep;
  tf(mt.n, `scale(${(1 + 0.12 * (n > 0 ? pulse(t, last, 0.2) : 0)).toFixed(3)})`);
  css(mt.n, 'transformOrigin', 'left bottom');
}

/* ============================================================ 4. 팀 소개 */
const teamWrap = el(`<div class="layer" id="sTeams">
  ${[0, 1].map(j => `<div class="bigWord" id="bw${j}"></div>`).join('')}
  <div class="abs" id="tpKick" style="left:120px;top:190px;display:flex;align-items:center;gap:16px"><span class="chip">SEASON TEAM</span><span class="mono" style="font-size:19px;color:var(--muted);letter-spacing:.08em">시즌 참가팀 소개 순서</span></div>
  ${[0, 1].map(j => `<div class="teamPanel" id="tp${j}" style="top:250px">
    <div class="num"><div class="mask"><span class="in n"></span></div><span class="d">/16</span></div>
    <div class="nameWrap"><div class="name"></div></div>
    <div class="home"><span class="lbl">연고</span><span class="hv"></span></div>
    <div class="coord"></div>
    <div class="logoSlot">[TEAM_LOGO]<br>공식 로고<br>교체</div>
  </div>`).join('')}
  <div id="teamTicks">${Array.from({ length: 16 }, () => '<i></i>').join('')}<span></span></div>
</div>`);
scenes.appendChild(teamWrap);
const TP = [0, 1].map(j => {
  const p = $('#tp' + j);
  return { p, n: $('.n', p), d: $('.d', p), name: $('.name', p), nameWrap: $('.nameWrap', p), home: $('.home', p), hv: $('.hv', p), coord: $('.coord', p), bw: $('#bw' + j) };
});
const tpKick = $('#tpKick'), ticks = $$('#teamTicks i'), ticksLbl = $('#teamTicks span'), ticksBox = $('#teamTicks');

function renderTeams(t) {
  const on = (t >= SLOTS[0].t0 - 0.5 && t < SLOTS[7].exit + 0.5) || (t >= SLOTS[8].t0 - 0.5 && t < SLOTS[15].exit + 0.5);
  show(teamWrap, on); if (!on) return;
  const inA = t < 60;
  const gs = inA ? SLOTS[0].t0 : SLOTS[8].t0, ge = inA ? SLOTS[7].exit : SLOTS[15].exit;
  rise(tpKick, t, gs - 0.3, { out: ge, outDur: 0.3 });
  rise(ticksBox, t, gs - 0.2, { out: ge, outDur: 0.3 });
  let curI = -1;
  SLOTS.forEach(s => { if (t >= s.t0 - 0.1) curI = s.i; });
  ticks.forEach((e, i) => { e.className = i < curI ? 'done' : i === curI ? 'cur' : ''; });
  txt(ticksLbl, curI >= 0 ? `시즌 소개 ${pad2(curI + 1)} / 16` : '');

  TP.forEach((P, j) => {
    let vis = false;
    SLOTS.forEach(s => {
      if (s.i % 2 !== j) return;
      if (!(t >= s.t0 - 0.3 && t < s.exit + 0.45)) return;
      vis = true;
      const tm = s.team;
      txt(P.n, pad2(s.i + 1)); txt(P.name, tm.name); txt(P.hv, tm.home); txt(P.bw, tm.en);
      // 번호: 슬롯머신처럼 이전 번호를 밀어 올리며 등장
      const nk = E.outExpo(prog(t, s.t0 - 0.12, s.t0 + 0.3)), nq = E.inCubic(prog(t, s.exit, s.exit + 0.3));
      tf(P.n, `translate3d(0,${((1 - nk) * 100 - nq * 100).toFixed(2)}%,0)`);
      op(P.d, s.i === 0 || s.i === 8 ? prog(t, s.t0 - 0.12, s.t0 + 0.2) * (s.i === 7 || s.i === 15 ? 1 - nq : 1) : (s.i === 7 || s.i === 15 ? 1 - nq : 1));
      // 팀명: 슬램 + 글리치
      const k = E.outExpo(prog(t, s.t0, s.t0 + 0.45));
      const next = SLOTS[s.i + 1];
      let dir = 1;
      if (next && next.i % 8 !== 0) { dir = toPanel(OV, next.team.x, next.team.y)[0] >= toPanel(OV, tm.x, tm.y)[0] ? 1 : -1; }
      const q = E.inCubic(prog(t, s.exit, s.exit + 0.3));
      tf(P.name, `translate3d(${(-dir * q * 90).toFixed(1)}px,${((1 - k) * 60).toFixed(1)}px,0) scale(${(1 + (1 - k) * 0.08).toFixed(4)})`);
      op(P.name, Math.min(1, k * 1.6));
      css(P.nameWrap, 'clipPath', q > 0 ? (dir > 0 ? `inset(-20% ${(q * 100).toFixed(1)}% -20% 0)` : `inset(-20% 0 -20% ${(q * 100).toFixed(1)}%)`) : 'none');
      glitch(P.name, t, s.t0, 0.2, 16);
      rise(P.home, t, s.t0 + 0.18, { out: s.exit, outDur: 0.25 });
      typeOn(P.coord, `${tm.en} · ${fmtLL(tm)}`, t, s.t0 + 0.3, 0.45);
      op(P.coord, 1 - q);
      // 배경 대형 지역명
      op(P.bw, 0.9 * prog(t, s.t0 - 0.1, s.t0 + 0.3) * (1 - prog(t, s.exit, s.exit + 0.35)));
      tf(P.bw, `translate3d(${(80 - (t - s.t0) * 45).toFixed(1)}px,0,0)`);
    });
    show(P.p, vis); show(P.bw, vis);
  });
}

/* ============================================================ 5. 루미아 섬 */
const lumia = el(`<div class="layer" id="sLumia">
  <div id="luWrap" class="abs" style="left:1060px;top:136px;width:656px;height:850px">
    <div id="luScale" class="layer" style="transform-origin:50% 48%">
      <img id="luImg" src="assets/img/lumia_satellite_OFFICIAL_FANKIT_OLD_REFERENCE.png" style="position:absolute;left:0;top:0;width:656px;height:850px;filter:saturate(.8) contrast(1.06)">
      <div class="layer" style="background-image:linear-gradient(rgba(17,207,208,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(17,207,208,.09) 1px,transparent 1px);background-size:41px 42.5px;mix-blend-mode:screen"></div>
    </div>
    <div id="luScan" class="abs" style="left:-30px;width:716px;height:120px;background:linear-gradient(180deg,transparent,rgba(17,207,208,.18) 85%,rgba(17,207,208,.9) 99%,transparent)"></div>
    ${['left:-18px;top:-18px;border-width:3px 0 0 3px', 'right:-18px;top:-18px;border-width:3px 3px 0 0', 'left:-18px;bottom:-18px;border-width:0 0 3px 3px', 'right:-18px;bottom:-18px;border-width:0 3px 3px 0'].map(s => `<i class="abs luBr" style="${s};width:56px;height:56px;border-style:solid;border-color:var(--teal)"></i>`).join('')}
    <div class="abs mono" id="luTagA" style="left:0;top:-48px;font-size:18px;letter-spacing:.2em;color:var(--teal)">LUMIA ISLAND · MAP REFERENCE</div>
  </div>
  <div id="luRet" class="abs" style="left:1388px;top:544px;width:0;height:0">
    <svg viewBox="-200 -200 400 400" style="position:absolute;left:-200px;top:-200px;width:400px;height:400px;overflow:visible">
      <g id="luRot"><circle r="170" fill="none" stroke="#11CFD0" stroke-width="2" stroke-dasharray="40 14"/></g>
      <circle r="120" fill="none" stroke="rgba(245,248,250,.35)" stroke-width="1.2"/>
      <line x1="-200" y1="0" x2="-130" y2="0" stroke="#11CFD0" stroke-width="2"/><line x1="130" y1="0" x2="200" y2="0" stroke="#11CFD0" stroke-width="2"/>
      <line x1="0" y1="-200" x2="0" y2="-130" stroke="#11CFD0" stroke-width="2"/><line x1="0" y1="130" x2="0" y2="200" stroke="#11CFD0" stroke-width="2"/>
    </svg>
  </div>
  <div class="abs" style="left:120px;top:250px;width:860px">
    <div class="chip" id="luChip">BATTLEFIELD</div>
    <div style="position:relative;margin-top:34px;height:300px">
      <div class="abs" style="left:0;top:0"><div class="mask"><div class="in h-l kr nowrap" id="luA0">16팀이 싸워 온 전장,</div></div><div class="mask"><div class="in h-l kr nowrap teal" id="luA1">루미아 섬.</div></div></div>
      <div class="abs" style="left:0;top:0"><div class="mask"><div class="in h-l kr nowrap" id="luB0">이어서 나머지</div></div><div class="mask"><div class="in h-l kr nowrap teal" id="luB1">8팀을 소개합니다.</div></div></div>
    </div>
    <div class="mono" id="luData" style="margin-top:10px;font-size:20px;line-height:1.9;color:var(--muted);letter-spacing:.08em;white-space:pre"></div>
  </div>
  <div id="luCap" class="abs" style="left:120px;top:900px;font:500 19px/1 Pretendard;color:var(--muted)">지도 출처 · 이터널 리턴 공식 팬키트 위성 지도 (구버전 참고본, 바지선 미표시)</div>
</div>`);
scenes.appendChild(lumia);
const lu = { wrap: $('#luWrap'), sc: $('#luScale'), scan: $('#luScan'), br: $$('.luBr'), tag: $('#luTagA'), ret: $('#luRet'), rot: $('#luRot'), chip: $('#luChip'), a: [$('#luA0'), $('#luA1')], b: [$('#luB0'), $('#luB1')], data: $('#luData'), cap: $('#luCap') };
function renderLumia(t) {
  const on = t >= 55.6 && t < 64.02;
  show(lumia, on); if (!on) return;
  const enter = E.outExpo(prog(t, 55.75, 56.5));
  // 100% → 120% 확대(1.2초 기준 값을 구간 길이에 맞춰 천천히 적용) 후 다음 구간으로 돌진
  let s = lerp(1.0, 1.08, E.outCubic(prog(t, 56, 60))) * lerp(1, 1.111, E.inOutCubic(prog(t, 60, 61.2)));
  s *= lerp(1, 2.6, E.inExpo(prog(t, 63.3, 64)));
  tf(lu.sc, `scale(${s.toFixed(4)})`);
  op(lu.wrap, enter * (1 - prog(t, 63.75, 64)));
  tf(lu.wrap, `translate3d(${((1 - enter) * 120).toFixed(1)}px,0,0)`);
  const sk = prog(t, 56.2, 58.4);
  show(lu.scan, sk > 0 && sk < 1);
  tf(lu.scan, `translate3d(0,${lerp(-120, 850, sk).toFixed(1)}px,0)`);
  lu.br.forEach((b, i) => { const k = E.outExpo(prog(t, 56 + i * 0.05, 56.6 + i * 0.05)); op(b, k); tf(b, `scale(${lerp(1.8, 1, k).toFixed(3)})`); });
  rise(lu.tag, t, 56.4, { out: 63.6, outDur: 0.2 });
  const rk = E.outExpo(prog(t, 56.6, 57.3));
  op(lu.ret, rk * 0.85 * (1 - prog(t, 63.3, 63.7)));
  tf(lu.ret, `scale(${(lerp(1.6, 1, rk) * (1 + 0.04 * pulse(sinceBeat(t), 0, 0.3))).toFixed(4)})`);
  attr(lu.rot, 'transform', `rotate(${((t - 56) * 30).toFixed(1)})`);
  rise(lu.chip, t, 56.15, { out: 63.4, outDur: 0.25 });
  maskIn(lu.a[0], t, 56.3, { out: 59.6 }); maskIn(lu.a[1], t, 56.6, { out: 59.65 });
  glitch(lu.a[1], t, 56.6, 0.2, 10);
  maskIn(lu.b[0], t, 60.0, { out: 63.4 }); maskIn(lu.b[1], t, 60.3, { out: 63.45 });
  typeOn(lu.data, 'SOURCE   OFFICIAL FANKIT\nVERSION  OLD REFERENCE · 772×1000\nSEASON   16 TEAMS · 1 ISLAND', t, 57.0, 1.4);
  op(lu.data, 1 - prog(t, 63.3, 63.6));
  op(lu.cap, prog(t, 56.5, 57) * (1 - prog(t, 63.5, 63.8)));
}

/* ============================================================ 6. 결승 구조 */
const TILE_W = 196, TILE_H = 118, GAP = 18;
const road = el(`<div class="layer" id="sRoad">
  <div class="abs" style="left:120px;top:200px;width:640px">
    <div class="chip" id="rdChip">ROAD TO THE FINAL</div>
    <div class="mask" style="margin-top:30px"><div class="in h-l kr" id="rdH0">결승으로</div></div>
    <div class="mask"><div class="in h-l kr teal" id="rdH1">가는 길.</div></div>
    <div id="rdBig" style="margin-top:34px;display:flex;align-items:flex-end;gap:22px">
      <div class="mask" style="height:206px"><div class="in bc" id="rdNum" style="font:900 236px/0.88 BarlowC;color:var(--teal)">16</div></div>
      <div style="padding-bottom:18px"><div id="rdLblKr" style="font:800 40px/1.2 Pretendard">시즌 참가팀</div><div id="rdLblEn" class="mono" style="font-size:20px;letter-spacing:.24em;color:var(--muted);margin-top:6px">SEASON</div></div>
    </div>
    <div id="rdNote" class="body kr" style="margin-top:34px;font-size:30px">결승 8팀 중 4자리는<br><span class="teal" style="font-weight:800">11월 7일(토) 준결승</span>에서 결정됩니다.</div>
  </div>
  <div id="rdBox" class="abs" style="left:900px;top:180px;width:880px;height:780px">
    <div id="rdGD" class="abs" style="left:0;top:0;white-space:nowrap"><span class="chip gold krchip">서킷 누적 1–4위</span><span style="margin-left:14px;font:800 30px/1 Pretendard">결승 직행</span></div>
    <div id="rdGS" class="abs" style="left:0;top:0;white-space:nowrap"><span class="chip krchip">서킷 누적 5–12위</span><span style="margin-left:14px;font:800 30px/1 Pretendard">11.07 준결승 → <span class="teal">4팀 합류</span></span></div>
    <div id="rdGQ" class="abs" style="left:0;top:0;white-space:nowrap"><span class="chip krchip">11.07 준결승 통과</span><span style="margin-left:14px;font:800 30px/1 Pretendard">4팀 <span class="muted" style="font-weight:600;font-size:24px">· 준결승 후 확정</span></span></div>
    <svg id="rdLinks" class="abs" width="880" height="780" style="left:0;top:0;overflow:visible">
      ${[0, 1, 2, 3].map(i => `<path d="M${98 + i * 214},${70 + 2 * TILE_H + GAP + 60} V${560} H440" fill="none" stroke="rgba(244,195,90,.55)" stroke-width="2"/>`).join('')}
      <path d="M440,560 V590" stroke="rgba(244,195,90,.8)" stroke-width="2"/>
    </svg>
    <div id="rdFinal" class="abs" style="left:0;top:590px;width:${4 * TILE_W + 3 * GAP}px;height:150px;border:2px solid rgba(244,195,90,.8);background:linear-gradient(90deg,rgba(244,195,90,.14),rgba(244,195,90,.03));display:flex;align-items:center;gap:34px;padding:0 36px">
      <div class="bc gold" style="font:900 italic 96px/1 BarlowC">FINAL</div>
      <div><div style="font:800 34px/1.2 Pretendard">11.08 (일) 오후 2시</div><div style="font:650 24px/1.3 Pretendard;color:#c5d3db;margin-top:6px">대전 이스포츠 경기장 · 8팀</div></div>
    </div>
    <div id="rdTiles"></div>
  </div>
</div>`);
scenes.appendChild(road);
const rd = { gq: $('#rdGQ'), links: $('#rdLinks'), fin: $('#rdFinal'), chip: $('#rdChip'), h: [$('#rdH0'), $('#rdH1')], big: $('#rdBig'), num: $('#rdNum'), kr: $('#rdLblKr'), en: $('#rdLblEn'), note: $('#rdNote'), gd: $('#rdGD'), gs: $('#rdGS'), tiles: $('#rdTiles') };
const TILES = Array.from({ length: 16 }, (_, i) => {
  const e = el(`<div class="abs" style="left:0;top:0;width:${TILE_W}px;height:${TILE_H}px;border:2px solid rgba(17,207,208,.6);background:rgba(17,207,208,.07)">
    <i class="abs" style="left:10px;top:10px;width:14px;height:14px;border-left:3px solid var(--teal);border-top:3px solid var(--teal)"></i>
    <div class="abs mono tl" style="left:0;right:0;top:44px;text-align:center;font-size:20px;letter-spacing:.2em;color:var(--muted)">TEAM</div>
    <div class="abs bc tq" style="left:0;right:0;top:14px;text-align:center;font:900 76px/1 BarlowC;color:var(--teal);display:none">?</div>
    <div class="abs tx" style="left:0;top:0;width:100%;height:100%;display:none;background:linear-gradient(to top right,transparent calc(50% - 1.5px),rgba(245,248,250,.35) 50%,transparent calc(50% + 1.5px))"></div>
  </div>`);
  rd.tiles.appendChild(e);
  return { e, tl: $('.tl', e), tq: $('.tq', e), tx: $('.tx', e) };
});
// 타일 배치: A=16칸 격자, B=직행 4 + 준결승 8, C=결승 8 (직행 4 + 준결승 통과 4)
const gridPos = i => [(i % 4) * (TILE_W + GAP), 70 + Math.floor(i / 4) * (TILE_H + GAP)];
function tileTarget(i, phase) {
  if (phase === 'A') return { xy: gridPos(i), a: 1 };
  if (phase === 'B') {
    if (i >= 12) return { xy: [gridPos(i)[0], 860], a: 0 };
    if (i < 4) return { xy: [i * (TILE_W + GAP), 70], a: 1 };
    const j = i - 4; return { xy: [(j % 4) * (TILE_W + GAP), 330 + Math.floor(j / 4) * (TILE_H + GAP)], a: 1 };
  }
  // C
  if (i >= 12) return { xy: [gridPos(i)[0], 860], a: 0 };
  if (i < 4) return { xy: [i * (TILE_W + GAP), 70], a: 1 };
  if (i < 8) return { xy: [(i - 4) * (TILE_W + GAP), 70 + TILE_H + GAP], a: 1 };
  const j = i - 4; return { xy: [(j % 4) * (TILE_W + GAP), 330 + Math.floor(j / 4) * (TILE_H + GAP) + 60], a: 0 };
}
function renderRoad(t) {
  const on = t >= 87.95 && t < 100.05;
  show(road, on); if (!on) return;
  const [h0, h1, h2, h3, h4] = TL.roadHits, out = 99.5;
  rise(rd.chip, t, 88.05, { out });
  maskIn(rd.h[0], t, 88.15, { out }); maskIn(rd.h[1], t, 88.4, { out: out + 0.05 });
  rise(rd.big, t, 88.6, { out });
  const stage_ = t < h1 ? 0 : t < h3 ? 1 : 2;
  const NUM = [['16', '시즌 참가팀', 'SEASON'], ['12', '챔피언십 참가팀', 'CHAMPIONSHIP'], ['8', '결승 진출팀', 'FINAL']][stage_];
  txt(rd.num, NUM[0]); txt(rd.kr, NUM[1]); txt(rd.en, NUM[2]);
  const ch = stage_ === 0 ? 88.6 : stage_ === 1 ? h1 : h3;
  maskIn(rd.num, t, ch, { dur: 0.35 });
  glitch(rd.num, t, ch, 0.2, 18);
  css(rd.num, 'color', stage_ === 2 ? 'var(--gold)' : 'var(--teal)');
  rise(rd.note, t, h4 + 0.3, { out });
  rise(rd.gd, t, h2 + 0.15, { out });
  rise(rd.gs, t, h2 + 0.3, { out: t < h4 ? null : h4 - 0.05, outDur: 0.2 });
  // 라벨: B 단계(직행/준결승 두 묶음) → C 단계(결승 8팀 + 결승 상자)
  css(rd.gd, 'top', '8px'); css(rd.gs, 'top', '268px'); css(rd.gq, 'top', `${70 + 2 * TILE_H + GAP + 18}px`);
  rise(rd.gq, t, h4 + 0.45, { out });
  const lk = E.inOutCubic(prog(t, h4 + 0.5, h4 + 1.1));
  css(rd.links, 'clipPath', `inset(0 0 ${((1 - lk) * 100).toFixed(1)}% 0)`); op(rd.links, 1 - prog(t, out, out + 0.3));
  const fk = E.outExpo(prog(t, h4 + 0.95, h4 + 1.5));
  op(rd.fin, fk * (1 - prog(t, out, out + 0.3))); tf(rd.fin, `translate3d(0,${((1 - fk) * 40).toFixed(1)}px,0) scale(${(1 + 0.04 * pulse(t, h4 + 0.95, 0.3)).toFixed(4)})`);
  TILES.forEach((T, i) => {
    // 등장: 16분음표 간격으로 차례대로
    const ti = 88.0 + i * 0.0625;
    const ka = E.outBack(prog(t, ti, ti + 0.3));
    let pos = tileTarget(i, 'A');
    if (t >= h2) { const k = E.inOutCubic(prog(t, h2, h2 + 0.6)); const b = tileTarget(i, 'B'); pos = { xy: [lerp(pos.xy[0], b.xy[0], k), lerp(pos.xy[1], b.xy[1], k)], a: lerp(pos.a, b.a, k) }; }
    if (t >= h4) { const k = E.inOutCubic(prog(t, h4, h4 + 0.6)); const c = tileTarget(i, 'C'); const b = tileTarget(i, 'B'); pos = { xy: [lerp(b.xy[0], c.xy[0], k), lerp(b.xy[1], c.xy[1], k)], a: lerp(b.a, c.a, k) }; }
    let a = pos.a * prog(t, ti, ti + 0.12);
    // h1: 13–16번째 칸 탈락
    const elim = i >= 12 && t >= h1;
    if (elim) { const k = prog(t, h1 + 0.25, h1 + 0.9); a *= 1 - k * 0.85; pos.xy = [pos.xy[0], pos.xy[1] + E.inCubic(k) * 40]; }
    if (elim && t >= h2) a *= 1 - prog(t, h2, h2 + 0.3);
    // h3: 준결승 8칸 중 4칸만 통과
    const semiOut = i >= 8 && i < 12 && t >= h3;
    if (semiOut) { const k = prog(t, h3 + 0.2, h3 + 0.7); a *= 1 - k * 0.8; }
    const isDirect = i < 4 && t >= h2, isQ = i >= 4 && i < 8 && t >= h3;
    show(T.tx, elim || semiOut);
    show(T.tq, isQ); show(T.tl, !isQ);
    txt(T.tl, isDirect ? 'DIRECT' : (i < 12 && t >= h2 ? 'SEMI' : 'TEAM'));
    css(T.tl, 'color', isDirect ? 'var(--gold)' : 'var(--muted)');
    css(T.e, 'borderColor', isDirect ? 'rgba(244,195,90,.8)' : elim || semiOut ? 'rgba(245,248,250,.18)' : 'rgba(17,207,208,.6)');
    css(T.e, 'background', isDirect ? 'rgba(244,195,90,.10)' : isQ ? 'rgba(17,207,208,.14)' : elim || semiOut ? 'transparent' : 'rgba(17,207,208,.07)');
    css(T.e, 'borderStyle', isQ ? 'dashed' : 'solid');
    const hit = pulse(t, h1, 0.3) * (elim ? 1 : 0) + pulse(t, h3, 0.3) * (isQ ? 1 : 0);
    op(T.e, Math.min(1, a) * (1 - prog(t, out, out + 0.4)));
    tf(T.e, `translate3d(${pos.xy[0].toFixed(1)}px,${pos.xy[1].toFixed(1)}px,0) scale(${(ka * (1 + hit * 0.08)).toFixed(4)})`);
  });
}

/* ============================================================ 7. 결승 장소 */
const venue = el(`<div class="layer" id="sVenue">
  <div class="abs" style="left:120px;top:220px;width:700px">
    <div class="chip gold" id="vnChip">FINAL VENUE</div>
    <div class="mask" style="margin-top:34px"><div class="in h-xl kr" id="vnA">결승의 무대,</div></div>
    <div class="mask"><div class="in h-xl kr gold" id="vnB">대전.</div></div>
    <div id="vnPlace" style="margin-top:44px;font:800 50px/1.2 Pretendard;letter-spacing:-.02em">대전 이스포츠 경기장</div>
    <div id="vnWhen" class="mono" style="margin-top:20px;font-size:22px;letter-spacing:.14em;color:var(--teal)">2026.11.08 SUN · 14:00 KST</div>
  </div>
</div>`);
scenes.appendChild(venue);
const vn = { chip: $('#vnChip'), a: $('#vnA'), b: $('#vnB'), place: $('#vnPlace'), when: $('#vnWhen') };
function renderVenue(t) {
  const on = t >= 99.95 && t < 108.02;
  show(venue, on); if (!on) return;
  const out = 107.3;
  rise(vn.chip, t, 100.2, { out });
  maskIn(vn.a, t, 100.4, { out }); maskIn(vn.b, t, 100.9, { out: out + 0.05 });
  glitch(vn.b, t, 100.9, 0.25, 18);
  rise(vn.place, t, 101.5, { out }); rise(vn.when, t, 101.8, { out });
}

/* ============================================================ 8. 시즌 16팀 집결 */
const rally = el(`<div class="layer" id="sRally">
  <div id="rlOne" class="abs bc" style="left:0;right:0;top:40px;text-align:center;font:900 italic 900px/1 BarlowC;color:transparent;-webkit-text-stroke:3px rgba(244,195,90,.55)">1</div>
  <div id="rlWall" class="abs" style="left:0;top:205px;width:1920px;height:800px">
    ${[0, 1, 2, 3].map(r => `<div class="abs nowrap rlRow" style="left:0;top:${r * 196}px;font:900 132px/1.3 Pretendard;letter-spacing:-.035em;${r % 2 ? 'color:transparent;-webkit-text-stroke:2.5px rgba(17,207,208,.85)' : 'color:rgba(245,248,250,.92)'}">${[0, 1, 2].map(() => ORDER.slice(r * 4, r * 4 + 4).map(tm => `<span style="margin-right:90px">${tm.name}</span>`).join('')).join('')}</div>`).join('')}
  </div>
  <div id="rlBand" class="abs" style="left:0;top:405px;width:1920px;height:290px;background:linear-gradient(90deg,rgba(6,23,34,.0),rgba(6,23,34,.94) 18%,rgba(6,23,34,.94) 82%,rgba(6,23,34,0))"></div>
  <div class="abs" style="left:120px;top:142px" id="rlTop"><span class="chip">SEASON 16 TEAMS</span><span class="mono" style="margin-left:16px;font-size:19px;color:var(--muted);letter-spacing:.08em">시즌 참가 16팀 전체 · 소개 순서</span></div>
  <div class="abs" style="left:0;right:0;top:438px;text-align:center">
    <div style="position:relative;height:200px">
      <div class="abs" style="left:0;right:0;top:0"><div class="mask"><div class="in h-xl kr" id="rlA">시즌을 달려온 <span class="teal">16팀</span>.</div></div></div>
      <div class="abs" style="left:0;right:0;top:0"><div class="mask"><div class="in h-xl kr" id="rlB">마지막에 서는 팀은, <span class="gold">단 하나</span>.</div></div></div>
    </div>
  </div>
</div>`);
scenes.appendChild(rally);
const rl = { one: $('#rlOne'), wall: $('#rlWall'), rows: $$('.rlRow'), band: $('#rlBand'), top: $('#rlTop'), a: $('#rlA'), b: $('#rlB') };
let rowW = [];
function renderRally(t) {
  const on = t >= 107.95 && t < 116.05;
  show(rally, on); if (!on) return;
  if (!rowW.length || rowW.some(w => !w)) rowW = rl.rows.map(r => r.scrollWidth / 3);
  const [r0, r1, r2] = TL.rallyHits;
  rl.rows.forEach((r, i) => {
    const sp = (i % 2 ? 1 : -1) * (150 + i * 25);
    const w = rowW[i] || 3000;
    let x = ((t - r0) * sp) % w; if (x > 0) x -= w;
    tf(r, `translate3d(${(x - (i % 2 ? 0 : 200)).toFixed(1)}px,0,0)`);
  });
  const wk = E.outExpo(prog(t, r0, r0 + 0.6));
  op(rl.wall, wk * lerp(1, 0.16, E.inOutCubic(prog(t, r1 - 0.2, r1 + 0.4))) * (1 - prog(t, 115.6, 116)));
  tf(rl.wall, `scale(${lerp(1.25, 1, wk).toFixed(4)})`);
  op(rl.band, prog(t, r0 + 0.1, r0 + 0.5) * (1 - prog(t, 115.6, 116)));
  rise(rl.top, t, r0 + 0.2, { out: 115.6 });
  maskIn(rl.a, t, r0 + 0.25, { out: r1 - 0.3 });
  maskIn(rl.b, t, r1, { out: 115.55 });
  glitch(rl.b, t, r2, 0.3, 20);
  const ok = prog(t, r2, r2 + 0.5);
  op(rl.one, ok * (1 - prog(t, 115.6, 116)) * 0.9);
  tf(rl.one, `scale(${lerp(1.4, 1, E.outExpo(ok)).toFixed(4)})`);
}

/* ============================================================ 9. 일정과 시청 안내 */
const cta = el(`<div class="layer" id="sCta">
  <div class="abs" style="left:120px;top:160px;width:820px">
    <div id="ctChip"><span class="chip">2026 KEL CHAMPIONSHIP</span><span class="mono" style="margin-left:16px;font-size:19px;color:var(--muted);letter-spacing:.1em">ETERNAL RETURN</span></div>
    <div class="mask" style="margin-top:22px"><div class="in kr" id="ctFinal" style="font:900 132px/1.08 Pretendard;letter-spacing:-.04em">결승전<span class="teal">.</span></div></div>
    <div id="ctDate" style="margin-top:20px;display:flex;align-items:flex-end;gap:26px">
      <div class="bc gold" id="ctDD" style="font:900 236px/0.82 BarlowC;letter-spacing:-.01em">11.08</div>
      <div style="padding-bottom:12px"><div class="bc" style="font:800 58px/1 BarlowC;letter-spacing:.04em">SUN</div><div class="bc teal" style="font:800 58px/1 BarlowC;letter-spacing:.04em;margin-top:6px">14:00 KST</div></div>
    </div>
    <div id="ctKr" style="margin-top:26px;font:750 38px/1.2 Pretendard">2026년 11월 8일 일요일 오후 2시</div>
    <div id="ctVenue" style="margin-top:22px;display:flex;align-items:center;gap:14px;font:800 42px/1.2 Pretendard"><i style="display:block;width:20px;height:20px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 5px rgba(244,195,90,.25)"></i>대전 이스포츠 경기장</div>
    <div id="ctSemi" style="margin-top:30px;padding-top:24px;border-top:1px solid var(--line);font:650 28px/1.3 Pretendard;color:#c5d3db">준결승 · 2026년 11월 7일 토요일 오후 2시</div>
    <div id="ctMore" class="mono" style="margin-top:16px;font-size:19px;letter-spacing:.06em;color:var(--muted)">자세한 안내 · playeternalreturn.com</div>
  </div>
</div>`);
scenes.appendChild(cta);
const ct = { chip: $('#ctChip'), fin: $('#ctFinal'), date: $('#ctDate'), dd: $('#ctDD'), kr: $('#ctKr'), venue: $('#ctVenue'), semi: $('#ctSemi'), more: $('#ctMore') };
function renderCta(t) {
  const on = t >= 115.95;
  show(cta, on); if (!on) return;
  const h = TL.ctaHit, [c0, c1, c2, c3, c4] = TL.ctaTicks;
  rise(ct.chip, t, h + 0.05);
  maskIn(ct.fin, t, h + 0.1, { dur: 0.5 });
  glitch(ct.fin, t, h + 0.1, 0.25, 18);
  const dk = E.outExpo(prog(t, c0, c0 + 0.45));
  op(ct.date, dk); tf(ct.date, `translate3d(0,${((1 - dk) * 40).toFixed(1)}px,0)`);
  tf(ct.dd, `scale(${(1 + 0.06 * pulse(t, c0, 0.3)).toFixed(4)})`); css(ct.dd, 'transformOrigin', 'left bottom');
  glitch(ct.dd, t, c0, 0.2, 14);
  rise(ct.kr, t, c1); rise(ct.venue, t, c2); rise(ct.semi, t, c3); rise(ct.more, t, c4);
}

/* ======================================================== 전역 효과 · HUD */
const hudEl = $('#hud'), hudSec = $('#hudSec'), hudBar = $('#hudBar');
const flashEl = $('#flash'), tintEl = $('#tint'), wipeEl = $('#wipe'), grainEl = $('#grain');
const gridEl = $('#grid'), glowEl = $('#bgGlow');

const FLASHES = [[2.4, 0.25, 0.25], ...TL.hookNums.map(n => [n, 0.18, 0.35]), [7.85, 0.15, 0, true], [TL.logoHit, 0.6, 1], [63.85, 0.5, 0.9], [107.75, 0.25, 0, true], [108, 0.6, 1], [TL.ctaHit, 0.55, 0.85]];
// [시작, 길이, 최대 세기, 상승형]
function flashAt(t) {
  let a = 0;
  FLASHES.forEach(([t0, d, m, up]) => {
    if (up) { if (t >= t0 && t < t0 + d) a = Math.max(a, E.inCubic(prog(t, t0, t0 + d))); }
    else if (t >= t0 && t < t0 + d) a = Math.max(a, m * (1 - E.outCubic(prog(t, t0, t0 + d))));
  });
  return a;
}
const SHAKES = [[TL.logoHit, 0.4, 16], ...TL.hookNums.map(n => [n, 0.15, 7]), ...SLOTS.map(s => [s.t0, 0.22, 5]), [64, 0.3, 10], ...TL.roadHits.map(h => [h, 0.2, 6]), [108, 0.4, 14], [TL.rallyHits[2], 0.25, 8], [TL.ctaHit, 0.35, 12], [100, 0.2, 6]];
function shakeAt(t) {
  let x = 0, y = 0;
  const f = Math.floor(t * 60);
  SHAKES.forEach(([t0, d, a]) => { if (t >= t0 && t < t0 + d) { const k = a * (1 - prog(t, t0, t0 + d)); x += (hash(f * 1.7 + t0) * 2 - 1) * k; y += (hash(f * 2.3 + t0 + 9) * 2 - 1) * k; } });
  return [x, y];
}
const WIPES = [12.0, 20.0, 88.0, 100.0];
function renderFx(t) {
  op(flashEl, flashAt(t));
  // 팀 슬램 때 청록 빛 번짐
  let tint = 0; SLOTS.forEach(s => { tint = Math.max(tint, 0.1 * pulse(t, s.t0, 0.35)); });
  TL.roadHits.forEach(h => { tint = Math.max(tint, 0.12 * pulse(t, h, 0.4)); });
  op(tintEl, tint);
  const [sx, sy] = shakeAt(t);
  tf(world, `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`);
  // 방향성 와이프: 청록 가장자리가 화면을 가로지르며 장면을 교체합니다(0.7초, 중앙에서 화면 전체를 덮음)
  let wx = null;
  WIPES.forEach(c => { if (t >= c - 0.35 && t < c + 0.35) wx = lerp(-3000, 1920, E.inOutCubic(prog(t, c - 0.35, c + 0.35))); });
  show(wipeEl, wx !== null); if (wx !== null) tf(wipeEl, `translate3d(${wx.toFixed(1)}px,0,0)`);
  // 필름 그레인 (24fps로 갱신)
  const g = Math.floor(t * 24);
  css(grainEl, 'backgroundPosition', `${Math.floor(hash(g) * 256)}px ${Math.floor(hash(g + 5) * 256)}px`);
  // 배경 격자와 광원
  css(gridEl, 'backgroundPosition', `${(-t * 6).toFixed(1)}px ${(-t * 3).toFixed(1)}px`);
  op(gridEl, t < 12 ? 0.5 * prog(t, 0, 1.2) : 1);
  const gx = 50 + Math.sin(t * 0.21) * 18, gy = 50 + Math.cos(t * 0.17) * 14;
  css(glowEl, 'background', `radial-gradient(circle 560px at ${gx.toFixed(1)}% ${gy.toFixed(1)}%, rgba(17,207,208,.10), transparent 70%)`);
  // HUD
  const hv = t >= 12;
  show(hudEl, hv);
  if (hv) {
    op(hudEl, prog(t, 12.0, 12.4));
    let sec = TL.sections[0]; TL.sections.forEach(s => { if (t >= s.start) sec = s; });
    typeOn(hudSec, sec.label, t, sec.start + 0.1, 0.35);
    css(hudBar, 'width', `${(1760 * clamp(t / FREEZE)).toFixed(1)}px`);
  }
}
// 그레인 텍스처(시드 고정)
(function makeGrain() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256), R = mulberry32(42);
  for (let i = 0; i < img.data.length; i += 4) { const v = R() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  css(grainEl, 'backgroundImage', `url(${c.toDataURL()})`);
})();

/* ================================================================ 렌더 */
function renderFrame(tIn) {
  const t = Math.min(tIn, FREEZE);   // 마지막 8초(124–132초)는 화면 고정
  renderHook(t); renderIntro(t); renderMap(t); renderMapText(t); renderTeams(t);
  renderLumia(t); renderRoad(t); renderVenue(t); renderRally(t); renderCta(t); renderFx(t);
}
window.renderFrame = renderFrame;

window.__ready = (async () => {
  const faces = ['900 100px BarlowC', '800 100px BarlowC', '700 100px BarlowC', 'italic 800 100px BarlowC', 'italic 900 100px BarlowC', '400 20px JBMono', '500 20px JBMono', '700 20px JBMono'];
  await Promise.all([...faces.map(f => document.fonts.load(f)), document.fonts.load('800 20px Pretendard', '가나다ABC')]);
  await document.fonts.ready;
  await Promise.all($$('img').map(i => i.decode().catch(() => {})));
  renderFrame(0);
  return true;
})();

/* ============================================================ 미리보기 */
function fit() { const s = Math.min(innerWidth / 1920, (innerHeight - (RENDER ? 0 : 44)) / 1080); stage.style.transform = RENDER ? 'none' : `scale(${s})`; }
addEventListener('resize', fit); fit();
if (!RENDER) {
  const audio = $('#music'), btn = $('#play'), scrub = $('#scrub'), time = $('#time');
  let playing = false, t0 = 0, clock0 = 0, useAudio = true;
  const now = () => (useAudio && !audio.paused ? audio.currentTime : t0 + (playing ? (performance.now() - clock0) / 1000 : 0));
  const seek = t => { t0 = t; clock0 = performance.now(); try { audio.currentTime = t; } catch (e) { /* 음원 없음 */ } };
  btn.onclick = async () => {
    playing = !playing; btn.textContent = playing ? '❚❚ 정지' : '▶ 재생';
    if (playing) { clock0 = performance.now(); try { audio.currentTime = t0; await audio.play(); } catch (e) { useAudio = false; } }
    else { t0 = now(); audio.pause(); }
  };
  scrub.oninput = () => seek(+scrub.value);
  addEventListener('keydown', e => { if (e.code === 'Space') btn.click(); if (e.code === 'ArrowRight') seek(now() + 3); if (e.code === 'ArrowLeft') seek(Math.max(0, now() - 3)); });
  const start = +(qs.get('t') || 0); seek(start);
  window.__ready.then(() => {
    const loop = () => { let t = now(); if (t >= DUR) { t = DUR; if (playing) btn.click(); } renderFrame(t); scrub.value = t; time.textContent = `${pad2(Math.floor(t / 60))}:${(t % 60).toFixed(2).padStart(5, '0')}`; requestAnimationFrame(loop); };
    loop();
  });
}
})();
