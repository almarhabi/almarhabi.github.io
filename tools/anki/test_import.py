"""Optional real Anki-backend integration tests (no GUI, account or network at test time).

Use an isolated environment with anki==25.9.5 installed, then run unittest discovery.
The normal standard-library-only suite skips these two tests when Anki is absent.
"""
import importlib.util
import os
import tempfile
import unittest

import job
from test_job import deck_cards
from test_objectives import card

HAS_ANKI = importlib.util.find_spec('anki') is not None


@unittest.skipUnless(HAS_ANKI, 'optional Anki backend is not installed')
class RealAnkiImportTests(unittest.TestCase):
    def setUp(self):
        from anki.collection import Collection
        self.tmp = tempfile.TemporaryDirectory()
        self.col = Collection(os.path.join(self.tmp.name, 'collection.anki2'))

    def tearDown(self):
        self.col.close()
        self.tmp.cleanup()

    def import_twice(self, spec, expected):
        from anki.import_export_pb2 import ImportAnkiPackageRequest
        status = job.build('realanki1', spec, self.tmp.name)
        self.assertTrue(status['ok'], status)
        request = ImportAnkiPackageRequest(package_path=os.path.join(self.tmp.name, 'realanki1.apkg'))
        self.col.import_anki_package(request)
        self.assertEqual(self.col.note_count(), expected)
        self.assertEqual(self.col.card_count(), expected)
        self.col.import_anki_package(request)
        self.assertEqual(self.col.note_count(), expected, 're-import must not duplicate notes')
        self.assertEqual(self.col.card_count(), expected, 're-import must not duplicate cards')
        return self.col.get_card(self.col.find_cards('')[0])

    def test_legacy_package_import_and_repeat_import(self):
        imported = self.import_twice(dict(deck='Audit::Legacy', cards=deck_cards(4)), 4)
        self.assertIn('A.', imported.question())
        self.assertIn('Slide', imported.answer())

    def test_objective_package_import_fields_tags_and_repeat_import(self):
        imported = self.import_twice(dict(deck='Audit::Objectives', lecture='Objectives', objectives=['O1', 'O2'], cap=2,
                                         cards=[card(0, ['O1']), card(1, ['O2']), card(2, ['O1'], True)]), 3)
        self.assertIn('A)', imported.question())
        answer = imported.answer()
        self.assertIn('Correct:', answer)
        self.assertIn('Objective:', answer)
        self.assertIn('Source:', answer)
        notes = [self.col.get_note(nid) for nid in self.col.find_notes('')]
        self.assertTrue(all(len(n.fields) == 9 for n in notes))
        self.assertTrue(any('Objectives::Obj::O2' in n.tags for n in notes))
        self.assertTrue(any('WeakSpot' in n.tags for n in notes))


if __name__ == '__main__':
    unittest.main(verbosity=2)
