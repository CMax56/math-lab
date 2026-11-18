/* Inline triangle diagrams. No network, no libraries.
 * A figure is a plain object (see content JSON): pts, polys, segs, angles, circles, notes.
 * Coordinates are SVG pixels, y down. */
var Figures = (function () {
  'use strict';

  var NS = 'http' + '://www.w3.org/2000/svg';

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, String(attrs[k]));
      });
    }
    return n;
  }

  function rnd(n) { return Math.round(n * 10) / 10; }

  function ptMap(fig) {
    var m = {};
    (fig.pts || []).forEach(function (p) { m[p.id] = p; });
    return m;
  }

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function centroid(ids, M) {
    var x = 0, y = 0, n = 0;
    ids.forEach(function (id) {
      var p = M[id];
      if (!p) return;
      x += p.x; y += p.y; n++;
    });
    if (!n) return { x: 0, y: 0 };
    return { x: x / n, y: y / n };
  }

  function smallerSweep(at, p, q) {
    var a0 = Math.atan2(p.y - at.y, p.x - at.x);
    var a1 = Math.atan2(q.y - at.y, q.x - at.x);
    var sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    return { start: a0, sweep: sweep };
  }

  function arcD(cx, cy, r, a0, sweep) {
    var a1 = a0 + sweep;
    var x0 = cx + r * Math.cos(a0);
    var y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1);
    var y1 = cy + r * Math.sin(a1);
    var large = Math.abs(sweep) > Math.PI ? 1 : 0;
    var flag = sweep >= 0 ? 1 : 0;
    return 'M ' + rnd(x0) + ' ' + rnd(y0) + ' A ' + rnd(r) + ' ' + rnd(r) + ' 0 ' + large + ' ' + flag + ' ' + rnd(x1) + ' ' + rnd(y1);
  }

  function textEl(cls, x, y, text, ask) {
    var t = el('text', { class: cls + (ask ? ' ask' : ''), x: rnd(x), y: rnd(y), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = text;
    return t;
  }

  function render(fig) {
    if (!fig || !fig.pts) return null;
    var M = ptMap(fig);
    var xs = [], ys = [];
    fig.pts.forEach(function (p) { xs.push(p.x); ys.push(p.y); });
    (fig.circles || []).forEach(function (c) {
      var p = M[c.c];
      if (!p) return;
      xs.push(p.x - c.r, p.x + c.r);
      ys.push(p.y - c.r, p.y + c.r);
    });
    (fig.notes || []).forEach(function (n) { xs.push(n.x); ys.push(n.y); });
    if (!xs.length) return null;
    var pad = 46;
    function growPad(text) {
      if (!text) return;
      var need = 24 + String(text).length * 8.4;
      if (need > pad) pad = Math.min(need, 112);
    }
    (fig.segs || []).forEach(function (s) { growPad(s.text); });
    (fig.angles || []).forEach(function (g) { growPad(g.text); });
    (fig.notes || []).forEach(function (n) { growPad(n.text); });
    var minX = Math.min.apply(null, xs) - pad;
    var minY = Math.min.apply(null, ys) - pad;
    var maxX = Math.max.apply(null, xs) + pad;
    var maxY = Math.max.apply(null, ys) + pad;

    var svg = el('svg', {
      class: 'figure-svg',
      viewBox: rnd(minX) + ' ' + rnd(minY) + ' ' + rnd(maxX - minX) + ' ' + rnd(maxY - minY),
      role: 'img',
      'aria-label': fig.alt || 'Triangle diagram',
      focusable: 'false'
    });
    var title = el('title');
    title.textContent = fig.alt || 'Triangle diagram';
    svg.appendChild(title);

    var polys = fig.polys || [];
    var polyCents = polys.map(function (ids) { return centroid(ids, M); });

    function awayFor(aId, bId) {
      var i, poly, hasA, hasB;
      for (i = 0; i < polys.length; i++) {
        poly = polys[i];
        hasA = poly.indexOf(aId) !== -1;
        hasB = poly.indexOf(bId) !== -1;
        if (hasA && hasB) return polyCents[i];
      }
      for (i = 0; i < polys.length; i++) {
        poly = polys[i];
        if (poly.indexOf(aId) !== -1 || poly.indexOf(bId) !== -1) return polyCents[i];
      }
      return centroid(fig.pts.map(function (p) { return p.id; }), M);
    }

    (fig.circles || []).forEach(function (c) {
      var p = M[c.c];
      if (!p) return;
      if (c.semi && c.semi.length === 2 && M[c.semi[0]] && M[c.semi[1]]) {
        var a = M[c.semi[0]], b = M[c.semi[1]];
        var a0 = Math.atan2(a.y - p.y, a.x - p.x);
        var a1 = Math.atan2(b.y - p.y, b.x - p.x);
        var pos = a1 - a0;
        while (pos < 0) pos += 2 * Math.PI;
        while (pos >= 2 * Math.PI) pos -= 2 * Math.PI;
        var alt = pos - 2 * Math.PI;
        function midY(sw) { return p.y + Math.sin(a0 + sw / 2) * c.r; }
        var sweep = midY(pos) <= midY(alt) ? pos : alt;
        svg.appendChild(el('path', { class: 'stroke', d: arcD(p.x, p.y, c.r, a0, sweep) }));
      } else {
        svg.appendChild(el('circle', { class: 'stroke', cx: rnd(p.x), cy: rnd(p.y), r: rnd(c.r) }));
      }
      if (c.mark && M[c.mark.from] && M[c.mark.to]) {
        var mf = M[c.mark.from], mt = M[c.mark.to];
        var sw = smallerSweep(p, mf, mt);
        var rr = c.r + 16;
        svg.appendChild(el('path', { class: 'angle', d: arcD(p.x, p.y, rr, sw.start, sw.sweep) }));
        var mid = sw.start + sw.sweep / 2;
        var lx = p.x + Math.cos(mid) * (rr + 16);
        var ly = p.y + Math.sin(mid) * (rr + 16);
        if (c.mark.text) svg.appendChild(textEl(labelClass(c.mark.text), lx, ly, c.mark.text, c.mark.ask));
      }
    });

    polys.forEach(function (ids, i) {
      var points = ids.map(function (id) {
        var p = M[id];
        return p ? rnd(p.x) + ',' + rnd(p.y) : null;
      }).filter(Boolean).join(' ');
      svg.appendChild(el('polygon', { class: i % 2 === 0 ? 'fill' : 'fill2', points: points }));
    });

    (fig.segs || []).forEach(function (s) {
      var a = M[s.a], b = M[s.b];
      if (!a || !b) return;
      var cls = 'stroke' + (s.dash ? ' dash' : '');
      svg.appendChild(el('line', { class: cls, x1: rnd(a.x), y1: rnd(a.y), x2: rnd(b.x), y2: rnd(b.y) }));
      drawTicks(svg, a, b, s.ticks || 0);
      drawArrows(svg, a, b, s.arrows || 0);
      if (s.text) {
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.hypot(dx, dy) || 1;
        var t = s.at == null ? 0.5 : s.at;
        var mx = a.x + dx * t, my = a.y + dy * t;
        var nx = -dy / len, ny = dx / len;
        var c = awayFor(s.a, s.b);
        var vx = mx - c.x, vy = my - c.y;
        var dot = nx * vx + ny * vy;
        if (dot < 0 || (Math.abs(dot) < len * 0.08 && nx < 0)) { nx = -nx; ny = -ny; }
        var chars = String(s.text).length;
        var off = Math.max(22, 14 + chars * 4.8);
        if (s.lx != null) { nx = s.lx; ny = s.ly == null ? 0 : s.ly; off = 1; }
        svg.appendChild(textEl(labelClass(s.text), mx + nx * off, my + ny * off, s.text, s.ask));
      }
    });

    (fig.angles || []).forEach(function (g) {
      var at = M[g.at], pa = M[g.a], pb = M[g.b];
      if (!at || !pa || !pb) return;
      var sw = smallerSweep(at, pa, pb);
      var reach = Math.min(dist(at, pa), dist(at, pb));
      var r = Math.max(14, Math.min(26, reach * 0.34));
      if (g.sector) {
        var a0s = sw.start, a1s = sw.start + sw.sweep;
        var sr = Math.min(reach * 0.55, 54);
        var sd = 'M ' + rnd(at.x) + ' ' + rnd(at.y) +
          ' L ' + rnd(at.x + Math.cos(a0s) * sr) + ' ' + rnd(at.y + Math.sin(a0s) * sr) +
          ' A ' + rnd(sr) + ' ' + rnd(sr) + ' 0 0 ' + (sw.sweep >= 0 ? 1 : 0) + ' ' +
          rnd(at.x + Math.cos(a1s) * sr) + ' ' + rnd(at.y + Math.sin(a1s) * sr) + ' Z';
        svg.appendChild(el('path', { class: 'sector', d: sd }));
      }
      if (g.right) {
        var s = Math.max(12, Math.min(18, reach * 0.26));
        var ux = Math.cos(sw.start), uy = Math.sin(sw.start);
        var vx = Math.cos(sw.start + sw.sweep), vy = Math.sin(sw.start + sw.sweep);
        var p1 = [at.x + ux * s, at.y + uy * s];
        var p2 = [at.x + (ux + vx) * s, at.y + (uy + vy) * s];
        var p3 = [at.x + vx * s, at.y + vy * s];
        svg.appendChild(el('path', {
          class: 'right',
          d: 'M ' + rnd(p1[0]) + ' ' + rnd(p1[1]) + ' L ' + rnd(p2[0]) + ' ' + rnd(p2[1]) + ' L ' + rnd(p3[0]) + ' ' + rnd(p3[1])
        }));
      } else {
        var n = g.arcs || (g.text ? 1 : 0);
        var k;
        for (k = 0; k < n; k++) {
          svg.appendChild(el('path', { class: 'angle', d: arcD(at.x, at.y, r + k * 6, sw.start, sw.sweep) }));
        }
      }
      if (g.text) {
        var mid = sw.start + sw.sweep / 2;
        var ld = r + (g.arcs || 1) * 6 + 14;
        if (g.right) ld = Math.max(ld, 36);
        svg.appendChild(textEl(labelClass(g.text), at.x + Math.cos(mid) * ld, at.y + Math.sin(mid) * ld, g.text, g.ask));
      }
    });

    fig.pts.forEach(function (p) {
      if (p.dot) svg.appendChild(el('circle', { class: 'dot', cx: rnd(p.x), cy: rnd(p.y), r: 3.5 }));
      var name = p.name != null ? p.name : (String(p.id).length === 1 ? p.id : '');
      if (!name) return;
      var c = centroid((polys[0] || fig.pts.map(function (q) { return q.id; })), M);
      // Prefer a polygon that actually contains this vertex.
      polys.forEach(function (ids, i) { if (ids.indexOf(p.id) !== -1) c = polyCents[i]; });
      var vx = p.x - c.x, vy = p.y - c.y;
      var L = Math.hypot(vx, vy) || 1;
      var x = p.nameAt ? p.nameAt[0] : p.x + vx / L * 22 + (p.dx || 0);
      var y = p.nameAt ? p.nameAt[1] : p.y + vy / L * 22 + (p.dy || 0);
      svg.appendChild(textEl('vlabel', x, y, name, false));
    });

    (fig.notes || []).forEach(function (n) {
      if (!n.text) return;
      svg.appendChild(textEl('note ' + labelClass(n.text), n.x, n.y, n.text, n.ask));
    });

    var wrap = document.createElement('div');
    wrap.className = 'figure';
    wrap.appendChild(svg);
    return wrap;
  }

  function labelClass(text) {
    return (text && String(text).length > 10) ? 'label long' : 'label';
  }

  function drawTicks(svg, a, b, n) {
    if (!n) return;
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var tx = dx / len, ty = dy / len;
    var px = -ty, py = tx;
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var span = 7;
    var i, o, cx, cy;
    for (i = 0; i < n; i++) {
      o = (i - (n - 1) / 2) * span;
      cx = mx + tx * o; cy = my + ty * o;
      svg.appendChild(el('line', {
        class: 'tick',
        x1: rnd(cx - px * 7), y1: rnd(cy - py * 7),
        x2: rnd(cx + px * 7), y2: rnd(cy + py * 7)
      }));
    }
  }

  function drawArrows(svg, a, b, n) {
    if (!n) return;
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var tx = dx / len, ty = dy / len;
    var px = -ty, py = tx;
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var i, o, cx, cy;
    for (i = 0; i < n; i++) {
      o = (i - (n - 1) / 2) * 12;
      cx = mx + tx * o; cy = my + ty * o;
      svg.appendChild(el('path', {
        class: 'arrow',
        d: 'M ' + rnd(cx - tx * 7 + px * 5) + ' ' + rnd(cy - ty * 7 + py * 5) +
          ' L ' + rnd(cx) + ' ' + rnd(cy) +
          ' L ' + rnd(cx - tx * 7 - px * 5) + ' ' + rnd(cy - ty * 7 - py * 5)
      }));
    }
  }

  return { render: render };
})();
