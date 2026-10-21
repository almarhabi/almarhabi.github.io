#!/usr/bin/env python3
"""Runs on GitHub Actions: turns every waiting ANKI job into an .apkg with build_apkg.py.

The study site (index.html) puts the cards Kimi wrote into the `anki-jobs` branch as in/<id>.json,
then asks GitHub to run this. For each waiting job it writes:
  out/<id>.apkg  the deck (made by build_apkg.py)
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
MAX_REVIEW = 1_500_000
TYPES = ("Direct", "Analytic", "Hard")
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
BUILD_TIMEOUT = 120
BATCH_SECONDS = 230  # leave time for the workflow to publish before its six-minute job timeout


def text(v, n=MAX_TEXT):
    """Any value → a clean string (the builder expects strings; a number or null must not crash it)."""
    if v is None or isinstance(v, (dict, list)):
        return ""
    if isinstance(v, bool):
        return ""
    return CTRL.sub("", str(v))[:n]


def reject_constant(value):
    raise ValueError("non-finite JSON number")


def clean_card(c):
    """Types only: the content stays exactly as Kimi wrote it, so the builder's own checks judge it."""
    if not isinstance(c, dict):
        c = {}
    o = c.get("options") if isinstance(c.get("options"), dict) else {}
    w = c.get("why") if isinstance(c.get("why"), dict) else {}
    a = text(c.get("answer"), 2).strip().upper()
    out = {
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
    if "objectives" in c:
        obj = c.get("objectives")
        out.update(objectives=[text(o, 12) for o in obj] if isinstance(obj, list) else [],
                   objective=text(c.get("objective")), tier=text(c.get("tier"), 2), weak=c.get("weak") is True)
    return out


def build(job_id, spec, out_dir):
    """One job → out/<id>.apkg + out/<id>.json. Returns the status dict."""
    st = {"id": job_id, "at": int(time.time()), "ok": False}
    if not isinstance(job_id, str) or not ID_RE.fullmatch(job_id):
        st["errors"] = ["invalid job id"]
        return st
    if not isinstance(spec, dict) or not isinstance(spec.get("cards"), list) or not spec["cards"]:
        st["errors"] = ["no cards in the job"]
        return st
    if len(spec["cards"]) > MAX_CARDS:
        st["errors"] = [f"too many cards: maximum {MAX_CARDS}"]
        return st
    cap = spec.get("cap", 300)
    if "objectives" in spec and (isinstance(cap, bool) or not isinstance(cap, int) or not 0 <= cap <= 300):
        st["errors"] = ["cap must be an integer from 0 to 300"]
        return st
    cards = [clean_card(c) for c in spec["cards"]]
    deck = re.sub(r"\s+", " ", text(spec.get("deck"), 150)).strip().strip(":") or "ANKI"
    st["deck"], st["n"] = deck, len(cards)
    work = tempfile.mkdtemp(prefix="anki-")
    try:
        os.makedirs(os.path.join(work, "media"))
        with open(os.path.join(work, "cards.json"), "w", encoding="utf-8") as f:
            clean = {"deck": deck, "file": "deck.apkg", "media_dir": "media", "cards": cards}
            if "objectives" in spec:
                clean.update(objectives=[text(o, 12) for o in spec["objectives"]] if isinstance(spec["objectives"], list) else [],
                             lecture=text(spec.get("lecture"), 150), cap=cap)
            json.dump(clean, f, ensure_ascii=False)
        try:
            p = subprocess.run([sys.executable, BUILDER, "cards.json"], cwd=work, capture_output=True,
                               text=True, timeout=BUILD_TIMEOUT)
            log, rc = (p.stdout + p.stderr).strip(), p.returncode
        except subprocess.TimeoutExpired:
            log, rc = "ERROR: the builder took over 2 minutes", 1
        apkg = os.path.join(work, "deck.apkg")
        if rc == 0 and os.path.isfile(apkg):
            atomic_copy(apkg, os.path.join(out_dir, job_id + ".apkg"))
            st.update(ok=True, size=os.path.getsize(apkg), msg=log.splitlines()[-1][:300] if log else "OK")
            # the site's review of the deck (facts, cards, checks) rides along, so any device can show it; data only, never run
            rv = spec.get("review")
            if isinstance(rv, dict):
                try:
                    size = len(json.dumps(rv, ensure_ascii=False, allow_nan=False).encode("utf-8"))
                except (TypeError, ValueError):
                    size = MAX_REVIEW + 1
                if size <= MAX_REVIEW:
                    st["review"] = rv
        else:
            lines = [l[7:] if l.startswith("ERROR: ") else l for l in log.splitlines() if l.strip()]
            # a Python crash prints a traceback: keep its last line, that's the reason
            if any(l.startswith("Traceback") for l in lines):
                lines = ["builder crashed: " + lines[-1]]
            st["errors"] = [l[:300] for l in lines[:60]] or ["the builder stopped without a message"]
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return st


def atomic_copy(source, destination):
    """Readers see either the old complete artifact or the new one, never a partial file."""
    fd, tmp = tempfile.mkstemp(prefix=".anki-", dir=os.path.dirname(destination))
    try:
        with os.fdopen(fd, "wb") as out, open(source, "rb") as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, destination)  # replaces a malicious destination symlink instead of following it
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def atomic_json(destination, value):
    fd, tmp = tempfile.mkstemp(prefix=".anki-", dir=os.path.dirname(destination))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=False, allow_nan=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, destination)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def ensure_directory(directory):
    if os.path.islink(directory):
        raise ValueError("job directories must not be symbolic links")
    os.makedirs(directory, exist_ok=True)
    if not os.path.isdir(directory):
        raise ValueError("job path must be a directory")


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


def main(root, done_file=None, max_seconds=BATCH_SECONDS):
    in_dir, out_dir = os.path.join(root, "in"), os.path.join(root, "out")
    ensure_directory(in_dir)
    ensure_directory(out_dir)
    done = 0
    started = time.monotonic()
    for name in sorted(os.listdir(in_dir)):
        # Reserve the full next build timeout. Never begin work that could consume the save-step budget.
        if time.monotonic() - started + BUILD_TIMEOUT > max_seconds:
            print("batch time limit: pending jobs remain for the next run")
            break
        path = os.path.join(in_dir, name)
        m = re.match(r"^([a-z0-9]{8,40})\.json$", name)
        if not m or not os.path.isfile(path) or os.path.islink(path):
            if os.path.isfile(path) and name != ".keep":
                os.remove(path)          # anything else in in/ is junk
            continue
        job_id = m.group(1)
        try:
            # Bound the bytes actually read, not only a racy stat made before opening the input.
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as f:
                raw = f.read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                raise ValueError("the job file is too big")
            spec = json.loads(raw, parse_constant=reject_constant)
            st = build(job_id, spec, out_dir)
        except Exception as e:                       # a broken job never stops the others
            st = {"id": job_id, "at": int(time.time()), "ok": False, "errors": ["bad job file: " + str(e)[:200]]}
        atomic_json(os.path.join(out_dir, job_id + ".json"), st)
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
    try:
        main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
    except (OSError, ValueError) as error:
        print("ERROR: queue not fully processed; pending jobs remain (" + type(error).__name__ + ")")
        sys.exit(1)
