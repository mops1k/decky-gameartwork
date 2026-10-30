"""Backend tests for main.py.

The plugin runs inside Decky, so the decky/settings/helpers/vdf modules are
stubbed before the import: everything below exercises plain Python only.
"""

import importlib.util
import json
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class _FakeSettings:
    def __init__(self):
        self.settings = {}
        self.commits = 0

    def getSetting(self, key, default=None):
        return self.settings.get(key, default)

    def setSetting(self, key, value):
        self.settings[key] = value
        self.commit()

    def commit(self):
        self.commits += 1


def _load_main(tmpdir):
    """Import main.py with stubbed Decky modules."""
    decky = types.ModuleType('decky')
    decky.logger = types.SimpleNamespace(
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
        error=lambda *a, **k: None,
        debug=lambda *a, **k: None,
    )
    decky.DECKY_USER_HOME = str(tmpdir)
    decky.DECKY_HOME = str(tmpdir)
    decky.DECKY_PLUGIN_SETTINGS_DIR = str(Path(tmpdir) / 'settings')
    decky.DECKY_PLUGIN_DIR = str(ROOT)
    decky.migrate_settings = lambda *a, **k: None

    settings = types.ModuleType('settings')
    settings.SettingsManager = _FakeSettings

    helpers = types.ModuleType('helpers')
    import ssl
    helpers.get_ssl_context = ssl.create_default_context

    vdf = types.ModuleType('vdf')
    vdf.binary_load = lambda handle: json.load(handle)
    vdf.binary_dump = lambda data, handle: json.dump(data, handle)

    sys.modules.update({'decky': decky, 'settings': settings, 'helpers': helpers, 'vdf': vdf})
    spec = importlib.util.spec_from_file_location('gameartwork_main', ROOT / 'main.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.main = _load_main(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _plugin(self):
        plugin = self.main.Plugin()
        plugin.settings = _FakeSettings()
        plugin._cache = {}
        plugin._cache_saved_at = time.time()
        return plugin

    def test_version_tuple(self):
        self.assertEqual(self.main.version_tuple('v2.10.0'), (2, 10, 0))
        self.assertEqual(self.main.version_tuple(''), (0,))
        self.assertGreater(self.main.version_tuple('2.10.0'), self.main.version_tuple('2.9.9'))

    def test_empty_answer_expires_after_a_few_minutes(self):
        plugin = self._plugin()
        plugin._cache_set('search', [])
        plugin._cache['search'] = (time.time() - 6 * 60, [])
        self.assertIsNone(plugin._cache_get('search'))
        self.assertIsNone(plugin._stale_or_none('search'))

        plugin._cache['search'] = (time.time() - 60, [])
        self.assertEqual(plugin._cache_get('search'), [])

    def test_real_answer_lives_for_hours(self):
        plugin = self._plugin()
        plugin._cache_set('search', [{'name': 'Celeste'}])
        plugin._cache['search'] = (time.time() - 6 * 60 * 60 - 60, [{'name': 'Celeste'}])
        self.assertIsNone(plugin._cache_get('search'))
        self.assertEqual(plugin._stale_or_none('search'), [{'name': 'Celeste'}])

    def test_cache_evicts_the_oldest_instead_of_everything(self):
        plugin = self._plugin()
        limit = plugin.CACHE_LIMIT
        for index in range(limit):
            plugin._cache['key%d' % index] = (time.time() + index, 'value')
        plugin._cache_set('new', 'value')
        self.assertEqual(len(plugin._cache), limit)
        self.assertIn('new', plugin._cache)
        self.assertIn('key%d' % (limit - 1), plugin._cache)
        self.assertNotIn('key0', plugin._cache)

    def test_cache_file_roundtrip(self):
        plugin = self._plugin()
        plugin._cache_set('search', [{'name': 'Celeste'}])
        plugin._save_cache(force=True)
        reloaded = plugin._load_cache()
        self.assertEqual(reloaded['search'][1], [{'name': 'Celeste'}])


class SettingsBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.main = _load_main(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.plugin = self.main.Plugin()
        self.plugin.settings = _FakeSettings()
        self.plugin._cache = {}
        self.plugin._cache_saved_at = time.time()
        self.plugin.settings.settings.update({
            'nonsteam_1': {'id': 1, 'name': 'Celeste'},
            'filters_grid_p': {'styles': ['alternate']},
            'sgdb_api_key': 'SECRET',
            'igdb_client_secret': 'SECRET',
            'unrelated': 1,
        })

    def test_snapshot_skips_credentials(self):
        snapshot = self.plugin._settings_snapshot()
        self.assertIn('nonsteam_1', snapshot)
        self.assertIn('filters_grid_p', snapshot)
        self.assertNotIn('sgdb_api_key', snapshot)
        self.assertNotIn('igdb_client_secret', snapshot)
        self.assertNotIn('unrelated', snapshot)

    def test_import_commits_once_and_never_restores_secrets(self):
        import asyncio
        exported = asyncio.run(self.plugin.export_settings())
        self.assertTrue(exported['ok'])

        with open(exported['path'], encoding='utf-8') as handle:
            payload = json.load(handle)
        payload['settings']['sgdb_api_key'] = 'OLD'
        with open(exported['path'], 'w', encoding='utf-8') as handle:
            json.dump(payload, handle)

        self.plugin.settings.settings.clear()
        self.plugin.settings.commits = 0
        result = asyncio.run(self.plugin.import_settings(''))
        self.assertTrue(result['ok'])
        self.assertEqual(self.plugin.settings.commits, 1)
        self.assertIn('nonsteam_1', self.plugin.settings.settings)
        self.assertNotIn('sgdb_api_key', self.plugin.settings.settings)

    def test_import_rejects_a_path_outside_the_backup_dir(self):
        import asyncio
        outside = Path(self.tmp.name) / 'outside.json'
        outside.write_text('{"settings": {}}', encoding='utf-8')
        result = asyncio.run(self.plugin.import_settings(str(outside)))
        self.assertFalse(result['ok'])


class CustomArtworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.main = _load_main(cls.tmp.name)
        cls.steam = Path(cls.tmp.name) / '.local' / 'share' / 'Steam'
        grid = cls.steam / 'userdata' / '123' / 'config' / 'grid'
        grid.mkdir(parents=True, exist_ok=True)
        for name in ('100.png', '100p.png', '100_hero.webp', '100_logo.png', '100_icon.ico'):
            (grid / name).write_bytes(b'x')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_reads_the_grid_dir(self):
        import asyncio
        plugin = self.main.Plugin()
        plugin.settings = _FakeSettings()
        plugin._cache = {}
        plugin._cache_saved_at = time.time()
        state = asyncio.run(plugin.custom_artwork_state(100, '123'))
        self.assertTrue(all(state.values()), state)

        missing = asyncio.run(plugin.custom_artwork_state(200, '123'))
        self.assertFalse(any(missing.values()), missing)


if __name__ == '__main__':
    unittest.main()
