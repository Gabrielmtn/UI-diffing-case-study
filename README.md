# Parity — Jev for UX, a case study

A single static page holding two prototypes that put
[Jev](https://docs.typesafe.ai/introduction) — TypeSafe AI's System One model — to work on
problems UX designers actually own.

| | Prototype | Question it answers |
| --- | --- | --- |
| **Parity** | Visual diffing of mockups against live production renders | *Does production still look like the design?* |
| **Paths** | Journey and intent analysis over session streams | *Where does the interface fail what users came to do?* |
| **Criteria** | WCAG conformance diffing against a reference implementation | *Is it conformant, or does it just look it?* |

No build step, no dependencies, no server. Open `index.html`.

## Why Jev, in one paragraph

Jev's edge for UX work is not that it judges — it is that it judges **calibrated and cheap enough
to run on everything**. Traditional UX research gives deep qualitative insight at n=8; analytics
gives shallow counts at n=100k. Jev closes the gap: semantic judgement at n=100k, returning
numbers you can legitimately average because they are calibrated. Both prototypes exploit that
same property.

---

---

# Prototype 1 — Parity

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

# Prototype 2 — Paths

## The idea

Path analytics (Amplitude, Mixpanel) show you *what* sequence happened but never *whether it was
a good one* — a six-step journey looks identical to a six-step flail. Jev supplies the missing
judgement, and because it is calibrated it can be aggregated into a metric rather than read
anecdote by anecdote.

Sessions are folded into distinct paths, then judged in **two chained calls** — chained because
the second question genuinely depends on the first: you cannot tell whether a step was progress
without knowing what the user was trying to do.

```
sessions ─▶ fold to paths ─▶ Jev call 1 ─▶ Jev call 2 ─▶ ranked affordance gaps
                             intent        progress
                             success       gap type
                             friction      (intents folded into state)
```

| Call | Scope | Questions |
| --- | --- | --- |
| 1 | per distinct path | `choice` intent · `noul` did they succeed · `score` friction |
| 2 | per screen pair | `noul` was this deliberate progress · `choice` what affordance is missing |

A 120-session run folds to 5 paths and 16 transitions — 47 questions across 2 calls, roughly
**$0.0003**. The affordance gap ranking is then plain arithmetic on calibrated numbers:

```
impact = sessions on the step × struggle × friction of the journeys routed through it
         where struggle = 1 − p(intentional progress)
```

## What the views show

**Intent against outcome** — sessions by what Jev judged they came to do, against how far they
got. Mass off the leading diagonal is where the product fights its users.

**Path graph** — a Sankey whose nodes are *(screen, step)* pairs, the way real path analysers do
it, so a screen revisited at step 4 is its own node and backtracking reads as a return. Ribbon
**thickness is volume**; ribbon **colour is flow health**, which comes from Jev. Neither restates
the other.

**Affordance gaps, ranked** — what to fix first, with the evidence (search queries, back
presses, rage clicks) that justifies it.

## What's planted

Five journey archetypes through a fictional monitoring product, 120 sessions. Four carry a
planted gap; one is deliberately healthy, because a tool that cannot say *"this path is fine"* is
a complaint generator rather than an instrument.

| Journey | Planted | Truth |
| --- | --- | --- |
| Evaluate → convert | Nothing — the funnel works | **control, no gap** |
| Create first monitor | Overview has no primary "New monitor" action | discoverability |
| Find billing | Billing nested under Settings with no nav entry | placement |
| Why did this alert fire | Alerts never link to the baseline that failed | missing-capability |
| Export a report | Export is disabled with no explanation | feedback |

The **Ground truth** disclosure under the ranking lets you check the output against what was
actually broken.

## A note on colour

The encodings were chosen before any code was written and checked with a palette validator
rather than eyeballed:

- **Ribbons** — ordinal blue ramp on flow health (`#86b6ef → #184f95`), monotone lightness, single
  hue, light end clearing 2:1 on the surface. Quiet when smooth, heavy when stuck.
- **Matrix** — sequential blue on session count; the lightest step may recede toward the surface
  because every cell carries its count as text.
- **Gap ranking** — the reserved status palette, always with a text label beside the colour, so
  severity is never carried by hue alone.

---

# Prototype 3 — Criteria

## The idea

A System One model reads a probability off the option tokens in **one forward pass**. There is no
chain of thought, no intermediate reasoning, nothing generated. That single fact governs how you
use it:

> **Expertise cannot be summoned with a persona, because there is no reasoning trace for a persona
> to steer. It has to be encoded in the question set and in `criteria`.**

Which is how expert judgement gets operationalised for human raters too. You don't tell a junior
evaluator to "be an expert" — you hand them a behaviourally anchored rating scale. The expertise
lives in the instrument, not the rater.

WCAG is unusually good raw material for that instrument, because it ships **both halves of the
rubric**: the normative requirement *and* a catalogue of documented common failures (the F-codes).
The hard half of any rubric is describing what bad looks like, and a standards committee already
did it. The expertise here is **ported, not invented**.

## Two layers, and the line between them

| Layer | Decides | Examples |
| --- | --- | --- |
| **Mechanical** | in code, with certainty | missing `alt` attribute · control with no accessible name · accessible name that does not contain its visible text · heading level skips |
| **Semantic** | Jev | is the alt text a useful *equivalent*? does link text survive out of context? does this error say what to change? |

Mechanically decidable violations are **removed before anything is sent**. Trading a certainty for
a probability is a bad trade, and it is the most common way these tools get built wrong.

## Three things that make it an instrument

**1. Blind pairing.** Both implementations ride one state under neutral slot names `A` and `B`, and
which slot holds the reference is randomised per run. If the state said *"this one is the conformant
reference"*, the model would simply agree with the label and manufacture exactly the delta being
measured. The state says only that the two are *"presented in arbitrary order and neither is known
to be conformant."*

**2. Permutation testing.** The serialisation order of `criteria` can move a logit-read answer, so
every reading is taken three ways:

| Reading | What it varies |
| --- | --- |
| `_p0` | rubric serialised `{true, false}` |
| `_p1` | rubric serialised `{false, true}` |
| `_n0` | polarity flipped — asks "does it FAIL", and `1 − p` should come back |

Spread across those three is **the instrument's instability, which is a different thing from the
model being unsure** — and the two get conflated constantly. A flat distribution in one reading
means the artefact is ambiguous. An answer that moves across permutations means the measurement
is not trustworthy at all. The UI shows the spread beside every number, and a reading that
disagrees with itself by more than 0.25 is labelled *unmeasured*, not reported as a result.

**3. Deltas, never levels.** A single absolute reading from a model whose priors are not your users
is not evidence. A paired difference against a conformant reference is, because systematic bias
largely cancels. The UI is built around this: the absolute probability is small and grey, the
delta is large.

## What's planted

Three component pairs, each an accessible reference against a deliberately broken candidate:

| Specimen | Planted | Caught by |
| --- | --- | --- |
| **Product card** | `alt="image"`, heading "Item", link "Read more" | all three semantic |
| **Sign-up form** | placeholder-as-label, no date format stated, error reads "Invalid input" | all three semantic |
| **Search + toolbar** | visible "Search" / name "Submit", visible "Delete document" / name "Remove", unlabelled icon button, placeholder-only search field, button named "button" | four mechanical, one semantic |

The third specimen is the interesting one: **four of its five defects never reach the model at all**,
because they are decidable. That is the split working as intended.

## Known limits

- **State ordering is not permuted.** Criteria order is; the order of the two implementations within
  the state is not. That is a second position-bias axis, and it is untested here.
- **The rubric is unverified against source.** `w3.org` was unreachable from the build sandbox, so
  the criterion text and F-codes are reproduced from knowledge. Check them against
  [WCAG 2.2](https://www.w3.org/TR/WCAG22/) before relying on them.
- **The accessible-name computation is partial.** Enough for these criteria; not a full accname
  implementation, and it does not claim to be.
- **Conformance is not accessibility.** Passing every criterion here would not make a thing usable
  by disabled people. This finds a class of defect cheaply; it does not replace testing with users.

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

## What's in the Parity demo

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

### Diff your own (Parity)

Drop, paste or pick any two images — a Figma export and a screenshot of production — and the same
pipeline runs on them. If the two differ in size the live capture is rescaled to the mockup's
dimensions. Nothing is uploaded; the pixels never leave the browser. (Only the derived
*metrics* — a few dozen numbers per region — are sent, and only when a key is configured.)

---

## Layout

```
index.html              suite shell — both prototypes, one nav
assets/css/app.css      styles

                        — shared —
assets/js/jev.js        /v1/systemone client, prompt construction, heuristic fallbacks

                        — Parity —
assets/js/diff.js       perceptual delta, AA rejection, clustering, region metrics
assets/js/fixtures.js   procedural mockup/live renderers + planted ground truth
assets/js/app.js        test matrix, runs, comparison stage, findings inbox, settings

                        — Criteria —
assets/js/wcag.js       criterion rubrics + the mechanical layer that bypasses the model
assets/js/specimens.js  reference/candidate component pairs + planted ground truth
assets/js/criteria-ui.js delta-first UI with permutation spread surfaced per reading

                        — Paths —
assets/js/sessions.js   synthetic session streams + planted journey ground truth
assets/js/paths.js      path folding, (screen, step) graph, Sankey layout, gap ranking
assets/js/paths-ui.js   intent matrix, path graph, gap ranking, view switching
```

Plain classic scripts — no modules, no bundler — so the page also works straight off `file://`.

### Tuning

**Settings → Pixel engine** exposes the knobs that matter: colour threshold, minimum region
area, cluster merge distance, max regions per test, and whether to reject anti-aliased pixels.
Lower the threshold to catch subtler drift at the cost of more noise; raise the merge distance
to group a broken heading into one finding instead of fifty.

---

## Verified, and not

Tested end to end in headless Chromium.

**Parity** — the diff engine finds all six planted `/pricing` regressions as distinct regions and
correctly ignores the sub-pixel noise; all four view modes render; the batched request goes out
with bearer auth and 31 questions for a 10-region page; the typed response parses back into
verdicts, categories and severity labels; both failure paths (unreachable endpoint, HTTP error)
surface actionable messages.

**Criteria** — the mechanical layer catches all four decidable defects in the toolbar specimen and
excludes them from the payload; the semantic layer recovers the planted defects in all three
specimens; the state was grepped and carries no word identifying which slot is the reference; the
three readings combine correctly, with the polarity-flipped one inverted, and a self-contradicting
reading (`[0.15, 0.16, 0.62]`) is correctly reported as unstable rather than averaged into a
confident-looking 0.31.

**Paths** — 120 sessions fold to 5 paths and 16 transitions; all four planted affordance gaps are
recovered in the right categories and the healthy control reads as *Straight through*; the two
chained calls go out in order with call 1's intents folded into call 2's state (15 then 32
questions); cost and latency aggregate across both; the Sankey, intent matrix, legend and hover
tooltips all render without console errors.

**The one thing not verified against the real service is the live call itself** — `api.typesafe.ai`
is unreachable from the sandbox this was built in, so the network path was validated against a
mock that implements the documented request/response contract. The contract is implemented from
TypeSafe's published API reference. If the real endpoint disagrees, `assets/js/jev.js` is the only
file that needs to change.

---

## Licence

MIT. "Jev", "System One" and "TypeSafe AI" belong to TypeSafe AI.
