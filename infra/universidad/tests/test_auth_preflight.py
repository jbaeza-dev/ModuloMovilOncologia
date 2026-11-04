"""No real service or database is contacted: the engine only records disposable probes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_environment import valid

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'infra/universidad/scripts/check-auth-before-deploy.sh'


@unittest.skipIf(os.name == 'nt', 'Linux deployment checks')
class AuthPreflightTests(unittest.TestCase):
    def exercise(self, failure=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / 'bin'
            binary.mkdir()
            mock = binary / 'podman'
            mock.write_text('''#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$PROBE_LOG"
if [[ "$1" == network ]]; then exit 0; fi
cat >/dev/null
if [[ "$FAIL_AUTH" == true ]]; then exit 1; fi
''')
            mock.chmod(0o700)
            config = root / 'university.env'
            config.write_text(''.join(key+'='+value+'\n' for key,value in valid().items()))
            scratch = root / 'scratch'
            scratch.mkdir()
            env = dict(os.environ, PATH=str(binary)+':'+os.environ['PATH'], TMPDIR=str(scratch),
                       PROBE_LOG=str(root/'commands'), FAIL_AUTH=str(failure).lower())
            result = subprocess.run(['bash', str(SCRIPT), str(config), 'synthetic-clinical-image', 'synthetic-gateway-image'], env=env, capture_output=True, text=True)
            commands = (root/'commands').read_text()
            self.assertEqual(list(scratch.iterdir()), [], 'Private preflight environment must be removed')
            self.assertNotIn(valid()['QC_ADMIN_PASSWORD'], result.stdout+result.stderr+commands)
            return result, commands

    def test_failure_aborts_on_first_probe_and_cleans_private_environment(self):
        result, commands = self.exercise(True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands.count('run --rm'), 1)

    def test_checks_host_and_all_three_runtime_images_without_listening_ports(self):
        result, commands = self.exercise()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(commands.count('run --rm'), 4)
        self.assertEqual(commands.count('run --rm -i'), 4)
        self.assertIn('--network host', commands)
        self.assertIn('--network qc-net', commands)
        self.assertIn('powersync-service', commands)
        self.assertNotIn('--publish', commands)
        self.assertNotIn('--volume', commands)

    def test_dependency_check_precedes_backup_and_writer_stop(self):
        deploy = (ROOT/'infra/universidad/scripts/deploy.sh').read_text()
        self.assertLess(deploy.index('check-auth-before-deploy.sh'), deploy.index('bash "$SCRIPTS/backup.sh"'))
        self.assertLess(deploy.index('check-auth-before-deploy.sh'), deploy.index('systemctl --user stop'))
