"""Offline /api/chat harness: only the LLM boundary and EKT HTTP are mocked."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from openai.types.responses import Response, ResponseFunctionToolCall
from starlette.datastructures import State

from backend.catalog import CatalogStore
from backend.chat import ChatService
from backend.config import Settings
from backend.ekt_service import EktService
from backend.main import app
from backend.sync_catalog import sync_catalog
from qa.chat_cases import SOURCE, SOURCE_ID


def answer(text="Ответ тестовой модели."):
    return Response.model_validate({
        "id": "qa-response", "created_at": 0, "model": "qa-no-paid-llm",
        "object": "response", "status": "completed", "parallel_tool_calls": False,
        "tool_choice": "auto", "tools": [], "output": [{
            "type": "message", "id": "qa-message", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []}],
        }],
    })


def call(name, **args):
    return answer().model_copy(update={"output": [ResponseFunctionToolCall(
        type="function_call", name=name, arguments=json.dumps(args), call_id="qa-" + name)]})


def lookup(query="200300285_", product_id=SOURCE_ID):
    return [call("search_products", query=query), call("get_product_detail", product_id=product_id), answer()]


class ScriptedLLM:
    def __init__(self, responses=()):
        self.queue = list(responses)
        self.requests = []
        self.responses = self

    async def create(self, **kwargs):
        self.requests.append(copy.deepcopy(kwargs))
        if not self.queue:
            raise AssertionError("Unplanned LLM call: no live provider is allowed")
        response = self.queue.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class ChatHarness(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Fail closed if any code accidentally bypasses our Mock/ASGI transports.
        async def deny_network(*args, **kwargs):
            raise AssertionError("External network disabled in QA")
        net = patch.object(httpx.AsyncHTTPTransport, "handle_async_request", deny_network)
        net.start()
        self.addCleanup(net.stop)
        environment = patch.dict("os.environ", {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.catalog = CatalogStore(Path(directory.name) / "catalog.sqlite3")
        self.details = {SOURCE_ID: copy.deepcopy(SOURCE)}
        self.detail_reads = []
        self.ekt_requests = []
        self.seed_rows = [dict(copy.deepcopy(SOURCE), price=90)]
        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(self.ekt_handler))
        self.addAsyncCleanup(self.upstream.aclose)
        settings = Settings(_env_file=None, ekt_api_base_url="https://ekt.test/api",
                            ekt_api_username="qa-user", ekt_api_password="qa-secret",
                            openai_api_key="", catalog_db_path=self.catalog.path)
        self.ekt = EktService(self.upstream, settings)
        await self.seed(self.seed_rows)
        self.ekt_requests.clear()
        self.search_spy = patch.object(self.catalog, "search", wraps=self.catalog.search)
        self.search_calls = self.search_spy.start()
        self.addCleanup(self.search_spy.stop)
        old_state = app.state
        app.state = State({"catalog": self.catalog, "ekt_service": self.ekt})
        self.addCleanup(setattr, app, "state", old_state)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa.test")
        self.addAsyncCleanup(self.client.aclose)
        self.configure(None)

    def ekt_handler(self, request):
        self.ekt_requests.append(request)
        if request.method != "GET" or request.url.host != "ekt.test":
            raise AssertionError("Unexpected EKT request")
        if request.url.path == "/api/products":
            return httpx.Response(200, json={"items": self.seed_rows if request.url.params["page"] == "1" else []})
        if request.url.path != "/api/products/detail":
            raise AssertionError("Unexpected EKT path")
        product_id = int(request.url.params["id"])
        self.detail_reads.append(product_id)
        payload = self.details[product_id]
        if isinstance(payload, Exception):
            raise payload
        if isinstance(payload, httpx.Response):
            return payload
        return httpx.Response(200, json=copy.deepcopy(payload))

    async def seed(self, products):
        self.seed_rows = copy.deepcopy(products)
        await sync_catalog(self.ekt, self.catalog)

    def configure(self, script):
        self.llm = ScriptedLLM(script) if script is not None else None
        self.service = ChatService(self.llm, "qa-no-paid-llm", self.catalog, self.ekt)
        app.state.chat = self.service

    async def send(self, message, sid=None, status=200):
        body = {"message": message}
        if sid:
            body["session_id"] = sid
        response = await self.client.post("/api/chat", json=body)
        self.assertEqual(response.status_code, status, response.text)
        data = response.json()
        if status == 200:
            self.assertEqual(set(data), {"session_id", "message", "products", "analogs", "tools_used",
                                         "mode", "cart", "pending_confirmation"})
            self.assertEqual(data["cart"]["type"], "demo_session")
            self.assertNotIn("checkout_url", data)
            self.assertNotIn("qa-secret", response.text)
        return data

    def outputs(self):
        return [json.loads(item["output"]) for request in self.llm.requests
                for item in request["input"] if item.get("type") == "function_call_output"]

    def assert_empty_cart(self, data):
        self.assertEqual(data["cart"]["items"], [])

    def assert_detail(self, data):
        self.assertEqual(data["products"][0]["id"], SOURCE_ID)
        self.assertEqual(data["products"][0]["source"], "ekt_detail")
        self.assertEqual(self.detail_reads[-1], SOURCE_ID)
