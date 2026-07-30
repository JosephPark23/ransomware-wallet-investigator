"""FastAPI application.

Contract rule that overrides every other consideration: /api/analyze never
returns a 5xx. Read the exception handler at the bottom before changing
anything in here.
"""

import json
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import engine
from config import DATA_DIR, OFFLINE_MODE
from models import AnalyzeRequest, AnalyzeResponse, DemoAddress, HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine.load_all_sources()
    status = engine.source_status()
    print("=" * 60)
    print(f"  Intel loaded  |  offline_mode={OFFLINE_MODE}")
    for name, info in status.items():
        print(f"    {name:18} {info}")
    print("=" * 60)
    yield


app = FastAPI(
    title="Explainable Ransomware Wallet Risk Enrichment",
    version="1.0.0",
    lifespan=lifespan,
)

# Vite dev server origins. Add the deploy origin here before demo day.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        offline_mode=OFFLINE_MODE,
        sources=engine.source_status(),
    )


@app.get("/api/demo", response_model=list[DemoAddress])
def demo():
    path = DATA_DIR / "demo_addresses.json"
    if not path.exists():
        return []
    try:
        return [DemoAddress(**d) for d in json.loads(path.read_text())]
    except (OSError, json.JSONDecodeError, TypeError):
        return []


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest):
    address = (request.address or "").strip()

    if not engine.is_valid_bitcoin_address(address):
        return engine.empty_response(
            address,
            "That does not look like a valid Bitcoin address. Expected a legacy "
            "address starting with 1 or 3, or a bech32 address starting with bc1.",
        )

    try:
        return engine.analyze(address, max_hops=request.max_hops)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return engine.empty_response(
            address, "Analysis failed unexpectedly; no results are available."
        )


@app.exception_handler(RequestValidationError)
async def malformed_request(request: Request, exc: RequestValidationError):
    """A malformed body must still come back in the contract shape.

    FastAPI's default 422 body is {"detail": [...]}, which shares no fields with
    AnalyzeResponse. The frontend would have to special-case it. It doesn't.
    """
    if request.url.path == "/api/analyze":
        return JSONResponse(
            status_code=200,
            content=engine.empty_response(
                "", "The request body was malformed; expected {\"address\": \"...\"}."
            ).model_dump(),
        )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(Exception)
async def never_5xx(request: Request, exc: Exception):
    """Last line of defence. A contract-shaped degraded response beats a stack trace."""
    traceback.print_exc()
    if request.url.path == "/api/analyze":
        return JSONResponse(
            status_code=200,
            content=engine.empty_response(
                "", f"Server error: {type(exc).__name__}."
            ).model_dump(),
        )
    return JSONResponse(status_code=500, content={"detail": str(exc)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
