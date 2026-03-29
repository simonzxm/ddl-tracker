from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.models import Course, UserCourse, User, Task
from app.schemas.course import (
    CourseCreate,
    CourseUpdate,
    CourseResponse,
    CourseListResponse,
)
from app.dependencies import get_current_user, get_current_user_optional, get_current_admin

router = APIRouter()


@router.get("", response_model=list[CourseListResponse])
async def list_courses(
    q: Optional[str] = Query(None, description="搜索关键词"),
    semester: Optional[str] = Query(None, description="学期筛选"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """获取课程列表"""
    # Base query with followers count
    followers_subq = (
        select(UserCourse.course_id, func.count().label("cnt"))
        .group_by(UserCourse.course_id)
        .subquery()
    )
    
    query = (
        select(
            Course,
            func.coalesce(followers_subq.c.cnt, 0).label("followers_count"),
        )
        .outerjoin(followers_subq, Course.id == followers_subq.c.course_id)
    )
    
    # Apply filters
    if q:
        pattern = f"%{q}%"
        query = query.where(
            or_(
                Course.name.ilike(pattern),
                Course.course_code.ilike(pattern),
                Course.teacher.ilike(pattern),
            )
        )
    
    if semester:
        query = query.where(Course.semester == semester)
    
    # Pagination
    query = query.order_by(Course.course_code).offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get followed course IDs for current user
    followed_ids = set()
    if user:
        followed_result = await db.execute(
            select(UserCourse.course_id).where(UserCourse.user_id == user.id)
        )
        followed_ids = {row[0] for row in followed_result.all()}
    
    return [
        CourseListResponse(
            id=course.id,
            course_code=course.course_code,
            name=course.name,
            name_abbr=course.name_abbr,
            teacher=course.teacher,
            semester=course.semester,
            followers_count=followers_count,
            is_followed=course.id in followed_ids,
        )
        for course, followers_count in rows
    ]


@router.get("/followed", response_model=list[CourseListResponse])
async def list_followed_courses(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户关注的课程"""
    followers_subq = (
        select(UserCourse.course_id, func.count().label("cnt"))
        .group_by(UserCourse.course_id)
        .subquery()
    )
    
    query = (
        select(
            Course,
            func.coalesce(followers_subq.c.cnt, 0).label("followers_count"),
        )
        .join(UserCourse, Course.id == UserCourse.course_id)
        .outerjoin(followers_subq, Course.id == followers_subq.c.course_id)
        .where(UserCourse.user_id == user.id)
        .order_by(Course.course_code)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    return [
        CourseListResponse(
            id=course.id,
            course_code=course.course_code,
            name=course.name,
            name_abbr=course.name_abbr,
            teacher=course.teacher,
            semester=course.semester,
            followers_count=followers_count,
            is_followed=True,
        )
        for course, followers_count in rows
    ]


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(
    course_id: int,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """获取课程详情"""
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="课程不存在",
        )
    
    # Get followers count
    followers_result = await db.execute(
        select(func.count()).where(UserCourse.course_id == course_id)
    )
    followers_count = followers_result.scalar() or 0
    
    # Get tasks count
    tasks_result = await db.execute(
        select(func.count()).where(Task.course_id == course_id)
    )
    tasks_count = tasks_result.scalar() or 0
    
    return CourseResponse(
        id=course.id,
        course_code=course.course_code,
        name=course.name,
        name_abbr=course.name_abbr,
        teacher=course.teacher,
        semester=course.semester,
        description=course.description,
        followers_count=followers_count,
        tasks_count=tasks_count,
        created_at=course.created_at,
    )


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
async def create_course(
    data: CourseCreate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """创建课程（仅管理员）"""
    # Check duplicate
    existing = await db.execute(
        select(Course).where(
            Course.course_code == data.course_code,
            Course.teacher == data.teacher,
            Course.semester == data.semester,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该课程已存在（课号+教师+学期重复）",
        )
    
    course = Course(**data.model_dump())
    db.add(course)
    await db.flush()
    await db.refresh(course)
    
    return CourseResponse(
        id=course.id,
        course_code=course.course_code,
        name=course.name,
        name_abbr=course.name_abbr,
        teacher=course.teacher,
        semester=course.semester,
        description=course.description,
        followers_count=0,
        tasks_count=0,
        created_at=course.created_at,
    )


@router.put("/{course_id}", response_model=CourseResponse)
async def update_course(
    course_id: int,
    data: CourseUpdate,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新课程（仅管理员）"""
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="课程不存在",
        )
    
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(course, field, value)
    
    return CourseResponse(
        id=course.id,
        course_code=course.course_code,
        name=course.name,
        name_abbr=course.name_abbr,
        teacher=course.teacher,
        semester=course.semester,
        description=course.description,
        followers_count=0,
        tasks_count=0,
        created_at=course.created_at,
    )


@router.post("/{course_id}/follow")
async def follow_course(
    course_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """关注课程"""
    # Check course exists
    result = await db.execute(select(Course).where(Course.id == course_id))
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="课程不存在",
        )
    
    # Check already followed
    existing = await db.execute(
        select(UserCourse).where(
            UserCourse.user_id == user.id,
            UserCourse.course_id == course_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="已关注该课程",
        )
    
    follow = UserCourse(user_id=user.id, course_id=course_id)
    db.add(follow)
    
    return {"message": "关注成功"}


@router.delete("/{course_id}/follow")
async def unfollow_course(
    course_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消关注课程"""
    result = await db.execute(
        select(UserCourse).where(
            UserCourse.user_id == user.id,
            UserCourse.course_id == course_id,
        )
    )
    follow = result.scalar_one_or_none()
    
    if not follow:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未关注该课程",
        )
    
    await db.delete(follow)
    return {"message": "已取消关注"}
