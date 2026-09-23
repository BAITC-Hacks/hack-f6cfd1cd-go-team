import unittest
from unittest.mock import AsyncMock, Mock

from backend.chat import ChatError, ChatRequest, ChatService
from backend.ekt_service import EktError


class FallbackTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.catalog = Mock()
        self.catalog.search.side_effect = lambda query: {'items': [
            {'id': 42, 'article': 'ABC-123_', 'price': 1}] if query == 'abc-123_' else []}
        self.ekt = Mock()
        self.ekt.get_product_detail = AsyncMock(return_value={
            'id': 42, 'name': 'Реальное имя', 'article': 'ABC-123_', 'price': 999, 'quantity': 4})
        self.service = ChatService(None, 'gpt-5.6-luna', self.catalog, self.ekt)

    async def test_exact_article_in_sentence_uses_fresh_detail(self):
        result = await self.service.reply(ChatRequest(message='Есть ли товар «ABC-123_» в наличии?'))
        self.assertEqual(result['mode'], 'fallback')
        self.assertIn('Цена: 999.', result['message'])
        self.assertIn('Остаток: 4.', result['message'])
        self.ekt.get_product_detail.assert_awaited_once_with(42)
        self.assertEqual(result['products'][0]['price'], 999)
        follow = await self.service.reply(ChatRequest(message='ABC-123_', session_id=result['session_id']))
        self.assertEqual(follow['session_id'], result['session_id'])

    async def test_no_match_and_no_partial_match(self):
        self.catalog.search.side_effect = None
        self.catalog.search.return_value = {'items': [{'id': 42, 'article': 'ABC-123_extra'}]}
        result = await self.service.reply(ChatRequest(message='ABC-123_'))
        self.assertEqual(result['products'], [])
        self.assertIn('не найден', result['message'])
        self.ekt.get_product_detail.assert_not_called()

    async def test_missing_values_and_zero_are_distinct(self):
        for data in [{'id': 42}, {'id': 42, 'price': 0, 'quantity': 0}]:
            self.ekt.get_product_detail.return_value = data
            result = await self.service.reply(ChatRequest(message='ABC-123_'))
            if 'price' in data:
                self.assertIn('Цена: 0.', result['message'])
                self.assertIn('Остаток: 0.', result['message'])
            else:
                self.assertIn('Цена не указана', result['message'])
                self.assertIn('остатке не указаны', result['message'])
                self.assertIsNone(result['products'][0]['quantity'])

    async def test_ambiguous_does_not_choose_product(self):
        self.catalog.search.side_effect = None
        self.catalog.search.return_value = {'items': [{'id': i, 'article': 'ABC'} for i in (1, 2)]}
        result = await self.service.reply(ChatRequest(message='ABC'))
        self.assertIn('несколько', result['message'])
        self.ekt.get_product_detail.assert_not_called()

    async def test_ekt_failure_is_not_replaced_by_sqlite_price(self):
        self.ekt.get_product_detail.side_effect = EktError(504, 'Таймаут EKT')
        with self.assertRaises(ChatError) as error:
            await self.service.reply(ChatRequest(message='ABC-123_'))
        self.assertEqual(error.exception.code, 'catalog_error')
        self.assertEqual(error.exception.status, 504)
