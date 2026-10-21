#!/usr/bin/env python3
"""Build an Anki .apkg of 4-option MCQ cards from cards.json (step 9 of PROMPT.md). Standard library only.
Usage: python3 build_apkg.py cards.json
cards.json = {"deck": "Course::Lecture", "file": "Lecture.apkg", "lecture": "Lecture",
  "objectives": [{"id": "O1", "t": "objective text", "inf": false}],
  "cards": [{"type": "Mechanism|Clinical|Discrimination|Definition", "tier": "T1|T2",
             "section": "...", "stem": "...", "options": {"A": "", "B": "", "C": "", "D": ""},
             "answer": "A", "explain": "...", "why": {"B": "", "C": "", "D": ""},
             "warning": "", "obj": ["O1"], "source": "Slide 12"}]}
Note model "MCQ 4-Option": Question, OptionA, OptionB, OptionC, OptionD, Correct, Review, Objective, Source.
"""
import hashlib, json, os, re, sqlite3, sys, tempfile, time, zipfile

MODEL_ID = 1761000000003          # fixed: one shared note type across all decks
MODEL_NAME = "MCQ 4-Option"
FIELDS = ["Question", "OptionA", "OptionB", "OptionC", "OptionD", "Correct", "Review", "Objective", "Source"]
TYPES = ("Mechanism", "Clinical", "Discrimination", "Definition")
TIERS = ("T1", "T2")

FRONT = r"""<div class="mcq">
<div class="q">{{Question}}</div>
<div class="opts">
<div class="opt oA"><b>A)</b> {{OptionA}}</div>
<div class="opt oB"><b>B)</b> {{OptionB}}</div>
<div class="opt oC"><b>C)</b> {{OptionC}}</div>
<div class="opt oD"><b>D)</b> {{OptionD}}</div>
</div>
</div>"""

BACK = r"""<div class="back" data-c="{{Correct}}">
{{FrontSide}}
<hr id="answer">
<div class="rv">{{Review}}</div>
{{#Objective}}<div class="obj">🎯 Objective: {{Objective}}</div>{{/Objective}}
<div class="src">Source: {{Source}}</div>
</div>"""

CSS = """.card{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:18px;line-height:1.45;
 color:#1f2328;background:#fff;text-align:left;padding:4px}
.mcq,.rv,.obj,.src{max-width:720px;margin-left:auto;margin-right:auto}
.q{font-weight:600;margin-bottom:10px}
.opt{border:1px solid #d0d7de;border-radius:10px;padding:9px 12px;margin:7px 0}
.back[data-c="A"] .oA,.back[data-c="B"] .oB,.back[data-c="C"] .oC,.back[data-c="D"] .oD{border-color:#1a7f37;background:#dafbe1}
hr#answer{border:0;border-top:1px solid #d0d7de;margin:14px auto;max-width:720px}
.rv .ok,.rv .bad,.rv .warn{border-radius:10px;padding:9px 12px;margin:7px 0}
.rv .ok{background:#dafbe1;border-left:5px solid #1a7f37;color:#0f3d1f}
.rv .bad{background:#ffebe9;border-left:5px solid #cf222e;color:#5c0f14;font-size:15px}
.rv .warn{background:#fff8c5;border-left:5px solid #bf8700;color:#3b2e00;font-size:15px}
.rv .hd{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6e7781;margin:12px 0 2px}
.rv .ex{font-size:15px;margin-top:3px}
.obj{margin-top:10px;background:#ddf4ff;border-left:5px solid #0969da;color:#0a3069;padding:8px 12px;border-radius:10px;font-size:15px}
.src{margin-top:8px;font-size:13px;color:#6e7781}
.nightMode .card,.night_mode .card,.card.nightMode{color:#e6edf3;background:#0d1117}
.nightMode .opt,.night_mode .opt{border-color:#30363d}
.nightMode .back[data-c="A"] .oA,.nightMode .back[data-c="B"] .oB,.nightMode .back[data-c="C"] .oC,.nightMode .back[data-c="D"] .oD,
.night_mode .back[data-c="A"] .oA,.night_mode .back[data-c="B"] .oB,.night_mode .back[data-c="C"] .oC,.night_mode .back[data-c="D"] .oD,
.nightMode .rv .ok,.night_mode .rv .ok{background:#12361f;color:#aff5b4;border-color:#2ea043}
.nightMode .rv .bad,.night_mode .rv .bad{background:#3d1214;color:#ffdcd7}
.nightMode .rv .warn,.night_mode .rv .warn{background:#3b2e00;color:#f8e3a1}
.nightMode .obj,.night_mode .obj{background:#0c2d6b;color:#cae8ff}
"""


