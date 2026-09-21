/*
 * sessions.js — synthetic product analytics, the way fixtures.js is synthetic UI.
 *
 * Five journey archetypes through a fictional monitoring product, each expanded
 * into many sessions with seeded variation so the path graph has realistic
 * spread instead of five clean lines. Four archetypes carry a planted affordance
 * gap; one is deliberately healthy, because a tool that cannot say "this path is
 * fine" is a complaint generator rather than an instrument.
 *
 * `plantedGaps` is the ground truth the triage output gets checked against.
 */
(function (global) {
  'use strict';

  var SCREENS = {
    '/': 'Landing',
    '/pricing': 'Pricing',
    '/signup': 'Sign up',
    '/docs': 'Docs',
    '/search': 'Search',
    '/support': 'Support',
    '/app/overview': 'Overview',
    '/app/monitors': 'Monitors',
    '/app/monitors/new': 'New monitor',
    '/app/baselines': 'Baselines',
    '/app/alerts': 'Alerts',
    '/app/settings': 'Settings',
    '/app/settings/billing': 'Billing'
  };

  var INTENTS = {
    evaluate: 'Deciding whether the product fits — browsing, comparing plans, reading marketing.',
    onboard: 'Setting something up for the first time after signing up.',
    configure: 'Changing or operating an existing thing: settings, exports, thresholds.',
    diagnose: 'Working out why something happened or why something is wrong.',
    administer: 'Account housekeeping: billing, seats, access, invoices.'
  };

  // Terse labels for the UI; the verbose INTENTS text above is the rubric Jev
  // reads, where the extra detail earns its tokens.
  var INTENT_LABELS = {
    evaluate: 'Evaluating the product',
    onboard: 'Setting up for the first time',
    configure: 'Operating an existing thing',
    diagnose: 'Working out what went wrong',
    administer: 'Account housekeeping'
  };

  var GAPS = {
    'none': 'The interface offered a direct route and the user took it. No gap.',
    'discoverability': 'The control exists but users cannot find it from where they start; they resort to search or docs.',
    'labeling': 'The control is visible but named in a way that does not match what users are looking for.',
    'placement': 'The destination exists but is nested somewhere users do not think to look.',
    'feedback': 'The user acted and the interface gave no response, so they repeated or escalated.',
    'missing-capability': 'There is no route at all between where the user is and where they need to be.'
  };

  var FRICTION = ['Smooth', 'Minor detour', 'Repeated attempts', 'Stuck', 'Abandoned'];

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Each step: where the user was, what they did, how long they dwelt.
     `optional` steps drop out in some sessions; `extra` steps appear in some. */
  var ARCHETYPES = [
    {
      id: 'evaluate-convert',
      n: 34,
      truth: { intent: 'evaluate', gap: 'none', outcome: 'succeeded' },
      note: 'Healthy control — the marketing funnel does its job.',
      steps: [
        { screen: '/', action: 'view', ms: 14000 },
        { screen: '/pricing', action: 'click', label: 'Pricing', ms: 31000 },
        { screen: '/pricing', action: 'click', label: 'Compare plans', ms: 12000, optional: true },
        { screen: '/signup', action: 'click', label: 'Start free trial', ms: 46000 },
        { screen: '/app/overview', action: 'convert', label: 'Account created', ms: 8000 }
      ]
    },
    {
      id: 'first-monitor',
      n: 28,
      truth: { intent: 'onboard', gap: 'discoverability', outcome: 'succeeded with friction' },
      note: 'Planted: Overview has no primary "New monitor" action, so new users go hunting.',
      steps: [
        { screen: '/app/overview', action: 'view', ms: 22000 },
        { screen: '/search', action: 'search', label: 'add monitor', ms: 9000 },
        { screen: '/docs', action: 'view', label: 'Creating monitors', ms: 41000 },
        { screen: '/docs', action: 'back', ms: 3000 },
        { screen: '/app/monitors', action: 'view', ms: 11000 },
        { screen: '/app/monitors/new', action: 'convert', label: 'Monitor created', ms: 52000 }
      ]
    },
    {
      id: 'find-billing',
      n: 22,
      truth: { intent: 'administer', gap: 'placement', outcome: 'succeeded with friction' },
      note: 'Planted: Billing is nested under Settings with no direct nav entry.',
      steps: [
        { screen: '/app/overview', action: 'view', ms: 7000 },
        { screen: '/app/settings', action: 'click', label: 'Settings', ms: 18000 },
        { screen: '/app/settings', action: 'back', ms: 4000 },
        { screen: '/search', action: 'search', label: 'billing', ms: 6000 },
        { screen: '/app/settings/billing', action: 'convert', label: 'Invoice opened', ms: 24000 }
      ]
    },
    {
      id: 'alert-diagnosis',
      n: 19,
      truth: { intent: 'diagnose', gap: 'missing-capability', outcome: 'abandoned' },
      note: 'Planted: An alert never links to the baseline that failed, so users loop.',
      steps: [
        { screen: '/app/alerts', action: 'view', label: 'Alert: /pricing drift', ms: 16000 },
        { screen: '/app/monitors', action: 'click', label: 'Monitors', ms: 13000 },
        { screen: '/app/baselines', action: 'click', label: 'Baselines', ms: 27000 },
        { screen: '/app/baselines', action: 'back', ms: 3000 },
        { screen: '/app/alerts', action: 'view', ms: 19000 },
        { screen: '/support', action: 'escalate', label: 'Contact support', ms: 63000 }
      ]
    },
    {
      id: 'export-report',
      n: 17,
      truth: { intent: 'configure', gap: 'feedback', outcome: 'stuck' },
      note: 'Planted: Export is disabled without explanation, so users click it repeatedly.',
      steps: [
        { screen: '/app/overview', action: 'view', ms: 9000 },
        { screen: '/app/baselines', action: 'click', label: 'Baselines', ms: 15000 },
        { screen: '/app/baselines', action: 'rage_click', label: 'Export', ms: 11000, rage: 3 },
        { screen: '/docs', action: 'search', label: 'export csv', ms: 34000 },
        { screen: '/docs', action: 'exit', ms: 5000 }
      ]
    }
  ];

  /** Expand the archetypes into individual sessions with seeded variation. */
  function generate(seed) {
    var rand = mulberry32(seed == null ? 20260921 : seed);
    var out = [];
    var uid = 0;

    ARCHETYPES.forEach(function (arch) {
      for (var i = 0; i < arch.n; i++) {
        var steps = [];
        arch.steps.forEach(function (s) {
          if (s.optional && rand() < 0.55) return;          // some users skip it
          steps.push({
            screen: s.screen,
            action: s.action,
            label: s.label || null,
            rage: s.rage || 0,
            ms: Math.round(s.ms * (0.6 + rand() * 0.9))
          });
        });

        // A minority backtrack one extra time mid-journey.
        if (steps.length > 2 && rand() < 0.18) {
          var at = 1 + Math.floor(rand() * (steps.length - 2));
          steps.splice(at + 1, 0, {
            screen: steps[at].screen, action: 'back', label: null, rage: 0,
            ms: Math.round(2000 + rand() * 4000)
          });
        }

        out.push({
          id: 'S' + (++uid),
          archetype: arch.id,
          truth: arch.truth,
          steps: steps
        });
      }
    });

    return out;
  }

  global.Sessions = {
    SCREENS: SCREENS,
    INTENTS: INTENTS,
    INTENT_LABELS: INTENT_LABELS,
    GAPS: GAPS,
    FRICTION: FRICTION,
    ARCHETYPES: ARCHETYPES,
    generate: generate,
    label: function (screen) { return SCREENS[screen] || screen; },
    plantedGaps: function () {
      return ARCHETYPES.map(function (a) {
        return {
          id: a.id, note: a.note, intent: a.truth.intent,
          gap: a.truth.gap, outcome: a.truth.outcome, sessions: a.n
        };
      });
    }
  };
})(window);
