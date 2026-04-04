from sqlalchemy import String, Integer, Text, DateTime, UniqueConstraint, Index, func
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
    class_number: Mapped[str | None] = mapped_column(String(20), nullable=True)  # e.g., "03班"
    campus: Mapped[str | None] = mapped_column(String(50), nullable=True)  # e.g., "鼓楼校区"
    time_location: Mapped[str | None] = mapped_column(String(200), nullable=True)  # Time and location mixed
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
    
    # Composite unique constraint: course_code + teacher + semester + class_number
    __table_args__ = (
        UniqueConstraint("course_code", "teacher", "semester", "class_number", name="uq_course_teacher_semester_class"),
        Index("ix_course_semester", "semester"),
        Index("ix_course_name", "name"),
    )
    
    # Relationships (all use string references to avoid circular imports)
    followers: Mapped[list["UserCourse"]] = relationship(
        "UserCourse", back_populates="course", cascade="all, delete-orphan"
    )
    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="course", cascade="all, delete-orphan"
    )
    
    def __repr__(self):
        return f"<Course {self.course_code}: {self.name}>"
