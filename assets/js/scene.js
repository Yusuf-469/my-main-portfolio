// 3D layer: five procedural scenes, one per section, driven by window.__site (see ui.js),
// rendered through bloom and a camcorder pass (VHS tape signal + CRT light + curved glass).
// Nothing here is content; all text lives in the HTML.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const H = document.documentElement;
const site = window.__site;
const canvas = document.getElementById('gl');
const MOBILE = matchMedia('(max-width: 760px)').matches;
const Q = MOBILE ? 0.6 : 1; // geometry budget
const TEAL = new THREE.Color(121 / 255, 199 / 255, 199 / 255);

let rng = 7;
const rand = (a = 0, b = 1) => {
  rng = (rng + 0x6d2b79f5) | 0;
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const VS_UV = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const VS_INST = /* glsl */ `
  attribute float aSeed; attribute vec3 aColor;
  varying vec2 vUv; varying float vSeed; varying vec3 vColor;
  void main() { vUv = uv; vSeed = aSeed; vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;

function instAttr(mesh, name, arr, size) {
  mesh.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
}

// ---------------------------------------------------------------- renderer + post
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  site.fallback();
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.NoToneMapping;
canvas.addEventListener('webglcontextlost', () => site.fallback());

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.6, 0.7);

// Camcorder: the frame is treated as a tape signal (sharp luma, blurred and delayed chroma,
// line jitter, a rolling tracking band, grain, chroma noise, dropouts, lifted blacks), then shown
// on a CRT (glow, hum bar, flicker, vignette, scanlines) behind curved glass. "Hand" boosts the
// tape faults during a cut between scenes; "glitch" adds tears.
const cam = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uHand: { value: 0 }, uGlitch: { value: 0 }, uCurve: { value: 0.07 }, uTape: { value: 1100 },
    uSat: { value: 1.35 }, uVig: { value: 1 }, uEdge: { value: new THREE.Color(0) }, uBlack: { value: 0.03 },
  },
  vertexShader: VS_UV,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uHand, uGlitch, uCurve, uTape, uSat, uVig, uBlack;
    uniform vec3 uEdge; varying vec2 vUv;
    float h(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 toYiq(vec3 c){ return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
    vec3 toRgb(vec3 y){ return vec3(y.x + 0.956 * y.y + 0.621 * y.z, y.x - 0.272 * y.y - 0.647 * y.z, y.x - 1.106 * y.y + 1.703 * y.z); }
    vec3 tap(vec2 uv){ return texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb; }
    void main(){
      vec2 c = vUv * 2.0 - 1.0;
      c *= 1.0 + uCurve * dot(c, c);
      vec2 uv = c * 0.5 + 0.5;
      // handheld camcorder drift
      float t = uTime;
      uv += vec2(0.0018 * sin(t * 2.0 + 0.5) + 0.0012 * sin(t * 3.0), 0.0012 * sin(t * 5.0 + 2.0) + 0.0009 * sin(t * 7.0 + 1.0));
      float tick = floor(t * 30.0);
      float line = floor(uv.y * uRes.y * 0.5);
      // line jitter, tracking band, tears
      float jit = (h(vec2(line, tick)) - 0.5) * 0.0011 * (1.0 + uHand * 7.0);
      float band = smoothstep(0.05, 0.0, abs(uv.y - fract(0.95 - t * 0.031)));
      jit += band * (h(vec2(line * 0.37, tick)) - 0.5) * (0.012 + uHand * 0.03);
      float tr = floor(uv.y * 38.0);
      jit += uGlitch * (h(vec2(tr, tick)) - 0.5) * 0.11 * step(0.62, h(vec2(tr, tick + 1.0)));
      uv.x += jit;
      // tape: sharp luma at tape resolution, chroma blurred and delayed to the right
      float px = 1.0 / uTape;
      vec3 s0 = tap(uv), sl = tap(uv - vec2(px, 0.0)), sr = tap(uv + vec2(px, 0.0));
      float y = toYiq(s0).x, yb = toYiq((sl + sr + s0) / 3.0).x;
      y += (y - yb) * 0.9;
      vec2 cu = uv - vec2(px * (3.0 + uHand * 10.0), 0.0);
      vec3 cb = (tap(cu - vec2(px * 3.0, 0.0)) + tap(cu) * 2.0 + tap(cu + vec2(px * 3.0, 0.0))) * 0.25;
      vec2 iq = toYiq(cb).yz * uSat;
      iq += (vec2(h(uv * uRes + tick), h(uv * uRes - tick * 1.3)) - 0.5) * (0.035 + uHand * 0.22);
      vec3 col = toRgb(vec3(y, iq));
      col += (h(uv * uRes * 1.31 + fract(t * 7.0) * 113.0) - 0.5) * (0.06 + uHand * 0.28);
      // dropouts: short white streaks
      float dl = floor(uv.y * uRes.y * 0.33);
      float drop = step(0.9982 - uHand * 0.006, h(vec2(dl, tick * 1.7)));
      col = mix(col, vec3(1.0), drop * step(abs(uv.x - h(vec2(dl + 3.0, tick))), 0.05 + 0.1 * h(vec2(dl, tick))) * 0.75);
      col = col * (1.0 - uBlack) + uBlack;
      // CRT light
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col += l * l * 0.2 * vec3(0.8, 1.0, 0.95);
      col *= 1.0 - 0.055 * (sin(uv.y * 6.2832 - t * 1.4) * 0.5 + 0.5);
      col *= 1.0 + (h(vec2(tick, 9.0)) - 0.5) * 0.04;
      col *= 0.94 + 0.06 * sin(vUv.y * uRes.y * 3.1416);
      vec2 q = vUv - 0.5;
      col *= mix(1.0, smoothstep(0.86, 0.22, length(q * vec2(1.0, 1.12))) * 0.65 + 0.35, uVig);
      float outside = step(1.0, max(abs(c.x), abs(c.y)));
      gl_FragColor = vec4(mix(clamp(col, 0.0, 1.2), uEdge, outside), 1.0);
    }`,
});
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(cam);

