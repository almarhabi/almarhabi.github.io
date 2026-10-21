"""Production regressions for the untrusted job boundary and generated APKG archive.

Run: python3 -m unittest discover -s tools/anki -p 'test_*.py'
Only temporary local files are used. No GitHub, Kimi or user data is accessed.
"""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import random
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

import build_apkg
import job
from test_job import deck_cards


class ProductionJobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.out = self.root / 'out'
        self.out.mkdir()
        self.spec = {'deck': 'Audit::Safety', 'cards': deck_cards(4)}

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, spec=None, jid='auditjob1'):
        return job.build(jid, spec if spec is not None else self.spec, str(self.out))

    def notes(self, jid='auditjob1'):
        with zipfile.ZipFile(self.out / (jid + '.apkg')) as archive:
            db = self.root / 'inspect.anki2'
            db.write_bytes(archive.read('collection.anki2'))
        with sqlite3.connect(db) as con:
            self.assertEqual(con.execute('pragma integrity_check').fetchone()[0], 'ok')
            return [row[0].split('\x1f') for row in con.execute('select flds from notes order by id')]

    def test_invalid_job_id_cannot_escape_output_directory(self):
        status = self.build(jid='../outside')
        self.assertFalse(status['ok'])
        self.assertIn('invalid job id', status['errors'])
        self.assertFalse((self.root / 'outside.apkg').exists())

    def test_card_limit_is_rejected_instead_of_silently_truncating(self):
        status = self.build({'cards': deck_cards(job.MAX_CARDS + 1)})
        self.assertFalse(status['ok'])
        self.assertTrue(any('too many cards' in e for e in status['errors']))
        self.assertEqual(list(self.out.iterdir()), [])

    def test_blank_stem_and_duplicate_options_are_rejected(self):
        for change, expected in [({'stem': '  '}, 'stem required'),
                                 ({'options': dict(A='Alpha &amp; beta', B=' alpha & beta ', C='Gamma', D='Delta')}, 'options must be distinct')]:
            with self.subTest(expected=expected):
                spec = copy.deepcopy(self.spec)
                spec['cards'][0].update(change)
                status = self.build(spec)
                self.assertFalse(status['ok'])
                self.assertTrue(any(expected in e for e in status['errors']), status)

    def test_objective_cap_wrong_types_do_not_crash_or_get_coerced(self):
        for value in [None, [], {}, '2', 1.9, -1, 301, True, float('inf')]:
            with self.subTest(value=value):
                spec = dict(self.spec, objectives=['O1'], cap=value)
                status = self.build(spec)
                self.assertFalse(status['ok'])
                self.assertTrue(any('cap must' in e for e in status['errors']), status)

    def test_raw_html_cannot_execute_in_anki_fields(self):
        self.spec['cards'][0]['source'] = 'Slide 3<img src=x onerror="window.audit=1"><script>window.audit=2</script>'
        self.spec['cards'][0]['explain'] = '<b onclick="window.audit=3">Mechanism</b><br>Details &amp; evidence.'
        status = self.build()
        self.assertTrue(status['ok'], status)
        note = self.notes()[0]
        self.assertNotIn('<script>', note[14])
        self.assertNotIn('<img ', note[14])
        self.assertIn('&lt;script&gt;', note[14])
        self.assertIn('<b>Mechanism</b><br>', note[8])
        self.assertNotIn('onclick=', note[8])
        self.assertIn('&amp;', note[8])

    def test_destination_symlinks_do_not_overwrite_outside_files(self):
        outside = self.root / 'outside.txt'
        outside.write_text('keep me')
        (self.out / 'auditjob1.apkg').symlink_to(outside)
        status = self.build()
        self.assertTrue(status['ok'], status)
        self.assertEqual(outside.read_text(), 'keep me')
        self.assertFalse((self.out / 'auditjob1.apkg').is_symlink())

    def test_symlinked_job_directories_are_rejected(self):
        external = self.root / 'external'
        external.mkdir()
        (self.root / 'in').symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symbolic links'):
            job.main(str(self.root))

    def test_input_symlink_is_removed_without_reading_target(self):
        (self.root / 'in').mkdir()
        outside = self.root / 'external.json'
        outside.write_text(json.dumps(self.spec))
        (self.root / 'in' / 'auditjob1.json').symlink_to(outside)
        job.main(str(self.root))
        self.assertTrue(outside.exists())
        self.assertFalse((self.out / 'auditjob1.json').exists())
        self.assertFalse((self.root / 'in' / 'auditjob1.json').exists())

    def test_status_is_atomic_and_failed_write_preserves_pending_input(self):
        (self.root / 'in').mkdir()
        inp = self.root / 'in' / 'auditjob1.json'
        inp.write_text(json.dumps(self.spec))
        prior = self.out / 'auditjob1.json'
        prior.write_text('{"prior":true}')
        original_replace = os.replace
        def replace(source, target):
            if str(target).endswith('auditjob1.json'):
                raise OSError('injected status write failure')
            original_replace(source, target)
        with mock.patch.object(job.os, 'replace', side_effect=replace):
            with self.assertRaises(OSError):
                job.main(str(self.root))
        self.assertTrue(inp.exists(), 'unacknowledged input must remain retryable')
        self.assertEqual(json.loads(prior.read_text()), {'prior': True})
        self.assertFalse(list(self.out.glob('.anki-*')), 'atomic temp files must be cleaned')

    def test_multibyte_review_uses_byte_limit(self):
        spec = dict(self.spec, review={'text': '\U0001f9e0' * (job.MAX_REVIEW // 4 + 1)})
        status = self.build(spec)
        self.assertTrue(status['ok'], status)
        self.assertNotIn('review', status)

    def test_nonfinite_json_is_reported_and_other_jobs_continue(self):
        (self.root / 'in').mkdir()
        (self.root / 'in' / 'auditjob1.json').write_text('{"cards":[NaN]}')
        (self.root / 'in' / 'auditjob2.json').write_text(json.dumps(self.spec))
        job.main(str(self.root))
        self.assertFalse(json.loads((self.out / 'auditjob1.json').read_text())['ok'])
        self.assertTrue(json.loads((self.out / 'auditjob2.json').read_text())['ok'])

    def test_builder_timeout_returns_actionable_error(self):
        with mock.patch.object(job.subprocess, 'run', side_effect=subprocess.TimeoutExpired('builder', 120)):
            status = self.build()
        self.assertFalse(status['ok'])
        self.assertTrue(any('over 2 minutes' in e for e in status['errors']))

    def test_backlog_batch_reserves_time_to_publish_and_leaves_pending_input(self):
        (self.root / 'in').mkdir()
        for jid in ('auditjob1', 'auditjob2'):
            (self.root / 'in' / (jid + '.json')).write_text(json.dumps(self.spec))
        with mock.patch.object(job.time, 'monotonic', side_effect=[0, 0, 111]):
            job.main(str(self.root))
        self.assertTrue((self.out / 'auditjob1.json').exists())
        self.assertTrue((self.root / 'in' / 'auditjob2.json').exists())
        self.assertFalse((self.out / 'auditjob2.json').exists())

    def test_deep_json_is_an_error_without_stopping_later_jobs(self):
        (self.root / 'in').mkdir()
        (self.root / 'in' / 'auditjob1.json').write_text('[' * 2000 + '0' + ']' * 2000)
        (self.root / 'in' / 'auditjob2.json').write_text(json.dumps(self.spec))
        job.main(str(self.root))
        self.assertFalse(json.loads((self.out / 'auditjob1.json').read_text())['ok'])
        self.assertTrue(json.loads((self.out / 'auditjob2.json').read_text())['ok'])


class ProductionBuilderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_builder(self, spec):
        path = self.root / 'cards.json'
        path.write_text(json.dumps(spec))
        return subprocess.run([sys.executable, build_apkg.__file__, str(path)], cwd=self.root, capture_output=True, text=True)

    def test_malformed_json_shapes_return_validation_errors_not_tracebacks(self):
        good = {'deck': 'Audit', 'cards': deck_cards(2)}
        variants = [None, [], {}, {'deck': None, 'cards': []}, dict(good, cards=None), dict(good, cards=[None]), dict(good, cards=[{}]), dict(good, media_dir=[]), dict(good, lecture=5), dict(good, file=[]), dict(good, objectives=[{}])]
        for variant in variants:
            with self.subTest(variant=variant):
                result = self.run_builder(variant)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('ERROR:', result.stdout)
                self.assertNotIn('Traceback', result.stderr)

    def test_validator_tolerates_wrong_card_shapes(self):
        wrong = [None, 0, True, '', [], {}, {'options': None}, {'options': dict.fromkeys('ABCD')}, {'stem': {}, 'options': {k: k for k in 'ABCD'}, 'answer': []}]
        for value in wrong:
            with self.subTest(value=value):
                errors, _ = build_apkg.validate([value], str(self.root))
                self.assertTrue(errors)

    def test_generated_malformed_shapes_never_raise(self):
        values = [None, True, False, 0, -1, 1.2, '', ' ', 'text', [], {}, ['A'], {'bad': 1}]
        rng = random.Random(2039)
        for _ in range(10000):
            c = {key: rng.choice(values) for key in ('stem', 'options', 'answer', 'why', 'source', 'explain', 'image', 'image_back', 'type', 'section', 'warning', 'objective', 'objectives', 'tier', 'weak')}
            if rng.randrange(2):
                c['options'] = {key: rng.choice(values) for key in 'ABCD'}
            if rng.randrange(2):
                c['why'] = {key: rng.choice(values) for key in 'ABCD'}
            errors, distribution = build_apkg.validate([c], str(self.root))
            self.assertTrue(errors)
            self.assertEqual(set(distribution), set('ABCD'))
            self.assertTrue(build_apkg.validate_objectives([c], rng.choice(values), rng.choice(values)))

    def test_allowed_html_is_balanced_and_attributes_are_removed(self):
        self.assertEqual(build_apkg.safe_html('<b onclick="alert(1)">term'), '<b>term</b>')
        self.assertEqual(build_apkg.safe_html('</b>outside<br/>'), 'outside<br>')

    def test_unhashable_objective_values_return_errors(self):
        for objectives in [None, {}, [None], [{}], [[]], ['O1', 1]]:
            with self.subTest(objectives=objectives):
                self.assertTrue(build_apkg.validate_objectives(deck_cards(2), objectives, 2))

    def test_media_paths_cannot_read_outside_directory_or_follow_symlinks(self):
        media = self.root / 'media'
        media.mkdir()
        outside = self.root / 'private.txt'
        outside.write_text('private test fixture')
        (media / 'link.png').symlink_to(outside)
        for name in [str(outside), '../private.txt', 'link.png', '..\\private.txt']:
            with self.subTest(name=name):
                self.assertIsNone(build_apkg.media_path(str(media), name))
        (media / 'good.png').write_bytes(b'fixture')
        self.assertEqual(build_apkg.media_path(str(media), 'good.png'), str(media / 'good.png'))

    def test_success_cleans_collection_temp_directory(self):
        spec = {'deck': 'Audit', 'file': str(self.root / 'test.apkg'), 'cards': deck_cards(2)}
        source = self.root / 'cards.json'
        source.write_text(json.dumps(spec))
        actual_mkdtemp = tempfile.mkdtemp
        created = []
        def mkdtemp(*args, **kwargs):
            kwargs['dir'] = str(self.root)
            folder = actual_mkdtemp(*args, **kwargs)
            created.append(folder)
            return folder
        with mock.patch.object(build_apkg.tempfile, 'mkdtemp', side_effect=mkdtemp), contextlib.redirect_stdout(io.StringIO()):
            build_apkg.main(source)
        self.assertTrue(created)
        self.assertTrue(all(not Path(p).exists() for p in created))
        self.assertTrue((self.root / 'test.apkg').exists())

    def test_archive_failure_cleans_resources_and_preserves_previous_file(self):
        out = self.root / 'test.apkg'
        out.write_bytes(b'previous archive')
        source = self.root / 'cards.json'
        source.write_text(json.dumps({'deck': 'Audit', 'file': str(out), 'cards': deck_cards(2)}))
        actual_mkdtemp = tempfile.mkdtemp
        created = []
        def mkdtemp(*args, **kwargs):
            kwargs['dir'] = str(self.root)
            folder = actual_mkdtemp(*args, **kwargs)
            created.append(folder)
            return folder
        with mock.patch.object(build_apkg.tempfile, 'mkdtemp', side_effect=mkdtemp), mock.patch.object(build_apkg.zipfile, 'ZipFile', side_effect=OSError('injected archive failure')):
            with self.assertRaises(OSError):
                build_apkg.main(source)
        self.assertEqual(out.read_bytes(), b'previous archive')
        self.assertTrue(all(not Path(p).exists() for p in created))
        self.assertFalse(list(self.root.glob('.anki-*')))

    def test_field_separator_control_characters_are_rejected(self):
        c = deck_cards(1)[0]
        c['explain'] = 'unsafe\x1fextra field'
        errors, _ = build_apkg.validate([c], str(self.root))
        self.assertTrue(any('control characters' in e for e in errors))

    def test_deep_json_cli_error_is_not_a_traceback(self):
        source = self.root / 'deep.json'
        source.write_text('[' * 2000 + '0' + ']' * 2000)
        result = subprocess.run([sys.executable, build_apkg.__file__, str(source)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ERROR:', result.stdout)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
