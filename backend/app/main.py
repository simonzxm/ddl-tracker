from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.redis import get_redis, close_redis
from app.routers import auth, courses, tasks, admin

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await get_redis()
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title="Campus DDL Tracker API",
    description="DDL tracking and task management system for students",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware - when credentials=True, cannot use wildcard "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://localhost:3000", "http://localhost:4321"] if settings.debug else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(courses.router, prefix="/api/courses", tags=["课程"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["任务"])
app.include_router(admin.router, prefix="/api/admin", tags=["管理"])


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
