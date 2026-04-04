"""Admin panel Pydantic schemas.

Extracted from routers/admin.py to keep router files focused on
endpoint logic and maintain consistency with other schema modules.
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ──── Dashboard ────

class DashboardStats(BaseModel):
    total_users: int
    active_users_7d: int
    total_courses: int
    total_tasks: int
    pending_tasks: int
    reported_tasks: int
    new_tasks_7d: int


# ──── Task Audit ────

class TaskAuditResponse(BaseModel):
    id: int
    course_name: str
    title: str
    creator_nickname: Optional[str]
    status: str
    upvotes: int
    downvotes: int
    is_reported: bool
    due_time: Optional[datetime] = None
    created_at: datetime


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_time: Optional[datetime] = None
    status: Optional[str] = None


# ──── User Management ────

class UserListResponse(BaseModel):
    id: int
    email: str
    nickname: str
    karma: int
    role: str
    created_at: datetime


class UserUpdateRequest(BaseModel):
    nickname: Optional[str] = None
    karma: Optional[int] = None


# ──── Course Management ────

class AdminCourseResponse(BaseModel):
    """Admin-specific course response (renamed from CourseListResponse to avoid
    collision with schemas.course.CourseListResponse)."""
    id: int
    code: str
    name: str
    name_abbr: Optional[str]
    teacher: str
    semester: str
    class_name: Optional[str] = None
    campus: Optional[str] = None
    time_location: Optional[str] = None
    follower_count: int = 0
    task_count: int = 0
    created_at: datetime


class CourseCreateRequest(BaseModel):
    code: str
    name: str
    name_abbr: Optional[str] = None
    teacher: str
    semester: str
    class_name: Optional[str] = None
    campus: Optional[str] = None
    time_location: Optional[str] = None


class CourseUpdateRequest(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    name_abbr: Optional[str] = None
    teacher: Optional[str] = None
    semester: Optional[str] = None
    class_name: Optional[str] = None
    campus: Optional[str] = None
    time_location: Optional[str] = None


# ──── Bulk Import ────

class BulkCourseItem(BaseModel):
    code: str
    name: str
    name_abbr: Optional[str] = None
    teacher: str
    semester: str
    class_name: Optional[str] = None
    campus: Optional[str] = None
    time_location: Optional[str] = None


class BulkImportRequest(BaseModel):
    courses: list[BulkCourseItem]
    skip_duplicates: bool = True  # If true, skip duplicates; if false, fail on duplicate


class BulkImportResult(BaseModel):
    total: int
    imported: int
    skipped: int
    errors: list[str]


# ──── Proposal Management ────

class ProposalListResponse(BaseModel):
    id: int
    task_id: int
    task_title: Optional[str] = None
    proposer_id: Optional[int]
    proposer_nickname: Optional[str]
    new_description: str
    reason: Optional[str]
    status: str
    upvotes: int
    downvotes: int
    created_at: datetime
