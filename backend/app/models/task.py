import enum
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Enum, Boolean, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VoteType(enum.Enum):
    UPVOTE = "upvote"
    DOWNVOTE = "downvote"


class TaskStatus(enum.Enum):
    PENDING = "pending"      # Awaiting community verification
    VERIFIED = "verified"    # Confirmed by community or high-karma user
    HIDDEN = "hidden"        # Too many downvotes, auto-hidden


class EditProposalStatus(enum.Enum):
    PENDING = "pending"      # Awaiting votes
    APPROVED = "approved"    # Applied to task
    REJECTED = "rejected"    # Too many downvotes


class Task(Base):
    __tablename__ = "tasks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # Markdown content
    due_time: Mapped[str] = mapped_column(DateTime, nullable=False, index=True)
    creator_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus), default=TaskStatus.PENDING, nullable=False
    )
    upvotes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    downvotes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_reported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime, default=func.now(), nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now(), nullable=False
    )
    
    __table_args__ = (
        Index("ix_task_status_due", "status", "due_time"),
    )
    
    # Relationships
    course: Mapped["Course"] = relationship("Course", back_populates="tasks")
    creator: Mapped["User | None"] = relationship(
        "User", back_populates="created_tasks", foreign_keys=[creator_id]
    )
    votes: Mapped[list["TaskVote"]] = relationship(
        "TaskVote", back_populates="task", cascade="all, delete-orphan"
    )
    completions: Mapped[list["TaskCompletion"]] = relationship(
        "TaskCompletion", back_populates="task", cascade="all, delete-orphan"
    )
    notes: Mapped[list["TaskNote"]] = relationship(
        "TaskNote", back_populates="task", cascade="all, delete-orphan"
    )
    edit_proposals: Mapped[list["TaskEditProposal"]] = relationship(
        "TaskEditProposal", back_populates="task", cascade="all, delete-orphan"
    )
    
    @property
    def vote_score(self) -> int:
        return self.upvotes - self.downvotes
    
    def __repr__(self):
        return f"<Task {self.id}: {self.title}>"


class TaskVote(Base):
    __tablename__ = "task_votes"
    
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    vote_type: Mapped[VoteType] = mapped_column(Enum(VoteType), nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="votes")
    task: Mapped["Task"] = relationship("Task", back_populates="votes")


class TaskCompletion(Base):
    """用户标记任务为已完成的记录"""
    __tablename__ = "task_completions"
    
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    completed_at: Mapped[str] = mapped_column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="completions")
    task: Mapped["Task"] = relationship("Task", back_populates="completions")


class TaskNote(Base):
    """用户对任务的私人备注"""
    __tablename__ = "task_notes"
    
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime, default=func.now(), nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime, default=func.now(), onupdate=func.now(), nullable=False
    )
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="task_notes")
    task: Mapped["Task"] = relationship("Task", back_populates="notes")


class TaskEditProposal(Base):
    """用户提交的任务描述修改提案"""
    __tablename__ = "task_edit_proposals"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    proposer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    new_description: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)  # 修改原因
    status: Mapped[EditProposalStatus] = mapped_column(
        Enum(EditProposalStatus), default=EditProposalStatus.PENDING, nullable=False
    )
    upvotes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    downvotes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime, default=func.now(), nullable=False)
    resolved_at: Mapped[str | None] = mapped_column(DateTime, nullable=True)
    
    # Relationships
    task: Mapped["Task"] = relationship("Task", back_populates="edit_proposals")
    proposer: Mapped["User | None"] = relationship("User", back_populates="edit_proposals")
    votes: Mapped[list["ProposalVote"]] = relationship(
        "ProposalVote", back_populates="proposal", cascade="all, delete-orphan"
    )


class ProposalVote(Base):
    """对修改提案的投票"""
    __tablename__ = "proposal_votes"
    
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    proposal_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("task_edit_proposals.id", ondelete="CASCADE"), primary_key=True
    )
    vote_type: Mapped[VoteType] = mapped_column(Enum(VoteType), nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime, default=func.now(), nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="proposal_votes")
    proposal: Mapped["TaskEditProposal"] = relationship("TaskEditProposal", back_populates="votes")
