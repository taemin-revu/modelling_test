/* D 케이스 — 4분할(2x2) 표출 기법 비교 POC 전용 스크립트
   compare.js(A/B/C 3분할)와 같은 패턴(오버레이·드래그 회전·지연 로딩·실측 지표)을
   재사용하되, 아래 두 가지가 다르다.

   1. A/C 는 서로 다른 3D 뷰어 설정이었지만, D 는 4개 패널이 전부 같은 3D 뷰어이고
      "포맷(glb 단일파일 vs gltf+bin 분리)" × "재질 텍스처 유/무" 만 다르다.
   2. 4개 패널 모두 같은 HDR 환경맵을 공유해서 조명·반사 조건을 동일하게 맞춘다.
      HDR 파일은 1회만 내려받고(Promise 캐시), 각 패널은 자기 자신의 렌더러로
      PMREM 프리필터를 한 번씩만 돌려 자기 씬에 맞는 환경맵을 만든다 — WebGL 텍스처는
      그것을 만든 렌더러(=GL 컨텍스트)에 묶이기 때문에, 렌더러 4개가 프리필터 결과
      텍스처를 그대로 공유할 수는 없다. 대신 원본 HDR 텍스처(실제 픽셀 데이터를 가진
      일반 텍스처)는 공유 가능하므로, 다운로드/디코딩만 한 번으로 줄인다. */

import * as THREE       from 'three';
import { GLTFLoader }   from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader }  from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader }   from 'three/examples/jsm/loaders/RGBELoader.js';

const PAGE = window.PAGE;
if (!PAGE) throw new Error('window.PAGE 설정이 없습니다.');

const DRACO_PATH       = 'resources/C/draco/';   // 범용 디코더 — D 전용 자산이 아니라 그대로 재사용
const PRELOAD_DISTANCE = '600px';
const DEG              = Math.PI / 180;
const TILT_LIMIT       = 60;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ─── 공용 GLTF 로더 (glb·gltf 모두 이 로더 하나로 처리) ───────── */
let _loader = null;
function loader() {
  if (_loader) return _loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  _loader = new GLTFLoader();
  _loader.setDRACOLoader(draco);
  return _loader;
}

/* ─── HDR 원본 텍스처 — 네트워크 요청은 페이지 전체에서 1회만 ──── */
let _hdrPromise = null;
function loadHDRTexture() {
  if (_hdrPromise) return _hdrPromise;
  _hdrPromise = new Promise((resolve, reject) => {
    new RGBELoader().load(PAGE.hdr, resolve, undefined, reject);
  });
  return _hdrPromise;
}

/* ─── 실측: Resource Timing 으로 실제 전송량 집계 ───────────── */
function bytesUnder(prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  return performance.getEntriesByType('resource')
    .filter(r => list.some(p => r.name.includes(p)))
    .reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0);
}

/* ═══════════════════════════════════════════════════════════
   화면 조립
   ═══════════════════════════════════════════════════════════ */
const FORMAT_LABEL = {
  glb:  'glb + .hdr 이용',
  gltf: 'gltf + .bin 이용',
};

