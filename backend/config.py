"""Central configuration. Every hard cap lives here, nowhere else.

The traversal caps exist because a single query against a high-traffic address
fans out to thousands of API calls and hangs the demo. They are written here
before the BFS that uses them, on purpose.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FIXTURES_DIR = BASE_DIR / "fixtures"
CACHE_DIR = BASE_DIR / ".cache"

for _d in (DATA_DIR, FIXTURES_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- Modes -------------------------------------------------------------
# OFFLINE_MODE=1 serves only from fixtures/, makes zero network calls.
# This is how you present on Thursday unless the network is proven good.
OFFLINE_MODE = os.getenv("OFFLINE_MODE", "0") == "1"

# --- Traversal caps (enforced in graph.py, no exceptions) --------------
MAX_HOPS = 2
MAX_NEIGHBORS_PER_NODE = 25
MAX_TOTAL_NODES = 150
MAX_API_CALLS_PER_ANALYSIS = 40
TRAVERSAL_TIMEOUT_SECONDS = 20.0

# --- Blockchain API ----------------------------------------------------
# mempool.space and blockstream.info both speak Esplora. Same paths, so the
# fallback is a one-line base-URL swap.
CHAIN_API_BASE = os.getenv("CHAIN_API_BASE", "https://mempool.space/api")
CHAIN_API_FALLBACK = "https://blockstream.info/api"
CHAIN_REQUEST_DELAY = 0.2  # seconds between calls; be polite, stay unbanned
CHAIN_TIMEOUT = 10.0
MAX_TXS_PER_ADDRESS = 50  # Esplora returns 25/page; 2 pages is plenty

SATS_PER_BTC = 100_000_000

# --- Data source URLs --------------------------------------------------
OFAC_XBT_URL = (
    "https://raw.githubusercontent.com/0xB10C/"
    "ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt"
)
OFAC_ETH_URL = (
    "https://raw.githubusercontent.com/0xB10C/"
    "ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt"
)
OFAC_SDN_URL = (
    "https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-"
    "sdn-human-readable-lists"
)

RANSOMWHERE_EXPORT_URL = "https://api.ransomwhe.re/export"
RANSOMWHERE_ZENODO_URL = "https://zenodo.org/records/13999026"

# ransomware.live anonymous tier is rate-limited to 1 request/min per endpoint.
# We therefore snapshot group profiles at build time and never call it live.
RANSOMWARE_LIVE_BASE = "https://api.ransomware.live/v2"

# --- Scoring bands (frontend owns weighting; these are for reference) ---
BANDS = [(0, 24, "Low"), (25, 49, "Moderate"), (50, 74, "Elevated"), (75, 100, "High")]
