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
  4. Static files: manifest fields, service-worker cache list, no external URLs.
  5. Prints an inventory (units and counts).

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
                "js/mathcheck.js", "icons/icon.svg"):
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
