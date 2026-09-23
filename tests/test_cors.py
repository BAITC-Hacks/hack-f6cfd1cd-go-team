import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.catalog import CatalogStore
from backend.config import Settings
from backend.main import app


class CorsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        settings = Settings(_env_file=None, catalog_db_path=Path(directory.name) / 'catalog.sqlite3')
        # Schema exists, but no successful sync. Never touch the real catalogue.
        CatalogStore(settings.catalog_db_path).initialize()
        settings_patch = patch('backend.main.Settings', return_value=settings)
        settings_patch.start()
        self.addCleanup(settings_patch.stop)
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_allowed_origin_get_and_unsynced_response(self):
        response = self.client.get('/api/products/search?q=200300285_',
                                   headers={'Origin': 'http://127.0.0.1:5173'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'detail': 'Каталог ещё не синхронизирован. Выполните python -m backend.sync_catalog.'})
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://127.0.0.1:5173')
        self.assertNotIn('access-control-allow-credentials', response.headers)

    def test_preflight_allows_get_only(self):
        for method, expected in [('GET', 200), ('POST', 400)]:
            response = self.client.options('/api/products/search', headers={
                'Origin': 'http://127.0.0.1:5173',
                'Access-Control-Request-Method': method,
            })
            self.assertEqual(response.status_code, expected)
            self.assertEqual(response.headers['access-control-allow-methods'], 'GET')

    def test_other_origins_are_not_allowed(self):
        for origin in ['http://localhost:5173', 'https://example.test']:
            response = self.client.options('/api/products/search', headers={
                'Origin': origin, 'Access-Control-Request-Method': 'GET',
            })
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('access-control-allow-origin', response.headers)
