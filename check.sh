#!/usr/bin/env bash
# Everything that has to pass before this is demoable.
set -euo pipefail
cd "$(dirname "$0")"

echo "── backend tests ─────────────────────────────────────────"
( cd backend && python -m pytest tests/ -q )

echo
echo "── frontend tests ────────────────────────────────────────"
( cd frontend && npm test 2>&1 | tail -8 )

echo
echo "── scoring: python reference vs javascript ───────────────"
python tools/check_scoring_parity.py

echo
echo "── frontend build ────────────────────────────────────────"
( cd frontend && npm run build 2>&1 | tail -3 )
