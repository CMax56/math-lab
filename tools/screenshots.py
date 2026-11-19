#!/usr/bin/env python3
"""Smoke-test every screen in a headless browser and take phone screenshots.

Run from anywhere:  python3 tools/screenshots.py
Needs: Python playwright with chromium installed.

index.html has <base href="/math-lab/"> (the GitHub Pages subpath), so this
serves a temp folder where /math-lab/ points at the repo. The browser clock is
frozen at 2026-11-18 so Term 2 shows as the current term.

  1. Visits every route (home, make-up, parent, each unit, every practice item,
     flashcards, quiz) at 390x844 and fails on any console error or page error.
  2. Checks the home term sections (Term 2 open with a "Now" badge).
  3. Plays a full quiz on a new unit, answering correctly.
  4. Saves screenshots to screenshots/.
Exit code 0 = no browser errors and all checks passed.
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "screenshots"
FROZEN = "2026-11-18T10:00:00"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    OUT.mkdir(exist_ok=True)
    tmp = tempfile.mkdtemp()
    os.symlink(ROOT, os.path.join(tmp, "math-lab"))
    port = free_port()
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                           cwd=tmp, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}/math-lab/"
    errors, fails = [], []
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)
        cfg = json.loads((ROOT / "content" / "app.json").read_text())
        units = {uid: json.loads((ROOT / "content" / "units" / f"{uid}.json").read_text()) for uid in cfg["units"]}
        mq = (cfg.get("makeupQuizzes") or {}).get("quizzes") or []
        prep_ids = {q["prepUnit"] for q in mq}
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                      is_mobile=True, has_touch=True, service_workers="block")
            ctx.clock.set_fixed_time(FROZEN)
            page = ctx.new_page()
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text} @ {page.url}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e} @ {page.url}"))
            page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url}"))

            def go(route):
                page.goto(base + "index.html#" + route)
                page.wait_for_selector("#app > :not(.loading)")
                page.wait_for_timeout(80)

            # Full-page captures would paint the sticky/fixed bars mid-page. The page's CSP blocks
            # injected <style> tags, so pin the bars to the page ends through the CSSOM instead.
            PIN = """() => {
              document.querySelector('.topbar').style.position = 'static';
              document.body.style.position = 'relative';
              document.querySelector('.tabbar').style.position = 'absolute';
            }"""

            def shot(name, full=True):
                page.evaluate(PIN)
                page.wait_for_timeout(80)
                page.screenshot(path=str(OUT / name), full_page=full)

            # ---- 1. every route ----
            routes = ["/", "/makeup", "/parent", "/cheatsheet"]
            for uid, u in units.items():
                routes += [f"/unit/{uid}", f"/cards/{uid}", f"/quiz/{uid}"]
                routes += [f"/practice/{uid}/{i}" for i in range(len(u["practice"]))]
            for r in routes:
                go(r)
                if page.locator("text=Not found").count():
                    fails.append(f"route shows Not found: {r}")
                if r.startswith("/practice/") and page.locator(".problem .figure svg").count() != 1:
                    fails.append(f"practice item has no rendered figure: {r}")
            print(f"visited {len(routes)} routes")

            # ---- 2. home term sections ----
            go("/")
            terms = page.locator("details.term")
            if terms.count() != len(cfg["terms"]):
                fails.append(f"home shows {terms.count()} term sections, expected {len(cfg['terms'])}")
            open_ids = page.eval_on_selector_all("details.term[open]", "els => els.map(e => e.id)")
            if open_ids != ["term-t2"]:
                fails.append(f"expected only Term 2 open on 2026-11-18, got {open_ids}")
            if page.locator("#term-t2 .badge.now").count() != 1:
                fails.append("Term 2 has no Now badge")
            shown = page.eval_on_selector_all("details.term .unit-card", "els => els.length")
            if shown != len(units) - len(prep_ids):
                fails.append(f"home lists {shown} term unit cards, expected {len(units) - len(prep_ids)}")
            # ---- make-up quizzes: first section on home, built from content ----
            order = page.eval_on_selector_all("#app > *", "els => els.map(e => e.className)")
            if len(order) < 2 or "mq-section" not in order[1]:
                fails.append(f"Make-up Quizzes is not the first section under the greeting: {order[:3]}")
            if page.locator(".mq-card").count() != len(mq):
                fails.append(f"home shows {page.locator('.mq-card').count()} make-up quiz cards, expected {len(mq)}")
            note = page.locator(".mq-section .mq-note").inner_text()
            if "Retake during practice time in class" not in note or "not Mondays" not in note:
                fails.append(f"make-up note wrong: {note!r}")
            for q in mq:
                if page.locator(f".mq-card[href='#/unit/{q['prepUnit']}']", has_text=q["name"]).count() != 1:
                    fails.append(f"no make-up card linking {q['name']!r} to {q['prepUnit']}")
            if page.locator(".hero a[href='#/cheatsheet']", has_text="Cheat Sheet").count() != 1:
                fails.append("home has no Cheat Sheet button")
            page.screenshot(path=str(OUT / "home-makeup.png"))
            shot("home.png")
            # expand all terms for a full overview
            page.eval_on_selector_all("details.term", "els => els.forEach(e => e.open = true)")
            shot("home-all-terms.png")
            page.reload()  # same-hash navigation would not re-render
            page.wait_for_selector("details.term")
            page.locator("#term-t2").scroll_into_view_if_needed()
            page.evaluate("document.getElementById('term-t2').scrollIntoView({block: 'start'})")
            page.wait_for_timeout(80)
            page.screenshot(path=str(OUT / "home-term2.png"))
            # toggling a collapsed term opens it
            page.click("#term-t3 > summary")
            page.wait_for_timeout(150)
            if not page.eval_on_selector("#term-t3", "e => e.open"):
                fails.append("Term 3 did not expand on tap")

            # ---- unit page shows term label ----
            go("/unit/triangle-relationships")
            label = page.locator(".term-chip").inner_text()
            if "Term 2" not in label or "Oct 12" not in label:
                fails.append(f"unit page term label wrong: {label!r}")
            shot("unit-triangle-relationships.png")
            go("/unit/exponent-rules")
            ref = page.locator(".ref-card")
            if ref.count() != 1:
                fails.append("exponent-rules unit page has no quick-reference card")
            else:
                text = ref.inner_text()
                for need in ("Product rule", "Quotient rule", "Power rule", "Zero exponent", "Negative exponent"):
                    if need not in text:
                        fails.append(f"reference card is missing {need!r}")
                if page.locator(".ref-card sup").count() < 10:
                    fails.append("reference card exponents are not superscripts")
                # The card must sit at the top: before the Practice / Flashcards / Quiz links.
                if page.evaluate("document.querySelector('.ref-card').compareDocumentPosition(document.querySelector('.actions')) & 4") == 0:
                    fails.append("reference card is not above the unit actions")
            page.screenshot(path=str(OUT / "unit-exponent-rules.png"))
            shot("unit-exponent-rules-full.png")

            # ---- practice items ----
            go("/practice/parallel-perpendicular/2")
            page.fill(".answer-input", "30")
            page.click("button:has-text('Check')")
            if page.locator(".feedback.good").count() != 1:
                fails.append("practice: correct answer not accepted (par-p03)")
            shot("practice-parallel.png")
            go("/practice/transformations/4")
            page.fill(".answer-input", "(-1, 3)")
            page.click("button:has-text('Check')")
            if page.locator(".feedback.good").count() != 1:
                fails.append("practice: correct pair not accepted (tf-p05)")
            shot("practice-transformations.png")
            go("/practice/exponent-rules/0")
            page.fill(".answer-input", "8")
            page.click("button:has-text('Check')")
            if page.locator(".feedback.good").count() != 1:
                fails.append("practice: correct answer not accepted (exp-p01)")
            shot("practice-exponent-product.png")
            for uid, idx, name in [("foundations", 6, "practice-foundations.png"), ("quadrilaterals-polygons", 4, "practice-quads.png"),
                                   ("triangle-relationships", 8, "practice-trirel.png"), ("right-triangles", 10, "practice-depression.png"),
                                   ("area-volume", 11, "practice-net.png"), ("exponent-rules", 3, "practice-exponent-quotient.png"),
                                   ("exponent-rules", 6, "practice-exponent-power.png"), ("exponent-rules", 13, "practice-exponent-mixed.png")]:
                go(f"/practice/{uid}/{idx}")
                shot(name)

            # ---- 3. full quiz on a new unit, all correct ----
            quid = "triangle-relationships"
            go(f"/quiz/{quid}")
            page.click("text=Start quiz")
            for q in units[quid]["quiz"]:
                if q["type"] == "mcq":
                    page.locator(".choice", has_text=q["answer"]).first.click()
                else:
                    page.fill(".answer-input", q["answer"])
                page.click("button:has-text('Check')")
                if page.locator(".feedback.good").count() != 1:
                    fails.append(f"quiz: {q['id']} answer not accepted")
                page.locator(".btn-row button.primary:visible").click()
            score = page.locator(".big-score").inner_text()
            n = len(units[quid]["quiz"])
            if score.replace(" ", "") != f"{n}/{n}":
                fails.append(f"quiz score {score!r}, expected {n}/{n}")
            page.screenshot(path=str(OUT / "quiz-result.png"))
            shot("quiz-result-full.png")

            # ---- flashcards, make-up dropdown, parent view ----
            go("/cards/exponent-rules")
            page.click(".flashcard")
            shot("cards-exponent-rules.png")
            go("/makeup")
            page.click("text=+ Add a make-up test")
            groups = page.eval_on_selector_all("#mu-unit optgroup", "els => els.map(e => e.label)")
            if groups[:5] != ["Make-up quiz prep", "Term 1", "Term 2", "Term 3", "Term 4"]:
                fails.append(f"make-up unit dropdown groups: {groups}")
            page.fill("#mu-name", "Unit test: Relationships in Triangles")
            page.fill("#mu-due", "2026-11-24")
            page.select_option("#mu-unit", "triangle-relationships")
            page.click("button:has-text('Save')")
            if page.locator(".makeup").count() != len(mq) + 1:
                fails.append(f"make-up list has {page.locator('.makeup').count()} entries, expected {len(mq) + 1}")
            if not page.locator(".makeup").first.inner_text().startswith("Unit test: Relationships in Triangles"):
                fails.append("dated make-up entry does not sort first")
            shot("makeup-list.png")
            go("/parent")
            page.fill("#pin-new", "2468")
            page.fill("#pin-confirm", "2468")
            page.click("button:has-text('Set PIN')")
            page.wait_for_selector("table")
            first = page.locator("tbody tr td").first.inner_text()
            if not first.startswith(units[cfg["terms"][0]["units"][0]]["title"]):
                fails.append(f"parent table does not start with the first pacing unit: {first!r}")
            report = page.locator("textarea.report").input_value()
            if "[Term 2] Relationships in Triangles" not in report:
                fails.append("parent report lacks term labels")
            shot("parent.png")

            # ---- make-up prep units: pages, practice, a full prep quiz each ----
            go("/unit/makeup-transversal")
            if "Make-up quiz prep" not in page.locator(".term-chip").inner_text():
                fails.append("prep unit page lacks the Make-up quiz prep chip")
            if page.locator(".related a[href='#/unit/parallel-perpendicular']").count() != 1:
                fails.append("prep unit page lacks the related-unit link")
            shot("unit-makeup-transversal.png")
            for uid, idx in [("makeup-transversal", 5), ("makeup-linear-forms", 9), ("makeup-quotient", 6)]:
                go(f"/practice/{uid}/{idx}")
                shot(f"practice-{uid}.png")
            for quid in sorted(prep_ids):
                go(f"/quiz/{quid}")
                page.click("text=Start quiz")
                for q in units[quid]["quiz"]:
                    if q["type"] == "mcq":
                        page.locator(".choice", has_text=q["answer"]).first.click()
                    else:
                        page.fill(".answer-input", q["answer"])
                    page.click("button:has-text('Check')")
                    if page.locator(".feedback.good").count() != 1:
                        fails.append(f"prep quiz: {q['id']} answer not accepted")
                    page.locator(".btn-row button.primary:visible").click()
                n = len(units[quid]["quiz"])
                score = page.locator(".big-score").inner_text()
                if score.replace(" ", "") != f"{n}/{n}":
                    fails.append(f"prep quiz {quid} score {score!r}, expected {n}/{n}")
            page.screenshot(path=str(OUT / "quiz-result-makeup.png"))
            go("/")
            if "Prep quiz best 100%" not in page.locator(".mq-section").inner_text():
                fails.append("make-up card does not show the prep quiz best score")

            # ---- seeding: fresh device, reload, delete, pre-existing data ----
            def fresh(pre=None):
                c = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
                c.clock.set_fixed_time(FROZEN)
                pg = c.new_page()
                pg.on("pageerror", lambda e: errors.append(f"pageerror (seed test): {e}"))
                if pre is not None:
                    pg.add_init_script("if (!sessionStorage.getItem('pre')) { localStorage.setItem('mathlab.v1', %s); sessionStorage.setItem('pre', '1'); }" % json.dumps(json.dumps(pre)))
                return c, pg
            def saved(pg):
                return json.loads(pg.evaluate("localStorage.getItem('mathlab.v1')") or "{}")
            seed_ids = [q["id"] for q in mq]
            c, pg = fresh()
            pg.goto(base + "index.html#/makeup"); pg.wait_for_selector(".makeup")
            st = saved(pg)
            if [m["id"] for m in st.get("makeups", [])] != seed_ids or any(m.get("due") for m in st["makeups"]):
                fails.append(f"fresh device not seeded with the undated quizzes: {st.get('makeups')}")
            pg.reload(); pg.wait_for_selector(".makeup")
            if len(saved(pg)["makeups"]) != len(mq):
                fails.append("seeding duplicated entries on reload")
            pg.on("dialog", lambda d: d.accept())
            pg.locator(".makeup").first.locator("button:has-text('Delete')").click()
            pg.wait_for_timeout(100)
            pg.reload(); pg.wait_for_selector(".makeup")
            if len(saved(pg)["makeups"]) != len(mq) - 1:
                fails.append("a deleted seeded quiz came back after reload")
            c.close()
            pre = {"version": 1, "makeups": [{"id": "mabc", "name": "Chapter 2 test", "due": "2026-12-01", "unitId": "congruence", "notes": "keep me"},
                                             {"id": "seed-quotient", "name": "My own edit", "due": "2026-11-30", "unitId": "exponent-rules", "notes": "edited"}],
                   "practice": {"par-p01": {"status": "correct"}}}
            c, pg = fresh(pre)
            pg.goto(base + "index.html#/makeup"); pg.wait_for_selector(".makeup")
            st = saved(pg)
            ms = {m["id"]: m for m in st["makeups"]}
            if ms.get("mabc", {}).get("notes") != "keep me" or ms.get("seed-quotient", {}).get("name") != "My own edit":
                fails.append(f"seeding changed saved entries: {st['makeups']}")
            if len(st["makeups"]) != 4 or st.get("practice", {}).get("par-p01", {}).get("status") != "correct":
                fails.append(f"seeding lost or duplicated data: {len(st['makeups'])} entries")
            c.close()

            # ---- geometry cheat sheet (phone width, tables, collapsible proofs) ----
            go("/cheatsheet")
            sheet_text = page.locator("#app").text_content()
            for need in ("Angle vocabulary", "less than 90°", "Reflexive Property", "AB ≅ AB",
                         "Vertical Angles Theorem", "Same-side (consecutive) exterior", "2x + 41 = 51",
                         "x = 5", "x = 20", "SSS", "SSA", "CPCTC", "△AMB ≅ △DMC", "BD ⊥ AC",
                         "Proof-writing checklist", "Last updated Nov 19, 2026", "ℓ ∥ AC"):
                if need not in sheet_text:
                    fails.append(f"cheat sheet missing {need!r}")
            if re.search(r"\bASS\b", sheet_text):
                fails.append("cheat sheet used ASS; the shortcut is SSA")
            if page.locator(".sheet-table").count() < 5:
                fails.append(f"cheat sheet has {page.locator('.sheet-table').count()} tables, expected at least 5")
            page.locator("details.proof").first.locator("summary").click()
            page.wait_for_timeout(80)
            if page.locator("details.proof[open]").count() != 1:
                fails.append("cheat sheet proof did not open")
            opened = page.locator("details.proof[open]").inner_text()
            if "Linear Pair Postulate" not in opened or "∠1 ≅ ∠3" not in opened:
                fails.append("opened angle proof is missing the two-column steps")
            if page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"):
                fails.append("cheat sheet page scrolls sideways on a phone")
            nowrap = page.evaluate("""() => [...document.querySelectorAll('.sheet-table td, .sheet-table th')]
              .filter(td => getComputedStyle(td).whiteSpace === 'nowrap').length""")
            if nowrap:
                fails.append(f"{nowrap} cheat sheet cells are nowrap and will not fit a phone")
            shot("cheatsheet.png")
            for uid in ("transversals", "congruence"):
                go(f"/unit/{uid}")
                if page.locator("a[href='#/cheatsheet']", has_text="Cheat Sheet").count() != 1:
                    fails.append(f"{uid} unit page has no Cheat Sheet link")
            go("/unit/linear")
            if page.locator("a[href='#/cheatsheet']").count() != 0:
                fails.append("linear unit page should not link to the cheat sheet")
            browser.close()
    finally:
        srv.terminate()

    for e in errors:
        print("BROWSER ERROR:", e)
    for f in fails:
        print("FAIL:", f)
    print(f"screenshots in {OUT}")
    if errors or fails:
        print(f"FAILED: {len(errors)} browser error(s), {len(fails)} check failure(s)")
        return 1
    print("OK: no browser errors, all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
