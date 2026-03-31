import enum
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Enum, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(enum.Enum):
    STUDENT = "student"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_color: Mapped[str | None] = mapped_column(String(7), nullable=True)  # Hex color like #2563eb
    karma: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.STUDENT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    
    # Relationships
    followed_courses: Mapped[list["UserCourse"]] = relationship(
        "UserCourse", back_populates="user", cascade="all, delete-orphan"
    )
    created_tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="creator", foreign_keys="Task.creator_id"
    )
    votes: Mapped[list["TaskVote"]] = relationship(
        "TaskVote", back_populates="user", cascade="all, delete-orphan"
    )
    completions: Mapped[list["TaskCompletion"]] = relationship(
        "TaskCompletion", back_populates="user", cascade="all, delete-orphan"
    )
    task_notes: Mapped[list["TaskNote"]] = relationship(
        "TaskNote", back_populates="user", cascade="all, delete-orphan"
    )
    edit_proposals: Mapped[list["TaskEditProposal"]] = relationship(
        "TaskEditProposal", back_populates="proposer"
    )
    proposal_votes: Mapped[list["ProposalVote"]] = relationship(
        "ProposalVote", back_populates="user", cascade="all, delete-orphan"
    )
    
    def __repr__(self):
        return f"<User {self.email}>"


class UserCourse(Base):
    """Association table for user-course following relationship"""
    __tablename__ = "user_courses"
    
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="followed_courses")
    course: Mapped["Course"] = relationship("Course", back_populates="followers")
