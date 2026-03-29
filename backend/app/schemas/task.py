from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class TaskStatusEnum(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    HIDDEN = "hidden"


class VoteTypeEnum(str, Enum):
    UPVOTE = "upvote"
    DOWNVOTE = "downvote"


class TaskCreate(BaseModel):
    course_id: int
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    due_time: datetime


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    due_time: Optional[datetime] = None


class TaskResponse(BaseModel):
    id: int
    course_id: int
    course_name: str = ""
    course_abbr: Optional[str] = None
    title: str
    description: Optional[str]
    due_time: datetime
    creator_id: Optional[int]
    creator_nickname: Optional[str] = None
    status: TaskStatusEnum
    upvotes: int
    downvotes: int
    is_reported: bool
    my_vote: Optional[VoteTypeEnum] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    id: int
    course_id: int
    course_name: str = ""
    course_abbr: Optional[str] = None
    title: str
    due_time: datetime
    status: TaskStatusEnum
    upvotes: int
    downvotes: int
    my_vote: Optional[VoteTypeEnum] = None
    
    class Config:
        from_attributes = True


class VoteRequest(BaseModel):
    vote_type: VoteTypeEnum


class ReportRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)
