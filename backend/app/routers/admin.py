from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, Course, Task, TaskVote, UserCourse, TaskStatus, UserRole
from app.dependencies import get_current_admin

router = APIRouter()


class DashboardStats(BaseModel):
    total_users: int
    active_users_7d: int
    total_courses: int
    total_tasks: int
    pending_tasks: int
    reported_tasks: int
    new_tasks_7d: int


class TaskAuditResponse(BaseModel):
    id: int
    course_name: str
    title: str
    creator_nickname: Optional[str]
    status: str
    upvotes: int
    downvotes: int
    is_reported: bool
    created_at: datetime


@router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard_stats(
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取管理大盘数据"""
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    
    # Total users
    total_users = await db.scalar(select(func.count()).select_from(User))
    
    # Active users (created tasks or voted in last 7 days)
    active_creators = await db.execute(
        select(func.count(func.distinct(Task.creator_id))).where(Task.created_at >= week_ago)
    )
    active_voters = await db.execute(
        select(func.count(func.distinct(TaskVote.user_id))).where(TaskVote.created_at >= week_ago)
    )
    active_users = (active_creators.scalar() or 0) + (active_voters.scalar() or 0)
    
    # Total courses
    total_courses = await db.scalar(select(func.count()).select_from(Course))
    
    # Total tasks
    total_tasks = await db.scalar(select(func.count()).select_from(Task))
    
    # Pending tasks
    pending_tasks = await db.scalar(
        select(func.count()).where(Task.status == TaskStatus.PENDING)
    )
    
    # Reported tasks
    reported_tasks = await db.scalar(
        select(func.count()).where(Task.is_reported == True)
    )
    
    # New tasks in last 7 days
    new_tasks_7d = await db.scalar(
        select(func.count()).where(Task.created_at >= week_ago)
    )
    
    return DashboardStats(
        total_users=total_users or 0,
        active_users_7d=active_users or 0,
        total_courses=total_courses or 0,
        total_tasks=total_tasks or 0,
        pending_tasks=pending_tasks or 0,
        reported_tasks=reported_tasks or 0,
        new_tasks_7d=new_tasks_7d or 0,
    )


@router.get("/tasks/reported", response_model=list[TaskAuditResponse])
async def get_reported_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取被举报的任务列表"""
    result = await db.execute(
        select(Task, Course.name, User.nickname)
        .join(Course, Task.course_id == Course.id)
        .outerjoin(User, Task.creator_id == User.id)
        .where(Task.is_reported == True)
        .order_by(Task.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    
    return [
        TaskAuditResponse(
            id=task.id,
            course_name=course_name,
            title=task.title,
            creator_nickname=nickname,
            status=task.status.value.lower(),
            upvotes=task.upvotes,
            downvotes=task.downvotes,
            is_reported=task.is_reported,
            created_at=task.created_at,
        )
        for task, course_name, nickname in result.all()
    ]


@router.get("/tasks/low-score", response_model=list[TaskAuditResponse])
async def get_low_score_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取低评分任务列表（downvotes > upvotes）"""
    result = await db.execute(
        select(Task, Course.name, User.nickname)
        .join(Course, Task.course_id == Course.id)
        .outerjoin(User, Task.creator_id == User.id)
        .where(Task.downvotes > Task.upvotes)
        .order_by((Task.downvotes - Task.upvotes).desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    
    return [
        TaskAuditResponse(
            id=task.id,
            course_name=course_name,
            title=task.title,
            creator_nickname=nickname,
            status=task.status.value.lower(),
            upvotes=task.upvotes,
            downvotes=task.downvotes,
            is_reported=task.is_reported,
            created_at=task.created_at,
        )
        for task, course_name, nickname in result.all()
    ]


@router.post("/tasks/{task_id}/verify")
async def verify_task(
    task_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """管理员验证任务"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task.status = TaskStatus.VERIFIED
    task.is_reported = False
    return {"message": "任务已验证"}


@router.post("/tasks/{task_id}/hide")
async def hide_task(
    task_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """管理员隐藏任务"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task.status = TaskStatus.HIDDEN
    return {"message": "任务已隐藏"}


@router.delete("/tasks/{task_id}")
async def admin_delete_task(
    task_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """管理员删除任务"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    await db.delete(task)
    return {"message": "任务已删除"}


@router.post("/tasks/{task_id}/dismiss-report")
async def dismiss_report(
    task_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """驳回举报"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task.is_reported = False
    return {"message": "举报已驳回"}


class UserListResponse(BaseModel):
    id: int
    email: str
    nickname: str
    karma: int
    role: str
    created_at: datetime


@router.get("/users", response_model=list[UserListResponse])
async def list_users(
    q: Optional[str] = Query(None, description="搜索邮箱或昵称"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取用户列表"""
    query = select(User)
    
    if q:
        pattern = f"%{q}%"
        query = query.where(
            (User.email.ilike(pattern)) | (User.nickname.ilike(pattern))
        )
    
    query = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    
    return [
        UserListResponse(
            id=u.id,
            email=u.email,
            nickname=u.nickname,
            karma=u.karma,
            role=u.role.value,
            created_at=u.created_at,
        )
        for u in result.scalars().all()
    ]


@router.post("/users/{user_id}/set-admin")
async def set_user_admin(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """设置用户为管理员"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    user.role = UserRole.ADMIN
    return {"message": f"{user.nickname} 已设为管理员"}


@router.post("/users/{user_id}/remove-admin")
async def remove_user_admin(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """取消用户管理员权限"""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能取消自己的管理员权限")
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    user.role = UserRole.STUDENT
    return {"message": f"{user.nickname} 已取消管理员权限"}
