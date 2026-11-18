/* Math Lab local storage. Everything stays in this browser's localStorage.
 * Nothing is sent anywhere. */
(function (global) {
  'use strict';

  var KEY = 'mathlab.v1';

  function blank() {
    return {
      version: 1,
      firstName: null,        // null = use the default from content/app.json
      practice: {},           // itemId -> { status, firstTryCorrect, attempts, hintsUsed, at }
      cards: {},              // cardId -> 'know' | 'learning'
      quizzes: {},            // unitId -> { latest, best, history: [...] }
      time: {},               // unitId -> seconds (active study time)
      totalSeconds: 0,
      studyDays: [],          // ['YYYY-MM-DD', ...] local dates with activity
      lastStudied: null,      // { at: ISO string, unitId }
      makeups: [],            // [{ id, name, due: 'YYYY-MM-DD' or '', unitId, notes }]
      seededMakeups: [],      // ids of make-ups added once from content (never re-added after delete)
      pin: null,              // { salt, hash } — courtesy lock only
      tipDismissed: false
    };
  }

  var state = null;
  var dirty = false;

  function load() {
    var base = blank();
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) base[k] = saved[k];
      }
    } catch (e) { /* storage blocked or corrupt: start fresh in memory */ }
    state = base;
    return state;
  }

  function save() {
    dirty = false;
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function saveSoon() { dirty = true; }
  function flush() { if (dirty) save(); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function markStudied(unitId) {
    var today = dayKey();
    if (state.studyDays.indexOf(today) === -1) {
      state.studyDays.push(today);
      if (state.studyDays.length > 400) state.studyDays = state.studyDays.slice(-400);
    }
    state.lastStudied = { at: new Date().toISOString(), unitId: unitId || null };
  }

  function streak() {
    var set = {};
    state.studyDays.forEach(function (d) { set[d] = true; });
    var d = new Date();
    if (!set[dayKey(d)]) d.setDate(d.getDate() - 1); // today not studied yet: streak still alive from yesterday
    var n = 0;
    while (set[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function addTime(unitId, seconds) {
    if (!unitId || !(seconds > 0)) return;
    state.time[unitId] = (state.time[unitId] || 0) + seconds;
    state.totalSeconds = (state.totalSeconds || 0) + seconds;
    saveSoon();
  }

  function recordPractice(itemId, unitId, ok, hintsUsed) {
    var rec = state.practice[itemId] || { status: 'tried', firstTryCorrect: null, attempts: 0, hintsUsed: 0 };
    rec.attempts += 1;
    if (rec.firstTryCorrect === null) rec.firstTryCorrect = !!ok && hintsUsed === 0;
    if (ok) rec.status = 'correct';
    rec.hintsUsed = Math.max(rec.hintsUsed || 0, hintsUsed || 0);
    rec.at = new Date().toISOString();
    state.practice[itemId] = rec;
    markStudied(unitId);
    save();
  }

  function recordCard(cardId, unitId, value) {
    state.cards[cardId] = value;
    markStudied(unitId);
    save();
  }

  function recordQuiz(unitId, score, total, seconds) {
    var q = state.quizzes[unitId] || { latest: null, best: null, history: [] };
    var attempt = { at: new Date().toISOString(), score: score, total: total, pct: total ? Math.round(100 * score / total) : 0, seconds: Math.round(seconds) };
    q.latest = attempt;
    if (!q.best || attempt.pct > q.best.pct) q.best = attempt;
    q.history.push(attempt);
    if (q.history.length > 10) q.history = q.history.slice(-10);
    state.quizzes[unitId] = q;
    markStudied(unitId);
    save();
    return attempt;
  }

  function newId() {
    return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function upsertMakeup(entry) {
    if (!entry.id) {
      entry.id = newId();
      state.makeups.push(entry);
    } else {
      for (var i = 0; i < state.makeups.length; i++) {
        if (state.makeups[i].id === entry.id) { state.makeups[i] = entry; break; }
      }
    }
    save();
  }

  function removeMakeup(id) {
    state.makeups = state.makeups.filter(function (m) { return m.id !== id; });
    save();
  }

  /* Add make-ups listed in content once per device. Never overwrites or duplicates saved entries,
   * and never re-adds one the user deleted (its id stays in seededMakeups). */
  function seedMakeups(list) {
    if (!Array.isArray(state.makeups)) state.makeups = [];
    if (!Array.isArray(state.seededMakeups)) state.seededMakeups = [];
    var changed = false;
    (list || []).forEach(function (q) {
      if (!q || !q.id || state.seededMakeups.indexOf(q.id) !== -1) return;
      state.seededMakeups.push(q.id);
      changed = true;
      var exists = state.makeups.some(function (m) { return m.id === q.id; });
      if (!exists) state.makeups.push({ id: q.id, name: q.name, due: q.due || '', unitId: q.prepUnit || null, notes: q.notes || '' });
    });
    if (changed) save();
    return changed;
  }

  function resetProgress() {
    var keep = { firstName: state.firstName, pin: state.pin, makeups: state.makeups, seededMakeups: state.seededMakeups, tipDismissed: state.tipDismissed };
    state = blank();
    for (var k in keep) state[k] = keep[k];
    save();
  }

  /* ---- PIN (courtesy lock, not real security) ---- */

  // Compact SHA-256 for ASCII strings (works without crypto.subtle, e.g. on plain-http LAN testing).
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32);
    var result = '';
    var words = [];
    var bitLen = ascii.length * 8;
    var hash = [], k = [];
    var primeCounter = 0, isComposite = {};
    var i, j;
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return null;
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  function randomSalt() {
    var bytes = [];
    try {
      var arr = new Uint8Array(16);
      global.crypto.getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) bytes.push(arr[i]);
    } catch (e) {
      for (var j = 0; j < 16; j++) bytes.push(Math.floor(Math.random() * 256));
    }
    return bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  }

  function hashPin(salt, pin) { return sha256(salt + ':' + String(pin)); }
  function hasPin() { return !!(state.pin && state.pin.hash); }
  function setPin(pin) {
    var salt = randomSalt();
    state.pin = { salt: salt, hash: hashPin(salt, pin) };
    save();
  }
  function checkPin(pin) {
    return hasPin() && hashPin(state.pin.salt, pin) === state.pin.hash;
  }

  function exportData() {
    var copy = JSON.parse(JSON.stringify(state));
    delete copy.pin;
    delete copy.tipDismissed;
    return copy;
  }

  global.Store = {
    load: load,
    get: function () { return state; },
    save: save,
    saveSoon: saveSoon,
    flush: flush,
    dayKey: dayKey,
    markStudied: markStudied,
    streak: streak,
    addTime: addTime,
    recordPractice: recordPractice,
    recordCard: recordCard,
    recordQuiz: recordQuiz,
    upsertMakeup: upsertMakeup,
    seedMakeups: seedMakeups,
    removeMakeup: removeMakeup,
    resetProgress: resetProgress,
    hasPin: hasPin,
    setPin: setPin,
    checkPin: checkPin,
    exportData: exportData
  };
})(window);
