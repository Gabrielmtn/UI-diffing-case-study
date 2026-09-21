/*
 * jev.js — triage layer.
 *
 * The diff engine says *where* two renders disagree. It cannot say whether a
 * disagreement matters: a 14-degree hue shift on a CTA is a brand bug, the same
 * shift on a chart bar is Tuesday's data. That judgement is what Jev is for.
 *
 * Jev is TypeSafe's System One model — typed, calibrated decisions instead of
 * prose. Per region we ask three questions in the three primitives:
 *
 *   noul   -> is this a real regression a designer must act on?   (0..1)
 *   choice -> which category of regression is it?
 *   score  -> how severe, on an ordered scale?
 *
 * All regions ride in one request: TypeSafe bills per input token, so batching
 * sends the shared state once instead of once per question.
 *
 * Docs: https://docs.typesafe.ai/api  ·  POST https://api.typesafe.ai/v1/systemone
 */
(function (global) {
  'use strict';

  var DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
  var DEFAULT_MODEL = 'jev-latest';
  var USD_PER_INPUT_MTOK = 0.042;

  var CATEGORIES = {
    'color': 'A fill, text, border or background colour differs from the design. Brand token drift.',
    'spacing': 'Padding, margin, gap or alignment changed; the element kept its look but moved or resized.',
    'typography': 'Font size, weight, family, letter-spacing or line-height differs from the design.',
    'missing-element': 'Something specified in the mockup is absent from the live render.',
    'added-element': 'Something appears live that the mockup does not specify.',
    'content': 'The copy, label or wording differs, while styling is unchanged.',
    'dynamic-content': 'Expected variance, not drift: live data, counters, charts, timestamps, user avatars.',
    'rendering-noise': 'Anti-aliasing, sub-pixel text positioning, or compression artefacts. Not a real change.'
  };

  var SEVERITY = ['Cosmetic', 'Minor', 'Noticeable', 'Brand-breaking', 'Blocking'];

  /* ----------------------------------------------------------------- state */

  function round(n, d) {
    var f = Math.pow(10, d == null ? 3 : d);
    return Math.round(n * f) / f;
  }

  /**
   * Compact the engine's per-region metrics into the `state` Jev reasons over.
   * Every number is something a designer would recognise; raw pixel dumps would
   * cost tokens without adding signal.
   */
  function buildState(ctx, regions) {
    return {
      page: ctx.page,
      route: ctx.route,
      viewport: ctx.viewport + ' (' + ctx.width + 'x' + ctx.height + ')',
      mockup_source: ctx.mockupSource || 'design mockup export',
      live_source: ctx.liveSource || 'production capture',
      note: 'A deterministic pixel diff compared the mockup against the live capture. ' +
            'Each region below is a cluster of changed pixels. Metrics describe how the ' +
            'live render differs from the mockup inside that region.',
      metric_guide: {
        pct_of_viewport: 'region area as a fraction of the whole viewport',
        changed_pixel_density: 'fraction of the region whose pixels actually changed',
        luminance_shift: 'mean brightness change, -255..255, negative = live is darker',
        hue_shift_deg: 'dominant hue rotation in degrees, 0..180',
        chroma_shift: 'dominant colour saturation change, -1..1',
        ink_coverage: 'fraction of the region carrying non-background pixels; a drop toward 0 means an element vanished',
        edge_density: 'Sobel edge energy, 0..1; text and icons score high, flat fills low',
        best_translation: 'the rigid pixel offset that best realigns mockup to live, with the fraction of mismatch it removes (gain). High gain at a non-zero offset means the element simply moved.',
        antialias_pixels_in_region: 'pixels the engine already judged to be anti-aliasing rather than change'
      },
      regions: regions.map(function (r) {
        return {
          id: r.id,
          bbox: [r.box.x, r.box.y, r.box.w, r.box.h],
          pct_of_viewport: round(r.pctOfViewport * 100, 2) + '%',
          changed_pixel_density: round(r.density, 3),
          luminance_shift: round(r.luminanceShift, 1),
          hue_shift_deg: round(r.hueShiftDeg, 1),
          chroma_shift: round(r.chromaShift, 3),
          dominant_color_mockup: r.dominantMockup,
          dominant_color_live: r.dominantLive,
          ink_coverage_mockup: round(r.inkMockup, 3),
          ink_coverage_live: round(r.inkLive, 3),
          edge_density_mockup: round(r.edgeDensityMockup, 3),
          edge_density_live: round(r.edgeDensityLive, 3),
          best_translation: { dx: r.shift.dx, dy: r.shift.dy, gain: round(r.shift.gain, 3) },
          antialias_pixels_in_region: r.aaPixelsInRegion
        };
      })
    };
  }

  function buildQuestions(regions) {
    var q = {};
    regions.forEach(function (r) {
      q[r.id + '_real'] = {
        type: 'noul',
        instructions: 'Region ' + r.id + ': is this a genuine visual regression that a designer ' +
          'responsible for design-to-production parity must act on?',
        criteria: {
          'true': 'A real defect: the live render violates the design in a way a human would file as a bug.',
          'false': 'Not actionable: anti-aliasing or sub-pixel rendering noise, or expected variance such ' +
                   'as live data, timestamps, counters or user-specific content.'
        }
      };
      q[r.id + '_cat'] = {
        type: 'choice',
        instructions: 'Region ' + r.id + ': which single category best describes how the live render ' +
          'differs from the mockup here?',
        criteria: CATEGORIES
      };
      q[r.id + '_sev'] = {
        type: 'score',
        instructions: 'Region ' + r.id + ': how severe is this difference for a team that must keep ' +
          'production visually faithful to the design?',
        criteria: SEVERITY
      };
    });

    q.page_ship = {
      type: 'noul',
      instructions: 'Taking all regions together, can this build ship without a designer reviewing it first?',
      criteria: {
        'true': 'Nothing here breaks design intent; any differences are noise or expected variance.',
        'false': 'At least one difference meaningfully breaks the design and needs a human look.'
      }
    };
    return q;
  }

  /* ------------------------------------------------------------- transport */

  function callJev(state, questions, opts) {
    var endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    var body = {
      model: opts.model || DEFAULT_MODEL,
      state: state,
      questions: questions
    };

    var started = performance.now();
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + opts.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (raw) {
        if (!res.ok) {
          var detail = raw;
          try { detail = JSON.parse(raw).error && JSON.parse(raw).error.message || raw; } catch (e) {}
          var err = new Error('Jev returned HTTP ' + res.status + ': ' + String(detail).slice(0, 300));
          err.status = res.status;
          throw err;
        }
        var json;
        try { json = JSON.parse(raw); }
        catch (e) { throw new Error('Jev returned a non-JSON body: ' + raw.slice(0, 200)); }
        json._latencyMs = Math.round(performance.now() - started);
        return json;
      });
    }, function (netErr) {
      // A cross-origin block surfaces here as an opaque TypeError, so name the
      // likely cause rather than leaving the user with "Failed to fetch".
      var err = new Error(
        'Could not reach ' + endpoint + ' from the browser (' + netErr.message + '). ' +
        'If the endpoint does not send CORS headers, point "API endpoint" at a proxy you control — ' +
        'see the README — or switch the engine to Heuristic.');
      err.isNetwork = true;
      throw err;
    });
  }

  /* ------------------------------------------------------------- heuristic */

  /**
   * Offline stand-in used when no API key is set, so the page is demoable with
   * nothing configured. Same output shape as the Jev path, rule-based instead of
   * judged — it is deliberately blunt, which is the point of the comparison.
   */
  function heuristicTriage(regions) {
    return regions.map(function (r) {
      var cat, real = true, sev = 1, conf = 0.55;
      var aaShare = r.aaPixelsInRegion / Math.max(1, r.aaPixelsInRegion + r.changedPx);
      var moved = r.shift.gain > 0.45 && (Math.abs(r.shift.dx) > 0 || Math.abs(r.shift.dy) > 0);

      // Sub-pixel text rendering is the one thing that moves pixels while leaving
      // every structural metric flat: same ink, same brightness, same edge
      // energy, no translation. Anything else has a real cause.
      var flat = Math.abs(r.inkDelta) < 0.035 &&
                 Math.abs(r.luminanceShift) < 7 &&
                 Math.abs(r.edgeDensityLive - r.edgeDensityMockup) < 0.03 &&
                 !moved;

      if (aaShare > 0.3 && flat && r.density < 0.35) {
        cat = 'rendering-noise'; real = false; sev = 0; conf = 0.6;
      } else if (r.inkDelta < -0.06) {
        cat = 'missing-element'; sev = 3.4; conf = 0.7;
      } else if (r.inkDelta > 0.06) {
        cat = 'added-element'; sev = 2.4; conf = 0.6;
      } else if (moved) {
        cat = 'spacing'; sev = 2.1; conf = 0.65;
      } else if (r.hueShiftDeg > 5 || Math.abs(r.chromaShift) > 0.05) {
        cat = 'color'; sev = 2.6; conf = 0.68;
      } else if (Math.abs(r.edgeDensityLive - r.edgeDensityMockup) > 0.02) {
        cat = 'typography'; sev = 1.9; conf = 0.5;
      } else {
        cat = 'content'; sev = 1.8; conf = 0.45;
      }

      if (r.pctOfViewport > 0.05) sev = Math.min(4, sev + 0.5);

      return {
        id: r.id,
        region: r,
        isRegression: real,
        regressionProbability: real ? 0.72 : 0.18,
        category: cat,
        categoryConfidence: conf,
        categoryProbabilities: null,
        severityScore: sev,
        severityLabel: SEVERITY[Math.max(0, Math.min(SEVERITY.length - 1, Math.round(sev)))],
        severityConfidence: conf,
        engine: 'heuristic'
      };
    });
  }

  /* ------------------------------------------------------------------ main */

  function levelFromScore(score, levels) {
    var i = Math.round(score);
    return levels[Math.max(0, Math.min(levels.length - 1, i))];
  }

  /**
   * Triage `regions` for one scene/viewport.
   * opts: { apiKey, endpoint, model, threshold } — without apiKey, falls back to
   * the local heuristic. Resolves to { findings, engine, usage, latencyMs, ... }.
   */
  function triage(ctx, regions, opts) {
    opts = opts || {};

    if (!regions.length) {
      return Promise.resolve({
        findings: [], engine: opts.apiKey ? 'jev' : 'heuristic',
        shipProbability: 1, usage: null, latencyMs: 0, model: null
      });
    }

    if (!opts.apiKey) {
      var local = heuristicTriage(regions);
      var worst = local.filter(function (f) { return f.isRegression; }).length;
      return Promise.resolve({
        findings: local, engine: 'heuristic',
        shipProbability: worst ? 0.15 : 0.9,
        usage: null, latencyMs: 0, model: null
      });
    }

    var state = buildState(ctx, regions);
    var questions = buildQuestions(regions);
    var threshold = opts.threshold != null ? opts.threshold : 0.5;

    return callJev(state, questions, opts).then(function (res) {
      var answers = res.answers || {};

      var findings = regions.map(function (r) {
        var real = answers[r.id + '_real'] || {};
        var cat = answers[r.id + '_cat'] || {};
        var sev = answers[r.id + '_sev'] || {};
        var levels = sev.legend && sev.legend.length ? sev.legend : SEVERITY;
        var score = typeof sev.score === 'number' ? sev.score : 0;

        return {
          id: r.id,
          region: r,
          isRegression: (typeof real.noul === 'number' ? real.noul : 0) >= threshold,
          regressionProbability: typeof real.noul === 'number' ? real.noul : null,
          category: cat.choice || 'content',
          categoryConfidence: typeof cat.confidence === 'number' ? cat.confidence : null,
          categoryProbabilities: cat.probabilities || null,
          severityScore: score,
          severityLabel: levelFromScore(score, levels),
          severityConfidence: typeof sev.confidence === 'number' ? sev.confidence : null,
          engine: 'jev'
        };
      });

      var ship = answers.page_ship && typeof answers.page_ship.noul === 'number'
        ? answers.page_ship.noul : null;

      var usage = res.usage || null;
      return {
        findings: findings,
        engine: 'jev',
        shipProbability: ship,
        usage: usage,
        costUsd: usage && usage.input_tokens != null
          ? (usage.input_tokens / 1e6) * USD_PER_INPUT_MTOK : null,
        latencyMs: res._latencyMs,
        model: res.model || null,
        raw: res
      };
    });
  }

  /* ---------------------------------------------------------------- paths */

  /*
   * Journey triage runs as two chained batched calls, because the second
   * question genuinely depends on the answer to the first: you cannot judge
   * whether a step was progress without knowing what the user was trying to do.
   *
   *   call 1  per distinct path   -> intent (choice), success (noul), friction (score)
   *   call 2  per screen pair     -> progress (noul), affordance gap (choice)
   *           with call 1's intents folded into the state
   */

  function journeyState(agg, screens, extra) {
    var state = {
      product: 'A UI monitoring SaaS. Users create monitors on pages, compare them ' +
               'against baselines, and get alerted when production drifts from the design.',
      what_this_is: 'Aggregated product analytics. Sessions have been folded into distinct ' +
                    'paths; consecutive visits to one screen are collapsed into a single step.',
      screens: screens,
      total_sessions: agg.sessions,
      journeys: agg.signatures.map(function (sig) {
        return {
          id: sig.id,
          sessions: sig.count,
          path: sig.visits.map(function (v) {
            var bits = [v.screen];
            var acts = v.actions.filter(function (a) { return a !== 'view'; });
            if (acts.length) bits.push('(' + acts.join(',') + ')');
            if (v.labels.length) bits.push('"' + v.labels.join('", "') + '"');
            return bits.join(' ');
          }),
          // Counters are summed across every session on this path, so report them
          // per session -- otherwise a popular path looks pathological.
          backs_per_session: round(sig.backs / sig.count, 2),
          searches_per_session: round(sig.searches / sig.count, 2),
          rage_clicks_per_session: round(sig.rage / sig.count, 2),
          seconds_per_session: Math.round(sig.totalMs / sig.count / 1000),
          reached_a_completion_event: sig.converted,
          escalated_to_support: sig.escalated
        };
      })
    };
    if (extra) Object.keys(extra).forEach(function (k) { state[k] = extra[k]; });
    return state;
  }

  function journeyQuestions(agg, intents, friction) {
    var q = {};
    agg.signatures.forEach(function (sig) {
      q[sig.id + '_intent'] = {
        type: 'choice',
        instructions: 'Journey ' + sig.id + ': what were these users trying to accomplish?',
        criteria: intents
      };
      q[sig.id + '_success'] = {
        type: 'noul',
        instructions: 'Journey ' + sig.id + ': did these users accomplish what they came to do?',
        criteria: {
          'true': 'They reached the thing they were after, even if it took a detour.',
          'false': 'They gave up, escalated to support, or left without getting there.'
        }
      };
      q[sig.id + '_friction'] = {
        type: 'score',
        instructions: 'Journey ' + sig.id + ': how much friction did these users hit on the way? ' +
          'Judge the route, not the destination -- a journey can succeed and still be painful.',
        criteria: friction
      };
    });
    return q;
  }

  function transitionQuestions(agg, gaps) {
    var q = {};
    agg.transitions.forEach(function (t) {
      q[t.id + '_progress'] = {
        type: 'noul',
        instructions: 'Transition ' + t.id + ' (' + t.from + ' to ' + t.to + '): given what ' +
          'these users were trying to do, was this step deliberate progress toward their goal?',
        criteria: {
          'true': 'A direct, intended move: the user knew where they were going and the interface took them there.',
          'false': 'Recovery or hunting: backtracking, falling back to search or docs, retrying, or giving up.'
        }
      };
      q[t.id + '_gap'] = {
        type: 'choice',
        instructions: 'Transition ' + t.id + ' (' + t.from + ' to ' + t.to + '): if users struggled ' +
          'here, what is missing from the interface? Answer "none" when the route was direct ' +
          'and nothing needs fixing.',
        criteria: gaps
      };
    });
    return q;
  }

  function transitionPayload(agg, screens, intents) {
    return journeyState(agg, screens, {
      journey_intents: intents,
      note_on_transitions: 'Each transition below is one screen pair, aggregated across every ' +
        'journey it appears in. Use the journey intents above to judge what the user was after.',
      transitions: agg.transitions.map(function (t) {
        var queries = Object.keys(t.queries);
        return {
          id: t.id,
          from: t.from,
          to: t.to,
          sessions: t.value,
          arrived_after_pressing_back: t.viaBack,
          arrived_via_search: t.viaSearch,
          rage_clicks: t.rage,
          search_queries: queries.length ? queries : undefined,
          appears_at_step: Object.keys(t.steps).map(Number)
        };
      })
    });
  }

  /** Rule-based stand-in so the Paths view works with no key configured. */
  function heuristicJourneys(agg) {
    var signatures = {}, transitions = {};

    agg.signatures.forEach(function (sig) {
      var screens = sig.visits.map(function (v) { return v.screen; }).join(' ');
      // Order matters: a signup that came through pricing is still evaluation.
      var intent = /pricing/.test(screens) ? 'evaluate'
        : /billing/.test(screens) ? 'administer'
        : /alerts/.test(screens) ? 'diagnose'
        : /monitors\/new/.test(screens) ? 'onboard'
        : 'configure';

      var noise = (sig.backs + sig.searches + sig.rage * 1.5) / sig.count;
      var friction = Math.min(4, noise * 1.1 + (sig.escalated ? 2.2 : 0) + (sig.converted ? 0 : 1.2));

      signatures[sig.id] = {
        intent: intent,
        intentConfidence: 0.5,
        intentProbabilities: null,
        successProbability: sig.converted ? 0.88 : (sig.escalated ? 0.08 : 0.22),
        succeeded: sig.converted,
        frictionScore: friction,
        frictionLabel: null,
        frictionConfidence: 0.5
      };
    });

    agg.transitions.forEach(function (t) {
      var backShare = t.viaBack / Math.max(1, t.value);
      var searchShare = t.viaSearch / Math.max(1, t.value);
      var rageShare = t.rage / Math.max(1, t.value);
      // Reaching for a human is not progress toward the goal, however calmly the
      // user got there — it means the interface ran out of road.
      var escalation = t.to === '/support' ? 0.7 : 0;
      var progress = 1 - Math.min(0.92,
        backShare * 0.55 + searchShare * 0.6 + rageShare * 0.3 + escalation);

      // A step users sailed through has no gap, whatever route it was on.
      var gap = 'none';
      if (progress < 0.85) {
        if (rageShare > 0.5) gap = 'feedback';
        else if (t.to === '/support') gap = 'missing-capability';
        else if (searchShare > 0.5 && backShare > 0.2) gap = 'placement';
        else if (searchShare > 0.5) gap = 'discoverability';
        else if (backShare > 0.5) gap = 'labeling';
      }

      transitions[t.id] = {
        progressProbability: progress,
        gap: gap,
        gapConfidence: 0.5,
        gapProbabilities: null
      };
    });

    return {
      signatures: signatures, transitions: transitions,
      engine: 'heuristic', calls: 0, usage: null, latencyMs: 0, costUsd: null,
      model: null, raw: null
    };
  }

  /**
   * Triage a path graph. Resolves to { signatures, transitions, engine, usage, ... }
   * keyed by the ids `paths.js` assigned.
   */
  function triageJourneys(agg, taxonomy, opts) {
    opts = opts || {};
    if (!opts.apiKey || !agg.signatures.length) return Promise.resolve(heuristicJourneys(agg));

    var threshold = opts.threshold != null ? opts.threshold : 0.5;
    var payload1 = {
      model: opts.model || DEFAULT_MODEL,
      state: journeyState(agg, taxonomy.screens),
      questions: journeyQuestions(agg, taxonomy.intents, taxonomy.friction)
    };

    return callJev(payload1.state, payload1.questions, opts).then(function (res1) {
      var a1 = res1.answers || {};
      var signatures = {};
      var intents = {};

      agg.signatures.forEach(function (sig) {
        var intent = a1[sig.id + '_intent'] || {};
        var success = a1[sig.id + '_success'] || {};
        var fric = a1[sig.id + '_friction'] || {};
        var levels = fric.legend && fric.legend.length ? fric.legend : taxonomy.friction;
        var score = typeof fric.score === 'number' ? fric.score : 0;

        intents[sig.id] = intent.choice || 'configure';
        signatures[sig.id] = {
          intent: intent.choice || 'configure',
          intentConfidence: typeof intent.confidence === 'number' ? intent.confidence : null,
          intentProbabilities: intent.probabilities || null,
          successProbability: typeof success.noul === 'number' ? success.noul : null,
          succeeded: (typeof success.noul === 'number' ? success.noul : 0) >= threshold,
          frictionScore: score,
          frictionLabel: levels[Math.max(0, Math.min(levels.length - 1, Math.round(score)))],
          frictionConfidence: typeof fric.confidence === 'number' ? fric.confidence : null
        };
      });

      var state2 = transitionPayload(agg, taxonomy.screens, intents);
      var questions2 = transitionQuestions(agg, taxonomy.gaps);

      return callJev(state2, questions2, opts).then(function (res2) {
        var a2 = res2.answers || {};
        var transitions = {};

        agg.transitions.forEach(function (t) {
          var prog = a2[t.id + '_progress'] || {};
          var gap = a2[t.id + '_gap'] || {};
          transitions[t.id] = {
            progressProbability: typeof prog.noul === 'number' ? prog.noul : null,
            gap: gap.choice || 'none',
            gapConfidence: typeof gap.confidence === 'number' ? gap.confidence : null,
            gapProbabilities: gap.probabilities || null
          };
        });

        var inTok = ((res1.usage && res1.usage.input_tokens) || 0) +
                    ((res2.usage && res2.usage.input_tokens) || 0);
        return {
          signatures: signatures,
          transitions: transitions,
          engine: 'jev',
          calls: 2,
          questions: Object.keys(payload1.questions).length + Object.keys(questions2).length,
          usage: { input_tokens: inTok,
                   output_tokens: ((res1.usage && res1.usage.output_tokens) || 0) +
                                  ((res2.usage && res2.usage.output_tokens) || 0) },
          costUsd: (inTok / 1e6) * USD_PER_INPUT_MTOK,
          latencyMs: (res1._latencyMs || 0) + (res2._latencyMs || 0),
          model: res2.model || res1.model || null,
          payloads: [payload1, { model: payload1.model, state: state2, questions: questions2 }],
          raw: [res1, res2]
        };
      });
    });
  }

  /* ------------------------------------------------------------- criteria */

  /*
   * Accessibility audit.
   *
   * Three things make this an instrument rather than a vibe:
   *
   * 1. BLIND PAIRING. Both implementations ride one state under neutral slot
   *    names, and which slot holds the reference is randomised per run. If the
   *    state said "this one is the conformant reference", the model would agree
   *    with the label and manufacture exactly the delta we claim to measure.
   *
   * 2. PERMUTATIONS. A System One model reads a distribution off the option
   *    tokens in one forward pass, so the serialisation order of `criteria` can
   *    move the answer. Each reading is taken three ways — both orderings of the
   *    noul criteria, plus a polarity-flipped restatement where p(fail) should
   *    come back as 1 - p(pass). Spread across those is the instrument's
   *    instability, which is a different thing from the model being unsure, and
   *    the two get conflated constantly.
   *
   * 3. ONE CALL. Questions in a request are evaluated independently, so every
   *    permutation and both slots batch together with no cross-contamination,
   *    and the shared state is billed once.
   */

  var GENERIC_ALT = ['image', 'photo', 'graphic', 'picture', 'img', 'icon', 'spacer',
                     'logo', 'thumbnail', 'banner', 'button'];
  var GENERIC_LINK = ['read more', 'click here', 'learn more', 'more', 'here', 'link',
                      'details', 'see more', 'continue', 'go'];
  var GENERIC_HEADING = ['item', 'details', 'information', 'input', 'section', 'title',
                         'untitled', 'content', 'text', 'name', 'field',
                         'button', 'icon', 'link', 'element', 'control'];
  var GENERIC_ERROR = ['invalid input', 'error', 'invalid', 'try again', 'something went wrong',
                       'failed', 'incorrect'];

  function seededShuffle(arr, seed) {
    var a = arr.slice();
    var rand = function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function reorder(obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (k in obj) out[k] = obj[k]; });
    return out;
  }

  function auditState(slots, criteria) {
    var ref = {};
    Object.keys(criteria).forEach(function (id) {
      ref[id] = { name: criteria[id].name, level: criteria[id].level, requirement: criteria[id].text };
    });

    var impls = {};
    slots.forEach(function (slot) {
      impls[slot.id] = {
        note: 'One implementation of the component. Judge it on its own terms.',
        elements: slot.targets.map(function (t) {
          return { ref: t.key, criterion: t.sc, element: t.element, detail: t.subject };
        })
      };
    });

    return {
      // Word choice matters here: a single-pass model reads these tokens directly,
      // so "broken down" (meaning decomposed) sits too close to the judgement
      // being asked. "Separated into" carries no valence.
      what_this_is: 'Two independent implementations of the same user-interface component, ' +
        'each separated into the elements a WCAG success criterion applies to. They are ' +
        'presented in arbitrary order and neither is known to be conformant.',
      success_criteria: ref,
      note_on_scope: 'Mechanically decidable violations (a missing alt attribute, a control ' +
        'with no accessible name at all) have already been removed in code and are not below. ' +
        'Every element here needs a judgement that cannot be computed.',
      implementations: impls
    };
  }

  function auditQuestions(slots, criteria) {
    var q = {};
    slots.forEach(function (slot) {
      slot.targets.forEach(function (t) {
        var sc = criteria[t.sc];
        var base = 'Element ' + t.key + ' in implementation ' + slot.id +
                   ' (' + sc.id + ' ' + sc.name + '). ';

        // Reading 1 and 2: same question, both serialisations of the rubric.
        q[slot.id + '_' + t.key + '_p0'] = {
          type: 'noul',
          instructions: base + sc.ask.instructions,
          criteria: reorder(sc.ask.criteria, ['true', 'false'])
        };
        q[slot.id + '_' + t.key + '_p1'] = {
          type: 'noul',
          instructions: base + sc.ask.instructions,
          criteria: reorder(sc.ask.criteria, ['false', 'true'])
        };
        // Reading 3: polarity flipped. p(fail) should return as 1 - p(pass).
        q[slot.id + '_' + t.key + '_n0'] = {
          type: 'noul',
          instructions: base + 'Does this element FAIL the following requirement? ' +
            sc.ask.instructions,
          criteria: { 'true': sc.ask.criteria['false'], 'false': sc.ask.criteria['true'] }
        };

        // Which documented failure, asked over two shuffles of the taxonomy.
        var keys = Object.keys(sc.failures);
        [0, 1].forEach(function (k) {
          q[slot.id + '_' + t.key + '_f' + k] = {
            type: 'choice',
            instructions: base + 'If it does not meet the requirement, which documented ' +
              'failure mode is it? Answer "none" if it meets the requirement.',
            criteria: reorder(sc.failures, k === 0 ? keys : seededShuffle(keys, 7 + k * 31))
          };
        });
      });
    });
    return q;
  }

  function spreadOf(values) {
    var ok = values.filter(function (v) { return typeof v === 'number'; });
    if (!ok.length) return { mean: null, spread: null, n: 0 };
    var mean = ok.reduce(function (a, b) { return a + b; }, 0) / ok.length;
    return { mean: mean, spread: Math.max.apply(null, ok) - Math.min.apply(null, ok), n: ok.length };
  }

  /** Rule-based stand-in so Criteria works with no key configured. */
  function heuristicAudit(slots) {
    var readings = {};
    var hit = function (s, list) {
      s = String(s || '').toLowerCase().replace(/[.!]$/, '').trim();
      return list.indexOf(s) >= 0;
    };

    slots.forEach(function (slot) {
      slot.targets.forEach(function (t) {
        var d = t.subject, pass = true, failure = 'none';
        // `strength` is how clear-cut the rule match was: an exact hit on a known
        // generic string is near-certain, an inferred one much less so. Reporting
        // it is honest; inventing variance to make the bars look graded is not.
        var strength = 0.5;

        if (t.sc === '1.1.1') {
          if (hit(d.alt_text, GENERIC_ALT)) { pass = false; failure = 'F39'; strength = 0.95; }
          else if (d.filename && d.alt_text &&
                   d.filename.toLowerCase().indexOf(String(d.alt_text).toLowerCase()) >= 0) {
            pass = false; failure = 'F30'; strength = 0.8;
          } else { strength = 0.55; }
        } else if (t.sc === '2.4.4') {
          if (hit(d.link_text, GENERIC_LINK)) { pass = false; failure = 'generic'; strength = 0.9; }
          else { strength = 0.5; }
        } else if (t.sc === '2.4.6') {
          if (hit(d.text, GENERIC_HEADING)) { pass = false; failure = 'generic'; strength = 0.9; }
          else if (String(d.text || '').trim().length < 3) {
            pass = false; failure = 'generic'; strength = 0.7;
          } else { strength = 0.5; }
        } else if (t.sc === '3.3.2') {
          if (d.placeholder && !d.described_by_text &&
              (!d.accessible_name || d.accessible_name === d.placeholder)) {
            pass = false; failure = 'placeholder-only'; strength = 0.85;
          } else if (!d.described_by_text && /date|dob|phone|tel|postcode|zip/i.test(
                       String(d.accessible_name) + String(d.placeholder))) {
            pass = false; failure = 'format-unstated'; strength = 0.65;
          } else { strength = 0.55; }
        } else if (t.sc === '3.3.1') {
          if (hit(d.message_text, GENERIC_ERROR)) { pass = false; failure = 'generic'; strength = 0.9; }
          else { strength = 0.5; }
        } else if (t.sc === '2.5.3') {
          var v = String(d.visible_text || '').toLowerCase();
          var n = String(d.accessible_name || '').toLowerCase();
          if (v && n.indexOf(v) < 0) { pass = false; failure = 'replaced'; strength = 0.95; }
          else { strength = 0.9; }
        }

        var value = pass ? 0.5 + strength * 0.45 : 0.5 - strength * 0.45;
        readings[slot.id + '|' + t.key] = {
          pass: value,
          spread: null,          // no permutation was run; do not imply one was
          stable: true,
          untested: true,
          readings: [value],
          failure: failure,
          failureStable: true,
          failureConfidence: strength
        };
      });
    });

    return {
      readings: readings, engine: 'heuristic', usage: null,
      latencyMs: 0, costUsd: null, model: null, questions: 0, payload: null, raw: null
    };
  }

  /**
   * Audit a blind pair. `slots` is [{id, targets}] where targets carry
   * { key, sc, element, subject, ref_label(slotId) }.
   */
  function auditAccessibility(slots, criteria, opts) {
    opts = opts || {};
    var total = slots.reduce(function (n, s) { return n + s.targets.length; }, 0);
    if (!opts.apiKey || !total) return Promise.resolve(heuristicAudit(slots));

    var state = auditState(slots, criteria);
    var questions = auditQuestions(slots, criteria);
    var unstableAt = opts.unstableAt != null ? opts.unstableAt : 0.25;

    return callJev(state, questions, opts).then(function (res) {
      var a = res.answers || {};
      var readings = {};

      slots.forEach(function (slot) {
        slot.targets.forEach(function (t) {
          var id = slot.id + '_' + t.key;
          var p0 = a[id + '_p0'], p1 = a[id + '_p1'], n0 = a[id + '_n0'];
          var vals = [
            p0 && typeof p0.noul === 'number' ? p0.noul : null,
            p1 && typeof p1.noul === 'number' ? p1.noul : null,
            // The flipped reading is a pass-probability once inverted.
            n0 && typeof n0.noul === 'number' ? 1 - n0.noul : null
          ];
          var st = spreadOf(vals);

          var f0 = a[id + '_f0'] || {}, f1 = a[id + '_f1'] || {};
          var agreed = f0.choice && f1.choice && f0.choice === f1.choice;

          readings[slot.id + '|' + t.key] = {
            pass: st.mean,
            spread: st.spread,
            stable: st.spread != null && st.spread <= unstableAt,
            readings: vals,
            failure: f0.choice || f1.choice || 'none',
            failureAlt: f1.choice || null,
            failureStable: !!agreed,
            failureConfidence: typeof f0.confidence === 'number' ? f0.confidence : null,
            failureProbabilities: f0.probabilities || null
          };
        });
      });

      var usage = res.usage || null;
      return {
        readings: readings,
        engine: 'jev',
        questions: Object.keys(questions).length,
        usage: usage,
        costUsd: usage && usage.input_tokens != null
          ? (usage.input_tokens / 1e6) * USD_PER_INPUT_MTOK : null,
        latencyMs: res._latencyMs,
        model: res.model || null,
        payload: { model: opts.model || DEFAULT_MODEL, state: state, questions: questions },
        raw: res
      };
    });
  }

  global.Jev = {
    triage: triage,
    auditAccessibility: auditAccessibility,
    heuristicAudit: heuristicAudit,
    auditState: auditState,
    auditQuestions: auditQuestions,
    triageJourneys: triageJourneys,
    heuristicJourneys: heuristicJourneys,
    journeyState: journeyState,
    journeyQuestions: journeyQuestions,
    heuristicTriage: heuristicTriage,
    buildState: buildState,
    buildQuestions: buildQuestions,
    CATEGORIES: CATEGORIES,
    SEVERITY: SEVERITY,
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    DEFAULT_MODEL: DEFAULT_MODEL,
    USD_PER_INPUT_MTOK: USD_PER_INPUT_MTOK
  };
})(window);
