"""The wire contract, in the service's own words.

These models describe what the app sends and what it is promised back. They are
deliberately permissive about *shape* and strict about *bounds*: an unknown field is
ignored rather than fatal (the app may send more than this version needs while both sides
are deployed), but a journal with more than ``MAX_MOMENTS`` in it is refused rather than
quietly truncated.

Sharing types between TypeScript and Python is not possible without a code generator, so
the agreement is enforced the way the analytics are: ``contract/fixtures.json`` is the
documented example, and both languages are asserted against it on every run.

Note what is *not* here: `title`, `content`. Nothing that holds a writer's words is part of
the analytics request, and `title` appears in the atlas request only because the document
is a printable copy of the journal the writer asked for.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .analytics import MOOD_KEYS

MAX_MOMENTS = 5_000
MAX_TITLE = 80
MAX_BODY = 420
MAX_TIME_ZONE = 64


class Moment(BaseModel):
    """Metadata only — never the writing."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default="", max_length=64)
    mood: str = Field(max_length=32)
    intensity: int = Field(default=3, ge=-100, le=100)
    createdAt: str | int | float = ""
    favorite: bool = False
    isSample: bool = False


class InsightsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    timeZone: str = "UTC"
    now: str | None = None
    includeExamples: bool = False
    moments: list[Moment] = Field(default_factory=list, max_length=MAX_MOMENTS)

    @field_validator("timeZone")
    @classmethod
    def _valid_time_zone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        if len(value) > MAX_TIME_ZONE:
            raise ValueError("timeZone is too long")
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"Unknown time zone: {value}") from error
        return value


class AtlasMoment(BaseModel):
    """A moment as the atlas draws it: the words, because the atlas is a copy of them."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default="", max_length=64)
    title: str = Field(default="", max_length=MAX_TITLE)
    content: str = Field(default="", max_length=MAX_BODY)
    mood: str = Field(max_length=32)
    intensity: int = Field(default=3, ge=-100, le=100)
    createdAt: str | int | float = ""
    favorite: bool = False
    x: float | None = None
    y: float | None = None


class AtlasRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    moments: list[AtlasMoment] = Field(default_factory=list, max_length=MAX_MOMENTS)
    timeZone: str = "UTC"
    title: str = Field(default="Your sky", max_length=MAX_TITLE)
    now: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "unconfigured"] = "ok"
    service: str = "asteria-insights"
    version: str = "1.0.0"
    signing: Literal["configured", "missing"] = "configured"
    uptimeSeconds: int = 0


def parse_now(value: str | None) -> datetime | None:
    """The caller's clock, if it sent a usable one."""
    from .analytics import parse_instant

    if not value:
        return None
    parsed = parse_instant(value)
    return parsed


def as_moment_dicts(moments: list[Any]) -> list[dict[str, Any]]:
    """Hand plain dicts to the analytics, so the ported module stays framework-free."""
    return [moment.model_dump() for moment in moments]
