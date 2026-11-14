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

// ---------------------------------------------------------------- hero: pixel-block portrait
// Quadtree blocks from the photo (assets/data/hero-cells.json). The grid fades in over 1.5 s,
// blocks glitch along rows, and the cursor pushes them away like a field.
function makeHero(data) {
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
    uniforms: { uTime: { value: 0 }, uIntro: { value: 0 }, uExit: { value: 0 }, uCursor: { value: new THREE.Vector3(99, 99, 0) }, uTint: { value: TEAL } },
    vertexShader: /* glsl */ `
      attribute float aLum, aSeed, aSize; uniform float uTime, uExit; uniform vec3 uCursor;
      varying vec2 vUv; varying float vLum, vSeed, vB, vPush;
      void main(){
        vUv = uv; vLum = aLum; vSeed = aSeed; vB = 0.55 / aSize;
        vec4 p = instanceMatrix * vec4(position, 1.0);
        vec3 ctr = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 d = ctr.xy - uCursor.xy;
        float f = exp(-dot(d, d) / 0.45) * uCursor.z;
        vPush = f;
        p.xy += normalize(d + 1e-4) * f * 0.35;
        p.z += f * (0.6 + aSeed * 1.2);
        float row = floor(p.y * 7.0), tick = floor(uTime * 7.0);
        float r = fract(sin(row * 91.7 + tick * 13.1) * 4375.5);
        p.x += step(0.975, r) * (r - 0.987) * 4.0;
        p.z += uExit * aSeed * 9.0;
        p.xy *= 1.0 + uExit * aSeed * 0.8;
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uIntro, uExit; uniform vec3 uTint; varying vec2 vUv; varying float vLum, vSeed, vB, vPush;
      void main(){
        if (vSeed > uIntro) discard;
        vec2 e = min(vUv, 1.0 - vUv);
        float border = step(min(e.x, e.y), vB);
        float flick = step(0.997, fract(sin(vSeed * 7123.1 + floor(uTime * 9.0)) * 9123.7));
        vec3 base = mix(uTint * 0.09, mix(uTint, vec3(1.0), 0.72), pow(vLum, 1.15));
        vec3 col = mix(base, base * 0.22, border) + flick * 0.7 + vPush * uTint * 0.6;
        gl_FragColor = vec4(col * (1.0 - uExit * 0.55), 1.0);
      }`,
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

  let dist = 15, lift = 0;
  const born = performance.now() / 1000;
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  const cur = mat.uniforms.uCursor.value;
  return {
    scene, camera, bloom: [0.55, 0.5, 0.55], edge: 0x000000, vig: 1,
    resize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      dist = Math.max(3.5 / tan / 0.86, 3.5 / (tan * camera.aspect) / (MOBILE ? 1.05 : 0.95));
      lift = MOBILE ? 0.9 : 0;
    },
    update(t, time, dt, ptr) {
      mat.uniforms.uTime.value = time;
      // grid reveal: 1.5 s, ease-out
      const k = clamp01((time - born) / 1.5);
      mat.uniforms.uIntro.value = 1 - (1 - k) * (1 - k);
      mat.uniforms.uExit.value = smooth(0.45, 1, t);
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


// ---------------------------------------------------------------- about: inside a neural network
// Layers of neurons the camera flies through; activations travel forward layer by layer,
// pulses run along the connections.
function makeNetwork() {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x020607);
  scene.background = bg;
  scene.fog = new THREE.FogExp2(bg, 0.034);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

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

  // faint input/output planes with a grid, so depth reads
  const len = (LAYERS - 1) * GAP;
  return {
    scene, camera, bloom: [0.8, 0.55, 0.66], edge: 0x000000, vig: 1,
    resize(w, h) { camera.aspect = w / h; camera.fov = MOBILE ? 72 : 60; camera.updateProjectionMatrix(); },
    update(t, time, dt, ptr) {
      nMat.uniforms.uTime.value = time; lMat.uniforms.uTime.value = time;
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

  return {
    scene, camera, bloom: [0.9, 0.55, 0.45], edge: 0x000000, vig: 1,
    resize(w, h) { camera.aspect = w / h; camera.fov = MOBILE ? 66 : 50; camera.updateProjectionMatrix(); },
    update(t, time, dt, ptr) {
      const x = -2 + t * (LEN - 26);
      traces.forEach((mt) => { mt.uniforms.uTime.value = time; mt.uniforms.uSweep.value = x + 9 + ((time * 6) % 18); });
      camera.position.set(x + ptr.x * 0.6, 0.2 + ptr.y * 0.4 + Math.sin(t * 3) * 0.6, 7.2 - Math.sin(t * Math.PI) * 1.8);
      camera.up.set(Math.sin(t * 2.0 - 1.0) * 0.12, 1, 0).normalize();
      camera.lookAt(x + 5, 0, -4);
    },
  };
}

// ---------------------------------------------------------------- contact: the portrait as a point cloud
// The same photo as the hero, now in colour and depth, drifting apart and back together.
function makePoints(data) {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x040203);
  scene.background = bg;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const N = data.n, p = data.p, count = p.length / 5, U = 7 / N;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = p[5 * i], y = p[5 * i + 1];
    const r = p[5 * i + 2] / 255, g = p[5 * i + 3] / 255, b = p[5 * i + 4] / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    pos.set([(x - N / 2) * U, -(y - N / 2) * U, l * 0.9 - 0.45 + rand(-0.04, 0.04)], i * 3);
    col.set([r, g, b], i * 3);
    seed[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSpread: { value: 1 }, uSize: { value: 1 } },
    vertexShader: /* glsl */ `attribute vec3 aColor; attribute float aSeed; uniform float uTime, uSpread, uSize; varying vec3 vC;
      void main(){ vec3 p = position;
        vec3 dir = normalize(vec3(sin(aSeed * 91.0), cos(aSeed * 47.0), sin(aSeed * 13.0) * 1.5 + 0.6));
        p += dir * uSpread * (1.5 + aSeed * 5.0);
        p.x += sin(uTime * 0.7 + p.y * 3.0) * 0.012;
        vC = aColor * (0.75 + 0.5 * step(0.985, fract(aSeed * 13.7 + uTime * 0.2)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (32.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `varying vec3 vC;
      void main(){ vec2 q = gl_PointCoord - 0.5; if (max(abs(q.x), abs(q.y)) > 0.42) discard;
        gl_FragColor = vec4(vC * vec3(1.08, 0.86, 0.78), 1.0); }`,
  });
  const cloud = new THREE.Points(geo, mat);
  cloud.position.x = MOBILE ? 0 : 2.4;
  scene.add(cloud);

  // a warm horizon line and floor grid
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `varying vec3 vP;
      void main(){ vec2 g = abs(fract(vP.xz * 0.8) - 0.5); float l = smoothstep(0.47, 0.5, max(g.x, g.y));
        float fade = exp(-length(vP.xz) * 0.06);
        gl_FragColor = vec4(vec3(0.9, 0.32, 0.18) * l * fade * 0.55, 1.0); }`,
  }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -4.2;
  scene.add(floor);

  let dist = 14;
  return {
    scene, camera, bloom: [0.55, 0.6, 0.62], edge: 0x000000, vig: 1,
    resize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      dist = Math.max(3.5 / tan / 0.8, 3.5 / (tan * camera.aspect) / 0.95);
      mat.uniforms.uSize.value = renderer.getPixelRatio() * (MOBILE ? 1.6 : 2.2);
    },
    update(t, time, dt, ptr) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uSpread.value = 1 - ease(clamp01(t / 0.55));
      cloud.rotation.y = Math.sin(time * 0.25) * 0.25 + ptr.x * 0.35;
      camera.position.set(ptr.x * 0.4, 0.3 + ptr.y * 0.3, dist * (1.25 - 0.25 * ease(clamp01(t / 0.6))));
      camera.lookAt(MOBILE ? 0 : 0.6, MOBILE ? -1.2 : 0.1, 0);
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
  const cells = await getJSON('assets/data/hero-cells.json'); tick(0.4);
  await Promise.race([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 2500))]); tick(0.55);
  const points = await pointsReq; tick(0.7);

  const builders = { hero: () => makeHero(cells), work: makeWork, network: makeNetwork, signals: makeSignals, portrait: () => makePoints(points) };
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

  // compile every scene once so the first cut into each one doesn't stall
  SCENES.forEach((s) => renderer.compile(s.scene, s.camera));
  tick(1);
  H.classList.add('ready');

  let last = performance.now(), cur = -1;
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
      cam.uniforms.uBlack.value = S.light ? 0 : 0.03;
    }
    S.update(site.t, time, dt, pointer);
    // tape faults surge around every cut between scenes (a "handover"), plus a kick after menu jumps
    let d = 9;
    for (let k = 1; k < site.cum.length - 1; k++) d = Math.min(d, Math.abs(site.us - site.cum[k]));
    const hand = Math.pow(clamp01(1 - d / 0.35), 2);
    cam.uniforms.uHand.value = Math.min(1, hand + site.kick * 0.7);
    cam.uniforms.uGlitch.value = Math.min(1, Math.pow(clamp01(1 - d / 0.14), 2) + site.kick * 0.6);
    cam.uniforms.uTime.value = time;
    composer.render(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

start().catch(() => site.fallback());
