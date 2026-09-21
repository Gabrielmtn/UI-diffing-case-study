/*
 * criteria-ui.js — the Criteria view.
 *
 * Delta-first by construction: the absolute pass-probability is shown small and
 * grey, the difference against the reference is shown large. Permutation spread
 * sits beside every reading rather than in a footnote, because a shaky
 * measurement that looks confident is worse than no measurement.
 */
(function (global) {
  'use strict';

  var UNSTABLE_AT = 0.25;      // spread across the three readings
  var MATERIAL_AT = 0.20;      // |delta| worth surfacing

  var state = {
    specimenId: 'product-card',
    running: false, ready: false,
    refSlot: null, candSlot: null,
    targets: null, mech: null, result: null
  };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** The one string from a target's subject that a reader needs to see. */
  function describe(t) {
    var d = t.subject || {};
    var v = d.alt_text || d.link_text || d.text || d.message_text ||
            d.accessible_name || d.placeholder;
    if (!v && d.on_a_field) v = d.field_name;
    return v ? '“' + v + '”' : '(no text)';
  }

  /* ------------------------------------------------------------------ run */

  function run() {
    if (state.running) return Promise.resolve();
    state.running = true;
    var btn = $('#runCriteriaBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Auditing…'; }

    var spec = Specimens.byId(state.specimenId);
    var settings = global.ParityApp ? global.ParityApp.settings() : {};

    var refDoc = WCAG.parse(spec.reference);
    var candDoc = WCAG.parse(spec.candidate);
    var mechRef = WCAG.mechanicalChecks(refDoc);
    var mechCand = WCAG.mechanicalChecks(candDoc);
    var tRef = WCAG.targets(refDoc, mechRef);
    var tCand = WCAG.targets(candDoc, mechCand);

    // Blind the pair: the model must not be told which one is the reference,
    // or it will agree with the label and manufacture the delta we are measuring.
    var refFirst = Math.random() < 0.5;
    state.refSlot = refFirst ? 'A' : 'B';
    state.candSlot = refFirst ? 'B' : 'A';
    state.targets = { ref: tRef, cand: tCand };
    state.mech = { ref: mechRef, cand: mechCand };

    var slots = [
      { id: state.refSlot, targets: tRef },
      { id: state.candSlot, targets: tCand }
    ].sort(function (a, b) { return a.id < b.id ? -1 : 1; });

    return Jev.auditAccessibility(slots, WCAG.CRITERIA, {
      apiKey: settings.apiKey,
      endpoint: settings.endpoint,
      model: settings.model,
      unstableAt: UNSTABLE_AT
    }).then(function (result) {
      state.result = result;
      state.ready = true;
      render();
    }).catch(function (err) {
      if (global.ParityApp) global.ParityApp.toast(err.message, true);
      state.result = Jev.heuristicAudit(slots);
      state.ready = true;
      render();
    }).then(function () {
      state.running = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Re-run audit'; }
    });
  }

  /* --------------------------------------------------------------- render */

  function rows() {
    var r = state.result.readings;
    var byKey = {};
    state.targets.ref.forEach(function (t) {
      (byKey[t.key] || (byKey[t.key] = {})).ref = t;
    });
    state.targets.cand.forEach(function (t) {
      (byKey[t.key] || (byKey[t.key] = {})).cand = t;
    });

    return Object.keys(byKey).map(function (key) {
      var pair = byKey[key];
      var rr = r[state.refSlot + '|' + key];
      var rc = r[state.candSlot + '|' + key];
      var sc = (pair.ref || pair.cand).sc;
      var delta = (rr && rc && rr.pass != null && rc.pass != null) ? rr.pass - rc.pass : null;
      return {
        key: key, sc: sc,
        ref: pair.ref, cand: pair.cand,
        readRef: rr, readCand: rc,
        delta: delta,
        unstable: (rr && !rr.stable) || (rc && !rc.stable),
        material: delta != null && Math.abs(delta) >= MATERIAL_AT
      };
    }).sort(function (a, b) {
      return Math.abs(b.delta || 0) - Math.abs(a.delta || 0);
    });
  }

  function render() {
    var spec = Specimens.byId(state.specimenId);
    $('#specimenBlurb').textContent = spec.blurb;
    $('#frameRef').srcdoc = Specimens.previewDoc(spec.reference);
    $('#frameCand').srcdoc = Specimens.previewDoc(spec.candidate);
    $('#slotRef').textContent = 'sent as slot ' + state.refSlot;
    $('#slotCand').textContent = 'sent as slot ' + state.candSlot;

    var rs = rows();
    renderSummary(rs);
    renderDeltas(rs);
    renderMechanical();
    renderTruth(spec);
    renderPayload();
  }

  function renderSummary(rs) {
    var res = state.result;
    var judged = state.targets.ref.length + state.targets.cand.length;
    var scs = {};
    rs.forEach(function (r) { scs[r.sc] = true; });
    var tested = rs.filter(function (r) {
      return (r.readRef && r.readRef.spread != null) || (r.readCand && r.readCand.spread != null);
    }).length;
    var unstable = rs.filter(function (r) { return r.unstable; }).length;
    var material = rs.filter(function (r) { return r.material; }).length;
    var mech = state.mech.ref.length + state.mech.cand.length;

    var stats = [
      ['Elements judged', judged],
      ['Criteria applied', Object.keys(scs).length],
      ['Material deltas', material],
      ['Unstable readings', tested ? unstable : 'n/a'],
      ['Settled in code', mech]
    ];
    var html = stats.map(function (s) {
      var cls = s[0] === 'Unstable readings' && s[1] && s[1] !== 'n/a' ? ' class="warn"' : '';
      return '<div class="stat"><b' + cls + '>' + s[1] + '</b><span>' + s[0] + '</span></div>';
    }).join('');

    if (res.engine === 'jev') {
      html += '<div class="stat"><b>' + res.latencyMs + 'ms</b><span>1 call · ' +
              (res.model || 'jev') + '</span></div>';
      if (res.costUsd != null) {
        html += '<div class="stat"><b>$' + res.costUsd.toFixed(5) + '</b><span>' +
                res.questions + ' questions</span></div>';
      }
    } else {
      html += '<div class="stat"><b>Heuristic</b><span>no api key</span></div>';
    }
    $('#criteriaSummary').innerHTML = html;
  }

  function bar(reading) {
    if (!reading || reading.pass == null) {
      return '<span class="absent">not present</span>';
    }
    var pct = Math.round(reading.pass * 100);
    var tone = reading.pass >= 0.6 ? 'ok' : (reading.pass >= 0.35 ? 'mid' : 'bad');
    var spread = reading.spread == null
      ? '<span class="spread untested" title="No permutation test was run">not tested</span>'
      : '<span class="spread' + (reading.stable ? '' : ' unstable') + '">±' +
        reading.spread.toFixed(2) + '</span>';
    return '<span class="mini"><span class="mini-track"><span class="mini-fill ' + tone +
           '" style="width:' + pct + '%"></span></span>' +
           '<span class="mini-val">' + reading.pass.toFixed(2) + '</span>' + spread + '</span>';
  }

  function renderDeltas(rs) {
    var showAll = $('#showStable').checked;
    var list = $('#deltaList');
    var shown = rs.filter(function (r) { return showAll || r.material || r.unstable; });

    if (!shown.length) {
      list.innerHTML = '<li class="empty">No material differences between the two implementations.</li>';
      return;
    }

    list.innerHTML = shown.map(function (r) {
      var sc = WCAG.CRITERIA[r.sc];
      var t = r.cand || r.ref;
      var d = r.delta;
      var dirClass = d == null ? 'none' : (d > 0 ? 'worse' : (d < 0 ? 'better' : 'same'));
      var dText = d == null ? '—' : (d > 0 ? '−' : '+') + Math.abs(d).toFixed(2);
      var fail = r.readCand && r.readCand.failure && r.readCand.failure !== 'none'
        ? r.readCand.failure : null;

      return '<li class="delta' + (r.unstable ? ' is-unstable' : '') + '">' +
        '<div class="delta-sc">' +
          '<span class="sc-badge">' + esc(sc.id) + '</span>' +
          '<span class="sc-level">' + esc(sc.level) + '</span>' +
        '</div>' +
        '<div class="delta-main">' +
          '<div class="delta-top">' +
            '<span class="sc-name">' + esc(sc.name) + '</span>' +
            '<span class="delta-el">&lt;' + esc(t.element) + '&gt; ' + esc(describe(t)) + '</span>' +
          '</div>' +
          '<div class="delta-rows">' +
            '<span class="dr-label">reference</span>' + bar(r.readRef) +
            '<span class="dr-label">candidate</span>' + bar(r.readCand) +
          '</div>' +
          (fail ? '<div class="delta-fail">documented failure: <code>' + esc(fail) + '</code>' +
            (r.readCand.failureStable ? '' :
              ' <span class="unstable-tag">choice moved across permutations</span>') + '</div>' : '') +
          (r.unstable ? '<div class="delta-warn">Readings disagreed by more than ' +
            UNSTABLE_AT.toFixed(2) + ' across permutations — treat this as unmeasured, ' +
            'not as a result.</div>' : '') +
        '</div>' +
        '<div class="delta-num ' + dirClass + '"><b>' + dText + '</b><span>candidate</span></div>' +
      '</li>';
    }).join('');
  }

  function renderMechanical() {
    var all = state.mech.ref.map(function (m) { return { side: 'reference', m: m }; })
      .concat(state.mech.cand.map(function (m) { return { side: 'candidate', m: m }; }));

    if (!all.length) {
      $('#mechList').innerHTML =
        '<li class="empty">No mechanically decidable violations in either implementation.</li>';
      return;
    }
    $('#mechList').innerHTML = all.map(function (row) {
      return '<li class="mech-row">' +
        '<span class="sc-badge">' + esc(row.m.sc) + '</span>' +
        '<div class="mech-main">' +
          '<div class="mech-what">' + esc(row.m.what) +
            ' <span class="mech-side">' + row.side + '</span></div>' +
          '<div class="mech-detail">' + esc(row.m.detail) + '</div>' +
          '<code class="mech-snip">' + esc(row.m.snippet) + '</code>' +
        '</div></li>';
    }).join('');
  }

  function renderTruth(spec) {
    $('#critTruthList').innerHTML = spec.planted.map(function (p) {
      return '<li>' + esc(p.what) + ' <span class="tag">[' + esc(p.sc) + ' · ' + esc(p.code) +
             (p.mechanical ? ' · settled in code' : '') + ']</span></li>';
    }).join('');
  }

  function renderPayload() {
    var res = state.result;
    if (res.payload) {
      $('#critState').textContent = JSON.stringify(res.payload.state, null, 2);
      var qs = res.payload.questions;
      var keys = Object.keys(qs);
      var sample = {};
      keys.slice(0, 5).forEach(function (k) { sample[k] = qs[k]; });
      $('#critQuestions').textContent =
        '// ' + keys.length + ' questions in this one call.\n' +
        '// Per element: 3 noul readings (both rubric orderings + polarity flipped)\n' +
        '//              and 2 choice readings over shuffled failure taxonomies.\n' +
        '// First 5 shown:\n\n' + JSON.stringify(sample, null, 2);
      return;
    }
    var slots = [
      { id: state.refSlot, targets: state.targets.ref },
      { id: state.candSlot, targets: state.targets.cand }
    ].sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    $('#critState').textContent =
      '// No API key set — readings below came from the local heuristic.\n' +
      '// With a key, the state sent is:\n\n' +
      JSON.stringify(Jev.auditState(slots, WCAG.CRITERIA), null, 2);
    var q = Jev.auditQuestions(slots, WCAG.CRITERIA);
    var k2 = Object.keys(q);
    var s2 = {};
    k2.slice(0, 4).forEach(function (k) { s2[k] = q[k]; });
    $('#critQuestions').textContent =
      '// ' + k2.length + ' questions would go in one call. First 4:\n\n' +
      JSON.stringify(s2, null, 2);
  }

  /* -------------------------------------------------------------- wiring */

  function renderPicker() {
    $('#specimenPicker').innerHTML = Specimens.LIST.map(function (s) {
      return '<button' + (s.id === state.specimenId ? ' class="active"' : '') +
             ' data-spec="' + s.id + '">' + esc(s.label) + '</button>';
    }).join('');
    $$('#specimenPicker button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.spec === state.specimenId) return;
        state.specimenId = b.dataset.spec;
        state.ready = false;
        renderPicker();
        run();
      });
    });
  }

  function init() {
    if (!global.ParityApp) return;

    global.ParityApp.registerView('criteria', {
      runButton: '#runCriteriaBtn',
      onShow: function () { if (!state.ready && !state.running) run(); }
    });

    renderPicker();

    $('#runCriteriaBtn').addEventListener('click', function () {
      state.ready = false;
      run();
    });

    $('#showStable').addEventListener('change', function () {
      if (state.ready) renderDeltas(rows());
    });

    global.ParityApp.onSettingsSaved(function () {
      state.ready = false;
      if (!$('#view-criteria').hidden) run();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.CriteriaView = { run: run, state: state };
})(window);
