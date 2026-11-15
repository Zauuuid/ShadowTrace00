/**
 * Interactive 3D Moon (Three.js). Drag / touch to rotate, wheel / pinch / buttons to zoom, tap to select.
 *
 * Imagery and layers, and what they are:
 *  - Base globe: NASA SVS CGI Moon Kit colour + normal maps (LROC WAC + LOLA) — NASA visualisation imagery.
 *  - "Relief" near the pole: hillshade computed from NASA LOLA 240 m heights (public/data/moon/pole_hillshade_2k.webp).
 *  - "Sun & Earth" layer: SHADOWTRACE's monthly suitability map (calculated from LOLA + JPL Horizons).
 *  - PSR points and Artemis III regions: NASA Moon Trek vectors.
 *  - Lighting: "display" light follows the camera so the face you look at is lit; "Sun at landing date" uses the
 *    JPL Horizons sub-solar point. Markers are HTML elements projected each frame (crisp, focusable, tappable).
 * Coordinates: lonLatToVec3 (+X = 0°/0°, +Y = north, −Z = 90°E), shared with the rest of the app.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlannerData } from '../data/data';
import { lonLatToVec3, type Vec3 } from '../journey/keyframes';
import { MOON_R_M, toLatLon, type LatLon } from '../planner/polar';

const DATA = `${import.meta.env.BASE_URL}data/`;
const D = Math.PI / 180;
const HILL_EXT = 160_200 / MOON_R_M;

export interface GlobeMarker {
  readonly id: string;
  readonly at: LatLon;
  readonly label: string;
  readonly tone: 'target' | 'ok' | 'warn' | 'bad' | 'info';
  readonly title?: string;
  readonly onClick?: () => void;
}
export interface GlobeLayers { relief: boolean; suit: boolean; psr: boolean; artemis: boolean }
export interface GlobeView { lat: number; lon: number; dist: number }

interface Props {
  readonly data: PlannerData | null;
  readonly markers?: readonly GlobeMarker[];
  readonly onPick?: (p: LatLon) => void;
  readonly layers?: GlobeLayers;
  readonly suitMonth?: string | null;
  /** Sub-solar unit vector (Moon frame) for real lighting; null = display lighting. */
  readonly sun?: Vec3 | null;
  /** Where the camera should fly. Changing `view` (by value) animates to it. */
  readonly view: GlobeView;
  readonly autoRotate?: boolean;
  readonly interactive?: boolean;
  readonly className?: string;
  readonly label: string;
  readonly onView?: (v: GlobeView) => void;
  readonly flySeconds?: number;
}