def die(msg):
    print("ERROR:", msg); sys.exit(1)


def h(s, n=8):
    return int(hashlib.sha1(s.encode()).hexdigest()[:n], 16)


def strip(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def tag(s):
    return re.sub(r"[^\w-]+", "_", strip(s)).strip("_") or "General"


def validate(cards, objectives):
    """Errors stop the build; warnings are printed (an objective nobody answers is reported, the deck still builds)."""
    errs, warns, keys = [], [], []
    if not cards:
        errs.append("no cards")
    for i, c in enumerate(cards, 1):
        o = c.get("options", {})
        if sorted(o) != list("ABCD") or any(not strip(o[k]) for k in "ABCD"):
            errs.append(f"card {i}: needs 4 non-empty options A-D"); continue
        a = c.get("answer")
        if a not in ("A", "B", "C", "D"):
            errs.append(f"card {i}: Correct must be one of A-D"); continue
        keys.append(a)
        if not strip(c.get("stem")):
            errs.append(f"card {i}: empty question")
        for k in "ABCD":
            if k != a and not strip(c.get("why", {}).get(k)):
                errs.append(f"card {i}: missing why-not for {k}")
        lens = [len(strip(o[k])) for k in "ABCD"]
        if lens["ABCD".index(a)] == max(lens) and max(lens) > 1.5 * sorted(lens)[-2]:
            errs.append(f"card {i}: the correct answer is clearly the longest option")
        if c.get("type") not in TYPES:
            errs.append(f"card {i}: type must be one of {'/'.join(TYPES)}")
        if c.get("tier") not in TIERS:
            errs.append(f"card {i}: tier must be T1 or T2")
        if not strip(c.get("explain")) or not strip(c.get("source")):
            errs.append(f"card {i}: explanation and source required")
    stems = [strip(c.get("stem")).lower() for c in cards]
    if len(set(stems)) != len(stems):
        errs.append("duplicate questions")
    run = 1
    for x, y in zip(keys, keys[1:]):
        run = run + 1 if x == y else 1
        if run > 2:
            errs.append("same correct letter > 2 times in a row"); break
    answered = {x for c in cards for x in (c.get("obj") or [])}
    miss = [ob["id"] for ob in objectives if ob["id"] not in answered]
    if miss:
        warns.append("objectives not the correct answer of any card: " + ", ".join(miss))
    return errs, warns, {k: keys.count(k) for k in "ABCD"}


def review_html(c):
    a, o, w = c["answer"], c["options"], c.get("why", {})
    out = [f'<div class="ok"><b>Correct: {a}) {o[a]}</b><div class="ex">{c["explain"]}</div></div>',
           '<div class="hd">Why not the others</div>']
    for k in "ABCD":
        if k != a:
            out.append(f'<div class="bad"><b>{k}) {o[k]}</b> — {w.get(k, "")}</div>')
    if strip(c.get("warning")):
        out.append(f'<div class="warn">⚠️ {c["warning"]}</div>')
    return "".join(out)


def main(path):
    spec = json.load(open(path, encoding="utf-8"))
    deck, cards = spec["deck"], spec["cards"]
    lec = tag(spec.get("lecture") or deck.split("::")[-1])
    objectives = [x for x in spec.get("objectives", []) if isinstance(x, dict) and re.match(r"^O\d{1,2}$", str(x.get("id", "")))]
    otext = {x["id"]: strip(x.get("t")) for x in objectives}
    errs, warns, dist = validate(cards, objectives)
    if errs:
        die("\n".join(errs))
    now, ms = int(time.time()), int(time.time() * 1000)
    did = h("deck:" + deck, 12)
    tmpl = {"name": "MCQ", "ord": 0, "qfmt": FRONT, "afmt": BACK, "did": None, "bqfmt": "", "bafmt": ""}
    model = {"id": MODEL_ID, "name": MODEL_NAME, "type": 0, "mod": now, "usn": -1,
             "sortf": 0, "did": did, "tmpls": [tmpl],
             "flds": [{"name": f, "ord": i, "sticky": False, "rtl": False,
                       "font": "Arial", "size": 20, "media": []} for i, f in enumerate(FIELDS)],
             "css": CSS, "latexPre": "\\documentclass[12pt]{article}\n\\begin{document}\n",
             "latexPost": "\\end{document}", "tags": [], "vers": [], "req": [[0, "any", [0]]]}
    dconf = {"1": {"id": 1, "name": "Default", "mod": 0, "usn": 0, "maxTaken": 60,
             "autoplay": True, "timer": 0, "replayq": True, "dyn": False,
             "new": {"bury": True, "delays": [1, 10], "initialFactor": 2500,
                     "ints": [1, 4, 7], "order": 1, "perDay": 20, "separate": True},
             "lapse": {"delays": [10], "leechAction": 0, "leechFails": 8,
                       "minInt": 1, "mult": 0},
             "rev": {"bury": True, "ease4": 1.3, "fuzz": 0.05, "ivlFct": 1,
                     "maxIvl": 36500, "minSpace": 1, "perDay": 200}}}

    def deckobj(i, name):
        return {"id": i, "name": name, "mod": now, "usn": -1, "collapsed": False,
                "browserCollapsed": False, "conf": 1, "desc": "", "dyn": 0,
                "extendNew": 0, "extendRev": 50, "lrnToday": [0, 0],
                "newToday": [0, 0], "revToday": [0, 0], "timeToday": [0, 0]}
    decks = {"1": deckobj(1, "Default"), str(did): deckobj(did, deck)}
    conf = {"activeDecks": [1], "curDeck": 1, "newSpread": 0, "collapseTime": 1200,
            "timeLim": 0, "estTimes": True, "dueCounts": True, "curModel": str(MODEL_ID),
            "nextPos": len(cards) + 1, "sortType": "noteFld", "sortBackwards": False,
            "addToCur": True}

    tmpdir = tempfile.mkdtemp()
    db = os.path.join(tmpdir, "collection.anki2")
    con = sqlite3.connect(db)
    con.executescript("""
    CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
      scm integer not null, ver integer not null, dty integer not null, usn integer not null,
      ls integer not null, conf text not null, models text not null, decks text not null,
      dconf text not null, tags text not null);
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null,
      mod integer not null, usn integer not null, tags text not null, flds text not null,
      sfld integer not null, csum integer not null, flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null,
      ord integer not null, mod integer not null, usn integer not null, type integer not null,
      queue integer not null, due integer not null, ivl integer not null, factor integer not null,
      reps integer not null, lapses integer not null, left integer not null, odue integer not null,
      odid integer not null, flags integer not null, data text not null);
    CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null,
      ease integer not null, ivl integer not null, lastIvl integer not null,
      factor integer not null, time integer not null, type integer not null);
    CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
    CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn); CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_revlog_cid on revlog (cid); CREATE INDEX ix_notes_csum on notes (csum);
    """)
    con.execute("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)",
                (now // 86400 * 86400, ms, ms, json.dumps(conf),
                 json.dumps({str(MODEL_ID): model}), json.dumps(decks),
                 json.dumps(dconf), "{}"))
    for i, c in enumerate(cards):
        o, ob = c["options"], [x for x in (c.get("obj") or []) if x in otext]
        objective = "<br>".join(f"{x} — {otext[x]}" for x in ob)
        vals = [c["stem"], o["A"], o["B"], o["C"], o["D"], c["answer"], review_html(c), objective, c["source"]]
        tags = {f"{lec}::{tag(c.get('section', 'General'))}", c["tier"], c["type"]}
        tags.update(f"{lec}::Obj::{x}" for x in ob)
        if strip(c.get("warning")):
            tags.add("SlideError")
        guid = hashlib.sha1((deck + "|" + strip(c["stem"])).encode()).hexdigest()[:16]
        nid = cid = ms + i
        sfld = strip(c["stem"])
        con.execute("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (nid, guid, MODEL_ID, now, -1, " " + " ".join(sorted(tags)) + " ",
                     "\x1f".join(vals), sfld, h(sfld), 0, ""))
        con.execute("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (cid, nid, did, 0, now, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ""))
    con.commit(); con.close()
    out = spec.get("file") or (deck.split("::")[-1] + ".apkg")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(db, "collection.anki2")
        z.writestr("media", "{}")
    for w in warns:
        print("WARN", w)
    types = {t: sum(c["type"] == t for c in cards) for t in TYPES}
    cov = sum(1 for ob in objectives if any(ob["id"] in (c.get("obj") or []) for c in cards))
    print(f"OK {out}: {len(cards)} cards | {types} | A={dist['A']} B={dist['B']} C={dist['C']} D={dist['D']} | objectives {cov}/{len(objectives)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cards.json")
