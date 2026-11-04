"""External isolation must not be confused with application/TLS failures."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts/verify-university-public.sh'


@unittest.skipIf(os.name == 'nt', 'Linux probe entrypoint')
class ExternalProbeTests(unittest.TestCase):
    def run_probe(self, scenario):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / 'curl'
            executable.write_text('''#!/usr/bin/env python3
import os,sys
case=os.environ['PROBE_SCENARIO']
if case == 'timeout': print('000',end=''); sys.exit(28)
if case == 'tls': print('000',end=''); sys.exit(60)
if case == 'refused': print('000',end=''); sys.exit(7)
if case == 'started_timeout': print('200',end=''); sys.exit(28)
if case == 'unhealthy': print('503',end=''); sys.exit(0)
if case == 'exposed' and 'checkpoint' in sys.argv[-1]: print('200',end=''); sys.exit(0)
print('200' if sys.argv[-1].endswith('/health') else '401',end='')
''')
            executable.chmod(0o700)
            summary = root / 'summary'
            env = dict(os.environ, PATH=str(root) + ':' + os.environ['PATH'],
                       PROBE_SCENARIO=scenario, QC_PUBLIC_ORIGIN='https://example.org',
                       GITHUB_STEP_SUMMARY=str(summary))
            result = subprocess.run(['bash', str(SCRIPT)], env=env, capture_output=True, text=True)
            return result, summary.read_text() if summary.exists() else ''

    def test_expected_responses_pass(self):
        result, summary = self.run_probe('healthy')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PASSED', summary)

    def test_no_http_timeout_is_explicitly_inconclusive(self):
        result, summary = self.run_probe('timeout')
        self.assertEqual(result.returncode, 0)
        self.assertIn('::warning::', result.stdout)
        self.assertIn('INCONCLUSIVE', summary)
        self.assertNotIn('PASSED', summary)

    def test_http_errors_exposure_tls_and_partial_timeouts_still_fail(self):
        for scenario in ('unhealthy', 'exposed', 'tls', 'refused', 'started_timeout'):
            with self.subTest(scenario=scenario):
                result, summary = self.run_probe(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('::error::', result.stdout)
                self.assertNotIn('PASSED', summary)


if __name__ == '__main__':
    unittest.main()
