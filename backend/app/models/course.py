from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Course(Base):
    __tablename__ = "courses"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_abbr: Mapped[str | None] = mapped_column(String(50), nullable=True)
    teacher: Mapped[str] = mapped_column(String(100), nullable=False)
    semester: Mapped[str] = mapped_column(String(20), nullable=False)  # e.g., "2025-Spring"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    
    # Composite unique constraint: course_code + teacher + semester
    __table_args__ = (
        UniqueConstraint("course_code", "teacher", "semester", name="uq_course_teacher_semester"),
        Index("ix_course_semester", "semester"),
    )
    
    # Relationships
    followers: Mapped[list["UserCourse"]] = relationship(
        "UserCourse", back_populates="course", cascade="all, delete-orphan"
    )
    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="course", cascade="all, delete-orphan"
    )
    
    def __repr__(self):
        return f"<Course {self.course_code}: {self.name}>"


# Import to avoid circular dependency
from app.models.user import UserCourse
from app.models.task import Task
