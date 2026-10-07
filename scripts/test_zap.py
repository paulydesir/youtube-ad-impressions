"""Safety checks; do not start Docker, Chrome, or the real server."""
import importlib.machinery
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('zap', str(Path(__file__).resolve().parents[1] / 'zap'))
spec = importlib.util.spec_from_loader(loader.name, loader)
zap = importlib.util.module_from_spec(spec)
loader.exec_module(zap)


class ZapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'apps/server').mkdir(parents=True)
        (self.root / 'apps/extension').mkdir(parents=True)
        (self.root / '.zap').mkdir()
        for name, value in [('ROOT', self.root), ('STATE', self.root / '.zap')]:
            patcher = patch.object(zap, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_dev_rejects_hosted_database_before_starting_anything(self):
        (self.root / 'apps/server/.env').touch()
        with patch.object(zap, 'env_file', return_value={'DATABASE_URL': 'postgres://user@remote.example/db'}):
            with self.assertRaisesRegex(RuntimeError, 'DATABASE_URL must point to localhost'):
                zap.environment()

    def test_dev_does_not_inherit_production_shell_settings(self):
        (self.root / 'apps/server/.env').touch()
        with patch.dict(zap.os.environ, {'APP_ENV': 'production', 'SERVER_URL': 'https://prod.example'}):
            with patch.object(zap, 'env_file', return_value={'DATABASE_URL': 'postgres://u@localhost/db'}):
                env = zap.environment()
        self.assertEqual(env['APP_ENV'], 'development')
        self.assertEqual(env['SERVER_URL'], 'http://127.0.0.1:8787')

    def test_prod_requires_explicit_hosted_urls(self):
        (self.root / 'apps/extension/.env.production').touch()
        with patch.object(zap, 'env_file', return_value={'SERVER_URL': 'http://localhost:8787'}):
            with self.assertRaisesRegex(RuntimeError, 'hosted HTTPS SERVER_URL'):
                zap.environment(prod=True)

    def test_reused_pid_is_never_signalled(self):
        state = self.root / '.zap/server.json'
        state.write_text(json.dumps({'pid': 999, 'identity': 'old process'}))
        with patch.object(zap, 'identity', return_value='different process'), patch.object(zap.os, 'killpg') as kill:
            zap.stop_server()
            kill.assert_not_called()
        self.assertFalse(state.exists())

    def test_failed_build_preserves_existing_extension(self):
        dist = self.root / 'apps/extension/dist'
        dist.mkdir()
        (dist / 'background.js').write_text('previous working build')
        (dist / 'zap-build.json').write_text('{"build":"old"}')
        with patch.object(zap, 'run', side_effect=RuntimeError('build failed')):
            with self.assertRaisesRegex(RuntimeError, 'build failed'):
                zap.build_extension({}, False)
        self.assertEqual((dist / 'background.js').read_text(), 'previous working build')
        self.assertEqual(json.loads((dist / 'zap-build.json').read_text())['build'], 'old')


if __name__ == '__main__':
    unittest.main()
