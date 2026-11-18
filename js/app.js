/* Math Lab — main UI. Plain JS, no dependencies, no network calls except
 * same-origin JSON content. Data lives in localStorage (see store.js). */
(function () {
  'use strict';

  var IDLE_MS = 3 * 60 * 1000; // stop counting study time after 3 minutes with no taps/keys
  var app = document.getElementById('app');
  var CONTENT = null;
  var S = Store.load();
  var parentUnlocked = false;

  /* ---------- tiny DOM helper ---------- */

  function h(tag, props) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // only used for our own content JSON
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }
  function add(node, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(node, x); }); return; }
    if (typeof c === 'string' || typeof c === 'number') { node.appendChild(document.createTextNode(String(c))); return; }
    node.appendChild(c);
  }
  function show() {
    app.innerHTML = '';
    for (var i = 0; i < arguments.length; i++) add(app, arguments[i]);
    window.scrollTo(0, 0);
  }
  function figureFor(item, side) {
    if (!item || !item.figure || typeof Figures === 'undefined' || !Figures.render) return null;
    if (item.figureSide && side && item.figureSide !== side) return null;
    try { return Figures.render(item.figure); }
    catch (e) { console.error(e); return null; }
  }

  /* ---------- formatting ---------- */

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function fmtDuration(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + ' s';
    var m = Math.floor(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function parseDay(s) {
    var p = String(s || '').split('-');
    if (p.length !== 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function fmtDue(s) {
    var d = parseDay(s);
    return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No due date';
  }

  function daysUntil(s) {
    var p = String(s || '').split('-');
    if (p.length !== 3) return null;
    var due = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    var t = new Date();
    var today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((due - today) / 86400000);
  }

  function dueInfo(s) {
    var n = daysUntil(s);
    if (n === null) return { text: 'No due date', cls: 'ok' };
    if (n < 0) return { text: plural(-n, 'day') + ' overdue', cls: 'overdue' };
    if (n === 0) return { text: 'Due today', cls: 'soon' };
    if (n === 1) return { text: 'Due tomorrow', cls: 'soon' };
    return { text: n + ' days left', cls: n <= 3 ? 'soon' : 'ok' };
  }

  function sortedMakeups() {
    // Dated entries first (soonest first), then entries with no due date, in the order they were added.
    return S.makeups.map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) {
      var ad = a.m.due || '', bd = b.m.due || '';
      if (ad && bd) return ad.localeCompare(bd) || a.i - b.i;
      if (ad || bd) return ad ? -1 : 1;
      return a.i - b.i;
    }).map(function (x) { return x.m; });
  }

  /* ---------- content helpers ---------- */

  function displayName() {
    return (S.firstName != null ? S.firstName : (CONTENT.app.studentFirstName || '')).trim();
  }
  function unitById(id) { return CONTENT.byId[id] || null; }

  /* ---------- make-up quizzes (from content/app.json makeupQuizzes) ---------- */

  function makeupCfg() { return CONTENT.makeupQuizzes || null; }
  function makeupQuizList() { var c = makeupCfg(); return c && Array.isArray(c.quizzes) ? c.quizzes : []; }
  function isPrepUnit(id) { return makeupQuizList().some(function (q) { return q.prepUnit === id; }); }
  function prepQuizFor(unitId) { return makeupQuizList().filter(function (q) { return q.prepUnit === unitId; })[0] || null; }
  function makeupQuizNote() {
    var c = makeupCfg();
    return c && c.note ? h('p', { class: 'mq-note', text: c.note }) : null;
  }

  function makeupQuizSection() {
    var c = makeupCfg();
    var list = makeupQuizList();
    if (!c || !list.length) return null;
    return h('section', { class: 'mq-section', 'aria-labelledby': 'mq-title' },
      h('h2', { id: 'mq-title', text: c.title || 'Make-up Quizzes' }),
      makeupQuizNote(),
      h('div', { class: 'mq-grid' }, list.map(function (q) {
        var u = unitById(q.prepUnit);
        if (!u) return null;
        var done = practiceSolved(u);
        var best = S.quizzes[u.id] && S.quizzes[u.id].best;
        return h('a', { class: 'mq-card', href: '#/unit/' + encodeURIComponent(u.id) },
          h('div', { class: 'row-between' }, h('h3', { text: q.name }), h('span', { class: 'badge ok', text: 'No due date' })),
          q.detail ? h('p', { class: 'muted small', text: q.detail }) : null,
          progressBar(done, u.practice.length),
          h('div', { class: 'row-between small muted' },
            h('span', { text: done + '/' + u.practice.length + ' prep problems' }),
            h('span', { text: best ? 'Prep quiz best ' + best.pct + '%' : 'Prep quiz not taken' })),
          h('span', { class: 'mq-go', text: 'Start prep ›' }));
      })),
      c.source ? h('p', { class: 'muted small', text: c.source }) : null);
  }

  /* ---------- terms (pacing guide sections) ---------- */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDay(s) {
    var d = parseDay(s);
    return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() : '';
  }
  function termById(id) {
    return (CONTENT.terms || []).filter(function (t) { return t.id === id; })[0] || null;
  }
  function termOf(unitId) {
    return (CONTENT.terms || []).filter(function (t) { return (t.units || []).indexOf(unitId) !== -1; })[0] || null;
  }
  function termShortLabel(t) {
    var range = t.start && t.end ? shortDay(t.start) + ' – ' + shortDay(t.end) : '';
    return t.label + (range ? ' · ' + range : '');
  }
  /* The term whose dates include today; between terms, the next one; after the last, the last. */
  function currentTermId() {
    var terms = CONTENT.terms || [];
    if (!terms.length) return null;
    var t = new Date();
    var today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    var i, start, end;
    for (i = 0; i < terms.length; i++) {
      start = parseDay(terms[i].start); end = parseDay(terms[i].end);
      if (start && end && today >= start.getTime() && today <= end.getTime()) return terms[i].id;
    }
    for (i = 0; i < terms.length; i++) {
      start = parseDay(terms[i].start);
      if (start && start.getTime() > today) return terms[i].id;
    }
    return terms[terms.length - 1].id;
  }
  function practiceSolved(unit) {
    return unit.practice.filter(function (p) { var r = S.practice[p.id]; return r && r.status === 'correct'; }).length;
  }
  function practiceFirstTry(unit) {
    return unit.practice.filter(function (p) { var r = S.practice[p.id]; return r && r.firstTryCorrect; }).length;
  }
  function cardsKnown(unit) {
    return unit.flashcards.filter(function (c) { return S.cards[c.id] === 'know'; }).length;
  }
  function quizText(a) {
    return a ? a.score + '/' + a.total + ' (' + a.pct + '%)' : '—';
  }

  /* ---------- study timer (only on practice / cards / quiz screens) ---------- */

  var Timer = {
    unitId: null, last: 0, lastInput: Date.now(), session: 0, iv: null,
    start: function (unitId) {
      this.stop();
      this.unitId = unitId;
      this.last = Date.now();
      this.lastInput = Date.now();
      this.session = 0;
      var self = this;
      this.iv = setInterval(function () { self.tick(); }, 1000);
    },
    tick: function () {
      var now = Date.now();
      var dt = (now - this.last) / 1000;
      this.last = now;
      if (!this.unitId || document.hidden) return;
      if (now - this.lastInput > IDLE_MS) return;
      if (dt <= 0 || dt > 5) return; // phone slept or tab was frozen
      Store.addTime(this.unitId, dt);
      this.session += dt;
    },
    resetSession: function () { this.session = 0; },
    stop: function () {
      if (this.iv) clearInterval(this.iv);
      this.iv = null;
      this.unitId = null;
      Store.flush();
    }
  };

  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, function () { Timer.lastInput = Date.now(); }, { passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Store.flush();
    else Timer.last = Date.now();
  });
  window.addEventListener('pagehide', function () { Store.flush(); });
  setInterval(function () { Store.flush(); }, 10000);

  /* ---------- shared UI pieces ---------- */

  function backLink(href, label) {
    return h('a', { class: 'back', href: href }, '‹ ' + label);
  }

  function progressBar(done, total) {
    var pct = total ? Math.round(100 * done / total) : 0;
    var fill = h('span', {});
    fill.style.width = pct + '%'; // CSSOM (allowed by the page's CSP), not a style attribute
    return h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) }, fill);
  }

  function stat(value, label) {
    return h('div', { class: 'stat' }, h('strong', { text: String(value) }), h('span', { text: label }));
  }

  function badge(info) {
    return h('span', { class: 'badge ' + info.cls, text: info.text });
  }

  var SYMBOLS = {
    numeric: [['√', '√'], ['π', 'π'], ['/', '/'], ['^', '^'], ['−', '-'], ['(', '('], [')', ')']],
    multi: [[',', ', '], ['±', '±'], ['√', '√'], ['/', '/'], ['−', '-']],
    pair: [['(', '('], [')', ')'], [',', ', '], ['−', '-'], ['/', '/']],
    short: [['<', '<'], ['>', '>'], ['≤', '≤'], ['≥', '≥'], ['−', '-'], ['=', '=']]
  };
  var FORMAT_HELP = {
    numeric: 'Exact answers like 7√2, 12π, or 3/5 are fine. You can type sqrt and pi. Units are optional.',
    multi: 'Separate answers with a comma, like 2, -5. Order doesn\'t matter.',
    pair: 'Type an ordered pair, like (3, -2).',
    short: 'Spaces don\'t matter.'
  };
  var PLACEHOLDER = { numeric: 'Your answer', multi: 'e.g. 2, -5', pair: 'e.g. (3, -2)', short: 'Your answer' };

  /* Returns { node, value(), lock(), focus() } */
  function answerWidget(item, onEnter) {
    if (item.type === 'mcq') {
      var selected = null;
      var buttons = [];
      var wrap = h('div', { class: 'choices', role: 'group', 'aria-label': 'Answer choices' });
      item.choices.forEach(function (choice) {
        var b = h('button', {
          type: 'button', class: 'choice', 'aria-pressed': 'false',
          onclick: function () {
            selected = choice;
            buttons.forEach(function (x) { x.classList.remove('selected'); x.setAttribute('aria-pressed', 'false'); });
            b.classList.add('selected');
            b.setAttribute('aria-pressed', 'true');
          }
        }, choice);
        buttons.push(b);
        wrap.appendChild(b);
      });
      return {
        node: wrap,
        value: function () { return selected; },
        lock: function () { buttons.forEach(function (b) { b.disabled = true; }); },
        mark: function (answer) {
          buttons.forEach(function (b) { if (b.textContent === answer) b.classList.add('correct'); });
        },
        focus: function () {}
      };
    }
    var type = SYMBOLS[item.type] ? item.type : 'short';
    var input = h('input', {
      type: 'text', class: 'answer-input', placeholder: PLACEHOLDER[type],
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      'aria-label': 'Your answer', enterkeyhint: 'done',
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }
    });
    var keys = h('div', { class: 'symkeys', 'aria-label': 'Math symbols' });
    SYMBOLS[type].forEach(function (pair) {
      keys.appendChild(h('button', {
        type: 'button', class: 'symkey', 'aria-label': 'Insert ' + pair[0],
        onmousedown: function (e) { e.preventDefault(); },
        onclick: function () { insertAtCursor(input, pair[1]); }
      }, pair[0]));
    });
    return {
      node: h('div', { class: 'answer' }, input, keys, h('p', { class: 'help', text: FORMAT_HELP[type] })),
      value: function () { return input.value; },
      lock: function () { input.readOnly = true; keys.querySelectorAll('button').forEach(function (b) { b.disabled = true; }); },
      mark: function () {},
      focus: function () { input.focus(); }
    };
  }

  function insertAtCursor(input, text) {
    if (input.readOnly) return;
    var s = input.selectionStart, e = input.selectionEnd;
    if (s == null) { input.value += text; }
    else {
      input.value = input.value.slice(0, s) + text + input.value.slice(e);
      input.selectionStart = input.selectionEnd = s + text.length;
    }
    input.focus();
  }

  function feedback(kind, text) {
    return h('div', { class: 'feedback ' + kind, role: 'status', 'aria-live': 'polite', text: text });
  }

  /* ---------- screens ---------- */

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function renderHome() {
    var name = displayName();
    var totalPractice = 0, solved = 0;
    CONTENT.units.forEach(function (u) { totalPractice += u.practice.length; solved += practiceSolved(u); });

    var tip = null;
    if (isIOS() && !isStandalone() && !S.tipDismissed) {
      tip = h('div', { class: 'tip' },
        h('p', {}, h('strong', { text: 'Add Math Lab to your Home Screen: ' }),
          'in Safari, tap the Share button (square with an arrow), then "Add to Home Screen". It opens like an app and works offline.'),
        h('button', { type: 'button', class: 'link', onclick: function () { S.tipDismissed = true; Store.save(); tip.remove(); } }, 'Got it'));
    }

    var upcoming = sortedMakeups().slice(0, 3);
    var makeupBox = h('section', { class: 'card' },
      h('div', { class: 'row-between' }, h('h2', { text: 'Make-up tests' }), h('a', { href: '#/makeup', class: 'small' }, 'See all ›')),
      upcoming.length
        ? h('ul', { class: 'mini-list' }, upcoming.map(function (m) {
          var u = m.unitId ? unitById(m.unitId) : null;
          return h('li', {},
            h('div', {}, h('strong', { text: m.name }), h('div', { class: 'muted small', text: fmtDue(m.due) + (u ? ' · ' + u.title : '') })),
            badge(dueInfo(m.due)));
        }))
        : h('p', { class: 'muted', text: 'None added yet. When the list from ' + (CONTENT.app.teacher || 'your teacher') + ' arrives, add each test and its due date here.' }));

    var groups = termSections();

    show(
      h('section', { class: 'hero' },
        h('h1', { text: name ? 'Aloha, ' + name : 'Aloha' }),
        h('p', { class: 'muted', text: [CONTENT.app.course, CONTENT.app.teacher].filter(Boolean).join(' · ') })),
      makeupQuizSection(),
      tip,
      h('div', { class: 'stats' },
        stat(Store.streak(), Store.streak() === 1 ? 'day streak' : 'day streak'),
        stat(fmtDuration(S.totalSeconds), 'studied'),
        stat(solved + '/' + totalPractice, 'problems solved')),
      h('p', { class: 'muted small', text: 'Your progress is saved only in this browser on this device' +
        (isStandalone() ? ' (this Home Screen app)' : '') +
        '. It does not sync to other phones, computers, or browsers' +
        (isIOS() ? ', and the Home Screen app and Safari keep separate copies' : '') + '.' }),
      makeupBox,
      groups,
      h('p', { class: 'notice', text: CONTENT.app.contentNotice || '' })
    );
  }

  /* One collapsible section per term. The current term is open and badged "Now". */
  function termSections() {
    var nowId = currentTermId();
    var placed = {};
    var out = [h('h2', { class: 'group-title', text: 'Units by term' })];
    (CONTENT.terms || []).forEach(function (t) {
      var units = (t.units || []).map(unitById).filter(Boolean);
      if (!units.length) return;
      units.forEach(function (u) { placed[u.id] = true; });
      var isNow = t.id === nowId;
      var body = [];
      var grouped = {};
      (t.groups || []).forEach(function (g) {
        var gu = (g.units || []).map(unitById).filter(function (u) { return u && (t.units || []).indexOf(u.id) !== -1; });
        if (!gu.length) return;
        gu.forEach(function (u) { grouped[u.id] = true; });
        body.push(h('h3', { class: 'subgroup-title', text: g.label }));
        body.push(h('div', { class: 'unit-grid' }, gu.map(unitCard)));
      });
      var rest = units.filter(function (u) { return !grouped[u.id]; });
      if (rest.length) body.push(h('div', { class: 'unit-grid' }, rest.map(unitCard)));
      out.push(h('details', { class: 'term' + (isNow ? ' now' : ''), id: 'term-' + t.id, open: isNow },
        h('summary', {},
          h('span', { class: 'term-head' },
            h('span', { class: 'term-name', text: t.label }),
            t.dates ? h('span', { class: 'term-dates', text: t.dates }) : null,
            h('span', { class: 'term-topics', text: units.map(function (u) { return u.title; }).join(' · ') })),
          isNow ? h('span', { class: 'badge now', text: 'Now' }) : null),
        body));
    });
    var other = CONTENT.units.filter(function (u) { return !placed[u.id] && !isPrepUnit(u.id); });
    if (other.length) {
      out.push(h('details', { class: 'term', id: 'term-other', open: !(CONTENT.terms || []).length },
        h('summary', {}, h('span', { class: 'term-head' }, h('span', { class: 'term-name', text: 'Other' })),
          h('span', { class: 'term-count muted small', text: plural(other.length, 'unit') })),
        h('div', { class: 'unit-grid' }, other.map(unitCard))));
    }
    return out;
  }

  function unitCard(u) {
    var done = practiceSolved(u);
    var q = S.quizzes[u.id];
    return h('a', { class: 'unit-card', href: '#/unit/' + encodeURIComponent(u.id) },
      h('div', { class: 'row-between' },
        h('h3', { text: u.title }),
        u.status === 'starter' ? h('span', { class: 'tag', text: 'starter' }) : null),
      h('p', { class: 'muted small clamp', text: u.description || '' }),
      progressBar(done, u.practice.length),
      h('div', { class: 'row-between small muted' },
        h('span', { text: done + '/' + u.practice.length + ' practice' }),
        h('span', { text: q && q.best ? 'Quiz best ' + q.best.pct + '%' : 'Quiz not taken' })));
  }

  function renderUnit(id) {
    var u = unitById(id);
    if (!u) return notFound();
    var q = S.quizzes[u.id];
    var linked = sortedMakeups().filter(function (m) { return m.unitId === u.id; });
    show(
      backLink('#/', 'Home'),
      termOf(u.id) ? h('p', { class: 'term-line' }, h('span', { class: 'term-chip' + (termOf(u.id).id === currentTermId() ? ' now' : ''), text: termShortLabel(termOf(u.id)) })) : null,
      isPrepUnit(u.id) ? h('p', { class: 'term-line' }, h('span', { class: 'term-chip mq-chip', text: 'Make-up quiz prep' })) : null,
      h('h1', { text: u.title }),
      isPrepUnit(u.id) ? makeupQuizNote() : null,
      relatedLinks(u),
      referenceCard(u.reference),
      u.status === 'starter' ? h('p', { class: 'tag-line' }, h('span', { class: 'tag', text: 'starter set' }), ' Practice content, not official class material.') : null,
      h('p', { class: 'muted', text: u.description || '' }),
      linked.length ? h('section', { class: 'card' }, h('h2', { text: 'Make-up tests for this unit' }),
        h('ul', { class: 'mini-list' }, linked.map(function (m) {
          return h('li', {}, h('div', {}, h('strong', { text: m.name }), h('div', { class: 'muted small', text: fmtDue(m.due) })), badge(dueInfo(m.due)));
        }))) : null,
      h('div', { class: 'actions' },
        actionCard('#/practice/' + encodeURIComponent(u.id) + '/0', 'Practice', 'One problem at a time, with hints and worked solutions.',
          practiceSolved(u) + '/' + u.practice.length + ' solved'),
        actionCard('#/cards/' + encodeURIComponent(u.id), 'Flashcards', 'Definitions, theorems, and formulas to remember.',
          cardsKnown(u) + '/' + u.flashcards.length + ' known'),
        actionCard('#/quiz/' + encodeURIComponent(u.id), 'Quiz', plural(u.quiz.length, 'question') + ', scored. No hints.',
          q && q.latest ? 'Latest ' + q.latest.pct + '% · Best ' + q.best.pct + '%' : 'Not taken yet'))
    );
  }

  function relatedLinks(u) {
    var rel = (u.related || []).map(unitById).filter(Boolean);
    if (!rel.length) return null;
    var kids = ['Related units: '];
    rel.forEach(function (r, i) {
      if (i) kids.push(' · ');
      kids.push(h('a', { href: '#/unit/' + encodeURIComponent(r.id), text: r.title }));
    });
    return h('p', { class: 'small related' }, kids);
  }

  /* Optional quick-reference card: unit.reference = { title, rows: [{ label, rule, note? }], foot? }.
   * rule/note may use <sup> (our own content, checked by tools/validate.py). */
  function referenceCard(ref) {
    if (!ref || !ref.rows || !ref.rows.length) return null;
    var dl = h('dl', { class: 'ref-rows' });
    ref.rows.forEach(function (r) {
      dl.appendChild(h('dt', { text: r.label }));
      dl.appendChild(h('dd', {}, h('span', { html: r.rule }), r.note ? h('span', { class: 'ref-note', html: ' (' + r.note + ')' }) : null));
    });
    return h('section', { class: 'card ref-card', 'aria-label': ref.title || 'Quick reference' },
      h('h2', { text: ref.title || 'Quick reference' }), dl,
      ref.foot ? h('p', { class: 'muted small ref-foot', html: ref.foot }) : null);
  }

  function actionCard(href, title, desc, meta) {
    return h('a', { class: 'action-card', href: href },
      h('h2', { text: title }), h('p', { class: 'muted small', text: desc }), h('span', { class: 'meta', text: meta }));
  }

  function notFound() {
    show(backLink('#/', 'Home'), h('h1', { text: 'Not found' }), h('p', { text: 'That page or unit does not exist.' }));
  }

  /* ----- practice ----- */

  function renderPractice(id, idx) {
    var u = unitById(id);
    if (!u || !u.practice.length) return notFound();
    if (!(idx >= 0)) idx = 0;
    if (idx >= u.practice.length) idx = u.practice.length - 1;
    var item = u.practice[idx];
    var hintsShown = 0;
    var checkedOnce = false;
    Timer.start(u.id);

    var dots = h('div', { class: 'dots', 'aria-label': 'Problems' }, u.practice.map(function (p, i) {
      var r = S.practice[p.id];
      var cls = 'dot' + (r ? (r.status === 'correct' ? ' ok' : ' tried') : '') + (i === idx ? ' current' : '');
      return h('a', { class: cls, href: '#/practice/' + encodeURIComponent(u.id) + '/' + i, 'aria-label': 'Problem ' + (i + 1) }, String(i + 1));
    }));

    var fbBox = h('div', {});
    var hintList = h('ol', { class: 'hints' });
    var hintBtn = h('button', { type: 'button', class: 'btn secondary', onclick: showHint });
    var solBox = h('div', { class: 'solution', hidden: true },
      h('h3', { text: 'Worked solution' }), h('div', { html: item.solution }));
    var solBtn = h('button', { type: 'button', class: 'btn secondary', hidden: true, onclick: function () { solBox.hidden = false; solBtn.hidden = true; } }, 'Show worked solution');
    var widget = answerWidget(item, doCheck);
    var checkBtn = h('button', { type: 'button', class: 'btn primary', onclick: doCheck }, 'Check');

    function updateHintBtn() {
      var n = (item.hints || []).length;
      if (hintsShown >= n) { hintBtn.textContent = 'No more hints'; hintBtn.disabled = true; }
      else hintBtn.textContent = 'Show hint (' + (hintsShown + 1) + ' of ' + n + ')';
    }
    function showHint() {
      if (hintsShown >= item.hints.length) return;
      hintList.appendChild(h('li', { html: item.hints[hintsShown] }));
      hintsShown++;
      updateHintBtn();
    }
    function doCheck() {
      var val = widget.value();
      fbBox.innerHTML = '';
      if (val == null || String(val).trim() === '') {
        fbBox.appendChild(feedback('warn', 'Type or pick an answer first.'));
        return;
      }
      var res = MathCheck.check(item, val);
      if (!res.readable) {
        fbBox.appendChild(feedback('warn', 'I couldn\'t read that answer. Check the format tip under the box.'));
        return;
      }
      Store.recordPractice(item.id, u.id, res.ok, hintsShown);
      checkedOnce = true;
      if (res.ok) {
        fbBox.appendChild(feedback('good', 'Correct! Nice work.'));
        widget.lock();
        widget.mark(item.answer);
        checkBtn.disabled = true;
      } else {
        fbBox.appendChild(feedback('bad', 'Not quite. Try a hint or try again.'));
      }
      if (checkedOnce && solBox.hidden) solBtn.hidden = false;
      var dot = dots.children[idx];
      if (dot) { dot.classList.remove('tried'); dot.classList.add(res.ok || (S.practice[item.id] && S.practice[item.id].status === 'correct') ? 'ok' : 'tried'); }
    }
    updateHintBtn();

    var prev = idx > 0 ? h('a', { class: 'btn ghost', href: '#/practice/' + encodeURIComponent(u.id) + '/' + (idx - 1) }, '‹ Previous') : h('span', {});
    var next = idx < u.practice.length - 1
      ? h('a', { class: 'btn ghost', href: '#/practice/' + encodeURIComponent(u.id) + '/' + (idx + 1) }, 'Next ›')
      : h('a', { class: 'btn ghost', href: '#/unit/' + encodeURIComponent(u.id) }, 'Done ›');

    var prior = S.practice[item.id];
    show(
      backLink('#/unit/' + encodeURIComponent(u.id), u.title),
      h('div', { class: 'row-between' }, h('h1', { class: 'h-small', text: 'Practice' }), h('span', { class: 'muted', text: 'Problem ' + (idx + 1) + ' of ' + u.practice.length })),
      dots,
      h('section', { class: 'card problem' },
        prior && prior.status === 'correct' ? h('p', { class: 'muted small', text: '✓ You solved this one before. Try it again for practice.' }) : null,
        h('div', { class: 'prompt', html: item.prompt }),
        figureFor(item),
        widget.node,
        h('div', { class: 'btn-row' }, checkBtn, hintBtn),
        fbBox,
        hintList,
        solBtn,
        solBox),
      h('div', { class: 'pager' }, prev, next)
    );
  }

  /* ----- flashcards ----- */

  function renderCards(id) {
    var u = unitById(id);
    if (!u || !u.flashcards.length) return notFound();
    Timer.start(u.id);
    var order = u.flashcards.map(function (_, i) { return i; });
    var onlyLearning = false;
    var pos = 0;
    var flipped = false;
    var stage = h('div', {});

    function deck() {
      if (!onlyLearning) return order;
      return order.filter(function (i) { return S.cards[u.flashcards[i].id] !== 'know'; });
    }
    function shuffle() {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      pos = 0; flipped = false; draw();
    }
    function mark(value) {
      var d = deck();
      var card = u.flashcards[d[pos]];
      Store.recordCard(card.id, u.id, value);
      var after = deck();
      if (onlyLearning) { if (pos >= after.length) pos = 0; }
      else { pos = (pos + 1) % after.length; }
      flipped = false;
      draw();
    }
    function draw() {
      stage.innerHTML = '';
      var d = deck();
      var known = cardsKnown(u);
      var learningCount = u.flashcards.length - known;
      var toolbar = h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn ghost', onclick: shuffle }, 'Shuffle'),
        h('button', {
          type: 'button', class: 'btn ghost' + (onlyLearning ? ' active' : ''), 'aria-pressed': onlyLearning ? 'true' : 'false',
          onclick: function () { onlyLearning = !onlyLearning; pos = 0; flipped = false; draw(); }
        }, onlyLearning ? 'Showing: still learning (' + learningCount + ')' : 'Show only still learning'));
      if (!d.length) {
        add(stage, [toolbar, h('section', { class: 'card center' },
          h('h2', { text: 'You know all ' + u.flashcards.length + ' cards!' }),
          h('p', { class: 'muted', text: 'Turn off the filter to review them all, or try the quiz.' }),
          h('a', { class: 'btn primary', href: '#/quiz/' + encodeURIComponent(u.id) }, 'Take the quiz'))]);
        return;
      }
      if (pos >= d.length) pos = 0;
      var card = u.flashcards[d[pos]];
      var status = S.cards[card.id];
      var cardBtn = h('button', {
        type: 'button', class: 'flashcard' + (flipped ? ' flipped' : ''), 'aria-live': 'polite',
        onclick: function () { flipped = !flipped; draw(); }
      },
        h('span', { class: 'side-label', text: flipped ? 'Back' : 'Front' }),
        h('span', { class: 'fc-text', html: flipped ? card.back : card.front }),
        figureFor(card, flipped ? 'back' : 'front'),
        h('span', { class: 'fc-hint', text: flipped ? 'Tap to see the front' : 'Tap to flip' }));
      add(stage, [
        toolbar,
        h('p', { class: 'muted center', text: 'Card ' + (pos + 1) + ' of ' + d.length + ' · ' + known + '/' + u.flashcards.length + ' known' + (status ? ' · marked "' + (status === 'know' ? 'know it' : 'still learning') + '"' : '') }),
        cardBtn,
        h('div', { class: 'btn-row two' },
          h('button', { type: 'button', class: 'btn secondary', onclick: function () { mark('learning'); } }, 'Still learning'),
          h('button', { type: 'button', class: 'btn primary', onclick: function () { mark('know'); } }, 'I know it')),
        h('div', { class: 'pager' },
          h('button', { type: 'button', class: 'btn ghost', onclick: function () { pos = (pos - 1 + d.length) % d.length; flipped = false; draw(); } }, '‹ Previous'),
          h('button', { type: 'button', class: 'btn ghost', onclick: function () { pos = (pos + 1) % d.length; flipped = false; draw(); } }, 'Next ›'))
      ]);
    }

    show(backLink('#/unit/' + encodeURIComponent(u.id), u.title), h('h1', { class: 'h-small', text: 'Flashcards' }), stage);
    draw();
  }

  /* ----- quiz ----- */

  function renderQuiz(id) {
    var u = unitById(id);
    if (!u || !u.quiz.length) return notFound();
    var stage = h('div', {});
    var answers = [];
    var i = 0;

    function intro() {
      Timer.stop();
      var q = S.quizzes[u.id];
      stage.innerHTML = '';
      add(stage, h('section', { class: 'card' },
        h('h2', { text: plural(u.quiz.length, 'question') }),
        h('p', { class: 'muted', text: 'No hints during the quiz. You\'ll see the worked solutions at the end. Your score and time are saved on this device.' }),
        q && q.latest ? h('p', {}, 'Latest: ' + quizText(q.latest) + ' · Best: ' + quizText(q.best)) : null,
        h('button', { type: 'button', class: 'btn primary', onclick: start }, q && q.latest ? 'Retake quiz' : 'Start quiz'),
        q && q.history && q.history.length ? h('details', { class: 'history' },
          h('summary', { text: 'Past attempts' }),
          h('ul', {}, q.history.slice().reverse().map(function (a) {
            return h('li', { text: fmtDateTime(a.at) + ' — ' + quizText(a) + ' in ' + fmtDuration(a.seconds) });
          }))) : null));
    }
    function start() {
      answers = [];
      i = 0;
      Timer.start(u.id);
      Timer.resetSession();
      question();
    }
    function question() {
      var item = u.quiz[i];
      var done = false;
      var fbBox = h('div', {});
      var widget = answerWidget(item, function () { if (!done) submit(); else nextBtn.click(); });
      var submitBtn = h('button', { type: 'button', class: 'btn primary', onclick: submit }, 'Check');
      var nextBtn = h('button', { type: 'button', class: 'btn primary', hidden: true, onclick: function () { i++; if (i < u.quiz.length) question(); else results(); } },
        i < u.quiz.length - 1 ? 'Next question ›' : 'See results');
      function submit() {
        var val = widget.value();
        fbBox.innerHTML = '';
        if (val == null || String(val).trim() === '') { fbBox.appendChild(feedback('warn', 'Type or pick an answer first.')); return; }
        var res = MathCheck.check(item, val);
        if (!res.readable) { fbBox.appendChild(feedback('warn', 'I couldn\'t read that answer. Check the format tip under the box.')); return; }
        done = true;
        answers.push({ item: item, given: String(val), ok: res.ok });
        widget.lock();
        widget.mark(item.answer);
        fbBox.appendChild(res.ok ? feedback('good', 'Correct!') : feedback('bad', 'Not quite. Answer: ' + item.answer));
        submitBtn.hidden = true;
        nextBtn.hidden = false;
        nextBtn.focus();
      }
      stage.innerHTML = '';
      add(stage, [
        h('p', { class: 'muted', text: 'Question ' + (i + 1) + ' of ' + u.quiz.length }),
        progressBar(i, u.quiz.length),
        h('section', { class: 'card problem' },
          h('div', { class: 'prompt', html: item.prompt }),
          figureFor(item),
          widget.node,
          h('div', { class: 'btn-row' }, submitBtn, nextBtn),
          fbBox)
      ]);
      window.scrollTo(0, 0);
    }
    function results() {
      var score = answers.filter(function (a) { return a.ok; }).length;
      var prevBest = S.quizzes[u.id] && S.quizzes[u.id].best;
      var attempt = Store.recordQuiz(u.id, score, u.quiz.length, Timer.session);
      Timer.stop();
      var isBest = !prevBest || attempt.pct > prevBest.pct;
      var msg = attempt.pct >= 90 ? 'Excellent work!' : attempt.pct >= 70 ? 'Solid. Review the misses below.' : 'Good effort. Go through the solutions, then try the practice set again.';
      stage.innerHTML = '';
      add(stage, [
        h('section', { class: 'card center' },
          h('p', { class: 'big-score', text: score + ' / ' + u.quiz.length }),
          h('p', { text: attempt.pct + '% · ' + fmtDuration(attempt.seconds) + (isBest && prevBest ? ' · New best!' : '') }),
          h('p', { class: 'muted', text: msg }),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn primary', onclick: start }, 'Retake'),
            h('a', { class: 'btn ghost', href: '#/unit/' + encodeURIComponent(u.id) }, 'Back to unit'))),
        h('h2', { text: 'Review' }),
        answers.map(function (a, n) {
          return h('details', { class: 'review ' + (a.ok ? 'ok' : 'miss'), open: !a.ok },
            h('summary', {}, (a.ok ? '✓ ' : '✗ ') + 'Question ' + (n + 1)),
            h('div', { class: 'prompt', html: a.item.prompt }),
            figureFor(a.item),
            h('p', {}, h('span', { class: 'muted', text: 'Your answer: ' }), a.given),
            a.ok ? null : h('p', {}, h('span', { class: 'muted', text: 'Correct answer: ' }), a.item.answer),
            h('div', { class: 'solution', html: a.item.solution }));
        })
      ]);
      window.scrollTo(0, 0);
    }

    show(backLink('#/unit/' + encodeURIComponent(u.id), u.title), h('h1', { class: 'h-small', text: u.title + ' quiz' }), stage);
    intro();
  }

  /* ----- make-up tests ----- */

  function unitOptions() {
    var out = [];
    var placed = {};
    function opt(u) { placed[u.id] = true; return h('option', { value: u.id }, u.title); }
    (CONTENT.terms || []).forEach(function (t) {
      var units = (t.units || []).map(unitById).filter(Boolean);
      if (units.length) out.push(h('optgroup', { label: t.label }, units.map(opt)));
    });
    var prep = CONTENT.units.filter(function (u) { return !placed[u.id] && isPrepUnit(u.id); });
    if (prep.length) out.unshift(h('optgroup', { label: 'Make-up quiz prep' }, prep.map(opt)));
    var other = CONTENT.units.filter(function (u) { return !placed[u.id]; });
    if (other.length) out.push(out.length ? h('optgroup', { label: 'Other' }, other.map(opt)) : other.map(opt));
    return out;
  }

  function renderMakeups(editId) {
    var editing = null;
    if (editId === 'new') editing = { id: null, name: '', due: '', unitId: '', notes: '' };
    else if (editId) editing = S.makeups.filter(function (m) { return m.id === editId; })[0] || null;

    var list = sortedMakeups();
    var items = list.map(function (m) {
      var u = m.unitId ? unitById(m.unitId) : null;
      return h('li', { class: 'makeup' },
        h('div', { class: 'row-between' }, h('strong', { text: m.name }), badge(dueInfo(m.due))),
        h('div', { class: 'muted small', text: m.due ? 'Due ' + fmtDue(m.due) : 'No due date given' }),
        u ? h('div', { class: 'small' }, 'Unit: ', h('a', { href: '#/unit/' + encodeURIComponent(u.id), text: u.title })) : null,
        m.notes ? h('p', { class: 'notes', text: m.notes }) : null,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: function () { renderMakeups(m.id); } }, 'Edit'),
          h('button', {
            type: 'button', class: 'btn ghost small danger', onclick: function () {
              if (window.confirm('Delete "' + m.name + '" from the make-up list?')) { Store.removeMakeup(m.id); renderMakeups(); }
            }
          }, 'Delete')));
    });

    var form = null;
    if (editing) {
      var nameIn = h('input', { type: 'text', id: 'mu-name', value: editing.name, maxlength: '80', required: true, placeholder: 'e.g. Unit 3 Test: Right Triangles' });
      var dueIn = h('input', { type: 'date', id: 'mu-due', value: editing.due || '' });
      var unitSel = h('select', { id: 'mu-unit' }, h('option', { value: '' }, '— none —'), unitOptions());
      unitSel.value = editing.unitId || '';
      var notesIn = h('textarea', { id: 'mu-notes', rows: '3', maxlength: '500', placeholder: 'Room, time, what to bring, topics…' });
      notesIn.value = editing.notes || '';
      var err = h('p', { class: 'error', role: 'alert' });
      form = h('form', {
        class: 'card form', onsubmit: function (e) {
          e.preventDefault();
          var name = nameIn.value.trim();
          if (!name) { err.textContent = 'Please enter the test name.'; return; }
          if (dueIn.value && !/^\d{4}-\d{2}-\d{2}$/.test(dueIn.value)) { err.textContent = 'Please pick a valid date, or leave it blank.'; return; }
          Store.upsertMakeup({ id: editing.id, name: name, due: dueIn.value, unitId: unitSel.value || null, notes: notesIn.value.trim() });
          renderMakeups();
        }
      },
        h('h2', { text: editing.id ? 'Edit make-up test' : 'Add a make-up test' }),
        h('label', { for: 'mu-name' }, 'Test name'), nameIn,
        h('label', { for: 'mu-due' }, 'Due date (optional)'), dueIn,
        h('label', { for: 'mu-unit' }, 'Linked unit (optional)'), unitSel,
        h('label', { for: 'mu-notes' }, 'Notes (optional)'), notesIn,
        err,
        h('div', { class: 'btn-row' },
          h('button', { type: 'submit', class: 'btn primary' }, 'Save'),
          h('button', { type: 'button', class: 'btn ghost', onclick: function () { renderMakeups(); } }, 'Cancel')));
    }

    show(
      h('h1', { text: 'Make-up tests' }),
      h('p', { class: 'muted', text: 'Keep track of the tests to make up and when each is due. Saved only on this device.' }),
      makeupQuizNote(),
      form,
      editing ? null : h('button', { type: 'button', class: 'btn primary', onclick: function () { renderMakeups('new'); } }, '+ Add a make-up test'),
      list.length ? h('ul', { class: 'makeup-list' }, items)
        : (editing ? null : h('p', { class: 'muted', text: 'No make-up tests yet. Add each one from ' + (CONTENT.app.teacher || 'the teacher') + '\'s list when it arrives.' }))
    );
    if (editing) { var f = document.getElementById('mu-name'); if (f) f.focus(); }
  }

  /* ----- parent view ----- */

  function pinInput(id, label) {
    return [h('label', { for: id }, label),
      h('input', { type: 'password', id: id, inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '8' })];
  }
  function val(id) { var n = document.getElementById(id); return n ? n.value.trim() : ''; }

  function renderParent() {
    if (!Store.hasPin()) {
      var err = h('p', { class: 'error', role: 'alert' });
      show(
        h('h1', { text: 'Parent view' }),
        h('form', {
          class: 'card form', onsubmit: function (e) {
            e.preventDefault();
            var a = val('pin-new'), b = val('pin-confirm');
            if (!/^\d{4,8}$/.test(a)) { err.textContent = 'Use 4 to 8 digits.'; return; }
            if (a !== b) { err.textContent = 'The two PINs don\'t match.'; return; }
            Store.setPin(a);
            parentUnlocked = true;
            renderParent();
          }
        },
          h('h2', { text: 'Set a parent PIN' }),
          h('p', { class: 'muted', text: 'Scores and time spent are shown after you set a PIN on this device. It is a simple courtesy lock for a shared phone, not real security.' }),
          h('p', { class: 'muted small', text: 'Pick a PIN you will remember. There is no reset link: the only way past a forgotten PIN is to clear this site\'s data in Safari settings, and that also erases all of the student\'s progress and the make-up test list.' }),
          pinInput('pin-new', 'New PIN (4–8 digits)'),
          pinInput('pin-confirm', 'Type it again'),
          err,
          h('button', { type: 'submit', class: 'btn primary' }, 'Set PIN')));
      return;
    }
    if (!parentUnlocked) {
      var err2 = h('p', { class: 'error', role: 'alert' });
      show(
        h('h1', { text: 'Parent view' }),
        h('form', {
          class: 'card form', onsubmit: function (e) {
            e.preventDefault();
            if (Store.checkPin(val('pin-enter'))) { parentUnlocked = true; renderParent(); }
            else { err2.textContent = 'That PIN didn\'t match.'; document.getElementById('pin-enter').value = ''; }
          }
        },
          pinInput('pin-enter', 'Enter the parent PIN'),
          err2,
          h('button', { type: 'submit', class: 'btn primary' }, 'Open')));
      var f = document.getElementById('pin-enter'); if (f) f.focus();
      return;
    }
    renderReport();
  }

  function unitSummaries() {
    return CONTENT.units.map(function (u) {
      var q = S.quizzes[u.id] || {};
      return {
        id: u.id, title: u.title, term: termOf(u.id) ? termOf(u.id).label : (isPrepUnit(u.id) ? 'Make-up prep' : ''),
        practiceSolved: practiceSolved(u), practiceFirstTry: practiceFirstTry(u), practiceTotal: u.practice.length,
        cardsKnown: cardsKnown(u), cardsTotal: u.flashcards.length,
        seconds: Math.round(S.time[u.id] || 0),
        quizLatest: q.latest || null, quizBest: q.best || null, quizAttempts: (q.history || []).length
      };
    });
  }

  function lastStudiedText() {
    if (!S.lastStudied) return 'Not yet';
    var u = S.lastStudied.unitId ? unitById(S.lastStudied.unitId) : null;
    return fmtDateTime(S.lastStudied.at) + (u ? ' (' + u.title + ')' : '');
  }

  function textReport() {
    var lines = [];
    var name = displayName();
    lines.push(CONTENT.app.title + ' progress report' + (name ? ' — ' + name : ''));
    lines.push('Generated: ' + fmtDateTime(new Date().toISOString()));
    lines.push('Streak: ' + plural(Store.streak(), 'day') + ' | Total study time: ' + fmtDuration(S.totalSeconds) + ' | Last studied: ' + lastStudiedText());
    lines.push('');
    lines.push('Units (in class pacing order):');
    unitSummaries().forEach(function (s) {
      lines.push('- ' + (s.term ? '[' + s.term + '] ' : '') + s.title + ': practice ' + s.practiceSolved + '/' + s.practiceTotal + ' solved (' + s.practiceFirstTry + ' first try, no hints)' +
        ', flashcards ' + s.cardsKnown + '/' + s.cardsTotal + ' known' +
        ', time ' + fmtDuration(s.seconds) +
        ', quiz ' + (s.quizLatest ? 'latest ' + quizText(s.quizLatest) + ' on ' + fmtDateTime(s.quizLatest.at) + ', best ' + quizText(s.quizBest) : 'not taken'));
    });
    lines.push('');
    lines.push('Make-up tests:');
    var mk = sortedMakeups();
    if (!mk.length) lines.push('- none entered');
    mk.forEach(function (m) {
      var u = m.unitId ? unitById(m.unitId) : null;
      lines.push('- ' + m.name + ' — due ' + fmtDue(m.due) + ' (' + dueInfo(m.due).text + ')' + (u ? ' [' + u.title + ']' : '') + (m.notes ? ' — ' + m.notes : ''));
    });
    lines.push('');
    lines.push('Note: topics follow the class pacing guide; the practice problems are written for this site, not official class material.');
    return lines.join('\n');
  }

  function downloadJSON() {
    var data = {
      exportedAt: new Date().toISOString(),
      app: CONTENT.app.title,
      firstName: displayName(),
      streakDays: Store.streak(),
      totalSeconds: Math.round(S.totalSeconds || 0),
      lastStudied: S.lastStudied,
      units: unitSummaries(),
      makeups: sortedMakeups(),
      raw: Store.exportData()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: 'math-lab-progress-' + Store.dayKey() + '.json' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function renderReport() {
    var sums = unitSummaries();
    var report = h('textarea', { class: 'report', readonly: true, rows: '10', 'aria-label': 'Plain-text report' });
    report.value = textReport();
    var copied = h('span', { class: 'muted small', role: 'status' });

    var table = h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Unit', 'Practice', 'First try*', 'Cards', 'Time', 'Quiz latest', 'Quiz best'].map(function (t) { return h('th', { text: t }); }))),
      h('tbody', {}, sums.map(function (s) {
        return h('tr', {},
          h('td', {}, s.title, s.term ? h('div', { class: 'muted small', text: s.term }) : null),
          h('td', { text: s.practiceSolved + '/' + s.practiceTotal }),
          h('td', { text: String(s.practiceFirstTry) }),
          h('td', { text: s.cardsKnown + '/' + s.cardsTotal }),
          h('td', { text: fmtDuration(s.seconds) }),
          h('td', { text: s.quizLatest ? quizText(s.quizLatest) : '—' }),
          h('td', { text: s.quizBest ? quizText(s.quizBest) : '—' }));
      }))));

    var nameIn = h('input', { type: 'text', id: 'set-name', maxlength: '30', value: displayName() });
    var nameMsg = h('span', { class: 'muted small', role: 'status' });
    var pinErr = h('p', { class: 'error', role: 'alert' });

    show(
      h('div', { class: 'row-between' }, h('h1', { text: 'Parent view' }),
        h('button', { type: 'button', class: 'btn ghost small', onclick: function () { parentUnlocked = false; location.hash = '#/'; } }, 'Lock')),
      h('div', { class: 'stats' },
        stat(displayName() || '—', 'student'),
        stat(Store.streak(), 'day streak'),
        stat(fmtDuration(S.totalSeconds), 'total time')),
      h('p', { class: 'muted', text: 'Last studied: ' + lastStudiedText() + '. Time counts only while a practice, flashcard, or quiz screen is open and in use.' }),
      h('p', { class: 'muted small', text: 'Progress is stored only in this browser on this device (or in the Home Screen app, which keeps its own copy). It does not sync anywhere.' }),
      h('section', { class: 'card' }, h('h2', { text: 'Units' }), table,
        h('p', { class: 'muted small', text: '* First try = practice problems answered correctly on the very first attempt with no hints. If the first attempt was wrong or used a hint, a later correct answer counts under Practice (solved) but not under First try.' })),
      h('section', { class: 'card' }, h('h2', { text: 'Make-up tests' }),
        h('p', { class: 'muted small' }, 'The make-up list is not PIN-locked: it can also be added to or edited by anyone using this device from the ', h('a', { href: '#/makeup' }, 'Make-up tab'), '.'),
        S.makeups.length ? h('ul', { class: 'mini-list' }, sortedMakeups().map(function (m) {
          return h('li', {}, h('div', {}, h('strong', { text: m.name }), h('div', { class: 'muted small', text: fmtDue(m.due) })), badge(dueInfo(m.due)));
        })) : h('p', { class: 'muted' }, 'None entered. ', h('a', { href: '#/makeup' }, 'Add them here.'))),
      h('section', { class: 'card' }, h('h2', { text: 'Share a summary' }),
        h('p', { class: 'muted small', text: 'Nothing is sent anywhere. Copy the text to paste it into a message yourself, or download the data as a file.' }),
        report,
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn primary', onclick: function () {
              function fallback() { report.select(); try { document.execCommand('copy'); copied.textContent = 'Copied.'; } catch (e) { copied.textContent = 'Select the text and copy it.'; } }
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(report.value).then(function () { copied.textContent = 'Copied.'; }, fallback);
              } else fallback();
            }
          }, 'Copy report'),
          h('button', { type: 'button', class: 'btn secondary', onclick: downloadJSON }, 'Download JSON'),
          copied)),
      h('section', { class: 'card form' }, h('h2', { text: 'Settings' }),
        h('label', { for: 'set-name' }, 'First name shown in the app (optional)'), nameIn,
        h('div', { class: 'btn-row' }, h('button', {
          type: 'button', class: 'btn secondary', onclick: function () {
            S.firstName = nameIn.value.trim();
            Store.save();
            nameMsg.textContent = 'Saved.';
          }
        }, 'Save name'), nameMsg),
        h('h3', { text: 'Change PIN' }),
        pinInput('pin-cur', 'Current PIN'),
        pinInput('pin-n1', 'New PIN (4–8 digits)'),
        pinInput('pin-n2', 'Type the new PIN again'),
        pinErr,
        h('button', {
          type: 'button', class: 'btn secondary', onclick: function () {
            if (!Store.checkPin(val('pin-cur'))) { pinErr.textContent = 'Current PIN is wrong.'; return; }
            var a = val('pin-n1'), b = val('pin-n2');
            if (!/^\d{4,8}$/.test(a)) { pinErr.textContent = 'Use 4 to 8 digits.'; return; }
            if (a !== b) { pinErr.textContent = 'The new PINs don\'t match.'; return; }
            Store.setPin(a);
            ['pin-cur', 'pin-n1', 'pin-n2'].forEach(function (id) { document.getElementById(id).value = ''; });
            pinErr.textContent = 'PIN changed.';
          }
        }, 'Change PIN'),
        h('h3', { text: 'Reset student progress' }),
        h('p', { class: 'muted small', text: 'Erases practice, flashcards, quiz scores, study time, and streak on this device. Keeps the PIN, first name, and make-up list.' }),
        h('button', {
          type: 'button', class: 'btn ghost danger', onclick: function () {
            if (window.confirm('Reset all student progress on this device? This cannot be undone.')) {
              Store.resetProgress();
              S = Store.get();
              renderReport();
            }
          }
        }, 'Reset progress'))
    );
  }

  /* ---------- router ---------- */

  function setNav(view) {
    var tab = view === 'makeup' || view === 'parent' ? view : 'home';
    document.querySelectorAll('.tabbar a').forEach(function (a) {
      if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function route() {
    Timer.stop();
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    var view = parts[0] || 'home';
    if (view !== 'parent') parentUnlocked = false;
    setNav(view);
    switch (view) {
      case 'home': return renderHome();
      case 'unit': return renderUnit(parts[1]);
      case 'practice': return renderPractice(parts[1], parseInt(parts[2] || '0', 10));
      case 'cards': return renderCards(parts[1]);
      case 'quiz': return renderQuiz(parts[1]);
      case 'makeup': return renderMakeups();
      case 'parent': return renderParent();
      default: return notFound();
    }
  }

  /* ---------- startup ---------- */

  function byIdOk(id) { return CONTENT && CONTENT.byId[id] ? id : null; }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function loadContent() {
    return getJSON('content/app.json').then(function (cfg) {
      return Promise.all(cfg.units.map(function (id) { return getJSON('content/units/' + id + '.json'); })).then(function (units) {
        var byId = {};
        units.forEach(function (u) {
          u.practice = u.practice || [];
          u.flashcards = u.flashcards || [];
          u.quiz = u.quiz || [];
          byId[u.id] = u;
        });
        // Pacing order: units in term order first, then any unit not in a term.
        var terms = Array.isArray(cfg.terms) ? cfg.terms : [];
        var order = [];
        terms.forEach(function (t) { (t.units || []).forEach(function (id) { if (byId[id] && order.indexOf(id) === -1) order.push(id); }); });
        units.forEach(function (u) { if (order.indexOf(u.id) === -1) order.push(u.id); });
        return { app: cfg.app || {}, strands: cfg.strands || {}, terms: terms, makeupQuizzes: cfg.makeupQuizzes || null, units: order.map(function (id) { return byId[id]; }), byId: byId };
      });
    });
  }

  loadContent().then(function (c) {
    CONTENT = c;
    Store.seedMakeups(makeupQuizList().map(function (q) {
      return { id: q.id, name: q.name, prepUnit: byIdOk(q.prepUnit), notes: (c.makeupQuizzes && c.makeupQuizzes.note) || '' };
    }));
    document.title = c.app.title || 'Math Lab';
    var t = document.getElementById('app-title');
    if (t) t.textContent = c.app.title || 'Math Lab';
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (err) {
    show(h('section', { class: 'card' },
      h('h1', { text: 'Couldn\'t load the lessons' }),
      h('p', { text: 'If you opened index.html straight from a folder, start a local web server in the project folder instead (python3 -m http.server) and open http://localhost:8000.' }),
      h('p', { class: 'muted small', text: String(err && err.message || err) })));
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable; app still works */ });
    });
  }
})();
