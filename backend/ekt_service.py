from typing import Any

import httpx

from backend.config import Settings


class EktError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class EktService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client = client
        self.base_url = str(settings.ekt_api_base_url).rstrip("/")
        username = settings.ekt_api_username.get_secret_value()
        password = settings.ekt_api_password.get_secret_value()
        self.auth = httpx.BasicAuth(username, password) if username and password else None

    async def get_products(self, page: int = 1) -> Any:
        return await self._get("products", {"page": page})

    async def get_product_detail(self, product_id: int) -> Any:
        return await self._get("products/detail", {"id": product_id})

    async def _get(self, path: str, params: dict) -> Any:
        if self.auth is None:
            raise EktError(503, "Заполните EKT_API_USERNAME и EKT_API_PASSWORD в локальном .env.")
        try:
            response = await self.client.get(
                f"{self.base_url}/{path}", params=params, auth=self.auth,
                timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=False,
            )
            response.raise_for_status()
        except httpx.TimeoutException:
            raise EktError(504, "EKT API не ответил вовремя.") from None
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (401, 403):
                raise EktError(502, "EKT API отклонил авторизацию. Проверьте серверные credentials.") from None
            if status == 404:
                raise EktError(404, "Запрошенный ресурс не найден в EKT API.") from None
            if status == 429:
                raise EktError(503, "Превышен лимит запросов EKT API. Повторите позже.") from None
            raise EktError(502, "EKT API вернул ошибку или неожиданный HTTP-статус.") from None
        except httpx.RequestError:
            raise EktError(502, "Не удалось связаться с EKT API.") from None

        try:
            return response.json()
        except ValueError:
            raise EktError(502, "EKT API вернул некорректный JSON.") from None