const VERT = /* glsl */ `
varying vec3 vPos; varying vec2 vUv;
void main() { vPos = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */ `
uniform sampler2D uColor; uniform sampler2D uNormal; uniform sampler2D uHill; uniform sampler2D uSuit;
uniform vec3 uLight; uniform float uAmbient; uniform float uHillOn; uniform float uSuitOn; uniform float uHillExt; uniform float uSuitExt;
varying vec3 vPos; varying vec2 vUv;
vec2 stereo(vec3 p) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(-p.z, p.x);
  float rho = 2.0 * tan(0.78539816 + lat * 0.5);
  return vec2(rho * sin(lon), rho * cos(lon));
}
void main() {
  vec3 up = normalize(vPos);
  vec3 east = vec3(up.z, 0.0, -up.x);
  east = length(east) > 1e-4 ? normalize(east) : vec3(0.0, 0.0, -1.0);
  vec3 north = cross(up, east);
  vec3 tn = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  vec3 N = normalize(east * tn.x + north * tn.y + up * tn.z);
  vec3 L = normalize(uLight);
  float diff = max(dot(N, L), 0.0);
  float geo = smoothstep(-0.02, 0.06, dot(up, L));
  vec3 albedo = texture2D(uColor, vUv).rgb;
  vec3 c = albedo * (uAmbient + (1.0 - uAmbient) * diff * geo) * 1.12;
  if (up.y < -0.9) {
    vec2 xy = stereo(up);
    vec2 hu = vec2(xy.x / uHillExt * 0.5 + 0.5, xy.y / uHillExt * 0.5 + 0.5);
    float r = length(xy) / uHillExt;
    if (uHillOn > 0.0 && r < 1.0) {
      float m = (1.0 - smoothstep(0.62, 1.0, r)) * uHillOn;
      vec3 h = texture2D(uHill, hu).rgb;
      c = mix(c, h * (uAmbient + (1.0 - uAmbient) * geo) * 1.9, m);
    }
    vec2 su = vec2(xy.x / uSuitExt * 0.5 + 0.5, xy.y / uSuitExt * 0.5 + 0.5);
    if (uSuitOn > 0.0 && su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
      vec4 s = texture2D(uSuit, su);
      c = mix(c, s.rgb, s.a * 0.62 * uSuitOn);
    }
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export function Globe({ data, markers = [], onPick, layers, suitMonth, sun, view, autoRotate, interactive = true, className, label, onView, flySeconds = 1.6 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const markerEls = useRef(new Map<string, HTMLButtonElement>());
  const api = useRef<{ setLayers: (l: GlobeLayers) => void; setSuit: (m: string | null) => void; setSun: (s: Vec3 | null) => void; fly: (v: GlobeView) => void; zoom: (f: number) => void; markers: readonly GlobeMarker[]; onPick?: (p: LatLon) => void; onView?: (v: GlobeView) => void; auto: boolean } | null>(null);
  const [failed, setFailed] = useState(() => typeof document !== 'undefined' && !webglAvailable());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const canvas = cv.current, el = box.current;
    if (!canvas || !el || failed) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { setFailed(true); return; }
    const low = window.innerWidth < 760 || (navigator.hardwareConcurrency ?? 8) <= 4;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.001, 100);
    const loader = new THREE.TextureLoader();
    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
    const tex1 = (rgba: number[]) => { const t = track(new THREE.DataTexture(new Uint8Array(rgba), 1, 1)); t.needsUpdate = true; return t; };
    const uniforms = {
      uColor: { value: tex1([60, 62, 70, 255]) as THREE.Texture }, uNormal: { value: tex1([128, 128, 255, 255]) as THREE.Texture },
      uHill: { value: tex1([0, 0, 0, 255]) as THREE.Texture }, uSuit: { value: tex1([0, 0, 0, 0]) as THREE.Texture },
      uLight: { value: new THREE.Vector3(1, 0, 0) }, uAmbient: { value: 0.16 },
      uHillOn: { value: 0 }, uSuitOn: { value: 0 }, uHillExt: { value: HILL_EXT }, uSuitExt: { value: (data?.suit?.extentM ?? 457_466) / MOON_R_M },
    };
    const moon = new THREE.Mesh(track(new THREE.SphereGeometry(1, low ? 128 : 192, low ? 64 : 96)), track(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms })));
    const group = new THREE.Group();
    group.add(moon);
    scene.add(group);
    const prep = (t: THREE.Texture, srgb: boolean) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    };
    const load = (url: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => loader.load(url, (t) => res(prep(t, srgb)), undefined, rej));
    let alive = true;
    Promise.all([load(`${DATA}moon/color_2k.webp`, true), load(`${DATA}moon/normal_2k.webp`, false)]).then(([c, n]) => {
      if (!alive) { c.dispose(); n.dispose(); return; }
      uniforms.uColor.value = track(c); uniforms.uNormal.value = track(n); setLoading(false);
      if (!low) setTimeout(() => {
        Promise.all([load(`${DATA}moon/color_4k.webp`, true), load(`${DATA}moon/normal_4k.webp`, false)]).then(([c4, n4]) => {
          if (!alive) return;
          uniforms.uColor.value = track(c4); uniforms.uNormal.value = track(n4);
        }, () => undefined);
      }, 1500);
    }, () => { if (alive) setFailed(true); });
    load(`${DATA}moon/pole_hillshade_2k.webp`, true).then((t) => { if (alive) uniforms.uHill.value = track(t); }, () => undefined);

    // Stars (decorative, fixed seed)
    const starPos: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 40;
      starPos.push(r * Math.sqrt(1 - u * u) * Math.cos(th), r * u, r * Math.sqrt(1 - u * u) * Math.sin(th));
    }
    const starGeo = track(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, track(new THREE.PointsMaterial({ color: 0xc9d4ea, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.55 }))));

    // NASA Moon Trek vectors
    const toVec = (x: number, y: number, lift: number) => { const ll = toLatLon({ x, y }); const v = lonLatToVec3(ll.lat, ll.lon); return new THREE.Vector3(v[0] * lift, v[1] * lift, v[2] * lift); };
    const artemis = new THREE.Group();
    const artMat = track(new THREE.LineBasicMaterial({ color: 0x9a8cd6, transparent: true, opacity: 0.9 }));
    for (const f of data?.vectors.artemis3.features ?? []) {
      const ring = f.rings[0] ?? [];
      artemis.add(new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(ring.map(([x, y]) => toVec(x!, y!, 1.0006)))), artMat));
    }
    group.add(artemis);
    const psrGeo = track(new THREE.BufferGeometry().setFromPoints((data?.vectors.psr.features ?? []).map((f) => toVec(f.point[0], f.point[1], 1.0006))));
    const psr = new THREE.Points(psrGeo, track(new THREE.PointsMaterial({ color: 0xc94f62, size: 3.5, sizeAttenuation: false })));
    group.add(psr);

    // View state (turntable): the point (lat, lon) faces the camera, north up.
    const cur: GlobeView = { ...view };
    let fly: { from: GlobeView; to: GlobeView; t0: number; dur: number } | null = null;
    let auto = !!autoRotate;
    const suitTex = new Map<string, THREE.Texture>();
    const ctl = {
      setLayers: (l: GlobeLayers) => { uniforms.uHillOn.value = l.relief ? 1 : 0; uniforms.uSuitOn.value = l.suit ? 1 : 0; psr.visible = l.psr; artemis.visible = l.artemis; },
      setSuit: (m: string | null) => {
        if (!m) { uniforms.uSuitOn.value = 0; return; }
        const hit = suitTex.get(m);
        if (hit) { uniforms.uSuit.value = hit; return; }
        load(`${DATA}suit/${m}.png`, true).then((t) => { if (!alive) return; suitTex.set(m, track(t)); uniforms.uSuit.value = t; }, () => undefined);
      },
      setSun: (s: Vec3 | null) => { sunVec = s ? new THREE.Vector3(...s) : null; },
      fly: (v: GlobeView) => { fly = { from: { ...cur }, to: { lat: v.lat, lon: cur.lon + wrap(v.lon - cur.lon), dist: v.dist }, t0: performance.now(), dur: flySeconds * 1000 }; },
      zoom: (f: number) => { fly = null; cur.dist = Math.max(1.004, Math.min(5, 1 + (cur.dist - 1) * f)); },
      markers, onPick, onView, auto,
    };
    let sunVec: THREE.Vector3 | null = sun ? new THREE.Vector3(...sun) : null;
    api.current = ctl;
    ctl.setLayers(layers ?? { relief: true, suit: false, psr: false, artemis: false });
    ctl.setSuit(suitMonth ?? null);

    // Input
    const ray = new THREE.Raycaster();
    const ptr = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; moved: boolean } | null = null;
    let pinch0 = 0, dist0 = cur.dist;
    const rect = () => canvas.getBoundingClientRect();
    const onDown = (e: PointerEvent) => {
      if (!interactive) return;
      canvas.setPointerCapture(e.pointerId);
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      fly = null; ctl.auto = false;
      if (ptr.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch0 = Math.hypot(a!.x - b!.x, a!.y - b!.y); dist0 = cur.dist; if (down) down.moved = true; }
    };
    const onMove = (e: PointerEvent) => {
      const p = ptr.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptr.size === 2) {
        const [a, b] = [...ptr.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch0 > 0) cur.dist = Math.max(1.004, Math.min(5, 1 + (dist0 - 1) * (pinch0 / d)));
        return;
      }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
      const h = rect().height;
      // degrees per pixel shrink as we zoom in, so the surface follows the finger
      const k = (2 * Math.atan(Math.tan((17 * D)) * (cur.dist - 0.98)) / D) / h * 1.6;
      cur.lon -= dx * k / Math.max(0.25, Math.cos(cur.lat * D));
      cur.lat = Math.max(-90, Math.min(90, cur.lat + dy * k));
    };
    const onUp = (e: PointerEvent) => {
      ptr.delete(e.pointerId);
      if (ptr.size < 2) pinch0 = 0;
      if (down && !down.moved && ptr.size === 0 && ctl.onPick) {
        const r = rect();
        const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObject(moon)[0];
        if (hit) {
          const p = group.worldToLocal(hit.point.clone()).normalize();
          ctl.onPick({ lat: Math.asin(p.y) / D, lon: Math.atan2(-p.z, p.x) / D });
        }
      }
      if (ptr.size === 0) { down = null; ctl.onView?.({ ...cur }); }
    };
    const onWheel = (e: WheelEvent) => {
      if (!interactive) return;
      e.preventDefault(); fly = null; ctl.auto = false;
      cur.dist = Math.max(1.004, Math.min(5, 1 + (cur.dist - 1) * Math.exp(e.deltaY * 0.0012)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, last = performance.now(), visible = true;
    const io = new IntersectionObserver(([en]) => { visible = !!en?.isIntersecting; });
    io.observe(el);
    const v = new THREE.Vector3(), camDir = new THREE.Vector3();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible || document.hidden) return;
      if (fly) {
        const x = Math.min(1, (now - fly.t0) / (reduced ? 1 : fly.dur));
        const e = ease(x);
        cur.lat = fly.from.lat + (fly.to.lat - fly.from.lat) * e;
        cur.lon = fly.from.lon + (fly.to.lon - fly.from.lon) * e;
        // arc out then in when travelling far
        const span = Math.hypot(fly.to.lat - fly.from.lat, fly.to.lon - fly.from.lon);
        const lift = Math.min(0.9, span / 120) * Math.sin(Math.PI * e);
        cur.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * e + lift;
        if (x >= 1) { fly = null; ctl.onView?.({ ...cur }); }
      } else if (ctl.auto && !reduced) cur.lon += dt * 3;
      group.rotation.set(cur.lat * D, (-90 - cur.lon) * D, 0, 'XYZ');
      camera.position.set(0, 0, cur.dist);
      camera.lookAt(0, 0, 0);
      group.updateMatrixWorld();
      // light: display light from the upper-left of the viewer, or the real Sun direction
      if (sunVec) uniforms.uLight.value.copy(sunVec);
      else {
        const inv = group.quaternion.clone().invert();
        uniforms.uLight.value.set(-0.45, 0.55, 1).normalize().applyQuaternion(inv);
      }
      uniforms.uAmbient.value = sunVec ? 0.05 : 0.18;
      renderer.render(scene, camera);
      // markers
      const r = rect();
      camDir.copy(camera.position);
      for (const m of ctl.markers) {
        const node = markerEls.current.get(m.id);
        if (!node) continue;
        const p = lonLatToVec3(m.at.lat, m.at.lon);
        v.set(p[0], p[1], p[2]).applyMatrix4(group.matrixWorld);
        const facing = v.dot(camDir.clone().sub(v)) > 0;
        v.project(camera);
        const x = (v.x * 0.5 + 0.5) * r.width, y = (-v.y * 0.5 + 0.5) * r.height;
        node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        node.style.opacity = facing ? '1' : '0';
        node.style.pointerEvents = facing ? 'auto' : 'none';
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      api.current = null;
    };
    // The scene is built once per data object; later prop changes go through `api`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, failed]);

  // Live prop updates (no rebuild)
  useEffect(() => { if (api.current) { api.current.markers = markers; api.current.onPick = onPick; api.current.onView = onView; } });
  useEffect(() => { api.current?.setLayers(layers ?? { relief: true, suit: false, psr: false, artemis: false }); }, [layers]);
  useEffect(() => { api.current?.setSuit(layers?.suit ? suitMonth ?? null : null); }, [suitMonth, layers]);
  useEffect(() => { api.current?.setSun(sun ?? null); }, [sun]);
  useEffect(() => { if (api.current) api.current.auto = !!autoRotate; }, [autoRotate]);
  const viewKey = `${view.lat.toFixed(4)},${view.lon.toFixed(4)},${view.dist.toFixed(4)}`;
  useEffect(() => { api.current?.fly(view); }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <div className={`globe globe-fallback ${className ?? ''}`} role="img" aria-label={label}>
        <img src={`${DATA}moon/pole_hillshade_2k.webp`} alt="" />
      </div>
    );
  }
  return (
    <div className={`globe ${className ?? ''}`} ref={box}>
      <canvas ref={cv} role="img" aria-label={label} tabIndex={interactive ? 0 : -1}
        onKeyDown={(e) => {
          if (!interactive || !api.current) return;
          const step = 4;
          if (e.key === '+' || e.key === '=') api.current.zoom(0.7);
          else if (e.key === '-') api.current.zoom(1.4);
          else if (e.key.startsWith('Arrow')) {
            const c = { ...view };
            api.current.fly({ lat: Math.max(-90, Math.min(90, c.lat + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0))), lon: c.lon + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), dist: c.dist });
          } else return;
          e.preventDefault();
        }} />
      {loading ? <div className="globe-loading mono" aria-hidden="true"><span /></div> : null}
      <div className="globe-markers">
        {markers.map((m) => (
          <button key={m.id} type="button" className={`gm ${m.tone}`} ref={(n) => { if (n) markerEls.current.set(m.id, n); else markerEls.current.delete(m.id); }}
            onClick={m.onClick} aria-label={m.title ?? m.label} title={m.title} tabIndex={m.onClick ? 0 : -1}>
            <span className="gm-dot" /><span className="gm-label">{m.label}</span>
          </button>
        ))}
      </div>
      {interactive ? (
        <div className="globe-zoom">
          <button type="button" aria-label="zoom in" onClick={() => api.current?.zoom(0.6)}>+</button>
          <button type="button" aria-label="zoom out" onClick={() => api.current?.zoom(1.6)}>−</button>
        </div>
      ) : null}
    </div>
  );
}
