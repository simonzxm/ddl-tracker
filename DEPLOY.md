# 🚀 DDL Tracker 部署指南

## 部署架构

```
外部网关 (Nginx Proxy Manager / PVE / Traefik)
        │
        ▼ 反代到 :8000
┌───────────────────────────────────┐
│   Docker Compose                  │
│   ┌──────────┐                    │
│   │ FastAPI  │ (:8000)            │
│   └────┬─────┘                    │
│        │                          │
│   ┌────┴────┬─────────┐           │
│   ▼         ▼         │           │
│ ┌──────┐ ┌───────┐    │           │
│ │Postgr│ │ Redis │    │           │
│ └──────┘ └───────┘    │           │
└───────────────────────┘
   Admin Panel (静态托管)
   Mobile App (独立分发)
```

---

## 一、服务器准备

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 Docker Compose v2
sudo apt install docker-compose-plugin

# 验证
docker --version && docker compose version
```

---

## 二、部署步骤

### 1. 获取代码

```bash
git clone https://github.com/your-org/ddl-tracker.git
cd ddl-tracker
```

### 2. 配置环境变量

```bash
cp .env.example .env
nano .env
```

**必须修改**：
```env
POSTGRES_PASSWORD=你的数据库密码
SESSION_SECRET_KEY=随机字符串
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=DDL Tracker <noreply@example.com>
APP_ENV=production
DEBUG=false
```

> 生成随机密钥：`openssl rand -hex 32`

### 3. 启动服务

```bash
docker compose up -d --build

# 验证
docker compose ps
curl http://localhost:8000/health
```

### 4. 初始化数据库 + 创建管理员

先创建初始化脚本：

```bash
cat > init_db.py << 'EOF'
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
import os

async def setup():
    engine = create_async_engine(os.environ["DATABASE_URL"])
    
    from app.database import Base
    from app.models import User, UserRole, Course, Task
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ 数据库表创建完成")
    
    from app.services.auth import hash_password
    Session = async_sessionmaker(engine, class_=AsyncSession)
    async with Session() as db:
        result = await db.execute(text("SELECT id FROM users LIMIT 1"))
        if result.first():
            print("✓ 已有用户，跳过创建管理员")
        else:
            admin = User(
                email="admin@nju.edu.cn",       # ← 改成你的邮箱
                nickname="管理员",               # ← 改成你的昵称  
                password_hash=hash_password("your-password"),  # ← 改成你的密码
                role=UserRole.ADMIN,
                karma=100
            )
            db.add(admin)
            await db.commit()
            print("✓ 管理员创建完成")
    await engine.dispose()

asyncio.run(setup())
EOF
```

然后执行：

```bash
# 复制脚本到容器并执行
docker compose cp init_db.py api:/app/init_db.py
docker compose exec api python init_db.py

# 清理
rm init_db.py
docker compose exec api rm init_db.py
```

---

## 三、Admin Panel

在**本地或服务器**构建静态文件：

```bash
cd admin-panel
npm install && npm run build
```

然后通过网关托管 `admin-panel/dist/` 目录。

---

## 四、Mobile App

> Mobile 在**本地开发机**打包，不在服务器。

### 1. 配置 API 地址

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=https://your-api-domain.com
```

### 2. 打包

```bash
cd mobile
npm install

# Android
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk

# 或使用 EAS Build
eas build --platform android
```

---

## 五、运维

```bash
# 日志
docker compose logs -f api

# 重启
docker compose restart api

# 备份数据库
docker compose exec db pg_dump -U postgres ddl_tracker > backup.sql

# 更新
git pull && docker compose up -d --build
```

---

## 检查清单

- [ ] `.env` 已配置（密码、SMTP）
- [ ] `docker compose ps` 全部 healthy
- [ ] 数据库初始化完成
- [ ] 管理员账户已创建
- [ ] 网关反代配置完成
- [ ] `mobile/.env` API 地址正确