function build() {
  document.title = `${PAGE.model} — 3D 표출 기법 비교 (D)`;

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
    `<h1>${PAGE.model}</h1>` +
    `<p>같은 모델을 "포맷(glb 단일파일 vs gltf+bin 분리)" × "재질 텍스처 유무" 로 ` +
    `조합한 4가지 방식으로 표출해 비교합니다. 네 영역 모두 zoom ${PAGE.zoom}, ` +
    `조명은 별도로 두지 않고 동일한 HDR 환경맵 하나로만 비춰 조건을 맞췄습니다.</p>`;
  wrap.appendChild(head);

  /* 2x2 */
  const grid = document.createElement('div');
  grid.className = 'compare compare-4';
  wrap.appendChild(grid);

  const stages = [];
  for (const cfg of PAGE.cases) {
    const panel = document.createElement('div');
    panel.className = 'panel';

    const ph = document.createElement('div');
    ph.className = 'panel-head';
    ph.innerHTML =
      `<span class="tag">${cfg.id}</span>` +
      `<span class="sub">${FORMAT_LABEL[cfg.type]} (${cfg.mb}MB)</span>` +
      `<span class="note">${cfg.material ? '재질감 O' : '재질감 X'}</span>`;
    panel.appendChild(ph);

    const stage = document.createElement('div');
    stage.className = 'stage';
    panel.appendChild(stage);

    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    panel.appendChild(metrics);

    grid.appendChild(panel);
    stages.push({ stage, metrics, cfg });
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
   4패널 공용 3D 뷰어 (glb·gltf 동일 — HDR 환경맵 공통 적용)
   ═══════════════════════════════════════════════════════════ */
function create3D(stage, metricsEl, cfg) {
  const bytesPrefixes = cfg.type === 'glb'
    ? [cfg.file]
    : [cfg.file, cfg.resourceDir];

  const ui = overlay(stage);
  ui.loading('0%');
  const t0 = performance.now();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = true;
  stage.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const FOV    = 32;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, 9 - (clamp(PAGE.zoom, 1, 10) - 1) * (6 / 9));

  // 조명은 HDR 환경맵 하나뿐 — 별도 라이트를 두지 않는다(4개 패널 공통, 배경은 계속 투명)
  loadHDRTexture().then(hdrTex => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(hdrTex).texture;
    pmrem.dispose();
    dirty = true;
  }).catch(err => console.error('[3D] HDR 로드 실패:', PAGE.hdr, err));

  const pivot = new THREE.Group();
  pivot.rotation.order = 'ZXY';
  pivot.rotation.y = 30 * DEG;
  pivot.rotation.x = clamp(PAGE.angleX, -TILT_LIMIT, TILT_LIMIT) * DEG;
  scene.add(pivot);
  stage.__pivot = pivot;

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
    renderer.render(scene, camera);
    dirty = false;

    const info = renderer.info;
    showMetrics(metricsEl, [
      ['다운로드',  (bytesUnder(bytesPrefixes) / 1048576).toFixed(2) + ' MB'],
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

  /* ── 조작: 좌우 + 상하 자유 회전 (compare.js 와 동일) ──────── */
  const MULT      = 0.006;
  const TILT_MULT = 0.003;
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

  stage.addEventListener('mousedown', e => { e.preventDefault(); down(e.clientX, e.clientY); });
  window.addEventListener('mousemove', e => move(e.clientX, e.clientY, true));
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
      if (axis === 'x') down(t0x, t0y);
    }
    if (axis !== 'x') return;
    e.preventDefault();
    move(x, y, true);
  }, { passive: false });
  stage.addEventListener('touchend',    () => { axis = null; up(); }, { passive: true });
  stage.addEventListener('touchcancel', () => { axis = null; up(); }, { passive: true });

  /* ── 렌더 루프 ──────────────────────────────────────────── */
  let running = false, visible = true, rafId = 0;
  function frame() {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (!dragging && Math.abs(velX) > 0.00005) {
      pivot.rotation.y += velX; velX *= 0.93; dirty = true;
    }
    if (dirty) { renderer.render(scene, camera); dirty = false; }
  }
  function animate() { if (!running && visible) { running = true; frame(); } }
  function stop() { running = false; cancelAnimationFrame(rafId); }

  // 화면 밖이면 렌더 정지 — 한 페이지에 3D 뷰어가 4개라 발열 방어가 더 중요
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible) animate(); else stop();
  }, { rootMargin: '100px' }).observe(stage);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else animate();
  });
}

/* ═══════════════════════════════════════════════════════════
   시작 — 뷰포트에 가까워지면 초기화 (4개를 한꺼번에 받지 않도록)
   ═══════════════════════════════════════════════════════════ */
const stages = build();

const lazy = new IntersectionObserver((entries, obs) => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    obs.unobserve(en.target);
    const { stage, metrics, cfg } = en.target.__entry;
    create3D(stage, metrics, cfg);
  });
}, { rootMargin: PRELOAD_DISTANCE });

for (const entry of stages) {
  const { stage, cfg } = entry;
  if (!cfg) { overlay(stage).error('해당 자료 없음'); continue; }
  stage.__entry = entry;
  lazy.observe(stage);
}
