/* Math Lab answer checking. No dependencies.
 * Mirrors tools/validate.py (keep the two in sync).
 *
 * Item types:
 *   mcq     - answer must equal one of the choices exactly
 *   numeric - one number; exact forms like 7√2, 12π, 3/5 are evaluated.
 *             Optional roundTo (decimal places) for "nearest tenth/foot" items:
 *             accept iff the value rounds half-up to the answer. Otherwise
 *             |got - answer| <= tolerance (inclusive).
 *   multi   - unordered list of numbers ("2, 3", "x = 2 or x = 3", "±4")
 *   pair    - ordered pair "(x, y)"
 *   short   - text compared after normalizing spaces, case, minus signs, <=, >=
 */
(function (global) {
  'use strict';

  var UNIT_RE = /\s*(degrees?|deg|°|(?:square|sq\.?|cubic|cu\.?)?\s*(?:units?|cm|mm|km|m|inches|in|feet|ft|yards|yd|meters?|miles?)\s*(?:\^\s*[23])?)\s*$/;

  function basic(s) {
    return String(s == null ? '' : s)
      .replace(/[−–—]/g, '-')
      .replace(/[×·⋅]/g, '*')
      .replace(/÷/g, '/')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/ /g, ' ')
      .trim()
      .toLowerCase();
  }

  function stripVar(s) {
    return s.replace(/^[a-z]\s*=\s*/, '');
  }

  function prep(s) {
    s = basic(s).replace(/^\$/, '');
    s = stripVar(s);
    s = s.replace(UNIT_RE, '');
    return s.trim();
  }

  function tokenize(s) {
    s = s.replace(/sqrt/g, '√').replace(/pi/g, 'π');
    var tokens = [];
    var i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < s.length && /[0-9.]/.test(s.charAt(j))) j++;
        var txt = s.slice(i, j);
        if (!/^(\d+\.?\d*|\.\d+)$/.test(txt)) return null;
        tokens.push({ t: 'num', v: parseFloat(txt) });
        i = j;
        continue;
      }
      if ('+-*/^()√π'.indexOf(c) !== -1) { tokens.push({ t: c }); i++; continue; }
      return null;
    }
    return tokens;
  }

  /* Evaluate a small math expression: numbers, + - * / ^, parentheses,
   * √ (or sqrt), π (or pi), and implicit multiplication (2√3, 3π, 2(4)). */
  function evaluate(str) {
    var toks = tokenize(str);
    if (!toks || !toks.length) return null;
    var p = 0;
    function peek() { return toks[p]; }
    function startsAtom(tk) {
      return tk && (tk.t === 'num' || tk.t === 'π' || tk.t === '√' || tk.t === '(');
    }
    function expr() {
      var v = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = toks[p++].t;
        var r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function term() {
      var v = unary();
      for (;;) {
        var tk = peek();
        if (tk && (tk.t === '*' || tk.t === '/')) {
          p++;
          var r = unary();
          v = tk.t === '*' ? v * r : v / r;
        } else if (startsAtom(tk)) {
          v = v * power();
        } else {
          break;
        }
      }
      return v;
    }
    function unary() {
      var tk = peek();
      if (tk && tk.t === '-') { p++; return -unary(); }
      if (tk && tk.t === '+') { p++; return unary(); }
      return power();
    }
    function power() {
      var b = atom();
      if (peek() && peek().t === '^') { p++; return Math.pow(b, unary()); }
      return b;
    }
    function atom() {
      var tk = toks[p++];
      if (!tk) throw new Error('end');
      if (tk.t === 'num') return tk.v;
      if (tk.t === 'π') return Math.PI;
      if (tk.t === '√') return Math.sqrt(atom());
      if (tk.t === '(') {
        var v = expr();
        if (!peek() || peek().t !== ')') throw new Error('paren');
        p++;
        return v;
      }
      throw new Error('unexpected');
    }
    try {
      var v = expr();
      if (p !== toks.length) return null;
      return isFinite(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function parseNumber(s) {
    return evaluate(prep(s));
  }

  function parseList(s) {
    s = basic(s).replace(/\b(or|and)\b/g, ',').replace(/;/g, ',').replace(/[{}\[\]]/g, '');
    var out = [];
    var pieces = s.split(',');
    for (var i = 0; i < pieces.length; i++) {
      var piece = stripVar(pieces[i].trim());
      if (!piece) continue;
      var pm = piece.match(/^(±|\+\/-|\+-)\s*(.*)$/);
      if (pm) {
        var v = parseNumber(pm[2]);
        if (v === null) return null;
        out.push(v, -v);
      } else {
        var w = parseNumber(piece);
        if (w === null) return null;
        out.push(w);
      }
    }
    return out.length ? out : null;
  }

  function parsePair(s) {
    s = basic(s).replace(/[()\[\]]/g, '');
    var parts = s.split(/,|;|\band\b/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length !== 2) return null;
    var a = parseNumber(parts[0]);
    var b = parseNumber(parts[1]);
    if (a === null || b === null) return null;
    return [a, b];
  }

  function normShort(s) {
    return basic(s)
      .replace(/>=|=>/g, '≥')
      .replace(/<=|=</g, '≤')
      .replace(/\s+/g, '')
      .replace(/\.$/, '');
  }

  function close(a, b, tol) {
    return Math.abs(a - b) <= Math.max(tol, 1e-9 * Math.max(1, Math.abs(b)));
  }

  /* For items whose prompt asks for a rounded answer ("nearest tenth",
   * "nearest foot"), item.roundTo = number of decimal places. A student value
   * is accepted iff it rounds half-up (half away from zero) to the official
   * answer at that precision. Equivalent to the half-open interval
   * [A - h, A + h) for A >= 0 (and (A - h, A + h] for A < 0), h = 0.5·10^-roundTo.
   * The small epsilon absorbs float noise (11.55 - 11.5 = 0.0500000000000007). */
  function roundsTo(got, want, places) {
    var h = 0.5 * Math.pow(10, -places);
    var eps = 1e-9 * Math.max(1, Math.abs(want));
    var d = got - want;
    if (want >= 0) return d >= -h - eps && d < h - eps;
    return d > -h + eps && d <= h + eps;
  }

  function matches(item, got, want, tol) {
    if (typeof item.roundTo === 'number') return roundsTo(got, want, item.roundTo);
    return close(got, want, tol);
  }

  function sameList(a, b, tol) {
    if (!a || !b || a.length !== b.length) return false;
    var x = a.slice().sort(function (m, n) { return m - n; });
    var y = b.slice().sort(function (m, n) { return m - n; });
    for (var i = 0; i < x.length; i++) if (!close(x[i], y[i], tol)) return false;
    return true;
  }

  function textMatch(item, input) {
    var n = normShort(input);
    if (!n) return false;
    var options = [item.answer].concat(item.acceptable || []);
    for (var i = 0; i < options.length; i++) if (normShort(options[i]) === n) return true;
    return false;
  }

  /* Returns { ok: boolean, readable: boolean }.
   * readable=false means the input couldn't be understood (so the UI can
   * say "check the format" instead of "wrong"). */
  function check(item, input) {
    var tol = typeof item.tolerance === 'number' ? item.tolerance : 1e-6;
    var type = item.type || 'short';
    if (input == null || String(input).trim() === '') return { ok: false, readable: false };
    if (type === 'mcq') return { ok: input === item.answer, readable: true };
    if (textMatch(item, input)) return { ok: true, readable: true };
    if (type === 'numeric') {
      var v = parseNumber(input);
      var want = parseNumber(item.answer);
      if (v === null) return { ok: false, readable: false };
      return { ok: want !== null && matches(item, v, want, tol), readable: true };
    }
    if (type === 'multi') {
      var got = parseList(input);
      if (!got) return { ok: false, readable: false };
      return { ok: sameList(got, parseList(item.answer), tol), readable: true };
    }
    if (type === 'pair') {
      var pr = parsePair(input);
      var exp = parsePair(item.answer);
      if (!pr) return { ok: false, readable: false };
      return { ok: !!exp && close(pr[0], exp[0], tol) && close(pr[1], exp[1], tol), readable: true };
    }
    return { ok: false, readable: true };
  }

  global.MathCheck = {
    evaluate: evaluate,
    parseNumber: parseNumber,
    parseList: parseList,
    parsePair: parsePair,
    normShort: normShort,
    roundsTo: roundsTo,
    check: check
  };
})(typeof window !== 'undefined' ? window : this);
