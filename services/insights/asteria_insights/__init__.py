"""Asteria's insights service: rhythm analytics and atlas rendering.

The app treats this service as an optimisation, never a dependency — every endpoint here has
an in-process equivalent in TypeScript, and a failure falls back to it silently. That design
is what makes it acceptable for the analytics to run somewhere else at all.
"""

from .atlas import render_atlas
from .analytics import compute_analytics

__all__ = ["compute_analytics", "render_atlas"]
