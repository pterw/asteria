"""Vercel entry point.

Vercel's Python runtime looks for an ASGI application named ``app`` in a file under ``api/``.
The implementation lives in the ``asteria_insights`` package next to this directory, so the
project root is put on ``sys.path`` explicitly rather than relying on how the runtime
happens to assemble the bundle — this way `uvicorn` (local), `pytest` (CI) and the deployed
function all import the same package by the same name.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from asteria_insights.main import app  # noqa: E402  (path set above, deliberately)

__all__ = ["app"]
