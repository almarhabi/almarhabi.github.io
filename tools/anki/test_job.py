#!/usr/bin/env python3
"""Checks for job.py + build_apkg.py. Run: python3 tools/anki/test_job.py"""
import json, os, re, shutil, sqlite3, sys, tempfile, time, unittest, zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import job  # noqa: E402

LET = "ABCD"


def card(i, ans="A", **kw):
    opts = {k: f"option {k} number {i}" for k in LET}
    c = {"type": ["Mechanism", "Clinical", "Discrimination", "Definition"][i % 4], "tier": "T1" if i % 2 == 0 else "T2",
         "section": "Viral structure", "obj": ["O%d" % (i % 3 + 1)],
         "stem": f"Which feature best explains finding number {i}?", "options": opts, "answer": ans,
         "explain": f"Because of mechanism {i}.", "why": {k: f"belongs to item {k}{i}" for k in LET if k != ans},
         "warning": "", "source": f"Slide {i + 1}"}
    c.update(kw)
    return c


def deck_cards(n):
    seq = "ABCDBCDA" * 60
    return [card(i, seq[i]) for i in range(n)]


class JobTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.root, "in"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def put(self, jid, spec):
        with open(os.path.join(self.root, "in", jid + ".json"), "w", encoding="utf-8") as f:
            json.dump(spec, f) if not isinstance(spec, str) else f.write(spec)

    def status(self, jid):
        with open(os.path.join(self.root, "out", jid + ".json"), encoding="utf-8") as f:
            return json.load(f)

    def test_good_deck(self):
        objs = [{"id": "O%d" % k, "t": "objective %d" % k} for k in (1, 2, 3)]
        self.put("abcdefgh1", {"deck": "Micro::Viruses 1", "lecture": "Viruses 1", "objectives": objs, "cards": deck_cards(12)})
        job.main(self.root)
        st = self.status("abcdefgh1")
        self.assertTrue(st["ok"], st)
        self.assertEqual(st["n"], 12)
        apkg = os.path.join(self.root, "out", "abcdefgh1.apkg")
        self.assertFalse(os.path.exists(os.path.join(self.root, "in", "abcdefgh1.json")))
        with zipfile.ZipFile(apkg) as z:
            self.assertEqual(set(z.namelist()), {"collection.anki2", "media"})
            db = os.path.join(self.root, "c.anki2")
            with open(db, "wb") as f:
                f.write(z.read("collection.anki2"))
        con = sqlite3.connect(db)
        self.assertEqual(con.execute("select count(*) from notes").fetchone()[0], 12)
        self.assertEqual(con.execute("select count(*) from cards").fetchone()[0], 12)
        decks = json.loads(con.execute("select decks from col").fetchone()[0])
        self.assertIn("Micro::Viruses 1", [d["name"] for d in decks.values()])
        flds, tags = con.execute("select flds, tags from notes order by id limit 1").fetchone()
        flds = flds.split("\x1f")
        self.assertEqual(len(flds), 9)                       # Question, OptionA-D, Correct, Review, Objective, Source
        self.assertEqual(flds[5], "A")
        self.assertIn("Correct: A)", flds[6])
        self.assertIn("Why not the others", flds[6])
        self.assertEqual(flds[7], "O1 — objective 1")
        self.assertEqual(flds[8], "Slide 1")
        self.assertEqual(set(tags.split()), {"Viruses_1::Viral_structure", "T1", "Mechanism", "Viruses_1::Obj::O1"})
        model = json.loads(con.execute("select models from col").fetchone()[0])
        self.assertEqual([m["name"] for m in model.values()], ["MCQ 4-Option"])
        con.close()
        self.assertIn("objectives 3/3", st["msg"])

    def test_uncovered_objective_is_a_warning(self):
        objs = [{"id": "O1", "t": "a"}, {"id": "O9", "t": "never answered"}]
        self.put("abcdefgh6", {"deck": "D", "objectives": objs, "cards": deck_cards(3)})
        job.main(self.root)
        st = self.status("abcdefgh6")
        self.assertTrue(st["ok"], st)
        self.assertTrue(any("O9" in w for w in st["warn"]), st)

    def test_builder_errors_come_back(self):
        bad = deck_cards(4)
        bad[1]["tier"] = "T3"
        del bad[2]["why"]["D" if bad[2]["answer"] != "D" else "A"]
        self.put("abcdefgh2", {"deck": "X", "cards": bad})
        job.main(self.root)
        st = self.status("abcdefgh2")
        self.assertFalse(st["ok"])
        self.assertTrue(any("tier must be" in e for e in st["errors"]), st)
        self.assertTrue(any("missing why-not" in e for e in st["errors"]), st)
        self.assertFalse(os.path.exists(os.path.join(self.root, "out", "abcdefgh2.apkg")))

    def test_null_and_wrong_types_never_crash(self):
        weird = deck_cards(3)
        weird[0]["answer"] = None          # build_apkg.validate would raise TypeError on this
        weird[1]["why"] = "nope"            # .get on a str would raise AttributeError
        weird[2]["options"] = ["a", "b"]
        self.put("abcdefgh3", {"deck": None, "cards": weird})
        job.main(self.root)
        st = self.status("abcdefgh3")
        self.assertFalse(st["ok"])
        self.assertFalse(any("crashed" in e for e in st["errors"]), st)

    def test_junk_and_bad_files(self):
        self.put("abcdefgh4", "{not json")
        self.put("Bad Name!", {"cards": deck_cards(2)})     # not a job id: removed, never built
        with open(os.path.join(self.root, "in", "x.txt"), "w") as f:
            f.write("junk")
        done = os.path.join(self.root, "done.txt")
        job.main(self.root, done)
        self.assertFalse(self.status("abcdefgh4")["ok"])
        self.assertEqual(os.listdir(os.path.join(self.root, "in")), [])
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "out"))), ["abcdefgh4.json"])
        self.assertEqual(open(done).read().split(), ["abcdefgh4"])

    def test_paths_from_a_job_are_ignored(self):
        c = deck_cards(2)
        c[0]["image"] = "../../../etc/passwd"
        self.put("abcdefgh5", {"deck": "D", "file": "../../owned.apkg", "media_dir": "/etc", "cards": c})
        job.main(self.root)
        self.assertTrue(self.status("abcdefgh5")["ok"])
        self.assertFalse(os.path.exists(os.path.join(self.root, "owned.apkg")))

    def test_sweep_old_outputs(self):
        out = os.path.join(self.root, "out")
        os.makedirs(out)
        with open(os.path.join(out, "oldjob123.json"), "w") as f:
            json.dump({"at": int(time.time()) - 20 * 86400}, f)
        open(os.path.join(out, "oldjob123.apkg"), "wb").close()
        job.main(self.root)
        self.assertEqual(os.listdir(out), [])


class SiteCopyTests(unittest.TestCase):
    def test_site_uses_this_prompt(self):
        """index.html carries a copy of PROMPT.md (Kimi gets it from there): the two must stay identical."""
        here = os.path.dirname(os.path.abspath(__file__))
        html = open(os.path.join(here, "..", "..", "index.html"), encoding="utf-8").read()
        m = re.search(r'const AK_PROMPT=("(?:[^"\\]|\\.)*");', html)
        self.assertIsNotNone(m)
        self.assertEqual(json.loads(m.group(1)), open(os.path.join(here, "PROMPT.md"), encoding="utf-8").read().strip())


if __name__ == "__main__":
    unittest.main(verbosity=2)
