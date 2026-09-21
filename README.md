# Parity — a UI diffing case study

A single static page that diffs **design mockups against live production renders**, and uses
[Jev](https://docs.typesafe.ai/introduction) — TypeSafe AI's System One model — to decide which
of the differences a designer actually needs to act on.

Think Email on Acid, but for design-to-production parity: a matrix of pages × viewports, a
pass/fail badge per cell, and a triage inbox of findings underneath.

No build step, no dependencies, no server. Open `index.html`.

---

## The idea

Jev is **not** an image-diffing model. It is a decision model: unstructured or structured state
in, *typed probabilistic decisions* out. So it does not do the pixel work — and it shouldn't.
The split follows the architecture TypeSafe's own docs recommend, **observe → judge → act**:

```
 mockup ─┐
         ├─▶  pixel engine  ─▶  regions + metrics  ─▶  Jev  ─▶  typed verdicts  ─▶  inbox
 live  ──┘    (deterministic)     (JSON state)       (judge)
```

**The pixel engine finds where.** Perceptual YIQ delta per pixel, anti-aliasing rejection, then
connected-component clustering into regions. For each region it measures the things a designer
reasons about: hue rotation, luminance shift, ink coverage, edge density, and the rigid
translation that best realigns the two renders.

**Jev decides whether it matters.** That question is genuinely a judgement call — a 14° hue shift
on a CTA is a brand bug; the same shift on a chart bar is Tuesday's data. Each region gets three
questions, one in each of Jev's primitives:

| Primitive | Question | Returns |
| --- | --- | --- |
| `noul` | Is this a real regression a designer must act on? | probability 0–1 |
| `choice` | Which category — colour, spacing, typography, missing element, content, dynamic content, noise? | label + full distribution |
| `score` | How severe, from Cosmetic to Blocking? | position on the ordered scale |

Plus one page-level `noul`: *can this build ship without a designer looking at it?*

All of it goes in **one batched request**. TypeSafe bills per input token, so sending the shared
state once and attaching 3N+1 questions costs far less than N round trips. A 10-region page is
~3.2k input tokens — about **$0.00013** per full-page triage.

Because the answer shape is fixed by the request, the result is branchable with plain code:
`if (answers.R3_real.noul > 0.5)`. No parsing, no regex, no malformed-response risk.

---

## Running it

```bash
git clone https://github.com/Gabrielmtn/UI-diffing-case-study.git
cd UI-diffing-case-study
python3 -m http.server 8000     # or just open index.html directly
```

It also deploys as-is to GitHub Pages (Settings → Pages → deploy from branch).

Out of the box there is **no API key and nothing to configure** — triage falls back to a local
rule-based heuristic so the page is demoable immediately. Add a key in **Settings** to switch the
engine to Jev; the badge in the header tells you which one is running.

### Supplying the API key

The key lives only in your browser's `localStorage` and is sent only to the endpoint you
configure. Three ways in, in order of preference:

1. **Settings → TypeSafe API key** (typed in, stays local)
2. `?key=apikey_…` in the URL — read once, then scrubbed from the address bar and history
3. Leave it empty and run the heuristic

**No key is committed to this repository, and you shouldn't commit one either.** Anything a
static page can read, every visitor's devtools can read too — a key shipped in the bundle is a
public key, regardless of whether the repo is private. If you want a shared demo that "just
works" for other people, put a proxy in front of it (below) and keep the key server-side.

### If the browser can't reach the API

`POST https://api.typesafe.ai/v1/systemone` is called directly from the page. If TypeSafe does
not return CORS headers for browser origins, that call will fail — the page catches it and tells
you so rather than leaving you with "Failed to fetch". Point **Settings → API endpoint** at a
proxy you control:

```js
// Cloudflare Worker — keeps the key server-side and adds CORS.
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    const upstream = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.TYPESAFE_API_KEY}`,  // never leaves the worker
        'Content-Type': 'application/json'
      },
      body: await request.text()
    });
    return new Response(upstream.body, { status: upstream.status, headers: { ...CORS,
      'Content-Type': 'application/json' } });
  }
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
```

With a proxy like this the page can be left with an empty API key field — the proxy supplies it.

---

## What's in the demo

Both sides of every built-in test are **drawn in canvas at runtime** from a spec object, so there
are no binary fixtures in the repo and the ground truth is explicit. The "live" spec is the
mockup spec with a handful of deliberate mutations applied.

**`/pricing`** — six planted differences, one of which is deliberately *not* a regression:

| # | Planted | Truth |
| --- | --- | --- |
| 1 | Brand fill token drifted `#2563EB → #3D7BEA` (logo, nav CTA, Pro CTA) | colour |
| 2 | "MOST POPULAR" badge dropped from the Pro card | missing element |
| 3 | Scale card padding collapsed 28px → 20px | spacing |
| 4 | Pro price weight lightened 700 → 500 | typography |
| 5 | Starter CTA copy "Choose Starter" → "Select" | content |
| 6 | Sub-pixel text jitter across body copy | **noise — must be ignored** |

**`/app/overview`** — five more, again including a control:

| # | Planted | Truth |
| --- | --- | --- |
| 1 | Active-nav indicator bar removed | missing element |
| 2 | Status pill backgrounds lost in the table | colour |
| 3 | Avatar asset failed to load | missing element |
| 4 | Parity-score KPI colour drifted to brand blue | colour |
| 5 | Chart bars reflect newer data | **dynamic content — must be ignored** |

The findings panel has a **Ground truth** disclosure so you can check the engine's output against
what was actually broken. Item 6 and item 5 are the interesting ones: a diff tool that reports
them is a diff tool people stop reading.

### Diff your own

Drop, paste or pick any two images — a Figma export and a screenshot of production — and the same
pipeline runs on them. If the two differ in size the live capture is rescaled to the mockup's
dimensions. Nothing is uploaded; the pixels never leave the browser. (Only the derived
*metrics* — a few dozen numbers per region — are sent, and only when a key is configured.)

---

## Layout

```
index.html              page shell
assets/css/app.css      styles
assets/js/diff.js       perceptual delta, AA rejection, clustering, region metrics
assets/js/fixtures.js   procedural mockup/live renderers + planted ground truth
assets/js/jev.js        /v1/systemone client, prompt construction, heuristic fallback
assets/js/app.js        matrix, runs, comparison stage, findings inbox, settings
```

Plain classic scripts — no modules, no bundler — so the page also works straight off `file://`.

### Tuning

**Settings → Pixel engine** exposes the knobs that matter: colour threshold, minimum region
area, cluster merge distance, max regions per test, and whether to reject anti-aliased pixels.
Lower the threshold to catch subtler drift at the cost of more noise; raise the merge distance
to group a broken heading into one finding instead of fifty.

---

## Verified, and not

Tested end to end in headless Chromium: the diff engine finds all six planted `/pricing`
regressions as distinct regions and correctly ignores the sub-pixel noise; all four view modes
render; the batched request goes out with bearer auth and 31 questions for a 10-region page; the
typed response parses back into verdicts, categories and severity labels; and both failure paths
(unreachable endpoint, HTTP error) surface actionable messages.

**The one thing not verified against the real service is the live call itself** — `api.typesafe.ai`
is unreachable from the sandbox this was built in, so the network path was validated against a
mock that implements the documented request/response contract. The contract is implemented from
TypeSafe's published API reference. If the real endpoint disagrees, `assets/js/jev.js` is the only
file that needs to change.

---

## Licence

MIT. "Jev", "System One" and "TypeSafe AI" belong to TypeSafe AI.
