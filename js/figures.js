/* Inline diagrams. No network, no libraries.
 * A figure is a plain object: geometry (pts, polys, segs, angles, circles, notes)
 * and/or a graph, number line, balance, bar model, or solid.
 * Coordinates are SVG pixels, y down. Geometry checks live in tools/validate.py. */
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
    if (!fig) return null;
    var M = ptMap(fig);
    var xs = [], ys = [];
    (fig.pts || []).forEach(function (p) { xs.push(p.x); ys.push(p.y); });
    specialBoxes(fig).forEach(function (b) {
      xs.push(b.x, b.x + b.w);
      ys.push(b.y, b.y + b.h);
    });
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
    (fig.grid && fig.grid.lines || []).forEach(function (ln) { growPad(ln.text); });
    (fig.grid && fig.grid.points || []).forEach(function (p) { growPad(p.text); });
    if (fig.balance) { growPad(fig.balance.left); growPad(fig.balance.right); }
    (fig.bars && fig.bars.items || []).forEach(function (it) { growPad(it.text); });
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
    if (fig.grid) drawGrid(svg, fig.grid);
    if (fig.numberline) drawNumberline(svg, fig.numberline);
    if (fig.balance) drawBalance(svg, fig.balance);
    if (fig.bars) drawBars(svg, fig.bars);
    (fig.solids || (fig.solid ? [fig.solid] : [])).forEach(function (s, i) { drawSolid(svg, s, i); });

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

    (fig.pts || []).forEach(function (p) {
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

  function specialBoxes(fig) {
    var boxes = [];
    if (fig.grid) boxes.push({ x: 0, y: 0, w: fig.grid.w || 300, h: fig.grid.h || 210 });
    if (fig.numberline) boxes.push({ x: 0, y: 0, w: 320, h: 86 });
    if (fig.balance) boxes.push({ x: 0, y: 0, w: 320, h: 150 });
    if (fig.bars) {
      var n = (fig.bars.items || fig.bars.ratios || []).length;
      boxes.push({ x: 0, y: 0, w: 320, h: Math.max(100, 36 + n * 48) });
    }
    var solids = fig.solids || (fig.solid ? [fig.solid] : []);
    if (solids.length) boxes.push({ x: 0, y: 0, w: Math.max(280, solids.length * 170), h: 230 });
    return boxes;
  }

  function drawGrid(svg, g) {
    var x0 = g.x0, x1 = g.x1, y0 = g.y0, y1 = g.y1;
    var W = g.w || 300, H = g.h || 210, left = 8, top = 8;
    function X(x) { return left + (x - x0) / (x1 - x0) * (W - 16); }
    function Y(y) { return top + (y1 - y) / (y1 - y0) * (H - 16); }
    var x, y, i;
    if (g.numbered !== false) {
      for (x = Math.ceil(x0); x <= Math.floor(x1); x++) {
        svg.appendChild(el('line', { class: 'gridline', x1: rnd(X(x)), y1: rnd(Y(y0)), x2: rnd(X(x)), y2: rnd(Y(y1)) }));
      }
      for (y = Math.ceil(y0); y <= Math.floor(y1); y++) {
        svg.appendChild(el('line', { class: 'gridline', x1: rnd(X(x0)), y1: rnd(Y(y)), x2: rnd(X(x1)), y2: rnd(Y(y)) }));
      }
    }
    var ax = (x0 < 0 && x1 > 0) ? 0 : x0;
    var ay = (y0 < 0 && y1 > 0) ? 0 : y0;
    svg.appendChild(el('line', { class: 'axis', x1: rnd(X(x0)), y1: rnd(Y(ay)), x2: rnd(X(x1)), y2: rnd(Y(ay)) }));
    svg.appendChild(el('line', { class: 'axis', x1: rnd(X(ax)), y1: rnd(Y(y0)), x2: rnd(X(ax)), y2: rnd(Y(y1)) }));
    svg.appendChild(textEl('note', X(x1) - 8, Y(ay) - 12, 'x', false));
    svg.appendChild(textEl('note', X(ax) + 12, Y(y1) + 10, 'y', false));
    if (g.numbered !== false) {
      for (x = Math.ceil(x0); x <= Math.floor(x1); x++) {
        if (x === 0) continue;
        svg.appendChild(textEl('note', X(x), Y(ay) + 14, String(x), false));
      }
      for (y = Math.ceil(y0); y <= Math.floor(y1); y++) {
        if (y === 0) continue;
        svg.appendChild(textEl('note', X(ax) - 14, Y(y), String(y), false));
      }
    }
    (g.lines || []).forEach(function (ln, n) {
      var d = '', pen = false, labelAt = null, seen = 0;
      for (i = 0; i <= 48; i++) {
        var xx = x0 + (x1 - x0) * i / 48;
        var yy = ln.m * xx + ln.b;
        if (yy < y0 || yy > y1) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + rnd(X(xx)) + ' ' + rnd(Y(yy)) + ' ';
        seen++;
        if (seen === (ln.labelAt || 18)) labelAt = [X(xx), Y(yy)];
        pen = true;
      }
      if (d) svg.appendChild(el('path', { class: n % 2 ? 'plot2' : 'plot', d: d }));
      if (ln.text && labelAt) svg.appendChild(textEl('label', labelAt[0], labelAt[1] - 16, ln.text, false));
    });
    if (g.curve) {
      var c = g.curve, path = '', pen = false;
      for (i = 0; i <= 80; i++) {
        var xx = x0 + (x1 - x0) * i / 80;
        var yy = c.a * xx * xx + c.b * xx + c.c;
        var inside = yy >= y0 && yy <= y1;
        if (!inside) { pen = false; continue; }
        path += (pen ? 'L' : 'M') + rnd(X(xx)) + ' ' + rnd(Y(yy)) + ' ';
        pen = true;
      }
      if (path) svg.appendChild(el('path', { class: 'plot', d: path }));
    }
    if (g.vline) {
      svg.appendChild(el('line', {
        class: 'stroke dash',
        x1: rnd(X(g.vline.x)), y1: rnd(Y(y0)),
        x2: rnd(X(g.vline.x)), y2: rnd(Y(y1))
      }));
      if (g.vline.text) svg.appendChild(textEl('label ask', X(g.vline.x) + 8, Y(y1) + 16, g.vline.text, true));
    }
    (g.points || []).forEach(function (p) {
      svg.appendChild(el('circle', { class: p.open ? 'open-dot' : 'dot', cx: rnd(X(p.x)), cy: rnd(Y(p.y)), r: 4.5 }));
      if (p.text) svg.appendChild(textEl('label', X(p.x) + 8, Y(p.y) - 14, p.text, p.ask));
    });
    if (g.mark) {
      svg.appendChild(el('circle', { class: 'open-dot', cx: rnd(X(g.mark.x)), cy: rnd(Y(g.mark.y)), r: 5 }));
      svg.appendChild(textEl('label ask', X(g.mark.x) + 12, Y(g.mark.y) - 14, g.mark.text || '?', true));
    }
    if (g.tri) {
      var t = g.tri;
      var xA = X(t.x), yA = Y(t.y);
      var xB = X(t.x + t.run), yB = Y(t.y);
      var xC = X(t.x + t.run), yC = Y(t.y + t.rise);
      svg.appendChild(el('path', { class: 'angle', d: 'M ' + rnd(xA) + ' ' + rnd(yA) + ' L ' + rnd(xB) + ' ' + rnd(yB) + ' L ' + rnd(xC) + ' ' + rnd(yC) }));
      if (t.runText) svg.appendChild(textEl('label', (xA + xB) / 2, yA + 16, t.runText, false));
      if (t.riseText) svg.appendChild(textEl('label', xB + 16, (yB + yC) / 2, t.riseText, false));
    }
    if (g.ray) {
      var a = g.ray;
      svg.appendChild(el('line', { class: 'stroke dash', x1: rnd(X(a.x1)), y1: rnd(Y(a.y1)), x2: rnd(X(a.x2)), y2: rnd(Y(a.y2)) }));
      if (a.text) svg.appendChild(textEl('label', (X(a.x1) + X(a.x2)) / 2 + 10, (Y(a.y1) + Y(a.y2)) / 2, a.text, false));
    }
  }

  function drawNumberline(svg, n) {
    var x0 = 28, x1 = 300, y = 40;
    var min = n.min, max = n.max;
    function X(v) { return x0 + (v - min) / (max - min) * (x1 - x0); }
    svg.appendChild(el('line', { class: 'stroke', x1: x0, y1: y, x2: x1, y2: y }));
    svg.appendChild(el('path', { class: 'stroke', d: 'M ' + (x1 - 10) + ' ' + (y - 6) + ' L ' + x1 + ' ' + y + ' L ' + (x1 - 10) + ' ' + (y + 6) }));
    var v = Math.ceil(min);
    for (; v <= max; v++) {
      svg.appendChild(el('line', { class: 'axis', x1: rnd(X(v)), y1: y - 6, x2: rnd(X(v)), y2: y + 6 }));
    }
    (n.marks || []).forEach(function (m) {
      if (!m.plain) svg.appendChild(el('circle', { class: m.closed ? 'dot' : 'open-dot', cx: rnd(X(m.at)), cy: y, r: 6 }));
      if (m.text) svg.appendChild(textEl('label', X(m.at), y + 26, m.text, m.ask));
    });
    if (n.caption) svg.appendChild(textEl('note', 160, 14, n.caption, false));
  }

  function drawBalance(svg, b) {
    var y = 58;
    svg.appendChild(el('polygon', { class: 'fill', points: '160,108 146,132 174,132' }));
    svg.appendChild(el('line', { class: 'stroke', x1: 36, y1: y, x2: 284, y2: y }));
    svg.appendChild(el('line', { class: 'stroke', x1: 36, y1: y, x2: 36, y2: y + 18 }));
    svg.appendChild(el('line', { class: 'stroke', x1: 284, y1: y, x2: 284, y2: y + 18 }));
    svg.appendChild(el('rect', { class: 'pan', x: 8, y: y + 18, width: 56, height: 36, rx: 6 }));
    svg.appendChild(el('rect', { class: 'pan', x: 256, y: y + 18, width: 56, height: 36, rx: 6 }));
    svg.appendChild(textEl('label' + (b.askLeft ? ' ask' : ''), 36, y - 16, b.left, b.askLeft));
    svg.appendChild(textEl('label' + (b.askRight ? ' ask' : ''), 284, y - 16, b.right, b.askRight));
    svg.appendChild(textEl('vlabel', 160, y - 18, b.sign || '=', false));
  }

  function drawBars(svg, b) {
    if (b.ratios) {
      b.ratios.forEach(function (r, i) {
        var x = 40 + i * 140;
        svg.appendChild(textEl('label' + (r.ask ? ' ask' : ''), x, 28, r.num, r.ask));
        svg.appendChild(el('line', { class: 'stroke', x1: x - 28, y1: 46, x2: x + 28, y2: 46 }));
        svg.appendChild(textEl('label', x, 68, r.den, false));
        if (i === 0 && b.ratios.length > 1) svg.appendChild(textEl('vlabel', x + 70, 46, '=', false));
      });
      return;
    }
    var items = b.items || [];
    var total = 0;
    items.forEach(function (it) { total += it.share || 1; });
    var x = 16;
    items.forEach(function (it) {
      var w = Math.max(54, ((it.share || 1) / total) * 280);
      svg.appendChild(el('rect', { class: it.ask ? 'fill2' : 'fill', x: rnd(x), y: 36, width: rnd(w), height: 42, rx: 8 }));
      svg.appendChild(el('rect', { class: 'stroke', x: rnd(x), y: 36, width: rnd(w), height: 42, rx: 8 }));
      svg.appendChild(textEl('label' + (it.ask ? ' ask' : ''), x + w / 2, 58, it.text, it.ask));
      x += w + 6;
    });
    if (b.total) svg.appendChild(textEl('note', 160, 100, b.total, false));
    if (b.caption) svg.appendChild(textEl('note', 160, 18, b.caption, false));
  }

  function isoPoint(ox, oy, x, y, z) {
    return [ox + (x - y) * 0.9, oy - z + (x + y) * 0.42];
  }

  function poly(svg, pts, cls) {
    svg.appendChild(el('polygon', {
      class: cls,
      points: pts.map(function (p) { return rnd(p[0]) + ',' + rnd(p[1]); }).join(' ')
    }));
  }

  function drawSolid(svg, s, index) {
    var ox = 90 + index * 165;
    var oy = 150;
    var kind = s.kind;
    if (kind === 'box' || kind === 'cube') {
      var w = s.w || s.edge || 4, d = s.d || s.edge || w, h = s.h || s.edge || w;
      var m = 78 / Math.max(w, d, h);
      w *= m; d *= m; h *= m;
      function P(x, y, z) { return isoPoint(ox, oy, x, y, z); }
      var A = P(0, 0, 0), B = P(w, 0, 0), C = P(w, d, 0), D = P(0, d, 0);
      var E = P(0, 0, h), F = P(w, 0, h), G = P(w, d, h), H = P(0, d, h);
      poly(svg, [A, B, F, E], 'fill');
      poly(svg, [B, C, G, F], 'fill2');
      poly(svg, [E, F, G, H], 'fill');
      [A, B, F, E, A].forEach(function () {});
      strokeLoop(svg, [A, B, F, E]);
      strokeLoop(svg, [B, C, G, F]);
      strokeLoop(svg, [E, F, G, H]);
      if (s.lw) svg.appendChild(textEl('label', (A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 16, s.lw, false));
      if (s.ld) svg.appendChild(textEl('label', (B[0] + C[0]) / 2 + 8, (B[1] + C[1]) / 2 + 14, s.ld, false));
      if (s.lh) svg.appendChild(textEl('label', A[0] - 8, (A[1] + E[1]) / 2, s.lh, false));
      if (s.le) svg.appendChild(textEl('label', (A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 16, s.le, false));
    } else if (kind === 'cylinder' || kind === 'cone') {
      var rr = s.r || 3, rh = s.h || 8;
      var unit = 100 / Math.max(rr * 2, rh);
      var r = Math.max(28, rr * unit), hh = Math.max(48, rh * unit), ry = Math.max(10, r * 0.32);
      var cx = ox + 10, base = oy + 20, top = base - hh;
      svg.appendChild(el('ellipse', { class: kind === 'cylinder' && s.closed ? 'stroke' : 'stroke dash', cx: cx, cy: base, rx: r, ry: ry }));
      if (kind === 'cylinder') {
        svg.appendChild(el('line', { class: 'stroke', x1: cx - r, y1: base, x2: cx - r, y2: top }));
        svg.appendChild(el('line', { class: 'stroke', x1: cx + r, y1: base, x2: cx + r, y2: top }));
        svg.appendChild(el('ellipse', { class: 'fill', cx: cx, cy: top, rx: r, ry: ry }));
        svg.appendChild(el('ellipse', { class: 'stroke', cx: cx, cy: top, rx: r, ry: ry }));
        svg.appendChild(el('line', { class: 'stroke', x1: cx, y1: top, x2: cx + r, y2: top }));
        if (s.lr) svg.appendChild(textEl('label', cx + r / 2, top - 14, s.lr, false));
        if (s.lh) svg.appendChild(textEl('label', cx + r + 28, (top + base) / 2, s.lh, false));
      } else {
        svg.appendChild(el('line', { class: 'stroke', x1: cx - r, y1: base, x2: cx, y2: top }));
        svg.appendChild(el('line', { class: 'stroke', x1: cx + r, y1: base, x2: cx, y2: top }));
        svg.appendChild(el('line', { class: 'stroke dash', x1: cx, y1: top, x2: cx, y2: base }));
        svg.appendChild(el('line', { class: 'stroke', x1: cx, y1: base, x2: cx + r, y2: base }));
        if (s.lh) svg.appendChild(textEl('label', cx + 28, (top + base) / 2, s.lh, false));
        if (s.lr) svg.appendChild(textEl('label', cx + r / 2, base + 18, s.lr, false));
      }
    } else if (kind === 'sphere') {
      var cx = ox + 20, cy = oy - 20, r = 58;
      svg.appendChild(el('circle', { class: 'stroke', cx: cx, cy: cy, r: r }));
      svg.appendChild(el('ellipse', { class: 'stroke dash', cx: cx, cy: cy, rx: r, ry: 18 }));
      svg.appendChild(el('line', { class: 'stroke', x1: cx, y1: cy, x2: cx + r, y2: cy }));
      if (s.lr) svg.appendChild(textEl('label', cx + r / 2, cy - 14, s.lr, false));
    } else if (kind === 'pyramid') {
      var side = 90, apex = [ox + 20, oy - 110], b1 = [ox - 30, oy], b2 = [ox + 70, oy], b3 = [ox + 100, oy + 36], b4 = [ox, oy + 36];
      poly(svg, [b1, b2, apex], 'fill');
      poly(svg, [b2, b3, apex], 'fill2');
      poly(svg, [b1, b2, b3, b4], 'fill');
      strokeLoop(svg, [b1, b2, b3, b4]);
      svg.appendChild(el('line', { class: 'stroke', x1: b1[0], y1: b1[1], x2: apex[0], y2: apex[1] }));
      svg.appendChild(el('line', { class: 'stroke', x1: b2[0], y1: b2[1], x2: apex[0], y2: apex[1] }));
      svg.appendChild(el('line', { class: 'stroke', x1: b3[0], y1: b3[1], x2: apex[0], y2: apex[1] }));
      svg.appendChild(el('line', { class: 'stroke dash', x1: (b1[0] + b2[0]) / 2, y1: (b1[1] + b2[1]) / 2, x2: apex[0], y2: apex[1] }));
      if (s.ls) svg.appendChild(textEl('label', (b1[0] + b2[0]) / 2, b1[1] + 18, s.ls, false));
      if (s.lh) svg.appendChild(textEl('label', apex[0] + 36, (apex[1] + oy) / 2, s.lh, false));
    }
  }

  function strokeLoop(svg, pts) {
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + rnd(p[0]) + ' ' + rnd(p[1]); }).join(' ') + ' Z';
    svg.appendChild(el('path', { class: 'stroke', d: d }));
  }

  return { render: render };
})();
