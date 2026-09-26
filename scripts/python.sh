#!/usr/bin/env sh
# Run Python with the right interpreter, whichever way this checkout is set up.
#
# The insights service has its dependencies in `services/insights/requirements.txt`. Locally
# they live in `.venv` (`npm run insights:install`); in CI they are installed into the runner's
# interpreter. Checking the filesystem rather than the environment means `npm test` behaves the
# same on a laptop and on a build agent, and — more importantly — does not silently run the
# suite against an interpreter with no FastAPI in it and call the resulting import error a
# failure of the code.
set -e

if [ -x .venv/bin/python ]; then
  exec .venv/bin/python "$@"
fi
exec python3 "$@"
