from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, and_, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import datetime, timedelta

from app.database import get_db
from app.models import (
    Task, TaskVote, Course, User, UserCourse, TaskStatus, VoteType, TaskCompletion,
    TaskNote, TaskEditProposal, ProposalVote, EditProposalStatus
)
from app.schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskListResponse,
    VoteRequest,
    ReportRequest,
    TaskStatusEnum,
    VoteTypeEnum,
    TaskNoteRequest,
    TaskNoteResponse,
    EditProposalCreate,
    EditProposalResponse,
    EditProposalStatusEnum,
)
from app.dependencies import get_current_user, get_current_user_optional
from app.services.karma import process_vote, should_auto_verify

router = APIRouter()

# Thresholds for proposal auto-approval/rejection
PROPOSAL_APPROVE_THRESHOLD = 3  # Net votes needed for auto-approve
PROPOSAL_REJECT_THRESHOLD = -3  # Net votes for auto-reject


def _map_vote_type(vote: TaskVote | None) -> VoteTypeEnum | None:
    if not vote:
        return None
    return VoteTypeEnum.UPVOTE if vote.vote_type == VoteType.UPVOTE else VoteTypeEnum.DOWNVOTE


def _map_task_status(status: TaskStatus) -> TaskStatusEnum:
    return TaskStatusEnum(status.value.lower())


