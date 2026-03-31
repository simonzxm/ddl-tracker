from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime

from app.config import get_settings

settings = get_settings()


class EmailValidatorMixin:
    @field_validator("email")
    @classmethod
    def validate_edu_email(cls, v: str) -> str:
        domain = v.split("@")[-1].lower()
        if domain not in settings.allowed_domains_list:
            allowed = ", ".join(settings.allowed_domains_list)
            raise ValueError(f"仅支持教育邮箱注册，允许的域名: {allowed}")
        return v.lower()


# Request schemas
class SendVerificationCodeRequest(BaseModel, EmailValidatorMixin):
    email: EmailStr


class RegisterRequest(BaseModel, EmailValidatorMixin):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    nickname: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    nickname: Optional[str] = Field(None, min_length=2, max_length=50)
    avatar_color: Optional[str] = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')


# Response schemas
class UserResponse(BaseModel):
    id: int
    email: str
    nickname: str
    avatar_color: Optional[str] = None
    karma: int
    role: str
    created_at: datetime
    
    class Config:
        from_attributes = True


class UserProfileResponse(UserResponse):
    followed_courses_count: int = 0
    created_tasks_count: int = 0


class AuthResponse(BaseModel):
    message: str
    user: Optional[UserResponse] = None


class MessageResponse(BaseModel):
    message: str
