# Asteria insights

The Python half of Asteria: rhythm analytics and the printable atlas.

It is deliberately small — FastAPI, Pydantic, nothing else — and deliberately optional. Every
number it computes has an in-process TypeScript equivalent (`src/lib/analytics.ts`,
`src/lib/export.ts`), and the app falls back to that the moment this service is unreachable.
That is a design decision, not a compromise: a journal that refuses to show a writer their own
data because a second process is cold is a worse product than a journal that answers slightly
more slowly.

The parity is not a hope. Both implementations read the same fixtures
(`contract/analytics.json`), and both suites assert against them: `npm run test:unit` on the
TypeScript side, `pytest` here. If the two ever disagree, the contract test says so.

## Endpoints

| Method | Path        | Purpose                                                        |
| ------ | ----------- | -------------------------------------------------------------- |
| `GET`  | `/health`   | Liveness, service version, and whether signing is configured.   |
| `POST` | `/insights` | Rhythm analytics for a journal.                                 |
| `POST` | `/atlas`    | The whole journal as one self-contained HTML document.          |

`/insights` and `/atlas` are signed. `/health` is not, because it returns nothing worth
protecting and a health check that needs a secret is a health check that fails at 3am for the
wrong reason.

## The signing contract

Every signed request carries two headers:

```
x-asteria-timestamp: 2026-03-06T22:30:00.000Z
x-asteria-signature: <hex HMAC-SHA256>
```

The signature is `HMAC-SHA256(secret, timestamp + "." + path + "." + body)`, hex-encoded, where
`body` is the **raw request body bytes** — not a re-serialised object. Key order, whitespace and
Unicode escapes all differ between encoders, so a signature over a parsed-then-encoded body
fails the moment either side changes a serialiser. The path is in the canonical string so a
captured request cannot be replayed against a different endpoint.

Verification happens before the body is parsed, which is why the handlers take `Request` rather
than a Pydantic parameter: a framework that validates the body for you has already consumed it.
Requests with a timestamp more than 300 seconds from ours are refused, and identical signatures
inside that window are refused a second time from a small in-process replay cache.

`src/lib/insights-service.ts` is the client. Both sides of this contract are covered by tests —
`tests/test_api.py` here and `tests/unit/analytics.contract.test.ts` on the TypeScript side — and
a change to the canonical string must change both.

## Privacy

Moments arrive as metadata only: `id`, `mood`, `intensity`, `createdAt`, `favorite`, `isSample`.
Never titles, never words. The atlas request does carry the writing, because the atlas *is* the
writing, and that request is signed and answered with `cache-control: no-store`.

## Running it

```bash
npm run insights:install        # creates .venv and installs requirements-dev.txt
npm run insights:dev            # uvicorn on http://127.0.0.1:8000
python3 -m pytest services/insights -q
```

To let the app use it, point the Next.js process at it with a shared secret:

```bash
ASTERIA_INSIGHTS_URL=http://127.0.0.1:8000
ASTERIA_INSIGHTS_SECRET=<same value in both processes>
```

With `ASTERIA_INSIGHTS_SECRET` unset the service reports `status: "unconfigured"` on
`/health` and refuses every signed request — an unsigned insights endpoint in production would
let anyone with the URL render a journal's atlas.

## Deploying it

This directory is its own Vercel project, not a subdirectory of the Next.js one:

1. **Add a project** → import this repository → set **Root Directory** to `services/insights`.
   Vercel detects FastAPI from `requirements.txt` and finds `api/index.py`, which exports `app`.
2. Set `ASTERIA_INSIGHTS_SECRET` in the project's environment variables.
3. Deploy, then give the value to the Next.js project as `ASTERIA_INSIGHTS_URL` (the
   deployment URL) and the same secret — the two projects share one secret and nothing else.

`.python-version` pins 3.12, which is Vercel's default and the version the tests run on.

The service has no database and no state: it is a pure function of its request, which is what
makes it safe to scale to zero.
