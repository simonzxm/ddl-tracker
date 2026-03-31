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


class EditProposalStatusEnum(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


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
    my_note: Optional[str] = None  # 用户私人备注
    pending_proposals_count: int = 0  # 待处理的修改提案数量
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


# Task Note schemas
class TaskNoteRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


class TaskNoteResponse(BaseModel):
    task_id: int
    content: str
    updated_at: datetime
    
    class Config:
        from_attributes = True


# Edit Proposal schemas
class EditProposalCreate(BaseModel):
    new_description: str = Field(..., min_length=1)
    reason: Optional[str] = Field(None, max_length=500)


class EditProposalResponse(BaseModel):
    id: int
    task_id: int
    proposer_id: Optional[int]
    proposer_nickname: Optional[str] = None
    new_description: str
    reason: Optional[str]
    status: EditProposalStatusEnum
    upvotes: int
    downvotes: int
    my_vote: Optional[VoteTypeEnum] = None
    created_at: datetime
    
    class Config:
        from_attributes = True
