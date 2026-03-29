from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ddl_tracker"
    
    # Redis
    redis_url: str = "redis://localhost:6379/0"
    
    # Session
    session_secret_key: str = "dev-secret-key-change-in-production"
    session_expire_seconds: int = 86400  # 24 hours
    
    # Email
    smtp_host: str = "smtp.example.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "DDL Tracker <noreply@example.com>"
    
    # App
    app_env: str = "development"
    debug: bool = True
    allowed_email_domains: str = "smail.nju.edu.cn,nju.edu.cn"
    
    # Karma thresholds
    karma_verified_threshold: int = 50
    karma_hidden_threshold: int = -10
    karma_upvote_gain: int = 5
    karma_downvote_loss: int = 2
    
    @property
    def allowed_domains_list(self) -> list[str]:
        return [d.strip() for d in self.allowed_email_domains.split(",")]
    
    class Config:
        # Look for .env in project root (parent of backend/)
        env_file = str(Path(__file__).resolve().parent.parent.parent / ".env")
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
