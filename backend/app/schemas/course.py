from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class CourseCreate(BaseModel):
    course_code: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=200)
    name_abbr: Optional[str] = Field(None, max_length=50)
    teacher: str = Field(..., min_length=1, max_length=100)
    semester: str = Field(..., min_length=1, max_length=20)
    class_number: Optional[str] = Field(None, max_length=20)  # e.g., "03班"
    campus: Optional[str] = Field(None, max_length=50)  # e.g., "鼓楼校区"
    time_location: Optional[str] = Field(None, max_length=200)  # Time and location
    description: Optional[str] = None


class CourseUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    name_abbr: Optional[str] = Field(None, max_length=50)
    class_number: Optional[str] = Field(None, max_length=20)
    campus: Optional[str] = Field(None, max_length=50)
    time_location: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None


class CourseResponse(BaseModel):
    id: int
    course_code: str
    name: str
    name_abbr: Optional[str]
    teacher: str
    semester: str
    class_number: Optional[str] = None
    campus: Optional[str] = None
    time_location: Optional[str] = None
    description: Optional[str] = None
    followers_count: int = 0
    tasks_count: int = 0
    is_followed: bool = False
    created_at: datetime
    
    class Config:
        from_attributes = True


class CourseListResponse(BaseModel):
    id: int
    course_code: str
    name: str
    name_abbr: Optional[str]
    teacher: str
    semester: str
    class_number: Optional[str] = None
    campus: Optional[str] = None
    followers_count: int = 0
    is_followed: bool = False
    
    class Config:
        from_attributes = True


class CourseSearchParams(BaseModel):
    q: Optional[str] = None
    semester: Optional[str] = None
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
