"""Linux lifecycle tests use fake Podman/systemd and an isolated HOME only."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from test_environment import valid

ROOT = Path(__file__).resolve().parents[3]


@unittest.skipIf(os.name == 'nt', 'Linux lifecycle checks')
class JwksLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='qc-jwks-lifecycle-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.auth = self.home/'quimiocare/shared/auth'
        self.auth.mkdir(parents=True)
        binary = self.home/'bin'; binary.mkdir()
        self.commands = self.home/'commands'
        self.env = dict(os.environ, HOME=str(self.home), PATH=str(binary)+':'+os.environ['PATH'],
                        COMMAND_LOG=str(self.commands), ACTIVE='yes', RESULT='KEYSET_CHANGED',
                        FAIL_INSTALL='no', FAIL_RESTART='no')
        config = valid(); config['AUTH_JWKS_MODE']='distributed'
        (self.auth.parent/'universidad.env').write_text(''.join(k+'='+v+'\n' for k,v in config.items()))
        self.incoming = self.home/'incoming.json'; self.incoming.write_text('{}')
        mocks = {
            'podman': '''#!/usr/bin/env bash
set -eu
printf 'podman %s\\n' "$*" >> "$COMMAND_LOG"
[[ "$FAIL_INSTALL" != yes ]] || exit 1
echo "$RESULT"
''',
            'systemctl': '''#!/usr/bin/env bash
set -eu
printf 'systemctl %s\\n' "$*" >> "$COMMAND_LOG"
if [[ "$*" == *is-active* ]]; then [[ "$ACTIVE" == yes ]]; exit; fi
if [[ "$*" == *restart* && "$FAIL_RESTART" == yes ]]; then exit 1; fi
''',
        }
        for name, contents in mocks.items():
            path=binary/name; path.write_text(contents); path.chmod(0o700)

    def run_script(self, name, *args):
        return subprocess.run(['bash',str(ROOT/'infra/universidad/scripts'/name),*map(str,args)],
                              env=self.env,capture_output=True,text=True,timeout=15)

    def commands_text(self):
        return self.commands.read_text() if self.commands.exists() else ''

    def test_expiry_stops_sync_and_marks_resume_but_fresh_copy_does_nothing(self):
        now=int(time.time()*1000)
        value=dict(schema=1,fetchedAt=now,expiresAt=now+43200000)
        (self.auth/'snapshot.json').write_text(json.dumps(value))
        self.assertEqual(self.run_script('jwks-expiry.sh').returncode,0)
        self.assertEqual(self.commands_text(),'')
        value.update(fetchedAt=now-43200001,expiresAt=now-1)
        (self.auth/'snapshot.json').write_text(json.dumps(value))
        result=self.run_script('jwks-expiry.sh')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('stop qc-powersync.service qc-proxy-backend.service',self.commands_text())
        self.assertTrue((self.auth/'resume-sync').exists())

    def test_rotation_restarts_and_retry_recovers_failed_restart(self):
        self.env['FAIL_RESTART']='yes'
        self.assertNotEqual(self.run_script('install-jwks.sh',self.incoming,'synthetic-image').returncode,0)
        self.assertTrue((self.auth/'restart-sync').exists())
        self.env.update(FAIL_RESTART='no',RESULT='KEYSET_UNCHANGED')
        result=self.run_script('install-jwks.sh',self.incoming,'synthetic-image')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.commands_text().count('restart qc-powersync.service'),2)
        self.assertFalse((self.auth/'restart-sync').exists())

    def test_install_failure_does_not_resume_expired_services(self):
        (self.auth/'resume-sync').touch(); self.env['FAIL_INSTALL']='yes'
        self.assertNotEqual(self.run_script('install-jwks.sh',self.incoming,'synthetic-image').returncode,0)
        self.assertNotIn('systemctl',self.commands_text())
        self.assertTrue((self.auth/'resume-sync').exists())

    def test_unchanged_renewal_resumes_only_services_stopped_by_expiry(self):
        self.env.update(ACTIVE='no',RESULT='KEYSET_UNCHANGED')
        result=self.run_script('install-jwks.sh',self.incoming,'synthetic-image')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('systemctl',self.commands_text())
        (self.auth/'resume-sync').touch()
        result=self.run_script('install-jwks.sh',self.incoming,'synthetic-image')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('start qc-powersync.service qc-proxy-backend.service',self.commands_text())
        self.assertFalse((self.auth/'resume-sync').exists())

    def test_deployment_install_never_resumes_writers_mid_migration(self):
        self.env['JWKS_INSTALL_DURING_DEPLOY']='true'
        (self.auth/'resume-sync').touch()
        result=self.run_script('install-jwks.sh',self.incoming,'synthetic-image')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('systemctl',self.commands_text())

