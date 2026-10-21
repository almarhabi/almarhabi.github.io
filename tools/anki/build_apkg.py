#!/usr/bin/env python3
"""Build an Anki .apkg of shuffled MCQ cards from cards.json. Standard library only.
Usage: python3 build_apkg.py cards.json
cards.json = {"deck": "Course::Lecture", "file": "Lecture.apkg", "media_dir": "media",
  "cards": [{"type": "Direct|Analytic|Hard", "section": "...", "hy": true,
             "stem": "...", "image": "", "image_back": "",
             "options": {"A": "", "B": "", "C": "", "D": ""}, "answer": "A",
             "explain": "...", "why": {"B": "", "C": "", "D": ""},
             "warning": "", "source": "Slide 12"}]}
"""
import hashlib, html, json, os, re, shutil, sqlite3, sys, tempfile, time, zipfile
from html.parser import HTMLParser

MAX_INPUT = 3 * 1024 * 1024
MAX_CARDS = 400
MAX_TEXT = 20000
CARD_TYPES = ("Direct", "Analytic", "Hard", "Mechanism", "Clinical", "Discrimination", "Definition")


def reject_constant(value):
    raise ValueError("non-finite JSON number")


class _CardHTML(HTMLParser):
    """Keep the site's formatting without allowing executable Anki WebView content."""
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts = []
        self.bold_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("b", "br"):
            self.parts.append("<" + tag + ">")
            if tag == "b":
                self.bold_depth += 1
        else:
            self.parts.append(html.escape(self.get_starttag_text(), quote=False))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag == "b":
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "b":
            if self.bold_depth:
                self.parts.append("</b>")
                self.bold_depth -= 1
        elif tag != "br":
            self.parts.append(html.escape("</" + tag + ">", quote=False))

    def handle_data(self, data):
        self.parts.append(html.escape(data, quote=False))

    def handle_entityref(self, name):
        self.parts.append("&" + name + ";")

    def handle_charref(self, name):
        self.parts.append("&#" + name + ";")


def safe_html(value):
    parser = _CardHTML()
    parser.feed(value)
    parser.close()
    return "".join(parser.parts) + "</b>" * parser.bold_depth


def media_path(media_dir, name):
    """Only ordinary files inside the media directory may enter an archive."""
    if not isinstance(name, str) or not name or os.path.basename(name) != name or "\\" in name:
        return None
    base = os.path.realpath(media_dir)
    candidate = os.path.realpath(os.path.join(base, name))
    if os.path.dirname(candidate) != base or not os.path.isfile(candidate):
        return None
    return candidate

MODEL_ID = 1730000000001          # fixed: one shared note type across all decks
MODEL_NAME = "MCQ Shuffle v1"
FIELDS = ["Stem", "Image", "ImageBack", "A", "B", "C", "D", "Answer", "Explain",
          "WhyA", "WhyB", "WhyC", "WhyD", "Warning", "Source", "Type"]

