/* 3D 표출 기법 비교 POC — 공용 스크립트
   페이지별 설정은 각 html 의 window.PAGE 블록에서 받는다.

   A : 압축된 단일 GLB (draco, primitive 병합됨)
   B : 각도별 스크린샷 시퀀스 (WebGL 사용 안 함)
   C : 분리형 .gltf + .bin + 텍스처 낱개 (draco, primitive 병합 안 됨)

   A·C 는 같은 3D 뷰어를 쓰고 로더 설정만 다르다.
   A 도 draco 압축이므로 A·C 가 디코더를 공유한다. */

import * as THREE      from 'three';
import { GLTFLoader }  from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const PAGE = window.PAGE;
if (!PAGE) throw new Error('window.PAGE 설정이 없습니다.');

const DRACO_PATH       = 'resources/C/draco/';
const PRELOAD_DISTANCE = '600px';   // 뷰어가 이만큼 가까워지면 받기 시작
const DEG              = Math.PI / 180;
const TILT_LIMIT       = 60;        // 상하 회전 한계 (도) — 뒤집힘 방지

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pad3  = n => String(n).padStart(3, '0');

/* ─── 공용 로더 (페이지당 하나) ─────────────────────────────── */
let _loader = null;
function loader() {
  if (_loader) return _loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  _loader = new GLTFLoader();
  _loader.setDRACOLoader(draco);
  return _loader;
}

/* ─── 실측: Resource Timing 으로 실제 전송량 집계 ───────────── */
function bytesUnder(prefix) {
  return performance.getEntriesByType('resource')
    .filter(r => r.name.includes(prefix))
    .reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0);
}

/* ═══════════════════════════════════════════════════════════
   화면 조립
   ═══════════════════════════════════════════════════════════ */
const LABELS = {
  A: n => `압축된 glb파일(${n}MB)`,
  B: n => `다각도의 스크린샷으로 회전 구현(${n}MB)`,
  C: n => `.bin, .gltf를 활용한 모델링 표현(${n}MB)`,
};
const NOTES = {
  A: '단일 파일 · primitive 병합 · 자유 회전',
  B: 'WebGL 사용 안 함 · 좌우 회전만 가능',
  C: '파일 분리 · primitive 병합 없음 · 자유 회전',
};

function build() {
  document.title = `${PAGE.model}.glb — 3D 표출 기법 비교`;

  /* 헤더 nav */
  const header = document.createElement('header');
  const nav = document.createElement('nav');
  PAGE.nav.forEach(name => {
    const a = document.createElement('a');
    a.href = `${name}.html`;
    a.textContent = name;
    if (name === PAGE.model) a.className = 'is-active';
    nav.appendChild(a);
  });
  header.appendChild(nav);
  document.body.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  document.body.appendChild(wrap);

  /* 제목 */
  const head = document.createElement('div');
  head.className = 'page-head';
  head.innerHTML =
    `<h1>${PAGE.model}.glb</h1>` +
    `<p>같은 모델을 세 가지 방식으로 표출해 비교합니다. ` +
    `세 영역 모두 zoom ${PAGE.zoom} 으로 크기를 맞췄습니다.</p>`;
  wrap.appendChild(head);

  /* 3분할 */
  const grid = document.createElement('div');
  grid.className = 'compare';
  wrap.appendChild(grid);

  const stages = {};
  for (const key of ['A', 'B', 'C']) {
    const cfg = PAGE[key];
    const panel = document.createElement('div');
    panel.className = 'panel';

    const ph = document.createElement('div');
    ph.className = 'panel-head';
    ph.innerHTML =
      `<span class="tag">${key}</span>` +
      `<span class="sub">${cfg ? LABELS[key](cfg.mb) : '해당 자료 없음'}</span>` +
      `<span class="note">${NOTES[key]}</span>`;
    panel.appendChild(ph);

    const stage = document.createElement('div');
    stage.className = 'stage';
    panel.appendChild(stage);

    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    panel.appendChild(metrics);

    grid.appendChild(panel);
    stages[key] = { stage, metrics, cfg };
  }
  return stages;
}

