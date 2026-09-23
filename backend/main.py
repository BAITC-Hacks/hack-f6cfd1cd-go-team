from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.config import Settings
from backend.ekt_service import EktError, EktService
from backend.catalog import CatalogStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    app.state.catalog = CatalogStore(settings.catalog_db_path)
    async with httpx.AsyncClient() as client:
        app.state.ekt_service = EktService(client, settings)
        yield


app = FastAPI(title="EKT Catalog Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_credentials=False,
)


@app.exception_handler(EktError)
async def handle_ekt_error(request: Request, exc: EktError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/api/products")
async def products(request: Request, page: int = Query(default=1, ge=1)) -> Any:
    return await request.app.state.ekt_service.get_products(page)


@app.get("/api/products/detail")
async def product_detail(request: Request, id: int = Query(..., ge=1)) -> Any:
    return await request.app.state.ekt_service.get_product_detail(id)


@app.get("/api/products/search")
def product_search(request: Request, q: str = Query(..., min_length=1, max_length=200)) -> Any:
    return request.app.state.catalog.search(q)
