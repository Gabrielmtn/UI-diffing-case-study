/*
 * fixtures.js — the demo's stand-in for "a Figma export" and "a production capture".
 *
 * Both sides are drawn by the same renderer from a spec object; the live spec is
 * the mockup spec with a handful of deliberate mutations applied. That keeps the
 * ground truth explicit (see `plantedIssues`) so the engine's output can be
 * checked against what was actually broken — including one mutation that is
 * *not* a regression, to prove the triage can say no.
 */
(function (global) {
  'use strict';

  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* --------------------------------------------------------------- drawing */

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fillRound(ctx, x, y, w, h, r, color) {
    ctx.fillStyle = color; roundRect(ctx, x, y, w, h, r); ctx.fill();
  }

  function strokeRound(ctx, x, y, w, h, r, color, lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw || 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
  }

  function text(ctx, str, x, y, opts) {
    opts = opts || {};
    ctx.font = (opts.weight || 400) + ' ' + (opts.size || 14) + 'px ' + FONT;
    ctx.fillStyle = opts.color || '#0f172a';
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    if (opts.letterSpacing != null && 'letterSpacing' in ctx) ctx.letterSpacing = opts.letterSpacing + 'px';
    ctx.fillText(str, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function checkIcon(ctx, x, y, size, color) {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.6, size / 7);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.52);
    ctx.lineTo(x + size * 0.38, y + size * 0.86);
    ctx.lineTo(x + size, y + size * 0.16);
    ctx.stroke();
  }

  /* --------------------------------------------------------------- pricing */

  function pricingSpec() {
    return {
      brand: '#2563eb',
      navCta: 'Start free trial',
      badge: true,
      pads: { Starter: 28, Pro: 28, Scale: 28 },
      priceWeight: 700,
      starterCta: 'Choose Starter',
      jitter: 0,
      accent: '#2563eb'
    };
  }

  function pricingLive() {
    var s = pricingSpec();
    s.brand = '#3d7bea';          // 1. brand token drifted
    s.badge = false;              // 2. "MOST POPULAR" badge dropped
    s.pads.Scale = 20;            // 3. Scale card padding collapsed
    s.priceWeight = 500;          // 4. price weight lightened
    s.starterCta = 'Select';      // 5. CTA copy changed
    s.jitter = 0.4;               // 6. sub-pixel text jitter (NOT a regression)
    return s;                     // note: s.accent (border token) is untouched
  }

  function drawPricing(ctx, W, H, s) {
    var rand = mulberry32(99);
    var j = function () { return s.jitter ? (rand() - 0.5) * 2 * s.jitter : 0; };
    var mobile = W < 520, tablet = W >= 520 && W < 900;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    /* nav */
    var navH = mobile ? 56 : 64;
    var pad = mobile ? 20 : 40;
    fillRound(ctx, pad, (navH - 26) / 2, 26, 26, 7, s.brand);
    text(ctx, 'Parity', pad + 36, navH / 2 + 6, { size: 17, weight: 700 });

    if (!mobile) {
      var links = ['Product', 'Pricing', 'Docs', 'Changelog'];
      var lx = pad + 130;
      links.forEach(function (l) {
        text(ctx, l, lx, navH / 2 + 5, { size: 13.5, color: '#475569' });
        lx += ctx.measureText(l).width + 30;
      });
    }

    var ctaW = mobile ? 104 : 136, ctaH = mobile ? 32 : 38;
    fillRound(ctx, W - pad - ctaW, (navH - ctaH) / 2, ctaW, ctaH, 8, s.brand);
    text(ctx, s.navCta, W - pad - ctaW / 2, navH / 2 + 5, {
      size: mobile ? 11.5 : 13, weight: 600, color: '#ffffff', align: 'center'
    });

    ctx.fillStyle = '#e8ecf2';
    ctx.fillRect(0, navH, W, 1);

    /* hero */
    var hy = navH + (mobile ? 40 : 64);
    text(ctx, 'PRICING', W / 2, hy, {
      size: 11, weight: 700, color: '#64748b', align: 'center', letterSpacing: 1.4
    });
    text(ctx, 'Pricing that scales with you', W / 2 + j(), hy + (mobile ? 32 : 44), {
      size: mobile ? 25 : 38, weight: 700, align: 'center'
    });
    text(ctx, 'Catch UI drift before your users do.', W / 2 + j(), hy + (mobile ? 58 : 78), {
      size: mobile ? 13 : 15.5, color: '#64748b', align: 'center'
    });

    /* billing toggle */
    var ty = hy + (mobile ? 82 : 108), tw = 196, th = 36;
    fillRound(ctx, W / 2 - tw / 2, ty, tw, th, 18, '#f1f5f9');
    fillRound(ctx, W / 2 - tw / 2 + 4, ty + 4, tw / 2 - 4, th - 8, 14, '#ffffff');
    strokeRound(ctx, W / 2 - tw / 2 + 4, ty + 4, tw / 2 - 4, th - 8, 14, '#e2e8f0', 1);
    text(ctx, 'Monthly', W / 2 - tw / 4, ty + 23, { size: 13, weight: 600, align: 'center' });
    text(ctx, 'Annual', W / 2 + tw / 4, ty + 23, { size: 13, color: '#64748b', align: 'center' });

    /* cards */
    var plans = [
      { name: 'Starter', price: '$0', note: 'For solo designers',
        features: ['3 monitored pages', 'Daily checks', '2 viewports', 'Email alerts', 'Community support'] },
      { name: 'Pro', price: '$49', note: 'For product teams',
        features: ['50 monitored pages', 'Hourly checks', 'All viewports', 'Slack + email alerts', 'Figma sync'] },
      { name: 'Scale', price: '$199', note: 'For design systems',
        features: ['Unlimited pages', 'On every deploy', 'All viewports', 'Webhooks + API', 'SSO & audit log'] }
    ];

    var cy = ty + (mobile ? 58 : 76);
    var gap = mobile ? 18 : 22;
    var cols = mobile ? 1 : 3;
    var cardW = (W - pad * 2 - gap * (cols - 1)) / cols;
    var cardH = mobile ? 300 : (tablet ? 384 : 402);
    var shown = mobile ? plans.slice(0, 2) : plans;

    shown.forEach(function (plan, i) {
      var isPro = plan.name === 'Pro';
      var cx = mobile ? pad : pad + i * (cardW + gap);
      var cyy = mobile ? cy + i * (cardH + gap) : cy;
      var cpad = s.pads[plan.name] != null ? s.pads[plan.name] : 28;

      fillRound(ctx, cx, cyy, cardW, cardH, 16, '#ffffff');
      strokeRound(ctx, cx, cyy, cardW, cardH, 16, isPro ? s.accent : '#e5e7eb', isPro ? 2 : 1);

      if (isPro && s.badge) {
        var bw = 118, bh = 24;
        fillRound(ctx, cx + cardW / 2 - bw / 2, cyy - bh / 2, bw, bh, 12, s.accent);
        text(ctx, 'MOST POPULAR', cx + cardW / 2, cyy + 4, {
          size: 9.5, weight: 700, color: '#ffffff', align: 'center', letterSpacing: 0.8
        });
      }

      var ix = cx + cpad, iy = cyy + cpad + 14;
      text(ctx, plan.name, ix, iy, { size: 15, weight: 600 });
      text(ctx, plan.note, ix, iy + 19, { size: 12, color: '#94a3b8' });

      var py = iy + (mobile ? 50 : 58);
      text(ctx, plan.price, ix, py, {
        size: mobile ? 34 : 40,
        weight: isPro ? s.priceWeight : 700
      });
      var pw = ctx.measureText(plan.price).width;
      text(ctx, '/month', ix + pw + 7, py - 2, { size: 12.5, color: '#94a3b8' });

      var btnY = py + 32, btnH = 40;
      var label = i === 0 ? s.starterCta : 'Choose ' + plan.name;
      if (isPro) {
        fillRound(ctx, ix, btnY, cardW - cpad * 2, btnH, 9, s.brand);
        text(ctx, label, cx + cardW / 2, btnY + 25, {
          size: 13, weight: 600, color: '#ffffff', align: 'center'
        });
      } else {
        fillRound(ctx, ix, btnY, cardW - cpad * 2, btnH, 9, '#f8fafc');
        strokeRound(ctx, ix, btnY, cardW - cpad * 2, btnH, 9, '#e2e8f0', 1);
        text(ctx, label, cx + cardW / 2, btnY + 25, { size: 13, weight: 600, align: 'center' });
      }

      var fy = btnY + btnH + (mobile ? 24 : 30);
      plan.features.forEach(function (f) {
        checkIcon(ctx, ix, fy - 9, 11, '#16a34a');
        text(ctx, f, ix + 21, fy + j(), { size: 12.5, color: '#334155' });
        fy += mobile ? 23 : 26;
      });
    });

    text(ctx, 'All plans include unlimited team members and a 14-day trial.', W / 2 + j(),
      Math.min(H - 22, cy + (mobile ? cardH * 2 + gap : cardH) + 40),
      { size: mobile ? 11 : 12.5, color: '#94a3b8', align: 'center' });
  }

  /* ------------------------------------------------------------- dashboard */

  function dashSpec() {
    return {
      bars: [42, 58, 35, 71, 49, 63, 38, 55, 67, 44, 72, 51],
      activeRail: true,
      statusPills: true,
      avatar: true,
      kpiAccent: '#0f172a'
    };
  }

  function dashLive() {
    var s = dashSpec();
    s.bars = [45, 61, 33, 68, 52, 59, 41, 57, 64, 47, 69, 54];  // fresh data, not a regression
    s.activeRail = false;   // active-nav indicator lost
    s.statusPills = false;  // status pill fills lost
    s.avatar = false;       // avatar asset failed to load
    s.kpiAccent = '#2563eb';// KPI value colour drifted
    return s;
  }

  function drawDashboard(ctx, W, H, s) {
    var mobile = W < 520;
    var railW = mobile ? 0 : (W < 900 ? 180 : 212);

    ctx.fillStyle = '#f7f8fa';
    ctx.fillRect(0, 0, W, H);

    /* rail */
    if (!mobile) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, railW, H);
      fillRound(ctx, 20, 22, 22, 22, 6, '#3b82f6');
      text(ctx, 'Parity', 50, 39, { size: 15, weight: 700, color: '#ffffff' });

      var items = ['Overview', 'Monitors', 'Runs', 'Baselines', 'Alerts', 'Settings'];
      var iy = 78;
      items.forEach(function (it, i) {
        var active = i === 1;
        if (active) {
          fillRound(ctx, 12, iy - 15, railW - 24, 32, 7, 'rgba(255,255,255,0.08)');
          if (s.activeRail) { ctx.fillStyle = '#3b82f6'; ctx.fillRect(0, iy - 15, 3, 32); }
        }
        fillRound(ctx, 24, iy - 6, 12, 12, 3, active ? '#93c5fd' : '#475569');
        text(ctx, it, 46, iy + 4, {
          size: 13, weight: active ? 600 : 400, color: active ? '#ffffff' : '#94a3b8'
        });
        iy += 38;
      });
    }

    /* topbar */
    var cx0 = railW, cw = W - railW, pad = mobile ? 16 : 26;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx0, 0, cw, 62);
    ctx.fillStyle = '#e8ecf2';
    ctx.fillRect(cx0, 62, cw, 1);
    text(ctx, 'Overview', cx0 + pad, 38, { size: 17, weight: 700 });

    if (s.avatar) {
      ctx.save();
      ctx.beginPath(); ctx.arc(W - pad - 15, 31, 15, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#c7d2fe'; ctx.fillRect(W - pad - 30, 16, 30, 30);
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath(); ctx.arc(W - pad - 15, 27, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - pad - 15, 52, 13, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(W - pad - 15, 31, 14.5, 0, Math.PI * 2); ctx.stroke();
    }

    /* KPI tiles */
    var kpis = [
      { label: 'Monitored pages', value: '128', delta: '+6' },
      { label: 'Runs today', value: '1,904', delta: '+12%' },
      { label: 'Open diffs', value: '23', delta: '-4' },
      { label: 'Parity score', value: '97.2%', delta: '+0.4' }
    ];
    var cols = mobile ? 2 : 4;
    var gap = 14;
    var tw = (cw - pad * 2 - gap * (cols - 1)) / cols;
    var th = 88, ty = 62 + pad;

    kpis.forEach(function (k, i) {
      var col = i % cols, row = (i / cols) | 0;
      var x = cx0 + pad + col * (tw + gap), y = ty + row * (th + gap);
      fillRound(ctx, x, y, tw, th, 11, '#ffffff');
      strokeRound(ctx, x, y, tw, th, 11, '#e8ecf2', 1);
      text(ctx, k.label, x + 15, y + 25, { size: 11, color: '#94a3b8' });
      text(ctx, k.value, x + 15, y + 58, {
        size: mobile ? 22 : 26, weight: 700,
        color: i === 3 ? s.kpiAccent : '#0f172a'
      });
      text(ctx, k.delta, x + tw - 15, y + 25, { size: 11, weight: 600, color: '#16a34a', align: 'right' });
    });

    /* chart */
    var rows = Math.ceil(kpis.length / cols);
    var chY = ty + rows * (th + gap);
    var chH = mobile ? 150 : 178, chW = cw - pad * 2;
    fillRound(ctx, cx0 + pad, chY, chW, chH, 11, '#ffffff');
    strokeRound(ctx, cx0 + pad, chY, chW, chH, 11, '#e8ecf2', 1);
    text(ctx, 'Diffs detected per hour', cx0 + pad + 16, chY + 26, { size: 12.5, weight: 600 });

    var bx = cx0 + pad + 16, bBase = chY + chH - 22;
    var slots = mobile ? 8 : s.bars.length;
    var bw = (chW - 32) / slots - 6;
    for (var i2 = 0; i2 < slots; i2++) {
      var bh = (s.bars[i2] / 80) * (chH - 64);
      fillRound(ctx, bx + i2 * (bw + 6), bBase - bh, bw, bh, 3, i2 === slots - 2 ? '#2563eb' : '#c7d9f7');
    }

    /* table */
    var tbY = chY + chH + gap;
    if (tbY + 60 < H) {
      var tbH = Math.min(H - tbY - pad, mobile ? 150 : 172);
      fillRound(ctx, cx0 + pad, tbY, chW, tbH, 11, '#ffffff');
      strokeRound(ctx, cx0 + pad, tbY, chW, tbH, 11, '#e8ecf2', 1);

      var rowsData = [
        ['/pricing', 'Desktop', '2m ago', 'Pass'],
        ['/pricing', 'Mobile', '2m ago', 'Drift'],
        ['/checkout', 'Desktop', '6m ago', 'Pass'],
        ['/dashboard', 'Tablet', '11m ago', 'Fail']
      ];
      var colX = [cx0 + pad + 16, cx0 + pad + chW * 0.38, cx0 + pad + chW * 0.6, cx0 + pad + chW - 90];
      var ry = tbY + 28;
      ['Page', 'Viewport', 'Last run', 'Status'].forEach(function (hd, ci) {
        text(ctx, hd, colX[ci], ry, { size: 10.5, weight: 600, color: '#94a3b8' });
      });
      ry += 14;
      ctx.fillStyle = '#eef1f5'; ctx.fillRect(cx0 + pad + 16, ry, chW - 32, 1);
      ry += 22;

      rowsData.forEach(function (r) {
        if (ry > tbY + tbH - 12) return;
        text(ctx, r[0], colX[0], ry, { size: 12, weight: 500 });
        text(ctx, r[1], colX[1], ry, { size: 12, color: '#64748b' });
        text(ctx, r[2], colX[2], ry, { size: 12, color: '#64748b' });
        var tone = r[3] === 'Pass' ? ['#dcfce7', '#15803d'] :
                   r[3] === 'Drift' ? ['#fef3c7', '#b45309'] : ['#fee2e2', '#b91c1c'];
        if (s.statusPills) {
          fillRound(ctx, colX[3] - 6, ry - 12, 58, 19, 9, tone[0]);
          text(ctx, r[3], colX[3] + 23, ry + 2, { size: 11, weight: 600, color: tone[1], align: 'center' });
        } else {
          text(ctx, r[3], colX[3] + 23, ry + 2, { size: 11, weight: 600, color: '#64748b', align: 'center' });
        }
        ry += 30;
      });
    }
  }

  /* ---------------------------------------------------------------- public */

  var VIEWPORTS = [
    { id: 'desktop', label: 'Desktop', w: 1180, h: 820 },
    { id: 'tablet', label: 'Tablet', w: 820, h: 900 },
    { id: 'mobile', label: 'Mobile', w: 390, h: 844 }
  ];

  var SCENES = {
    pricing: {
      id: 'pricing', label: 'Pricing', route: '/pricing',
      draw: drawPricing, mockup: pricingSpec, live: pricingLive,
      plantedIssues: [
        { what: 'Brand fill token drifted #2563EB → #3D7BEA (logo, nav CTA, Pro CTA)', kind: 'color', real: true },
        { what: '"MOST POPULAR" badge missing from Pro card', kind: 'missing-element', real: true },
        { what: 'Scale card padding collapsed 28px → 20px', kind: 'spacing', real: true },
        { what: 'Pro price weight lightened 700 → 500', kind: 'typography', real: true },
        { what: 'Starter CTA copy "Choose Starter" → "Select"', kind: 'content', real: true },
        { what: 'Sub-pixel text jitter on body copy', kind: 'noise', real: false }
      ]
    },
    dashboard: {
      id: 'dashboard', label: 'Dashboard', route: '/app/overview',
      draw: drawDashboard, mockup: dashSpec, live: dashLive,
      plantedIssues: [
        { what: 'Active-nav indicator bar removed from sidebar', kind: 'missing-element', real: true },
        { what: 'Status pill backgrounds lost in table', kind: 'color', real: true },
        { what: 'Avatar asset failed to load', kind: 'missing-element', real: true },
        { what: 'Parity-score KPI colour drifted to brand blue', kind: 'color', real: true },
        { what: 'Chart bars reflect newer data', kind: 'dynamic-content', real: false }
      ]
    }
  };

  /** Render one side of one scene into a fresh canvas at native pixel size. */
  function render(sceneId, viewportId, side) {
    var scene = SCENES[sceneId];
    var vp = VIEWPORTS.filter(function (v) { return v.id === viewportId; })[0];
    if (!scene || !vp) throw new Error('unknown scene/viewport: ' + sceneId + '/' + viewportId);

    var canvas = document.createElement('canvas');
    canvas.width = vp.w; canvas.height = vp.h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.textRendering = 'geometricPrecision';
    scene.draw(ctx, vp.w, vp.h, side === 'live' ? scene.live() : scene.mockup());
    return canvas;
  }

  global.Fixtures = {
    VIEWPORTS: VIEWPORTS,
    SCENES: SCENES,
    render: render,
    roundRect: roundRect
  };
})(window);
