import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.catalog import CatalogStore
from backend.config import Settings
from backend.ekt_service import EktError, EktService
from backend.main import app
from backend.sync_catalog import sync_catalog


def item(id, name='Лампа LED', article='001-AbC', **extra):
    return dict(id=id, name=name, article=article, price=50, image=None,
                url='https://example.test/product', url_api_detail='https://example.test/detail', **extra)


class LocalCatalogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = CatalogStore(Path(self.directory.name) / 'catalog.sqlite3')

    def sync(self, pages, **kwargs):
        self.pages = []
        def handler(request):
            self.assertEqual(request.url.path, '/api/products')
            self.assertEqual(set(request.url.params), {'page'})
            page = int(request.url.params['page'])
            self.pages.append(page)
            value = pages.get(page, [])
            if isinstance(value, httpx.Response):
                return value
            return httpx.Response(200, json={'items': value})
        async def run():
            settings = Settings(_env_file=None, ekt_api_username='test', ekt_api_password='test')
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await sync_catalog(EktService(client, settings), self.store, **kwargs)
        with patch('backend.sync_catalog.asyncio.sleep', new_callable=AsyncMock):
            return asyncio.run(run())

    def test_sync_wraparound_deduplication_and_fields(self):
        a, b = item(1), item(2, article='002')
        result = self.sync({1: [a], 2: [a, b], 3: [a]})
        self.assertEqual((result['products'], result['pages']), (2, 2))
        self.assertEqual(self.pages, [1, 2, 3])
        self.assertEqual(self.store.search('лампа')['items'], [a, b])
        self.assertEqual(CatalogStore(self.store.path).search('001-abc')['items'], [a])

    def test_exact_article_priority_across_whole_catalog(self):
        a = item(1, article='001-AbC-extra')
        b, c = item(2), item(3)
        self.sync({1: [a], 2: [b, c]})
        result = self.store.search(' 001-aBc ')
        self.assertEqual(result['items'], [b, c])
        self.assertEqual(result['match_type'], 'exact_article')
        self.assertEqual(result['source'], 'sqlite')

    def test_unicode_casefold_and_literal_substrings(self):
        self.sync({1: [item(1, article='ЯРП_100%'), item(2, name='Кабель', article='other')]})
        self.assertEqual(self.store.search('ЛАМПА')['count'], 1)
        self.assertEqual(self.store.search('ярп_100%')['match_type'], 'exact_article')
        self.assertEqual(self.store.search('_')['count'], 1)
        self.assertEqual(self.store.search('%')['count'], 1)
        self.assertEqual(self.store.search("' OR 1=1 --")['count'], 0)
        self.assertEqual(self.store.search('absent')['count'], 0)

    def test_missing_and_empty_catalog_are_distinct(self):
        with self.assertRaises(EktError) as error:
            self.store.search('lamp')
        self.assertEqual(error.exception.status_code, 503)
        self.assertFalse(self.store.path.exists())
        self.sync({})
        self.assertEqual(self.store.search('lamp')['count'], 0)

    def test_failed_refresh_preserves_previous_snapshot(self):
        self.sync({1: [item(1)]})
        before = self.store.search('лампа')
        with self.assertRaises(EktError):
            self.sync({1: [item(2)], 2: httpx.Response(500)})
        self.assertEqual(self.store.search('лампа'), before)

    def test_refresh_updates_and_removes_old_products(self):
        self.sync({1: [item(1), item(2)]})
        self.sync({1: [item(2, name='Новое название')]})
        self.assertEqual(self.store.search('лампа')['count'], 0)
        self.assertEqual(self.store.search('новое')['items'][0]['id'], 2)

    def test_bad_schema_repeated_page_and_limit_roll_back(self):
        for pages, kwargs in [({1: [None]}, {}),
                              ({1: [item(1)], 2: [item(2)], 3: [item(2)]}, {}),
                              ({1: [item(1)], 2: [item(2)]}, {'max_pages': 2})]:
            with self.subTest(pages=pages):
                with self.assertRaises(EktError):
                    self.sync(pages, **kwargs)
                with self.assertRaises(EktError):
                    self.store.search('lamp')

    def test_readers_see_old_snapshot_until_commit(self):
        self.sync({1: [item(1)]})
        before = self.store.search('лампа')
        self.sync({1: [item(2)]}, progress=lambda _: self.assertEqual(self.store.search('лампа'), before))
        self.assertEqual(self.store.search('лампа')['items'][0]['id'], 2)

    def test_http_search_never_uses_ekt_or_detail(self):
        self.sync({1: [item(1)]})
        settings = Settings(_env_file=None, catalog_db_path=self.store.path,
                            ekt_api_username='', ekt_api_password='')
        with patch('backend.main.Settings', return_value=settings):
            with TestClient(app) as client, patch.object(EktService, '_get',
                    side_effect=AssertionError('Search must not use the network')):
                for q in ['ЛАМПА', '001-abc', 'missing']:
                    response = client.get('/api/products/search', params={'q': q})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['pages_scanned'], 0)
                for params in [{}, {'q': ''}, {'q': '  '}, {'q': 'x' * 201}]:
                    self.assertEqual(client.get('/api/products/search', params=params).status_code, 422)

    def test_transient_error_retries_same_page(self):
        service = AsyncMock()
        service.get_products.side_effect = [EktError(504, 'timeout'),
                                           {'items': [item(1)]}, {'items': []}]
        with patch('backend.sync_catalog.asyncio.sleep', new_callable=AsyncMock):
            result = asyncio.run(sync_catalog(service, self.store))
        self.assertEqual(result['products'], 1)
        self.assertEqual([call.args[0] for call in service.get_products.call_args_list], [1, 1, 2])

    def test_cancellation_rolls_back(self):
        self.sync({1: [item(1)]})
        before = self.store.search('лампа')
        service = AsyncMock()
        service.get_products.side_effect = [{'items': [item(2)]}, asyncio.CancelledError()]
        with self.assertRaises(asyncio.CancelledError):
            asyncio.run(sync_catalog(service, self.store))
        self.assertEqual(self.store.search('лампа'), before)