FRONT = r"""<div class="mcq">
<div class="meta">{{Type}}</div>
<div class="stem">{{Stem}}</div>
{{#Image}}<div class="img">{{Image}}</div>{{/Image}}
<div id="raw" class="opts">
<div class="opt" data-l="A"><b>A.</b> <span>{{A}}</span></div>
<div class="opt" data-l="B"><b>B.</b> <span>{{B}}</span></div>
<div class="opt" data-l="C"><b>C.</b> <span>{{C}}</span></div>
<div class="opt" data-l="D"><b>D.</b> <span>{{D}}</span></div>
</div>
<div id="opts" class="opts"></div>
</div>
<script>
(function(){
  var raw=document.getElementById('raw'), box=document.getElementById('opts');
  if(!raw||!box) return;
  var back=!!document.getElementById('mcq-back');
  var t=document.querySelector('.stem').textContent, key='k'+t.length+':'+t.slice(0,120);
  function load(){var s=window.__mcq; if(s&&s.key===key) return s;
    try{s=JSON.parse(sessionStorage.getItem('mcq')||'null'); if(s&&s.key===key) return s;}catch(e){} return null;}
  var st=back?load():null, perm=st?st.perm:['A','B','C','D'], pick=st?st.pick:null;
  if(!back){for(var i=3;i>0;i--){var j=Math.floor(Math.random()*(i+1)),x=perm[i];perm[i]=perm[j];perm[j]=x;}}
  function save(){var s={key:key,perm:perm,pick:pick}; window.__mcq=s;
    try{sessionStorage.setItem('mcq',JSON.stringify(s));}catch(e){}}
  if(!back) save();
  perm.forEach(function(o,i){
    var d=document.createElement('div'); d.className='opt'; d.setAttribute('data-o',o);
    d.innerHTML='<b>'+'ABCD'[i]+'.</b> '+raw.querySelector('[data-l="'+o+'"] span').innerHTML;
    if(!back){d.onclick=function(){pick=o; save();
      var a=box.children; for(var k=0;k<a.length;k++) a[k].classList.remove('picked');
      d.classList.add('picked');};}
    box.appendChild(d);});
  raw.style.display='none';
  window.__mcqView={perm:perm,pick:pick};
})();
</script>"""

BACK = r"""<div id="mcq-back"></div>
{{FrontSide}}
<hr id="answer">
{{#ImageBack}}<div class="img">{{ImageBack}}</div>{{/ImageBack}}
<div id="fb" class="fb"></div>
<div id="fbraw" class="fb">
<div class="ok"><b>Answer: {{Answer}}</b> — {{Explain}}</div>
<div class="why" data-l="A">A: {{WhyA}}</div><div class="why" data-l="B">B: {{WhyB}}</div>
<div class="why" data-l="C">C: {{WhyC}}</div><div class="why" data-l="D">D: {{WhyD}}</div>
</div>
<span id="ans" style="display:none">{{Answer}}</span>
<div id="xp" style="display:none">{{Explain}}</div>
<div id="wA" style="display:none">{{WhyA}}</div><div id="wB" style="display:none">{{WhyB}}</div>
<div id="wC" style="display:none">{{WhyC}}</div><div id="wD" style="display:none">{{WhyD}}</div>
{{#Warning}}<div class="warn">⚠️ Slide error: {{Warning}}</div>{{/Warning}}
<div class="src">{{Source}}</div>
<script>
(function(){
  var v=window.__mcqView, fb=document.getElementById('fb'); if(!v||!fb) return;
  var ans=document.getElementById('ans').textContent.trim(), h='';
  function g(id){var e=document.getElementById(id); return e?e.innerHTML:'';}
  v.perm.forEach(function(o,i){
    var txt=document.querySelector('#opts [data-o="'+o+'"]');
    txt=txt?txt.innerHTML.replace(/^<b>[A-D]\.<\/b>\s*/,''):'';
    var ok=(o===ans), me=(v.pick===o)?' <i>(your choice)</i>':'';
    h+='<div class="'+(ok?'ok':'bad')+'"><b>'+(ok?'✓ ':'✗ ')+'ABCD'[i]+'. '+txt+'</b>'+me+
       '<div class="note">'+(ok?g('xp'):g('w'+o))+'</div></div>';
    var el=document.querySelector('#opts [data-o="'+o+'"]');
    if(el) el.classList.add(ok?'is-ok':'is-bad');});
  fb.innerHTML=h; document.getElementById('fbraw').style.display='none';
})();
</script>"""

