/*
 * diff.js — deterministic visual diff engine.
 *
 * Finds *where* two renders disagree. It deliberately makes no judgement about
 * whether a difference matters — that question goes to Jev (see jev.js).
 *
 * Pipeline:  perceptual delta -> anti-alias rejection -> mask -> cell grid ->
 *            dilation -> connected components -> per-region metrics.
 */
(function (global) {
  'use strict';

  // Largest possible value of the squared YIQ metric below (white vs black).
  var MAX_DELTA = 35215;

  function rgb2y(r, g, b) { return r * 0.29889531 + g * 0.58662247 + b * 0.11448223; }
  function rgb2i(r, g, b) { return r * 0.59597799 - g * 0.27417610 - b * 0.32180189; }
  function rgb2q(r, g, b) { return r * 0.21147017 - g * 0.52261711 + b * 0.31114694; }

  // Composite a partially transparent channel over white.
  function blend(c, a) { return 255 + (c - 255) * a; }

  /**
   * Squared perceptual distance between pixel `i` of `a` and pixel `j` of `b`.
   * Sign encodes direction (negative => `a` is brighter), which the anti-alias
   * detector uses to find local luminance extrema. `yOnly` returns raw dY.
   */
  function colorDelta(a, b, i, j, yOnly) {
    var r1 = a[i], g1 = a[i + 1], b1 = a[i + 2], a1 = a[i + 3];
    var r2 = b[j], g2 = b[j + 1], b2 = b[j + 2], a2 = b[j + 3];

    if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;

    if (a1 < 255) { a1 /= 255; r1 = blend(r1, a1); g1 = blend(g1, a1); b1 = blend(b1, a1); }
    if (a2 < 255) { a2 /= 255; r2 = blend(r2, a2); g2 = blend(g2, a2); b2 = blend(b2, a2); }

    var y1 = rgb2y(r1, g1, b1), y2 = rgb2y(r2, g2, b2), dy = y1 - y2;
    if (yOnly) return dy;

    var di = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
    var dq = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
    var delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
    return y1 > y2 ? -delta : delta;
  }

  // True when (x1,y1) has >2 identically coloured neighbours — i.e. it sits in a
  // flat area rather than on a rendered edge.
  function hasManySiblings(img, x1, y1, w, h) {
    var x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0);
    var x2 = Math.min(x1 + 1, w - 1), y2 = Math.min(y1 + 1, h - 1);
    var pos = (y1 * w + x1) * 4;
    var zeroes = (x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2) ? 1 : 0;

    for (var x = x0; x <= x2; x++) {
      for (var y = y0; y <= y2; y++) {
        if (x === x1 && y === y1) continue;
        var p = (y * w + x) * 4;
        if (img[pos] === img[p] && img[pos + 1] === img[p + 1] &&
            img[pos + 2] === img[p + 2] && img[pos + 3] === img[p + 3]) zeroes++;
        if (zeroes > 2) return true;
      }
    }
    return false;
  }

  /**
   * Anti-aliasing detector (Kirill Dmitrenko's method, as used by pixelmatch):
   * a pixel is anti-aliased when it is the local luminance extreme among its
   * neighbours and that extreme neighbour sits in a flat region of *both*
   * images. Sub-pixel text rendering trips this; a real colour change does not.
   */
  function antialiased(img, x1, y1, w, h, img2) {
    var x0 = Math.max(x1 - 1, 0), y0 = Math.max(y1 - 1, 0);
    var x2 = Math.min(x1 + 1, w - 1), y2 = Math.min(y1 + 1, h - 1);
    var pos = (y1 * w + x1) * 4;
    var zeroes = (x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2) ? 1 : 0;
    var min = 0, max = 0, minX = -1, minY = -1, maxX = -1, maxY = -1;

    for (var x = x0; x <= x2; x++) {
      for (var y = y0; y <= y2; y++) {
        if (x === x1 && y === y1) continue;
        var delta = colorDelta(img, img, pos, (y * w + x) * 4, true);
        if (delta === 0) {
          zeroes++;
          if (zeroes > 2) return false;
        } else if (delta < min) { min = delta; minX = x; minY = y; }
        else if (delta > max) { max = delta; maxX = x; maxY = y; }
      }
    }

    if (min === 0 || max === 0) return false;
    return (hasManySiblings(img, minX, minY, w, h) && hasManySiblings(img2, minX, minY, w, h)) ||
           (hasManySiblings(img, maxX, maxY, w, h) && hasManySiblings(img2, maxX, maxY, w, h));
  }

  /* ---------------------------------------------------------------- colour */

  function luminance(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  // Hue in degrees, saturation/chroma and lightness on 0..1 — used to describe
  // a region's shift in terms a designer recognises ("hue moved 14 degrees").
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min, h = 0, s = 0;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s, l: l, c: d };
  }

  function hueGap(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function hex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    }).join('');
  }

  /** Modal colour of a pixel span, quantised to a 32-level cube. */
  function dominantColor(data, w, box, skipColor) {
    var bins = {}, best = null, bestN = 0;
    for (var y = box.y; y < box.y + box.h; y++) {
      for (var x = box.x; x < box.x + box.w; x++) {
        var p = (y * w + x) * 4;
        var r = data[p], g = data[p + 1], b = data[p + 2];
        if (skipColor && Math.abs(r - skipColor[0]) < 10 &&
            Math.abs(g - skipColor[1]) < 10 && Math.abs(b - skipColor[2]) < 10) continue;
        var key = (r >> 3) + ',' + (g >> 3) + ',' + (b >> 3);
        var bin = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, b: 0 });
        bin.n++; bin.r += r; bin.g += g; bin.b += b;
        if (bin.n > bestN) { bestN = bin.n; best = bin; }
      }
    }
    if (!best) return null;
    return { hex: hex(best.r / best.n, best.g / best.n, best.b / best.n),
             rgb: [best.r / best.n, best.g / best.n, best.b / best.n] };
  }

  /** Page background = modal colour of the four corner patches. */
  function backgroundColor(data, w, h) {
    var bins = {}, best = null, bestN = 0, s = Math.max(4, Math.min(24, Math.floor(Math.min(w, h) / 20)));
    var corners = [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]];
    for (var c = 0; c < corners.length; c++) {
      for (var y = corners[c][1]; y < corners[c][1] + s; y++) {
        for (var x = corners[c][0]; x < corners[c][0] + s; x++) {
          var p = (y * w + x) * 4;
          var key = (data[p] >> 3) + ',' + (data[p + 1] >> 3) + ',' + (data[p + 2] >> 3);
          var bin = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, b: 0 });
          bin.n++; bin.r += data[p]; bin.g += data[p + 1]; bin.b += data[p + 2];
          if (bin.n > bestN) { bestN = bin.n; best = bin; }
        }
      }
    }
    return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
  }

  /* --------------------------------------------------------------- metrics */

  // Fraction of pixels in `box` that differ from the page background — how much
  // "ink" is on the page here. A drop to ~0 means an element vanished.
  function inkCoverage(data, w, box, bg) {
    var on = 0, total = 0;
    for (var y = box.y; y < box.y + box.h; y++) {
      for (var x = box.x; x < box.x + box.w; x++) {
        var p = (y * w + x) * 4;
        var d = Math.abs(data[p] - bg[0]) + Math.abs(data[p + 1] - bg[1]) + Math.abs(data[p + 2] - bg[2]);
        if (d > 24) on++;
        total++;
      }
    }
    return total ? on / total : 0;
  }

  // Sobel magnitude averaged over the box, normalised. High values mean text or
  // dense detail; low values mean flat fills.
  function edgeDensity(data, w, h, box) {
    var sum = 0, n = 0;
    var x1 = Math.max(1, box.x), y1 = Math.max(1, box.y);
    var x2 = Math.min(w - 1, box.x + box.w), y2 = Math.min(h - 1, box.y + box.h);
    for (var y = y1; y < y2; y++) {
      for (var x = x1; x < x2; x++) {
        var l = function (xx, yy) {
          var p = (yy * w + xx) * 4;
          return luminance(data[p], data[p + 1], data[p + 2]);
        };
        var gx = -l(x - 1, y - 1) - 2 * l(x - 1, y) - l(x - 1, y + 1) +
                  l(x + 1, y - 1) + 2 * l(x + 1, y) + l(x + 1, y + 1);
        var gy = -l(x - 1, y - 1) - 2 * l(x, y - 1) - l(x + 1, y - 1) +
                  l(x - 1, y + 1) + 2 * l(x, y + 1) + l(x + 1, y + 1);
        sum += Math.sqrt(gx * gx + gy * gy);
        n++;
      }
    }
    return n ? Math.min(1, (sum / n) / 255) : 0;
  }

  /**
   * Best rigid translation of the box contents from A to B, searched over
   * +/-`range` px. `gain` is the fraction of the mismatch that disappears at the
   * best offset: a high gain with a non-zero offset means the element simply
   * moved (a spacing regression) rather than changed.
   */
  function translationFit(a, b, w, h, box, range) {
    var step = Math.max(1, Math.floor(Math.max(box.w, box.h) / 48));
    var lum = function (data, x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      var p = (y * w + x) * 4;
      return luminance(data[p], data[p + 1], data[p + 2]);
    };
    var score = function (dx, dy) {
      var sum = 0, n = 0;
      for (var y = box.y; y < box.y + box.h; y += step) {
        for (var x = box.x; x < box.x + box.w; x += step) {
          var va = lum(a, x, y), vb = lum(b, x + dx, y + dy);
          if (va < 0 || vb < 0) continue;
          sum += Math.abs(va - vb); n++;
        }
      }
      return n ? sum / n : Infinity;
    };

    var base = score(0, 0), best = base, bx = 0, by = 0;
    for (var dy = -range; dy <= range; dy += 2) {
      for (var dx = -range; dx <= range; dx += 2) {
        if (dx === 0 && dy === 0) continue;
        var s = score(dx, dy);
        if (s < best) { best = s; bx = dx; by = dy; }
      }
    }
    // Refine to 1px around the coarse winner.
    for (var ry = by - 1; ry <= by + 1; ry++) {
      for (var rx = bx - 1; rx <= bx + 1; rx++) {
        var s2 = score(rx, ry);
        if (s2 < best) { best = s2; bx = rx; by = ry; }
      }
    }
    return { dx: bx, dy: by, gain: base > 0 ? Math.max(0, (base - best) / base) : 0 };
  }

  /* ------------------------------------------------------------ components */

  /**
   * Group hot cells into regions with 8-connected BFS, after dilating the grid
   * so that separate glyphs of one broken heading merge into a single finding
   * instead of fifty.
   */
  function components(hot, gw, gh, dilate) {
    var grid = hot;
    for (var d = 0; d < dilate; d++) {
      var next = new Uint8Array(gw * gh);
      for (var y = 0; y < gh; y++) {
        for (var x = 0; x < gw; x++) {
          if (!grid[y * gw + x]) continue;
          for (var ny = Math.max(0, y - 1); ny <= Math.min(gh - 1, y + 1); ny++)
            for (var nx = Math.max(0, x - 1); nx <= Math.min(gw - 1, x + 1); nx++)
              next[ny * gw + nx] = 1;
        }
      }
      grid = next;
    }

    var seen = new Uint8Array(gw * gh), out = [];
    for (var i = 0; i < gw * gh; i++) {
      if (!grid[i] || seen[i]) continue;
      var queue = [i], cells = [];
      seen[i] = 1;
      while (queue.length) {
        var cur = queue.pop();
        cells.push(cur);
        var cx = cur % gw, cy = (cur / gw) | 0;
        for (var yy = Math.max(0, cy - 1); yy <= Math.min(gh - 1, cy + 1); yy++) {
          for (var xx = Math.max(0, cx - 1); xx <= Math.min(gw - 1, cx + 1); xx++) {
            var idx = yy * gw + xx;
            if (grid[idx] && !seen[idx]) { seen[idx] = 1; queue.push(idx); }
          }
        }
      }
      out.push(cells);
    }
    return out;
  }

  /* ------------------------------------------------------------------ main */

  /**
   * Compare two equally sized ImageData buffers.
   * opts: threshold (0..1), ignoreAA, cell (px), dilate (cells), minArea (px^2),
   *       maxRegions, ignoreRects ([{x,y,w,h}] in image space).
   */
  function compare(imgA, imgB, opts) {
    opts = opts || {};
    var threshold = opts.threshold != null ? opts.threshold : 0.08;
    var ignoreAA = opts.ignoreAA !== false;
    var cell = opts.cell || 8;
    var dilate = opts.dilate != null ? opts.dilate : 1;
    var minArea = opts.minArea != null ? opts.minArea : 120;
    var maxRegions = opts.maxRegions || 12;
    var ignoreRects = opts.ignoreRects || [];

    var w = imgA.width, h = imgA.height;
    var a = imgA.data, b = imgB.data;
    var maxDelta = MAX_DELTA * threshold * threshold;

    var mask = new Uint8Array(w * h);   // 1 = real change, 2 = anti-alias noise
    var changed = 0, aaCount = 0;

    var masked = new Uint8Array(w * h);
    ignoreRects.forEach(function (r) {
      for (var y = Math.max(0, r.y | 0); y < Math.min(h, (r.y + r.h) | 0); y++)
        for (var x = Math.max(0, r.x | 0); x < Math.min(w, (r.x + r.w) | 0); x++)
          masked[y * w + x] = 1;
    });

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (masked[i]) continue;
        var p = i * 4;
        var delta = colorDelta(a, b, p, p, false);
        if (Math.abs(delta) <= maxDelta) continue;
        if (ignoreAA && (antialiased(a, x, y, w, h, b) || antialiased(b, x, y, w, h, a))) {
          mask[i] = 2; aaCount++;
        } else {
          mask[i] = 1; changed++;
        }
      }
    }

    // Hot cells: any cell holding enough real changed pixels.
    var gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    var hot = new Uint8Array(gw * gh), counts = new Int32Array(gw * gh);
    var minHot = Math.max(2, Math.floor(cell * cell * 0.06));
    for (var yy2 = 0; yy2 < h; yy2++)
      for (var xx2 = 0; xx2 < w; xx2++)
        if (mask[yy2 * w + xx2] === 1) counts[((yy2 / cell) | 0) * gw + ((xx2 / cell) | 0)]++;
    for (var c = 0; c < counts.length; c++) if (counts[c] >= minHot) hot[c] = 1;

    var bgA = backgroundColor(a, w, h);
    var bgB = backgroundColor(b, w, h);

    var regions = components(hot, gw, gh, dilate).map(function (cells) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, hotPx = 0;
      cells.forEach(function (idx) {
        var cx = idx % gw, cy = (idx / gw) | 0;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;
        hotPx += counts[idx];
      });
      var box = {
        x: minX * cell,
        y: minY * cell,
        w: Math.min(w, (maxX + 1) * cell) - minX * cell,
        h: Math.min(h, (maxY + 1) * cell) - minY * cell
      };
      return { box: box, changedPx: hotPx };
    }).filter(function (r) {
      return r.changedPx > 0 && r.box.w * r.box.h >= minArea;
    }).sort(function (p, q) {
      return q.changedPx - p.changedPx;
    }).slice(0, maxRegions);

    // Describe each surviving region in designer-legible terms.
    regions.forEach(function (r, n) {
      var box = r.box;
      var domA = dominantColor(a, w, box, bgA);
      var domB = dominantColor(b, w, box, bgB);
      var hslA = domA ? rgb2hsl(domA.rgb[0], domA.rgb[1], domA.rgb[2]) : null;
      var hslB = domB ? rgb2hsl(domB.rgb[0], domB.rgb[1], domB.rgb[2]) : null;

      var sumA = 0, sumB = 0, n2 = 0, aaHere = 0;
      for (var y3 = box.y; y3 < box.y + box.h; y3++) {
        for (var x3 = box.x; x3 < box.x + box.w; x3++) {
          var p3 = (y3 * w + x3) * 4;
          sumA += luminance(a[p3], a[p3 + 1], a[p3 + 2]);
          sumB += luminance(b[p3], b[p3 + 1], b[p3 + 2]);
          if (mask[y3 * w + x3] === 2) aaHere++;
          n2++;
        }
      }

      var inkA = inkCoverage(a, w, box, bgA);
      var inkB = inkCoverage(b, w, box, bgB);
      var fit = translationFit(a, b, w, h, box, 14);

      r.id = 'R' + (n + 1);
      r.density = r.changedPx / Math.max(1, box.w * box.h);
      r.pctOfViewport = (box.w * box.h) / (w * h);
      r.pctChangedOfViewport = r.changedPx / (w * h);
      r.luminanceShift = n2 ? (sumB - sumA) / n2 : 0;
      r.hueShiftDeg = (hslA && hslB) ? hueGap(hslA.h, hslB.h) : 0;
      r.chromaShift = (hslA && hslB) ? (hslB.c - hslA.c) : 0;
      r.saturationShift = (hslA && hslB) ? (hslB.s - hslA.s) : 0;
      r.dominantMockup = domA ? domA.hex : null;
      r.dominantLive = domB ? domB.hex : null;
      r.edgeDensityMockup = edgeDensity(a, w, h, box);
      r.edgeDensityLive = edgeDensity(b, w, h, box);
      r.inkMockup = inkA;
      r.inkLive = inkB;
      r.inkDelta = inkB - inkA;
      r.shift = fit;
      r.aaPixelsInRegion = aaHere;
    });

    return {
      width: w, height: h,
      mask: mask,
      changedPixels: changed,
      antialiasPixels: aaCount,
      changedRatio: changed / (w * h),
      regions: regions,
      background: { mockup: hex(bgA[0], bgA[1], bgA[2]), live: hex(bgB[0], bgB[1], bgB[2]) }
    };
  }

  /** Paint the mask as a heatmap over a dimmed copy of the live render. */
  function renderHeatmap(ctx, result, liveImage, opts) {
    opts = opts || {};
    var w = result.width, h = result.height;
    var out = ctx.createImageData(w, h);
    var src = liveImage.data, dst = out.data, mask = result.mask;
    var showAA = !!opts.showAntialias;

    for (var i = 0; i < w * h; i++) {
      var p = i * 4;
      var l = luminance(src[p], src[p + 1], src[p + 2]);
      var dim = 235 - (235 - l) * 0.12;      // near-white ghost of the page
      dst[p] = dim; dst[p + 1] = dim; dst[p + 2] = dim; dst[p + 3] = 255;

      if (mask[i] === 1) {
        dst[p] = 244; dst[p + 1] = 63; dst[p + 2] = 94;
      } else if (mask[i] === 2 && showAA) {
        dst[p] = 251; dst[p + 1] = 191; dst[p + 2] = 36;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  global.Diff = {
    compare: compare,
    renderHeatmap: renderHeatmap,
    rgb2hsl: rgb2hsl,
    luminance: luminance,
    MAX_DELTA: MAX_DELTA
  };
})(window);
