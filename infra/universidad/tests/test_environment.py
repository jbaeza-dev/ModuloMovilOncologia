import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse, unquote

SOURCE = Path(__file__).resolve().parents[1]/'scripts/environment.py'
spec = importlib.util.spec_from_file_location('environment', SOURCE)
environment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(environment)

def valid():
    values={key: str(i)*32+'/@:$%#' for i,key in enumerate(['POSTGRES_PASSWORD','QC_ADMIN_PASSWORD','QC_REPLICA_PASSWORD','QC_GATEWAY_PASSWORD','QC_STORAGE_PASSWORD','DEMO_CONTROL_KEY','GATEWAY_CURSOR_KEY','PS_ADMIN_TOKEN'])}
    values.update(PUBLIC_ORIGIN='https://example.org',IMAGE_NAMESPACE='ghcr.io/test',AUTH_EXPECTED_ISSUER='https://example.supabase.co/auth/v1',AUTH_PUBLIC_KEY='sb_publishable_synthetic_public_test_key')
    return values

class EnvironmentTests(unittest.TestCase):
    def test_uri_encoding_and_public_prefix(self):
        raw=valid(); result=environment.configuration(raw)
        self.assertEqual(unquote(urlparse(result['DATABASE_URL']).password),raw['QC_ADMIN_PASSWORD'])
        self.assertEqual(result['POWERSYNC_PUBLIC_BASE_URL'],'https://example.org/quimiocare-backend')

    def test_separate_credentials_and_modes(self):
        with tempfile.TemporaryDirectory(prefix='qc-env-test-') as temp:
            root=Path(temp); source=root/'host.env'
            source.write_text(''.join(k+'='+v+'\n' for k,v in valid().items()))
            environment.render(source,root/'env')
            gateway=(root/'env/gateway.env').read_text()
            self.assertNotIn('POSTGRES_PASSWORD',gateway)
            self.assertNotIn('PS_ADMIN_TOKEN',gateway)
            self.assertNotIn('DATABASE_URL=',(root/'env/powersync.env').read_text())
            self.assertNotIn('QC_ADMIN_PASSWORD',(root/'env/clinical.env').read_text())
            if os.name!='nt': self.assertEqual((root/'env/gateway.env').stat().st_mode&0o777,0o600)

    def test_rejects_placeholder_privileged_key_insecure_origin_and_invalid_flags(self):
        for key,value in [('AUTH_PUBLIC_KEY','sb_secret_'+'synthetic_private_key'),('PUBLIC_ORIGIN','http://example.org'),('PUBLIC_ORIGIN','https://example.org/path'),('PUBLIC_ORIGIN','https://:synthetic@example.org'),('PUBLIC_ORIGIN','https://example.org:99999'),('QC_ADMIN_PASSWORD','REEMPLAZAR_SECRET'),('INITIALIZE_SYNTHETIC_DATABASE','yes'),('AUTH_ALLOWED_ALGORITHM','HS256')]:
            with self.subTest(key=key,value=value):
                raw=valid();raw[key]=value
                with self.assertRaises(ValueError): environment.configuration(raw)
        raw=valid();raw.update(PREPARATION_ENABLED='true',API_DOCS_ENABLED='false')
        with self.assertRaises(ValueError): environment.configuration(raw)

    def test_no_shell_execution_and_duplicate_rejected(self):
        with tempfile.TemporaryDirectory(prefix='qc-env-test-') as temp:
            source=Path(temp)/'env'
            source.write_text('SAFE=$(touch never-executed)\n')
            self.assertEqual(environment.read_env(source)['SAFE'],'$(touch never-executed)')
            source.write_text('SAFE=one\nSAFE=two\n')
            with self.assertRaises(ValueError): environment.read_env(source)

if __name__=='__main__': unittest.main()
