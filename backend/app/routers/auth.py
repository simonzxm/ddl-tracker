from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from redis.asyncio import Redis

from app.database import get_db
from app.redis import get_redis, SessionManager, VerificationCodeManager
from app.schemas.user import (
    SendVerificationCodeRequest,
    RegisterRequest,
    LoginRequest,
    ChangePasswordRequest,
    AuthResponse,
    UserResponse,
    MessageResponse,
)
from app.services.auth import (
    get_user_by_email,
    create_user,
    authenticate_user,
    hash_password,
    verify_password,
)
from app.services.email import send_verification_email
from app.dependencies import (
    get_current_user,
    get_session_manager,
    require_rate_limit,
)
from app.models import User

router = APIRouter()


@router.post(
    "/send-code",
    response_model=MessageResponse,
    dependencies=[Depends(require_rate_limit("send_code", 3, 60))],
)
async def send_verification_code(
    data: SendVerificationCodeRequest,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """发送邮箱验证码"""
    # Check if email already registered
    existing = await get_user_by_email(db, data.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已注册",
        )
    
    # Generate and store code
    code_manager = VerificationCodeManager(redis)
    
    # Check cooldown (60 seconds)
    if await code_manager.is_in_cooldown(data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请等待60秒后再重新发送验证码",
        )
    
    code = await code_manager.create(data.email)
    
    # Send email
    success = await send_verification_email(data.email, code)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="验证码发送失败，请稍后重试",
        )
    
    return {"message": "验证码已发送，请查收邮箱"}


@router.post(
    "/register",
    response_model=AuthResponse,
    dependencies=[Depends(require_rate_limit("register", 30, 3600))],
)
async def register(
    data: RegisterRequest,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """注册新用户"""
    # Check if email already registered
    existing = await get_user_by_email(db, data.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已注册",
        )
    
    # Verify code
    code_manager = VerificationCodeManager(redis)
    if not await code_manager.verify(data.email, data.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或已过期",
        )
    
    # Create user
    user = await create_user(db, data.email, data.nickname, data.password)
    
    # Create session
    session_manager = SessionManager(redis)
    session_id = await session_manager.create(
        user.id,
        {"email": user.email, "role": user.role.value},
    )
    
    # Set cookie
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=86400,
    )
    
    return AuthResponse(
        message="注册成功",
        user=UserResponse(
            id=user.id,
            email=user.email,
            nickname=user.nickname,
            karma=user.karma,
            role=user.role.value,
            created_at=user.created_at,
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    data: LoginRequest,
    response: Response,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
):
    """用户登录"""
    user = await authenticate_user(db, data.email, data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )
    
    # Create session
    session_manager = SessionManager(redis)
    session_id = await session_manager.create(
        user.id,
        {"email": user.email, "role": user.role.value},
    )
    
    # Set cookie
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=86400,
    )
    
    return AuthResponse(
        message="登录成功",
        user=UserResponse(
            id=user.id,
            email=user.email,
            nickname=user.nickname,
            karma=user.karma,
            role=user.role.value,
            created_at=user.created_at,
        ),
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    request: Request,
    session_manager: SessionManager = Depends(get_session_manager),
):
    """用户登出"""
    session_id = request.cookies.get("session_id")
    if session_id:
        await session_manager.delete(session_id)
    
    response.delete_cookie("session_id")
    return {"message": "已登出"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    user: User = Depends(get_current_user),
):
    """获取当前登录用户信息"""
    return UserResponse(
        id=user.id,
        email=user.email,
        nickname=user.nickname,
        karma=user.karma,
        role=user.role.value,
        created_at=user.created_at,
    )


@router.put("/password", response_model=MessageResponse)
async def change_password(
    data: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """修改密码"""
    if not verify_password(data.old_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="原密码错误",
        )
    
    user.password_hash = hash_password(data.new_password)
    return {"message": "密码修改成功"}
