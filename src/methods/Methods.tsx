/** Data & methods page: dataset catalog (public/data/catalog.json), methodology, provenance classes, limitations, API/database status. */
import { useEffect, useState } from 'react';
import { usePlanner } from '../state/store';
import { useT } from '../state/i18n';
import { Icon } from '../planner-ui/widgets';

interface Dataset {
  id: string; status: 'ingested' | 'investigated'; origin: 'nasa' | 'calc' | 'demo' | 'user'; name: string; instrument: string; source: string; access: string;
  spatialResolution: string; coverage: string; temporalCoverage: string; coordinateSystem: string; units: string; format: string; processing: string; usedFor: string[]; limitations: string;
}

const BASE = import.meta.env.BASE_URL;

type Section = { h: string; p: string[] };
const METHOD: Record<'ar' | 'en', { title: string; lead: string; sections: Section[]; limits: string[]; prov: [string, string][]; api: string[]; catalog: string; fields: Record<string, string>; ingested: string; investigated: string }> = {
  ar: {
    title: 'البيانات والمنهجية',
    lead: 'كل رقم يظهر في ShadowTrace إما مأخوذ من بيانات ناسا، أو محسوب منها بطريقة حتمية قابلة للتكرار، أو مدخل منك. هذه الصفحة توضح من أين يأتي كل شيء وما الذي لا نعرفه.',
    sections: [
      { h: 'التضاريس والميل', p: ['ارتفاعات LOLA بدقة 40 م جنوب 85° و240 م حتى 75° جنوباً. يُحسب الميل بفرق الارتفاع شمال–جنوب وشرق–غرب على مسافة تساوي الأكبر بين امتداد أرجل المركبة وضعف دقة الشبكة، لأن النموذج الرقمي لا يستطيع تمثيل ميل على مسافة أقصر من دقته.', 'التضرس المحلي = جذر متوسط مربعات البواقي لجيرة 3×3 بعد إزالة المستوى الأنسب. هو مقياس لتغير التضاريس على مقياس الشبكة، وليس مقياساً للصخور.'] },
      { h: 'نموذج عدم اليقين في الهبوط (مونت كارلو)', p: ['هامش الخطأ الذي تحدده (شمال/شرق/جنوب/غرب) يُفسَّر كحد kσ (افتراضياً k = 3). تُسحب نقاط الهبوط من توزيع طبيعي منفصل لكل محور، بمولّد أرقام عشوائية ثابت البذرة، فتعطي المدخلات نفسها النتائج نفسها دائماً.', 'نسبة الهبوط الآمن = عدد النقاط التي ميلها ضمن حد المركبة ÷ النقاط المغطاة بالبيانات، مع مدى ثقة Wilson عند 95٪. هذا احتمال نموذجي تحت الافتراضات المعلنة، وليس يقيناً مقيساً.', 'في التوزيع الطبيعي ثنائي الأبعاد يقع 98.9٪ من النقاط داخل قطع 3σ (وليس 99.7٪ كما في البعد الواحد).'] },
      { h: 'الإضاءة والطاقة', p: ['موقع الشمس من JPL Horizons كل ساعة (2026–2035)، يُستكمل إلى خطوة 10 دقائق. يُحسب الأفق من تضاريس LOLA حتى 150 كم مع انحناء القمر، ثم الجزء الظاهر من قرص الشمس.', 'الطاقة = الثابت الشمسي × مساحة الألواح × الكفاءة × الجزء الظاهر × عامل الاتجاه. البطارية تُحاكى خطوة بخطوة بين الصفر والسعة القابلة للاستخدام.'] },
      { h: 'الاتصال بالأرض', p: ['خط نظر هندسي: الأرض «ظاهرة» عندما يتجاوز ارتفاعها الأفق المحلي بالحد الأدنى الذي تحدده. لا نحسب قوة الإشارة، ولا الأقمار المرحلة لعدم وجود مسارات عامة لها.'] },
      { h: 'القرار', p: ['غير مناسب: نفاد البطارية، أو انقطاع عن الأرض أطول من حدك، أو الحد الأعلى لمدى ثقة الهبوط الآمن أقل من متطلبك.', 'مشروط: لا قاعدة صارمة مكسورة، لكن مدى الثقة يتقاطع مع المتطلب، أو أسوأ نقطة في القطع تتجاوز حد الميل، أو الهوامش ضيقة (بطارية < 20٪ أو انقطاع > 75٪ من الحد)، أو الهدف داخل ظل دائم تقريباً.', 'مؤشر القرار (0–100) = متوسط موزون: منطقة الهبوط 45، الطاقة 35، الاتصال 20، ويُقيَّد عند 35 إذا انكسرت قاعدة صارمة. هو للترتيب بين الخيارات فقط.'] },
      { h: 'البدائل الخمسة', p: ['بحث على حلقات حتى 100 كم بالتواريخ والمركبة والقواعد نفسها. كل مرشح يُعاد تقييمه بنموذج مونت كارلو. لا يظهر مرشح إلا إذا غطت البيانات 95٪ على الأقل من نقاط هبوطه، ولا نكمل العدد بمرشحين مختلقين.'] },
    ],
    limits: ['الحرارة (Diviner) لم تُدمج بعد؛ لا نعرض درجات حرارة.', 'الصخور والفوهات الأصغر من ~80 م لا تُرى في شبكة 40 م.', 'الميل على مقياس أرجل المركبة (أمتار) غير معروف؛ الميل المحسوب على 80 م شرط ضروري لا كافٍ.', 'الظل الدائم مقرب بدوائر متساوية المساحة.', 'الأقمار المرحلة غير مقيّمة.', 'القاعدة البيانية PostGIS مصممة ومرفقة في المستودع لكنها غير مفعّلة في النسخة المنشورة؛ كل الحسابات تعمل في المتصفح من ملفات ثابتة.'],
    prov: [['nasa', 'بيانات ناسا: قيم مأخوذة مباشرة من منتجات ناسا (LOLA، Horizons، Moon Trek، IAU).'], ['calc', 'محسوب: نتائج المحرك الحتمي من بيانات ناسا ومدخلاتك.'], ['user', 'مدخلاتك: مواصفات المركبة والهامش والمتطلبات.'], ['demo', 'رسم توضيحي: صور فنية أو مرئيات لا تدخل في أي حساب.']],
    api: ['GET /api/health — حالة الخدمة والإصدار.', 'GET /api/datasets — كتالوج البيانات (هذا الجدول) بصيغة JSON.'],
    catalog: 'كتالوج البيانات',
    fields: { instrument: 'الأداة', source: 'المصدر', access: 'طريقة الوصول', spatialResolution: 'الدقة المكانية', coverage: 'التغطية', temporalCoverage: 'التغطية الزمنية', coordinateSystem: 'نظام الإحداثيات', units: 'الوحدات', format: 'الصيغة', processing: 'المعالجة', limitations: 'القيود' },
    ingested: 'مُدمجة', investigated: 'مدروسة، غير مُدمجة',
  },
  en: {
    title: 'Data & methods',
    lead: 'Every number in ShadowTrace is either taken from NASA data, computed from it by a deterministic, reproducible method, or entered by you. This page shows where everything comes from — and what we do not know.',
    sections: [
      { h: 'Terrain and slope', p: ['LOLA heights at 40 m south of 85°S and 240 m to 75°S. Slope uses the north–south and east–west height differences over a baseline equal to the larger of the leg span and twice the grid spacing: a DEM cannot represent slope over a distance shorter than its own resolution.', 'Local relief = RMS residual of the 3×3 neighbourhood after removing the best-fit plane. It measures terrain variability at grid scale, not boulders.'] },
      { h: 'Touchdown uncertainty (Monte Carlo)', p: ['Your error margin (N/E/S/W) is read as a kσ bound (default k = 3). Touchdowns are drawn from a split-normal distribution per axis with a fixed-seed generator, so the same inputs always give the same points.', 'P(safe) = touchdowns on slope within the lander limit ÷ touchdowns with data, with a Wilson 95% interval. It is a modelled probability under stated assumptions, not a measured certainty.', 'For a 2-D normal, 98.9% of touchdowns fall inside the 3σ ellipse (not the 1-D 99.7%).'] },
      { h: 'Illumination and power', p: ['Sun position from JPL Horizons every hour (2026–2035), interpolated to a 10-minute step. The horizon is computed from LOLA terrain out to 150 km including lunar curvature, then the visible fraction of the solar disc.', 'Power = solar constant × array area × efficiency × visible fraction × orientation factor. The battery is simulated step by step between zero and its usable capacity.'] },
      { h: 'Earth contact', p: ['Geometric line of sight: Earth counts as visible when its elevation clears the local horizon by your minimum. Signal strength is not modelled, and relay satellites are not assessed because no public relay ephemerides exist.'] },
      { h: 'The decision', p: ['Unsuitable: the battery runs out, an Earth blackout exceeds your limit, or the upper 95% bound of P(safe) is below your requirement.', 'Conditional: no hard rule fails, but the P(safe) interval straddles the requirement, the worst point in the ellipse exceeds the slope limit, margins are thin (battery < 20% or blackout > 75% of the limit), or the target is approximately inside a permanently shadowed region.', 'Decision index (0–100) = weighted mean: footprint 45, power 35, comms 20, capped at 35 when a hard rule fails. It ranks options only.'] },
      { h: 'Five alternatives', p: ['A ring search up to 100 km with the same dates, spacecraft and rules. Each candidate is re-evaluated with the Monte Carlo footprint model. A candidate is shown only when data covers at least 95% of its touchdowns, and the list is never padded with invented sites.'] },
    ],
    limits: ['Thermal (Diviner) is not ingested yet; no temperatures are shown.', 'Boulders and craters smaller than ~80 m are invisible in a 40 m grid.', 'Slope at leg scale (metres) is unknown; slope over 80 m is necessary, not sufficient.', 'Permanently shadowed regions are approximated by equal-area circles.', 'Relay satellites are not assessed.', 'The PostGIS database is designed and included in the repository but not active in the deployed version; all computation runs in the browser from static files.'],
    prov: [['nasa', 'NASA data: values taken directly from NASA products (LOLA, Horizons, Moon Trek, IAU).'], ['calc', 'Calculated: results of the deterministic engine from NASA data and your inputs.'], ['user', 'Your input: spacecraft, error margin and requirements.'], ['demo', 'Illustration: artwork or visuals that enter no calculation.']],
    api: ['GET /api/health — service status and version.', 'GET /api/datasets — the dataset catalog (this table) as JSON.'],
    catalog: 'Dataset catalog',
    fields: { instrument: 'Instrument', source: 'Source', access: 'Access', spatialResolution: 'Spatial resolution', coverage: 'Coverage', temporalCoverage: 'Temporal coverage', coordinateSystem: 'Coordinate system', units: 'Units', format: 'Format', processing: 'Processing', limitations: 'Limitations' },
    ingested: 'Ingested', investigated: 'Investigated, not ingested',
  },
};

