/*
 * paths-ui.js — the Paths view, plus the suite's view switching.
 *
 * Encoding, decided before any code was written and validated with the data-viz
 * palette checker rather than eyeballed:
 *   ribbons  ordinal blue ramp on flow health (quiet when smooth, heavy when stuck)
 *   matrix   sequential blue on session count
 *   gap list status palette, always with a text label beside the colour
 * Volume is thickness; health is colour. Neither restates the other.
 */
(function (global) {
  'use strict';

  // Ordinal ramp: monotone lightness, single hue, light end clears 2:1 on white.
  var FLOW = [
    { max: 0.25, color: '#86b6ef', label: 'Direct' },
    { max: 0.50, color: '#5598e7', label: 'Minor detour' },
    { max: 0.75, color: '#2a78d6', label: 'Hunting' },
    { max: 1.01, color: '#184f95', label: 'Stuck' }
  ];
  // Sequential ramp for the matrix; the lightest step may recede toward the surface
  // because every cell carries its count as text.
  var SEQ = ['#eaf2fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
  var STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

  var OUTCOMES = ['Straight through', 'Minor detour', 'Repeated attempts', 'Stuck', 'Abandoned'];

  var state = { agg: null, verdicts: null, ranked: null, running: false, ready: false };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function flowOf(struggle) {
    for (var i = 0; i < FLOW.length; i++) if (struggle < FLOW[i].max) return FLOW[i];
    return FLOW[FLOW.length - 1];
  }

  function seqOf(ratio) {
    return SEQ[Math.max(0, Math.min(SEQ.length - 1, Math.round(ratio * (SEQ.length - 1))))];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ------------------------------------------------------------------ run */

  function run() {
    if (state.running) return Promise.resolve();
    state.running = true;
    var btn = $('#runPathsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Analysing…'; }

    var settings = global.ParityApp ? global.ParityApp.settings() : {};
    var sessions = Sessions.generate();
    var agg = Paths.aggregate(sessions);

    var taxonomy = {
      screens: Sessions.SCREENS,
      intents: Sessions.INTENTS,
      gaps: Sessions.GAPS,
      friction: Sessions.FRICTION
    };

    return Jev.triageJourneys(agg, taxonomy, {
      apiKey: settings.apiKey,
      endpoint: settings.endpoint,
      model: settings.model,
      threshold: settings.jevThreshold
    }).then(function (verdicts) {
      state.agg = agg;
      state.verdicts = verdicts;
      state.ranked = Paths.rankGaps(agg, verdicts);
      state.ready = true;
      render();
    }).catch(function (err) {
      if (global.ParityApp) global.ParityApp.toast(err.message, true);
      // Fall back so the view is never left blank after a failed call.
      var v = Jev.heuristicJourneys(agg);
      state.agg = agg; state.verdicts = v;
      state.ranked = Paths.rankGaps(agg, v); state.ready = true;
      render();
    }).then(function () {
      state.running = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Re-run analysis'; }
    });
  }

  function render() {
    renderSummary();
    renderMatrix();
    renderSankey();
    renderGaps();
    renderTruth();
    renderPayload();
  }

  /* -------------------------------------------------------------- summary */

  function renderSummary() {
    var v = state.verdicts, agg = state.agg;
    var actionable = state.ranked.length;
    var costly = Paths.sessionsAffected(agg, state.ranked);

    var stats = [
      ['Sessions', agg.sessions],
      ['Distinct paths', agg.signatures.length],
      ['Steps judged', agg.transitions.length],
      ['Gaps found', actionable],
      ['Sessions affected', costly]
    ];
    var html = stats.map(function (s) {
      return '<div class="stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>';
    }).join('');

    if (v.engine === 'jev') {
      html += '<div class="stat"><b>' + v.latencyMs + 'ms</b><span>' +
              v.calls + ' calls · ' + (v.model || 'jev') + '</span></div>';
      if (v.costUsd != null) {
        html += '<div class="stat"><b>$' + v.costUsd.toFixed(5) + '</b><span>' +
                v.questions + ' questions</span></div>';
      }
    } else {
      html += '<div class="stat"><b>Heuristic</b><span>no api key</span></div>';
    }
    $('#pathSummary').innerHTML = html;
  }

  /* --------------------------------------------------------------- matrix */

  function renderMatrix() {
    var m = Paths.intentMatrix(state.agg, state.verdicts, OUTCOMES);
    var intents = Object.keys(Sessions.INTENTS).filter(function (i) { return m.rowTotals[i]; });

    var head = '<thead><tr><th class="page-col">Intent</th>' +
      OUTCOMES.map(function (o) { return '<th>' + o + '</th>'; }).join('') +
      '<th class="total">All</th></tr></thead>';

    var rows = intents.map(function (intent) {
      var cells = OUTCOMES.map(function (o) {
        var n = m.cells[intent + '|' + o] || 0;
        var ratio = m.max ? n / m.max : 0;
        var dark = ratio > 0.55;
        return '<td class="icell" style="background:' + (n ? seqOf(ratio) : 'transparent') +
               ';color:' + (n ? (dark ? '#ffffff' : '#0b0b0b') : '#c3c2b7') + '">' + n + '</td>';
      }).join('');
      return '<tr><td class="page-col"><span class="intent-name">' + esc(intent) + '</span>' +
             '<span class="intent-desc">' + esc(Sessions.INTENT_LABELS[intent] || '') +
             '</span></td>' + cells + '<td class="total">' + m.rowTotals[intent] + '</td></tr>';
    }).join('');

    $('#intentMatrix').innerHTML = head + '<tbody>' + rows + '</tbody>';
  }

  /* --------------------------------------------------------------- sankey */

  function renderSankey() {
    var agg = state.agg, verdicts = state.verdicts;
    var wrap = $('.sankey-scroll');
    var W = Math.max(720, wrap.clientWidth - 24);
    var labelPad = 116;
    var innerW = W - labelPad;
    var H = 30 + agg.signatures.length * 14 + 300;
    H = Math.max(360, Math.min(640, H));

    var lay = Paths.layout(agg, { width: innerW, height: H, nodeWidth: 12, nodePad: 15 });

    // Attach each ribbon's verdict — colour comes from judgement, not volume.
    var byTrans = {};
    agg.transitions.forEach(function (t) { byTrans[t.key] = t; });
    agg.links.forEach(function (l) {
      var t = byTrans[Paths.transitionKey(l.from, l.to)];
      var v = t && verdicts.transitions[t.id];
      l.progress = v && v.progressProbability != null ? v.progressProbability : 0.5;
      l.struggle = 1 - l.progress;
      l.gap = v ? v.gap : 'none';
      l.transId = t ? t.id : null;
    });

    var svg = $('#sankey');
    svg.setAttribute('viewBox', '0 0 ' + (W + 8) + ' ' + (H + 34));
    svg.setAttribute('width', W + 8);
    svg.setAttribute('height', H + 34);

    var parts = [];

    // Column headers.
    lay.columns.forEach(function (col, ci) {
      if (!col.length) return;
      parts.push('<text class="sk-col" x="' + (col[0].x + 6) + '" y="12">Step ' + (ci + 1) + '</text>');
    });

    var g = '<g transform="translate(0,26)">';

    // Ribbons under nodes so node bars read as anchors.
    agg.links.forEach(function (l) {
      if (!l.path) return;
      var f = flowOf(l.struggle);
      g += '<path class="sk-link" d="' + l.path + '" fill="' + f.color + '" fill-opacity="0.55" ' +
           'data-from="' + esc(l.from) + '" data-to="' + esc(l.to) + '" ' +
           'data-n="' + l.value + '" data-p="' + l.progress.toFixed(2) + '" ' +
           'data-gap="' + esc(l.gap) + '" data-tier="' + esc(f.label) + '"></path>';
    });

    // Nodes and their labels.
    lay.columns.forEach(function (col, ci) {
      var last = ci === lay.columns.length - 1;
      col.forEach(function (n) {
        g += '<rect class="sk-node" x="' + n.x + '" y="' + n.y + '" width="' + n.w +
             '" height="' + n.h + '" rx="2"></rect>';
        var tx = last ? n.x - 8 : n.x + n.w + 8;
        var anchor = last ? 'end' : 'start';
        var label = Sessions.label(n.screen);
        g += '<text class="sk-label" x="' + tx + '" y="' + (n.y + n.h / 2 + 1) +
             '" text-anchor="' + anchor + '">' + esc(label) +
             '<tspan class="sk-count" dx="5">' + n.value + '</tspan></text>';
      });
    });

    svg.innerHTML = parts.join('') + g + '</g>';

    // Legend — identity is never colour alone.
    $('#flowLegend').innerHTML = FLOW.map(function (f) {
      return '<span class="flow-key"><i style="background:' + f.color + '"></i>' + f.label + '</span>';
    }).join('');

    var widest = lay.columns.length;
    $('#sankeyNote').textContent =
      agg.sessions + ' sessions folded into ' + agg.signatures.length + ' distinct paths across ' +
      widest + ' steps. A screen revisited later is its own node, so backtracking shows as a return.';

    wireTips(svg);
  }

  function wireTips(svg) {
    var tip = $('#sankeyTip');
    var wrap = $('.sankey-wrap');

    $$('#sankey .sk-link').forEach(function (el) {
      var place = function (e) {
        var r = wrap.getBoundingClientRect();
        var x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
        tip.style.left = Math.max(0, Math.min(x, r.width - tip.offsetWidth - 8)) + 'px';
        tip.style.top = Math.max(0, Math.min(y, r.height - tip.offsetHeight - 8)) + 'px';
      };

      el.addEventListener('mouseenter', function (e) {
        // Ribbons overlap mid-graph; raise the hovered one so it is fully hittable
        // and fully visible rather than half-buried under its neighbours.
        el.parentNode.insertBefore(el, el.parentNode.querySelector('.sk-node'));
        el.setAttribute('fill-opacity', '0.85');
        var gap = el.dataset.gap;
        tip.innerHTML =
          '<b>' + esc(Sessions.label(el.dataset.from)) + ' &rarr; ' +
          esc(Sessions.label(el.dataset.to)) + '</b>' +
          '<span>' + el.dataset.n + ' sessions · ' + esc(el.dataset.tier) + '</span>' +
          '<span>p(progress) ' + el.dataset.p + '</span>' +
          (gap && gap !== 'none' ? '<span class="tip-gap">gap: ' + esc(gap) + '</span>' : '');
        tip.hidden = false;
        if (e && e.clientX != null) place(e);
      });
      el.addEventListener('mousemove', place);
      el.addEventListener('mouseleave', function () {
        el.setAttribute('fill-opacity', '0.55');
        tip.hidden = true;
      });
    });
  }

  /* ----------------------------------------------------------------- gaps */

  function severityOf(r, max) {
    var share = max ? r.impact / max : 0;
    if (share > 0.72) return { key: 'critical', label: 'Critical' };
    if (share > 0.45) return { key: 'serious', label: 'Serious' };
    if (share > 0.2) return { key: 'warning', label: 'Moderate' };
    return { key: 'good', label: 'Minor' };
  }

  var FIXES = {
    'discoverability': 'Surface the control where the journey starts, as a primary action.',
    'labeling': 'Rename the control to the words users search for.',
    'placement': 'Promote the destination to its own navigation entry.',
    'feedback': 'Make the control explain its own state instead of silently refusing.',
    'missing-capability': 'Add the route: link directly from here to where users are heading.'
  };

  function renderGaps() {
    var list = $('#gapList');
    var max = state.ranked.length ? state.ranked[0].impact : 0;

    if (!state.ranked.length) {
      list.innerHTML = '<li class="empty">No affordance gaps found — every judged step was direct.</li>';
      return;
    }

    list.innerHTML = state.ranked.map(function (r) {
      var sev = severityOf(r, max);
      var t = r.transition;
      var queries = Object.keys(t.queries);
      var evidence = [];
      if (t.viaSearch) evidence.push(t.viaSearch + ' arrived via search');
      if (t.viaBack) evidence.push(t.viaBack + ' after pressing back');
      if (t.rage) evidence.push(t.rage + ' rage clicks');
      if (queries.length) evidence.push('searched ' + queries.map(function (q) {
        return '“' + esc(q) + '”';
      }).join(', '));

      return '<li class="gap">' +
        '<div class="gap-rank"><span class="sev-dot" style="background:' + STATUS[sev.key] + '"></span>' +
          '<span class="sev-label">' + sev.label + '</span></div>' +
        '<div class="gap-main">' +
          '<div class="gap-top">' +
            '<span class="gap-kind">' + esc(r.gap) + '</span>' +
            '<span class="gap-route">' + esc(Sessions.label(t.from)) + ' <i>&rarr;</i> ' +
              esc(Sessions.label(t.to)) + '</span>' +
          '</div>' +
          '<div class="gap-fix">' + esc(FIXES[r.gap] || '') + '</div>' +
          (evidence.length ? '<div class="gap-eviden">' + evidence.join(' · ') + '</div>' : '') +
          '<div class="prob"><div class="prob-track"><div class="prob-fill" style="width:' +
            Math.round(r.struggle * 100) + '%"></div></div>' +
            '<span class="prob-val">struggle ' + r.struggle.toFixed(2) + '</span></div>' +
        '</div>' +
        '<div class="gap-impact"><b>' + r.sessions + '</b><span>sessions</span></div>' +
      '</li>';
    }).join('');
  }

  function renderTruth() {
    $('#pathTruthList').innerHTML = Sessions.plantedGaps().map(function (p) {
      return '<li>' + esc(p.note) + ' <span class="tag">[' + p.intent + ' · ' + p.gap +
             ' · ' + p.sessions + ' sessions]</span></li>';
    }).join('');
  }

  function renderPayload() {
    var v = state.verdicts;
    if (v.payloads) {
      $('#pathReq1').textContent = JSON.stringify(v.payloads[0], null, 2);
      $('#pathReq2').textContent = JSON.stringify(v.payloads[1], null, 2);
      return;
    }
    var settings = global.ParityApp ? global.ParityApp.settings() : {};
    var taxonomy = {
      screens: Sessions.SCREENS, intents: Sessions.INTENTS,
      gaps: Sessions.GAPS, friction: Sessions.FRICTION
    };
    $('#pathReq1').textContent =
      '// No API key set — verdicts below came from the local heuristic.\n' +
      '// With a key, call 1 sends:\n\n' +
      JSON.stringify({
        model: settings.model || Jev.DEFAULT_MODEL,
        state: Jev.journeyState(state.agg, taxonomy.screens),
        questions: Jev.journeyQuestions(state.agg, taxonomy.intents, taxonomy.friction)
      }, null, 2);
    $('#pathReq2').textContent =
      '// Call 2 folds call 1\'s intents into its state, then asks per transition:\n' +
      '//   <id>_progress  noul    was this deliberate progress?\n' +
      '//   <id>_gap       choice  what is missing from the interface?\n' +
      '// Run with a key to see the exact payload.';
  }

  /* ------------------------------------------------------- view switching */

  function show(view) {
    $$('.suite-tab').forEach(function (b) {
      var on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#view-parity').hidden = view !== 'parity';
    $('#view-paths').hidden = view !== 'paths';
    $('#runAllBtn').hidden = view !== 'parity';
    $('#runPathsBtn').hidden = view !== 'paths';

    if (view === 'paths') {
      if (!state.ready && !state.running) run();
      else if (state.ready) renderSankey();   // width may have changed while hidden
    }
  }

  function init() {
    $$('.suite-tab').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.view); });
    });
    $('#runPathsBtn').addEventListener('click', function () {
      state.ready = false;
      run();
    });

    if (global.ParityApp) {
      global.ParityApp.onSettingsSaved(function () {
        // Verdicts belong to the engine that produced them.
        state.ready = false;
        state.agg = null;
        if (!$('#view-paths').hidden) run();
      });
    }

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if ($('#view-paths').hidden || !state.ready) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderSankey, 180);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.PathsView = { run: run, show: show, state: state };
})(window);
