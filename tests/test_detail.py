import unittest

import httpx

import test_backend


class DetailTests(unittest.TestCase):
    setUp = test_backend.BackendTests.setUp
    request = test_backend.BackendTests.request

    def test_full_card_is_forwarded_without_normalization(self):
        card = {
            'id': 515291, 'name': 'Test product', 'article': '0001_',
            'price': '64920.00', 'quantity': 23,
            'stores': [{'id': 13, 'name': 'Алматы', 'quantity': 5}],
            'properties': {'NOMINALNYY_TOK': '250 А', 'OTHER': ['one', 'two']},
            'description': 'Текст\r\nописания', 'image': None, 'offers': [],
            # Synthetic extra field: tests pass-through, not an EKT schema claim.
            'test_document': {'url': 'https://example.test/certificate.pdf'},
        }
        requests = []
        def handler(request):
            requests.append(str(request.url))
            return httpx.Response(200, json=card)
        for quantity in [23, 22]:
            card['quantity'] = quantity
            response = self.request('/api/products/detail?id=515291', handler)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), card)
        self.assertEqual(requests, ['https://ekt.kz/api/products/detail?id=515291'] * 2)

    def test_absent_fields_are_not_invented(self):
        card = {'id': 515291, 'name': 'Test'}
        response = self.request('/api/products/detail?id=515291',
                                lambda r: httpx.Response(200, json=card))
        self.assertEqual(response.json(), card)

    def test_malformed_or_wrong_card_is_not_success(self):
        for card in [None, [], {}, {'error': 'private'}, {'id': 123}, {'id': '515291'}]:
            response = self.request('/api/products/detail?id=515291',
                                    lambda r: httpx.Response(200, json=card))
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('private', response.text)

    def test_upstream_errors(self):
        for status, expected in [(401, 502), (403, 502), (404, 404), (429, 503), (500, 502)]:
            response = self.request('/api/products/detail?id=515291',
                                    lambda r: httpx.Response(status, text='private upstream body'))
            self.assertEqual(response.status_code, expected)
            self.assertNotIn('private', response.text)
        response = self.request('/api/products/detail?id=515291',
                                lambda r: httpx.Response(200, text='<html>error</html>'))
        self.assertEqual(response.status_code, 502)

    def test_timeout_and_missing_credentials(self):
        def timeout(request):
            raise httpx.ReadTimeout('private', request=request)
        self.assertEqual(self.request('/api/products/detail?id=515291', timeout).status_code, 504)
        from backend.config import Settings
        response = self.request('/api/products/detail?id=515291',
                                lambda r: self.fail('Unexpected EKT request'), Settings(_env_file=None))
        self.assertEqual(response.status_code, 503)