CSS = """.card{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:18px;line-height:1.45;
 color:#1f2328;background:#fff;text-align:left;padding:4px}
.mcq{max-width:720px;margin:0 auto}
.meta{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6e7781;margin-bottom:6px}
.stem{font-weight:600;margin-bottom:10px}
.img{text-align:center;margin:8px 0}.img img{max-width:100%;height:auto;border-radius:8px}
.opts .opt{border:1px solid #d0d7de;border-radius:10px;padding:9px 12px;margin:7px 0;cursor:pointer}
.opts .opt.picked{border-color:#0969da;box-shadow:0 0 0 2px #0969da33}
.opts .opt.is-ok{border-color:#1a7f37;background:#dafbe1}
.opts .opt.is-bad{opacity:.75}
.fb{max-width:720px;margin:10px auto}
.fb .ok,.fb .bad{border-radius:10px;padding:9px 12px;margin:7px 0}
.fb .ok{background:#dafbe1;border-left:5px solid #1a7f37;color:#0f3d1f}
.fb .bad{background:#ffebe9;border-left:5px solid #cf222e;color:#5c0f14}
.fb .note{font-size:15px;margin-top:3px}
.warn{max-width:720px;margin:8px auto;background:#fff8c5;border-left:5px solid #bf8700;padding:8px 12px;border-radius:10px;font-size:15px}
.src{max-width:720px;margin:8px auto;font-size:13px;color:#6e7781}
hr#answer{border:0;border-top:1px solid #d0d7de;margin:14px 0}
.nightMode .card,.night_mode .card,.card.nightMode{color:#e6edf3;background:#0d1117}
.nightMode .opts .opt,.night_mode .opts .opt{border-color:#30363d}
.nightMode .opts .opt.is-ok,.night_mode .opts .opt.is-ok,.nightMode .fb .ok,.night_mode .fb .ok{background:#12361f;color:#aff5b4}
.nightMode .fb .bad,.night_mode .fb .bad{background:#3d1214;color:#ffdcd7}
.nightMode .warn,.night_mode .warn{background:#3b2e00;color:#f8e3a1}
"""

# A separate fixed model ID preserves compatibility with decks imported using the legacy shuffle model.
OBJECTIVE_MODEL_ID = 1643291756
OBJECTIVE_FIELDS = ["Question", "OptionA", "OptionB", "OptionC", "OptionD", "Correct", "Review", "Objective", "Source"]
OBJECTIVE_FRONT = """<div class="mcq"><div class="stem">{{Question}}</div><div class="opts">
<div class="opt">A) {{OptionA}}</div><div class="opt">B) {{OptionB}}</div>
<div class="opt">C) {{OptionC}}</div><div class="opt">D) {{OptionD}}</div></div></div>"""
OBJECTIVE_BACK = """{{FrontSide}}<hr id="answer"><div class="fb">{{Review}}</div>
{{#Objective}}<div class="objective">Objective: {{Objective}}</div>{{/Objective}}
<div class="src">Source: {{Source}}</div>"""
OBJECTIVE_CSS = CSS + """.objective{max-width:720px;margin:8px auto;color:#0969da;font-size:15px}
.nightMode .objective,.night_mode .objective{color:#79c0ff}
.card.nightMode .fb .ok,.card.night_mode .fb .ok{background:#12361f;color:#aff5b4}
.card.nightMode .fb .bad,.card.night_mode .fb .bad{background:#3d1214;color:#ffdcd7}
.card.nightMode .warn,.card.night_mode .warn{background:#3b2e00;color:#f8e3a1}
.card.nightMode .objective,.card.night_mode .objective{color:#79c0ff}
"""


