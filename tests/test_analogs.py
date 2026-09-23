import unittest
from unittest.mock import Mock, AsyncMock

from backend.analogs import AnalogService
from backend.chat import ChatService, ChatRequest
from test_chat import FakeLLM, call, answer


class AnalogTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.source = {'id': 1, 'name': '***LED STARK 30W 4000K', 'article': 'SRC',
                       'quantity': 0, 'properties': {}}
        self.candidate = {'id': 2, 'name': 'LED STARK 30W 4000K', 'article': 'ALT',
                          'quantity': 8, 'properties': {}}
        self.catalog = Mock()
        self.catalog.search.return_value = {'items': [self.source, self.candidate], 'count': 2}
        self.ekt = Mock()
        self.ekt.get_product_detail = AsyncMock(return_value=self.candidate)
        self.service = AnalogService(self.catalog, self.ekt)

    async def test_zero_stock_source_available_analog(self):
        result = await self.service.find(self.source)
        self.assertEqual(result['items'][0]['quantity'], 8)
        self.assertIn('30w', result['items'][0]['explanation'])
        self.assertIn('не подтверждена', result['items'][0]['disclaimer'])
        self.ekt.get_product_detail.assert_awaited_once_with(2)

    async def test_no_candidate_or_candidate_without_stock(self):
        self.candidate['quantity'] = 0
        self.assertEqual((await self.service.find(self.source))['items'], [])
        self.catalog.search.return_value = {'items': []}
        self.assertEqual((await self.service.find(self.source))['items'], [])

    async def test_incomplete_properties_do_not_make_similar_names_reliable(self):
        self.candidate['name'] = 'LED STARK 50W 4000K'
        self.assertEqual((await self.service.find(self.source))['items'], [])

    async def test_conflicting_properties_rejected(self):
        self.source['properties'] = {'MOSHCHNOST_W': '30'}
        self.candidate['properties'] = {'MOSHCHNOST_W': '50'}
        self.assertEqual((await self.service.find(self.source))['items'], [])

    async def test_actual_properties_match_and_missing_property_rejected(self):
        self.source['name'] = 'LED светильник A'
        self.candidate['name'] = 'LED светильник B'
        props = {'MOSHCHNOST_W': '30', 'SVETOVOY_POTOK_LM': '2400', 'TSVETOVAYA_TEMPERATURA': '4000'}
        self.source['properties'] = props.copy()
        self.candidate['properties'] = props.copy()
        result = await self.service.find(self.source)
        self.assertEqual(result['items'][0]['matched_properties'], props)
        del self.candidate['properties']['MOSHCHNOST_W']
        self.assertEqual((await self.service.find(self.source))['items'], [])

    async def test_no_more_than_three_detail_calls(self):
        self.catalog.search.return_value = {'items': [{'id': i, 'name': 'LED STARK'} for i in range(2, 20)]}
        self.candidate['quantity'] = 0
        await self.service.find(self.source)
        self.assertEqual(self.ekt.get_product_detail.await_count, 3)

    async def test_chat_fallback_zero_stock_triggers_analogs(self):
        self.ekt.get_product_detail.side_effect = lambda id: self.source if id == 1 else self.candidate
        service = ChatService(None, 'gpt-5.6-luna', self.catalog, self.ekt)
        result = await service.reply(ChatRequest(message='SRC'))
        self.assertEqual(result['mode'], 'fallback')
        self.assertEqual(result['analogs'][0]['product']['id'], 2)
        self.assertEqual(result['products'][0]['quantity'], 0)

    async def test_openai_receives_analog_evidence(self):
        self.ekt.get_product_detail.side_effect = lambda id: self.source if id == 1 else self.candidate
        llm = FakeLLM([call('search_products', query='SRC'), call('get_product_detail', product_id=1), answer('Кандидат')])
        service = ChatService(llm, 'gpt-5.6-luna', self.catalog, self.ekt)
        result = await service.reply(ChatRequest(message='SRC'))
        self.assertEqual(result['analogs'][0]['product']['id'], 2)
        self.assertIn('analog_search', llm.requests[-1]['input'][-1]['output'])