@router.get("", response_model=list[TaskListResponse])
async def list_tasks(
    course_id: Optional[int] = Query(None, description="课程ID"),
    status_filter: Optional[TaskStatusEnum] = Query(None, alias="status"),
    due_after: Optional[datetime] = Query(None),
    due_before: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """获取任务列表"""
    query = (
        select(Task, Course.name, Course.name_abbr)
        .join(Course, Task.course_id == Course.id)
    )
    
    # Filters
    if course_id:
        query = query.where(Task.course_id == course_id)
    
    if status_filter:
        query = query.where(Task.status == TaskStatus(status_filter.value.upper()))
    else:
        # Default: exclude hidden tasks
        query = query.where(Task.status != TaskStatus.HIDDEN)
    
    if due_after:
        query = query.where(Task.due_time >= due_after)
    
    if due_before:
        query = query.where(Task.due_time <= due_before)
    
    query = query.order_by(Task.due_time).offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get user votes
    user_votes = {}
    if user and rows:
        task_ids = [row[0].id for row in rows]
        votes_result = await db.execute(
            select(TaskVote).where(
                TaskVote.user_id == user.id,
                TaskVote.task_id.in_(task_ids),
            )
        )
        user_votes = {v.task_id: v for v in votes_result.scalars().all()}
    
    return [
        TaskListResponse(
            id=task.id,
            course_id=task.course_id,
            course_name=course_name,
            course_abbr=course_abbr,
            title=task.title,
            due_time=task.due_time,
            status=_map_task_status(task.status),
            upvotes=task.upvotes,
            downvotes=task.downvotes,
            my_vote=_map_vote_type(user_votes.get(task.id)),
        )
        for task, course_name, course_abbr in rows
    ]


@router.get("/my-deadlines", response_model=list[TaskListResponse])
async def get_my_deadlines(
    days: int = Query(7, ge=1, le=365, description="未来天数"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我关注课程的DDL（包含逾期和未来指定天数内）"""
    now = datetime.utcnow()
    end_time = now + timedelta(days=days)
    
    query = (
        select(Task, Course.name, Course.name_abbr)
        .join(Course, Task.course_id == Course.id)
        .join(UserCourse, Course.id == UserCourse.course_id)
        .where(
            UserCourse.user_id == user.id,
            Task.status != TaskStatus.HIDDEN,
            Task.due_time <= end_time,  # Includes overdue tasks
        )
        .order_by(Task.due_time)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get votes
    task_ids = [row[0].id for row in rows]
    user_votes = {}
    if task_ids:
        votes_result = await db.execute(
            select(TaskVote).where(
                TaskVote.user_id == user.id,
                TaskVote.task_id.in_(task_ids),
            )
        )
        user_votes = {v.task_id: v for v in votes_result.scalars().all()}
    
    return [
        TaskListResponse(
            id=task.id,
            course_id=task.course_id,
            course_name=course_name,
            course_abbr=course_abbr,
            title=task.title,
            due_time=task.due_time,
            status=_map_task_status(task.status),
            upvotes=task.upvotes,
            downvotes=task.downvotes,
            my_vote=_map_vote_type(user_votes.get(task.id)),
        )
        for task, course_name, course_abbr in rows
    ]


@router.get("/overdue", response_model=list[TaskListResponse])
async def get_overdue_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我关注课程的已逾期DDL"""
    now = datetime.utcnow()
    past_limit = now - timedelta(days=30)  # Only show last 30 days
    
    query = (
        select(Task, Course.name, Course.name_abbr)
        .join(Course, Task.course_id == Course.id)
        .join(UserCourse, Course.id == UserCourse.course_id)
        .where(
            UserCourse.user_id == user.id,
            Task.status != TaskStatus.HIDDEN,
            Task.due_time < now,
            Task.due_time >= past_limit,
        )
        .order_by(Task.due_time.desc())
        .limit(50)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    return [
        TaskListResponse(
            id=task.id,
            course_id=task.course_id,
            course_name=course_name,
            course_abbr=course_abbr,
            title=task.title,
            due_time=task.due_time,
            status=_map_task_status(task.status),
            upvotes=task.upvotes,
            downvotes=task.downvotes,
            my_vote=None,
        )
        for task, course_name, course_abbr in rows
    ]


@router.get("/completed/list", response_model=list[int])
async def get_completed_tasks(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户标记为已完成的任务ID列表"""
    result = await db.execute(
        select(TaskCompletion.task_id).where(TaskCompletion.user_id == user.id)
    )
    return [row[0] for row in result.all()]


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: int,
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """获取任务详情"""
    result = await db.execute(
        select(Task, Course.name, Course.name_abbr, User.nickname)
        .join(Course, Task.course_id == Course.id)
        .outerjoin(User, Task.creator_id == User.id)
        .where(Task.id == task_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    task, course_name, course_abbr, creator_nickname = row
    
    # Get user's vote and note
    my_vote = None
    my_note = None
    if user:
        vote_result = await db.execute(
            select(TaskVote).where(
                TaskVote.user_id == user.id,
                TaskVote.task_id == task_id,
            )
        )
        vote = vote_result.scalar_one_or_none()
        my_vote = _map_vote_type(vote)
        
        # Get user's note
        note_result = await db.execute(
            select(TaskNote).where(
                TaskNote.user_id == user.id,
                TaskNote.task_id == task_id,
            )
        )
        note = note_result.scalar_one_or_none()
        if note:
            my_note = note.content
    
    # Get pending proposals count
    proposals_result = await db.execute(
        select(func.count(TaskEditProposal.id)).where(
            TaskEditProposal.task_id == task_id,
            TaskEditProposal.status == EditProposalStatus.PENDING,
        )
    )
    pending_proposals_count = proposals_result.scalar() or 0
    
    return TaskResponse(
        id=task.id,
        course_id=task.course_id,
        course_name=course_name,
        course_abbr=course_abbr,
        title=task.title,
        description=task.description,
        due_time=task.due_time,
        creator_id=task.creator_id,
        creator_nickname=creator_nickname,
        status=_map_task_status(task.status),
        upvotes=task.upvotes,
        downvotes=task.downvotes,
        is_reported=task.is_reported,
        my_vote=my_vote,
        my_note=my_note,
        pending_proposals_count=pending_proposals_count,
        created_at=task.created_at,
    )


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    data: TaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建任务（DDL）"""
    # Verify course exists
    course_result = await db.execute(
        select(Course).where(Course.id == data.course_id)
    )
    course = course_result.scalar_one_or_none()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="课程不存在",
        )
    
    # Determine initial status based on user karma
    initial_status = TaskStatus.VERIFIED if should_auto_verify(user.karma) else TaskStatus.PENDING
    
    task = Task(
        course_id=data.course_id,
        title=data.title,
        description=data.description,
        due_time=data.due_time,
        creator_id=user.id,
        status=initial_status,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    
    return TaskResponse(
        id=task.id,
        course_id=task.course_id,
        course_name=course.name,
        course_abbr=course.name_abbr,
        title=task.title,
        description=task.description,
        due_time=task.due_time,
        creator_id=task.creator_id,
        creator_nickname=user.nickname,
        status=_map_task_status(task.status),
        upvotes=task.upvotes,
        downvotes=task.downvotes,
        is_reported=task.is_reported,
        my_vote=None,
        created_at=task.created_at,
    )


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: int,
    data: TaskUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新任务（仅创建者可编辑）"""
    result = await db.execute(
        select(Task, Course.name, Course.name_abbr)
        .join(Course, Task.course_id == Course.id)
        .where(Task.id == task_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    task, course_name, course_abbr = row
    
    if task.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有创建者可以编辑任务",
        )
    
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)
    
    return TaskResponse(
        id=task.id,
        course_id=task.course_id,
        course_name=course_name,
        course_abbr=course_abbr,
        title=task.title,
        description=task.description,
        due_time=task.due_time,
        creator_id=task.creator_id,
        creator_nickname=user.nickname,
        status=_map_task_status(task.status),
        upvotes=task.upvotes,
        downvotes=task.downvotes,
        is_reported=task.is_reported,
        my_vote=None,
        created_at=task.created_at,
    )


@router.post("/{task_id}/vote")
async def vote_task(
    task_id: int,
    data: VoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """对任务投票（确认真实/报错）"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    # Check existing vote
    vote_result = await db.execute(
        select(TaskVote).where(
            TaskVote.user_id == user.id,
            TaskVote.task_id == task_id,
        )
    )
    old_vote = vote_result.scalar_one_or_none()
    
    vote_type = VoteType.UPVOTE if data.vote_type == VoteTypeEnum.UPVOTE else VoteType.DOWNVOTE
    
    await process_vote(db, task, user, vote_type, old_vote)
    
    return {
        "message": "投票成功",
        "upvotes": task.upvotes,
        "downvotes": task.downvotes,
        "status": _map_task_status(task.status),
    }


@router.post("/{task_id}/report")
async def report_task(
    task_id: int,
    data: ReportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """举报任务"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    task.is_reported = True
    return {"message": "举报成功，管理员将尽快审核"}


@router.delete("/{task_id}")
async def delete_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除任务（仅创建者可删除）"""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在",
        )
    
    if task.creator_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有创建者可以删除任务",
        )
    
    await db.delete(task)
    return {"message": "删除成功"}


@router.post("/{task_id}/complete")
async def mark_task_completed(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """标记任务为已完成"""
    # Check task exists
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # Check if already completed
    existing = await db.execute(
        select(TaskCompletion).where(
            TaskCompletion.user_id == user.id,
            TaskCompletion.task_id == task_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "已经标记为完成"}
    
    completion = TaskCompletion(user_id=user.id, task_id=task_id)
    db.add(completion)
    await db.commit()
    return {"message": "标记成功"}


@router.delete("/{task_id}/complete")
async def unmark_task_completed(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消任务已完成标记"""
    await db.execute(
        delete(TaskCompletion).where(
            TaskCompletion.user_id == user.id,
            TaskCompletion.task_id == task_id,
        )
    )
    await db.commit()
    return {"message": "取消标记成功"}


# ================== Task Notes API ==================

@router.get("/{task_id}/note", response_model=TaskNoteResponse)
async def get_task_note(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取用户对任务的私人备注"""
    result = await db.execute(
        select(TaskNote).where(
            TaskNote.user_id == user.id,
            TaskNote.task_id == task_id,
        )
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="暂无备注")
    return TaskNoteResponse(
        task_id=note.task_id,
        content=note.content,
        updated_at=note.updated_at,
    )


@router.put("/{task_id}/note", response_model=TaskNoteResponse)
async def update_task_note(
    task_id: int,
    data: TaskNoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建或更新用户对任务的私人备注"""
    # Verify task exists
    task_result = await db.execute(select(Task).where(Task.id == task_id))
    if not task_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # Find existing note
    result = await db.execute(
        select(TaskNote).where(
            TaskNote.user_id == user.id,
            TaskNote.task_id == task_id,
        )
    )
    note = result.scalar_one_or_none()
    
    if note:
        note.content = data.content
    else:
        note = TaskNote(user_id=user.id, task_id=task_id, content=data.content)
        db.add(note)
    
    await db.commit()
    await db.refresh(note)
    
    return TaskNoteResponse(
        task_id=note.task_id,
        content=note.content,
        updated_at=note.updated_at,
    )


@router.delete("/{task_id}/note")
async def delete_task_note(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除用户对任务的私人备注"""
    await db.execute(
        delete(TaskNote).where(
            TaskNote.user_id == user.id,
            TaskNote.task_id == task_id,
        )
    )
    await db.commit()
    return {"message": "备注已删除"}


# ================== Edit Proposals API ==================

@router.get("/{task_id}/proposals", response_model=list[EditProposalResponse])
async def get_task_proposals(
    task_id: int,
    status_filter: Optional[EditProposalStatusEnum] = Query(None, alias="status"),
    user: Optional[User] = Depends(get_current_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """获取任务的修改提案列表"""
    query = (
        select(TaskEditProposal, User.nickname)
        .outerjoin(User, TaskEditProposal.proposer_id == User.id)
        .where(TaskEditProposal.task_id == task_id)
    )
    
    if status_filter:
        query = query.where(TaskEditProposal.status == EditProposalStatus(status_filter.value.upper()))
    else:
        # Default: show pending proposals
        query = query.where(TaskEditProposal.status == EditProposalStatus.PENDING)
    
    query = query.order_by(TaskEditProposal.created_at.desc())
    
    result = await db.execute(query)
    rows = result.all()
    
    # Get user's votes
    user_votes = {}
    if user and rows:
        proposal_ids = [row[0].id for row in rows]
        votes_result = await db.execute(
            select(ProposalVote).where(
                ProposalVote.user_id == user.id,
                ProposalVote.proposal_id.in_(proposal_ids),
            )
        )
        for vote in votes_result.scalars().all():
            user_votes[vote.proposal_id] = vote.vote_type
    
    return [
        EditProposalResponse(
            id=proposal.id,
            task_id=proposal.task_id,
            proposer_id=proposal.proposer_id,
            proposer_nickname=nickname,
            new_description=proposal.new_description,
            reason=proposal.reason,
            status=EditProposalStatusEnum(proposal.status.value.lower()),
            upvotes=proposal.upvotes,
            downvotes=proposal.downvotes,
            my_vote=VoteTypeEnum(user_votes[proposal.id].value) if proposal.id in user_votes else None,
            created_at=proposal.created_at,
        )
        for proposal, nickname in rows
    ]


@router.post("/{task_id}/proposals", response_model=EditProposalResponse, status_code=status.HTTP_201_CREATED)
async def create_edit_proposal(
    task_id: int,
    data: EditProposalCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """提交任务描述修改提案"""
    # Verify task exists
    task_result = await db.execute(select(Task).where(Task.id == task_id))
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # Create proposal
    proposal = TaskEditProposal(
        task_id=task_id,
        proposer_id=user.id,
        new_description=data.new_description,
        reason=data.reason,
    )
    db.add(proposal)
    await db.flush()
    await db.refresh(proposal)
    
    # If high karma user, auto-approve
    if user.karma >= 50:
        proposal.status = EditProposalStatus.APPROVED
        proposal.resolved_at = datetime.utcnow()
        task.description = proposal.new_description
    
    await db.commit()
    
    return EditProposalResponse(
        id=proposal.id,
        task_id=proposal.task_id,
        proposer_id=proposal.proposer_id,
        proposer_nickname=user.nickname,
        new_description=proposal.new_description,
        reason=proposal.reason,
        status=EditProposalStatusEnum(proposal.status.value.lower()),
        upvotes=proposal.upvotes,
        downvotes=proposal.downvotes,
        my_vote=None,
        created_at=proposal.created_at,
    )


@router.post("/{task_id}/proposals/{proposal_id}/vote")
async def vote_proposal(
    task_id: int,
    proposal_id: int,
    data: VoteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """对修改提案投票"""
    # Get proposal
    result = await db.execute(
        select(TaskEditProposal, Task)
        .join(Task, TaskEditProposal.task_id == Task.id)
        .where(
            TaskEditProposal.id == proposal_id,
            TaskEditProposal.task_id == task_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="提案不存在")
    
    proposal, task = row
    
    if proposal.status != EditProposalStatus.PENDING:
        raise HTTPException(status_code=400, detail="该提案已处理")
    
    # Check existing vote
    vote_result = await db.execute(
        select(ProposalVote).where(
            ProposalVote.user_id == user.id,
            ProposalVote.proposal_id == proposal_id,
        )
    )
    existing_vote = vote_result.scalar_one_or_none()
    
    vote_type = VoteType.UPVOTE if data.vote_type == VoteTypeEnum.UPVOTE else VoteType.DOWNVOTE
    
    if existing_vote:
        if existing_vote.vote_type == vote_type:
            # Cancel vote
            if vote_type == VoteType.UPVOTE:
                proposal.upvotes -= 1
            else:
                proposal.downvotes -= 1
            await db.delete(existing_vote)
        else:
            # Change vote
            if vote_type == VoteType.UPVOTE:
                proposal.upvotes += 1
                proposal.downvotes -= 1
            else:
                proposal.upvotes -= 1
                proposal.downvotes += 1
            existing_vote.vote_type = vote_type
    else:
        # New vote
        new_vote = ProposalVote(user_id=user.id, proposal_id=proposal_id, vote_type=vote_type)
        db.add(new_vote)
        if vote_type == VoteType.UPVOTE:
            proposal.upvotes += 1
        else:
            proposal.downvotes += 1
    
    # Check auto-approval/rejection
    net_votes = proposal.upvotes - proposal.downvotes
    if net_votes >= PROPOSAL_APPROVE_THRESHOLD:
        proposal.status = EditProposalStatus.APPROVED
        proposal.resolved_at = datetime.utcnow()
        task.description = proposal.new_description
    elif net_votes <= PROPOSAL_REJECT_THRESHOLD:
        proposal.status = EditProposalStatus.REJECTED
        proposal.resolved_at = datetime.utcnow()
    
    await db.commit()
    
    return {
        "message": "投票成功",
        "upvotes": proposal.upvotes,
        "downvotes": proposal.downvotes,
        "status": EditProposalStatusEnum(proposal.status.value.lower()),
    }
