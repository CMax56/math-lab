#!/usr/bin/env python3
"""Validate Math Lab content and static files.

Run from anywhere:  python3 tools/validate.py

Checks:
  1. All content JSON parses; app.json lists unit files that exist.
  2. Every practice/quiz item has id, type, prompt, answer, >= 2 hints, solution;
     MCQ answers are one of the choices; flashcards have front and back;
     unit ids and item ids are unique.
  3. Math: numeric / multi / pair answers parse, every "acceptable" variant
     equals the answer, and an independent "check" expression (if present)
     gives the same value. Also runs each answer through a Python copy of the
     app's answer checker (js/mathcheck.js) to be sure the app accepts it.
     Items the script cannot check are listed for review by hand.
  4. Triangle diagrams: every practice item that describes a triangle has a
     figure, the figure parses, and it is consistent (right angles look right,
     labeled angles and side ratios match the drawing, congruent ticks match,
     and the value being solved for is not written on the diagram).
  5. Static files: manifest fields, service-worker cache list, no external URLs.
  6. Prints an inventory (units and counts).

Exit code 0 = no errors (warnings allowed), 1 = errors.
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


# ---------------------------------------------------------------------------
# Python copy of js/mathcheck.js (keep in sync)
# ---------------------------------------------------------------------------

UNIT_RE = re.compile(
    r"\s*(degrees?|deg|°|(?:square|sq\.?|cubic|cu\.?)?\s*"
    r"(?:units?|cm|mm|km|m|inches|in|feet|ft|yards|yd|meters?|miles?)\s*(?:\^\s*[23])?)\s*$"
)


def basic(s):
    s = "" if s is None else str(s)
    s = re.sub("[−–—]", "-", s)
    s = re.sub("[×·⋅]", "*", s)
    s = s.replace("÷", "/").replace("²", "^2").replace("³", "^3").replace(" ", " ")
    return s.strip().lower()


def strip_var(s):
    return re.sub(r"^[a-z]\s*=\s*", "", s)


def prep(s):
    s = basic(s)
    s = re.sub(r"^\$", "", s)
    s = strip_var(s)
    s = UNIT_RE.sub("", s, count=1)
    return s.strip()


def tokenize(s):
    s = s.replace("sqrt", "√").replace("pi", "π")
    toks = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == " ":
            i += 1
            continue
        if c in "0123456789.":
            j = i
            while j < len(s) and s[j] in "0123456789.":
                j += 1
            txt = s[i:j]
            if not re.fullmatch(r"\d+\.?\d*|\.\d+", txt):
                return None
            toks.append(("num", float(txt)))
            i = j
            continue
        if c in "+-*/^()√π":
            toks.append((c, None))
            i += 1
            continue
        return None
    return toks


class _Fail(Exception):
    pass


def evaluate(text):
    toks = tokenize(text)
    if not toks:
        return None
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def starts_atom(tk):
        return tk is not None and tk[0] in ("num", "π", "√", "(")

    def expr():
        v = term()
        while peek() is not None and peek()[0] in "+-":
            op = toks[pos[0]][0]
            pos[0] += 1
            r = term()
            v = v + r if op == "+" else v - r
        return v

    def term():
        v = unary()
        while True:
            tk = peek()
            if tk is not None and tk[0] in ("*", "/"):
                pos[0] += 1
                r = unary()
                v = v * r if tk[0] == "*" else v / r
            elif starts_atom(tk):
                v = v * power()
            else:
                break
        return v

    def unary():
        tk = peek()
        if tk is not None and tk[0] == "-":
            pos[0] += 1
            return -unary()
        if tk is not None and tk[0] == "+":
            pos[0] += 1
            return unary()
        return power()

    def power():
        b = atom()
        if peek() is not None and peek()[0] == "^":
            pos[0] += 1
            return math.pow(b, unary())
        return b

    def atom():
        if pos[0] >= len(toks):
            raise _Fail()
        tk = toks[pos[0]]
        pos[0] += 1
        if tk[0] == "num":
            return tk[1]
        if tk[0] == "π":
            return math.pi
        if tk[0] == "√":
            return math.sqrt(atom())
        if tk[0] == "(":
            v = expr()
            if peek() is None or peek()[0] != ")":
                raise _Fail()
            pos[0] += 1
            return v
        raise _Fail()

    try:
        v = expr()
        if pos[0] != len(toks):
            return None
        return v if math.isfinite(v) else None
    except (_Fail, ZeroDivisionError, ValueError, OverflowError):
        return None


def parse_number(s):
    return evaluate(prep(s))


def parse_list(s):
    s = basic(s)
    s = re.sub(r"\b(or|and)\b", ",", s).replace(";", ",")
    s = re.sub(r"[{}\[\]]", "", s)
    out = []
    for piece in s.split(","):
        piece = strip_var(piece.strip())
        if not piece:
            continue
        m = re.match(r"^(±|\+/-|\+-)\s*(.*)$", piece)
        if m:
            v = parse_number(m.group(2))
            if v is None:
                return None
            out += [v, -v]
        else:
            w = parse_number(piece)
            if w is None:
                return None
            out.append(w)
    return out or None


def parse_pair(s):
    s = re.sub(r"[()\[\]]", "", basic(s))
    parts = [p.strip() for p in re.split(r",|;|\band\b", s) if p.strip()]
    if len(parts) != 2:
        return None
    a, b = parse_number(parts[0]), parse_number(parts[1])
    if a is None or b is None:
        return None
    return [a, b]


def norm_short(s):
    s = basic(s)
    s = re.sub(r">=|=>", "≥", s)
    s = re.sub(r"<=|=<", "≤", s)
    s = re.sub(r"\s+", "", s)
    return re.sub(r"\.$", "", s)


def close(a, b, tol):
    return abs(a - b) <= max(tol, 1e-9 * max(1.0, abs(b)))


def rounds_to(got, want, places):
    """True iff got rounds half-up (half away from zero) to want at `places` decimals.
    Same as MathCheck.roundsTo: [A - h, A + h) for A >= 0, (A - h, A + h] for A < 0."""
    h = 0.5 * 10 ** (-places)
    eps = 1e-9 * max(1.0, abs(want))
    d = got - want
    if want >= 0:
        return -h - eps <= d < h - eps
    return -h + eps < d <= h + eps


def matches(item, got, want, tol):
    places = item.get("roundTo")
    if isinstance(places, (int, float)) and not isinstance(places, bool):
        return rounds_to(got, want, places)
    return close(got, want, tol)


def same_list(a, b, tol):
    if not a or not b or len(a) != len(b):
        return False
    return all(close(x, y, tol) for x, y in zip(sorted(a), sorted(b)))


def app_check(item, given):
    """Python copy of MathCheck.check(). Returns (ok, readable)."""
    tol = item.get("tolerance", 1e-6)
    typ = item.get("type", "short")
    if given is None or str(given).strip() == "":
        return False, False
    if typ == "mcq":
        return given == item.get("answer"), True
    options = [item.get("answer")] + list(item.get("acceptable") or [])
    if norm_short(given) and any(norm_short(o) == norm_short(given) for o in options):
        return True, True
    if typ == "numeric":
        v, want = parse_number(given), parse_number(item.get("answer"))
        if v is None:
            return False, False
        return want is not None and matches(item, v, want, tol), True
    if typ == "multi":
        got = parse_list(given)
        if not got:
            return False, False
        return same_list(got, parse_list(item.get("answer")), tol), True
    if typ == "pair":
        pr, exp = parse_pair(given), parse_pair(item.get("answer"))
        if not pr:
            return False, False
        return bool(exp) and close(pr[0], exp[0], tol) and close(pr[1], exp[1], tol), True
    return False, True


# ---------------------------------------------------------------------------
# Independent check expressions
# ---------------------------------------------------------------------------

def roots(a, b, c):
    """Real roots of ax^2 + bx + c = 0, as a sorted list."""
    if a == 0:
        return [-c / b]
    d = b * b - 4 * a * c
    if d < 0:
        return []
    if d == 0:
        return [-b / (2 * a)]
    r = math.sqrt(d)
    return sorted([(-b - r) / (2 * a), (-b + r) / (2 * a)])


CHECK_NS = {
    "__builtins__": {},
    "sqrt": math.sqrt, "pi": math.pi,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "asin": math.asin, "acos": math.acos, "atan": math.atan,
    "radians": math.radians, "degrees": math.degrees,
    "roots": roots, "abs": abs,
}


def run_check(expr):
    # Our own content strings only; evaluated with no builtins.
    return eval(expr, CHECK_NS, {})  # noqa: S307


# ---------------------------------------------------------------------------
# Self-test of the parser (guards against drift from the JS copy)
# ---------------------------------------------------------------------------

def self_test():
    cases = [
        ("7√2", 7 * math.sqrt(2)), ("7sqrt(2)", 7 * math.sqrt(2)), ("√2/2", math.sqrt(2) / 2),
        ("12π", 12 * math.pi), ("12pi", 12 * math.pi), ("3/5", 0.6), ("−4", -4.0), ("-3/2", -1.5),
        ("2(3)", 6.0), ("10/√2", 10 / math.sqrt(2)), ("42 cm²", 42.0), ("57°", 57.0),
        ("x = 4", 4.0), ("$32.50", 32.5), ("2^3", 8.0), ("33 ft", 33.0), ("120 in³", 120.0),
    ]
    for text, want in cases:
        got = parse_number(text)
        if got is None or not close(got, want, 1e-9):
            err(f"parser self-test: {text!r} -> {got}, expected {want}")
    for text in ["abc", "2++", "(3", ""]:
        if parse_number(text) is not None:
            err(f"parser self-test: {text!r} should not parse")
    if not same_list(parse_list("x = 2 or x = -5") or [], [2, -5], 1e-9):
        err("parser self-test: list 'x = 2 or x = -5'")
    if not same_list(parse_list("±4") or [], [4, -4], 1e-9):
        err("parser self-test: list '±4'")
    if parse_pair("(6, −15)") != [6.0, -15.0]:
        err("parser self-test: pair '(6, −15)'")
    if parse_pair("x=6, y=-15") != [6.0, -15.0]:
        err("parser self-test: pair 'x=6, y=-15'")
    if norm_short("x <= 5") != norm_short("x ≤ 5"):
        err("parser self-test: <= normalization")
    _figure_self_test()

    # Rounding rule (roundTo) vs. inclusive tolerance (exact-form items).
    for got, want, places, expect in [
        (42.5, 42, 0, False), (41.5, 42, 0, True), (41.96, 42, 0, True),
        (11.55, 11.5, 1, False), (11.45, 11.5, 1, True), (11.4715, 11.5, 1, True),
        (18.85, 18.8, 1, False), (18.79, 18.8, 1, True),
        (-2.5, -3, 0, True), (-3.5, -3, 0, False),  # half away from zero for negatives
    ]:
        if rounds_to(got, want, places) != expect:
            err(f"rounding self-test: {got} vs {want} at {places} dp should be {expect}")
    exact = {"type": "numeric", "answer": "7√2", "tolerance": 0.01}
    for given, expect in [("7√2", True), ("9.90", True), ("9.89", True), ("9.88", False)]:
        if app_check(exact, given)[0] != expect:
            err(f"exact-form self-test: {given!r} vs 7√2 (tol 0.01) should be {expect}")
    exact_pi = {"type": "numeric", "answer": "12π", "tolerance": 0.01}
    for given, expect in [("12π", True), ("37.70", True), ("37.69", True), ("37.6", False)]:
        if app_check(exact_pi, given)[0] != expect:
            err(f"exact-form self-test: {given!r} vs 12π (tol 0.01) should be {expect}")


# ---------------------------------------------------------------------------
# Content checks
# ---------------------------------------------------------------------------

TYPES = {"mcq", "numeric", "multi", "pair", "short"}
UNSAFE_HTML = re.compile(r"<\s*(script|iframe|object|embed|img|link|style)|\son\w+\s*=|javascript:", re.I)

checked_ids = []
hand_review = []

# Rounded-answer boundaries, run through the app checker against the real items.
# (value typed by the student, should the app accept it?)
ROUNDING_CASES = {
    "trig-p09": [("42", True), ("42.5", False), ("41.5", True), ("41.96", True),
                 ("41.4", False), ("42.49", True), ("43", False)],        # nearest foot
    "trig-p08": [("11.5", True), ("11.55", False), ("11.45", True), ("11.4715", True),
                 ("11.44", False), ("11.6", False)],                     # nearest tenth
    "trig-q05": [("18.8", True), ("18.85", False), ("18.79", True), ("18.75", True),
                 ("18.74", False), ("18.9", False)],                     # nearest tenth
}
ROUNDING_SEEN = set()


def nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""


def check_html(where, text):
    if isinstance(text, str) and UNSAFE_HTML.search(text):
        err(f"{where}: content contains disallowed HTML (scripts, handlers, images, or links)")


# ---------------------------------------------------------------------------
# Triangle diagrams
# ---------------------------------------------------------------------------

DIAGRAM_COUNTS = {"practice": 0, "quiz": 0, "flashcards": 0}
PLAIN_MEASURE = re.compile(
    r"^\s*(\d+(?:\.\d+)?)\s*(?:°|º|cm|mm|ft|in|units?)?\s*$",
    re.I,
)
# A bare trailing m (meters) is allowed, but not a letter glued to the number (3x, 4y).
PLAIN_MEASURE_M = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*m\s*$", re.I)
EXTRA_TRIANGLE_PRACTICE = {"sim-p05", "circ-p01", "circ-p02", "circ-p05", "circ-p08"}
TRIANGLE_WORD = re.compile(r"△|triangles?", re.I)


def practice_needs_diagram(unit_id, item):
    return True


def _has_special(fig):
    return any(k in fig for k in ("grid", "numberline", "balance", "bars", "solid", "solids"))


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _askish(text, fig):
    def walk(obj):
        if isinstance(obj, dict):
            if obj.get("ask") and (obj.get("text") == text or obj.get("num") == text):
                return True
            if obj.get("askLeft") and obj.get("left") == text:
                return True
            if obj.get("askRight") and obj.get("right") == text:
                return True
            return any(walk(v) for v in obj.values())
        if isinstance(obj, list):
            return any(walk(v) for v in obj)
        return False
    return walk(fig)


def _check_special(fig, item, bad):
    g = fig.get("grid")
    if g is not None:
        if not isinstance(g, dict):
            bad("grid must be an object")
        else:
            for key in ("x0", "x1", "y0", "y1"):
                if not _num(g.get(key)):
                    bad(f"grid.{key} must be a number")
            if _num(g.get("x0")) and _num(g.get("x1")) and not g["x0"] < g["x1"]:
                bad("grid x range is empty")
            if _num(g.get("y0")) and _num(g.get("y1")) and not g["y0"] < g["y1"]:
                bad("grid y range is empty")
            if not (g.get("lines") or g.get("points") or g.get("curve") or g.get("ray")):
                bad("grid needs a line, a point, or a curve")
            for ln in g.get("lines") or []:
                if not isinstance(ln, dict) or not _num(ln.get("m")) or not _num(ln.get("b")):
                    bad("grid line needs a numeric slope and intercept")
            for p in g.get("points") or []:
                if not isinstance(p, dict) or not _num(p.get("x")) or not _num(p.get("y")):
                    bad("grid point needs numeric coordinates")
            curve = g.get("curve")
            if curve is not None and (not isinstance(curve, dict) or not all(_num(curve.get(k)) for k in ("a", "b", "c"))):
                bad("parabola needs numeric a, b, and c")
            if item and item.get("type") == "pair":
                ans = parse_pair(str(item.get("answer") or ""))
                if ans:
                    for p in g.get("points") or []:
                        if _num(p.get("x")) and _num(p.get("y")) and abs(p["x"] - ans[0]) < 0.05 and abs(p["y"] - ans[1]) < 0.05:
                            bad("plots the solution point")
                    mk = g.get("mark")
                    if isinstance(mk, dict) and g.get("numbered", True) is not False and _num(mk.get("x")) and _num(mk.get("y")):
                        if abs(mk["x"] - ans[0]) < 0.05 and abs(mk["y"] - ans[1]) < 0.05:
                            bad("marks the solution on a numbered grid")
    nline = fig.get("numberline")
    if nline is not None:
        if not isinstance(nline, dict) or not _num(nline.get("min")) or not _num(nline.get("max")) or not nline["min"] < nline["max"]:
            bad("number line needs a min and a max")
    bal = fig.get("balance")
    if bal is not None:
        if not isinstance(bal, dict) or not nonempty_str(bal.get("left")) or not nonempty_str(bal.get("right")):
            bad("balance needs a left side and a right side")
    bars = fig.get("bars")
    if bars is not None:
        if not isinstance(bars, dict) or not ((bars.get("items") or bars.get("ratios"))):
            bad("bar model needs items or ratios")
    solids = list(fig.get("solids") or [])
    if isinstance(fig.get("solid"), dict):
        solids.append(fig["solid"])
    for s in solids:
        if s.get("kind") not in ("box", "cube", "cylinder", "cone", "sphere", "pyramid"):
            bad(f"unknown solid kind {s.get('kind')!r}")


def _special_texts(fig):
    out = []
    g = fig.get("grid") or {}
    for ln in g.get("lines") or []:
        if ln.get("text"):
            out.append(ln["text"])
    for p in g.get("points") or []:
        if p.get("text"):
            out.append(p["text"])
    for key in ("vline", "mark", "ray"):
        if isinstance(g.get(key), dict) and g[key].get("text"):
            out.append(g[key]["text"])
    tri = g.get("tri") or {}
    for key in ("runText", "riseText"):
        if tri.get(key):
            out.append(tri[key])
    nline = fig.get("numberline") or {}
    if nline.get("caption"):
        out.append(nline["caption"])
    for m in nline.get("marks") or []:
        if m.get("text"):
            out.append(m["text"])
    bal = fig.get("balance") or {}
    for key in ("left", "right", "sign"):
        if bal.get(key):
            out.append(bal[key])
    bars = fig.get("bars") or {}
    if bars.get("total"):
        out.append(bars["total"])
    if bars.get("caption"):
        out.append(bars["caption"])
    for it in bars.get("items") or []:
        if it.get("text"):
            out.append(it["text"])
    for r in bars.get("ratios") or []:
        out.extend([r.get("num") or "", r.get("den") or ""])
    solids = list(fig.get("solids") or [])
    if isinstance(fig.get("solid"), dict):
        solids.append(fig["solid"])
    for s in solids:
        for key in ("lw", "ld", "lh", "le", "lr", "ls"):
            if s.get(key):
                out.append(s[key])
    return [t for t in out if t]


def plain_measure(text):
    if not isinstance(text, str):
        return None
    m = PLAIN_MEASURE.match(text) or PLAIN_MEASURE_M.match(text)
    return float(m.group(1)) if m else None


def _xy(p):
    return (float(p["x"]), float(p["y"]))


def _dist(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _angle_deg(pts, at, a, b):
    p, u, v = pts[at], pts[a], pts[b]
    v1 = (u[0] - p[0], u[1] - p[1])
    v2 = (v[0] - p[0], v[1] - p[1])
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def _direction(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180


def _poly_area(coords):
    a = 0.0
    for i, p in enumerate(coords):
        q = coords[(i + 1) % len(coords)]
        a += p[0] * q[1] - q[0] * p[1]
    return abs(a) / 2


def _prompt_has_number(prompt, value):
    text = re.sub(r"<[^>]+>", " ", prompt or "")
    for m in re.finditer(r"\d+(?:\.\d+)?", text):
        if abs(float(m.group(0)) - value) > 1e-6:
            continue
        end = m.end()
        if end < len(text) and text[end].isalpha():
            continue
        return True
    return False


def _norm_label(s):
    return re.sub(r"\s+", "", basic(str(s)))


def _text_gives_answer(text, item):
    """True when a diagram label states the thing the problem asks for."""
    if not text or item is None:
        return False
    ans = "" if item.get("answer") is None else str(item.get("answer"))
    if ans and _norm_label(text) == _norm_label(ans):
        ln, an = plain_measure(text), plain_measure(ans)
        if ln is not None and an is not None and abs(ln - an) < 1e-6:
            if _prompt_has_number(item.get("prompt"), ln):
                return False
        return True
    if item.get("type") == "numeric":
        av = value_of("numeric", ans)
        if isinstance(av, (int, float)):
            for m in re.finditer(r"\d+(?:\.\d+)?", str(text)):
                if abs(float(m.group(0)) - float(av)) > 1e-6:
                    continue
                end = m.end()
                if end < len(str(text)) and str(text)[end].isalpha():
                    continue
                if not _prompt_has_number(item.get("prompt"), float(av)):
                    return True
    if item.get("type") == "mcq" and ans:
        an = plain_measure(ans)
        if an is not None and _prompt_has_number(item.get("prompt"), an):
            return False
        if len(ans) <= 16 and re.search(r"(?<![A-Za-z0-9])" + re.escape(ans) + r"(?![A-Za-z0-9])", str(text)):
            return True
        if len(ans) > 16 and ans.lower() in str(text).lower():
            return True
    return False


def _seg_value(seg):
    text = seg.get("text")
    labeled = plain_measure(text) if text else None
    draw = seg.get("draw")
    if isinstance(draw, bool):
        draw = None
    if labeled is not None and isinstance(draw, (int, float)):
        if abs(labeled - float(draw)) > max(0.05, abs(float(draw)) * 0.02):
            return labeled, "label does not match draw length"
    if labeled is not None:
        return labeled, None
    if isinstance(draw, (int, float)):
        return float(draw), None
    return None, None


def _angle_target(g):
    if g.get("right"):
        return 90.0
    if isinstance(g.get("deg"), (int, float)) and not isinstance(g.get("deg"), bool):
        return float(g["deg"])
    text = g.get("text") or ""
    if "°" in text or "º" in text:
        return plain_measure(text)
    return None


def figure_problems(fig, item=None, where="figure"):
    """Return a list of problems. Empty means the diagram parses and is consistent."""
    problems = []

    def bad(msg):
        problems.append(f"{where}: {msg}")

    if not isinstance(fig, dict):
        bad("figure must be an object")
        return problems
    alt = fig.get("alt")
    if not nonempty_str(alt):
        bad("figure needs an alt description")
    elif "<" in alt or ">" in alt:
        bad("figure alt must be plain text")
    elif _text_gives_answer(alt, item):
        bad("figure alt gives away the answer")

    for text in _special_texts(fig):
        if re.search(r"<\s*/?\s*[a-z]", text, re.I):
            bad(f"label {text!r} must be plain text")
        elif _text_gives_answer(text, item):
            bad(f"label {text!r} gives away the answer")
        elif _askish(text, fig) and plain_measure(text) is not None:
            bad(f"unknown is labeled {text!r}")
    _check_special(fig, item, bad)

    pts = fig.get("pts")
    if not isinstance(pts, list) or len(pts) < 2:
        if not _has_special(fig):
            bad("figure needs a drawing")
        else:
            try:
                _figure_svg(fig)
            except Exception as e:  # noqa: BLE001
                bad(f"diagram does not parse as SVG ({e})")
        return problems
    by_id = {}
    for p in pts:
        if not isinstance(p, dict) or not nonempty_str(p.get("id")):
            bad("each point needs an id")
            continue
        pid = p["id"]
        if pid in by_id:
            bad(f"duplicate point id {pid}")
        for coord in ("x", "y"):
            if isinstance(p.get(coord), bool) or not isinstance(p.get(coord), (int, float)):
                bad(f"point {pid} needs numeric {coord}")
        if pid not in by_id and isinstance(p.get("x"), (int, float)) and isinstance(p.get("y"), (int, float)):
            by_id[pid] = _xy(p)
        name = p.get("name")
        if name is not None and not isinstance(name, str):
            bad(f"point {pid} name must be text")
        elif name and _text_gives_answer(name, item):
            bad(f"point name {name!r} gives away the answer")

    coords = by_id
    polys = fig.get("polys") or []
    if not isinstance(polys, list):
        bad("polys must be a list")
        polys = []
    if not polys and not fig.get("circles") and not fig.get("segs") and not _has_special(fig):
        bad("figure needs a shape")
    for i, poly in enumerate(polys):
        if not isinstance(poly, list) or len(poly) < 3:
            bad(f"polygon {i} needs at least 3 vertices")
            continue
        missing = [pid for pid in poly if pid not in coords]
        if missing:
            bad(f"polygon {i} references unknown points {missing}")
            continue
        if _poly_area([coords[pid] for pid in poly]) < 20:
            bad(f"polygon {i} is degenerate")
    def ref_pt(pid, what):
        if pid not in coords:
            bad(f"{what} references unknown point {pid}")
            return False
        return True

    segs = fig.get("segs") or []
    if not isinstance(segs, list):
        bad("segs must be a list")
        segs = []
    angles = fig.get("angles") or []
    if not isinstance(angles, list):
        bad("angles must be a list")
        angles = []

    ratio_groups = {}
    tick_groups = {}
    for s in segs:
        if not isinstance(s, dict):
            bad("seg must be an object")
            continue
        if not ref_pt(s.get("a"), "seg") or not ref_pt(s.get("b"), "seg"):
            continue
        if s.get("a") == s.get("b"):
            bad("seg has zero length")
            continue
        text = s.get("text") or ""
        if text and ("<" in text or ">" in text):
            bad(f"seg label {text!r} must be plain text")
        if s.get("ask") and plain_measure(text) is not None:
            bad(f"unknown side is labeled {text!r} (use x or ?)")
        if text and _text_gives_answer(text, item):
            bad(f"side label {text!r} gives away the answer")
        ticks = s.get("ticks", 0)
        if isinstance(ticks, bool) or not isinstance(ticks, int) or not 0 <= ticks <= 3:
            bad("ticks must be a whole number 0-3")
            ticks = 0
        arrows = s.get("arrows", 0)
        if isinstance(arrows, bool) or not isinstance(arrows, int) or not 0 <= arrows <= 2:
            bad("arrows must be a whole number 0-2")
        length = _dist(coords[s["a"]], coords[s["b"]])
        if length < 8:
            bad(f"seg {s.get('a')}{s.get('b')} is too short to read")
        value, mismatch = _seg_value(s)
        if mismatch:
            bad(f"seg {s.get('a')}{s.get('b')}: {mismatch}")
        if value is not None:
            ratio_groups.setdefault(s.get("scale") or "default", []).append((value, length, f"{s.get('a')}{s.get('b')}"))
        if ticks:
            tick_groups.setdefault(ticks, []).append((length, f"{s.get('a')}{s.get('b')}"))

    for scale, group in ratio_groups.items():
        if len(group) < 2:
            continue
        ratios = [px / val for val, px, _ in group if val]
        if not ratios or min(ratios) <= 0:
            bad(f"scale {scale} has a zero length")
            continue
        if max(ratios) / min(ratios) > 1.08:
            bad(f"scale {scale} sides are not in proportion " +
                ", ".join(f"{name}={val:g} drawn {px:.1f}" for val, px, name in group))

    for ticks, group in tick_groups.items():
        if len(group) < 2:
            continue
        lengths = [px for px, _ in group]
        if max(lengths) / min(lengths) > 1.08:
            bad(f"tick-{ticks} sides should be congruent but differ: " +
                ", ".join(f"{name}={px:.1f}" for px, name in group))

    # Parallel marks.
    arrow_groups = {}
    for s in segs:
        arrows = s.get("arrows") or 0
        if not arrows or s.get("a") not in coords or s.get("b") not in coords:
            continue
        arrow_groups.setdefault(arrows, []).append(s)
    for arrows, group in arrow_groups.items():
        if len(group) < 2:
            continue
        dirs = [_direction(coords[s["a"]], coords[s["b"]]) for s in group]
        for d in dirs[1:]:
            delta = abs(dirs[0] - d) % 180
            delta = min(delta, 180 - delta)
            if delta > 6:
                bad(f"arrow-{arrows} sides should be parallel ({delta:.1f}° apart)")

    arc_groups = {}
    for g in angles:
        if not isinstance(g, dict):
            bad("angle must be an object")
            continue
        if not ref_pt(g.get("at"), "angle") or not ref_pt(g.get("a"), "angle") or not ref_pt(g.get("b"), "angle"):
            continue
        if len({g.get("at"), g.get("a"), g.get("b")}) < 3:
            bad("angle needs three distinct points")
            continue
        measured = _angle_deg(coords, g["at"], g["a"], g["b"])
        if measured is None:
            bad(f"angle at {g.get('at')} is degenerate")
            continue
        text = g.get("text") or ""
        if text and ("<" in text or ">" in text):
            bad(f"angle label {text!r} must be plain text")
        if g.get("ask") and plain_measure(text) is not None:
            bad(f"unknown angle is labeled {text!r} (use x or ?)")
        if text and _text_gives_answer(text, item):
            bad(f"angle label {text!r} gives away the answer")
        arcs = g.get("arcs", 0) or 0
        if isinstance(arcs, bool) or not isinstance(arcs, int) or not 0 <= arcs <= 3:
            bad("arcs must be a whole number 0-3")
            arcs = 0
        target = _angle_target(g)
        tol = 4.0 if g.get("right") else 6.0
        if target is not None and abs(measured - target) > tol:
            label = "right angle" if g.get("right") else (text or f"{target:g}°")
            bad(f"angle at {g.get('at')} is drawn {measured:.1f}° but marked {label}")
        if arcs and not g.get("right"):
            arc_groups.setdefault(arcs, []).append((measured, g.get("at")))
    for arcs, group in arc_groups.items():
        if len(group) < 2:
            continue
        degs = [d for d, _ in group]
        if max(degs) - min(degs) > 6:
            bad(f"arc-{arcs} angles should be congruent but differ: " +
                ", ".join(f"{at}={d:.1f}°" for d, at in group))

    for c in fig.get("circles") or []:
        if not isinstance(c, dict) or not ref_pt(c.get("c"), "circle"):
            continue
        r = c.get("r")
        if isinstance(r, bool) or not isinstance(r, (int, float)) or r <= 0:
            bad("circle needs a positive radius")
        mark = c.get("mark")
        if isinstance(mark, dict):
            if mark.get("text") and _text_gives_answer(mark.get("text"), item):
                bad(f"arc label {mark.get('text')!r} gives away the answer")
            if mark.get("ask") and plain_measure(mark.get("text") or "") is not None:
                bad("unknown arc is labeled with a number")
    for n in fig.get("notes") or []:
        if isinstance(n, dict) and n.get("text") and _text_gives_answer(n.get("text"), item):
            bad(f"note {n.get('text')!r} gives away the answer")
        if isinstance(n, dict) and n.get("ask") and plain_measure(n.get("text") or "") is not None:
            bad("unknown note is labeled with a number")

    try:
        _figure_svg(fig)
    except Exception as e:  # noqa: BLE001
        bad(f"diagram does not parse as SVG ({e})")
    return problems


def _figure_svg(fig):
    import xml.etree.ElementTree as ET
    svg = ET.Element("svg", xmlns="http://www.w3.org/2000/svg")
    title = ET.SubElement(svg, "title")
    title.text = fig.get("alt") or "diagram"
    by_id = {p["id"]: p for p in fig.get("pts") or [] if isinstance(p, dict) and "id" in p}
    for poly in fig.get("polys") or []:
        if not isinstance(poly, list):
            continue
        pts = []
        for pid in poly:
            p = by_id.get(pid)
            if p:
                pts.append(f"{p['x']},{p['y']}")
        ET.SubElement(svg, "polygon", points=" ".join(pts))
    for s in fig.get("segs") or []:
        if isinstance(s, dict) and s.get("a") in by_id and s.get("b") in by_id:
            a, b = by_id[s["a"]], by_id[s["b"]]
            ET.SubElement(svg, "line", x1=str(a["x"]), y1=str(a["y"]), x2=str(b["x"]), y2=str(b["y"]))
    xml = ET.tostring(svg, encoding="unicode")
    ET.fromstring(xml)


def _figure_self_test():
    fig = {
        "alt": "Right triangle with legs 3 and 4. The hypotenuse is marked unknown.",
        "pts": [
            {"id": "C", "x": 0, "y": 0, "name": "C"},
            {"id": "B", "x": 80, "y": 0, "name": "B"},
            {"id": "A", "x": 0, "y": 60, "name": "A"},
        ],
        "polys": [["A", "B", "C"]],
        "segs": [
            {"a": "C", "b": "B", "text": "4", "draw": 4, "scale": "t"},
            {"a": "C", "b": "A", "text": "3", "draw": 3, "scale": "t"},
            {"a": "A", "b": "B", "text": "x", "ask": True, "draw": 5, "scale": "t"},
        ],
        "angles": [{"at": "C", "a": "A", "b": "B", "right": True}],
    }
    item = {"type": "numeric", "answer": "5", "prompt": "legs 3 and 4"}
    probs = figure_problems(fig, item, "self-test")
    if probs:
        err("figure self-test failed: " + "; ".join(probs))
    sneak = {
        "alt": "Right triangle",
        "pts": fig["pts"],
        "polys": fig["polys"],
        "segs": [{"a": "A", "b": "B", "text": "5", "ask": True, "scale": "t"}],
        "angles": [],
    }
    if not figure_problems(sneak, item, "self-test"):
        err("figure self-test: a numeric label on the unknown side should be rejected")
    skew = {
        "alt": "A triangle with a right-angle mark that is not square.",
        "pts": [
            {"id": "C", "x": 0, "y": 0},
            {"id": "B", "x": 100, "y": 0},
            {"id": "A", "x": 40, "y": 70},
        ],
        "polys": [["A", "B", "C"]],
        "segs": [],
        "angles": [{"at": "C", "a": "A", "b": "B", "right": True}],
    }
    if not any("right" in p for p in figure_problems(skew, None, "self-test")):
        err("figure self-test: a non-right angle marked right should be rejected")


def check_figure(unit_id, kind, item, where):
    fig = item.get("figure")
    needs = kind == "practice" and practice_needs_diagram(unit_id, item)
    if fig is None:
        if needs:
            err(f"{where}: practice item has no diagram")
        return
    if kind in DIAGRAM_COUNTS:
        DIAGRAM_COUNTS[kind] += 1
    # Flashcards teach the fact on the back, so the diagram may state it.
    leak_item = None if kind == "flashcards" else item
    for msg in figure_problems(fig, leak_item, where):
        err(msg)


def value_of(typ, text):
    if typ == "numeric":
        return parse_number(text)
    if typ == "multi":
        return parse_list(text)
    if typ == "pair":
        return parse_pair(text)
    return None


def values_equal(typ, a, b, tol):
    if a is None or b is None:
        return False
    if typ == "numeric":
        return close(float(a), float(b), tol)
    if typ == "multi":
        return same_list(list(a), list(b), tol)
    if typ == "pair":
        return len(a) == 2 and len(b) == 2 and close(a[0], b[0], tol) and close(a[1], b[1], tol)
    return False


def check_item(unit_id, kind, item, seen_ids):
    iid = item.get("id")
    where = f"{unit_id}/{kind}/{iid or '?'}"
    if not nonempty_str(iid):
        err(f"{where}: missing id")
    elif iid in seen_ids:
        err(f"{where}: duplicate id (also in {seen_ids[iid]})")
    else:
        seen_ids[iid] = unit_id
    typ = item.get("type")
    if typ not in TYPES:
        err(f"{where}: type must be one of {sorted(TYPES)}")
        return
    for field in ("prompt", "answer", "solution"):
        if not nonempty_str(item.get(field)):
            err(f"{where}: missing {field}")
    hints = item.get("hints")
    if not isinstance(hints, list) or len([x for x in hints if nonempty_str(x)]) < 2:
        err(f"{where}: needs at least 2 hints")
    acceptable = item.get("acceptable", [])
    if not isinstance(acceptable, list):
        err(f"{where}: acceptable must be a list")
        acceptable = []
    for field in ("prompt", "solution"):
        check_html(where, item.get(field))
    for hnt in hints or []:
        check_html(where, hnt)
    check_figure(unit_id, kind, item, where)
    tol = item.get("tolerance", 1e-6)
    if not isinstance(tol, (int, float)) or tol < 0:
        err(f"{where}: tolerance must be a non-negative number")
        tol = 1e-6
    answer = item.get("answer")
    if "roundTo" in item:
        rt = item.get("roundTo")
        if typ != "numeric":
            err(f"{where}: roundTo is only supported on numeric items")
        elif not isinstance(rt, int) or isinstance(rt, bool) or not 0 <= rt <= 6:
            err(f"{where}: roundTo must be a whole number of decimal places (0-6)")
    if iid in ROUNDING_CASES:
        ROUNDING_SEEN.add(iid)
        if "roundTo" not in item:
            err(f"{where}: rounded-answer item is missing roundTo")
        for given, expect in ROUNDING_CASES[iid]:
            ok, _ = app_check(item, given)
            if ok != expect:
                err(f"{where}: rounding boundary {given!r} should be {'accepted' if expect else 'rejected'}")

    if typ == "mcq":
        choices = item.get("choices")
        if not isinstance(choices, list) or len(choices) < 2:
            err(f"{where}: mcq needs at least 2 choices")
        else:
            if len(set(choices)) != len(choices):
                err(f"{where}: duplicate choices")
            if answer not in choices:
                err(f"{where}: answer {answer!r} is not one of the choices")
        hand_review.append(iid)
        return

    # Every listed answer must be accepted by the app's checker.
    for given in [answer] + acceptable:
        ok, readable = app_check(item, given)
        if not ok:
            err(f"{where}: the app would NOT accept {given!r} (readable={readable})")

    if typ == "short":
        hand_review.append(iid)
        return

    want = value_of(typ, answer)
    if want is None:
        err(f"{where}: answer {answer!r} does not parse as {typ}")
        return
    for acc in acceptable:
        v = value_of(typ, acc)
        if v is None:
            err(f"{where}: acceptable {acc!r} does not parse")
        elif not values_equal(typ, v, want, tol):
            err(f"{where}: acceptable {acc!r} = {v} differs from answer {answer!r} = {want}")

    # Wrong answers must be rejected.
    if typ == "numeric":
        wrong = str(want + max(1.0, abs(want) * 0.2))
        if app_check(item, wrong)[0]:
            err(f"{where}: the app accepts a wrong value {wrong}")

    expr = item.get("check")
    if not expr:
        hand_review.append(iid)
        return
    try:
        got = run_check(expr)
    except Exception as e:  # noqa: BLE001
        err(f"{where}: check expression failed: {e}")
        return
    if typ == "numeric":
        ok = isinstance(got, (int, float)) and matches(item, float(got), want, tol)
    elif typ == "multi":
        ok = isinstance(got, list) and same_list(list(want), [float(x) for x in got], tol)
    else:
        ok = isinstance(got, list) and len(got) == 2 and close(want[0], got[0], tol) and close(want[1], got[1], tol)
    if ok:
        checked_ids.append(iid)
    else:
        err(f"{where}: MATH MISMATCH — answer {answer!r} = {want} but check `{expr}` = {got}")


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        err(f"{path.relative_to(ROOT)}: cannot parse JSON: {e}")
        return None


def check_content():
    cfg = load_json(CONTENT / "app.json")
    if not isinstance(cfg, dict):
        return []
    app = cfg.get("app", {})
    for k in ("title", "studentFirstName"):
        if k not in app:
            warn(f"app.json: app.{k} missing")
    unit_files = cfg.get("units")
    if not isinstance(unit_files, list) or not unit_files:
        err("app.json: 'units' must be a non-empty list of unit file names")
        return []
    strands = cfg.get("strands", {})
    seen_units, seen_ids, inventory = set(), {}, []
    for name in unit_files:
        path = CONTENT / "units" / f"{name}.json"
        if not path.exists():
            err(f"app.json lists unit '{name}' but {path.relative_to(ROOT)} is missing")
            continue
        unit = load_json(path)
        if not isinstance(unit, dict):
            continue
        uid = unit.get("id")
        if not nonempty_str(uid):
            err(f"{path.name}: missing unit id")
            continue
        if uid in seen_units:
            err(f"{path.name}: duplicate unit id '{uid}'")
        seen_units.add(uid)
        if uid != name:
            warn(f"{path.name}: unit id '{uid}' differs from file name '{name}'")
        if not nonempty_str(unit.get("title")):
            err(f"{uid}: missing title")
        if unit.get("strand") not in strands:
            warn(f"{uid}: strand '{unit.get('strand')}' is not in app.json strands (shown under 'Other')")
        practice = unit.get("practice", [])
        cards = unit.get("flashcards", [])
        quiz = unit.get("quiz", [])
        for kind, items in (("practice", practice), ("quiz", quiz)):
            if not isinstance(items, list):
                err(f"{uid}: {kind} must be a list")
                continue
            for item in items:
                check_item(uid, kind, item, seen_ids)
        for card in cards if isinstance(cards, list) else []:
            cid = card.get("id")
            where = f"{uid}/flashcards/{cid or '?'}"
            if not nonempty_str(cid):
                err(f"{where}: missing id")
            elif cid in seen_ids:
                err(f"{where}: duplicate id")
            else:
                seen_ids[cid] = uid
            if not nonempty_str(card.get("front")) or not nonempty_str(card.get("back")):
                err(f"{where}: needs front and back")
            check_html(where, card.get("front"))
            check_html(where, card.get("back"))
            check_figure(uid, "flashcards", card, where)
        if len(practice) < 8:
            warn(f"{uid}: only {len(practice)} practice items (target ~10)")
        if not 8 <= len(cards) <= 12:
            warn(f"{uid}: {len(cards)} flashcards (target 8-12)")
        if not 6 <= len(quiz) <= 8:
            warn(f"{uid}: {len(quiz)} quiz items (target 6-8)")
        types = {}
        for it in practice + quiz:
            types[it.get("type")] = types.get(it.get("type"), 0) + 1
        inventory.append((uid, unit.get("title", ""), unit.get("strand", ""), len(practice), len(cards), len(quiz), types))
    return inventory


# ---------------------------------------------------------------------------
# Static file checks
# ---------------------------------------------------------------------------

def check_static(unit_ids):
    for rel in ("index.html", "manifest.json", "sw.js", "css/styles.css", "js/app.js", "js/store.js",
                "js/mathcheck.js", "js/figures.js", "icons/icon.svg"):
        if not (ROOT / rel).exists():
            err(f"missing file: {rel}")

    man = load_json(ROOT / "manifest.json") if (ROOT / "manifest.json").exists() else None
    if isinstance(man, dict):
        for k in ("name", "short_name", "start_url", "display", "theme_color", "icons"):
            if k not in man:
                err(f"manifest.json: missing {k}")
        if man.get("display") != "standalone":
            err("manifest.json: display should be 'standalone'")
        for icon in man.get("icons", []):
            if not (ROOT / icon.get("src", "")).exists():
                warn(f"manifest icon {icon.get('src')} not found — run: python3 tools/make_icons.py")
    if not (ROOT / "icons/apple-touch-icon.png").exists():
        warn("icons/apple-touch-icon.png not found — run: python3 tools/make_icons.py")

    sw = (ROOT / "sw.js").read_text(encoding="utf-8") if (ROOT / "sw.js").exists() else ""
    if "js/figures.js" not in sw:
        err("sw.js CORE list is missing js/figures.js")
    if re.search(r"VERSION\s*=\s*'mathlab-v[12]'", sw):
        err("sw.js VERSION was not bumped past mathlab-v2; phones would keep a stale cache")
    html = (ROOT / "index.html").read_text(encoding="utf-8") if (ROOT / "index.html").exists() else ""
    if "js/figures.js" not in html:
        err("index.html does not load js/figures.js")
    for uid in unit_ids:
        if f"content/units/{uid}.json" not in sw:
            warn(f"sw.js CORE list is missing content/units/{uid}.json (it will still be cached after first online load)")

    # Any absolute URL (http://, https://, or protocol-relative //host in src/href/url()) is an error,
    # except the localhost hint shown in the "couldn't load" message.
    abs_re = re.compile(r"https?://[^\s'\"<>)]+", re.I)
    rel_re = re.compile(r"""(?:src|href)\s*=\s*["']//|url\(\s*["']?//""", re.I)
    scan = [ROOT / "index.html", ROOT / "sw.js", ROOT / "manifest.json"]
    scan += sorted((ROOT / "css").glob("*.css")) + sorted((ROOT / "js").glob("*.js")) + sorted(CONTENT.rglob("*.json"))
    for path in scan:
        if not path.exists():
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for m in abs_re.finditer(line):
                if m.group(0).lower().startswith("http://localhost"):
                    continue
                err(f"{path.relative_to(ROOT)}:{n}: external URL {m.group(0)!r} (app must not load anything off-site)")
            if rel_re.search(line):
                err(f"{path.relative_to(ROOT)}:{n}: protocol-relative URL (app must not load anything off-site)")


# ---------------------------------------------------------------------------

def main():
    self_test()
    inventory = check_content()
    for iid in sorted(set(ROUNDING_CASES) - ROUNDING_SEEN):
        err(f"rounding boundary cases: item {iid} not found in content")
    check_static([row[0] for row in inventory])

    print("Math Lab content inventory")
    print("-" * 72)
    print(f"{'unit':<18}{'strand':<10}{'practice':>9}{'cards':>7}{'quiz':>6}   types")
    tp = tc = tq = 0
    for uid, _title, strand, p, c, q, types in inventory:
        tp, tc, tq = tp + p, tc + c, tq + q
        tstr = ", ".join(f"{k}:{v}" for k, v in sorted(types.items(), key=lambda kv: str(kv[0])))
        print(f"{uid:<18}{strand:<10}{p:>9}{c:>7}{q:>6}   {tstr}")
    print("-" * 72)
    print(f"{'TOTAL':<28}{tp:>9}{tc:>7}{tq:>6}   ({len(inventory)} units)")
    print()
    print(f"Math machine-checked against an independent expression: {len(checked_ids)} items")
    n_round = sum(len(ROUNDING_CASES[i]) for i in ROUNDING_SEEN)
    print(f"Rounded-answer boundary cases run: {n_round} across {len(ROUNDING_SEEN)} items")
    print(f"Needs review by hand (MCQ / text answers / no check expression): {len(hand_review)} items")
    if hand_review:
        print("  " + ", ".join(hand_review))
    print(f"Diagrams: {DIAGRAM_COUNTS['practice']} practice, {DIAGRAM_COUNTS['quiz']} quiz, {DIAGRAM_COUNTS['flashcards']} flashcards")
    print()
    for w in warnings:
        print("WARNING:", w)
    for e in errors:
        print("ERROR:", e)
    if errors:
        print(f"\nFAILED: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"\nOK: 0 errors, {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