def validate_objectives(cards, objectives, cap):
    """Coverage refers only to objectives tested by correct answers, as checked by the site."""
    errs, covered = [], set()
    if not isinstance(objectives, list) or not objectives or any(not isinstance(o, str) or not re.fullmatch(r"O[0-9]{1,3}", o) for o in objectives):
        return ["invalid objectives map"]
    if isinstance(cap, bool) or not isinstance(cap, int) or not 0 <= cap <= 300:
        return ["cap must be an integer from 0 to 300"]
    if not isinstance(cards, list) or any(not isinstance(c, dict) for c in cards):
        return ["cards must be a non-empty list of objects"]
    required = set(objectives)
    main = [c for c in cards if c.get("weak") is not True]
    if len(main) > cap:
        errs.append("main card count exceeds the cap")
    linked = 0
    for i, c in enumerate(cards, 1):
        obj = c.get("objectives")
        if not isinstance(obj, list) or any(not isinstance(o, str) or o not in required for o in obj):
            errs.append(f"card {i}: invalid correct-answer objectives")
            continue
        if obj and not strip(c.get("objective")):
            errs.append(f"card {i}: objective text required")
        covered.update(obj)
        if c.get("weak") is not True and obj:
            linked += 1
        if c.get("tier") not in ("T1", "T2"):
            errs.append(f"card {i}: tier must be T1/T2")
        if c.get("type") not in ("Mechanism", "Clinical", "Discrimination", "Definition"):
            errs.append(f"card {i}: objective question type required")
        o = c.get("options") if isinstance(c.get("options"), dict) else {}
        a = c.get("answer", "")
        if isinstance(a, str) and a in o and len(strip(o[a])) > max((len(strip(o.get(k, ""))) for k in "ABCD" if k != a), default=0):
            errs.append(f"card {i}: key is the longest option")
    if covered != required:
        errs.append("uncovered correct-answer objectives: " + ", ".join(sorted(required - covered)))
    if main and linked < .8 * len(main):
        errs.append("less than 80% of main cards test objectives")
    dist = [sum(c.get("answer") == k for c in cards) for k in "ABCD"]
    if max(dist, default=0) - min(dist, default=0) > 1:
        errs.append("answer letters must be balanced within one")
    return errs


def objective_review(c):
    a, o, why = c["answer"], c["options"], c.get("why", {})
    parts = [f'<div class="ok"><b>Correct: {a}) {o[a]}</b><div class="note">{c["explain"]}</div></div>',
             '<p><b>Why not the others:</b></p>']
    parts += [f'<div class="bad"><b>{k}) {o[k]}</b><div class="note">{why.get(k, "")}</div></div>' for k in "ABCD" if k != a]
    if c.get("warning"):
        parts.append(f'<div class="warn">⚠️ Slide error: {c["warning"]}</div>')
    return "".join(parts)

def die(msg):
    print("ERROR:", msg); sys.exit(1)

def h(s, n=8):
    return int(hashlib.sha1(s.encode()).hexdigest()[:n], 16)

def strip(s):
    return re.sub(r"<[^>]+>", "", s if isinstance(s, str) else "").strip()


