"""Exercise archive boundaries without touching host deployment data."""
import importlib.util
import io
import json
import os
import subprocess
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[3] / 'scripts/extract-university-release.py'
spec = importlib.util.spec_from_file_location('extract_release', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
IDENTITY = 'a' * 40 + '-12-1'


class LocalDeliveryTests(unittest.TestCase):
    @unittest.skipIf(os.name == 'nt', 'Linux entrypoint guard')
    def test_runner_rejects_non_main_and_hosted_execution_before_host_changes(self):
        script = SOURCE.with_name('ci-deploy-university-local.sh')
        for ref, event, runner in (
            ('refs/heads/feature', 'push', 'self-hosted'),
            ('refs/heads/main', 'pull_request', 'self-hosted'),
            ('refs/heads/main', 'push', 'github-hosted'),
        ):
            env = dict(os.environ, GITHUB_REF=ref, GITHUB_EVENT_NAME=event, RUNNER_ENVIRONMENT=runner)
            result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Main push on a self-hosted runner required', result.stderr)

    def exercise(self, extra=None, identity=IDENTITY):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            destination = root / 'release'
            destination.mkdir()
            archive = root / 'bundle.tar.gz'
            with tarfile.open(archive, 'w:gz') as bundle:
                data = json.dumps({'release_id': identity, 'revision': identity[:40]}).encode()
                member = tarfile.TarInfo('./manifest.json')
                member.size = len(data)
                bundle.addfile(member, io.BytesIO(data))
                if extra is not None:
                    bundle.addfile(extra, io.BytesIO(b'x' * extra.size))
            module.extract(archive, destination, IDENTITY)
            self.assertTrue((destination / 'manifest.json').is_file())
            if os.name != 'nt':
                self.assertEqual(stat.S_IMODE((destination / 'manifest.json').stat().st_mode), 0o644)
                self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o755)
                for path in destination.rglob('*'):
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755 if path.is_dir() else 0o644)

    def test_valid_bundle(self):
        self.exercise()

    @unittest.skipIf(os.name == 'nt', 'POSIX bind-mount permissions')
    def test_container_config_readable_with_restrictive_deployment_umask(self):
        previous = os.umask(0o077)
        try:
            self.exercise(tarfile.TarInfo('infra/powersync/service.yaml'))
        finally:
            os.umask(previous)

    def test_retry_reuses_identical_release_and_preserves_tampered_one(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            destination = root / 'release'
            archive = root / 'bundle.tar.gz'
            data = json.dumps({'release_id': IDENTITY, 'revision': IDENTITY[:40]}).encode()
            with tarfile.open(archive, 'w:gz') as bundle:
                member = tarfile.TarInfo('manifest.json')
                member.size = len(data)
                bundle.addfile(member, io.BytesIO(data))
            module.prepare(archive, destination, IDENTITY)
            module.prepare(archive, destination, IDENTITY)
            marker = destination / 'manifest.json'
            marker.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'differs'):
                module.prepare(archive, destination, IDENTITY)
            self.assertEqual(marker.read_text(), 'changed')

    def test_wrong_attempt_rejected(self):
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.exercise(identity='a' * 40 + '-12-2')

    def test_path_traversal_and_absolute_paths_rejected(self):
        for name in ('../outside', '/outside', 'folder/../../outside', 'folder\\outside'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.exercise(tarfile.TarInfo(name))

    def test_links_and_special_files_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
            member = tarfile.TarInfo('linked')
            member.type = kind
            member.linkname = '/outside'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.exercise(member)

    def test_duplicate_path_rejected(self):
        with self.assertRaises(ValueError):
            self.exercise(tarfile.TarInfo('manifest.json'))

    def test_nonempty_destination_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            marker = root / 'existing'
            marker.write_text('preserve')
            with self.assertRaisesRegex(ValueError, 'empty'):
                module.extract('unused', root, IDENTITY)
            self.assertEqual(marker.read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
