from typing import Optional
from fastapi import Depends, HTTPException, status, Cookie, Request
from sqlalchemy.ext.asyncio import AsyncSession
from redis.asyncio import Redis

from app.database import get_db
from app.redis import get_redis, SessionManager, RateLimiter
from app.models import User, UserRole
from app.services.auth import get_user_by_id


async def get_session_manager(redis: Redis = Depends(get_redis)) -> SessionManager:
    return SessionManager(redis)


async def get_rate_limiter(redis: Redis = Depends(get_redis)) -> RateLimiter:
    return RateLimiter(redis)


async def get_current_user_optional(
    request: Request,
    session_id: Optional[str] = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
    session_manager: SessionManager = Depends(get_session_manager),
) -> Optional[User]:
    """Get current user if authenticated, otherwise return None"""
    if not session_id:
        return None
    
    session_data = await session_manager.get(session_id)
    if not session_data:
        return None
    
    user = await get_user_by_id(db, session_data["user_id"])
    if not user:
        return None
    
    # Refresh session
    await session_manager.refresh(session_id)
    return user


async def get_current_user(
    user: Optional[User] = Depends(get_current_user_optional),
) -> User:
    """Get current user, raise 401 if not authenticated"""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或会话已过期",
        )
    return user


async def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Get current user and verify admin role"""
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user


def require_rate_limit(action: str, max_requests: int, window_seconds: int):
    """Factory for rate limit dependency"""
    async def rate_limit_check(
        request: Request,
        rate_limiter: RateLimiter = Depends(get_rate_limiter),
    ):
        # Use IP as identifier
        client_ip = request.client.host if request.client else "unknown"
        
        if not await rate_limiter.is_allowed(client_ip, action, max_requests, window_seconds):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"请求过于频繁，请 {window_seconds} 秒后重试",
            )
        return True
    
    return rate_limit_check