/* 실측값 표 출력 */
function showMetrics(el, rows) {
  el.innerHTML = rows
    .map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`)
    .join('');
}

/* 로딩/오류 오버레이 */
function overlay(stage) {
  const state = document.createElement('div');
  state.className = 'state';
  stage.appendChild(state);
  return {
    el: state,
    loading(text = '') {
      state.hidden = false;
      state.innerHTML = `<div class="spin"></div><div class="pct">${text}</div>`;
    },
    pct(text) {
      const n = state.querySelector('.pct');
      if (n) n.textContent = text;
    },
    error(msg) {
      state.hidden = false;
      state.innerHTML = `<div>${msg}</div>`;
    },
    hide() { state.hidden = true; },
  };
}

/* ═══════════════════════════════════════════════════════════
   A · C 공용 3D 뷰어
   ═══════════════════════════════════════════════════════════ */
function create3D(stage, metricsEl, cfg, bytesPrefix) {
  const ui = overlay(stage);
  ui.loading('0%');
  const t0 = performance.now();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  // r155 부터 조명 계산이 바뀌어 기존 구현과 밝기를 맞추기 위해 필요
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = true;
  stage.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const FOV    = 32;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, 9 - (clamp(PAGE.zoom, 1, 10) - 1) * (6 / 9));

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key  = new THREE.DirectionalLight(0xffffff, 1.9);  key.position.set(4, 7, 5);
  const fill = new THREE.DirectionalLight(0x99aacc, 0.55); fill.position.set(-5, 2, -3);
  const rim  = new THREE.DirectionalLight(0xaabbff, 0.45); rim.position.set(0, -3, -6);
  scene.add(key, fill, rim);

  const pivot = new THREE.Group();
  pivot.rotation.order = 'ZXY';       // Y(제자리 회전)를 가장 안쪽에 둬야 X·Z 가 화면 기준으로 고정
  pivot.rotation.y = 30 * DEG;
  pivot.rotation.x = clamp(PAGE.angleX, -TILT_LIMIT, TILT_LIMIT) * DEG;
  scene.add(pivot);
  stage.__pivot = pivot;              // 검증 스크립트에서 회전값을 읽기 위해

  let dirty = true;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  resize();
  new ResizeObserver(resize).observe(stage);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '드래그해서 돌려보세요';
  hint.hidden = true;
  stage.appendChild(hint);

  loader().load(cfg.file, gltf => {
    const tLoaded = performance.now();
    const model = gltf.scene;

    model.traverse(c => { if (c.name && /^backdrop/i.test(c.name)) c.visible = false; });

    // 보이는 메시만 재서 중앙 정렬 + 크기 정규화 (세 기법 모두 동일 기준)
    const box = new THREE.Box3();
    model.updateMatrixWorld(true);
    model.traverse(c => {
      if (!c.isMesh || !c.visible || !c.geometry) return;
      c.geometry.computeBoundingBox();
      const gb = c.geometry.boundingBox;
      if (gb && !gb.isEmpty()) box.union(gb.clone().applyMatrix4(c.matrixWorld));
    });
    if (!box.isEmpty()) {
      const size   = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const s = 2.6 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s);
      model.position.set(-center.x * s, -center.y * s, -center.z * s);
    }
    pivot.add(model);

    ui.hide();
    hint.hidden = false;
    renderer.render(scene, camera);   // 실측값 확보용 1프레임
    dirty = false;

    const info = renderer.info;
    showMetrics(metricsEl, [
      ['다운로드',  (bytesUnder(bytesPrefix) / 1048576).toFixed(2) + ' MB'],
      ['삼각형',    info.render.triangles.toLocaleString()],
      ['드로우콜',  info.render.calls + ' 회'],
      ['준비 시간', Math.round(tLoaded - t0) + ' ms'],
    ]);
    stage.__ready = true;
    animate();
  },
  ev => { if (ev.lengthComputable) ui.pct(Math.round(ev.loaded / ev.total * 100) + '%'); },
  err => {
    console.error('[3D] 로드 실패:', cfg.file, err);
    ui.error('불러오지 못했습니다.<br>' + cfg.file);
  });

  /* ── 조작: 좌우 + 상하 자유 회전 ────────────────────────── */
  const MULT      = 0.006;   // 좌우 감도 (rad/px)
  const TILT_MULT = 0.003;   // 상하 감도 — 범위가 ±60° 뿐이라 절반으로 둔다
  let dragging = false, prevX = 0, prevY = 0, velX = 0;

  function down(x, y) {
    dragging = true; prevX = x; prevY = y; velX = 0;
    stage.classList.add('is-grabbing', 'is-touched');
  }
  function move(x, y, withTilt) {
    if (!dragging) return;
    velX = (x - prevX) * MULT;
    pivot.rotation.y += velX;
    if (withTilt) {
      const nx = pivot.rotation.x + (y - prevY) * TILT_MULT;
      pivot.rotation.x = clamp(nx, -TILT_LIMIT * DEG, TILT_LIMIT * DEG);
    }
    prevX = x; prevY = y;
    dirty = true;
  }
  function up() { dragging = false; stage.classList.remove('is-grabbing'); }

  // 마우스: 가로·세로 모두 회전
  stage.addEventListener('mousedown', e => { e.preventDefault(); down(e.clientX, e.clientY); });
  window.addEventListener('mousemove', e => move(e.clientX, e.clientY, true));
  window.addEventListener('mouseup', up);

  /* 터치: 제스처가 "시작된 방향"으로만 판정한다.
       가로로 시작 → 그 제스처 동안 상하까지 회전 (자유 회전)
       세로로 시작 → 손대지 않고 페이지 스크롤에 넘김
     판정은 제스처당 한 번뿐이라, 옆으로 살짝 움직여 시작하면 이어서
     위아래로도 돌릴 수 있고 세로로 시작하면 스크롤이 그대로 동작한다.
     이렇게 하면 뷰어가 화면을 채워도 스크롤 함정이 생기지 않는다. */
  let t0x = 0, t0y = 0, axis = null;
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    t0x = e.touches[0].clientX; t0y = e.touches[0].clientY; axis = null;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    if (axis === null) {
      const dx = Math.abs(x - t0x), dy = Math.abs(y - t0y);
      if (dx < 6 && dy < 6) return;
      axis = dx > dy ? 'x' : 'y';
      if (axis === 'x') down(t0x, t0y);
    }
    if (axis !== 'x') return;      // 세로로 시작한 제스처 → 스크롤에 양보
    e.preventDefault();
    move(x, y, true);              // 가로로 시작했으므로 상하도 회전
  }, { passive: false });
  stage.addEventListener('touchend',    () => { axis = null; up(); }, { passive: true });
  stage.addEventListener('touchcancel', () => { axis = null; up(); }, { passive: true });

  /* ── 렌더 루프 ──────────────────────────────────────────── */
  let running = false, visible = true, rafId = 0;
  function frame() {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (!dragging && Math.abs(velX) > 0.00005) {
      pivot.rotation.y += velX; velX *= 0.93; dirty = true;   // 관성
    }
    if (dirty) { renderer.render(scene, camera); dirty = false; }
  }
  function animate() { if (!running && visible) { running = true; frame(); } }
  function stop() { running = false; cancelAnimationFrame(rafId); }

  // 화면 밖이면 렌더 정지 — 한 페이지에 3D 뷰어가 2개라 발열 방어가 필요
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible) animate(); else stop();
  }, { rootMargin: '100px' }).observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else animate();
  });
}

/* ═══════════════════════════════════════════════════════════
   B 이미지 시퀀스 뷰어
   ═══════════════════════════════════════════════════════════ */
function createSequence(stage, metricsEl, cfg, bytesPrefix) {
  const ui = overlay(stage);
  ui.loading('0%');
  const t0 = performance.now();

  const step  = clamp(parseInt(cfg.step, 10) || 5, 1, 90);
  const count = Math.round(360 / step);
  const ext   = cfg.ext || 'webp';
  const urlOf = i => `${cfg.folder}/${pad3((i * step) % 360)}.${ext}`;

  const img = document.createElement('img');
  img.alt = ''; img.draggable = false;
  stage.appendChild(img);

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = '<i></i>';
  const barFill = bar.firstChild;
  stage.appendChild(bar);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '좌우로 드래그하세요';
  hint.hidden = true;
  stage.appendChild(hint);

  const loaded = new Array(count);
  let nLoaded = 0, frame = 0, shown = -1;

  // 아직 안 받은 각도는 가장 가까운 받은 프레임으로 대체
  function nearest(i) {
    if (loaded[i]) return i;
    for (let d = 1; d <= count; d++) {
      const a = (i - d + count) % count; if (loaded[a]) return a;
      const b = (i + d) % count;         if (loaded[b]) return b;
    }
    return -1;
  }
  function paint() {
    const i = nearest(frame);
    if (i < 0 || i === shown) return;
    shown = i;
    img.src = urlOf(i);
  }

  /* 굵게 → 촘촘하게 받는 순서.
     절반만 받아도 회전은 되므로 기다림이 짧게 느껴진다. */
  function loadOrder(n) {
    const order = [], seen = new Set();
    for (const s of [8, 4, 2, 1]) {
      for (let i = 0; i < n; i += s) if (!seen.has(i)) { seen.add(i); order.push(i); }
    }
    for (let i = 0; i < n; i++) if (!seen.has(i)) { seen.add(i); order.push(i); }
    return order;
  }

  const queue = loadOrder(count);
  let qi = 0, inflight = 0, errCount = 0;
  const CONCURRENCY = 6;

  function pump() {
    while (inflight < CONCURRENCY && qi < queue.length) {
      const i = queue[qi++];
      inflight++;
      const im = new Image();
      im.onload = () => {
        loaded[i] = true; nLoaded++; inflight--;
        if (nLoaded === 1) { ui.hide(); hint.hidden = false; paint(); }
        else if (shown < 0 || !loaded[shown]) paint();
        barFill.style.width = Math.round(nLoaded / count * 100) + '%';
        ui.pct(Math.round(nLoaded / count * 100) + '%');
        if (nLoaded >= count) {
          bar.hidden = true;
          showMetrics(metricsEl, [
            ['다운로드',  (bytesUnder(bytesPrefix) / 1048576).toFixed(2) + ' MB'],
            ['프레임',    `${count}장 (${step}° 간격)`],
            ['드로우콜',  '0 회 (WebGL 없음)'],
            ['준비 시간', Math.round(performance.now() - t0) + ' ms'],
          ]);
          stage.__ready = true;
        }
        pump();
      };
      im.onerror = () => {
        inflight--; errCount++;
        if (nLoaded === 0 && errCount >= 3) {
          ui.error('이미지를 불러오지 못했습니다.<br>' + cfg.folder);
        }
        pump();
      };
      im.src = urlOf(i);
    }
  }
  pump();

  /* ── 조작: 좌우 전용 ────────────────────────────────────── */
  const sens = clamp(cfg.dragSpeed || 5, 1, 10) / 5;
  let dragging = false, startX = 0, startFrame = 0;

  function setFrame(f) {
    frame = ((Math.round(f) % count) + count) % count;
    paint();
  }
  function down(x) {
    dragging = true; startX = x; startFrame = frame;
    stage.classList.add('is-grabbing', 'is-touched');
  }
  function move(x) {
    if (!dragging) return;
    setFrame(startFrame + (x - startX) / (stage.clientWidth || 1) * count * sens);
  }
  function up() { dragging = false; stage.classList.remove('is-grabbing'); }

  stage.addEventListener('mousedown', e => { e.preventDefault(); down(e.clientX); });
  window.addEventListener('mousemove', e => move(e.clientX));
  window.addEventListener('mouseup', up);

  let t0x = 0, t0y = 0, axis = null;
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    t0x = e.touches[0].clientX; t0y = e.touches[0].clientY; axis = null;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    if (axis === null) {
      const dx = Math.abs(x - t0x), dy = Math.abs(y - t0y);
      if (dx < 6 && dy < 6) return;
      axis = dx > dy ? 'x' : 'y';
      if (axis === 'x') down(t0x);
    }
    if (axis !== 'x') return;
    e.preventDefault();
    move(x);
  }, { passive: false });
  stage.addEventListener('touchend',    () => { axis = null; up(); }, { passive: true });
  stage.addEventListener('touchcancel', () => { axis = null; up(); }, { passive: true });
}

/* ═══════════════════════════════════════════════════════════
   시작 — 뷰포트에 가까워지면 초기화 (3개를 한꺼번에 받지 않도록)
   ═══════════════════════════════════════════════════════════ */
const stages = build();

const INIT = {
  A: (s, m, c) => create3D(s, m, c, 'resources/A/'),
  B: (s, m, c) => createSequence(s, m, c, c.folder),
  C: (s, m, c) => create3D(s, m, c, c.file.replace(/[^/]+$/, '')),
};

const lazy = new IntersectionObserver((entries, obs) => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    obs.unobserve(en.target);
    const key = en.target.__key;
    const { stage, metrics, cfg } = stages[key];
    INIT[key](stage, metrics, cfg);
  });
}, { rootMargin: PRELOAD_DISTANCE });

for (const key of ['A', 'B', 'C']) {
  const { stage, metrics, cfg } = stages[key];
  if (!cfg) { overlay(stage).error('해당 자료 없음'); continue; }
  stage.__key = key;
  lazy.observe(stage);
}
