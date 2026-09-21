/*
 * wcag.js — the rubric, and the mechanical checks that must never reach the model.
 *
 * Two layers, on purpose:
 *
 *   MECHANICAL  Computable from the DOM with certainty: an img with no alt
 *               attribute, an input with no associated label, an accessible
 *               name that does not contain its own visible text. These are
 *               decided in code. Sending them to a probabilistic model would
 *               trade a certainty for a probability, which is a bad trade.
 *
 *   SEMANTIC    Not computable: whether alt text is a useful *equivalent*,
 *               whether link text survives out of context, whether an error
 *               message tells you what to do. This is what Jev is for.
 *
 * The rubric below is the priming. There is no reasoning step in a System One
 * model, so expertise cannot be summoned with a persona — it has to be encoded
 * in the question set and in `criteria`. WCAG is unusually good raw material
 * for that: every success criterion ships with documented sufficient techniques
 * and, more usefully, documented *common failures* (the F-codes), which are the
 * hard half of any rubric to write.
 *
 * Criterion text and technique codes are reproduced from knowledge of WCAG 2.2;
 * w3.org was unreachable from the build sandbox, so check them against
 * https://www.w3.org/TR/WCAG22/ before relying on them.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------- accessible name */

  function visibleText(el) {
    var clone = el.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('[aria-hidden="true"]'))
      .forEach(function (h) { h.parentNode.removeChild(h); });
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Accessible name, computed far enough for the criteria here: aria-labelledby,
   * then aria-label, then a native label, then content, then alt/title.
   * Not a full accname implementation and does not claim to be.
   */
  function accessibleName(el, root) {
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      var parts = by.split(/\s+/).map(function (id) {
        var t = root.getElementById ? root.getElementById(id) : root.querySelector('#' + id);
        return t ? visibleText(t) : '';
      }).filter(Boolean);
      if (parts.length) return { name: parts.join(' '), from: 'aria-labelledby' };
    }

    var al = el.getAttribute('aria-label');
    if (al && al.trim()) return { name: al.trim(), from: 'aria-label' };

    if (/^(input|select|textarea)$/i.test(el.tagName)) {
      var id = el.getAttribute('id');
      var lab = id && root.querySelector('label[for="' + CSS_escape(id) + '"]');
      if (lab) return { name: visibleText(lab), from: '<label for>' };
      var wrap = el.closest && el.closest('label');
      if (wrap) return { name: visibleText(wrap), from: 'wrapping <label>' };
      return { name: '', from: null };
    }

    if (/^img$/i.test(el.tagName)) {
      var alt = el.getAttribute('alt');
      if (alt !== null) return { name: alt.trim(), from: 'alt' };
      return { name: '', from: null };
    }

    var text = visibleText(el);
    if (text) return { name: text, from: 'content' };

    var title = el.getAttribute('title');
    if (title && title.trim()) return { name: title.trim(), from: 'title' };
    return { name: '', from: null };
  }

  function CSS_escape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* ------------------------------------------------------------- criteria */

  /*
   * Each criterion carries:
   *   applies  which elements it is asked about
   *   subject  a compact description of the element, which becomes the state
   *   ask      the noul rubric — `criteria.true` / `criteria.false` are where
   *            the expertise lives, written as observable states rather than
   *            adjectives so the logits have something to bind to
   *   failures the documented F-codes, used as the choice taxonomy
   */
  var CRITERIA = {
    '1.1.1': {
      id: '1.1.1', name: 'Non-text Content', level: 'A',
      text: 'All non-text content that is presented to the user has a text alternative ' +
            'that serves the equivalent purpose.',
      applies: function (doc) {
        var imgs = Array.prototype.slice.call(doc.querySelectorAll('img[alt]'))
          .filter(function (i) { return i.getAttribute('alt').trim() !== ''; });
        var roled = Array.prototype.slice.call(doc.querySelectorAll('[role="img"][aria-label]'))
          .filter(function (i) { return i.getAttribute('aria-label').trim() !== ''; });
        return imgs.concat(roled);
      },
      subject: function (el) {
        var isImg = /^img$/i.test(el.tagName);
        return {
          element: isImg ? 'img' : el.tagName.toLowerCase() + '[role=img]',
          alt_text: isImg ? el.getAttribute('alt') : el.getAttribute('aria-label'),
          filename: (el.getAttribute('src') || '').split('/').pop() || null,
          nearby_text: nearbyText(el),
          inside_link: !!(el.closest && el.closest('a'))
        };
      },
      ask: {
        instructions: 'Does this image\'s alt text serve the same purpose for someone who ' +
          'cannot see the image as the image itself serves for someone who can?',
        criteria: {
          'true': 'The alt text conveys the information or function the image carries in this ' +
                  'context — what it depicts or, if it is a control, what it does.',
          'false': 'The alt text is a filename, a placeholder such as "image", "photo" or ' +
                   '"graphic", a restatement of adjacent text that adds nothing, or a ' +
                   'description that omits the point the image was included to make.'
        }
      },
      failures: {
        'none': 'The alt text is an adequate equivalent.',
        'F30': 'Text alternative that is not an alternative — a filename or placeholder text.',
        'F39': 'A non-null alt such as "image" or "spacer" on content that carries no meaning ' +
               'and should have been marked decorative with alt="".',
        'F89': 'The image is the only content of a link and its alt does not describe where ' +
               'the link goes.',
        'incomplete': 'A real description that still omits the information the image was ' +
                      'included to convey.'
      }
    },

    '2.4.4': {
      id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A',
      text: 'The purpose of each link can be determined from the link text alone, or from the ' +
            'link text together with its programmatically determined link context.',
      applies: function (doc) { return Array.prototype.slice.call(doc.querySelectorAll('a[href]')); },
      subject: function (el, root) {
        var an = accessibleName(el, root);
        return {
          element: 'a',
          link_text: an.name,
          name_from: an.from,
          href: el.getAttribute('href'),
          programmatic_context: programmaticContext(el)
        };
      },
      ask: {
        instructions: 'Could a user determine where this link goes from its text together with ' +
          'its programmatically determined context — the sentence, list item, table cell or ' +
          'paragraph containing it? Assume they are hearing links read out of page order.',
        criteria: {
          'true': 'The link text, or the text plus its containing sentence or list item, names ' +
                  'the destination or the action clearly enough to choose it from a list of links.',
          'false': 'The text is generic ("read more", "click here", "learn more", a bare URL) ' +
                   'and the programmatic context does not disambiguate it; or the only ' +
                   'disambiguating information sits elsewhere on the page.'
        }
      },
      failures: {
        'none': 'The purpose is determinable.',
        'F63': 'Context for the link is provided only in content that is not programmatically ' +
               'related to it.',
        'F89': 'The link has no accessible name, or only a non-descriptive image.',
        'generic': 'Generic link text with no disambiguating context at all.'
      }
    },

    '2.4.6': {
      id: '2.4.6', name: 'Headings and Labels', level: 'AA',
      text: 'Headings and labels describe topic or purpose.',
      applies: function (doc) {
        return Array.prototype.slice.call(doc.querySelectorAll(
          'h1,h2,h3,h4,h5,h6,label,legend,button[aria-label],[role="button"][aria-label]'));
      },
      subject: function (el) {
        var isControl = /^button$/i.test(el.tagName) || el.getAttribute('role') === 'button';
        var aria = el.getAttribute('aria-label');
        return {
          element: el.tagName.toLowerCase(),
          kind: isControl ? 'the accessible name of a control' : 'a heading or field label',
          text: isControl ? (aria || visibleText(el)) : visibleText(el),
          describes_content: nearbyText(el, true)
        };
      },
      ask: {
        instructions: 'Does this heading or label describe the topic or purpose of the content ' +
          'it introduces, specifically enough to be useful when skimming a list of headings?',
        criteria: {
          'true': 'It names the particular thing it introduces — a user scanning only the ' +
                  'headings or labels would know what is under it.',
          'false': 'It is generic ("Item", "Details", "Information", "Input"), a repeated ' +
                   'boilerplate string that does not distinguish this section from its ' +
                   'siblings, or it describes something other than the content that follows.'
        }
      },
      failures: {
        'none': 'Describes topic or purpose.',
        'generic': 'Generic wording that does not distinguish this section from any other.',
        'mismatched': 'Describes something other than the content it introduces.',
        'duplicated': 'Identical to sibling headings or labels, so it cannot disambiguate them.'
      }
    },

    '3.3.2': {
      id: '3.3.2', name: 'Labels or Instructions', level: 'A',
      text: 'Labels or instructions are provided when content requires user input.',
      applies: function (doc) {
        return Array.prototype.slice.call(doc.querySelectorAll('input,select,textarea'))
          .filter(function (el) { return !/^(hidden|submit|button|reset)$/i.test(el.getAttribute('type') || ''); });
      },
      subject: function (el, root) {
        var an = accessibleName(el, root);
        var desc = el.getAttribute('aria-describedby');
        var hint = '';
        if (desc) {
          hint = desc.split(/\s+/).map(function (id) {
            var t = root.getElementById ? root.getElementById(id) : root.querySelector('#' + id);
            return t ? visibleText(t) : '';
          }).filter(Boolean).join(' ');
        }
        return {
          element: el.tagName.toLowerCase(),
          input_type: el.getAttribute('type') || 'text',
          accessible_name: an.name,
          name_from: an.from,
          placeholder: el.getAttribute('placeholder') || null,
          described_by_text: hint || null,
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true'
        };
      },
      ask: {
        instructions: 'Do the label and any instructions give a user everything they need to ' +
          'enter a correct value first time — including the expected format where the format ' +
          'is not obvious from the field name?',
        criteria: {
          'true': 'The field is named, and where a particular format, range or unit is required ' +
                  'that expectation is stated in text before the user types.',
          'false': 'The only label is a placeholder that disappears on focus, the name does not ' +
                   'say what to enter, or a constrained format (date, phone, reference number, ' +
                   'password rules) is enforced but never stated up front.'
        }
      },
      failures: {
        'none': 'Adequate label and instructions.',
        'F82': 'Visual formatting implies a structure that is never stated in a text label.',
        'placeholder-only': 'A placeholder is doing the job of a label; it vanishes on input and ' +
                            'is not reliably announced.',
        'format-unstated': 'A required format, range or unit is enforced but not stated before entry.'
      }
    },

    '3.3.1': {
      id: '3.3.1', name: 'Error Identification', level: 'A',
      text: 'If an input error is automatically detected, the item that is in error is ' +
            'identified and the error is described to the user in text.',
      applies: function (doc) {
        return Array.prototype.slice.call(
          doc.querySelectorAll('[role="alert"],.error,[data-error],[aria-invalid="true"]'));
      },
      subject: function (el, root) {
        var isField = /^(input|select|textarea)$/i.test(el.tagName);
        return {
          element: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || null,
          message_text: isField ? null : visibleText(el),
          on_a_field: isField,
          field_name: isField ? accessibleName(el, root).name : null,
          form_fields_present: Array.prototype.slice.call(
            (el.closest && el.closest('form') ? el.closest('form') : root)
              .querySelectorAll('input,select,textarea')).length
        };
      },
      ask: {
        instructions: 'Does this error identify which item is in error AND describe the error ' +
          'in text, well enough that the user knows what to change?',
        criteria: {
          'true': 'It names the field it refers to and says what is wrong with the value — not ' +
                  'merely that something is wrong.',
          'false': 'It is generic ("invalid input", "error", "please try again"), or it names the ' +
                   'problem without identifying which of several fields caused it, or it ' +
                   'identifies the field without saying what is wrong with the entry.'
        }
      },
      failures: {
        'none': 'Identifies the item and describes the error.',
        'unidentified': 'Describes an error without saying which field it belongs to.',
        'undescribed': 'Flags a field without saying what is wrong with the value.',
        'generic': 'Neither identifies the item nor describes the error.'
      }
    },

    '2.5.3': {
      id: '2.5.3', name: 'Label in Name', level: 'A',
      text: 'For user interface components with labels that include text or images of text, the ' +
            'name contains the text that is presented visually.',
      applies: function (doc) {
        return Array.prototype.slice.call(doc.querySelectorAll('button,a[href],[role="button"]'))
          .filter(function (el) { return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'); });
      },
      subject: function (el, root) {
        var an = accessibleName(el, root);
        return {
          element: el.tagName.toLowerCase(),
          visible_text: visibleText(el),
          accessible_name: an.name,
          name_from: an.from
        };
      },
      ask: {
        instructions: 'A speech-input user says "click" followed by the words they can see on ' +
          'this control. Would that activate it — that is, does the accessible name contain the ' +
          'visible text?',
        criteria: {
          'true': 'The accessible name contains the visible label text, in the same word order, ' +
                  'so speaking the visible words matches the control.',
          'false': 'The accessible name replaces, reorders or omits the visible text, so a user ' +
                   'speaking what they see would not match this control.'
        }
      },
      failures: {
        'none': 'The name contains the visible text.',
        'replaced': 'The accessible name is unrelated to the visible text.',
        'reordered': 'The visible words appear but in a different order.',
        'partial': 'Only some of the visible text appears in the name.'
      }
    }
  };

  /* ------------------------------------------------------------ context */

  function nearbyText(el, forward) {
    var host = el.closest && (el.closest('li,figure,article,section,td,fieldset,form,div') || el.parentElement);
    if (!host) return null;
    var t = visibleText(host);
    if (forward && el.nextElementSibling) t = visibleText(el.parentElement);
    if (!t) return null;
    return t.length > 220 ? t.slice(0, 220) + '…' : t;
  }

  /** The text a screen reader would treat as the link's programmatic context. */
  function programmaticContext(el) {
    var host = el.closest && el.closest('li,p,td,h1,h2,h3,h4,h5,h6,figure,article');
    if (!host) return null;
    var t = visibleText(host);
    return t && t.length > 240 ? t.slice(0, 240) + '…' : t;
  }

  /* -------------------------------------------------------- mechanical */

  /**
   * Violations decidable in code. Each returns a certainty, not a probability,
   * and is excluded from everything sent to Jev.
   */
  function mechanicalChecks(doc) {
    var out = [];
    var add = function (sc, el, what, detail) {
      out.push({ sc: sc, element: el.tagName.toLowerCase(), what: what, detail: detail,
                 snippet: snippetOf(el) });
    };

    Array.prototype.slice.call(doc.querySelectorAll('img')).forEach(function (img) {
      if (!img.hasAttribute('alt')) {
        add('1.1.1', img, 'Image has no alt attribute',
            'Assistive technology falls back to the filename. Use alt="" if it is decorative.');
      }
    });

    Array.prototype.slice.call(doc.querySelectorAll('input,select,textarea')).forEach(function (el) {
      if (/^(hidden|submit|button|reset)$/i.test(el.getAttribute('type') || '')) return;
      var an = accessibleName(el, doc);
      if (!an.name) {
        add('3.3.2', el, 'Form control has no accessible name',
            el.getAttribute('placeholder')
              ? 'Only a placeholder is present; a placeholder is not a label.'
              : 'No label, aria-label or aria-labelledby.');
      }
    });

    Array.prototype.slice.call(doc.querySelectorAll('button,a[href],[role="button"]')).forEach(function (el) {
      var an = accessibleName(el, doc);
      if (!an.name) {
        add('4.1.2', el, 'Control has no accessible name',
            'Nothing for assistive technology or speech input to announce or match.');
        return;
      }
      // 2.5.3 is a substring test, so it is decidable rather than judged.
      var vis = visibleText(el);
      if (vis && an.from && /aria-label/.test(an.from)) {
        var a = an.name.toLowerCase(), v = vis.toLowerCase();
        if (a.indexOf(v) < 0) {
          add('2.5.3', el, 'Accessible name does not contain the visible text',
              'Visible "' + vis + '" vs name "' + an.name + '" — speech input will not match.');
        }
      }
    });

    var levels = Array.prototype.slice.call(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    var prev = 0;
    levels.forEach(function (h) {
      var lvl = Number(h.tagName[1]);
      if (prev && lvl > prev + 1) {
        add('1.3.1', h, 'Heading level skips from h' + prev + ' to h' + lvl,
            'The outline implies a section that does not exist.');
      }
      prev = lvl;
    });

    Array.prototype.slice.call(doc.querySelectorAll('[tabindex]')).forEach(function (el) {
      if (Number(el.getAttribute('tabindex')) > 0) {
        add('2.4.3', el, 'Positive tabindex',
            'Overrides document order and is almost always a focus-order bug.');
      }
    });

    return out;
  }

  function snippetOf(el) {
    var s = el.outerHTML || '';
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > 150 ? s.slice(0, 150) + '…' : s;
  }

  /* --------------------------------------------------------------- parse */

  function parse(html) {
    return new DOMParser().parseFromString(
      '<!doctype html><html><body>' + html + '</body></html>', 'text/html');
  }

  /**
   * Everything a criterion applies to in one document, with the mechanical
   * failures already removed — those are settled, and asking about them would
   * only add noise.
   */
  function targets(doc, mechanical) {
    var excluded = {};
    mechanical.forEach(function (m) { excluded[m.sc + '|' + m.snippet] = true; });

    var out = [];
    Object.keys(CRITERIA).forEach(function (scId) {
      var sc = CRITERIA[scId];
      sc.applies(doc).forEach(function (el, i) {
        var snip = snippetOf(el);
        if (excluded[scId + '|' + snip]) return;
        out.push({
          key: scId.replace(/\./g, '_') + '_' + i,
          sc: scId,
          element: el.tagName.toLowerCase(),
          snippet: snip,
          subject: sc.subject(el, doc)
        });
      });
    });
    return out;
  }

  global.WCAG = {
    CRITERIA: CRITERIA,
    parse: parse,
    targets: targets,
    mechanicalChecks: mechanicalChecks,
    accessibleName: accessibleName,
    visibleText: visibleText,
    snippetOf: snippetOf
  };
})(window);