// ---------------------------------------------------------------- hero: skill constellation
// Official logos of the skills used in the projects (assets/data/skills.json), each on a small
// glass tile, laid out across the whole screen: every tile gets its own spot, away from the
// portrait, the text and each other (measured live, so nothing can overlap). Faint lines join
// neighbours. Hover (or tap) a tile for the projects that used the skill; clicking one opens it.
function makeLogos(scene, camera, list) {
  const group = new THREE.Group();
  scene.add(group);
  const tip = document.createElement('div');
  tip.className = 'skill-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  let shown = -1, pinned = -1, hideAt = 0;

  const items = list.map((sk) => {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tile = () => {
      g.clearRect(0, 0, 160, 160);
      g.fillStyle = 'rgba(6, 13, 15, 0.86)';
      g.strokeStyle = 'rgba(121, 199, 199, 0.55)';
      g.lineWidth = 3;
      g.beginPath(); g.roundRect(6, 6, 148, 148, 26); g.fill(); g.stroke();
    };
    tile();
    const img = new Image();
    img.onload = () => { tile(); g.drawImage(img, 36, 36, 88, 88); tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sk.svg);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 20;
    group.add(sp);
    const html = `<b>${sk.name}</b><small>used in</small><ul>` + sk.projects.map((p) =>
      `<li><button type="button" data-case="${p.id}"><img src="${p.img}" alt="" width="64" height="40" loading="lazy" decoding="async"><span>${p.name}</span></button></li>`).join('') + '</ul>';
    return { sp, mat, html, seed: rand(), hover: 0, on: false, order: 0, base: new THREE.Vector3(), pos: new THREE.Vector3(), screen: new THREE.Vector3(), sx: 0, sy: 0 };
  });

  // constellation lines between neighbouring tiles
  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.renderOrder = 19;
  group.add(lines);
  let edges = [];

  let tilePx = 56, worldSize = 0.7;
  const rest = new THREE.PerspectiveCamera();
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();

  // place tiles on free screen spots (Poisson-disc style), using the camera at rest
  function layout(w, h, dist, lift) {
    rest.copy(camera); rest.position.set(0, -lift, dist); rest.lookAt(0, -lift, 0); rest.updateMatrixWorld();
    tilePx = MOBILE ? 34 : Math.round(Math.min(64, Math.max(48, w / 26)));
    const pad = tilePx * 0.5 + (MOBILE ? 8 : 14);
    const blocked = [];
    const add = (r, m = MOBILE ? 8 : 18) => { if (r && r.width > 0) blocked.push({ l: r.left - m, t: r.top - m, r: r.right + m, b: r.bottom + m }); };
    document.querySelectorAll('#top .panel, .hud').forEach((el) => add(el.getBoundingClientRect()));
    // the portrait's silhouette: head narrower than the shoulders
    const toScreen = (x, y) => { const v = new THREE.Vector3(x, y, 0).project(rest); return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h]; };
    [[-2.5, 3.6, 2.5, -0.4], [-3.75, -0.4, 3.75, -3.7]].forEach(([x0, y0, x1, y1]) => {
      const [l, t] = toScreen(x0, y0), [r, b] = toScreen(x1, y1);
      const m = MOBILE ? 6 : 16;
      blocked.push({ l: l - m, t: t - m, r: r + m, b: b + m });
    });
    const free = (x, y) => x > pad && x < w - pad && y > pad && y < h - pad &&
      blocked.every((q) => x + tilePx / 2 < q.l || x - tilePx / 2 > q.r || y + tilePx / 2 < q.t || y - tilePx / 2 > q.b);
    // jittered grid of candidates, deterministic
    let r0 = 98765;
    const rnd = () => { r0 = (r0 * 16807) % 2147483647; return r0 / 2147483647; };
    const cell = tilePx * 1.35, cand = [];
    for (let y = cell / 2; y < h; y += cell) for (let x = cell / 2; x < w; x += cell) {
      const px = x + (rnd() - 0.5) * cell * 0.5, py = y + (rnd() - 0.5) * cell * 0.5;
      if (free(px, py)) cand.push([px, py, rnd()]);
    }
    cand.sort((a, b) => a[2] - b[2]);
    // greedy: keep the largest spacing that still fits every tile
    let picked = [];
    for (let minD = tilePx * 2.6; minD >= tilePx * (MOBILE ? 1.12 : 1.25); minD *= 0.92) {
      picked = [];
      for (const c of cand) {
        if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) >= minD)) picked.push(c);
        if (picked.length === items.length) break;
      }
      if (picked.length === items.length) break;
    }
    const cx = w / 2, cy = h / 2;
    items.forEach((it, i) => {
      it.on = i < picked.length;
      if (!it.on) { it.sp.visible = false; return; }
      it.sp.visible = true;
      const [px, py] = picked[i];
      it.sx = px; it.sy = py;
      it.order = Math.hypot(px - cx, py - cy) / Math.hypot(cx, cy); // tiles appear from the centre outward
      const z = rand(-1.2, 1.2);
      plane.constant = -z;
      ray.setFromCamera({ x: (px / w) * 2 - 1, y: -((py / h) * 2 - 1) }, rest);
      ray.ray.intersectPlane(plane, hit);
      it.base.copy(hit);
      const d = rest.position.distanceTo(hit);
      it.size = (tilePx / h) * 2 * d * Math.tan(THREE.MathUtils.degToRad(rest.fov / 2));
    });
    // join each tile to its two nearest neighbours
    const on = items.filter((it) => it.on);
    const set = new Set();
    edges = [];
    on.forEach((a, i) => {
      on.map((b, j) => [j, Math.hypot(a.sx - b.sx, a.sy - b.sy)]).filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]).slice(0, 2)
        .forEach(([j, dd]) => { const k = i < j ? `${i}-${j}` : `${j}-${i}`; if (dd < tilePx * 5 && !set.has(k)) { set.add(k); edges.push([a, on[j]]); } });
    });
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3));
  }

  function show(i, w, h) {
    if (i !== shown) { tip.innerHTML = items[i].html; shown = i; }
    tip.hidden = false;
    const s = items[i].screen;
    const x = (s.x * 0.5 + 0.5) * w, y = (-s.y * 0.5 + 0.5) * h;
    const tw = tip.offsetWidth, th = tip.offsetHeight, off = tilePx * 0.6 + 12;
    const left = x + off + tw > w - 8 ? x - off - tw : x + off;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.min(h - th - 8, Math.max(8, y - th / 2)) + 'px';
    requestAnimationFrame(() => tip.classList.add('on'));
  }
  function hide() { tip.classList.remove('on'); tip.hidden = true; shown = -1; pinned = -1; }
  function nearest(px, py, w, h) {
    let best = -1, bd = 1e9;
    items.forEach((it, i) => {
      if (!it.on || it.mat.opacity < 0.3) return;
      const d = Math.hypot((it.screen.x - px) * w / 2, (it.screen.y - py) * h / 2);
      if (d < tilePx * 0.62 && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  return {
    layout,
    update(t, time, ptr, intro) {
      const w = innerWidth, h = innerHeight;
      const exit = smooth(0.3, 0.75, t);
      for (const it of items) {
        if (!it.on) continue;
        const sd = it.seed * 10;
        it.pos.set(
          it.base.x + Math.sin(time * 0.5 + sd) * it.size * 0.12,
          it.base.y + Math.cos(time * 0.42 + sd * 1.3) * it.size * 0.14,
          it.base.z,
        );
        // on scroll the constellation spreads out toward the camera
        it.pos.x *= 1 + exit * 0.9; it.pos.y *= 1 + exit * 0.9; it.pos.z += exit * 6;
        it.screen.copy(it.pos).project(camera);
        if (ptr.active) {
          const dx = it.screen.x - ptr.rawX, dy = it.screen.y - ptr.rawY;
          const f = Math.exp(-(dx * dx * (w / h) * (w / h) + dy * dy) * 16);
          it.pos.x += Math.sign(dx) * f * it.size * 0.25; it.pos.y += Math.sign(dy) * f * it.size * 0.25;
        }
      }
      const hov = ptr.active && t < 0.28 ? nearest(ptr.rawX, ptr.rawY, w, h) : -1;
      items.forEach((it, i) => {
        if (!it.on) return;
        it.hover += ((i === hov || i === pinned ? 1 : 0) - it.hover) * 0.2;
        const appear = smooth(it.order * 0.7, it.order * 0.7 + 0.3, intro);
        it.sp.position.copy(it.pos);
        it.sp.scale.setScalar(it.size * (0.6 + appear * 0.4) * (1 + it.hover * 0.22));
        it.mat.rotation = Math.sin(time * 0.6 + it.seed * 9) * 0.06;
        it.mat.opacity = appear * (1 - exit) * (0.82 + it.hover * 0.18);
      });
      // lines follow the tiles; brighter when one end is hovered
      const arr = lineGeo.attributes.position ? lineGeo.attributes.position.array : null;
      if (arr) {
        edges.forEach(([a, b], k) => { arr.set([a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z], k * 6); });
        lineGeo.attributes.position.needsUpdate = true;
        lineMat.opacity = smooth(0.6, 1, intro) * (1 - exit) * (0.16 + (hov >= 0 ? 0.12 : 0));
      }
      canvas.style.cursor = hov >= 0 ? 'pointer' : '';
      if (t >= 0.28) { if (shown >= 0) hide(); return; }
      let overTip = false;
      if (shown >= 0 && ptr.active) {
        const r = tip.getBoundingClientRect(), px = (ptr.rawX * 0.5 + 0.5) * w, py = (-ptr.rawY * 0.5 + 0.5) * h;
        overTip = px >= r.left - 12 && px <= r.right + 12 && py >= r.top - 12 && py <= r.bottom + 12;
      }
      if (overTip) { hideAt = 0; return; }
      const want = hov >= 0 ? hov : pinned;
      if (want >= 0) { show(want, w, h); hideAt = 0; }
      else if (shown >= 0) {
        if (!hideAt) hideAt = performance.now() + 250;
        if (performance.now() > hideAt) { hide(); hideAt = 0; }
      }
    },
    tapAt(x, y) {
      const w = innerWidth, h = innerHeight;
      const i = nearest((x / w) * 2 - 1, -((y / h) * 2 - 1), w, h);
      if (i >= 0) { pinned = i; show(i, w, h); } else hide();
    },
    hide,
  };
}

// ---------------------------------------------------------------- hero: pixel-block portrait
// Quadtree blocks from the photo (assets/data/hero-cells.json). The grid fades in over 1.5 s,
// blocks glitch along rows, and the cursor pushes them away like a field.
function makeHero(data, skills) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020304);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(40, 96, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uTime: { value: 0 }, uTint: { value: TEAL } },
    vertexShader: VS_UV,
    fragmentShader: /* glsl */ `varying vec2 vUv; uniform float uTime; uniform vec3 uTint;
      float ln(float x, float w){ return smoothstep(0.5 - w, 0.5, abs(fract(x) - 0.5)); }
      void main(){
        float g = max(ln(vUv.x * 72.0, 0.035), ln(vUv.y * 36.0, 0.05));
        float band = smoothstep(0.012, 0.0, abs(vUv.y - 0.5 - 0.18 * sin(uTime * 0.21)));
        gl_FragColor = vec4(uTint * (g * 0.11 + band * 0.26), 1.0);
      }`,
  }));
  scene.add(sphere);

  const N = data.n, cells = data.cells, count = cells.length / 4, U = 7 / N;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntro: { value: 0 }, uExit: { value: 0 }, uCursor: { value: new THREE.Vector3(99, 99, 0) }, uTint: { value: TEAL }, uPhoto: { value: null }, uHas: { value: 0 }, uBreak: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aLum, aSeed, aSize; uniform float uTime, uExit, uBreak, uHas; uniform vec3 uCursor;
      varying vec2 vUv, vPhoto; varying float vLum, vSeed, vB, vPush, vMono;
      void main(){
        vUv = uv; vLum = aLum; vSeed = aSeed; vB = 0.13 / sqrt(aSize);
        vec4 p = instanceMatrix * vec4(position, 1.0);
        vPhoto = p.xy / 7.0 + 0.5; // the portrait spans 7 units, centred
        vec3 ctr = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 d = ctr.xy - uCursor.xy;
        float f = exp(-dot(d, d) / 0.45) * uCursor.z;
        vPush = f;
        // the colour photo breaks into blocks from the top as you scroll, and locally under the cursor
        float edge = uBreak * 1.2 - (0.5 - ctr.y / 7.0) - aSeed * 0.15;
        vMono = uHas > 0.5 ? max(clamp(edge * 10.0, 0.0, 1.0), smoothstep(0.15, 0.7, f)) : 1.0;
        p.z += sin(vMono * 3.1416) * 0.3;
        p.xy += normalize(d + 1e-4) * f * 0.35;
        p.z += f * (0.6 + aSeed * 1.2);
        float row = floor(p.y * 7.0), tick = floor(uTime * 7.0);
        float r = fract(sin(row * 91.7 + tick * 13.1) * 4375.5);
        p.x += step(0.975, r) * (r - 0.987) * 4.0 * vMono;
        p.z += uExit * aSeed * 9.0;
        p.xy *= 1.0 + uExit * aSeed * 0.8;
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uIntro, uExit, uHas, uBreak; uniform vec3 uTint; uniform sampler2D uPhoto;
      varying vec2 vUv, vPhoto; varying float vLum, vSeed, vB, vPush, vMono;
      void main(){
        if (vSeed > uIntro) discard;
        vec4 ph = texture2D(uPhoto, vPhoto);
        if (uHas > 0.5 && vMono < 0.5 && ph.a < 0.5) discard; // clean cut-out edge while in colour
        vec2 e = min(vUv, 1.0 - vUv);
        float border = step(min(e.x, e.y), vB);
        float flick = step(0.997, fract(sin(vSeed * 7123.1 + floor(uTime * 9.0)) * 9123.7));
        // full photo detail inside each block (same grade as before), flat block tone until it loads
        float l = vLum;
        if (uHas > 0.5) {
          vec3 ph = texture2D(uPhoto, vPhoto).rgb;
          l = clamp((dot(ph, vec3(0.299, 0.587, 0.114)) - 0.05) / 0.98, 0.0, 1.0);
        }
        vec3 base = mix(uTint * 0.09, mix(uTint, vec3(1.0), 0.66), pow(l, 1.2));
        vec3 mono = mix(base, base * 0.35, border) + flick * 0.7 + vPush * uTint * 0.6;
        vec3 col = mix(ph.rgb * 0.88, mono, vMono);
        float line = uBreak * 1.2 - (1.0 - vPhoto.y);
        col += vec3(0.6, 1.0, 1.0) * smoothstep(0.018, 0.0, abs(line)) * step(0.001, uBreak) * step(uBreak, 0.999) * 1.4;
        gl_FragColor = vec4(col * (1.0 - uExit * 0.55), 1.0);
      }`,
  });
  new THREE.TextureLoader().load('assets/portrait-cut.webp', (tx) => {
    tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
    mat.uniforms.uPhoto.value = tx; mat.uniforms.uHas.value = 1;
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
  const lum = new Float32Array(count), seed = new Float32Array(count), size = new Float32Array(count);
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const x = cells[4 * k], y = cells[4 * k + 1], s = cells[4 * k + 2];
    m.makeScale(s * U, s * U, 1).setPosition((x + s / 2 - N / 2) * U, -(y + s / 2 - N / 2) * U, 0);
    mesh.setMatrixAt(k, m);
    lum[k] = cells[4 * k + 3] / 255; seed[k] = rand(); size[k] = s;
  }
  instAttr(mesh, 'aLum', lum, 1); instAttr(mesh, 'aSeed', seed, 1); instAttr(mesh, 'aSize', size, 1);
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  const logos = makeLogos(scene, camera, skills);

  let dist = 15, lift = 0;
  const born = performance.now() / 1000;
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  const cur = mat.uniforms.uCursor.value;
  return {
    scene, camera, bloom: [0.4, 0.5, 0.95], edge: 0x000000, vig: 1, tapAt: (x, y) => logos.tapAt(x, y), leave: () => { logos.hide(); canvas.style.cursor = ''; },
    resize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      dist = Math.max(3.5 / tan / 0.86, 3.5 / (tan * camera.aspect) / (MOBILE ? 1.05 : 0.95));
      lift = MOBILE ? 0.9 : 0;
      logos.layout(w, h, dist, lift);
    },
    update(t, time, dt, ptr) {
      mat.uniforms.uTime.value = time;
      // grid reveal: 1.5 s, ease-out
      const k = clamp01((time - born) / 1.5);
      mat.uniforms.uIntro.value = 1 - (1 - k) * (1 - k);
      logos.update(t, time, ptr, clamp01((time - born - 0.8) / 1.2));
      mat.uniforms.uBreak.value = clamp01((t - 0.02) / 0.4);
      mat.uniforms.uExit.value = smooth(0.5, 1, t);
      sphere.material.uniforms.uTime.value = time;
      sphere.rotation.y = time * 0.012 + t * 0.5;
      group.rotation.y = ptr.x * 0.1;
      group.rotation.x = -ptr.y * 0.05;
      camera.position.set(ptr.x * 0.35, ptr.y * 0.25 - lift, dist * (1 - t * 0.42));
      camera.lookAt(0, -lift, 0);
      // cursor field in the portrait plane
      ray.setFromCamera({ x: ptr.rawX, y: ptr.rawY }, camera);
      const on = ptr.active && ray.ray.intersectPlane(plane, hit);
      if (on) { cur.x = hit.x; cur.y = hit.y; }
      cur.z += ((on ? 1 : 0) - cur.z) * (1 - Math.exp(-dt * 4));
    },
  };
}

// ---------------------------------------------------------------- selected work: screens in white space
const CODE = [
  '[ppo] eval seeds 2500 | cost vs best rule -8.5% | holm p=0.0005',
  'sim.validate(M/M/c) -> 15/15 inside 95% CI',
  'guard.enabled = True  # collapses 5 -> 0 of 1250',
  'policy.check(tool="send") -> needs approval',
  'agent.plan(goal) -> act -> verify -> recover',
  'strip_hidden_text(page)  # prompt-injection filter',
  'retrieve(q, k=5): bge-small + faiss -> rerank(cross-encoder)',
  'chunker=section_aware  hit@5=0.958  mrr=0.741',
  'answer.cite_check() -> 44/48 correct, 11/11 refused',
  'pipeline: scaler -> pca(0.95) -> smote(train) -> xgboost',
  'heldout acc 0.8082 (59/73)  baseline 0.7397',
  'news2(spo2=91, hr=131, temp=38.2) -> 7 critical',
  'baseline.update(alpha=0.1)  feedback x0.85',
  'POST /api/health-data 201  device=esp32',
  'jenkins: build -> test -> docker push -> ec2 deploy',
  'vercel edge: /api/chat  key stays on the server',
  'useFrame(() => mesh.rotation.y += 0.002)',
  'firebase.auth().onAuthStateChanged(user => route(user))',
];
function codeTexture(seedOffset) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.font = '500 19px "IBM Plex Mono", monospace';
  g.fillStyle = 'rgba(120, 126, 130, 0.6)';
  for (let i = 0; i < 20; i++) {
    const s = CODE[(i * 7 + seedOffset * 5) % CODE.length];
    const ts = `${String(9 + (i % 12)).padStart(2, '0')}:${String((i * 17 + seedOffset * 11) % 60).padStart(2, '0')}:${String((i * 31) % 60).padStart(2, '0')}`;
    g.fillText(`${ts}  ${s}`, 16, 30 + i * 24);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeWork() {
  const scene = new THREE.Scene();
  const paper = new THREE.Color(0xf1f2f2);
  scene.background = paper;
  scene.fog = new THREE.Fog(paper, 7, 34);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  const cards = [...document.querySelectorAll('.work-card')];
  const N = cards.length;
  const W = 4.8, Hh = 3;

  const geo = new THREE.PlaneGeometry(W, Hh, 40, 24);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (W / 2), y = pos.getY(i) / (Hh / 2);
    pos.setZ(i, 0.3 * x * x + 0.12 * y * y);
  }
  const loader = new THREE.TextureLoader();
  const screens = cards.map((card, i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uHas: { value: 0 }, uSize: { value: new THREE.Vector2(W, Hh) }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uHas, uTime; uniform vec2 uSize; varying vec2 vUv;
        float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        void main(){
          vec2 p = (vUv - 0.5) * uSize;
          if (rbox(p, uSize * 0.5, 0.28) > 0.0) discard;
          float bez = 0.11;
          vec3 col = vec3(0.025);
          if (rbox(p, uSize * 0.5 - bez, 0.2) < 0.0) {
            vec2 iu = p / (uSize - 2.0 * bez) + 0.5;
            col = uHas > 0.5 ? texture2D(uMap, iu).rgb : vec3(0.12);
            col *= 0.94 + 0.06 * sin(iu.y * 700.0 + uTime * 3.0);
            col += 0.05 * smoothstep(0.6, 0.0, length(iu - vec2(0.3, 0.85)));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    loader.load(card.dataset.img, (tx) => {
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = 4;
      mat.uniforms.uMap.value = tx; mat.uniforms.uHas.value = 1;
      site.loaded = (site.loaded || 0) + 1;
    });
    const mesh = new THREE.Mesh(geo, mat);
    const p = new THREE.Vector3(Math.sin(i * 1.35) * 2.4, -i * 4.4, -i * 6.5);
    mesh.position.copy(p);
    mesh.rotation.y = -p.x * 0.06;
    mesh.rotation.z = (i % 2 ? 1 : -1) * 0.025;
    scene.add(mesh);
    return { mesh, mat, p, video: card.dataset.video || '', vid: null, img: null };
  });

  // drifting sheets of log text and black shards, like light passing through a studio
  const texes = [0, 1, 2, 3].map(codeTexture);
  const sheetGeo = new THREE.PlaneGeometry(11, 5.5);
  const sheets = [];
  for (let k = 0; k < Math.round(18 * Q + 4); k++) {
    const base = screens[k % N].p;
    const mat = new THREE.MeshBasicMaterial({ map: texes[k % 4].clone(), transparent: true, depthWrite: false, opacity: 0.5 });
    mat.map.needsUpdate = true;
    const s = new THREE.Mesh(sheetGeo, mat);
    s.position.set(base.x + rand(-11, 11), base.y + rand(-5, 3), base.z + rand(-13, -6));
    s.rotation.set(rand(-1.1, -0.3), rand(-0.6, 0.6), rand(-0.4, 0.4));
    s.userData.v = rand(0.004, 0.012);
    scene.add(s);
    sheets.push(s);
  }
  const shardMat = new THREE.MeshBasicMaterial({ color: 0x050607, side: THREE.DoubleSide });
  for (let k = 0; k < Math.round(12 * Q + 2); k++) {
    const base = screens[k % N].p;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(rand(3, 8), rand(0.4, 1.4)), shardMat);
    s.position.set(base.x + rand(-9, 9), base.y + rand(-5, 5), base.z + rand(-10, -2));
    s.rotation.set(rand(-1.4, 1.4), rand(-1, 1), rand(-1.4, 1.4));
    scene.add(s);
  }

  let D = 7, ox = 0, oy = 0, active = -1;
  const camAt = (i) => new THREE.Vector3(screens[i].p.x - ox, screens[i].p.y - oy, screens[i].p.z + D);
  const lookAt = (i) => new THREE.Vector3(screens[i].p.x - ox, screens[i].p.y - oy, screens[i].p.z);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function setActive(i) {
    if (i === active) return;
    screens.forEach((s, k) => { if (s.vid && k !== i) s.vid.pause(); });
    const s = screens[i];
    if (s.video && !MOBILE) {
      if (!s.vid) {
        const v = document.createElement('video');
        Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous', src: s.video });
        v.addEventListener('loadeddata', () => {
          const vt = new THREE.VideoTexture(v);
          vt.colorSpace = THREE.SRGBColorSpace;
          s.img = s.mat.uniforms.uMap.value;
          s.mat.uniforms.uMap.value = vt; s.mat.uniforms.uHas.value = 1;
        }, { once: true });
        s.vid = v;
      }
      s.vid.play().catch(() => {});
    }
    active = i;
  }

  return {
    scene, camera, bloom: [0, 0, 1], edge: 0xf1f2f2, light: true, vig: 0.55,
    resize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const share = MOBILE ? 0.9 : 0.5;
      D = Math.max((W / share / 2) / (tan * camera.aspect), (Hh / (MOBILE ? 0.42 : 0.66) / 2) / tan);
      const viewW = 2 * D * tan * camera.aspect, viewH = 2 * D * tan;
      ox = MOBILE ? 0 : viewW * 0.12;
      oy = MOBILE ? viewH * 0.21 : viewH * 0.02;
    },
    update(t, time, dt, ptr) {
      const f = t * N;
      const i = Math.min(N - 1, Math.floor(f));
      const w = f - i;
      const k = i < N - 1 ? ease(clamp01((w - 0.55) / 0.45)) : 0;
      const j = Math.min(N - 1, i + 1);
      tmpA.copy(camAt(i)).lerp(camAt(j), k);
      tmpA.z += Math.sin(k * Math.PI) * 3.5;
      tmpA.x += ptr.x * 0.25; tmpA.y += ptr.y * 0.15;
      tmpB.copy(lookAt(i)).lerp(lookAt(j), k);
      camera.position.copy(tmpA);
      camera.up.set(Math.sin(Math.sin(k * Math.PI) * 0.22 * (i % 2 ? 1 : -1)), 1, 0).normalize();
      camera.lookAt(tmpB);
      setActive(k < 0.5 ? i : j);
      screens.forEach((s, n) => {
        s.mat.uniforms.uTime.value = time;
        s.mesh.rotation.x = Math.sin(time * 0.5 + n) * 0.025;
      });
      sheets.forEach((s) => { s.material.map.offset.y += s.userData.v * dt; });
    },
    leave() { screens.forEach((s) => s.vid && s.vid.pause()); active = -1; },
  };
}


// ---------------------------------------------------------------- floating text cards
// The written panels of a section (.panel.ghost in the HTML) are drawn onto canvases and float in
// front of the camera: each decodes in block by block as it flies in, drifts and tilts with the
// mouse, and its links light up on hover and act on click. The HTML stays the source of the text.
const F_D = '"Doto", ui-monospace, monospace';
const F_M = '"IBM Plex Mono", ui-monospace, monospace';
const C_INK = '#eef4f4', C_INK2 = '#b9c7c9', C_INK3 = '#8b9a9c', C_TEAL = '#79c7c7', C_LIVE = '#2bff5e', C_AWS = '#ff9900';
const txt = (el, sel) => { const n = sel ? el.querySelector(sel) : el; return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };

function wrapLines(g, text, maxW) {
  const out = []; let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && g.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

async function readPanel(el) {
  const kind = el.dataset.card;
  const [a, b] = el.dataset.at.split(',').map(Number);
  const s = { kind, a, b, label: txt(el, '.label') };
  if (kind === 'statement') {
    s.text = txt(el, '.statement');
    s.stats = [...el.querySelectorAll('.stats > div')].map((d) => [txt(d, 'b'), txt(d, 'span')]);
    s.small = txt(el, '.small');
  } else if (kind === 'steps') {
    s.lede = txt(el, '.lede');
    s.items = [...el.querySelectorAll('.steps > li')].map((li) => ({
      num: txt(li, '.num'), title: txt(li, 'h3'), text: txt(li, 'p'),
      links: [...li.querySelectorAll('[data-case]')].map((b) => ({ label: b.textContent.trim(), action: { case: b.dataset.case } })),
    }));
  } else if (kind === 'summary') {
    s.prompt = txt(el, '.prompt'); s.sub = txt(el, '.term-h'); s.foot = txt(el, '.term-foot');
    s.rows = [...el.querySelectorAll('tbody tr')].map((tr) => {
      const th = tr.querySelector('th');
      return { name: th.firstChild.textContent.trim(), type: txt(th, 'i'), w: txt(tr, 'td') };
    });
  } else if (kind === 'git') {
    s.prompt = txt(el, '.prompt'); s.meta = txt(el, '.meta-line'); s.title = txt(el, 'h3'); s.text = txt(el, '.small');
    s.diff = [...el.querySelectorAll('.diff li')].map((li) => txt(li));
    s.chips = [...el.querySelectorAll('.chips li')].map((li) => txt(li));
    s.links = [...el.querySelectorAll('.see [data-case], .see a')].map((n) => ({ label: n.textContent.trim(), action: n.dataset.case ? { case: n.dataset.case } : { href: n.href } }));
  } else if (kind === 'years') {
    s.items = await Promise.all([...el.querySelectorAll('.years > li')].map(async (li) => {
      const img = li.querySelector('img');
      let pic = null;
      if (img) { const im = new Image(); im.src = img.src; try { await im.decode(); pic = im; } catch (e) { pic = null; } }
      return { yr: txt(li, '.yr'), title: txt(li, 'h3'), text: txt(li, 'p'), pic, mono: txt(li, '.mono-logo') };
    }));
  } else if (kind === 'cert') {
    s.k = txt(el, '.cert-k'); s.name = txt(el, '.cert-name'); s.who = txt(el, '.cert-who');
    s.meta = [...el.querySelectorAll('.cert-meta > div')].map((d) => [txt(d, 'dt'), txt(d, 'dd')]);
    const a = el.querySelector('a');
    s.links = a ? [{ label: a.textContent.trim(), action: { href: a.href } }] : [];
  }
  return s;
}

function renderCard(s) {
  const W = MOBILE ? 760 : 960, P = MOBILE ? 46 : 52;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const regions = [];
  const draw = (dry) => {
    let y = P;
    const set = (w, size, fam = F_M, ls = 0) => { g.font = `${w} ${size}px ${fam}`; g.letterSpacing = ls + 'px'; };
    const put = (str, x, base, col) => { if (!dry) { g.fillStyle = col; g.fillText(str, x, base); } };
    const para = (str, size, col, { x = P, w = W - 2 * P, weight = 400, lh = 1.5, fam = F_M, ls = 0, upper = false } = {}) => {
      set(weight, size, fam, ls);
      for (const line of wrapLines(g, upper ? str.toUpperCase() : str, w)) { put(line, x, y + size * 0.8, col); y += size * lh; }
    };
    const label = (str) => { if (!str) return; para(str, 21, C_INK3, { weight: 500, ls: 4, upper: true }); y += 10; };
    const links = (list) => {
      if (!list || !list.length) return;
      set(600, 22, F_M, 2);
      let x = P;
      const h = 44;
      for (const l of list) {
        const t = `> ${l.label.toUpperCase()}` + (l.action.href ? ' ↗' : '');
        const w = g.measureText(t).width;
        if (x + w > W - P) { x = P; y += h + 6; }
        if (!dry) {
          g.strokeStyle = 'rgba(121,199,199,.55)'; g.lineWidth = 1.5; g.strokeRect(x - 10, y, w + 20, h);
          g.fillStyle = C_TEAL; g.fillText(t, x, y + 29);
        }
        regions.push({ x0: x - 10, y0: y, x1: x + w + 10, y1: y + h, action: l.action });
        x += w + 36;
      }
      y += h + 4;
    };
    if (!dry) {
      g.fillStyle = 'rgba(2, 8, 9, 0.8)';
      g.fillRect(0, 0, W, c.height);
      g.strokeStyle = C_TEAL; g.lineWidth = 3;
      const L = 34, H = c.height;
      [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].forEach(([x, yy, sx, sy]) => {
        g.beginPath(); g.moveTo(x + sx * L, yy + sy * 1.5); g.lineTo(x + sx * 1.5, yy + sy * 1.5); g.lineTo(x + sx * 1.5, yy + sy * L); g.stroke();
      });
    }
    if (s.kind === 'statement') {
      label(s.label);
      para(s.text, MOBILE ? 31 : 33, C_INK, { lh: 1.45 });
      y += 18;
      const colW = (W - 2 * P) / s.stats.length, top = y;
      let bottom = y;
      s.stats.forEach(([n, cap], i) => {
        y = top;
        para(n, 86, C_TEAL, { x: P + i * colW, w: colW - 20, weight: 900, fam: F_D, lh: 1.0 });
        para(cap, 19, C_INK2, { x: P + i * colW, w: colW - 24, weight: 500, ls: 2, upper: true, lh: 1.4 });
        bottom = Math.max(bottom, y);
      });
      y = bottom + 16;
      para(s.small, 23, C_INK2);
    } else if (s.kind === 'steps') {
      label(s.label);
      if (s.lede) { para(s.lede, 25, C_INK2); y += 14; }
      const NX = MOBILE ? 118 : 150;
      s.items.forEach((it) => {
        const top = y;
        set(900, MOBILE ? 84 : 100, F_D);
        if (!dry) { g.strokeStyle = C_TEAL; g.lineWidth = 2; g.strokeText(it.num, P, top + (MOBILE ? 70 : 82)); }
        para(it.title, 31, C_INK, { x: P + NX, w: W - 2 * P - NX, weight: 600, lh: 1.3 });
        y += 4;
        para(it.text, 23, C_INK2, { x: P + NX, w: W - 2 * P - NX, lh: 1.5 });
        y += 8;
        const x0 = P + NX;
        set(600, 20, F_M, 2);
        let x = x0;
        it.links.forEach((l) => {
          const t = `> ${l.label.toUpperCase()}`, w = g.measureText(t).width;
          if (!dry) { g.fillStyle = C_TEAL; g.fillText(t, x, y + 24); }
          regions.push({ x0: x - 8, y0: y - 6, x1: x + w + 8, y1: y + 36, action: l.action });
          x += w + 30;
        });
        y = Math.max(y + 46, top + 110);
      });
    } else if (s.kind === 'summary') {
      para(s.prompt, 29, C_LIVE, { weight: 600 });
      if (s.sub) para(s.sub, 21, C_INK2);
      y += 10;
      const NX = MOBILE ? 250 : 320;
      if (!dry) { g.fillStyle = 'rgba(238,244,244,.3)'; g.fillRect(P, y, W - 2 * P, 1.5); }
      y += 14;
      s.rows.forEach((r) => {
        const top = y;
        para(r.name, 25, C_TEAL, { weight: 600, w: NX - 20 });
        para(r.type, 20, C_INK3, { w: NX - 20 });
        const left = y; y = top;
        para(r.w, 23, C_INK, { x: P + NX, w: W - 2 * P - NX, lh: 1.5 });
        y = Math.max(y, left) + 12;
        if (!dry) { g.setLineDash([6, 6]); g.strokeStyle = 'rgba(238,244,244,.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(P, y - 6); g.lineTo(W - P, y - 6); g.stroke(); g.setLineDash([]); }
        y += 8;
      });
      if (s.foot) para(s.foot, 21, C_INK2);
    } else if (s.kind === 'git') {
      para(s.prompt, 27, C_LIVE, { weight: 600 });
      para(s.meta, 21, C_INK2, { ls: 1 });
      y += 6;
      para(s.title, MOBILE ? 36 : 40, C_INK, { weight: 600, lh: 1.25 });
      y += 4;
      para(s.text, 23, C_INK2);
      y += 6;
      s.diff.forEach((d) => {
        set(700, 23); put('+', P, y + 18, C_LIVE);
        para(d, 22, C_INK2, { x: P + 26, w: W - 2 * P - 26, lh: 1.45 });
        y += 4;
      });
      y += 6;
      set(500, 20, F_M, 1);
      let x = P;
      s.chips.forEach((ch) => {
        const w = g.measureText(ch).width + 22;
        if (x + w > W - P) { x = P; y += 42; }
        if (!dry) { g.strokeStyle = 'rgba(238,244,244,.4)'; g.lineWidth = 1.2; g.strokeRect(x, y, w, 34); g.fillStyle = C_INK; g.fillText(ch, x + 11, y + 23); }
        x += w + 10;
      });
      y += 52;
      links(s.links);
    } else if (s.kind === 'years') {
      label('education');
      const YX = MOBILE ? 120 : 150, LX = YX + 70;
      s.items.forEach((it) => {
        const top = y;
        set(900, MOBILE ? 50 : 60, F_D); put(it.yr, P, top + 46, C_TEAL);
        if (!dry) {
          g.fillStyle = '#fff'; g.fillRect(P + YX, top, 54, 54);
          if (it.pic) g.drawImage(it.pic, P + YX + 4, top + 4, 46, 46);
          else { set(900, 22, F_D); g.fillStyle = '#0b0d0e'; g.fillText(it.mono, P + YX + 12, top + 35); }
        }
        para(it.title, 28, C_INK, { x: P + LX, w: W - 2 * P - LX, weight: 600, lh: 1.25 });
        para(it.text, 21, C_INK2, { x: P + LX, w: W - 2 * P - LX, lh: 1.45 });
        y = Math.max(y, top + 64) + 22;
      });
    } else if (s.kind === 'cert') {
      label(s.label);
      if (!dry) {
        g.fillStyle = C_AWS; g.beginPath();
        const cx = P + 9, cy = y + 13;
        for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; g.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10); }
        g.fill();
      }
      para(s.k, 21, C_INK2, { x: P + 30, weight: 600, ls: 3, upper: true });
      y += 8;
      para(s.name, MOBILE ? 66 : 80, C_INK, { weight: 900, fam: F_D, upper: true, lh: 1.0 });
      y += 8;
      para(s.who, 22, C_INK2, { weight: 600, ls: 7, upper: true });
      y += 16;
      const half = (W - 2 * P) / 2, top = y;
      s.meta.forEach(([k, v], i) => {
        const full = i >= 2;
        const x = full ? P : P + (i % 2) * half;
        if (!full) y = top;
        para(k, 18, C_INK3, { x, w: full ? W - 2 * P : half - 20, weight: 500, ls: 3, upper: true, lh: 1.4 });
        para(v, full ? 22 : 26, full ? C_INK2 : C_INK, { x, w: full ? W - 2 * P : half - 20, weight: 500 });
        y += 12;
      });
      y += 6;
      links(s.links);
    }
    return Math.ceil(y + P - 10);
  };
  c.width = W;
  c.height = draw(true);
  regions.length = 0;
  draw(false);
  return { canvas: c, regions };
}

function makeCards(section, camera) {
  // Cards live in their own scene, drawn after the camcorder pass so the text stays sharp;
  // the group follows the camera every frame, so they still sit in the scene's space.
  const overlay = new THREE.Scene();
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  overlay.add(group);
  const cards = [];
  const panels = [...section.querySelectorAll('.panel.ghost')];
  const build = async () => {
    for (const [i, el] of panels.entries()) {
      const spec = await readPanel(el);
      const { canvas: cv, regions } = renderCard(spec);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.NoColorSpace; // drawn straight to the screen: keep the canvas colours as they are
      tex.anisotropy = 8;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uReveal: { value: 0 }, uFade: { value: 0 }, uHover: { value: 0 }, uAsp: { value: cv.height / cv.width }, uRegion: { value: new THREE.Vector4(2, 2, 2, 2) } },
        transparent: true, depthWrite: false, depthTest: false,
        vertexShader: VS_UV,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform float uReveal, uFade, uHover, uAsp; uniform vec4 uRegion; varying vec2 vUv;
          float h(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
          void main(){
            float thr = h(floor(vec2(vUv.x * 64.0, vUv.y * 64.0 * uAsp)));
            float sweep = uReveal * 1.35 - (1.0 - vUv.y) * 0.35;
            if (thr > sweep) discard;
            float fresh = smoothstep(0.1, 0.0, sweep - thr) * step(uReveal, 0.999);
            float sh = (1.0 - uReveal) * 0.008;
            vec4 c = texture2D(uMap, vUv);
            c.r = texture2D(uMap, vUv + vec2(sh, 0.0)).r; c.b = texture2D(uMap, vUv - vec2(sh, 0.0)).b;
            float inR = step(uRegion.x, vUv.x) * step(vUv.x, uRegion.z) * step(uRegion.y, vUv.y) * step(vUv.y, uRegion.w);
            vec3 col = c.rgb * (0.9 + uHover * 0.03) + fresh * vec3(0.25, 0.6, 0.6) + inR * vec3(0.1, 0.26, 0.26);
            gl_FragColor = vec4(col, max(c.a, fresh * 0.35) * uFade);
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.renderOrder = 10;
      mesh.visible = false;
      group.add(mesh);
      cards.push({ mesh, mat, a: spec.a, b: spec.b, regions, W: cv.width, Hc: cv.height, side: i % 2 ? 1 : -1, i, w: 1, h: 1, x: 0, y: 0, D: 5, hover: 0, region: null });
    }
    layoutAll();
  };
  let vw = 1, vh = 1;
  function layoutAll() {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const cd of cards) {
      cd.D = 5;
      vh = 2 * cd.D * tan; vw = vh * camera.aspect;
      const asp = cd.Hc / cd.W;
      if (MOBILE) {
        cd.w = Math.min(vw * 0.92, (vh * 0.7) / asp);
        cd.h = cd.w * asp;
        cd.x = 0; cd.y = -vh / 2 + cd.h / 2 + vh * 0.045;
      } else {
        cd.w = Math.min(vw * 0.5, (vh * 0.74) / asp);
        cd.h = cd.w * asp;
        cd.x = -vw / 2 + cd.w / 2 + vw * 0.035;
        cd.y = Math.min(-vh * 0.06, vh * 0.31 - cd.h / 2);
      }
      cd.mesh.scale.set(cd.w, cd.h, 1);
    }
  }
  const ready = (document.fonts ? document.fonts.ready : Promise.resolve()).then(build);
  return {
    ready,
    overlay,
    layout: layoutAll,
    update(t, time, dt, ptr) {
      camera.updateMatrixWorld();
      group.matrix.copy(camera.matrixWorld);
      group.updateMatrixWorld(true);
      for (const cd of cards) {
        const lt = (t - cd.a) / Math.max(0.001, cd.b - cd.a);
        const vis = lt > -0.02 && lt < 1.04;
        cd.mesh.visible = vis;
        if (!vis) { cd.mat.uniforms.uReveal.value = 0; continue; }
        const enter = ease(clamp01(lt / 0.2)), exit = ease(clamp01((lt - 0.84) / 0.2));
        cd.hover += ((cd.region ? 1 : 0) - cd.hover) * (1 - Math.exp(-dt * 8));
        const bob = Math.sin(time * 0.7 + cd.i * 1.7);
        cd.mesh.position.set(
          cd.x + (1 - enter) * cd.side * 1.6 - exit * 2.2 + ptr.x * 0.06,
          cd.y + bob * 0.05 + exit * 1.4,
          -(cd.D + (1 - enter) * 16 + exit * 7),
        );
        cd.mesh.rotation.set(-ptr.y * 0.07 + bob * 0.01, (MOBILE ? 0 : 0.14) + ptr.x * 0.1 + (1 - enter) * cd.side * 0.5, (1 - enter) * cd.side * 0.08);
        cd.mat.uniforms.uReveal.value = clamp01(lt / 0.24);
        cd.mat.uniforms.uFade.value = (1 - exit) * smooth(-0.02, 0.06, lt);
        cd.mat.uniforms.uHover.value = cd.hover;
      }
      group.updateMatrixWorld(true);
    },
    pick(ray) {
      const vis = cards.filter((c) => c.mesh.visible && c.mat.uniforms.uFade.value > 0.6);
      const hit = ray.intersectObjects(vis.map((c) => c.mesh), false)[0];
      let found = null;
      for (const cd of cards) cd.region = null;
      if (hit) {
        const cd = cards.find((c) => c.mesh === hit.object);
        const px = hit.uv.x * cd.W, py = (1 - hit.uv.y) * cd.Hc;
        const r = cd.regions.find((q) => px >= q.x0 && px <= q.x1 && py >= q.y0 && py <= q.y1);
        if (r) { cd.region = r; found = r.action; }
        for (const c of cards) {
          const q = c.region;
          c.mat.uniforms.uRegion.value.set(q ? q.x0 / c.W : 2, q ? 1 - q.y1 / c.Hc : 2, q ? q.x1 / c.W : 2, q ? 1 - q.y0 / c.Hc : 2);
        }
      } else cards.forEach((c) => c.mat.uniforms.uRegion.value.set(2, 2, 2, 2));
      return found;
    },
  };
}

// ---------------------------------------------------------------- floating symbols
// Glyphs drifting through a scene; they scatter away from the cursor and brighten near it.
function makeSymbols(glyphs, count, box, bright = 0.32, scale = 1) {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * glyphs.length; c.height = cell;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  glyphs.forEach((ch, i) => {
    g.font = `${ch.length > 2 ? 500 : 600} ${ch.length > 2 ? 38 : 64}px ${F_M}`;
    g.fillText(ch, i * cell + cell / 2, cell / 2 + 4);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pos = new Float32Array(count * 3), gl = new Float32Array(count), sd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rand(box[0], box[1]), rand(box[2], box[3]), rand(box[4], box[5])], i * 3);
    gl[i] = Math.floor(rand(0, glyphs.length)); sd[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aGlyph', new THREE.BufferAttribute(gl, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uN: { value: glyphs.length }, uTime: { value: 0 }, uMouse: { value: new THREE.Vector3(9, 9, 0) }, uAsp: { value: 1 }, uSize: { value: 1 }, uBright: { value: bright } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `attribute float aGlyph, aSeed; uniform float uTime, uAsp, uSize; uniform vec3 uMouse;
      varying float vG, vNear, vSeed;
      void main(){ vG = aGlyph; vSeed = aSeed;
        vec3 p = position + vec3(sin(uTime * 0.31 + aSeed * 20.0), cos(uTime * 0.27 + aSeed * 13.0), sin(uTime * 0.2 + aSeed * 7.0)) * 0.35;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vec2 d = clip.xy / clip.w - uMouse.xy; d.x *= uAsp;
        float f = exp(-dot(d, d) * 14.0) * uMouse.z;
        clip.xy += normalize(d + 1e-4) * f * 0.16 * clip.w * vec2(1.0 / uAsp, 1.0);
        vNear = f;
        gl_PointSize = uSize * (0.6 + aSeed * 0.9) * (1.0 + f * 0.6) * (24.0 / clip.w);
        gl_Position = clip; }`,
    fragmentShader: /* glsl */ `uniform sampler2D uMap; uniform float uN, uTime, uBright; varying float vG, vNear, vSeed;
      void main(){ vec2 uv = vec2((vG + gl_PointCoord.x) / uN, 1.0 - gl_PointCoord.y);
        float a = texture2D(uMap, uv).a;
        float flick = 0.75 + 0.25 * sin(uTime * (1.0 + vSeed * 3.0) + vSeed * 40.0);
        vec3 col = mix(vec3(0.47, 0.78, 0.78), vec3(1.0), vNear);
        gl_FragColor = vec4(col * a * (uBright + vNear * 0.7) * flick, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    object: pts,
    resize(w, h) { mat.uniforms.uAsp.value = w / h; mat.uniforms.uSize.value = renderer.getPixelRatio() * (MOBILE ? 1.6 : 2.2) * scale; },
    update(time, ptr) {
      mat.uniforms.uTime.value = time;
      const m = mat.uniforms.uMouse.value;
      m.x = ptr.rawX; m.y = ptr.rawY; m.z += ((ptr.active ? 1 : 0) - m.z) * 0.08;
    },
  };
}

// ---------------------------------------------------------------- about: inside a neural network
// Layers of neurons the camera flies through; activations travel forward layer by layer,
// pulses run along the connections.
function makeNetwork() {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x020607);
  scene.background = bg;
  scene.fog = new THREE.FogExp2(bg, 0.034);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  scene.add(camera);

  const LAYERS = 16, GAP = 7, side = MOBILE ? 7 : 9;
  const nodes = [];
  for (let l = 0; l < LAYERS; l++) {
    const w = l % 4 === 3 ? side - 3 : side; // some narrower hidden layers
    for (let i = 0; i < w; i++) for (let j = 0; j < w; j++) {
      if (rand() < 0.18) continue;
      const sp = 1.15;
      nodes.push({ l, x: (i - (w - 1) / 2) * sp + rand(-0.15, 0.15), y: (j - (w - 1) / 2) * sp + rand(-0.15, 0.15), z: -l * GAP });
    }
  }
  const nMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTint: { value: TEAL } },
    vertexShader: /* glsl */ `attribute float aSeed, aLayer; uniform float uTime;
      varying float vAct; varying vec2 vUv;
      void main(){ vUv = uv;
        float wave = sin(uTime * 2.4 - aLayer * 0.75 + aSeed * 2.0);
        vAct = smoothstep(0.55, 1.0, wave) * step(0.35, fract(aSeed * 7.13 + floor(uTime * 0.4 - aLayer * 0.12) * 0.37));
        vec4 p = instanceMatrix * vec4(position * (1.0 + vAct * 0.6), 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: /* glsl */ `uniform vec3 uTint; varying float vAct; varying vec2 vUv;
      void main(){ vec3 base = uTint * 0.24; vec3 hot = mix(uTint, vec3(1.0), 0.45) * 2.1;
        gl_FragColor = vec4(mix(base, hot, vAct), 1.0); }`,
  });
  const nodeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), nMat, nodes.length);
  const seed = new Float32Array(nodes.length), layer = new Float32Array(nodes.length);
  const m = new THREE.Matrix4();
  nodes.forEach((n, i) => { m.makeTranslation(n.x, n.y, n.z); nodeMesh.setMatrixAt(i, m); seed[i] = rand(); layer[i] = n.l; });
  instAttr(nodeMesh, 'aSeed', seed, 1); instAttr(nodeMesh, 'aLayer', layer, 1);
  scene.add(nodeMesh);

  // connections between consecutive layers, with a pulse running along each
  const byLayer = [...Array(LAYERS)].map(() => []);
  nodes.forEach((n) => byLayer[n.l].push(n));
  const pos = [], tAttr = [], lAttr = [], sAttr = [];
  const PER = Math.round(5 * Q + 2);
  for (let l = 0; l < LAYERS - 1; l++) {
    for (const a of byLayer[l]) {
      for (let k = 0; k < PER; k++) {
        const b = byLayer[l + 1][(rand() * byLayer[l + 1].length) | 0];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        tAttr.push(0, 1); lAttr.push(l, l); const s = rand(); sAttr.push(s, s);
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('aT', new THREE.Float32BufferAttribute(tAttr, 1));
  lg.setAttribute('aLayer', new THREE.Float32BufferAttribute(lAttr, 1));
  lg.setAttribute('aSeed', new THREE.Float32BufferAttribute(sAttr, 1));
  const lMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTint: { value: TEAL } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `attribute float aT, aLayer, aSeed; varying float vT, vL, vS; varying float vFog;
      void main(){ vT = aT; vL = aLayer; vS = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFog = exp(-length(mv.xyz) * 0.05); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uTint; varying float vT, vL, vS, vFog;
      void main(){ float head = fract(uTime * 0.55 - vL * 0.09 + vS * 0.5);
        float pulse = smoothstep(0.1, 0.0, abs(vT - head)) * step(0.55, vS);
        vec3 c = uTint * (0.06 + pulse * 1.5);
        gl_FragColor = vec4(c * vFog, 1.0); }`,
  });
  scene.add(new THREE.LineSegments(lg, lMat));

  const len = (LAYERS - 1) * GAP;
  const cards = makeCards(document.getElementById('about'), camera);
  const sym = makeSymbols(['λ', '∇', 'Σ', '∂', '∫', 'π', 'θ', 'σ', '{ }', '< >', '0', '1', '→', '⊕', 'f(x)', 'ŷ', 'w·x', 'ReLU', 'softmax', '[ ]'],
    Math.round(160 * Q + 60), [-8, 8, -5.5, 5.5, -len - 6, 10]);
  scene.add(sym.object);
  return {
    scene, camera, bloom: [0.8, 0.55, 0.95], edge: 0x000000, vig: 1, pick: cards.pick, ready: cards.ready, overlay: cards.overlay,
    resize(w, h) { camera.aspect = w / h; camera.fov = MOBILE ? 72 : 60; camera.updateProjectionMatrix(); cards.layout(); sym.resize(w, h); },
    update(t, time, dt, ptr) {
      nMat.uniforms.uTime.value = time; lMat.uniforms.uTime.value = time;
      sym.update(time, ptr);
      cards.update(t, time, dt, ptr);
      const z = 9 - t * (len + 6);
      const sway = Math.sin(t * 6.0) * 1.2;
      camera.position.set(sway + ptr.x * 0.8, Math.cos(t * 4.0) * 0.8 + ptr.y * 0.5, z);
      camera.up.set(Math.sin(t * 1.4) * 0.35, 1, 0).normalize();
      camera.lookAt(sway * 0.3, 0, z - 10);
    },
  };
}

// ---------------------------------------------------------------- experience: EEG + ECG traces
// The 19 channels of the 10-20 montage used in Neuro, drawn as live traces on a dark monitor,
// with one ECG trace (HealthMonitor) through the middle. The camera drifts along the record.
const CH = ['FP1', 'FP2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4', 'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2'];
function labelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const g = c.getContext('2d');
  g.font = '600 30px "IBM Plex Mono", monospace';
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 6, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeSignals() {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x02060a);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 6, 46);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  scene.add(camera);
  const LEN = 90, SEG = Math.round(900 * Q);
  const traces = [];
  const make = (y, z, kind, amp, color, ch) => {
    const g = new THREE.PlaneGeometry(LEN, 1, SEG, 1);
    g.translate(LEN / 2 - 10, 0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uKind: { value: kind }, uAmp: { value: amp }, uColor: { value: new THREE.Color(color) }, uSeed: { value: rand(0, 100) }, uSweep: { value: 0 }, uThick: { value: kind > 0.5 ? 0.075 : 0.045 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `uniform float uTime, uKind, uAmp, uSeed, uThick; varying float vX; varying float vV;
        float ecg(float x){ float p = fract(x);
          return 0.12 * exp(-pow((p - 0.18) / 0.03, 2.0)) - 0.15 * exp(-pow((p - 0.3) / 0.012, 2.0))
               + 1.0 * exp(-pow((p - 0.33) / 0.012, 2.0)) - 0.25 * exp(-pow((p - 0.36) / 0.014, 2.0))
               + 0.25 * exp(-pow((p - 0.56) / 0.05, 2.0)); }
        float sig(float x){
          if (uKind > 0.5) return ecg(x * 0.35) * 1.6;
          return 0.5 * sin(x * 6.2) + 0.35 * sin(x * 3.72 + uSeed) + 0.22 * sin(x * 13.0 + 1.7 * uSeed)
               + 0.15 * sin(x * 1.24 + 0.3 * uSeed) + 0.12 * sin(x * 22.9); }
        void main(){ vec3 p = position; float x = p.x * 0.55 - uTime * 1.6 + uSeed;
          float y = sig(x) * uAmp;
          float slope = (sig(x + 0.01) - sig(x - 0.01)) * uAmp / 0.0364;
          p.y = y + (uv.y - 0.5) * uThick * sqrt(1.0 + slope * slope); vX = p.x; vV = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uSweep; varying float vX; varying float vV;
        void main(){ float d = vX - uSweep; float lead = smoothstep(-14.0, 0.0, d) * step(d, 0.0);
          float a = d > 0.0 ? 0.22 : mix(0.45, 1.0, lead);
          float core = 1.0 - abs(vV - 0.5) * 2.0;
          gl_FragColor = vec4(uColor * a * (0.6 + core * 1.6), 1.0); }`,
    });
    const line = new THREE.Mesh(g, mat);
    line.position.set(0, y, z);
    scene.add(line);
    if (ch) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(ch, kind > 0.5 ? '#79ffb0' : '#9fd6d6'), transparent: true, depthWrite: false }));
      sp.scale.set(0.9, 0.34, 1); sp.position.set(-11.2, y, z);
      scene.add(sp);
    }
    traces.push(mat);
  };
  const STEPY = 0.62;
  CH.forEach((ch, i) => {
    const y = (CH.length / 2 - i) * STEPY;
    make(y, -i * 0.35, 0, 0.22, i % 2 ? 0x79c7c7 : 0x5aa6b8, ch);
    if (i === 9) make(y - STEPY * 0.5, -i * 0.35 + 0.2, 1, 0.55, 0x2bff8a, 'ECG');
  });
  // monitor grid behind the traces
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(LEN + 30, 30), new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `varying vec3 vP;
      void main(){ vec2 g = abs(fract(vP.xy * vec2(0.5, 1.0 / 0.62)) - 0.5);
        float l = smoothstep(0.485, 0.5, max(g.x, g.y));
        gl_FragColor = vec4(vec3(0.05, 0.13, 0.15) * l + vec3(0.008, 0.02, 0.025), 1.0); }`,
  }));
  grid.position.set(LEN / 2 - 10, 0, -9);
  scene.add(grid);

  const cards = makeCards(document.getElementById('journey'), camera);
  const sym = makeSymbols(['α', 'β', 'θ', 'δ', 'γ', 'μV', 'Hz', '♥', '∿', '~', '+', 'ECG', 'Fz', 'Cz', 'O1', 'SpO₂', 'bpm', '°C', 'NEWS2', '10–20'],
    Math.round(150 * Q + 50), [-12, LEN - 10, -5, 5, -5, 5]);
  scene.add(sym.object);
  return {
    scene, camera, bloom: [0.9, 0.55, 0.95], edge: 0x000000, vig: 1, pick: cards.pick, ready: cards.ready, overlay: cards.overlay,
    resize(w, h) { camera.aspect = w / h; camera.fov = MOBILE ? 66 : 50; camera.updateProjectionMatrix(); cards.layout(); sym.resize(w, h); },
    update(t, time, dt, ptr) {
      sym.update(time, ptr);
      cards.update(t, time, dt, ptr);
      const x = -2 + t * (LEN - 26);
      traces.forEach((mt) => { mt.uniforms.uTime.value = time; mt.uniforms.uSweep.value = x + 9 + ((time * 6) % 18); });
      camera.position.set(x + ptr.x * 0.6, 0.2 + ptr.y * 0.4 + Math.sin(t * 3) * 0.6, 7.2 - Math.sin(t * Math.PI) * 1.8);
      camera.up.set(Math.sin(t * 2.0 - 1.0) * 0.12, 1, 0).normalize();
      camera.lookAt(x + 5, 0, -4);
    },
  };
}

// ---------------------------------------------------------------- contact: the portrait, resolved
// A colour point cloud of the photo assembles, then a scan beam sweeps down and reveals the
// cleaned-up cut-out photo (assets/portrait-cut.webp) flat and undistorted; the points it passes
// dissolve upward as sparks; motes drift in the background.
function makeFinale(data) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050304);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const N = data.n, p = data.p, count = p.length / 5, U = 7 / N;
  const X = MOBILE ? 0 : 2.5, Y = MOBILE ? 0.9 : 0;
  const rig = new THREE.Group();
  rig.position.set(X, Y, 0);
  scene.add(rig);

  // point cloud
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = new Float32Array(count), yn = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = p[5 * i], y = p[5 * i + 1];
    pos.set([(x - N / 2) * U, -(y - N / 2) * U, rand(-0.03, 0.03)], i * 3);
    col.set([p[5 * i + 2] / 255, p[5 * i + 3] / 255, p[5 * i + 4] / 255], i * 3);
    seed[i] = rand(); yn[i] = y / N;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aYN', new THREE.BufferAttribute(yn, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSpread: { value: 1 }, uSize: { value: 1 }, uScan: { value: 0 } },
    vertexShader: /* glsl */ `attribute vec3 aColor; attribute float aSeed, aYN; uniform float uTime, uSpread, uSize, uScan;
      varying vec3 vC; varying float vGone;
      void main(){ vec3 p = position;
        vec3 dir = normalize(vec3(sin(aSeed * 91.0), cos(aSeed * 47.0), sin(aSeed * 13.0) * 1.5 + 0.6));
        p += dir * uSpread * (1.5 + aSeed * 5.0);
        float passed = clamp((uScan - aYN) * 7.0, 0.0, 1.0);
        p.y += passed * (0.4 + aSeed * 2.8); p.z += passed * aSeed * 2.0; p.x += passed * (aSeed - 0.5) * 1.6;
        vGone = passed;
        vC = mix(aColor, vec3(0.75, 1.0, 1.0) * 1.6, passed);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (1.0 - passed * 0.75) * (34.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying vec3 vC; varying float vGone;
      void main(){ if (vGone > 0.97) discard; vec2 q = gl_PointCoord - 0.5; if (max(abs(q.x), abs(q.y)) > 0.42) discard;
        gl_FragColor = vec4(vC, 1.0); }`,
  });
  const cloud = new THREE.Points(geo, pMat);
  rig.add(cloud);

  // the photo, revealed by the scan beam
  const tex = new THREE.TextureLoader().load('assets/portrait-cut.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; });
  tex.colorSpace = THREE.SRGBColorSpace;
  const photoMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uScan: { value: 0 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: VS_UV,
    fragmentShader: /* glsl */ `uniform sampler2D uMap; uniform float uScan, uTime; varying vec2 vUv;
      void main(){
        vec4 tx = texture2D(uMap, vUv);
        float yTop = 1.0 - vUv.y;
        float shown = step(yTop, uScan);
        float age = clamp((uScan - yTop) * 3.0, 0.0, 1.0);
        vec3 col = tx.rgb;
        // freshly scanned lines read as a hologram, then settle into the clean photo
        col *= mix(0.82 + 0.18 * sin(vUv.y * 1100.0 - uTime * 6.0), 1.0, age);
        col = mix(col * vec3(0.55, 1.0, 1.08) + vec3(0.0, 0.07, 0.09), col, age);
        col *= 0.9; // stays below the bloom threshold: no glow around the photo
        float beam = smoothstep(0.012, 0.0, abs(yTop - uScan)) * step(uScan, 1.0);
        float a = tx.a * shown;
        vec3 outc = col * a + vec3(0.65, 1.0, 1.0) * beam * (0.35 + tx.a * 1.8);
        gl_FragColor = vec4(outc, max(a, beam * 0.75));
      }`,
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), photoMat);
  photo.position.z = 0.05;
  rig.add(photo);

  // motes drifting upward
  const nM = Math.round(700 * Q);
  const mpos = new Float32Array(nM * 3), mseed = new Float32Array(nM);
  for (let i = 0; i < nM; i++) { mpos.set([rand(-7, 7), rand(-5, 5), rand(-4, 3)], i * 3); mseed[i] = rand(); }
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  mgeo.setAttribute('aSeed', new THREE.BufferAttribute(mseed, 1));
  const mMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSize: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime, uSize; varying float vA; varying float vS;
      void main(){ vec3 p = position; p.y = mod(p.y + 5.0 + uTime * (0.15 + aSeed * 0.35), 10.0) - 5.0;
        p.x += sin(uTime * 0.5 + aSeed * 30.0) * 0.2; vS = aSeed;
        vA = smoothstep(-5.0, -3.0, p.y) * (1.0 - smoothstep(3.0, 5.0, p.y));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = uSize * (0.6 + aSeed * 1.6) * (20.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying float vA; varying float vS;
      void main(){ float d = length(gl_PointCoord - 0.5); float g = smoothstep(0.5, 0.0, d);
        vec3 c = vS > 0.6 ? vec3(0.5, 0.95, 0.95) : vec3(1.0, 0.55, 0.3);
        gl_FragColor = vec4(c * g * vA * 0.9, 1.0); }`,
  });
  rig.add(new THREE.Points(mgeo, mMat));

  // warm floor grid
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `varying vec3 vP;
      void main(){ vec2 g = abs(fract(vP.xz * 0.8) - 0.5); float l = smoothstep(0.47, 0.5, max(g.x, g.y));
        float fade = exp(-length(vP.xz - vec2(${X.toFixed(2)}, 0.0)) * 0.08);
        gl_FragColor = vec4(vec3(0.9, 0.34, 0.18) * l * fade * 0.5, 1.0); }`,
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -4.1 + Y;
  scene.add(floor);

  let dist = 14;
  return {
    scene, camera, bloom: [0.45, 0.5, 0.97], edge: 0x000000, vig: 1, curve: 0.03,
    resize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      dist = Math.max(3.6 / tan / 0.86, 3.6 / (tan * camera.aspect) / (MOBILE ? 0.78 : 0.46));
      const pr = renderer.getPixelRatio();
      pMat.uniforms.uSize.value = pr * (MOBILE ? 1.5 : 2.0);
      mMat.uniforms.uSize.value = pr * 2;
    },
    update(t, time, dt, ptr) {
      const assemble = ease(clamp01(t / 0.4));
      const scan = clamp01((t - 0.36) / 0.36) * 1.25;
      pMat.uniforms.uTime.value = time; pMat.uniforms.uSpread.value = 1 - assemble; pMat.uniforms.uScan.value = scan;
      photoMat.uniforms.uScan.value = scan; photoMat.uniforms.uTime.value = time;
      cloud.visible = scan < 1.2; // every point has dissolved by now; none stay on the photo
      mMat.uniforms.uTime.value = time;
      const lookY = MOBILE ? -2.6 : Y * 0.6; // phones: face in the top third, text below
      camera.position.set(X * 0.62 + ptr.x * 0.3, 0.15 + lookY + ptr.y * 0.22, dist * (1.18 - 0.18 * assemble));
      camera.lookAt(X * 0.62, lookY, 0);
    },
  };
}

