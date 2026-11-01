"""Fail-closed coordination tests. Run under Linux; no real service is stopped."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1]/'scripts/backup.sh'

@unittest.skipIf(os.name=='nt','Linux shell tests run in the isolated CI/container')
class BackupTests(unittest.TestCase):
    def exercise(self, failure=None):
        temp=tempfile.TemporaryDirectory(prefix='qc-backup-test-')
        self.addCleanup(temp.cleanup)
        root=Path(temp.name); binaries=root/'bin';binaries.mkdir()
        media=root/'media';(media/'educacion').mkdir(parents=True)
        (media/'educacion/image.png').write_bytes(b'synthetic backup test')
        commands={
          'systemctl': '''#!/usr/bin/env bash
set -eu
echo "$*" >> "$COMMAND_LOG"
if [[ "$2" == is-active ]]; then [[ ! -f "$TEST_ROOT/stopped" ]]; exit; fi
if [[ "$2" == stop ]]; then
 [[ "$FAIL_STOP" != true ]] || exit 1
 [[ "$FAIL_DRAIN" == true ]] || touch "$TEST_ROOT/stopped"
fi
''',
          'docker': '''#!/usr/bin/env bash
set -eu
echo "$*" >> "$ENGINE_LOG"
if [[ "$*" == *pg_database_size* ]]; then printf '65536'; exit 0; fi
[[ "$FAIL_DUMP" != true ]] || exit 1
printf 'synthetic custom dump'
'''
        }
        if failure=='capacity':
            commands['df']="#!/usr/bin/env bash\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nsynthetic 2000000 1999000 1000 99%% /test\\n'\n"
        for name,script in commands.items():
            path=binaries/name;path.write_text(script);path.chmod(0o700)
        env=dict(os.environ,PATH=str(binaries)+':'+os.environ['PATH'],TEST_ROOT=str(root),COMMAND_LOG=str(root/'commands'),ENGINE_LOG=str(root/'engine'),FAIL_STOP=str(failure=='stop').lower(),FAIL_DRAIN=str(failure=='drain').lower(),FAIL_DUMP=str(failure=='dump').lower(),CONTAINER_ENGINE='docker',DATABASE_CONTAINER='qc_explicit_test',DATABASE_USER='postgres',CLINICAL_DATABASE='qc_source_test',GATEWAY_DATABASE='qc_gateway_test',MEDIA_ROOT=str(media),BACKUP_ROOT=str(root/'backups'),RESUME_WRITERS='true')
        result=subprocess.run(['bash',str(SCRIPT)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        return root,result

    def test_stopped_snapshot_checksums_and_resume(self):
        root,result=self.exercise()
        self.assertEqual(result.returncode,0,result.stderr)
        backup=next((root/'backups').iterdir())
        self.assertIn('version=2',(backup/'manifest.txt').read_text())
        self.assertEqual(subprocess.run(['sha256sum','--strict','-c','checksums.sha256'],cwd=backup,stdout=subprocess.DEVNULL).returncode,0)
        self.assertIn('start qc-worker.service',(root/'commands').read_text())

    def test_failed_stop_or_drain_never_dumps(self):
        for failure in ('stop','drain'):
            with self.subTest(failure=failure):
                root,result=self.exercise(failure)
                self.assertNotEqual(result.returncode,0)
                self.assertNotIn('pg_dump',(root/'engine').read_text())
                self.assertIn('start qc-worker.service',(root/'commands').read_text())

    def test_dump_failure_resumes_previous_writers(self):
        root,result=self.exercise('dump')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('start qc-worker.service',(root/'commands').read_text())
        self.assertFalse(list((root/'backups').glob('*/manifest.txt')))

    def test_low_capacity_aborts_before_stopping_writers(self):
        root,result=self.exercise('capacity')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((root/'commands').exists())
        self.assertNotIn('pg_dump',(root/'engine').read_text())

if __name__=='__main__': unittest.main()
