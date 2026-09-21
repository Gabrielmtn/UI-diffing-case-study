/*
 * paths.js — turns raw session streams into a path graph, and turns Jev's
 * verdicts into a ranked list of affordance gaps.
 *
 * Nodes are (screen, step), the way real path analysers do it: a screen revisited
 * at step 4 is a different node from the same screen at step 0, which makes
 * backtracking legible and keeps the graph a DAG that a Sankey can lay out.
 *
 * Volume is carried by ribbon thickness. Colour carries flow health, which is
 * the part Jev supplies — it is deliberately NOT derived from volume.
 */
(function (global) {
  'use strict';

  var MAX_STEPS = 7;

  /** Collapse consecutive steps on the same screen into one visit. */
  function collapse(session) {
    var out = [];
    session.steps.forEach(function (s) {
      var last = out[out.length - 1];
      if (last && last.screen === s.screen) {
        last.actions.push(s.action);
        last.rage += s.rage || 0;
        last.ms += s.ms;
        return;
      }
      out.push({ screen: s.screen, actions: [s.action], rage: s.rage || 0, ms: s.ms,
                 labels: s.label ? [s.label] : [] });
      if (s.label && out[out.length - 1].labels.indexOf(s.label) < 0) {
        out[out.length - 1].labels.push(s.label);
      }
    });
    return out.slice(0, MAX_STEPS);
  }

  function transitionKey(from, to) { return from + '→' + to; }

  /**
   * Fold sessions into unique path signatures, (screen, step) nodes, ribbons,
   * and the deduplicated screen-pair transitions that get sent for judgement.
   */
  function aggregate(sessions) {
    var signatures = {};
    var nodes = {};
    var links = {};
    var transitions = {};
    var maxStep = 0;

    sessions.forEach(function (session) {
      var visits = collapse(session);
      var sigKey = visits.map(function (v) { return v.screen; }).join(' > ');

      var sig = signatures[sigKey] || (signatures[sigKey] = {
        key: sigKey, id: 'P' + (Object.keys(signatures).length + 1),
        count: 0, visits: visits, archetypes: {},
        totalMs: 0, backs: 0, searches: 0, rage: 0, escalated: false, converted: false
      });
      sig.count++;
      sig.archetypes[session.archetype] = (sig.archetypes[session.archetype] || 0) + 1;

      visits.forEach(function (v, i) {
        maxStep = Math.max(maxStep, i);
        sig.totalMs += v.ms;
        sig.backs += v.actions.filter(function (a) { return a === 'back'; }).length;
        sig.searches += v.actions.filter(function (a) { return a === 'search'; }).length;
        sig.rage += v.rage;
        if (v.actions.indexOf('escalate') >= 0) sig.escalated = true;
        if (v.actions.indexOf('convert') >= 0) sig.converted = true;

        var nk = v.screen + '@' + i;
        var node = nodes[nk] || (nodes[nk] = { key: nk, screen: v.screen, step: i, value: 0, rage: 0 });
        node.value++;
        node.rage += v.rage;

        if (i > 0) {
          var prev = visits[i - 1];
          var lk = prev.screen + '@' + (i - 1) + '→' + nk;
          var link = links[lk] || (links[lk] = {
            key: lk, source: prev.screen + '@' + (i - 1), target: nk,
            from: prev.screen, to: v.screen, step: i - 1, value: 0
          });
          link.value++;

          var tk = transitionKey(prev.screen, v.screen);
          var t = transitions[tk] || (transitions[tk] = {
            key: tk, id: 'T' + (Object.keys(transitions).length + 1),
            from: prev.screen, to: v.screen, value: 0,
            viaBack: 0, viaSearch: 0, rage: 0, queries: {}, steps: {}
          });
          t.value++;
          t.steps[i - 1] = (t.steps[i - 1] || 0) + 1;
          if (prev.actions.indexOf('back') >= 0) t.viaBack++;
          if (v.actions.indexOf('search') >= 0) t.viaSearch++;
          t.rage += v.rage;
          // Only an actual search contributes a query string; click labels are not queries.
          if (v.actions.indexOf('search') >= 0) {
            v.labels.forEach(function (l) { t.queries[l] = (t.queries[l] || 0) + 1; });
          }
        }
      });
    });

    var sigList = Object.keys(signatures).map(function (k) { return signatures[k]; })
      .sort(function (a, b) { return b.count - a.count; });
    var transList = Object.keys(transitions).map(function (k) { return transitions[k]; })
      .sort(function (a, b) { return b.value - a.value; });

    return {
      sessions: sessions.length,
      signatures: sigList,
      transitions: transList,
      nodes: nodes,
      links: Object.keys(links).map(function (k) { return links[k]; }),
      maxStep: maxStep
    };
  }

  /* ---------------------------------------------------------------- layout */

  /**
   * Vertical Sankey packing: each column's nodes share the available height in
   * proportion to the sessions passing through them, then ribbons stack at each
   * node's edges in the order their counterpart appears.
   */
  function layout(agg, opts) {
    opts = opts || {};
    var W = opts.width || 900;
    var H = opts.height || 460;
    var nodeW = opts.nodeWidth || 13;
    var nodePad = opts.nodePad || 16;
    var padTop = opts.padTop || 8;

    var cols = [];
    for (var c = 0; c <= agg.maxStep; c++) cols.push([]);
    Object.keys(agg.nodes).forEach(function (k) { cols[agg.nodes[k].step].push(agg.nodes[k]); });
    cols = cols.filter(function (col) { return col.length; });

    var colGap = cols.length > 1 ? (W - nodeW) / (cols.length - 1) : 0;

    cols.forEach(function (col, ci) {
      col.sort(function (a, b) { return b.value - a.value; });
      var total = col.reduce(function (s, n) { return s + n.value; }, 0);
      var gaps = nodePad * Math.max(0, col.length - 1);
      var scale = (H - gaps - padTop * 2) / Math.max(1, total);
      var y = padTop;
      col.forEach(function (n) {
        n.x = ci * colGap;
        n.w = nodeW;
        n.h = Math.max(3, n.value * scale);
        n.y = y;
        n.outY = n.y;
        n.inY = n.y;
        y += n.h + nodePad;
      });
    });

    // Stack ribbons on each side, keeping source order stable so they don't cross
    // more than the graph itself requires.
    var bySource = {}, byTarget = {};
    agg.links.forEach(function (l) {
      (bySource[l.source] || (bySource[l.source] = [])).push(l);
      (byTarget[l.target] || (byTarget[l.target] = [])).push(l);
    });

    Object.keys(bySource).forEach(function (k) {
      var src = agg.nodes[k];
      if (!src) return;
      var scale = src.h / Math.max(1, src.value);
      bySource[k].sort(function (a, b) {
        return (agg.nodes[a.target] ? agg.nodes[a.target].y : 0) -
               (agg.nodes[b.target] ? agg.nodes[b.target].y : 0);
      }).forEach(function (l) {
        l.sy = src.outY; l.sh = l.value * scale; src.outY += l.sh;
      });
    });

    Object.keys(byTarget).forEach(function (k) {
      var tgt = agg.nodes[k];
      if (!tgt) return;
      var scale = tgt.h / Math.max(1, tgt.value);
      byTarget[k].sort(function (a, b) {
        return (agg.nodes[a.source] ? agg.nodes[a.source].y : 0) -
               (agg.nodes[b.source] ? agg.nodes[b.source].y : 0);
      }).forEach(function (l) {
        l.ty = tgt.inY; l.th = l.value * scale; tgt.inY += l.th;
      });
    });

    agg.links.forEach(function (l) {
      var s = agg.nodes[l.source], t = agg.nodes[l.target];
      if (!s || !t) { l.path = null; return; }
      var x0 = s.x + s.w, x1 = t.x, mx = (x0 + x1) / 2;
      l.path = 'M' + x0 + ',' + l.sy +
               'C' + mx + ',' + l.sy + ' ' + mx + ',' + l.ty + ' ' + x1 + ',' + l.ty +
               'L' + x1 + ',' + (l.ty + l.th) +
               'C' + mx + ',' + (l.ty + l.th) + ' ' + mx + ',' + (l.sy + l.sh) + ' ' + x0 + ',' + (l.sy + l.sh) +
               'Z';
    });

    return { columns: cols, width: W, height: H };
  }

  /* --------------------------------------------------------------- ranking */

  /**
   * Rank affordance gaps by the sessions they cost.
   *   impact = sessions on the transition x struggle x friction of the journeys
   *            that route through it
   * Struggle is 1 - p(intentional progress), straight from Jev's noul.
   */
  function rankGaps(agg, verdicts) {
    var frictionBySig = {};
    agg.signatures.forEach(function (s) {
      var v = verdicts.signatures[s.id];
      frictionBySig[s.key] = v ? v.frictionScore : 1;
    });

    // Average friction of the journeys each transition appears in.
    var frictionByTrans = {};
    agg.signatures.forEach(function (sig) {
      var screens = sig.visits.map(function (v) { return v.screen; });
      for (var i = 1; i < screens.length; i++) {
        var tk = transitionKey(screens[i - 1], screens[i]);
        var bucket = frictionByTrans[tk] || (frictionByTrans[tk] = { sum: 0, n: 0 });
        bucket.sum += frictionBySig[sig.key] * sig.count;
        bucket.n += sig.count;
      }
    });

    return agg.transitions.map(function (t) {
      var v = verdicts.transitions[t.id] || {};
      var struggle = 1 - (v.progressProbability == null ? 0.5 : v.progressProbability);
      var fb = frictionByTrans[t.key];
      var friction = fb && fb.n ? fb.sum / fb.n : 1;
      return {
        transition: t,
        gap: v.gap || 'none',
        gapConfidence: v.gapConfidence,
        progressProbability: v.progressProbability,
        struggle: struggle,
        friction: friction,
        sessions: t.value,
        impact: t.value * struggle * (1 + friction)
      };
    }).filter(function (r) {
      return r.gap !== 'none';
    }).sort(function (a, b) { return b.impact - a.impact; });
  }

  /**
   * Sessions touching at least one flagged step. Summing the per-step counts
   * double-counts any journey that trips more than one gap.
   */
  function sessionsAffected(agg, ranked) {
    var flagged = {};
    ranked.forEach(function (r) { flagged[r.transition.key] = true; });
    var total = 0;
    agg.signatures.forEach(function (sig) {
      var screens = sig.visits.map(function (v) { return v.screen; });
      for (var i = 1; i < screens.length; i++) {
        if (flagged[transitionKey(screens[i - 1], screens[i])]) { total += sig.count; return; }
      }
    });
    return total;
  }

  /** Intent x outcome contingency table, counted in sessions. */
  function intentMatrix(agg, verdicts, outcomes) {
    var cells = {}, rowTotals = {}, colTotals = {}, max = 0;

    agg.signatures.forEach(function (sig) {
      var v = verdicts.signatures[sig.id];
      if (!v) return;
      var outcome = outcomes[Math.max(0, Math.min(outcomes.length - 1, Math.round(v.frictionScore)))];
      var key = v.intent + '|' + outcome;
      cells[key] = (cells[key] || 0) + sig.count;
      rowTotals[v.intent] = (rowTotals[v.intent] || 0) + sig.count;
      colTotals[outcome] = (colTotals[outcome] || 0) + sig.count;
      if (cells[key] > max) max = cells[key];
    });

    return { cells: cells, rowTotals: rowTotals, colTotals: colTotals, max: max };
  }

  global.Paths = {
    MAX_STEPS: MAX_STEPS,
    collapse: collapse,
    aggregate: aggregate,
    layout: layout,
    rankGaps: rankGaps,
    sessionsAffected: sessionsAffected,
    intentMatrix: intentMatrix,
    transitionKey: transitionKey
  };
})(window);