def validate(cards, media_dir):
    errs, keys, stems = [], [], []
    if not isinstance(cards, list) or not cards or len(cards) > MAX_CARDS:
        return [f"cards must contain 1 to {MAX_CARDS} cards"], {k: 0 for k in "ABCD"}
    for i, c in enumerate(cards, 1):
        if not isinstance(c, dict):
            errs.append(f"card {i}: must be an object")
            continue
        fields = [c.get(f, "") for f in ("stem", "explain", "source", "warning", "objective", "section", "type")]
        if any(not isinstance(v, str) or len(v) > MAX_TEXT or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", v) for v in fields):
            errs.append(f"card {i}: text fields must be strings without control characters, at most {MAX_TEXT} characters")
        stem = strip(c.get("stem"))
        if not stem:
            errs.append(f"card {i}: stem required")
        stems.append(stem.lower())
        o = c.get("options", {})
        if not isinstance(o, dict) or set(o) != set("ABCD") or any(not isinstance(o[k], str) or not strip(o[k]) for k in "ABCD"):
            errs.append(f"card {i}: needs 4 non-empty options A-D")
            continue
        option_texts = [re.sub(r"\s+", " ", html.unescape(strip(o[k]))).casefold() for k in "ABCD"]
        if len(set(option_texts)) != 4:
            errs.append(f"card {i}: options must be distinct")
        a = c.get("answer")
        if not isinstance(a, str) or len(a) != 1 or a not in "ABCD":
            errs.append(f"card {i}: answer must be A-D")
            continue
        keys.append(a)
        why = c.get("why") if isinstance(c.get("why"), dict) else {}
        for k in "ABCD":
            if k != a and not strip(why.get(k)):
                errs.append(f"card {i}: missing why[{k}]")
            for v in (o[k], why.get(k, "")):
                if not isinstance(v, str) or len(v) > MAX_TEXT or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", v):
                    errs.append(f"card {i}: invalid option/explanation text")
                    break
            if "objectives" not in c and len(strip(o[k]).split()) > 15:
                errs.append(f"card {i}: option {k} > 15 words")
        lens = [len(strip(o[k])) for k in "ABCD"]
        if lens["ABCD".index(a)] == max(lens) and max(lens) > 1.5 * sorted(lens)[-2]:
            errs.append(f"card {i}: key is clearly the longest option")
        if c.get("type") not in CARD_TYPES:
            errs.append(f"card {i}: unrecognized question type")
        for f in ("image", "image_back"):
            if c.get(f) and media_path(media_dir, c[f]) is None:
                errs.append(f"card {i}: missing or unsafe media")
        if not strip(c.get("explain")) or not strip(c.get("source")):
            errs.append(f"card {i}: explain and source required")
    if len(set(stems)) != len(stems):
        errs.append("duplicate stems")
    run = 1
    for x, y in zip(keys, keys[1:]):
        run = run + 1 if x == y else 1
        if run > 2:
            errs.append("same key letter > 2 times in a row")
            break
    return errs, {k: keys.count(k) for k in "ABCD"}

def main(path):
    with open(path, "rb") as f:
        raw = f.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        die("the job file is too big")
    try:
        spec = json.loads(raw, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        die("invalid JSON input")
    if not isinstance(spec, dict) or not isinstance(spec.get("deck"), str) or not spec["deck"].strip() or not isinstance(spec.get("cards"), list):
        die("deck and cards required")
    deck, cards = spec["deck"], spec["cards"]
    if not isinstance(spec.get("media_dir", "media"), str):
        die("invalid media directory")
    if spec.get("lecture") is not None and not isinstance(spec["lecture"], str):
        die("invalid lecture title")
    if spec.get("file") is not None and not isinstance(spec["file"], str):
        die("invalid output filename")
    media_dir = spec.get("media_dir", "media")
    errs, dist = validate(cards, media_dir)
    objective_mode = "objectives" in spec
    if objective_mode:
        errs += validate_objectives(cards, spec["objectives"], spec.get("cap", 300))
    model_id = OBJECTIVE_MODEL_ID if objective_mode else MODEL_ID
    fields = OBJECTIVE_FIELDS if objective_mode else FIELDS
    if errs:
        die("\n".join(errs))
    # Never store untrusted executable HTML in a note WebView. The site's bold and breaks remain intact.
    for c in cards:
        for field in ("stem", "explain", "source", "warning", "objective"):
            if field in c:
                c[field] = safe_html(c[field])
        for group in ("options", "why"):
            c[group] = {k: safe_html(v) for k, v in c.get(group, {}).items() if k in "ABCD"}
    now, ms = int(time.time()), int(time.time() * 1000)
    did = h("deck:" + deck, 12)
    tmpl = {"name": "MCQ", "ord": 0, "qfmt": OBJECTIVE_FRONT if objective_mode else FRONT, "afmt": OBJECTIVE_BACK if objective_mode else BACK, "did": None,
            "bqfmt": "", "bafmt": ""}
    model = {"id": model_id, "name": "MCQ 4-Option" if objective_mode else MODEL_NAME, "type": 0, "mod": now, "usn": -1,
             "sortf": 0, "did": did, "tmpls": [tmpl],
             "flds": [{"name": f, "ord": i, "sticky": False, "rtl": False,
                       "font": "Arial", "size": 20, "media": []} for i, f in enumerate(fields)],
             "css": OBJECTIVE_CSS if objective_mode else CSS, "latexPre": "\\documentclass[12pt]{article}\n\\begin{document}\n",
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
            "timeLim": 0, "estTimes": True, "dueCounts": True, "curModel": str(model_id),
            "nextPos": len(cards) + 1, "sortType": "noteFld", "sortBackwards": False,
            "addToCur": True}

    tmpdir = tempfile.mkdtemp(prefix="anki-collection-")
    con, archive_tmp = None, None
    try:
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
                     json.dumps({str(model_id): model}), json.dumps(decks),
                     json.dumps(dconf), "{}"))
        media = []
        def img(f):
            if not f: return ""
            if f not in media: media.append(f)
            return f'<img src="{html.escape(f, quote=True)}">'
        for i, c in enumerate(cards):
            o, w = c["options"], c.get("why", {})
            vals = [c["stem"], img(c.get("image")), img(c.get("image_back")),
                    o["A"], o["B"], o["C"], o["D"], c["answer"], c["explain"],
                    w.get("A", ""), w.get("B", ""), w.get("C", ""), w.get("D", ""),
                    c.get("warning", ""), c["source"], c["type"]]
            if objective_mode:
                vals = [c["stem"], o["A"], o["B"], o["C"], o["D"], c["answer"], objective_review(c), c.get("objective", ""), c["source"]]
            tags = {re.sub(r"\s+", "_", c.get("section", "General")), c["type"]}
            if objective_mode:
                lecture = re.sub(r"\s+", "_", spec.get("lecture") or deck.split("::")[-1])
                section = re.sub(r"\s+", "_", c.get("section", "General"))
                tags = {lecture + "::" + section, c["tier"], c["type"]}
                tags.update(lecture + "::Obj::" + o for o in c["objectives"])
                if c.get("weak"): tags.add("WeakSpot")
            if c.get("hy"): tags.add("HY")
            if c.get("image"): tags.add("Image")
            if c.get("warning"): tags.add("SlideError")
            guid = hashlib.sha1((deck + "|" + strip(c["stem"])).encode()).hexdigest()[:16]
            nid, cid = ms + i, ms + i
            sfld = strip(c["stem"])
            con.execute("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (nid, guid, model_id, now, -1, " " + " ".join(sorted(tags)) + " ",
                         "\x1f".join(vals), sfld, h(sfld), 0, ""))
            con.execute("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (cid, nid, did, 0, now, -1, 0, 0, i + 1, 0, 0, 0, 0, 0, 0, 0, 0, ""))
        if con.execute("SELECT count(*) FROM notes").fetchone()[0] != len(cards) or con.execute("SELECT count(*) FROM cards").fetchone()[0] != len(cards):
            die("note/card count mismatch")
        con.commit(); con.close(); con = None
        out = spec.get("file") or (deck.split("::")[-1] + ".apkg")
        fd, archive_tmp = tempfile.mkstemp(prefix=".anki-", suffix=".apkg", dir=os.path.dirname(os.path.abspath(out)))
        os.close(fd)
        with zipfile.ZipFile(archive_tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(db, "collection.anki2")
            z.writestr("media", json.dumps({str(i): f for i, f in enumerate(media)}))
            for i, f in enumerate(media):
                z.write(media_path(media_dir, f), str(i))
        os.replace(archive_tmp, out)
        archive_tmp = None
    finally:
        if con is not None:
            con.close()
        if archive_tmp:
            try:
                os.unlink(archive_tmp)
            except FileNotFoundError:
                pass
        shutil.rmtree(tmpdir, ignore_errors=True)
    types = {t: sum(c["type"] == t for c in cards) for t in CARD_TYPES if any(c["type"] == t for c in cards)}
    print(f"OK {out}: {len(cards)} cards | {types} | keys {dist} | media {len(media)}")

if __name__ == "__main__":
    try:
        main(sys.argv[1] if len(sys.argv) > 1 else "cards.json")
    except (OSError, sqlite3.Error, UnicodeError) as error:
        die("could not build the archive (" + type(error).__name__ + ")")
