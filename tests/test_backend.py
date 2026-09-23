import asyncio
import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.ekt_service import EktService
from backend.main import app


class BackendTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict("os.environ", {}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        self.settings = Settings(_env_file=None, ekt_api_username="test-user",
                                 ekt_api_password="test-password")

    def request(self, path, handler, settings=None):
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
                app.state.ekt_service = EktService(upstream, settings or self.settings)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                             base_url="http://backend.test") as client:
                    return await client.get(path)
        return asyncio.run(run())

    def test_forwarding_and_auth(self):
        for path, query in [("/api/products", "page=1"),
                            ("/api/products?page=2", "page=2"),
                            ("/api/products/detail?id=515291", "id=515291")]:
            with self.subTest(path=path):
                def handler(request):
                    self.assertEqual(request.method, "GET")
                    self.assertEqual(request.url.host, "ekt.kz")
                    self.assertEqual(request.url.path, path.split("?")[0])
                    self.assertEqual(request.url.query.decode(), query)
                    token = base64.b64encode(b"test-user:test-password").decode()
                    self.assertEqual(request.headers["Authorization"], f"Basic {token}")
                    return httpx.Response(200, json={"data": [{"id": 515291}]})
                response = self.request(path, handler)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"data": [{"id": 515291}]})

    def test_invalid_parameters(self):
        for path in ["/api/products?page=0", "/api/products?page=abc",
                     "/api/products/detail", "/api/products/detail?id=-1"]:
            response = self.request(path, lambda r: self.fail("Unexpected EKT request"))
            self.assertEqual(response.status_code, 422)

    def test_missing_credentials(self):
        response = self.request("/api/products", lambda r: self.fail("Unexpected EKT request"),
                                Settings(_env_file=None))
        self.assertEqual(response.status_code, 503)

    def test_status_errors_do_not_leak_upstream_body(self):
        for upstream, expected in [(401, 502), (403, 502), (404, 404),
                                   (429, 503), (500, 502), (302, 502)]:
            with self.subTest(status=upstream):
                response = self.request("/api/products", lambda r: httpx.Response(
                    upstream, text="sensitive-body", headers={"Location": "https://other.test"}))
                self.assertEqual(response.status_code, expected)
                self.assertNotIn("sensitive-body", response.text)
                self.assertNotIn("test-password", response.text)

    def test_network_errors(self):
        for error, expected in [(httpx.ReadTimeout, 504), (httpx.ConnectError, 502)]:
            def handler(request):
                raise error("sensitive-error", request=request)
            response = self.request("/api/products", handler)
            self.assertEqual(response.status_code, expected)
            self.assertNotIn("sensitive-error", response.text)

    def test_invalid_json(self):
        response = self.request("/api/products", lambda r: httpx.Response(200, text="<html/>"))
        self.assertEqual(response.status_code, 502)

    def test_sync_timeout_override_preserves_default_requests(self):
        async def run():
            for timeout, expected_read in [(None, 15.0),
                                           (httpx.Timeout(15, connect=5, read=60), 60.0)]:
                def handler(request):
                    self.assertEqual(request.extensions['timeout']['read'], expected_read)
                    self.assertEqual(request.extensions['timeout']['connect'], 5.0)
                    return httpx.Response(200, json={'items': []})
                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                    await EktService(client, self.settings, timeout=timeout).get_products()
        asyncio.run(run())

    def test_timeout_phase_is_reported_without_sensitive_details(self):
        for error, expected in [(httpx.ConnectTimeout, 'соединения'),
                                (httpx.ReadTimeout, 'ожидания ответа')]:
            def handler(request):
                raise error('sensitive-error', request=request)
            response = self.request('/api/products', handler)
            self.assertEqual(response.status_code, 504)
            self.assertIn(expected, response.json()['detail'])
            self.assertNotIn('sensitive-error', response.text)

    def test_dotenv_and_environment_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("EKT_API_BASE_URL=https://example.test/api\n"
                                "EKT_API_USERNAME=file-user\nEKT_API_PASSWORD=file-password\n")
            settings = Settings(_env_file=env_file)
            self.assertEqual(settings.ekt_api_username.get_secret_value(), "file-user")
            self.assertEqual(settings.ekt_api_password.get_secret_value(), "file-password")
            self.assertEqual(str(settings.ekt_api_base_url), "https://example.test/api")
            with patch.dict("os.environ", {"EKT_API_USERNAME": "env-user"}):
                self.assertEqual(Settings(_env_file=env_file).ekt_api_username.get_secret_value(),
                                 "env-user")

    def test_lifespan_and_docs(self):
        with patch("backend.main.Settings", return_value=Settings(_env_file=None)):
            with TestClient(app) as client:
                self.assertEqual(client.get("/docs").status_code, 200)
                self.assertEqual(client.get("/api/products").status_code, 503)
                upstream = app.state.ekt_service.client
            self.assertTrue(upstream.is_closed)
