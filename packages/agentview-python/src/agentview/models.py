# Generated from Zod schemas in packages/agentview/src/apiTypes.ts
# To regenerate: pnpm run generate-models (then manual cleanup may be needed)

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _parse_datetime(value: Any) -> datetime:
    """Parse datetime from API which may use space instead of T."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        # Handle format like '2025-12-11 08:25:10.144334+00'
        # Convert to ISO format by replacing space with T and fixing timezone
        normalized = value.replace(" ", "T")
        if normalized.endswith("+00"):
            normalized = normalized + ":00"
        return datetime.fromisoformat(normalized)
    raise ValueError(f"Cannot parse datetime from {value}")


DateTime = Annotated[datetime, BeforeValidator(_parse_datetime)]


class Env(str, Enum):
    PRODUCTION = "production"
    PLAYGROUND = "playground"
    SHARED_PLAYGROUND = "shared-playground"


class Status(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class Role(str, Enum):
    ADMIN = "admin"
    USER = "user"


# --- User ---


class User(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    external_id: str | None = Field(default=None, alias="externalId")
    created_at: DateTime = Field(alias="createdAt")
    updated_at: DateTime = Field(alias="updatedAt")
    created_by: str | None = Field(default=None, alias="createdBy")
    env: Env
    token: str


class UserCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    external_id: str | None = Field(default=None, alias="externalId")
    env: Env | None = None


# --- Version ---


class Version(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    version: str
    created_at: DateTime = Field(alias="createdAt")


# --- Score ---


class Score(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    session_item_id: str = Field(alias="sessionItemId")
    name: str
    value: Any
    comment_id: str | None = Field(default=None, alias="commentId")
    created_by: str = Field(alias="createdBy")
    created_at: DateTime = Field(alias="createdAt")
    updated_at: DateTime = Field(alias="updatedAt")
    deleted_at: DateTime | None = Field(default=None, alias="deletedAt")
    deleted_by: str | None = Field(default=None, alias="deletedBy")


class ScoreCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    session_item_id: str = Field(alias="sessionItemId")
    name: str
    value: Any
    comment_id: str | None = Field(default=None, alias="commentId")


# --- CommentMessage ---


class CommentMessage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    user_id: str = Field(alias="userId")
    content: str | None = None
    created_at: DateTime = Field(alias="createdAt")
    updated_at: DateTime | None = Field(default=None, alias="updatedAt")
    deleted_at: DateTime | None = Field(default=None, alias="deletedAt")
    deleted_by: str | None = Field(default=None, alias="deletedBy")
    score: Score | None = None


# --- SessionItem ---


class SessionItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    created_at: DateTime = Field(alias="createdAt")
    updated_at: DateTime = Field(alias="updatedAt")
    content: Any
    run_id: str = Field(alias="runId")
    session_id: str = Field(alias="sessionId")


class SessionItemWithCollaboration(SessionItem):
    comment_messages: list[CommentMessage] = Field(alias="commentMessages")
    scores: list[Score]


# --- Run ---


class Run(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    created_at: DateTime = Field(alias="createdAt")
    finished_at: DateTime | None = Field(default=None, alias="finishedAt")
    status: str
    fail_reason: Any = Field(default=None, alias="reason")
    version: Version
    metadata: dict[str, Any] | None = None
    session_items: list[SessionItem] = Field(alias="sessionItems")
    session_id: str = Field(alias="sessionId")
    version_id: str | None = Field(default=None, alias="versionId")


class RunCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    items: list[dict[str, Any]]
    version: str
    metadata: dict[str, Any] | None = None
    status: Status | None = None
    state: Any | None = None
    fail_reason: Any = Field(default=None, alias="reason")


class RunUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: list[dict[str, Any]] | None = None
    metadata: dict[str, Any] | None = None
    status: Status | None = None
    state: Any | None = None
    fail_reason: Any = Field(default=None, alias="reason")


class RunWithCollaboration(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    created_at: DateTime = Field(alias="createdAt")
    finished_at: DateTime | None = Field(default=None, alias="finishedAt")
    status: str
    fail_reason: Any = Field(default=None, alias="reason")
    version: Version
    metadata: dict[str, Any] | None = None
    session_items: list[SessionItemWithCollaboration] = Field(alias="sessionItems")
    session_id: str = Field(alias="sessionId")
    version_id: str | None = Field(default=None, alias="versionId")


# --- Session ---


class SessionBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    agent: str
    handle: str
    created_at: DateTime = Field(alias="createdAt")
    updated_at: DateTime = Field(alias="updatedAt")
    metadata: dict[str, Any] | None = None
    user: User
    user_id: str = Field(alias="userId")
    env: Env
    state: Any | None = None


class Session(SessionBase):
    runs: list[Run]


class SessionWithCollaboration(SessionBase):
    runs: list[RunWithCollaboration]


class SessionCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent: str
    metadata: dict[str, Any] | None = None
    user_id: str | None = Field(default=None, alias="userId")
    env: Env | None = None


class SessionUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    metadata: dict[str, Any]


# --- Config ---


class Config(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    config: Any
    created_at: DateTime = Field(alias="createdAt")
    created_by: str = Field(alias="createdBy")


class ConfigCreate(BaseModel):
    config: Any


# --- Member ---


class Member(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    email: str
    name: str
    role: str
    image: str | None = None
    created_at: DateTime = Field(alias="createdAt")


class MemberUpdate(BaseModel):
    role: Role


# --- Invitation ---


class Invitation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    email: str
    role: str
    expires_at: DateTime = Field(alias="expiresAt")
    created_at: DateTime = Field(alias="createdAt")
    status: str
    invited_by: str | None = Field(default=None, alias="invitedBy")


class InvitationCreate(BaseModel):
    email: str
    role: Role


# --- Pagination ---


class Pagination(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    page: int
    limit: int
    total_pages: int = Field(alias="totalPages")
    total_count: int = Field(alias="totalCount")
    has_next_page: bool = Field(alias="hasNextPage")
    has_previous_page: bool = Field(alias="hasPreviousPage")
    current_page_start: int = Field(alias="currentPageStart")
    current_page_end: int = Field(alias="currentPageEnd")


class SessionsPaginatedResponse(BaseModel):
    sessions: list[SessionBase]
    pagination: Pagination


# --- Query Params ---


class SessionsGetQueryParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent: str | None = None
    page: int | str | None = None
    limit: int | str | None = None
    user_id: str | None = Field(default=None, alias="userId")
    env: Env | None = None
    starred: bool | Literal["true", "false"] | None = None


class PublicSessionsGetQueryParams(BaseModel):
    agent: str | None = None
    page: int | str | None = None
    limit: int | str | None = None


# --- Webhook ---


class RunBody(BaseModel):
    session: Session
    input: Any
