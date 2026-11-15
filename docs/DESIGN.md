# SHADOWTRACE — Design audit & v4 design system

## 1. Audit of the v3/v4-alpha interface (what made it look generic)

| Problem | Where | Effect |
|---|---|---|
| One long scroll story + a 6-step wizard | Journey → planner | The product's purpose appears only after minutes of scrolling; no sense of "places" in the product. |
| Monochrome graphite + single cyan | everywhere | Reads as a developer dark theme, not an aerospace brand; cyan was used for both actions and data. |
| Line-art lander labelled "illustration" | Spacecraft step | No product identity; the most emotional object in the domain was a wireframe. |
| Map as a panel inside a form | Site step | Exploration — the most visual task — was squeezed to a 2/3 column. |
| Result = a wall of numbers | Result step | The verdict was a word above 6 metric cells and 5 charts; reasons were secondary. |
| Uniform outlined cards and pills | all steps | Repetition, no hierarchy between primary and secondary actions. |
| Basic/expert distinction missing | — | Novices met battery fractions and Earth elevation masks in step 2. |

## 2. Information architecture (8 experiences)

`Home → Explore → Plan (5 stages) → Simulate → Results → Alternatives → Report`, plus `Data` (always one tap away)
and `Story` (the NASA-textured 3D Moon narrative, reachable from Home).

Each experience has its own URL (`#/en/explore`, `#/ar/results`, …), its own layout and one primary action that
leads to the next experience.

## 3. Colour system — strict roles

| Role | Token | Hex | Used for (only) |
|---|---|---|---|
| Background | `--bg-0` | #080D1B Midnight Navy | page |
| Surface | `--bg-1` / `--bg-2` | #0E1730 / #142B50 Deep Blue | panels, the map frame, report |
| **Primary** | `--primary` | #2868B2 Aerospace Blue | the one primary action per screen, selected nav, progress |
| **Secondary** | `--violet` | #7868B8 Muted Violet | brand accents: eyebrows, stage numbers, decorative rules |
| **Accent** | `--ice` | #65D5E5 Cyan | focus rings, selection, the uncertainty ellipse, live data marks |
| Text | `--text` / `--white` | #D8DEE8 / #F4F6FA | body / headings |
| Success | `--ok` | #5FC9A0 Mint | verified positive outcome only (Suitable, safe touchdown) |
| Warning | `--warn` | #E0A84F Amber | Conditional, thin margins |
| Failure | `--bad` | #C94F62 Crimson | danger only: Unsuitable, hazards, too-steep terrain |
| Science | `--sun` / `--earth` | #D9B36C / #6FA3E0 | sunlight & power series / Earth line-of-sight series |

Red is never decorative. Blue and violet carry the brand; silver/white carry the science.

## 4. Typography
Manrope (Latin) + IBM Plex Sans Arabic (Arabic, first-class, own line-height and no letter-spacing) + JetBrains Mono
for data. Display sizes 44–96 px, body ≥ 16 px, labels ≥ 12 px. Arabic headings use weight 500 (Arabic thin weights
lose legibility); Latin display uses 300.

## 5. Spacecraft
The team's lander (8 orthographic and perspective views) is cut from the supplied reference sheet with its original
transparency, cropped tightly, never scaled beyond its proportions (`object-fit: contain`). Files:
`public/assets/spacecraft/lander-{front,front-angle,side-left,side-right,top,bottom,perspective-left,perspective-right}.webp`.
Used in: Home hero (perspective), Spacecraft configuration (front view with live callouts), Simulate (side view
descending onto the LOLA terrain profile; top view over the footprint), Results and Report headers.
The source sheet is ~380 px per view; a higher-resolution render would make the hero sharper on retina screens.

## 6. Imagery rules
- Generative artwork (`public/assets/backgrounds`, `public/assets/lunar`) is atmosphere only and is labelled
  "Generative artwork, not scientific data" wherever it appears.
- Scientific visuals (maps, slope rasters, profiles, charts) are drawn only from NASA LOLA / Horizons / Moon Trek data.
- NASA SVS Moon Kit textures power the 3D Story.

## 7. Motion
Slow hero parallax (≤ 12 px), spacecraft entrance (600 ms ease-out), descent animation driven by simulation
outputs, stage transitions 280 ms. All disabled under `prefers-reduced-motion`.
