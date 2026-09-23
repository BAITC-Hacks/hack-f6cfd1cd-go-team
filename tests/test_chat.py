import asyncio
import copy
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
import openai
from fastapi.testclient import TestClient
from openai.types.responses import Response, ResponseFunctionToolCall

from backend.chat import ChatError, ChatRequest, ChatService, INSTRUCTIONS, TOOLS
from backend.config import Settings
from backend.ekt_service import EktError
from backend.main import app


def answer(text='По данным EKT цена 123, остаток 7.'):
    return Response.model_validate(dict(id='resp_test', created_at=0, model='gpt-5.6-luna',
        object='response', status='completed', parallel_tool_calls=False, tool_choice='auto', tools=[],
        output=[{'type': 'message', 'id': 'msg_test', 'role': 'assistant', 'status': 'completed',
                 'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}]))


def call(name, **arguments):
    response = answer()
    return response.model_copy(update={'output': [
        ResponseFunctionToolCall(
            type='function_call', name=name, arguments=json.dumps(arguments),
            call_id='call_' + name)]})


class FakeLLM:
    def __init__(self, responses):
        self.queue = list(responses)
        self.requests = []
        self.responses = self

    async def create(self, **kwargs):
        self.requests.append(copy.deepcopy(kwargs))
        result = self.queue.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class ChatTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.catalog = Mock()
        self.catalog.search.return_value = {'items': [
            {'id': 42, 'name': 'Тест', 'article': 'ABC', 'price': 100}], 'count': 1}
        self.ekt = Mock()
        self.ekt.get_product_detail = AsyncMock(return_value={
            'id': 42, 'name': 'Тест', 'article': 'ABC', 'price': 123, 'quantity': 7,
            'properties': {'conflict': 'source value'}})

    def service(self, responses):
        llm = FakeLLM(responses)
        return ChatService(llm, 'gpt-5.6-luna', self.catalog, self.ekt), llm

    async def test_search_detail_response_and_followup(self):
        service, llm = self.service([call('search_products', query='ABC'),
                                    call('get_product_detail', product_id=42), answer(),
                                    call('get_product_detail', product_id=42), answer('Обновлено')])
        response = await service.reply(ChatRequest(message='Цена и наличие ABC?'))
        self.assertEqual(response['tools_used'], ['search_products', 'get_product_detail'])
        self.assertEqual(response['products'][0]['price'], 123)
        self.assertEqual(response['products'][0]['quantity'], 7)
        self.assertEqual(response['products'][0]['source'], 'ekt_detail')
        self.assertEqual(llm.requests[0]['model'], 'gpt-5.6-luna')
        self.assertFalse(llm.requests[0]['store'])
        detail_output = json.loads(llm.requests[2]['input'][-1]['output'])
        self.assertEqual(detail_output['properties'], {'conflict': 'source value'})
        await service.reply(ChatRequest(message='А сейчас?', session_id=response['session_id']))
        self.assertEqual(self.ekt.get_product_detail.await_count, 2)
        self.assertTrue(any(x.get('content') == 'Цена и наличие ABC?' for x in llm.requests[3]['input']))

    async def test_empty_search_and_bounded_results(self):
        self.catalog.search.return_value = {'items': [], 'count': 0}
        service, llm = self.service([call('search_products', query='none'), answer('Не найдено')])
        self.assertEqual((await service.reply(ChatRequest(message='none')))['products'], [])
        self.ekt.get_product_detail.assert_not_called()
        self.catalog.search.return_value = {'items': [{'id': i} for i in range(20)], 'count': 20}
        service, llm = self.service([call('search_products', query='all'), answer('Уточните')])
        response = await service.reply(ChatRequest(message='all'))
        self.assertEqual(len(response['products']), 10)
        self.assertTrue(json.loads(llm.requests[1]['input'][-1]['output'])['truncated'])

    async def test_unknown_tool_and_unseen_id_rejected(self):
        for tool in [call('change_cart'), call('get_product_detail', product_id=999),
                     call('search_products', query=' '), call('search_products', query=123)]:
            service, _ = self.service([tool])
            with self.assertRaises(ChatError) as error:
                await service.reply(ChatRequest(message='test'))
            self.assertEqual(error.exception.code, 'invalid_tool_call')
            self.assertEqual(service.sessions, {})
        self.ekt.get_product_detail.assert_not_called()

    async def test_catalog_failure_does_not_generate_answer(self):
        self.catalog.search.side_effect = EktError(503, 'Каталог не загружен')
        service, llm = self.service([call('search_products', query='ABC')])
        with self.assertRaises(ChatError) as error:
            await service.reply(ChatRequest(message='test'))
        self.assertEqual(error.exception.code, 'catalog_error')
        self.assertEqual(len(llm.requests), 1)

    async def test_model_unavailable_no_fallback_and_sanitized_errors(self):
        request = httpx.Request('POST', 'https://api.openai.com/v1/responses')
        cases = [(openai.NotFoundError('sensitive', response=httpx.Response(404, request=request), body=None), 'model_unavailable'),
                 (openai.AuthenticationError('sensitive', response=httpx.Response(401, request=request), body=None), 'openai_auth_error'),
                 (openai.RateLimitError('sensitive', response=httpx.Response(429, request=request), body=None), 'openai_rate_limit'),
                 (openai.APITimeoutError(request=request), 'openai_timeout')]
        for exc, code in cases:
            service, llm = self.service([exc])
            with self.assertRaises(ChatError) as error:
                await service.reply(ChatRequest(message='test'))
            self.assertEqual(error.exception.code, code)
            self.assertNotIn('sensitive', error.exception.message)
            self.assertEqual(len(llm.requests), 1)

    async def test_history_limit_expiry_and_isolation(self):
        service, llm = self.service([answer('hi') for _ in range(10)])
        first = await service.reply(ChatRequest(message='one'))
        second = await service.reply(ChatRequest(message='two'))
        self.assertNotEqual(first['session_id'], second['session_id'])
        self.assertEqual(len(llm.requests[1]['input']), 1)
        for _ in range(7):
            await service.reply(ChatRequest(message='follow', session_id=first['session_id']))
        self.assertEqual(len(service.sessions[first['session_id']].turns), 6)
        service.sessions[first['session_id']].touched -= 1801
        with self.assertRaises(ChatError) as error:
            await service.reply(ChatRequest(message='old', session_id=first['session_id']))
        self.assertEqual(error.exception.code, 'session_not_found')

    async def test_tool_loop_is_bounded(self):
        service, llm = self.service([call('search_products', query='ABC') for _ in range(10)])
        with self.assertRaises(ChatError) as error:
            await service.reply(ChatRequest(message='loop'))
        self.assertEqual(error.exception.code, 'tool_limit')
        self.assertEqual(len(llm.requests), 5)

    async def test_busy_session_rejected_and_capacity_bounded(self):
        service, _ = self.service([answer() for _ in range(3)])
        service.MAX_SESSIONS = 2
        first = await service.reply(ChatRequest(message='first'))
        service.sessions[first['session_id']].busy = True
        with self.assertRaises(ChatError) as error:
            await service.reply(ChatRequest(message='parallel', session_id=first['session_id']))
        self.assertEqual(error.exception.code, 'session_busy')
        service.sessions[first['session_id']].busy = False
        await service.reply(ChatRequest(message='second'))
        await service.reply(ChatRequest(message='third'))
        self.assertEqual(len(service.sessions), 2)
        self.assertNotIn(first['session_id'], service.sessions)

    async def test_instructions_and_tools_scope(self):
        self.assertEqual({t['name'] for t in TOOLS}, {'search_products', 'get_product_detail'})
        for term in ['сертификат', 'противоречат', 'корзину', 'собственные знания']:
            self.assertIn(term, INSTRUCTIONS)


class ChatHTTPTests(unittest.TestCase):
    def test_contract_validation_missing_key_and_cors(self):
        settings = Settings(_env_file=None, openai_api_key='')
        with patch('backend.main.Settings', return_value=settings), TestClient(app) as client:
            preflight = client.options('/api/chat', headers={
                'Origin': 'http://127.0.0.1:5173',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type'})
            self.assertEqual(preflight.status_code, 200)
            for body in [{}, {'message': ''}, {'message': ' '}, {'message': 'x'*2001},
                         {'message': 'test', 'session_id': 'invalid'}]:
                self.assertEqual(client.post('/api/chat', json=body).status_code, 422)
            response = client.post('/api/chat', json={'message': 'test'},
                                   headers={'Origin': 'http://127.0.0.1:5173'})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['error']['code'], 'openai_not_configured')
            self.assertEqual(response.headers['access-control-allow-origin'], 'http://127.0.0.1:5173')
            app.state.chat = ChatService(FakeLLM([answer('Здравствуйте')]), 'gpt-5.6-luna', Mock(), Mock())
            response = client.post('/api/chat', json={'message': 'Привет'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(set(response.json()), {'session_id', 'message', 'products', 'tools_used'})
