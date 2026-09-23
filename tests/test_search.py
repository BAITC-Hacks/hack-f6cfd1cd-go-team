import unittest

import httpx

import test_backend


class SearchTests(unittest.TestCase):
    # Reuse the existing in-process request helper and isolated settings.
    setUp = test_backend.BackendTests.setUp
    request = test_backend.BackendTests.request

    def search(self, query, pages):
        self.requested_pages = []

        def handler(request):
            self.assertEqual(request.url.path, '/api/products')
            self.assertEqual(set(request.url.params), {'page'})
            page = int(request.url.params['page'])
            self.requested_pages.append(page)
            items = pages.get(page, [])
            return httpx.Response(200, json={'page': page, 'per_page': 20,
                                           'count': len(items), 'items': items})
        return self.request('/api/products/search?q=' + query, handler)

    def test_exact_article_on_later_page_has_priority(self):
        partial = {'id': 1, 'name': 'Cable', 'article': 'ABC-123-extra'}
        exact = {'id': 2, 'name': 'Other', 'article': 'ABC-123', 'price': 50}
        response = self.search('%20abc-123%20', {1: [partial], 2: [exact]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'], [exact])
        self.assertEqual(response.json()['match_type'], 'exact_article')
        self.assertFalse(response.json()['catalog_complete'])
        self.assertEqual(self.requested_pages, [1, 2])

    def test_name_search_across_pages_and_wraparound(self):
        first = {'id': 1, 'name': 'Лампа LED', 'article': '001-A'}
        second = {'id': 2, 'name': 'ЛАМПА 30W', 'article': '002-A'}
        response = self.search('лампа', {1: [first], 2: [second], 3: [first]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'], [first, second])
        self.assertTrue(response.json()['catalog_complete'])
        self.assertEqual(response.json()['pages_scanned'], 2)
        self.assertEqual(self.requested_pages, [1, 2, 3])

    def test_article_substring_and_no_duplicate_ids(self):
        item = {'id': 1, 'name': 'Cable', 'article': '001-AbC'}
        other = {'id': 2, 'name': 'Other', 'article': 'xyz'}
        response = self.search('abc', {1: [item], 2: [item, other]})
        self.assertEqual(response.json()['items'], [item])
        self.assertEqual(self.requested_pages, [1, 2, 3])

    def test_no_matches_and_empty_catalog(self):
        for pages in [{}, {1: [{'id': 1, 'name': 'Cable', 'article': '001'}]}]:
            response = self.search('absent', pages)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['count'], 0)
            self.assertTrue(response.json()['catalog_complete'])

    def test_invalid_search_never_calls_ekt(self):
        for suffix in ['', '?q=', '?q=%20%20', '?q=' + 'a' * 201]:
            response = self.request('/api/products/search' + suffix,
                                    lambda r: self.fail('Unexpected upstream request'))
            self.assertEqual(response.status_code, 422)

    def test_later_page_failure_is_not_partial_success(self):
        def handler(request):
            if request.url.params['page'] == '1':
                return httpx.Response(200, json={'items': [
                    {'id': 1, 'name': 'Cable', 'article': '001'}]})
            return httpx.Response(500, text='private upstream body')
        response = self.request('/api/products/search?q=cable', handler)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('private', response.text)

    def test_unexpected_page_or_product_schema(self):
        for data in [[], {}, {'items': None}, {'items': [None]},
                     {'items': [{'id': 1, 'name': 'Cable'}]}]:
            response = self.request('/api/products/search?q=cable',
                                    lambda r: httpx.Response(200, json=data))
            self.assertEqual(response.status_code, 502)

    def test_repeated_nonfirst_page_is_error(self):
        first = {'id': 1, 'name': 'One', 'article': '001'}
        second = {'id': 2, 'name': 'Two', 'article': '002'}
        response = self.search('absent', {1: [first], 2: [second], 3: [second]})
        self.assertEqual(response.status_code, 502)
