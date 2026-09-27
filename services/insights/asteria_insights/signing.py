"""Verifying a signed request, before anything is parsed.

The insights endpoints are public on the internet — they have to be, because the app that
calls them is serverless — so every request is signed with a shared secret. What is worth
being careful about is the *order* of operations, and the four mistakes this module is
written to avoid:

1. **Verifying after parsing.** Once a body has been through a JSON parser and back it is
   no longer the bytes that were signed. The raw body is read here, verified here, and only
   then handed to a model. A framework that parses a request body for you has already lost
   this argument, which is why ``main.py`` takes ``Request`` and not a Pydantic parameter.
2. **Comparing with ``==``.** Ordinary string comparison returns at the first differing
   byte, which leaks how much of a signature was correct. ``hmac.compare_digest`` does not.
3. **Signing only the body.** A signature over ``timestamp.body`` alone can be replayed
   against a *different endpoint* whose body happens to be compatible. The canonical string
   is ``timestamp.path.body``: freshness, destination and content, bound together.
4. **Trusting the clock.** A signature is valid forever without a timestamp, and a
   timestamp is meaningless without a window. Requests more than ``REPLAY_WINDOW_SECONDS``
   away from the server's clock are refused (Stripe uses 300; so does this).

A short-lived replay cache sits on top of that. It is honest about its limits: serverless
instances do not share memory, so it prevents a replay against a *warm* instance and
nothing more. The freshness window is the real protection.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from collections import OrderedDict

SIGNATURE_HEADER = "x-asteria-signature"
TIMESTAMP_HEADER = "x-asteria-timestamp"

# 5 minutes, the tolerance most signing schemes settle on: long enough to absorb clock
# drift and a cold start, short enough that a captured request is useless by dinner.
DEFAULT_WINDOW_SECONDS = 300

# Bodies are capped before the signature is even checked, so an unsigned multi-megabyte
# upload cannot be used to burn CPU hashing it. 500 moments at 420 characters is ~250 KB.
MAX_BODY_BYTES = 2 * 1024 * 1024

_REPLAY_CACHE: "OrderedDict[str, float]" = OrderedDict()
_REPLAY_CACHE_LIMIT = 512


class SignatureError(Exception):
    """A refused request, with a reason that is safe to return to the caller."""

    def __init__(self, reason: str, status: int = 401) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status = status


def secret() -> str | None:
    """The shared secret, or ``None`` when the service is running unconfigured."""
    value = os.environ.get("ASTERIA_INSIGHTS_SECRET", "").strip()
    return value or None


def window_seconds() -> int:
    raw = os.environ.get("ASTERIA_INSIGHTS_WINDOW_SECONDS", "").strip()
    if not raw:
        return DEFAULT_WINDOW_SECONDS
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_WINDOW_SECONDS


def canonical(timestamp: str, path: str, body: bytes) -> bytes:
    """``timestamp.path.body`` — the exact bytes both sides sign."""
    return b".".join((timestamp.encode(), path.encode(), body))


def sign(shared_secret: str, timestamp: str, path: str, body: bytes) -> str:
    return hmac.new(shared_secret.encode(), canonical(timestamp, path, body), hashlib.sha256).hexdigest()


def _remember(signature: str, now: float) -> None:
    _REPLAY_CACHE[signature] = now
    while len(_REPLAY_CACHE) > _REPLAY_CACHE_LIMIT:
        _REPLAY_CACHE.popitem(last=False)


def _seen_recently(signature: str, now: float, window: int) -> bool:
    # Drop anything older than the window as we go, so the cache cannot grow into a leak.
    for key, seen in list(_REPLAY_CACHE.items()):
        if now - seen > window:
            del _REPLAY_CACHE[key]
    return signature in _REPLAY_CACHE


def verify(
    *,
    path: str,
    body: bytes,
    signature: str | None,
    timestamp: str | None,
    shared_secret: str | None = None,
    now: float | None = None,
) -> None:
    """Raise :class:`SignatureError` unless the request is authentic, fresh and new."""
    shared_secret = shared_secret if shared_secret is not None else secret()
    if not shared_secret:
        # Refusing is the only safe answer: an unconfigured service that accepts anything
        # is a public compute endpoint, and "/health" already reports the misconfiguration.
        raise SignatureError("The insights service has no signing secret configured.", status=503)

    if len(body) > MAX_BODY_BYTES:
        raise SignatureError(f"The request body is larger than {MAX_BODY_BYTES} bytes.", status=413)

    if not signature or not timestamp:
        raise SignatureError("A signed request needs both a timestamp and a signature.")

    try:
        sent_at = float(timestamp)
    except ValueError as error:
        raise SignatureError("The timestamp header is not a number.") from error

    moment = now if now is not None else time.time()
    tolerance = window_seconds()
    if abs(moment - sent_at) > tolerance:
        raise SignatureError(f"The request is outside the {tolerance}s signing window.", status=401)

    expected = sign(shared_secret, timestamp, path, body)
    if not hmac.compare_digest(expected, signature):
        raise SignatureError("The signature does not match this request.")

    # Only now that the signature is proven do we spend memory on it.
    if _seen_recently(signature, moment, tolerance):
        raise SignatureError("This exact request has already been processed.")
    _remember(signature, moment)