// ---------------------------------------------------------------- boot
const boot = document.getElementById('boot-n');
let progress = 0;
const tick = (p) => { progress = Math.max(progress, p); if (boot) boot.textContent = String(Math.round(progress * 100)).padStart(3, '0') + '%'; };

const pointer = { x: 0, y: 0, tx: 0, ty: 0, rawX: 0, rawY: 0, active: false };
addEventListener('pointermove', (e) => {
  pointer.rawX = (e.clientX / innerWidth) * 2 - 1;
  pointer.rawY = -((e.clientY / innerHeight) * 2 - 1);
  pointer.active = true;
  if (e.pointerType !== 'mouse') return;
  pointer.tx = pointer.rawX;
  pointer.ty = pointer.rawY;
}, { passive: true });
document.addEventListener('pointerleave', () => { pointer.active = false; });
addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointer.active = false; });

const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });

async function start() {
  tick(0.05);
  const pointsReq = getJSON('assets/data/portrait-points.json');
  const skillsReq = getJSON('assets/data/skills.json').catch(() => []);
  const cells = await getJSON('assets/data/hero-cells.json'); tick(0.4);
  await Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 2500))]); tick(0.55);
  const points = await pointsReq; tick(0.7);
  const skills = await skillsReq;

  const builders = { hero: () => makeHero(cells, skills), work: makeWork, network: makeNetwork, signals: makeSignals, portrait: () => makeFinale(points) };
  const SCENES = site.names.map((n) => builders[n]());
  tick(0.9);

  const resize = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    cam.uniforms.uRes.value.set(w, h);
    cam.uniforms.uTape.value = Math.min(1100, w * 0.85);
    SCENES.forEach((s) => s.resize(w, h));
  };
  resize();
  addEventListener('resize', resize);

  await Promise.all(SCENES.map((s) => s.ready).filter(Boolean)); // card textures drawn
  // compile every scene once so the first cut into each one doesn't stall
  SCENES.forEach((s) => renderer.compile(s.scene, s.camera));
  tick(1);
  H.classList.add('ready');

  let last = performance.now(), cur = -1, hoverAction = null;
  const ray = new THREE.Raycaster();
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('click', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) return; // a drag, not a click
    const S = SCENES[site.idx];
    if (S.tapAt) { S.tapAt(e.clientX, e.clientY); return; }
    if (!S.pick) return;
    pointer.rawX = (e.clientX / innerWidth) * 2 - 1; pointer.rawY = -((e.clientY / innerHeight) * 2 - 1);
    ray.setFromCamera({ x: pointer.rawX, y: pointer.rawY }, S.camera);
    const act = S.pick(ray);
    if (act && act.case) site.openCase(act.case);
    else if (act && act.href) window.open(act.href, '_blank', 'noopener');
  });
  const edge = new THREE.Color();
  function loop(now) {
    const time = now / 1000, dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 3));
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 3));
    if (!H.classList.contains('gl')) return; // fell back to the plain page
    const i = site.idx;
    const S = SCENES[i];
    if (i !== cur) {
      if (cur >= 0 && SCENES[cur].leave) SCENES[cur].leave();
      cur = i;
      renderPass.scene = S.scene; renderPass.camera = S.camera;
      const [st, ra, th] = S.bloom;
      bloom.enabled = st > 0; bloom.strength = st; bloom.radius = ra; bloom.threshold = th;
      cam.uniforms.uEdge.value.copy(edge.set(S.edge));
      cam.uniforms.uVig.value = S.vig;
      cam.uniforms.uCurve.value = S.curve ?? 0.07;
      cam.uniforms.uBlack.value = S.light ? 0 : 0.03;
    }
    S.update(site.t, time, dt, pointer);
    if (S.pick) {
      ray.setFromCamera({ x: pointer.rawX, y: pointer.rawY }, S.camera);
      hoverAction = pointer.active ? S.pick(ray) : null;
      canvas.style.cursor = hoverAction ? 'pointer' : '';
    } else if (hoverAction) { hoverAction = null; canvas.style.cursor = ''; }
    // tape faults surge around every cut between scenes (a "handover"), plus a kick after menu jumps
    let d = 9;
    for (let k = 1; k < site.cum.length - 1; k++) d = Math.min(d, Math.abs(site.us - site.cum[k]));
    const hand = Math.pow(clamp01(1 - d / 0.35), 2);
    cam.uniforms.uHand.value = Math.min(1, hand + site.kick * 0.7);
    cam.uniforms.uGlitch.value = Math.min(1, Math.pow(clamp01(1 - d / 0.14), 2) + site.kick * 0.6);
    cam.uniforms.uTime.value = time;
    composer.render(dt);
    if (S.overlay) {
      // text cards on top of the finished frame, untouched by bloom and the camcorder pass
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(S.overlay, S.camera);
      renderer.autoClear = true;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

start().catch(() => site.fallback());
