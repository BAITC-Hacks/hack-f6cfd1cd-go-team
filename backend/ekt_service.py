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

    async def search_products(self, query: str) -> dict:
        query = query.strip()
        if not query:
            raise EktError(422, "Поисковый запрос не должен быть пустым.")
        normalized = query.casefold()
        matches = []
        seen_ids = set()
        seen_pages = set()
        first_page = None

        # EKT ignores q and wraps out-of-range pages back to page one.
        # Never report an incomplete scan as an empty/successful full search.
        for page in range(1, 10001):
            data = await self.get_products(page)
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise EktError(502, "Неожиданная структура каталога EKT API.")
            items = data["items"]
            for item in items:
                if (not isinstance(item, dict)
                        or type(item.get("id")) is not int
                        or not isinstance(item.get("name"), str)
                        or not isinstance(item.get("article"), str)):
                    raise EktError(502, "Неожиданная структура товара EKT API.")

            signature = tuple(item["id"] for item in items)
            if not items or (page > 1 and signature == first_page):
                return {"query": query, "match_type": "substring", "count": len(matches),
                        "items": matches, "pages_scanned": page - 1,
                        "catalog_complete": True}
            if signature in seen_pages:
                raise EktError(502, "EKT API повторяет страницу: поиск не завершён.")
            if page == 1:
                first_page = signature
            seen_pages.add(signature)

            exact = [item for item in items if item["article"].strip().casefold() == normalized]
            if exact:
                # Article lookup does not need an internal product ID or a full scan.
                return {"query": query, "match_type": "exact_article", "count": len(exact),
                        "items": exact, "pages_scanned": page, "catalog_complete": False}

            for item in items:
                if item["id"] not in seen_ids and (
                    normalized in item["name"].casefold()
                    or normalized in item["article"].casefold()
                ):
                    matches.append(item)
                seen_ids.add(item["id"])

        raise EktError(502, "Достигнут защитный предел страниц EKT: поиск не завершён.")

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
