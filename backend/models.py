"""Pydantic models mirroring contract.md exactly.

If you change anything here, change contract.md in the same commit and tell Dev B
in the shared integration list. These models validate the response server-side,
so a contract violation fails loudly at the source instead of silently reaching
the browser.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

# The five categories are fixed forever. The frontend has a slider per category
# and colors the waterfall by category; adding a sixth breaks both.
Category = Literal[
    "sanctions",
    "ransomware",
    "obfuscation",
    "transaction_profile",
    "counterparty",
]

Confidence = Literal["high", "medium", "low"]


class Source(BaseModel):
    name: str
    url: str | None = None
    retrieved_at: str | None = None


class Signal(BaseModel):
    id: str
    category: Category
    label: str
    severity: int = Field(ge=0, le=100)
    confidence: Confidence
    explanation: str = Field(min_length=1)
    evidence: dict[str, Any] = Field(default_factory=dict)
    source: Source


class Profile(BaseModel):
    tx_count: int = 0
    total_received: float = 0.0
    total_sent: float = 0.0
    balance: float = 0.0
    window_txs: int = 0
    window_complete: bool = True
    window_first_seen: str | None = None
    window_last_seen: str | None = None
    window_received: float = 0.0
    window_sent: float = 0.0
    window_unique_senders: int = 0
    window_unique_recipients: int = 0
    window_active_days: int = 0


class GraphNode(BaseModel):
    id: str
    label: str
    type: Literal["target", "counterparty"]
    flags: list[str] = Field(default_factory=list)
    hop: int


class GraphEdge(BaseModel):
    source: str
    target: str
    value: float
    tx_hash: str
    timestamp: str | None = None


class Graph(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class TaintPath(BaseModel):
    target_flag: str
    hops: int
    path: list[str]
    bottleneck_value: float
    direction_sequence: list[Literal["in", "out"]] = Field(default_factory=list)
    tx_hashes: list[str] = Field(default_factory=list)


class SourceUsed(BaseModel):
    name: str
    records: int
    retrieved_at: str | None = None
    stale: bool | None = None


class AnalyzeRequest(BaseModel):
    # Deliberately permissive. Validation happens in the engine, which returns a
    # contract-shaped degraded response, rather than in FastAPI, which would
    # return a 422 with a completely different body shape that the frontend has
    # no code path for. One response shape, always.
    address: str = ""
    max_hops: int = 2


class AnalyzeResponse(BaseModel):
    address: str
    chain: str = "bitcoin"
    analyzed_at: str
    cached: bool = False
    degraded: bool = False
    profile: Profile
    signals: list[Signal] = Field(default_factory=list)
    graph: Graph = Field(default_factory=Graph)
    taint_paths: list[TaintPath] = Field(default_factory=list)
    sources_used: list[SourceUsed] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DemoAddress(BaseModel):
    address: str
    label: str
    expectation: str
    category: str


class HealthResponse(BaseModel):
    status: str
    offline_mode: bool
    sources: dict[str, Any]
