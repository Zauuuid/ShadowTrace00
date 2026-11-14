/**
 * Lazy chunk of the Journey: Three.js + GSAP ScrollTrigger + Lenis. Loaded after first paint (04 §7).
 * One master timeline tweens the scene state; Lenis drives scroll and calls ScrollTrigger.update on every tick.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { EphemerisFile } from '../planner/ephemeris';
import type { VectorLayers } from '../data/data';
import { bodyDirs, JOURNEY_DATE, keysFor, sampleAt, sceneAt } from './keyframes';
import { createMoonScene } from './scene';

gsap.registerPlugin(ScrollTrigger);

export interface RuntimeOptions {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly rtl: boolean;
  readonly eph: EphemerisFile;
  readonly vectors: VectorLayers | null;
  readonly labels: readonly HTMLElement[];
  readonly onProgress: (p: number, scene: number) => void;
  readonly onCount: () => void;
  readonly onReady: () => void;
  readonly onFail: () => void;
}

export interface Runtime {
  scrollTo(target: HTMLElement | number, seconds?: number): void;
  /** Re-bind chart draw triggers after the analysis arrives. */
  refreshCharts(): void;
  dispose(): void;
}

export function startJourney(o: RuntimeOptions): Runtime {
  const portrait = window.innerWidth < window.innerHeight && window.innerWidth < 760;
  const keys = keysFor(portrait, o.rtl);
  const state = sampleAt(keys, 0);
  const low = (navigator.hardwareConcurrency ?? 8) <= 4 || window.innerWidth < 760;
  const dirs = bodyDirs(o.eph, JOURNEY_DATE);
  const moon = createMoonScene({ canvas: o.canvas, state, sun: dirs.sun, earth: dirs.earth, earthLitFraction: dirs.earthLitFraction, vectors: o.vectors, low, labels: o.labels, onReady: o.onReady, onFail: o.onFail });

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.inOut' } });
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    const vals: Record<string, number | string | undefined> = { ...b };
    delete vals.p; delete vals.ease;
    tl.to(state, { ...vals, duration: b.p - a.p, ...(b.ease ? { ease: b.ease } : {}) }, a.p);
  }

  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, syncTouch: false });
  lenis.on('scroll', ScrollTrigger.update);
  const raf = (t: number) => lenis.raf(t * 1000);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);

  const triggers: ScrollTrigger[] = [];
  triggers.push(ScrollTrigger.create({
    trigger: o.root, start: 'top top', end: 'bottom bottom', scrub: 0.8, animation: tl,
    onUpdate: (self) => {
      o.onProgress(self.progress, sceneAt(self.progress));
      moon.pause(self.progress > 0.995 && state.dim > 0.85);
    },
  }));
  o.root.querySelectorAll<HTMLElement>('[data-scene]').forEach((el) => {
    triggers.push(ScrollTrigger.create({ trigger: el, start: 'top 65%', end: 'bottom 35%', toggleClass: { targets: el, className: 'in' } }));
  });
  const disc = o.root.querySelector<HTMLElement>('[data-scene="2"]');
  if (disc) triggers.push(ScrollTrigger.create({ trigger: disc, start: 'top+=35% top', once: true, onEnter: o.onCount }));
  const hand = o.root.querySelector<HTMLElement>('[data-reveal-circle]');
  if (hand) {
    triggers.push(ScrollTrigger.create({
      trigger: hand.closest('[data-scene]')!, start: 'top 60%', end: 'bottom bottom', scrub: 0.8,
      onUpdate: (self) => { hand.style.clipPath = `circle(${(self.progress * 150).toFixed(2)}% at 50% 50%)`; },
    }));
  }

  let chartTweens: gsap.core.Tween[] = [];
  const refreshCharts = () => {
    chartTweens.forEach((t) => { t.scrollTrigger?.kill(); t.kill(); });
    chartTweens = [];
    const sec = o.root.querySelector<HTMLElement>('[data-scene="4"]');
    if (!sec) return;
    sec.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel, i) => {
      const st = { trigger: sec, start: `top+=${i * 22}% top`, end: `top+=${i * 22 + 30}% top`, scrub: 0.8 };
      chartTweens.push(gsap.fromTo(panel, { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, ease: 'power3.out', scrollTrigger: { ...st, end: `top+=${i * 22 + 12}% top` } }));
      panel.querySelectorAll('[data-draw]').forEach((path) => chartTweens.push(gsap.fromTo(path, { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: st })));
      panel.querySelectorAll('[data-clip]').forEach((r) => chartTweens.push(gsap.fromTo(r, { attr: { width: 0 } }, { attr: { width: Number(r.getAttribute('data-clip')) }, ease: 'none', scrollTrigger: st })));
    });
    ScrollTrigger.refresh();
  };
  refreshCharts();

  return {
    scrollTo(target, seconds = 1.6) { lenis.scrollTo(target, { duration: seconds }); },
    refreshCharts,
    dispose() {
      triggers.forEach((t) => t.kill());
      chartTweens.forEach((t) => { t.scrollTrigger?.kill(); t.kill(); });
      tl.kill();
      gsap.ticker.remove(raf);
      lenis.destroy();
      moon.dispose();
    },
  };
}
