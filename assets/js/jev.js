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

  global.Jev = {
    triage: triage,
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
