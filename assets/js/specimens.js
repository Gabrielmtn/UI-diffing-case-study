/*
 * specimens.js — component pairs: an accessible reference and a broken candidate.
 *
 * The pair is the point. A single absolute reading from a biased instrument is
 * not trustworthy; a paired difference against a known-correct implementation
 * is, because systematic bias largely cancels. WCAG is unusual in shipping both
 * halves — the requirement and a catalogue of documented failures — so the
 * reference is not invented here, it is the conformant pattern.
 *
 * `planted` is the ground truth the audit gets checked against.
 */
(function (global) {
  'use strict';

  var PREVIEW_CSS = [
    'body{margin:0;padding:18px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#fff}',
    '*{box-sizing:border-box}',
    '.card{max-width:260px;border:1px solid #e4e8ee;border-radius:10px;overflow:hidden}',
    '.card .ph{display:block;width:100%;height:120px;background:linear-gradient(135deg,#dbe4f0,#c3d2e8)}',
    '.card .body{padding:12px}',
    '.card h3{margin:0 0 4px;font-size:15px}',
    '.card .price{margin:0 0 10px;color:#475569;font-size:13px}',
    'a{color:#2563eb}',
    'form{max-width:320px;display:flex;flex-direction:column;gap:12px}',
    'label{font-weight:600;font-size:13px;display:block;margin-bottom:4px}',
    'input{width:100%;font:inherit;padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px}',
    '.hint{display:block;color:#64748b;font-size:12px;margin-bottom:4px}',
    '.err{color:#b91c1c;font-size:13px;margin:0}',
    '[role=alert]{color:#b91c1c;font-size:13px;margin:0}',
    'button{font:inherit;padding:8px 12px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:7px;cursor:pointer}',
    '.bar{display:flex;gap:8px;align-items:center}',
    '.search{display:flex;gap:6px}',
    '.icon{font-size:15px;line-height:1}'
  ].join('');

  var SPECIMENS = [
    {
      id: 'product-card',
      label: 'Product card',
      blurb: 'An image, a heading and a link — the three things screen-reader users navigate by.',
      reference:
        '<article class="card">' +
          '<span class="ph" role="img" aria-label="Aeron task chair in graphite, three-quarter view"></span>' +
          '<div class="body">' +
            '<h3>Aeron task chair</h3>' +
            '<p class="price">&pound;1,240 &middot; graphite</p>' +
            '<a href="/products/aeron">View the Aeron task chair</a>' +
          '</div>' +
        '</article>',
      candidate:
        '<article class="card">' +
          '<span class="ph" role="img" aria-label="image"></span>' +
          '<div class="body">' +
            '<h3>Item</h3>' +
            '<p class="price">&pound;1,240 &middot; graphite</p>' +
            '<a href="/products/aeron">Read more</a>' +
          '</div>' +
        '</article>',
      planted: [
        { sc: '1.1.1', what: 'Image labelled "image" — a placeholder, not an equivalent', code: 'F39' },
        { sc: '2.4.6', what: 'Heading reads "Item" — does not name the product', code: 'generic' },
        { sc: '2.4.4', what: 'Link reads "Read more" with no disambiguating context', code: 'generic' }
      ]
    },

    {
      id: 'signup-form',
      label: 'Sign-up form',
      blurb: 'Labels, format expectations and an error message — where most forms actually fail.',
      reference:
        '<form>' +
          '<div>' +
            '<label for="r-email">Email address</label>' +
            '<input id="r-email" type="email" autocomplete="email">' +
          '</div>' +
          '<div>' +
            '<label for="r-dob">Date of birth</label>' +
            '<span class="hint" id="r-dob-hint">For example, 31 03 1980</span>' +
            '<input id="r-dob" type="text" aria-describedby="r-dob-hint">' +
          '</div>' +
          '<p role="alert">Date of birth must be a real date. You entered 31 31 1980 — ' +
            'the month must be between 01 and 12.</p>' +
        '</form>',
      candidate:
        '<form>' +
          '<div><input type="email" placeholder="Email" aria-label="Email"></div>' +
          '<div><input type="text" placeholder="DOB" aria-label="DOB"></div>' +
          '<p role="alert">Invalid input.</p>' +
        '</form>',
      planted: [
        { sc: '3.3.2', what: 'Placeholder doing the job of a label; no format stated for DOB', code: 'format-unstated' },
        { sc: '3.3.1', what: 'Error says "Invalid input" — names neither the field nor the problem', code: 'generic' },
        { sc: '2.4.6', what: 'No visible labels at all to describe either field', code: 'generic' }
      ]
    },

    {
      id: 'search-toolbar',
      label: 'Search and toolbar',
      blurb: 'Where the accessible name and the visible label disagree — and speech input breaks.',
      reference:
        '<div class="search">' +
          '<label for="r-q" class="hint">Search documents</label>' +
          '<input id="r-q" type="search">' +
          '<button type="submit">Search</button>' +
        '</div>' +
        '<div class="bar" role="toolbar" aria-label="Document actions">' +
          '<button aria-label="Save document"><span class="icon" aria-hidden="true">&#9635;</span></button>' +
          '<button aria-label="Share document"><span class="icon" aria-hidden="true">&#8599;</span></button>' +
          '<button>Delete document</button>' +
        '</div>',
      candidate:
        '<div class="search">' +
          '<input type="search" placeholder="Search">' +
          '<button type="submit" aria-label="Submit">Search</button>' +
        '</div>' +
        '<div class="bar">' +
          '<button><span class="icon" aria-hidden="true">&#9635;</span></button>' +
          '<button aria-label="button"><span class="icon" aria-hidden="true">&#8599;</span></button>' +
          '<button aria-label="Remove">Delete document</button>' +
        '</div>',
      planted: [
        { sc: '2.5.3', what: 'Visible "Search", accessible name "Submit" — speech input cannot match', code: 'replaced', mechanical: true },
        { sc: '2.5.3', what: 'Visible "Delete document", accessible name "Remove"', code: 'replaced', mechanical: true },
        { sc: '4.1.2', what: 'Icon button with no accessible name at all', code: 'none', mechanical: true },
        { sc: '1.1.1', what: 'Icon button labelled "button" — says nothing about what it does', code: 'F39' },
        { sc: '3.3.2', what: 'Search field labelled only by a placeholder', code: 'placeholder-only', mechanical: true }
      ]
    }
  ];

  /** srcdoc for a sandboxed preview frame — no scripts, no same-origin. */
  function previewDoc(html) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
           '<style>' + PREVIEW_CSS + '</style></head><body>' + html + '</body></html>';
  }

  global.Specimens = {
    LIST: SPECIMENS,
    PREVIEW_CSS: PREVIEW_CSS,
    previewDoc: previewDoc,
    byId: function (id) {
      return SPECIMENS.filter(function (s) { return s.id === id; })[0] || null;
    }
  };
})(window);
