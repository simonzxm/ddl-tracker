from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, Task, TaskVote, VoteType, TaskStatus
from app.config import get_settings

settings = get_settings()


async def update_user_karma(db: AsyncSession, user_id: int, delta: int) -> int:
    """Update user karma and return new value"""
    result = await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(karma=User.karma + delta)
        .returning(User.karma)
    )
    new_karma = result.scalar_one()
    return new_karma


async def process_vote(
    db: AsyncSession,
    task: Task,
    user: User,
    vote_type: VoteType,
    old_vote: TaskVote | None,
) -> None:
    """Process vote and update karma accordingly"""
    creator_id = task.creator_id
    
    if old_vote:
        # Reverse old vote effects
        if old_vote.vote_type == VoteType.UPVOTE:
            task.upvotes -= 1
            if creator_id:
                await update_user_karma(db, creator_id, -settings.karma_upvote_gain)
        else:
            task.downvotes -= 1
            if creator_id:
                await update_user_karma(db, creator_id, settings.karma_downvote_loss)
        
        # If same vote type, just remove it
        if old_vote.vote_type == vote_type:
            await db.delete(old_vote)
            await update_task_status(db, task)
            return
        
        # Update vote type
        old_vote.vote_type = vote_type
    else:
        # Create new vote
        new_vote = TaskVote(
            user_id=user.id,
            task_id=task.id,
            vote_type=vote_type,
        )
        db.add(new_vote)
    
    # Apply new vote effects
    if vote_type == VoteType.UPVOTE:
        task.upvotes += 1
        if creator_id:
            await update_user_karma(db, creator_id, settings.karma_upvote_gain)
    else:
        task.downvotes += 1
        if creator_id:
            await update_user_karma(db, creator_id, -settings.karma_downvote_loss)
    
    await update_task_status(db, task)


async def update_task_status(db: AsyncSession, task: Task) -> None:
    """Update task status based on votes and creator karma"""
    score = task.upvotes - task.downvotes
    
    # Auto-hide if too many downvotes
    if score <= settings.karma_hidden_threshold:
        task.status = TaskStatus.HIDDEN
        return
    
    # Check if creator is high-karma user
    if task.creator_id:
        result = await db.execute(
            select(User.karma).where(User.id == task.creator_id)
        )
        creator_karma = result.scalar_one_or_none()
        if creator_karma and creator_karma >= settings.karma_verified_threshold:
            task.status = TaskStatus.VERIFIED
            return
    
    # Verify if enough upvotes
    if task.upvotes >= 3 and score >= 2:
        task.status = TaskStatus.VERIFIED
    else:
        task.status = TaskStatus.PENDING


def should_auto_verify(user_karma: int) -> bool:
    """Check if user's karma is high enough for auto-verification"""
    return user_karma >= settings.karma_verified_threshold


def should_hide_content(user_karma: int) -> bool:
    """Check if user's karma is too low (content should be hidden)"""
    return user_karma <= settings.karma_hidden_threshold
