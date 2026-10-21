"""Objective-based APKG contract and compatibility: python3 tools/anki/test_objectives.py."""
import copy
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile

from job import build


def card(i, objectives, weak=False):
    a = 'ABCD'[i % 4]
    return dict(type='Mechanism', section='Signaling', hy=True, stem=f'Which pathway explains clinical finding {i}?',
                options={k: f'Pathway {k} response' for k in 'ABCD'}, answer=a,
                explain='This pathway accounts for the response.', why={k: 'This describes a different response.' for k in 'ABCD' if k != a},
                warning='An experimentally verified correction.' if i == 0 else '', source=f'Slide {i + 3}',
                objectives=objectives, objective='; '.join(o + ' — Explain signaling' for o in objectives), tier='T1', weak=weak)


class ObjectivePackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.spec = dict(deck='Physiology::Receptors', lecture='Receptors', objectives=['O1', 'O2'], cap=2,
                         cards=[card(0, ['O1']), card(1, ['O2']), card(2, ['O1'], True)])

    def tearDown(self):
        self.tmp.cleanup()

    def test_exact_model_fields_and_per_note_objective_tags(self):
        st = build('objectives1', self.spec, self.tmp.name)
        self.assertTrue(st['ok'], st)
        with zipfile.ZipFile(os.path.join(self.tmp.name, 'objectives1.apkg')) as z:
            db = os.path.join(self.tmp.name, 'collection.anki2')
            with open(db, 'wb') as f:
                f.write(z.read('collection.anki2'))
        con = sqlite3.connect(db)
        model = next(iter(json.loads(con.execute('select models from col').fetchone()[0]).values()))
        self.assertEqual(model['name'], 'MCQ 4-Option')
        self.assertEqual([f['name'] for f in model['flds']], ['Question', 'OptionA', 'OptionB', 'OptionC', 'OptionD', 'Correct', 'Review', 'Objective', 'Source'])
        self.assertIn('{{FrontSide}}', model['tmpls'][0]['afmt'])
        self.assertIn('nightMode', model['css'])
        notes = con.execute('select tags, flds from notes order by id').fetchall()
        self.assertEqual(len(notes), 3)
        self.assertIn('Receptors::Signaling', notes[0][0])
        self.assertIn('Receptors::Obj::O1', notes[0][0])
        self.assertIn(' T1 ', notes[0][0])
        self.assertIn('WeakSpot', notes[2][0])
        fields = notes[0][1].split('\x1f')
        self.assertEqual(len(fields), 9)
        self.assertIn('Correct: A)', fields[6])
        self.assertIn('class="ok"', fields[6])
        self.assertIn('class="bad"', fields[6])
        self.assertIn('class="warn"', fields[6])
        self.assertIn('O1', fields[7])
        con.close()

    def test_missing_correct_answer_objective_blocks_build(self):
        self.spec['cards'][1]['objectives'] = []
        st = build('objectives2', self.spec, self.tmp.name)
        self.assertFalse(st['ok'])
        self.assertTrue(any('uncovered correct-answer objectives: O2' in e for e in st['errors']), st)

    def test_weak_cards_do_not_consume_main_cap(self):
        self.assertTrue(build('objectives3', self.spec, self.tmp.name)['ok'])
        self.spec['cards'][2]['weak'] = False
        st = build('objectives4', self.spec, self.tmp.name)
        self.assertFalse(st['ok'])
        self.assertIn('main card count exceeds the cap', st['errors'])

    def test_balanced_letters_and_correct_answer_length_are_enforced(self):
        bad = copy.deepcopy(self.spec)
        for c in bad['cards']:
            c['answer'] = 'A'
            c['why'] = {k: 'Different response.' for k in 'BCD'}
        st = build('objectives5', bad, self.tmp.name)
        self.assertFalse(st['ok'])
        self.assertTrue(any('balanced' in e for e in st['errors']))
        bad = copy.deepcopy(self.spec)
        bad['cards'][0]['options']['A'] = 'An extremely long and very detailed explanation compared with the other options'
        st = build('objectives6', bad, self.tmp.name)
        self.assertFalse(st['ok'])
        self.assertTrue(any('longest' in e for e in st['errors']))

    def test_new_prompt_has_no_legacy_fifteen_word_limit(self):
        text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'
        for c in self.spec['cards']:
            c['options'] = {k: text + ' ' + k for k in 'ABCD'}
        self.assertTrue(build('objectives7', self.spec, self.tmp.name)['ok'])

    def test_objective_text_is_required_for_tagged_cards(self):
        self.spec['cards'][0]['objective'] = ''
        st = build('objectives8', self.spec, self.tmp.name)
        self.assertFalse(st['ok'])
        self.assertTrue(any('objective text required' in e for e in st['errors']))

    def test_review_round_trip_contains_objectives_and_weak_allowance(self):
        self.spec['review'] = dict(v=3, objectives=[dict(id='O1', text='Explain signaling')], count=dict(cap=2), weak=['W1'])
        st = build('objectives9', self.spec, self.tmp.name)
        self.assertTrue(st['ok'])
        self.assertEqual(st['review'], self.spec['review'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
