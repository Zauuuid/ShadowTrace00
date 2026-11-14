/**
 * The Journey's Three.js scene (chapter 05). One fixed canvas; the render loop reads a plain state object that GSAP
 * tweens, so React never re-renders per frame.
 * - Moon: custom Lommel–Seeliger shader, lit in the selenographic frame by the Horizons Sun of JOURNEY_DATE.
 * - Visual-only layers (labelled in the HUD): SVS colour/relief textures, stars, dust, rings, pole hillshade.
 * - Measured layers: Artemis III outlines and PSR points from NASA Moon Trek vectors (map metres → sphere).
 */
import * as THREE from 'three';
import type { VectorLayers } from '../data/data';
import { MOON_R_M } from '../planner/polar';
import { FOV_DEG, placeMoon, type SceneState, type Vec3 } from './keyframes';

const BASE = `${import.meta.env.BASE_URL}data/moon/`;
const HILL_EXTENT_M = 160_200;

const VERT = /* glsl */ `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uColorNext;
uniform float uMix;
uniform sampler2D uNormal;
uniform vec3 uSun;
uniform vec3 uEarth;
uniform vec3 uCam;
uniform float uEarthshine;
uniform float uExposure;
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vec3 up = normalize(vPos);
  vec3 east = vec3(up.z, 0.0, -up.x);
  east = length(east) > 1e-4 ? normalize(east) : vec3(0.0, 0.0, -1.0);
  vec3 north = cross(up, east);
  vec3 tn = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  vec3 N = normalize(east * tn.x + north * tn.y + up * tn.z);
  vec3 L = normalize(uSun);
  vec3 V = normalize(uCam - vPos);
  float mu0 = max(dot(N, L), 0.0);
  float mu = max(dot(N, V), 0.02);
  // No atmosphere: a crisp terminator on the geometric normal.
  float lit = smoothstep(0.0, 0.02, dot(up, L));
  float phase = acos(clamp(dot(L, V), -1.0, 1.0));
  float surge = 1.0 + 0.25 * exp(-phase / 0.1); // opposition surge (artistic)
  vec3 albedo = mix(texture2D(uColor, vUv).rgb, texture2D(uColorNext, vUv).rgb, uMix);
  vec3 c = albedo * (2.0 * mu0 / (mu0 + mu)) * lit * surge * uExposure;
  // Earthshine (computed from Horizons geometry), near side only.
  c += albedo * uEarthshine * max(dot(up, normalize(uEarth)), 0.0) * (1.0 - lit);
  // Thin cool-silver rim on the lit limb only: a cinematic cue, not an atmosphere.
  c += vec3(0.80, 0.86, 0.92) * pow(1.0 - max(dot(up, V), 0.0), 4.0) * 0.12 * lit;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const HILL_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = uOpacity * (1.0 - smoothstep(0.72, 1.0, r));
  gl_FragColor = vec4(texture2D(uMap, vUv).rgb * 0.95, a);
  #include <colorspace_fragment>
}`;
const HILL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export interface SceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly state: SceneState;
  readonly sun: Vec3;
  readonly earth: Vec3;
  readonly earthLitFraction: number;
  readonly vectors: VectorLayers | null;
  readonly low: boolean;
  /** Elements for the 13 Artemis III labels (positioned by the render loop). */
  readonly labels: readonly HTMLElement[];
  readonly onReady: () => void;
  readonly onFail: () => void;
}

export interface MoonScene {
  pause(p: boolean): void;
  dispose(): void;
}

/** Map metres (polar stereographic, as in the planner) → a point just above the sphere near the south pole. */
function mapToSphere(x: number, y: number, lift: number): THREE.Vector3 {
  return new THREE.Vector3(y / MOON_R_M, -lift, -x / MOON_R_M);
}

function idle(fn: () => void, ms = 1200): void {
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: ms }); else setTimeout(fn, ms);
}

