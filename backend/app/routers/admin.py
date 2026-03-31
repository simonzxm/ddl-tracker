from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import User, Course, Task, TaskVote, UserCourse, TaskStatus, UserRole, TaskEditProposal, EditProposalStatus
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
    due_time: Optional[datetime] = None
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


# Task management (all tasks) - MUST be before /tasks/{task_id} routes
@router.get("/tasks", response_model=list[TaskAuditResponse])
async def list_all_tasks(
    q: Optional[str] = Query(None, description="搜索标题"),
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取所有任务列表"""
    query = (
        select(Task, Course.name, User.nickname)
        .join(Course, Task.course_id == Course.id)
        .outerjoin(User, Task.creator_id == User.id)
    )
    
    if q:
        query = query.where(Task.title.ilike(f"%{q}%"))
    
    if status_filter:
        # TaskStatus enum uses lowercase values: pending, verified, hidden
        try:
            task_status = TaskStatus(status_filter.lower())
            query = query.where(Task.status == task_status)
        except ValueError:
            pass  # Invalid status, ignore filter
    
    query = query.order_by(Task.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    
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
            due_time=task.due_time,
            created_at=task.created_at,
        )
        for task, course_name, nickname in result.all()
    ]


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
            due_time=task.due_time,
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
            due_time=task.due_time,
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


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_time: Optional[datetime] = None
    status: Optional[str] = None


@router.put("/tasks/{task_id}")
async def admin_update_task(
    task_id: int,
    data: TaskUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """管理员修改任务"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    if data.title is not None:
        task.title = data.title
    if data.description is not None:
        task.description = data.description
    if data.due_time is not None:
        # Remove timezone info to match database column type
        due_time = data.due_time
        if due_time.tzinfo is not None:
            due_time = due_time.replace(tzinfo=None)
        task.due_time = due_time
    if data.status is not None:
        try:
            task.status = TaskStatus(data.status.lower())
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的状态值")
    
    await db.commit()
    return {"message": "任务已更新"}


@router.get("/tasks/{task_id}")
async def admin_get_task(
    task_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取任务详情"""
    result = await db.execute(
        select(Task, Course.name)
        .join(Course, Task.course_id == Course.id)
        .where(Task.id == task_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task, course_name = row
    return {
        "id": task.id,
        "course_id": task.course_id,
        "course_name": course_name,
        "title": task.title,
        "description": task.description,
        "due_time": task.due_time.isoformat(),
        "status": task.status.value,
        "upvotes": task.upvotes,
        "downvotes": task.downvotes,
        "is_reported": task.is_reported,
        "created_at": task.created_at.isoformat(),
    }


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


class UserUpdateRequest(BaseModel):
    nickname: Optional[str] = None
    karma: Optional[int] = None


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    data: UserUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """修改用户信息"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    if data.nickname is not None:
        user.nickname = data.nickname
    if data.karma is not None:
        user.karma = data.karma
    
    return {"message": "用户信息已更新"}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除用户"""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    await db.delete(user)
    return {"message": "用户已删除"}


# Course management
class CourseListResponse(BaseModel):
    id: int
    code: str
    name: str
    name_abbr: Optional[str]
    teacher: str
    semester: str
    follower_count: int = 0
    task_count: int = 0
    created_at: datetime


class CourseCreateRequest(BaseModel):
    code: str
    name: str
    name_abbr: Optional[str] = None
    teacher: str
    semester: str


class CourseUpdateRequest(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    name_abbr: Optional[str] = None
    teacher: Optional[str] = None
    semester: Optional[str] = None


@router.get("/courses", response_model=list[CourseListResponse])
async def list_courses(
    q: Optional[str] = Query(None, description="搜索课程名/课号/教师"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取课程列表"""
    query = select(
        Course,
        func.count(func.distinct(UserCourse.user_id)).label('follower_count'),
        func.count(func.distinct(Task.id)).label('task_count'),
    ).outerjoin(UserCourse, Course.id == UserCourse.course_id).outerjoin(Task, Course.id == Task.course_id).group_by(Course.id)
    
    if q:
        pattern = f"%{q}%"
        query = query.where(
            (Course.name.ilike(pattern)) | 
            (Course.course_code.ilike(pattern)) | 
            (Course.teacher.ilike(pattern))
        )
    
    query = query.order_by(Course.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    
    return [
        CourseListResponse(
            id=course.id,
            code=course.course_code,
            name=course.name,
            name_abbr=course.name_abbr,
            teacher=course.teacher,
            semester=course.semester,
            follower_count=follower_count or 0,
            task_count=task_count or 0,
            created_at=course.created_at,
        )
        for course, follower_count, task_count in result.all()
    ]


@router.post("/courses", status_code=status.HTTP_201_CREATED)
async def create_course(
    data: CourseCreateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """创建课程"""
    # Check for duplicate
    exists = await db.execute(
        select(Course).where(
            Course.course_code == data.code,
            Course.teacher == data.teacher,
            Course.semester == data.semester,
        )
    )
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="课程已存在（课号+教师+学期重复）")
    
    course = Course(
        course_code=data.code,
        name=data.name,
        name_abbr=data.name_abbr,
        teacher=data.teacher,
        semester=data.semester,
    )
    db.add(course)
    await db.flush()
    
    return {"message": "课程已创建", "id": course.id}


@router.put("/courses/{course_id}")
async def update_course(
    course_id: int,
    data: CourseUpdateRequest,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """修改课程"""
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(course, field, value)
    
    return {"message": "课程已更新"}


@router.delete("/courses/{course_id}")
async def delete_course(
    course_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除课程"""
    result = await db.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    
    if not course:
        raise HTTPException(status_code=404, detail="课程不存在")
    
    # Check if there are tasks
    task_count = await db.scalar(
        select(func.count()).where(Task.course_id == course_id)
    )
    if task_count > 0:
        raise HTTPException(status_code=400, detail=f"该课程下有 {task_count} 个任务，无法删除")
    
    await db.delete(course)
    return {"message": "课程已删除"}


# Proposal management
class ProposalListResponse(BaseModel):
    id: int
    task_id: int
    task_title: Optional[str] = None
    proposer_id: Optional[int]
    proposer_nickname: Optional[str]
    new_description: str
    reason: Optional[str]
    status: str
    upvotes: int
    downvotes: int
    created_at: datetime


@router.get("/proposals", response_model=list[ProposalListResponse])
async def list_proposals(
    status: Optional[str] = Query(None, description="筛选状态: pending/approved/rejected"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取修改建议列表"""
    query = (
        select(TaskEditProposal, Task.title, User.nickname)
        .join(Task, TaskEditProposal.task_id == Task.id)
        .outerjoin(User, TaskEditProposal.proposer_id == User.id)
    )
    
    if status:
        try:
            status_enum = EditProposalStatus(status.upper())
            query = query.where(TaskEditProposal.status == status_enum)
        except ValueError:
            pass
    
    query = query.order_by(TaskEditProposal.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    
    return [
        ProposalListResponse(
            id=proposal.id,
            task_id=proposal.task_id,
            task_title=task_title,
            proposer_id=proposal.proposer_id,
            proposer_nickname=proposer_nickname,
            new_description=proposal.new_description,
            reason=proposal.reason,
            status=proposal.status.value.lower(),
            upvotes=proposal.upvotes,
            downvotes=proposal.downvotes,
            created_at=proposal.created_at,
        )
        for proposal, task_title, proposer_nickname in result.all()
    ]


@router.get("/proposals/{proposal_id}")
async def get_proposal(
    proposal_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取修改建议详情"""
    result = await db.execute(
        select(TaskEditProposal, User.nickname)
        .outerjoin(User, TaskEditProposal.proposer_id == User.id)
        .where(TaskEditProposal.id == proposal_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="建议不存在")
    
    proposal, proposer_nickname = row
    return {
        "id": proposal.id,
        "task_id": proposal.task_id,
        "proposer_id": proposal.proposer_id,
        "proposer_nickname": proposer_nickname,
        "new_description": proposal.new_description,
        "reason": proposal.reason,
        "status": proposal.status.value.lower(),
        "upvotes": proposal.upvotes,
        "downvotes": proposal.downvotes,
        "created_at": proposal.created_at.isoformat(),
        "resolved_at": proposal.resolved_at.isoformat() if proposal.resolved_at else None,
    }


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """通过修改建议"""
    result = await db.execute(
        select(TaskEditProposal).where(TaskEditProposal.id == proposal_id)
    )
    proposal = result.scalar_one_or_none()
    
    if not proposal:
        raise HTTPException(status_code=404, detail="建议不存在")
    
    if proposal.status != EditProposalStatus.PENDING:
        raise HTTPException(status_code=400, detail="该建议已被处理")
    
    # Get the task and update its description
    task_result = await db.execute(select(Task).where(Task.id == proposal.task_id))
    task = task_result.scalar_one_or_none()
    
    if task:
        task.description = proposal.new_description
        task.updated_at = datetime.utcnow()
    
    proposal.status = EditProposalStatus.APPROVED
    proposal.resolved_at = datetime.utcnow()
    
    # Reward the proposer
    if proposal.proposer_id:
        proposer_result = await db.execute(select(User).where(User.id == proposal.proposer_id))
        proposer = proposer_result.scalar_one_or_none()
        if proposer:
            proposer.karma += 5  # Reward for approved proposal
    
    await db.commit()
    return {"message": "建议已通过"}


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(
    proposal_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """拒绝修改建议"""
    result = await db.execute(
        select(TaskEditProposal).where(TaskEditProposal.id == proposal_id)
    )
    proposal = result.scalar_one_or_none()
    
    if not proposal:
        raise HTTPException(status_code=404, detail="建议不存在")
    
    if proposal.status != EditProposalStatus.PENDING:
        raise HTTPException(status_code=400, detail="该建议已被处理")
    
    proposal.status = EditProposalStatus.REJECTED
    proposal.resolved_at = datetime.utcnow()
    
    await db.commit()
    return {"message": "建议已拒绝"}
