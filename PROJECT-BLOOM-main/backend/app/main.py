"""
Bloom backend entry point.

    uvicorn app.main:app --reload --port 8000

In development the React app runs on Vite (port 5173) and proxies /api here.
For a single-server deployment, build the frontend (npm run build) and this
app serves frontend/dist as well.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import realtime
from .config import BACKEND_DIR, settings
from .routers import (
    auth,
    designs,
    follows,
    friends,
    inbox,
    journal,
    live,
    media,
    notifications,
    profiles,
    projects,
    reactions,
    social,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bloom")


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    command.upgrade(config, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.auto_migrate:
        run_migrations()
    log.info("Bloom backend ready (env=%s, database=%s)", settings.env, settings.database_url.split("://")[0])
    yield


app = FastAPI(title="Bloom", version="2.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Bloom-Client", "Range"],
)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method in UNSAFE_METHODS:
        if request.headers.get("x-bloom-client") != "1":
            return JSONResponse({"detail": "Missing X-Bloom-Client header."}, status_code=403)
        content_type = (request.headers.get("content-type") or "").lower()
        if not content_type.startswith("multipart/form-data"):
            limit = settings.max_json_mb * 1024 * 1024
            try:
                content_length = int(request.headers.get("content-length") or 0)
            except ValueError:
                content_length = 0
            if content_length > limit:
                return JSONResponse({"detail": "Request payload is too large."}, status_code=413)
            body = await request.body()
            if len(body) > limit:
                return JSONResponse({"detail": "Request payload is too large."}, status_code=413)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
    return response


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


for module in (
    auth,
    designs,
    media,
    journal,
    friends,
    profiles,
    follows,
    reactions,
    notifications,
    social,
    projects,
    live,
    inbox,
    realtime,
):
    app.include_router(module.router)


dist: Path = settings.frontend_dist
if (dist / "index.html").exists():

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found."}, status_code=404)
        candidate = (dist / full_path).resolve()
        if full_path and dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")
