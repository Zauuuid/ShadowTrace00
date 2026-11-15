/**
 * Screen 04 — launch. A cinematic, clearly labelled ILLUSTRATIVE sequence (not a trajectory computation):
 *   1 lift-off from Earth · 2 cruise · 3 the Moon approaches · 4 arrival over the user's target.
 * Stages 1–2 are drawn on a 2D canvas; stages 3–4 are the real NASA-textured globe flying to the selected coordinates,
 * so the destination is always the mission's own site.
 */
import { useEffect, useRef, useState } from 'react';
import type { PlannerData } from '../data/data';
import { Globe } from '../globe/Globe';
import { useT } from '../state/i18n';
import { usePlanner } from '../state/store';
import { Icon } from '../planner-ui/widgets';
import { ASSETS, craftOf, nearest } from './common';

const T1 = 2600, T2 = 5200, T3 = 8200, T4 = 11000;

export function Launch({ data }: { data: PlannerData }) {
  const t = useT();
  const site = usePlanner((s) => s.site);
  const craftId = usePlanner((s) => s.craftId);
  const set = usePlanner((s) => s.set);
  const cv = useRef<HTMLCanvasElement>(null);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [ms, setMs] = useState(reduced ? T4 : 0);
  const near = nearest(data, site);
  const stage = ms < T1 ? 1 : ms < T2 ? 2 : ms < T3 ? 3 : 4;

  useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => { const e = now - t0; setMs(e); if (e < T4 + 1400) raf = requestAnimationFrame(tick); else set({ page: 'landing' }); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, set]);

  // 2D canvas for Earth departure and cruise
  const img = useRef<HTMLImageElement | null>(null);
  useEffect(() => { const i = new Image(); i.src = `${ASSETS}spacecraft/${craftOf(craftId)}-perspective.webp`; img.current = i; }, [craftId]);
  useEffect(() => {
    const c = cv.current;
    if (!c || stage > 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // stars, streaking during cruise
    const streak = Math.max(0, Math.min(1, (ms - T1) / 900)) * (stage === 2 ? 1 : 0);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.strokeStyle = 'rgba(216,222,232,.7)';
    for (let i = 0; i < 220; i++) {
      const x = ((rnd() * W - ms * 0.02 * (0.3 + rnd())) % W + W) % W, y = rnd() * H, len = 1 + streak * 26 * rnd();
      g.globalAlpha = 0.25 + rnd() * 0.6; g.lineWidth = rnd() < 0.1 ? 1.4 : 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - len, y); g.stroke();
    }
    g.globalAlpha = 1;
    // Earth (illustrative: no texture), sliding away during stage 2
    const R = Math.min(W, H) * 0.42;
    const ex = W * 0.18 - Math.max(0, ms - T1) * 0.12, ey = H * 0.92 + Math.max(0, ms - T1) * 0.05;
    const grad = g.createRadialGradient(ex - R * 0.35, ey - R * 0.4, R * 0.1, ex, ey, R);
    grad.addColorStop(0, '#5f9fe0'); grad.addColorStop(0.55, '#245a9e'); grad.addColorStop(1, '#0a1f45');
    g.fillStyle = grad; g.beginPath(); g.arc(ex, ey, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,180,255,.45)'; g.lineWidth = 6; g.beginPath(); g.arc(ex, ey, R + 3, 0, Math.PI * 2); g.stroke();
    // trajectory hint (illustrative arc) and the spacecraft
    const p = Math.min(1, ms / T2);
    const ax = ex + R * 0.5, ay = ey - R * 0.86;
    const bx = W * 1.05, by = H * 0.18;
    const qx = W * 0.45, qy = H * 0.2;
    const bez = (u: number): [number, number] => [(1 - u) ** 2 * ax + 2 * (1 - u) * u * qx + u * u * bx, (1 - u) ** 2 * ay + 2 * (1 - u) * u * qy + u * u * by];
    g.setLineDash([3, 7]); g.strokeStyle = 'rgba(154,140,214,.6)'; g.lineWidth = 1.3; g.beginPath();
    for (let u = 0; u <= p; u += 0.02) { const [x, y] = bez(u); if (u === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke(); g.setLineDash([]);
    const [sx, sy] = bez(p);
    const i = img.current;
    if (i && i.complete && i.naturalWidth) {
      const s = Math.min(W, H) * (0.16 - 0.06 * p);
      g.save(); g.translate(sx, sy); g.rotate(-0.5 + p * 0.3);
      // engine plume (illustrative)
      const fl = g.createLinearGradient(0, s * 0.45, 0, s * 1.3);
      fl.addColorStop(0, 'rgba(255,214,150,.9)'); fl.addColorStop(1, 'rgba(255,214,150,0)');
      g.fillStyle = fl; g.beginPath(); g.moveTo(-s * 0.08, s * 0.42); g.lineTo(s * 0.08, s * 0.42); g.lineTo(0, s * (1.1 + 0.2 * Math.sin(ms / 60))); g.closePath(); g.fill();
      g.drawImage(i, -s / 2, -s / 2, s, s * (i.naturalHeight / i.naturalWidth));
      g.restore();
    }
  }, [ms, stage]);

  const view = stage <= 3 ? { lat: -20, lon: site.lon + 40, dist: stage === 3 && ms > T2 + 300 ? 2.4 : 5.5 } : { lat: site.lat, lon: site.lon, dist: 1.12 };
  const caption = stage === 1 ? t('l.s1') : stage === 2 ? t('l.s2') : stage === 3 ? t('l.s3') : t('l.s4', { site: near?.name ?? `${site.lat.toFixed(2)}°` });
  return (
    <main id="main" className="launch">
      <div className={`launch-stage s${stage}`}>
        <canvas ref={cv} className="launch-canvas" aria-hidden="true" />
        {stage >= 2 ? (
          <div className="launch-globe">
            <Globe data={data} view={view} interactive={false} flySeconds={stage === 4 ? 2.6 : 2.8} label={caption}
              markers={stage === 4 ? [{ id: 't', at: site, label: '', tone: 'target' }] : []} layers={{ relief: true, suit: false, psr: false, artemis: false }} />
          </div>
        ) : null}
      </div>
      <div className="launch-hud">
        <p className="eyebrow mono">{t('nav.step', { n: 3 })} · 0{stage} / 04</p>
        <h1 className="display md" aria-live="polite">{caption}</h1>
        <div className="launch-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (ms / T4) * 100)}%` }} /></div>
        <p className="disclaimer mono"><Icon name="info" size={14} /> {t('l.disclaimer')}</p>
      </div>
      <button type="button" className={reduced || ms >= T4 ? 'btn-primary launch-skip' : 'btn-ghost launch-skip'} onClick={() => set({ page: 'landing' })}>
        <span>{reduced || ms >= T4 ? t('l.continue') : t('l.skip')}</span><Icon name="arrow" size={16} className="flip-rtl" />
      </button>
    </main>
  );
}
