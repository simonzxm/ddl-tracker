import json
import secrets
from typing import Optional
from redis.asyncio import Redis, from_url

from app.config import get_settings

settings = get_settings()

redis_client: Optional[Redis] = None


async def get_redis() -> Redis:
    global redis_client
    if redis_client is None:
        redis_client = await from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return redis_client


async def close_redis():
    global redis_client
    if redis_client:
        await redis_client.close()
        redis_client = None


class SessionManager:
    """Session management using Redis"""
    
    PREFIX = "session:"
    
    def __init__(self, redis: Redis):
        self.redis = redis
        self.expire_seconds = settings.session_expire_seconds
    
    def _key(self, session_id: str) -> str:
        return f"{self.PREFIX}{session_id}"
    
    async def create(self, user_id: int, user_data: dict) -> str:
        """Create a new session and return session_id"""
        session_id = secrets.token_urlsafe(32)
        data = {"user_id": user_id, **user_data}
        await self.redis.setex(
            self._key(session_id),
            self.expire_seconds,
            json.dumps(data),
        )
        return session_id
    
    async def get(self, session_id: str) -> Optional[dict]:
        """Get session data by session_id"""
        data = await self.redis.get(self._key(session_id))
        if data:
            return json.loads(data)
        return None
    
    async def refresh(self, session_id: str) -> bool:
        """Refresh session expiry"""
        return await self.redis.expire(self._key(session_id), self.expire_seconds)
    
    async def delete(self, session_id: str) -> bool:
        """Delete session (logout)"""
        return await self.redis.delete(self._key(session_id)) > 0


class VerificationCodeManager:
    """Email verification code management"""
    
    PREFIX = "verify:"
    COOLDOWN_PREFIX = "verify_cooldown:"
    CODE_LENGTH = 6
    EXPIRE_SECONDS = 600  # 10 minutes
    COOLDOWN_SECONDS = 60  # 60 seconds before resend
    
    def __init__(self, redis: Redis):
        self.redis = redis
    
    def _key(self, email: str) -> str:
        return f"{self.PREFIX}{email.lower()}"
    
    def _cooldown_key(self, email: str) -> str:
        return f"{self.COOLDOWN_PREFIX}{email.lower()}"
    
    def _generate_code(self) -> str:
        return "".join([str(secrets.randbelow(10)) for _ in range(self.CODE_LENGTH)])
    
    async def create(self, email: str) -> str:
        """Generate and store verification code"""
        code = self._generate_code()
        await self.redis.setex(
            self._key(email),
            self.EXPIRE_SECONDS,
            code,
        )
        # Set cooldown
        await self.redis.setex(
            self._cooldown_key(email),
            self.COOLDOWN_SECONDS,
            "1",
        )
        return code
    
    async def verify(self, email: str, code: str) -> bool:
        """Verify code and delete if correct"""
        stored = await self.redis.get(self._key(email))
        if stored and stored == code:
            await self.redis.delete(self._key(email))
            await self.redis.delete(self._cooldown_key(email))
            return True
        return False
    
    async def is_in_cooldown(self, email: str) -> bool:
        """Check if in cooldown period (can't resend yet)"""
        return await self.redis.exists(self._cooldown_key(email)) > 0
    
    async def exists(self, email: str) -> bool:
        """Check if a code already exists for this email"""
        return await self.redis.exists(self._key(email)) > 0


class RateLimiter:
    """Simple rate limiter for API endpoints"""
    
    PREFIX = "ratelimit:"
    
    def __init__(self, redis: Redis):
        self.redis = redis
    
    def _key(self, identifier: str, action: str) -> str:
        return f"{self.PREFIX}{action}:{identifier}"
    
    async def is_allowed(
        self, identifier: str, action: str, max_requests: int, window_seconds: int
    ) -> bool:
        """Check if request is allowed within rate limit"""
        key = self._key(identifier, action)
        current = await self.redis.get(key)
        
        if current is None:
            await self.redis.setex(key, window_seconds, 1)
            return True
        
        if int(current) >= max_requests:
            return False
        
        await self.redis.incr(key)
        return True
