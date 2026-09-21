/* app.js — wiring: matrix, runs, comparison stage, findings inbox, settings. */
(function () {
  'use strict';

  var STORE = 'parity.settings.v1';
  var DEFAULTS = {
    apiKey: '',
    endpoint: Jev.DEFAULT_ENDPOINT,
    model: Jev.DEFAULT_MODEL,
    jevThreshold: 0.5,
    threshold: 0.08,
    minArea: 120,
    dilate: 1,
    maxRegions: 10,
    ignoreAA: true
  };

  var settings = loadSettings();
  var results = {};                       // "scene:viewport" -> run record
  var custom = { mockup: null, live: null };
  var selected = null;
  var view = 'side';
  var filter = 'actionable';
  var activeFinding = null;
  var blinkTimer = null;
  var blinkOn = false;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var keyOf = function (scene, vp) { return scene + ':' + vp; };

  /* --------------------------------------------------------- persistence */

  function loadSettings() {
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (saved[k] !== undefined && saved[k] !== null) s[k] = saved[k];
        });
      }
    } catch (e) { /* private mode or blocked storage — defaults are fine */ }

    // A key handed over in the URL is honoured once, then scrubbed from history
    // so it does not sit in the address bar or get copied into a shared link.
    try {
      var qs = new URLSearchParams(location.search);
      var fromUrl = qs.get('key');
      if (fromUrl) {
        s.apiKey = fromUrl;
        qs.delete('key');
        history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
      }
    } catch (e) { /* ignore */ }

    return s;
  }

  function saveSettings() {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); }
    catch (e) { toast('Could not persist settings in this browser.', true); }
  }

  /* --------------------------------------------------------------- utils */

  function toast(msg, isErr) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, isErr ? 9000 : 3600);
  }

  function pct(n, d) { return (n * 100).toFixed(d == null ? 1 : d) + '%'; }

  function sceneMeta(sceneId) {
    if (sceneId === 'custom') {
      return { id: 'custom', label: 'Your upload', route: 'custom', plantedIssues: null };
    }
    return Fixtures.SCENES[sceneId];
  }

  function viewportMeta(vpId) {
    if (vpId === 'native') {
      var c = custom.mockup;
      return { id: 'native', label: 'Native', w: c ? c.width : 0, h: c ? c.height : 0 };
    }
    return Fixtures.VIEWPORTS.filter(function (v) { return v.id === vpId; })[0];
  }

  /** Both sides of a test, as canvases of identical dimensions. */
  function canvasesFor(sceneId, vpId) {
    if (sceneId === 'custom') return { mockup: custom.mockup, live: custom.live };
    return {
      mockup: Fixtures.render(sceneId, vpId, 'mockup'),
      live: Fixtures.render(sceneId, vpId, 'live')
    };
  }

  function imageDataOf(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /* ----------------------------------------------------------------- run */

  function statusOf(rec) {
    if (!rec) return 'idle';
    var actionable = rec.triage.findings.filter(function (f) { return f.isRegression; });
    if (actionable.length) return 'fail';
    if (rec.diff.regions.length) return 'drift';
    return 'pass';
  }

  function runCell(sceneId, vpId) {
    var key = keyOf(sceneId, vpId);
    var cellBtn = document.querySelector('.cell[data-key="' + key + '"]');
    if (cellBtn) cellBtn.classList.add('busy');

    return Promise.resolve().then(function () {
      var pair = canvasesFor(sceneId, vpId);
      if (!pair.mockup || !pair.live) throw new Error('Both a mockup and a live capture are required.');

      var imgA = imageDataOf(pair.mockup);
      var imgB = imageDataOf(pair.live);

      var diff = Diff.compare(imgA, imgB, {
        threshold: settings.threshold,
        ignoreAA: settings.ignoreAA,
        minArea: settings.minArea,
        dilate: settings.dilate,
        maxRegions: settings.maxRegions
      });

      var scene = sceneMeta(sceneId);
      var vp = viewportMeta(vpId);
      var ctx = {
        page: scene.label, route: scene.route,
        viewport: vp.label, width: pair.mockup.width, height: pair.mockup.height
      };

      return Jev.triage(ctx, diff.regions, {
        apiKey: settings.apiKey,
        endpoint: settings.endpoint,
        model: settings.model,
        threshold: settings.jevThreshold
      }).then(function (triage) {
        results[key] = {
          sceneId: sceneId, vpId: vpId, ctx: ctx,
          canvases: pair, diff: diff, triage: triage,
          payload: settings.apiKey ? {
            model: settings.model,
            state: Jev.buildState(ctx, diff.regions),
            questions: Jev.buildQuestions(diff.regions)
          } : null
        };
        return results[key];
      });
    }).then(function (rec) {
      if (cellBtn) cellBtn.classList.remove('busy');
      renderMatrix();
      if (selected && keyOf(selected.scene, selected.vp) === key) openCell(sceneId, vpId);
      return rec;
    }, function (err) {
      if (cellBtn) cellBtn.classList.remove('busy');
      renderMatrix();
      throw err;
    });
  }

  function runAll() {
    var btn = $('#runAllBtn');
    btn.disabled = true;
    btn.textContent = 'Running…';

    var jobs = [];
    Object.keys(Fixtures.SCENES).forEach(function (s) {
      Fixtures.VIEWPORTS.forEach(function (v) { jobs.push([s, v.id]); });
    });
    if (custom.mockup && custom.live) jobs.push(['custom', 'native']);

    var failed = null;
    var chain = jobs.reduce(function (p, job) {
      return p.then(function () {
        if (failed) return null;
        return runCell(job[0], job[1]).catch(function (err) { failed = err; });
      }).then(function () {
        return new Promise(function (r) { setTimeout(r, 0); });  // let the UI breathe
      });
    }, Promise.resolve());

    return chain.then(function () {
      btn.disabled = false;
      btn.textContent = 'Run all tests';
      if (failed) {
        toast(failed.message, true);
      } else {
        var first = jobs[0];
        if (!selected) openCell(first[0], first[1]);
        var n = Object.keys(results).length;
        toast('Ran ' + n + ' test' + (n === 1 ? '' : 's') + ' · engine: ' +
              (settings.apiKey ? 'Jev' : 'heuristic'));
      }
    });
  }

  /* -------------------------------------------------------------- matrix */

  function renderMatrix() {
    var table = $('#matrix');
    var thead = table.querySelector('thead tr');
    var tbody = table.querySelector('tbody');

    thead.innerHTML = '<th class="page-col">Page</th>' +
      Fixtures.VIEWPORTS.map(function (v) {
        return '<th>' + v.label + ' <span style="color:var(--line)">·</span> ' +
               '<span style="font-weight:400;text-transform:none;letter-spacing:0">' +
               v.w + '×' + v.h + '</span></th>';
      }).join('');

    var rows = Object.keys(Fixtures.SCENES).map(function (sceneId) {
      var scene = Fixtures.SCENES[sceneId];
      var cells = Fixtures.VIEWPORTS.map(function (v) {
        return '<td>' + cellHtml(sceneId, v.id) + '</td>';
      }).join('');
      return '<tr><td class="page-col"><div class="page-name">' + scene.label +
             '</div><div class="page-route">' + scene.route + '</div></td>' + cells + '</tr>';
    });

    if (custom.mockup && custom.live) {
      rows.push('<tr><td class="page-col"><div class="page-name">Your upload</div>' +
        '<div class="page-route">' + custom.mockup.width + '×' + custom.mockup.height + '</div></td>' +
        '<td colspan="' + Fixtures.VIEWPORTS.length + '">' + cellHtml('custom', 'native') + '</td></tr>');
    }

    tbody.innerHTML = rows.join('');

    $$('.cell').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.dataset.key.split(':');
        if (results[btn.dataset.key]) openCell(parts[0], parts[1]);
        else runCell(parts[0], parts[1]).then(function () { openCell(parts[0], parts[1]); })
          .catch(function (e) { toast(e.message, true); });
      });
    });
  }

  function cellHtml(sceneId, vpId) {
    var key = keyOf(sceneId, vpId);
    var rec = results[key];
    var status = statusOf(rec);
    var note = 'Run';

    if (rec) {
      var actionable = rec.triage.findings.filter(function (f) { return f.isRegression; }).length;
      var total = rec.triage.findings.length;
      if (actionable) note = actionable + ' regression' + (actionable === 1 ? '' : 's');
      else if (total) note = total + ' ignored';
      else note = 'Clean';
    }

    var isSel = selected && keyOf(selected.scene, selected.vp) === key;
    return '<button class="cell' + (isSel ? ' selected' : '') + '" data-key="' + key + '" type="button">' +
           '<i class="chip ' + status + '"></i><span class="cell-note">' + note + '</span></button>';
  }

  /* --------------------------------------------------------------- stage */

  function openCell(sceneId, vpId) {
    selected = { scene: sceneId, vp: vpId };
    var rec = results[keyOf(sceneId, vpId)];
    if (!rec) return;

    var scene = sceneMeta(sceneId);
    $('#workspace').hidden = false;
    $('#wsTitle').textContent = scene.route;
    $('#wsSub').textContent = rec.ctx.viewport + ' · ' + rec.ctx.width + '×' + rec.ctx.height;

    renderSummary(rec);
    renderStage(rec);
    renderFindings(rec);
    renderTruth(scene);
    renderPayloadPreview(rec);
    renderMatrix();
  }

  function renderSummary(rec) {
    var t = rec.triage;
    var actionable = t.findings.filter(function (f) { return f.isRegression; });
    var worst = actionable.reduce(function (m, f) {
      return f.severityScore > m ? f.severityScore : m;
    }, -1);

    var ship = t.shipProbability;
    var shipOk = ship == null ? actionable.length === 0 : ship >= 0.5;

    var stats = [
      ['Regions', rec.diff.regions.length],
      ['Actionable', actionable.length],
      ['Changed pixels', pct(rec.diff.changedRatio, 2)],
      ['AA rejected', rec.diff.antialiasPixels.toLocaleString()]
    ];
    if (worst >= 0) stats.push(['Worst', Jev.SEVERITY[Math.max(0, Math.min(4, Math.round(worst)))]]);

    var html = stats.map(function (s) {
      return '<div class="stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>';
    }).join('');

    html += '<div class="stat verdict"><b class="' + (shipOk ? 'ok' : 'no') + '">' +
            (shipOk ? 'Ship' : 'Review') + '</b><span>' +
            (ship == null ? 'verdict'
              : (t.engine === 'jev' ? 'jev ' : 'heuristic ') + ship.toFixed(2)) + '</span></div>';

    if (t.engine === 'jev') {
      html += '<div class="stat"><b>' + t.latencyMs + 'ms</b><span>' +
              (t.model || 'jev') + '</span></div>';
      if (t.costUsd != null) {
        html += '<div class="stat"><b>$' + t.costUsd.toFixed(5) + '</b><span>' +
                (t.usage && t.usage.input_tokens ? t.usage.input_tokens.toLocaleString() + ' in-tok' : 'cost') +
                '</span></div>';
      }
    }
    $('#summary').innerHTML = html;
  }

  /** Copy `src` into a fresh canvas, optionally outlining regions. */
  function paint(src, boxes, highlightId) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    if (boxes) drawBoxes(ctx, boxes, highlightId);
    return c;
  }

  function drawBoxes(ctx, regions, highlightId) {
    regions.forEach(function (r) {
      var hot = r.id === highlightId;
      ctx.lineWidth = hot ? 3 : 1.5;
      ctx.strokeStyle = hot ? '#2563eb' : 'rgba(244,63,94,.85)';
      ctx.setLineDash(hot ? [] : [5, 4]);
      ctx.strokeRect(r.box.x - 1.5, r.box.y - 1.5, r.box.w + 3, r.box.h + 3);
      ctx.setLineDash([]);

      var label = r.id;
      ctx.font = '600 11px ui-monospace, Menlo, monospace';
      var w = ctx.measureText(label).width + 10;
      ctx.fillStyle = hot ? '#2563eb' : 'rgba(244,63,94,.92)';
      ctx.fillRect(r.box.x - 1.5, Math.max(0, r.box.y - 17.5), w, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, r.box.x + 3.5, Math.max(11, r.box.y - 5.5));
    });
  }

  function shot(label, canvas, extra) {
    var wrap = document.createElement('div');
    wrap.className = 'shot';
    var head = document.createElement('div');
    head.className = 'shot-label';
    head.innerHTML = '<span>' + label + '</span>' + (extra ? '<span>' + extra + '</span>' : '');
    wrap.appendChild(head);
    wrap.appendChild(canvas);
    return wrap;
  }

  function renderStage(rec) {
    var stage = $('#stage');
    stage.innerHTML = '';
    stopBlink();

    var boxes = $('#showBoxes').checked ? rec.diff.regions : null;
    $('#wipeWrap').hidden = view !== 'overlay';

    if (view === 'side') {
      var pair = document.createElement('div');
      pair.className = 'stage-pair';
      pair.appendChild(shot('Mockup', paint(rec.canvases.mockup, boxes, activeFinding), 'design'));
      pair.appendChild(shot('Live', paint(rec.canvases.live, boxes, activeFinding), 'production'));
      stage.appendChild(pair);

    } else if (view === 'overlay') {
      var single = document.createElement('div');
      single.className = 'stage-single';
      single.appendChild(shot('Mockup ← wipe → Live', wipeCanvas(rec, boxes), 'drag the slider'));
      stage.appendChild(single);

    } else if (view === 'diff') {
      var c = document.createElement('canvas');
      c.width = rec.diff.width; c.height = rec.diff.height;
      var cx = c.getContext('2d');
      Diff.renderHeatmap(cx, rec.diff, imageDataOf(rec.canvases.live), {
        showAntialias: $('#showAA').checked
      });
      if (boxes) drawBoxes(cx, boxes, activeFinding);
      var wrap2 = document.createElement('div');
      wrap2.className = 'stage-single';
      wrap2.appendChild(shot('Change heatmap', c,
        rec.diff.changedPixels.toLocaleString() + ' px changed'));
      stage.appendChild(wrap2);

    } else if (view === 'blink') {
      var bc = document.createElement('canvas');
      bc.width = rec.canvases.mockup.width; bc.height = rec.canvases.mockup.height;
      var wrap3 = document.createElement('div');
      wrap3.className = 'stage-single';
      var holder = shot('Blink', bc, 'mockup ⇄ live');
      wrap3.appendChild(holder);
      stage.appendChild(wrap3);
      startBlink(rec, bc, holder.querySelector('.shot-label span'), boxes);
    }
  }

  function wipeCanvas(rec, boxes) {
    var c = document.createElement('canvas');
    c.width = rec.canvases.mockup.width;
    c.height = rec.canvases.mockup.height;
    var ctx = c.getContext('2d');

    var draw = function () {
      var p = Number($('#wipe').value) / 100;
      var split = Math.round(c.width * p);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(rec.canvases.live, 0, 0);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, split, c.height); ctx.clip();
      ctx.drawImage(rec.canvases.mockup, 0, 0);
      ctx.restore();
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(split, 0); ctx.lineTo(split, c.height); ctx.stroke();
      if (boxes) drawBoxes(ctx, boxes, activeFinding);
    };

    draw();
    $('#wipe').oninput = draw;
    return c;
  }

  function startBlink(rec, canvas, labelEl, boxes) {
    var ctx = canvas.getContext('2d');
    var tick = function () {
      blinkOn = !blinkOn;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(blinkOn ? rec.canvases.live : rec.canvases.mockup, 0, 0);
      if (boxes) drawBoxes(ctx, boxes, activeFinding);
      if (labelEl) labelEl.textContent = blinkOn ? 'Blink — showing Live' : 'Blink — showing Mockup';
    };
    tick();
    blinkTimer = setInterval(tick, 620);
  }

  function stopBlink() {
    if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
  }

  /* ------------------------------------------------------------ findings */

  /** Crop a region (with a little context) into a thumbnail, letterboxed. */
  function cropThumb(src, box, outW, outH) {
    var c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, outW, outH);

    var padX = Math.max(4, box.w * 0.06), padY = Math.max(4, box.h * 0.06);
    var sx = Math.max(0, box.x - padX), sy = Math.max(0, box.y - padY);
    var sw = Math.min(src.width - sx, box.w + padX * 2);
    var sh = Math.min(src.height - sy, box.h + padY * 2);
    var scale = Math.min(outW / sw, outH / sh);
    var dw = sw * scale, dh = sh * scale;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    return c;
  }

  /** One-line metric summary — why the engine flagged this region. */
  function explain(r) {
    var bits = [];
    if (r.inkDelta < -0.05) bits.push('ink −' + pct(-r.inkDelta, 0));
    else if (r.inkDelta > 0.05) bits.push('ink +' + pct(r.inkDelta, 0));
    if (r.hueShiftDeg >= 3) bits.push('hue ' + r.hueShiftDeg.toFixed(0) + '°');
    if (Math.abs(r.luminanceShift) >= 2) {
      bits.push('luma ' + (r.luminanceShift > 0 ? '+' : '') + r.luminanceShift.toFixed(0));
    }
    if (r.shift.gain > 0.4 && (r.shift.dx || r.shift.dy)) {
      bits.push('moved ' + r.shift.dx + ',' + r.shift.dy + 'px');
    }
    if (r.dominantMockup && r.dominantLive && r.dominantMockup !== r.dominantLive) {
      bits.push(r.dominantMockup + ' → ' + r.dominantLive);
    }
    if (!bits.length) bits.push(pct(r.density, 0) + ' of region changed');
    return bits.join(' · ');
  }

  function renderFindings(rec) {
    var list = $('#findings');
    list.innerHTML = '';

    var items = rec.triage.findings.filter(function (f) {
      return filter === 'all' || f.isRegression;
    });

    if (!items.length) {
      list.innerHTML = '<li class="empty">' +
        (rec.triage.findings.length
          ? 'No actionable regressions. Switch to <b>All</b> to see what was filtered out.'
          : 'No differences above threshold. Production matches the mockup.') + '</li>';
      return;
    }

    items.sort(function (a, b) {
      if (a.isRegression !== b.isRegression) return a.isRegression ? -1 : 1;
      return b.severityScore - a.severityScore;
    });

    items.forEach(function (f) {
      var li = document.createElement('li');
      li.className = 'finding' + (f.id === activeFinding ? ' active' : '') +
                     (f.isRegression ? '' : ' dismissed');

      var thumbs = document.createElement('div');
      thumbs.className = 'finding-thumbs';
      thumbs.appendChild(cropThumb(rec.canvases.mockup, f.region.box, 152, 40));
      thumbs.appendChild(cropThumb(rec.canvases.live, f.region.box, 152, 40));

      var sevIdx = Math.max(0, Math.min(4, Math.round(f.severityScore)));
      var prob = f.regressionProbability;
      var main = document.createElement('div');
      main.className = 'finding-main';
      main.innerHTML =
        '<div class="finding-top">' +
          '<span class="cat" data-cat="' + f.category + '">' + f.category + '</span>' +
          '<span class="sev s' + sevIdx + '">' + f.severityLabel + '</span>' +
          (f.isRegression ? '' : '<span class="cat">ignored</span>') +
        '</div>' +
        '<div class="finding-meta">' + f.id + ' · ' +
          f.region.box.w + '×' + f.region.box.h + ' at ' +
          f.region.box.x + ',' + f.region.box.y + '</div>' +
        '<div class="finding-why">' + explain(f.region) + '</div>' +
        (prob == null ? '' :
          '<div class="prob"><div class="prob-track"><div class="prob-fill' +
          (f.isRegression ? '' : ' low') + '" style="width:' + Math.round(prob * 100) + '%"></div></div>' +
          '<span class="prob-val">p(real) ' + prob.toFixed(2) + '</span></div>');

      li.appendChild(thumbs);
      li.appendChild(main);
      li.addEventListener('click', function () {
        activeFinding = (activeFinding === f.id) ? null : f.id;
        renderStage(rec);
        renderFindings(rec);
      });
      list.appendChild(li);
    });
  }

  function renderTruth(scene) {
    var wrap = $('#truthWrap');
    if (!scene.plantedIssues) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('#truthList').innerHTML = scene.plantedIssues.map(function (p) {
      return '<li>' + p.what + ' <span class="tag">[' + p.kind +
             (p.real ? '' : ' · not a regression') + ']</span></li>';
    }).join('');
  }

  function renderPayloadPreview(rec) {
    if (rec.payload) {
      $('#reqPreview').textContent =
        'POST ' + settings.endpoint + '\n' +
        'Authorization: Bearer apikey_…\n' +
        'Content-Type: application/json\n\n' +
        JSON.stringify(rec.payload, null, 2);
    } else {
      $('#reqPreview').textContent =
        '// No API key set — triage ran on the local heuristic.\n' +
        '// Add a TypeSafe key in Settings to send this payload:\n\n' +
        'POST ' + settings.endpoint + '\n\n' +
        JSON.stringify({
          model: settings.model,
          state: Jev.buildState(rec.ctx, rec.diff.regions),
          questions: Jev.buildQuestions(rec.diff.regions)
        }, null, 2);
    }

    $('#resPreview').textContent = rec.triage.raw
      ? JSON.stringify(rec.triage.raw, null, 2)
      : '// Heuristic verdicts (no API call)\n' +
        JSON.stringify(rec.triage.findings.map(function (f) {
          return {
            id: f.id, category: f.category,
            severity: f.severityLabel, isRegression: f.isRegression
          };
        }), null, 2);
  }

  /* ------------------------------------------------------------- uploads */

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('That is not an image file.'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not decode that image.')); };
      img.src = url;
    });
  }

  /** Redraw `canvas` at w×h so both sides of a custom diff line up. */
  function resizeCanvas(canvas, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, w, h);
    return c;
  }

  function setCustom(side, canvas) {
    custom[side] = canvas;

    var zone = $(side === 'mockup' ? '#dropMockup' : '#dropLive');
    var prev = zone.querySelector('.dz-preview');
    prev.width = canvas.width; prev.height = canvas.height;
    prev.getContext('2d').drawImage(canvas, 0, 0);
    prev.hidden = false;
    zone.classList.add('filled');

    var note = '';
    if (custom.mockup && custom.live) {
      if (custom.live.width !== custom.mockup.width || custom.live.height !== custom.mockup.height) {
        note = 'Live capture rescaled from ' + custom.live.width + '×' + custom.live.height +
               ' to ' + custom.mockup.width + '×' + custom.mockup.height + ' to align with the mockup.';
        custom.live = resizeCanvas(custom.live, custom.mockup.width, custom.mockup.height);
      } else {
        note = 'Both images are ' + custom.mockup.width + '×' + custom.mockup.height + '. Ready.';
      }
    }
    $('#customNote').textContent = note;
    $('#runCustomBtn').disabled = !(custom.mockup && custom.live);
    $('#clearCustomBtn').disabled = !(custom.mockup || custom.live);
    renderMatrix();
  }

  function wireDropzone(id, side) {
    var zone = $(id);
    var input = zone.querySelector('input[type=file]');

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) {
        loadImageFile(input.files[0]).then(function (c) { setCustom(side, c); })
          .catch(function (e) { toast(e.message, true); });
      }
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        loadImageFile(file).then(function (c) { setCustom(side, c); })
          .catch(function (err) { toast(err.message, true); });
      }
    });
  }

  /* -------------------------------------------------------------- wiring */

  function syncEngineBadge() {
    var badge = $('#engineBadge');
    var live = !!settings.apiKey;
    badge.classList.toggle('live', live);
    $('#engineLabel').textContent = live ? 'Jev · ' + settings.model : 'Heuristic';
    badge.title = live
      ? 'Triage runs on TypeSafe ' + settings.model + ' at ' + settings.endpoint
      : 'No API key set — triage runs on the local rule-based fallback';
  }

  var RANGES = [
    ['jevThreshold', '#jevThreshold', '#jevThresholdOut', 2],
    ['threshold', '#threshold', '#thresholdOut', 2],
    ['minArea', '#minArea', '#minAreaOut', 0],
    ['dilate', '#dilate', '#dilateOut', 0],
    ['maxRegions', '#maxRegions', '#maxRegionsOut', 0]
  ];

  function fillSettingsForm() {
    $('#apiKey').value = settings.apiKey;
    $('#endpoint').value = settings.endpoint;
    $('#model').value = settings.model;
    $('#ignoreAA').checked = settings.ignoreAA;
    RANGES.forEach(function (r) {
      $(r[1]).value = settings[r[0]];
      $(r[2]).textContent = Number(settings[r[0]]).toFixed(r[3]);
    });
  }

  function readSettingsForm() {
    settings.apiKey = $('#apiKey').value.trim();
    settings.endpoint = $('#endpoint').value.trim() || Jev.DEFAULT_ENDPOINT;
    settings.model = $('#model').value.trim() || Jev.DEFAULT_MODEL;
    settings.ignoreAA = $('#ignoreAA').checked;
    RANGES.forEach(function (r) { settings[r[0]] = Number($(r[1]).value); });
  }

  function init() {
    fillSettingsForm();
    syncEngineBadge();
    renderMatrix();

    $('#runAllBtn').addEventListener('click', function () {
      runAll().catch(function (e) { toast(e.message, true); });
    });

    $('#settingsBtn').addEventListener('click', function () {
      fillSettingsForm();
      $('#settingsModal').hidden = false;
    });
    $('#closeSettings').addEventListener('click', function () { $('#settingsModal').hidden = true; });
    $('#settingsModal').addEventListener('click', function (e) {
      if (e.target === $('#settingsModal')) $('#settingsModal').hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $('#settingsModal').hidden = true;
    });

    RANGES.forEach(function (r) {
      $(r[1]).addEventListener('input', function () {
        $(r[2]).textContent = Number($(r[1]).value).toFixed(r[3]);
      });
    });

    $('#saveSettings').addEventListener('click', function () {
      readSettingsForm();
      saveSettings();
      syncEngineBadge();
      $('#settingsModal').hidden = true;
      var had = Object.keys(results).length;
      results = {};
      renderMatrix();
      $('#workspace').hidden = true;
      selected = null;
      toast(had ? 'Settings saved — previous runs cleared. Run the tests again.' : 'Settings saved.');
    });

    $('#resetSettings').addEventListener('click', function () {
      Object.keys(DEFAULTS).forEach(function (k) { settings[k] = DEFAULTS[k]; });
      fillSettingsForm();
      saveSettings();
      syncEngineBadge();
      toast('Settings reset to defaults.');
    });

    $$('.vm').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.vm').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        view = btn.dataset.view;
        var rec = selected && results[keyOf(selected.scene, selected.vp)];
        if (rec) renderStage(rec);
      });
    });

    ['#showBoxes', '#showAA'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        var rec = selected && results[keyOf(selected.scene, selected.vp)];
        if (rec) renderStage(rec);
      });
    });

    $$('#findingFilter button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#findingFilter button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        filter = btn.dataset.filter;
        var rec = selected && results[keyOf(selected.scene, selected.vp)];
        if (rec) renderFindings(rec);
      });
    });

    wireDropzone('#dropMockup', 'mockup');
    wireDropzone('#dropLive', 'live');

    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var side = custom.mockup ? 'live' : 'mockup';
          loadImageFile(items[i].getAsFile())
            .then(function (c) { setCustom(side, c); toast('Pasted into ' + side + '.'); })
            .catch(function (err) { toast(err.message, true); });
          break;
        }
      }
    });

    $('#runCustomBtn').addEventListener('click', function () {
      runCell('custom', 'native')
        .then(function () { openCell('custom', 'native'); })
        .catch(function (e) { toast(e.message, true); });
    });

    $('#clearCustomBtn').addEventListener('click', function () {
      custom = { mockup: null, live: null };
      delete results[keyOf('custom', 'native')];
      ['#dropMockup', '#dropLive'].forEach(function (sel) {
        var z = $(sel);
        z.classList.remove('filled');
        z.querySelector('.dz-preview').hidden = true;
        z.querySelector('input[type=file]').value = '';
      });
      $('#customNote').textContent = '';
      $('#runCustomBtn').disabled = true;
      $('#clearCustomBtn').disabled = true;
      if (selected && selected.scene === 'custom') { selected = null; $('#workspace').hidden = true; }
      renderMatrix();
    });

    // Warm the first test so the page has something to show immediately.
    runCell('pricing', 'desktop')
      .then(function () { openCell('pricing', 'desktop'); })
      .catch(function (e) { toast(e.message, true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