export function Methods() {
  const t = useT();
  const lang = usePlanner((s) => s.lang);
  const set = usePlanner((s) => s.set);
  const [cat, setCat] = useState<Dataset[] | null>(null);
  useEffect(() => {
    fetch(`${BASE}data/catalog.json`).then((r) => (r.ok ? r.json() : { datasets: [] })).then((j: { datasets: Dataset[] }) => setCat(j.datasets), () => setCat([]));
  }, []);
  const c = METHOD[lang];
  return (
    <main id="main" className="methods">
      <button type="button" className="btn-text" onClick={() => set({ page: 'mission' })}><Icon name="arrow" size={18} className="flip" />{t('v4.backApp')}</button>
      <h1 className="display">{c.title}</h1>
      <p className="lead">{c.lead}</p>

      <section className="m-prov">
        {c.prov.map(([k, txt]) => <p key={k}><span className={`org ${k}`}>{t(`v4.org.${k}` as 'v4.org.nasa')}</span>{txt.slice(txt.indexOf(':') + 1)}</p>)}
      </section>

      <section className="m-grid">
        {c.sections.map((s) => (
          <article key={s.h}>
            <h2 className="h2">{s.h}</h2>
            {s.p.map((x) => <p key={x}>{x}</p>)}
          </article>
        ))}
      </section>

      <section>
        <h2 className="h2">{c.catalog}</h2>
        {cat === null ? <p className="muted">…</p> : (
          <div className="catalog">
            {cat.map((d) => (
              <details key={d.id} className={`ds ${d.status}`}>
                <summary>
                  <span className={`badge ${d.status === 'ingested' ? 'ok' : 'nodata'}`}>{d.status === 'ingested' ? c.ingested : c.investigated}</span>
                  <b dir="ltr">{d.name}</b>
                  <span className={`org ${d.origin}`}>{t(`v4.org.${d.origin}` as 'v4.org.nasa')}</span>
                </summary>
                <dl dir="ltr">
                  {(Object.keys(c.fields) as (keyof Dataset)[]).map((k) => <div key={k}><dt className="label mono">{c.fields[k]}</dt><dd>{String(d[k])}</dd></div>)}
                </dl>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="m-two">
        <article><h2 className="h2">{lang === 'ar' ? 'القيود المعروفة' : 'Known limitations'}</h2><ul className="ledger-list">{c.limits.map((x) => <li key={x}><Icon name="warn" size={16} />{x}</li>)}</ul></article>
        <article><h2 className="h2">API</h2><ul className="ledger-list mono small" dir="ltr">{c.api.map((x) => <li key={x}>{x}</li>)}</ul></article>
      </section>
    </main>
  );
}
