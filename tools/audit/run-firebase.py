#!/usr/bin/env python3
"""Run synthetic Firebase suites with the pinned official emulator, without firebase-tools.
FIREBASE_EMULATOR_JAR may select an existing JAR; its size and SHA256 are always verified.
"""
import hashlib
import os
import pathlib
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

VERSION = '4.11.2'
SIZE = 34495935
SHA256 = 'b70d99344caf17c98b6f910fa8f6edf32a7c016cb1035e8915f70d38901eb97f'
URL = f'https://storage.googleapis.com/firebase-preview-drop/emulator/firebase-database-emulator-v{VERSION}.jar'
ROOT = pathlib.Path(__file__).resolve().parents[2]
SUITES = ('security-firebase.test.cjs', 'state-epochs.cjs', 'state-longpoll.cjs')


def verified_jar():
    supplied = os.environ.get('FIREBASE_EMULATOR_JAR')
    jar = pathlib.Path(supplied) if supplied else pathlib.Path(tempfile.gettempdir()) / 'uqu-emulator-audit' / f'firebase-database-emulator-v{VERSION}.jar'
    if not supplied and not jar.exists():
        jar.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL, timeout=45) as response:
            data = response.read(SIZE + 1)
        if len(data) != SIZE or hashlib.sha256(data).hexdigest() != SHA256:
            raise ValueError('Downloaded Firebase emulator failed the pinned size/SHA256 check')
        with tempfile.NamedTemporaryFile(dir=jar.parent, delete=False) as handle:
            temporary = pathlib.Path(handle.name)
            handle.write(data)
        try:
            temporary.replace(jar)
        finally:
            temporary.unlink(missing_ok=True)
    with jar.open('rb') as handle:
        valid = jar.stat().st_size == SIZE and hashlib.file_digest(handle, 'sha256').hexdigest() == SHA256
    if not valid:
        raise ValueError('Firebase emulator JAR failed the pinned size/SHA256 check')
    return jar


def stop_owned(process):
    # Every spawned command owns a fresh process group; never signal a pre-existing emulator/browser.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def main():
    jar = verified_jar()
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    env = dict(os.environ, FIREBASE_DATABASE_EMULATOR_HOST=f'127.0.0.1:{port}', GCLOUD_PROJECT='demo-uqu-audit', GOOGLE_CLOUD_PROJECT='demo-uqu-audit')
    with tempfile.TemporaryFile(mode='w+b') as log:
        emulator = subprocess.Popen(['java', '-jar', str(jar), '--host', '127.0.0.1', '--port', str(port), '--single_project_mode', 'Error'], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            limit = time.monotonic() + 30
            while True:
                if emulator.poll() is not None:
                    raise RuntimeError('Firebase emulator exited before readiness')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        break
                except OSError:
                    if time.monotonic() >= limit:
                        raise TimeoutError('Firebase emulator did not become ready within 30 seconds')
                    time.sleep(.1)
            print(f'Pinned Firebase emulator {VERSION} ready on loopback; synthetic demo namespace only', flush=True)
            for suite in SUITES:
                command = subprocess.Popen(['node', str(ROOT / 'tools/audit' / suite)], cwd=ROOT, env=env, start_new_session=True)
                try:
                    if command.wait(timeout=120):
                        raise RuntimeError(f'Firebase audit suite failed: {suite}')
                finally:
                    stop_owned(command)
        except BaseException:
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - 3000))
            print(log.read().decode(errors='replace'), flush=True)
            raise
        finally:
            stop_owned(emulator)
    print('PASS pinned-JAR Firebase audit suites; owned emulator stopped', flush=True)


if __name__ == '__main__':
    def terminate(_signal, _frame):
        raise SystemExit(143)
    signal.signal(signal.SIGTERM, terminate)
    main()
