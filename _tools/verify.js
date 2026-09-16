// 4페이지 자동 검증.  NODE_PATH=<puppeteer-core 위치>/node_modules node _tools/verify.js
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE   = 'http://localhost:8777';
const PAGES  = ['flab', 'flab_handleable', 'odit29', 'odit29_handleable'];
const SHOT   = process.env.SHOT_DIR || '/tmp';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-gl=angle','--use-angle=metal','--enable-unsafe-swiftshader',
           '--no-sandbox','--disable-gpu-sandbox','--js-flags=--max-old-space-size=8192'],
  });

  let problems = 0;

  for (const name of PAGES) {
    const page = await browser.newPage();
    const bad = [];
    page.on('pageerror', e => bad.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') bad.push('console: ' + m.text().slice(0,120)); });
    page.on('response', r => {
      if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) bad.push(r.status() + ' ' + r.url());
    });

    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/${name}.html`, { waitUntil: 'load', timeout: 120000 });

    // 세 영역이 모두 준비될 때까지 (스크롤로 지연 로드를 깨움)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
    await page.evaluate(() => window.scrollTo(0, 0));

    let ready = false;
    try {
      await page.waitForFunction(
        () => [...document.querySelectorAll('.stage')].every(s => s.__ready || s.querySelector('.state:not([hidden])')?.textContent.includes('못')),
        { timeout: 240000, polling: 700 });
      ready = true;
    } catch (e) { bad.push('타임아웃: 세 영역이 준비되지 않음'); }

    const r = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('.panel')];
      return {
        title: document.querySelector('.page-head h1')?.textContent,
        nav: document.querySelectorAll('nav a').length,
        active: document.querySelector('nav a.is-active')?.textContent,
        cols: getComputedStyle(document.querySelector('.compare')).gridTemplateColumns.split(' ').length,
        panels: panels.map(p => ({
          tag: p.querySelector('.tag')?.textContent,
          sub: p.querySelector('.sub')?.textContent,
          ready: !!p.querySelector('.stage').__ready,
          metrics: [...p.querySelectorAll('.metrics .row')].map(x => x.textContent.trim()).join(' | '),
        })),
      };
    });

    console.log(`\n══ ${name}.html ${ready ? '' : '(미완)'}`);
    console.log(`   제목 ${r.title} · nav ${r.nav}개 · 활성 "${r.active}" · 열 ${r.cols}`);
    for (const p of r.panels) {
      console.log(`   ${p.tag} ${p.ready ? '✔' : '✘'} ${p.sub}`);
      if (p.metrics) console.log(`      ${p.metrics}`);
    }
    if (bad.length) { problems += bad.length; console.log('   ⚠ ' + bad.slice(0,5).join('\n   ⚠ ')); }

    if (name === 'odit29') {
      await page.screenshot({ path: `${SHOT}/desktop.png`, fullPage: false });
      // 상하 회전 검증: A 영역에서 세로 드래그
      const before = await page.evaluate(() => document.querySelectorAll('.stage')[0].__pivot.rotation.x);
      const bb = await page.evaluate(() => {
        const r = document.querySelectorAll('.stage')[0].getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
      });
      await page.mouse.move(bb.x, bb.y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) await page.mouse.move(bb.x, bb.y + i * 12);
      await page.mouse.up();
      const after = await page.evaluate(() => document.querySelectorAll('.stage')[0].__pivot.rotation.x);
      const seqAfter = await page.evaluate(() => document.querySelectorAll('.stage')[1].__pivot === undefined);
      const deg = v => (v * 180 / Math.PI).toFixed(1);
      console.log(`   상하 회전: A ${deg(before)}° → ${deg(after)}° (한계 60°) · B에 pivot 없음: ${seqAfter}`);
      if (Math.abs(after - before) < 0.01) { problems++; console.log('   ⚠ 상하 회전이 동작하지 않음'); }
      if (Math.abs(deg(after)) > 60.5) { problems++; console.log('   ⚠ 상하 회전 한계를 넘음'); }
    }
    await page.close();
  }

  // 모바일 레이아웃
  const mp = await browser.newPage();
  await mp.setViewport({ width: 400, height: 900, deviceScaleFactor: 2 });
  await mp.goto(`${BASE}/odit29.html`, { waitUntil: 'load', timeout: 120000 });
  await mp.evaluate(() => new Promise(r => setTimeout(r, 2500)));
  const m = await mp.evaluate(() => {
    const g = document.querySelector('.compare');
    const cs = getComputedStyle(g);
    const rects = [...document.querySelectorAll('.panel')].map(p => p.getBoundingClientRect());
    return {
      cols: cs.gridTemplateColumns.split(' ').length,
      gap: cs.rowGap,
      stacked: rects.every((r, i) => i === 0 || r.top > rects[i-1].top),
      width: Math.round(rects[0].width),
      hOverflow: document.documentElement.scrollWidth > window.innerWidth,
      touchAction: getComputedStyle(document.querySelector('.stage')).touchAction,
    };
  });
  console.log(`\n══ 모바일 400px`);
  console.log(`   열 ${m.cols} · 수직나열 ${m.stacked} · 간격 ${m.gap} · 패널폭 ${m.width}px`);
  console.log(`   가로 스크롤 발생: ${m.hOverflow} · touch-action: ${m.touchAction}`);
  if (m.cols !== 1 || !m.stacked) { problems++; console.log('   ⚠ 모바일에서 수직 나열이 안 됨'); }
  if (m.hOverflow) { problems++; console.log('   ⚠ 가로 스크롤 발생'); }
  await mp.screenshot({ path: `${SHOT}/mobile.png`, fullPage: false });
  await mp.close();

  await browser.close();
  console.log(problems ? `\n문제 ${problems}건` : '\n문제 없음');
})().catch(e => { console.error('검증 실패:', e.message); process.exit(1); });
