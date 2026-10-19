#!/usr/bin/env python3
"""Runs on GitHub Actions: turns every waiting ANKI job into an .apkg with build_apkg.py.

The study site (index.html) puts the cards Kimi wrote into the `anki-jobs` branch as in/<id>.json,
then asks GitHub to run this. For each waiting job it writes:
  out/<id>.apkg  the deck (made by build_apkg.py, unchanged)
  out/<id>.json  the status the site reads: {"ok": true, ...} or {"ok": false, "errors": [...]}
Usage: python3 job.py <jobs-branch-checkout> [done-list-file]
Standard library only. Nothing from a job is ever run as code or used as a path.
"""
import json, os, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
BUILDER = os.path.join(HERE, "build_apkg.py")
ID_RE = re.compile(r"^[a-z0-9]{8,40}$")
MAX_CARDS, MAX_TEXT, MAX_INPUT = 400, 20000, 3 * 1024 * 1024   # caps are a safety net only: never below what the site sends (HTML-escaped)
KEEP_DAYS = 14
TYPES = ("Direct", "Analytic", "Hard")
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def text(v, n=MAX_TEXT):
    """Any value → a clean string (the builder expects strings; a number or null must not crash it)."""
    if v is None or isinstance(v, (dict, list)):
        return ""
    if isinstance(v, bool):
        return ""
    return CTRL.sub("", str(v))[:n]


def clean_card(c):
    """Types only: the content stays exactly as Kimi wrote it, so the builder's own checks judge it."""
    if not isinstance(c, dict):
        c = {}
    o = c.get("options") if isinstance(c.get("options"), dict) else {}
    w = c.get("why") if isinstance(c.get("why"), dict) else {}
    a = text(c.get("answer"), 2).strip().upper()
    return {
        "type": text(c.get("type"), 20).strip(),
        "section": text(c.get("section"), 80).strip() or "General",
        "hy": c.get("hy") is True,
        "stem": text(c.get("stem")),
        "image": "", "image_back": "",          # picture cards are off for now: nothing from a job becomes a file path
        "options": {k: text(o.get(k)) for k in "ABCD" if k in o},
        "answer": a,
        "explain": text(c.get("explain")),
        "why": {k: text(w.get(k)) for k in "ABCD" if k in w},
        "warning": text(c.get("warning")),
        "source": text(c.get("source"), 120),
    }


def build(job_id, spec, out_dir):
    """One job → out/<id>.apkg + out/<id>.json. Returns the status dict."""
    st = {"id": job_id, "at": int(time.time()), "ok": False}
    if not isinstance(spec, dict) or not isinstance(spec.get("cards"), list) or not spec["cards"]:
        st["errors"] = ["no cards in the job"]
        return st
    cards = [clean_card(c) for c in spec["cards"][:MAX_CARDS]]
    deck = re.sub(r"\s+", " ", text(spec.get("deck"), 150)).strip().strip(":") or "ANKI"
    st["deck"], st["n"] = deck, len(cards)
    work = tempfile.mkdtemp(prefix="anki-")
    try:
        os.makedirs(os.path.join(work, "media"))
        with open(os.path.join(work, "cards.json"), "w", encoding="utf-8") as f:
            json.dump({"deck": deck, "file": "deck.apkg", "media_dir": "media", "cards": cards}, f, ensure_ascii=False)
        try:
            p = subprocess.run([sys.executable, BUILDER, "cards.json"], cwd=work, capture_output=True,
                               text=True, timeout=120)
            log, rc = (p.stdout + p.stderr).strip(), p.returncode
        except subprocess.TimeoutExpired:
            log, rc = "ERROR: the builder took over 2 minutes", 1
        apkg = os.path.join(work, "deck.apkg")
        if rc == 0 and os.path.isfile(apkg):
            shutil.copyfile(apkg, os.path.join(out_dir, job_id + ".apkg"))
            st.update(ok=True, size=os.path.getsize(apkg), msg=log.splitlines()[-1][:300] if log else "OK")
        else:
            lines = [l[7:] if l.startswith("ERROR: ") else l for l in log.splitlines() if l.strip()]
            # a Python crash prints a traceback: keep its last line, that's the reason
            if any(l.startswith("Traceback") for l in lines):
                lines = ["builder crashed: " + lines[-1]]
            st["errors"] = [l[:300] for l in lines[:60]] or ["the builder stopped without a message"]
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return st


def sweep(out_dir, now):
    """Outputs older than KEEP_DAYS go, so the branch stays small."""
    for name in os.listdir(out_dir):
        m = re.match(r"^([a-z0-9]{8,40})\.json$", name)
        if not m:
            continue
        try:
            with open(os.path.join(out_dir, name), encoding="utf-8") as f:
                at = int(json.load(f).get("at", 0))
        except Exception:
            at = 0
        if now - at > KEEP_DAYS * 86400:
            for ext in (".json", ".apkg"):
                try:
                    os.remove(os.path.join(out_dir, m.group(1) + ext))
                except FileNotFoundError:
                    pass


def main(root, done_file=None):
    in_dir, out_dir = os.path.join(root, "in"), os.path.join(root, "out")
    os.makedirs(in_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    done = 0
    for name in sorted(os.listdir(in_dir)):
        path = os.path.join(in_dir, name)
        m = re.match(r"^([a-z0-9]{8,40})\.json$", name)
        if not m or not os.path.isfile(path) or os.path.islink(path):
            if os.path.isfile(path) and name != ".keep":
                os.remove(path)          # anything else in in/ is junk
            continue
        job_id = m.group(1)
        try:
            if os.path.getsize(path) > MAX_INPUT:
                raise ValueError("the job file is too big")
            with open(path, encoding="utf-8") as f:
                spec = json.load(f)
            st = build(job_id, spec, out_dir)
        except Exception as e:                       # a broken job never stops the others
            st = {"id": job_id, "at": int(time.time()), "ok": False, "errors": ["bad job file: " + str(e)[:200]]}
        with open(os.path.join(out_dir, job_id + ".json"), "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False)
        os.remove(path)
        done += 1
        if done_file:
            with open(done_file, "a", encoding="utf-8") as f:
                f.write(job_id + "\n")
        print(f"{job_id}: {'OK' if st['ok'] else 'FAILED'} {st.get('msg') or '; '.join(st.get('errors', []))[:300]}")
    sweep(out_dir, int(time.time()))
    print(f"{done} job(s)")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or not os.path.isdir(sys.argv[1]):
        print("usage: job.py <jobs-branch-checkout> [file listing the job ids built]")
        sys.exit(2)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
