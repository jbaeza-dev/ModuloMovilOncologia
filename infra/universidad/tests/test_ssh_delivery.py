"""Inspect transport commands without contacting a host or executing deployment."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[3]/'scripts/ci-deploy-university.sh'

@unittest.skipIf(os.name=='nt','Bash transport checks run in Linux container/CI')
class TransportTests(unittest.TestCase):
    def test_pinned_ssh_remote_home_expansion_and_credential_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='qc-ssh-test-') as temp:
            root=Path(temp);binary=root/'bin';binary.mkdir()
            for name in ('ssh','scp'):
                path=binary/name
                path.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$TRANSPORT_LOG"\nif [[ "$*" == *password-stdin* ]]; then cat >/dev/null; fi\n')
                path.chmod(0o700)
            env=dict(os.environ,PATH=str(binary)+':'+os.environ['PATH'],TRANSPORT_LOG=str(root/'commands'),SSH_HOST='example.org',SSH_PORT='22',SSH_USER='quimiocare',SSH_KEY='synthetic private test value',SSH_KNOWN_HOSTS='synthetic known-host entry',REGISTRY_TOKEN='synthetic-ephemeral-token',REGISTRY_USER='test-actor',GITHUB_REF='refs/heads/main',GITHUB_EVENT_NAME='push',GITHUB_SHA='a'*40,GITHUB_RUN_ID='12',GITHUB_RUN_ATTEMPT='1')
            result=subprocess.run(['bash',str(SCRIPT)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            commands=(root/'commands').read_text()
            self.assertIn('StrictHostKeyChecking=yes',commands)
            self.assertIn('"$HOME/quimiocare/releases/',commands)
            self.assertNotIn('\\$HOME',commands)
            self.assertIn('sha256sum --strict -c SHA256SUMS',commands)
            self.assertIn('rm -f "$HOME/quimiocare/releases/',commands)
            self.assertNotIn(env['REGISTRY_TOKEN'],commands)
            env['GITHUB_REF']='refs/heads/feat/test'
            result=subprocess.run(['bash',str(SCRIPT)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            self.assertNotEqual(result.returncode,0)

if __name__=='__main__': unittest.main()
