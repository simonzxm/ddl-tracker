import bcrypt
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole
from app.config import get_settings

settings = get_settings()


def hash_password(password: str) -> str:
    # Encode to bytes and hash
    password_bytes = password.encode('utf-8')[:72]  # bcrypt 72-byte limit
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password_bytes, salt).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_bytes = plain_password.encode('utf-8')[:72]
    hashed_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hashed_bytes)


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(User.email == email.lower())
    )
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession,
    email: str,
    nickname: str,
    password: str,
    role: UserRole = UserRole.STUDENT,
) -> User:
    # First registered user automatically becomes admin
    user_count = await db.scalar(select(func.count()).select_from(User))
    if user_count == 0:
        role = UserRole.ADMIN
    
    user = User(
        email=email.lower(),
        nickname=nickname,
        password_hash=hash_password(password),
        role=role,
        karma=100 if role == UserRole.ADMIN else 0,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


async def authenticate_user(
    db: AsyncSession, email: str, password: str
) -> User | None:
    user = await get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def is_admin(user: User) -> bool:
    return user.role == UserRole.ADMIN