export function createMoonScene(o: SceneOptions): MoonScene {
  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x05070b, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  let dpr = Math.min(window.devicePixelRatio || 1, o.low ? 1.25 : 2);
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.01, 200);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const prep = (t: THREE.Texture, srgb: boolean) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  const blank = track(new THREE.DataTexture(new Uint8Array([20, 20, 22, 255]), 1, 1));
  blank.needsUpdate = true;
  const flat = track(new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1));
  flat.needsUpdate = true;

  // ---- Moon
  const uniforms = {
    uColor: { value: blank as THREE.Texture }, uColorNext: { value: blank as THREE.Texture }, uMix: { value: 0 },
    uNormal: { value: flat as THREE.Texture },
    uSun: { value: new THREE.Vector3(...o.sun) }, uEarth: { value: new THREE.Vector3(...o.earth) },
    uCam: { value: new THREE.Vector3() },
    uEarthshine: { value: 0.04 * o.earthLitFraction }, uExposure: { value: 1.15 },
  };
  const moonMat = track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms }));
  const moon = new THREE.Mesh(track(new THREE.SphereGeometry(1, 192, 96)), moonMat);
  scene.add(moon);

  // Texture ladder: 2k now, 4k then 8k when idle (8k desktop only). Crossfade 0.6 s, dispose the old one.
  let fade: { t0: number; tex: THREE.Texture } | null = null;
  const swapColor = (tex: THREE.Texture) => { uniforms.uColorNext.value = tex; uniforms.uMix.value = 0; fade = { t0: performance.now(), tex }; };
  const load = (name: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => loader.load(`${BASE}${name}`, (t) => res(prep(t, srgb)), undefined, rej));
  let ready = false;
  Promise.all([load('color_2k.webp', true), load('normal_2k.webp', false)]).then(([c, n]) => {
    uniforms.uColor.value = c; uniforms.uNormal.value = n;
    ready = true;
    o.onReady();
    if (o.low) return;
    idle(() => {
      Promise.all([load('color_4k.webp', true), load('normal_4k.webp', false)]).then(([c4, n4]) => {
        const old = uniforms.uNormal.value; uniforms.uNormal.value = n4; old.dispose();
        swapColor(c4);
        if (window.innerWidth >= 1024) idle(() => { load('color_8k.webp', true).then(swapColor, () => undefined); }, 4000);
      }, () => undefined);
    }, 2500);
  }, () => o.onFail());

  // ---- Terminator trace (computed from the Horizons Sun direction)
  const L = new THREE.Vector3(...o.sun).normalize();
  const a = new THREE.Vector3().crossVectors(L, Math.abs(L.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const b = new THREE.Vector3().crossVectors(L, a);
  const tracePts: THREE.Vector3[] = [];
  for (let k = 0; k <= 256; k++) {
    const t = (k / 256) * Math.PI * 2;
    tracePts.push(a.clone().multiplyScalar(Math.cos(t)).add(b.clone().multiplyScalar(Math.sin(t))).multiplyScalar(1.003));
  }
  const traceMat = track(new THREE.LineBasicMaterial({ color: 0x9fd8e8, transparent: true, opacity: 0 }));
  moon.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(tracePts)), traceMat));

  // ---- Pole hillshade (visual) and Moon Trek vectors (measured), in map metres on the pole
  const hillU = { uMap: { value: blank as THREE.Texture }, uOpacity: { value: 0 } };
  const hillGeo = track(new THREE.PlaneGeometry(2, 2, 1, 1));
  const pos = hillGeo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const v = mapToSphere(pos.getX(i) * HILL_EXTENT_M, pos.getY(i) * HILL_EXTENT_M, 1.0004);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  hillGeo.computeBoundingSphere();
  const hill = new THREE.Mesh(hillGeo, track(new THREE.ShaderMaterial({ vertexShader: HILL_VERT, fragmentShader: HILL_FRAG, uniforms: hillU, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  hill.renderOrder = 1;
  moon.add(hill);
  let hillLoaded = false;

  const artMat = track(new THREE.LineDashedMaterial({ color: 0x9fd8e8, dashSize: 0.0012, gapSize: 0.0008, transparent: true, opacity: 0, depthTest: false }));
  const labelAnchors: THREE.Vector3[] = [];
  for (const f of o.vectors?.artemis3.features ?? []) {
    const ring = f.rings[0] ?? [];
    const pts = ring.map(([x, y]) => mapToSphere(x!, y!, 1.0008));
    const line = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(pts)), artMat);
    line.computeLineDistances();
    line.renderOrder = 2;
    moon.add(line);
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, pts.length));
    labelAnchors.push(c);
  }
  const psrGeo = track(new THREE.BufferGeometry().setFromPoints((o.vectors?.psr.features ?? []).map((f) => mapToSphere(f.point[0], f.point[1], 1.0008))));
  const psrMat = track(new THREE.PointsMaterial({ color: 0xe5707a, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, depthTest: false }));
  const psr = new THREE.Points(psrGeo, psrMat);
  psr.renderOrder = 2;
  moon.add(psr);

  // ---- Stars (artistic), dust (artistic), rings (artistic)
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const starPos: number[] = [], starCol: number[] = [];
  for (let i = 0; i < 2500; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    starPos.push(90 * r * Math.cos(th), 90 * u, -Math.abs(90 * r * Math.sin(th)) - 5);
    const k = 0.35 + rnd() * 0.65;
    starCol.push(k * 0.92, k * 0.95, k);
  }
  const starGeo = track(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starCol, 3));
  scene.add(new THREE.Points(starGeo, track(new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true }))));

  const dustN = o.low ? 500 : 1200;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dustPos[i * 3] = (rnd() - 0.5) * 4; dustPos[i * 3 + 1] = (rnd() - 0.5) * 2.4; dustPos[i * 3 + 2] = -0.4 - rnd() * 5; }
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = track(new THREE.PointsMaterial({ size: 0.006, color: 0xcfc8bc, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  const rings = new THREE.Group();
  const ringMats: THREE.LineDashedMaterial[] = [];
  for (const [r, op] of [[1.45, 0.55], [1.8, 0.28]] as const) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 200; k++) { const t = (k / 200) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r)); }
    const m = track(new THREE.LineDashedMaterial({ color: 0xbed0e2, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0 }));
    m.userData.max = op;
    ringMats.push(m);
    const line = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(pts)), m);
    line.computeLineDistances();
    rings.add(line);
  }
  const markerMat = track(new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: 0x9fd8e8, transparent: true, opacity: 0 }));
  const marker = new THREE.Points(track(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()])), markerMat);
  rings.add(marker);
  rings.rotation.set(1.18, 0, 0.32);
  scene.add(rings);

  // ---- Frame loop
  const qBase = new THREE.Quaternion(), qFace = new THREE.Quaternion(), e = new THREE.Euler();
  const Z = new THREE.Vector3(0, 0, 1), tmp = new THREE.Vector3();
  const D = Math.PI / 180;
  let w = 0, h = 0, paused = false, last = performance.now(), slow = 0, autoLon = 0;
  const resize = () => {
    const nw = o.canvas.clientWidth, nh = o.canvas.clientHeight;
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(o.canvas);

  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    resize();
    // Adaptive DPR (04 §7)
    if (dt > 0.022) slow += dt; else slow = Math.max(0, slow - dt);
    if (slow > 1 && dpr > 1) { dpr = dpr > 1.25 ? 1.25 : 1; renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); slow = 0; }

    const s = o.state;
    if (s.R < 1.05 && s.lat > -10) autoLon += dt * 0.4; else autoLon *= 0.98; // slow hero rotation, 0.4°/s
    const p = placeMoon(s, camera.aspect);
    moon.position.set(p[0], p[1], p[2]);
    e.set(s.lat * D, (-90 - (s.lon + autoLon)) * D, s.roll * D, 'ZXY');
    qBase.setFromEuler(e);
    qFace.setFromUnitVectors(Z, tmp.copy(moon.position).negate().normalize());
    moon.quaternion.copy(qFace).multiply(qBase);
    moon.updateMatrixWorld();
    uniforms.uCam.value.copy(moon.worldToLocal(tmp.set(0, 0, 0)));
    if (fade) {
      const k = Math.min(1, (now - fade.t0) / 600);
      uniforms.uMix.value = k;
      if (k >= 1) { const old = uniforms.uColor.value; uniforms.uColor.value = fade.tex; uniforms.uMix.value = 0; uniforms.uColorNext.value = blank; if (old !== blank) old.dispose(); fade = null; }
    }
    traceMat.opacity = 0.85 * s.trace;
    if (s.hill > 0.01 && !hillLoaded) {
      hillLoaded = true;
      loader.load(`${BASE}pole_hillshade_2k.webp`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; hillU.uMap.value = t; track(t); });
    }
    hillU.uOpacity.value = hillU.uMap.value === blank ? 0 : s.hill;
    artMat.opacity = 0.9 * s.artemis;
    psrMat.opacity = 0.9 * s.artemis;
    rings.position.copy(moon.position);
    rings.scale.setScalar(1);
    ringMats.forEach((m) => { m.opacity = (m.userData.max as number) * s.ring; });
    markerMat.opacity = s.ring;
    const ang = now / 6000;
    marker.position.set(Math.cos(ang) * 1.45, 0, Math.sin(ang) * 1.45);
    dust.position.y = Math.sin(now / 9000) * 0.05;
    dust.rotation.z = now / 90_000;
    dustMat.opacity = 0.35 * (1 - s.hill);

    // Artemis labels: project anchors to the screen (DOM, no React)
    if (o.labels.length) {
      const vis = s.artemis > 0.02;
      o.labels.forEach((el, i) => {
        const anchor = labelAnchors[i];
        if (!anchor || !vis) { el.style.opacity = '0'; return; }
        const v = anchor.clone().applyMatrix4(moon.matrixWorld).project(camera);
        el.style.opacity = String(s.artemis * (v.z < 1 ? 1 : 0));
        el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
      });
    }
    o.canvas.style.opacity = String(1 - s.dim);
    if (ready) renderer.render(scene, camera);
  };

  const run = () => renderer.setAnimationLoop(paused || document.hidden ? null : frame);
  const onVis = () => run();
  document.addEventListener('visibilitychange', onVis);
  let losses = 0;
  const onLost = (ev: Event) => { ev.preventDefault(); losses++; renderer.setAnimationLoop(null); if (losses > 1) o.onFail(); };
  const onRestored = () => run();
  o.canvas.addEventListener('webglcontextlost', onLost);
  o.canvas.addEventListener('webglcontextrestored', onRestored);
  run();

  return {
    pause(pp: boolean) { paused = pp; last = performance.now(); run(); },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      o.canvas.removeEventListener('webglcontextlost', onLost);
      o.canvas.removeEventListener('webglcontextrestored', onRestored);
      uniforms.uColor.value.dispose(); uniforms.uNormal.value.dispose(); hillU.uMap.value.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    },
  };
}
