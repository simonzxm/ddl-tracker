import enum
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Enum, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VoteType(enum.Enum):
    UPVOTE = "upvote"
    DOWNVOTE = "downvote"


class TaskStatus(enum.Enum):
    PENDING = "pending"      # Awaiting community verification
    VERIFIED = "verified"    # Confirmed by community or high-karma user
    HIDDEN = "hidden"        # Too many downvotes, auto-hidden


class Task(Base):
    __tablename__ = "tasks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # Markdown content
    due_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    creator_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus), default=TaskStatus.PENDING, nullable=False
    )
    upvotes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    downvotes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_reported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="votes")
    task: Mapped["Task"] = relationship("Task", back_populates="votes")


# Avoid circular import
from app.models.course import Course
from app.models.user import User
