// 모바일 터치 제스처 검증.  NODE_PATH=<puppeteer-core 위치>/node_modules node _tools/verify-touch.js
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:8777';

const deg = v => (v * 180 / Math.PI).toFixed(1);

(async () => {
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle','--use-angle=metal','--no-sandbox','--disable-gpu-sandbox'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 400, height: 860, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await p.goto(`${BASE}/odit29.html`, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => document.querySelectorAll('.stage')[0].__ready, { timeout: 180000, polling: 500 });

  const box = await p.evaluate(() => {
    const r = document.querySelectorAll('.stage')[0].getBoundingClientRect();
    return { cx: Math.round(r.x + r.width/2), cy: Math.round(r.y + r.height/2) };
  });
  const read = () => p.evaluate(() => {
    const pv = document.querySelectorAll('.stage')[0].__pivot;
    return { x: pv.rotation.x, y: pv.rotation.y, scroll: window.scrollY };
  });

  // ── 1) 가로로 시작한 뒤 세로로 이어가는 제스처 → 상하 회전돼야 함
  let before = await read();
  let t = new (require('puppeteer-core').Touchscreen ?? Object)();
  await p.touchscreen.touchStart(box.cx, box.cy);
  for (let i = 1; i <= 8; i++)  await p.touchscreen.touchMove(box.cx + i * 8, box.cy);       // 먼저 가로
  for (let i = 1; i <= 16; i++) await p.touchscreen.touchMove(box.cx + 64, box.cy + i * 10); // 이어서 세로
  await p.touchscreen.touchEnd();
  let after = await read();
  const tiltWorks = Math.abs(after.x - before.x) > 0.01;
  console.log('① 가로로 시작 → 세로 이어가기');
  console.log(`   상하 ${deg(before.x)}° → ${deg(after.x)}°   ${tiltWorks ? '✔ 회전됨' : '✘ 안 됨'}`);
  console.log(`   좌우 ${deg(before.y)}° → ${deg(after.y)}°`);
  console.log(`   페이지 스크롤 ${before.scroll} → ${after.scroll} (안 움직여야 정상)`);

  // ── 2) 순수 세로 제스처 → 회전 없이 페이지가 스크롤돼야 함
  await p.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 300));
  before = await read();
  await p.touchscreen.touchStart(box.cx, box.cy);
  for (let i = 1; i <= 20; i++) await p.touchscreen.touchMove(box.cx, box.cy - i * 12);
  await p.touchscreen.touchEnd();
  await new Promise(r => setTimeout(r, 500));
  after = await read();
  const noRotate = Math.abs(after.x - before.x) < 0.01 && Math.abs(after.y - before.y) < 0.01;
  const scrolled = after.scroll > before.scroll + 20;
  console.log('\n② 순수 세로 제스처');
  console.log(`   회전 변화 없음: ${noRotate ? '✔' : '✘ 회전해버림'}`);
  console.log(`   페이지 스크롤 ${before.scroll} → ${after.scroll}  ${scrolled ? '✔ 스크롤됨' : '✘ 스크롤 안 됨(함정!)'}`);

  // ── 3) 상하 한계
  await p.touchscreen.touchStart(box.cx, box.cy);
  for (let i = 1; i <= 8; i++)  await p.touchscreen.touchMove(box.cx + i * 8, box.cy);
  for (let i = 1; i <= 60; i++) await p.touchscreen.touchMove(box.cx + 64, box.cy + i * 20);
  await p.touchscreen.touchEnd();
  const lim = await read();
  const inLimit = Math.abs(parseFloat(deg(lim.x))) <= 60.5;
  console.log('\n③ 상하 한계');
  console.log(`   과하게 끌었을 때 ${deg(lim.x)}°  ${inLimit ? '✔ 60° 이내' : '✘ 한계 초과'}`);

  const ok = tiltWorks && noRotate && scrolled && inLimit;
  console.log(ok ? '\n전부 통과' : '\n문제 있음');
  await b.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('검증 실패:', e.message); process.exit(1); });
