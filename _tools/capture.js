// 실행법:  NODE_PATH=<puppeteer-core 가 설치된 곳>/node_modules node _tools/capture.js
//          (--test 를 붙이면 한 모델 2장만 뽑아 빠르게 확인)
// 원본 GLB 가 서버 루트에 있어야 한다. _backup/source-glb 로 옮긴 뒤라면 루트로 되돌릴 것.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE   = 'http://localhost:8777';
const OUT    = '/Users/temm/Downloads/modeling/resources/B';
const SIZE   = 860;
const STEP   = 5;

const TYPES = [
  { dir: 'flab',              model: 'flab.glb'              },
  { dir: 'flab_handleable',   model: 'flab_handleable.glb'   },
  { dir: 'odit29',            model: 'odit29.glb'            },
  { dir: 'odit29_handleable', model: 'odit29_handleable.glb' },
];

// 세 기법을 나란히 비교하려면 크기가 같아야 하므로 zoom 을 통일한다.
// ax(상하 젖힘)는 B안에서 프레임에 구워지는 값이라 3/4 뷰로 고정.
const POSE = { ax: 12, az: 0, zoom: 5 };

const TEST = process.argv.includes('--test');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=metal',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox',
      '--js-flags=--max-old-space-size=8192',
      '--window-size=' + SIZE + ',' + SIZE,
    ],
  });

  const types = TEST ? [TYPES[2]] : TYPES;
  const angles = [];
  if (TEST) { angles.push(0, 90); }
  else { for (let a = 0; a < 360; a += STEP) angles.push(a); }

  for (const t of types) {
    const outDir = path.join(OUT, t.dir);
    fs.mkdirSync(outDir, { recursive: true });

    const page = await browser.newPage();
    page.on('pageerror', e => console.log('  [page error]', e.message));
    await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });

    const url = `${BASE}/_tools/frame-renderer.html?model=${encodeURIComponent('/' + t.model)}` +
                `&ax=${POSE.ax}&az=${POSE.az}&zoom=${POSE.zoom}&size=${SIZE}`;
    console.log(`\n=== ${t.dir}`);
    console.log(`    ${t.model} 로딩 중...`);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction('window.__ready === true || window.__error !== null',
                               { timeout: 600000, polling: 500 });
    const err = await page.evaluate('window.__error');
    if (err) { console.log('    ✘ 로드 실패:', err); await page.close(); continue; }
    console.log(`    로딩 완료 (${((Date.now()-t0)/1000).toFixed(1)}s) — ${angles.length}장 캡처`);

    for (const a of angles) {
      await page.evaluate(d => {
        window.__renderAt(d);
        return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, a);
      const file = path.join(outDir, String(a).padStart(3, '0') + '.png');
      await page.screenshot({
        path: file, omitBackground: true,
        clip: { x: 0, y: 0, width: SIZE, height: SIZE },
      });
      if (a % 45 === 0) process.stdout.write(`    ${a}° `);
    }
    console.log('\n    완료');
    await page.close();
  }

  await browser.close();
  console.log('\n전체 완료');
})().catch(e => { console.error('실패:', e); process.exit(1); });
