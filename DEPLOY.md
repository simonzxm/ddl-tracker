# 🚀 DDL Tracker 部署指南

## 部署架构

### 方案 A：简化部署（推荐用于 PVE/外部网关）

```
外部网关 (Nginx Proxy Manager / Traefik / PVE)
        │
        ▼ 反代到 :8000
┌───────────────────────────────────┐
│   Docker Compose (simple)         │
│   ┌──────────┐                    │
│   │ FastAPI  │◄──┐                │
│   │ (8000)   │   │                │
│   └────┬─────┘   │                │
│        │         │                │
│   ┌────┴────┬────┴────┐           │
│   ▼         ▼         │           │
│ ┌──────┐ ┌───────┐    │           │
│ │Postgr│ │ Redis │    │           │
│ │(内部)│ │(内部) │    │           │
│ └──────┘ └───────┘    │           │
└───────────────────────┼───────────┘
                        │
   Admin Panel ─────────┘ (静态托管在网关或单独服务)
   Mobile App (独立分发)
```

### 方案 B：完整部署（自带 Nginx）

使用默认的 `docker-compose.yml`，包含 Nginx 容器。

---

## 一、准备工作

### 1. 服务器要求
- **系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **配置**: 最低 1C2G，推荐 2C4G
- **存储**: 20GB+ SSD

### 2. 安装 Docker 和 Docker Compose

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 安装 Docker Compose (v2)
sudo apt install docker-compose-plugin

# 验证安装
docker --version
docker compose version
```

---

## 二、部署步骤

### 1. 上传代码到服务器

```bash
# 方式一：Git clone（推荐）
git clone https://github.com/your-username/ddl-tracker.git
cd ddl-tracker

# 方式二：SCP 上传
scp -r ./ddl-tracker user@your-server:/home/user/
```

### 2. 配置环境变量

```bash
# 复制示例配置
cp .env.example .env

# 编辑配置
nano .env
```

**必须修改的配置**：

```env
# 数据库密码 (使用强密码，建议 32 位随机)
POSTGRES_PASSWORD=your-strong-password-here

# Session 密钥 (随机生成)
SESSION_SECRET_KEY=your-random-session-key

# 生成随机密钥的方法:
# openssl rand -hex 32

# SMTP 邮箱配置 (用于发送验证码)
SMTP_HOST=smtp.your-mail-provider.com
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=DDL Tracker <noreply@your-domain.com>

# 生产环境
APP_ENV=production
DEBUG=false

# 允许的邮箱域名
ALLOWED_EMAIL_DOMAINS=smail.nju.edu.cn,nju.edu.cn
```

### 3. 启动服务

```bash
# 先构建 Admin Panel
cd admin-panel && npm install && npm run build && cd ..

# 启动所有服务
docker compose up -d --build
```

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 4. 初始化数据库

```bash
# 进入 API 容器执行数据库迁移
docker compose exec api python -c "
from app.database import engine, Base
import asyncio
async def init():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
asyncio.run(init())
print('Database initialized!')
"
```

### 5. 创建管理员账户

```bash
# 进入容器的 Python shell
docker compose exec api python

# 在 Python shell 中执行:
```

```python
import asyncio
from app.database import async_session
from app.models import User, UserRole

async def create_admin():
    async with async_session() as db:
        admin = User(
            email="admin@nju.edu.cn",
            nickname="系统管理员",
            role=UserRole.ADMIN,
            is_verified=True,
            karma=100
        )
        db.add(admin)
        await db.commit()
        print("Admin created!")

asyncio.run(create_admin())
exit()
```

---

## 三、Admin Panel 部署

### 方案 A：使用外部网关

构建静态文件，然后通过你的网关托管：

```bash
cd admin-panel
npm install
npm run build
```

构建产物在 `admin-panel/dist/`，配置网关将 `/admin` 路径指向这个目录，或单独托管。

### 方案 B：使用内置 Nginx

已包含在 `docker-compose.yml` 中，自动挂载 `admin-panel/dist/` 到 `/admin` 路径。

---

## 四、Mobile App 构建

> ⚠️ Mobile 在**本地开发机**打包，不在服务器上。

### 1. 配置 API 地址

编辑 `mobile/.env`：

```env
# 改为你的服务器地址（必须是 HTTPS 或同局域网）
EXPO_PUBLIC_API_URL=https://your-domain.com
```

### 2. 本地开发测试

```bash
cd mobile
npm install
npx expo start
```

### 3. 打包 Android APK

```bash
# 方式一：本地打包
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease

# APK 位置: android/app/build/outputs/apk/release/app-release.apk

# 方式二：使用 EAS Build（云端打包，推荐）
npm install -g eas-cli
eas login
eas build --platform android --profile production
```

### 4. 打包 iOS

需要 macOS + Xcode + Apple Developer 账号：

```bash
npx expo prebuild --platform ios
cd ios && pod install
# 在 Xcode 中打开 ios/*.xcworkspace 进行打包
```

或使用 EAS Build：
```bash
eas build --platform ios --profile production
```

---

## 五、PVE 网关配置示例

如果使用 Nginx Proxy Manager，添加以下代理：

| 域名 | 目标 | 说明 |
|------|------|------|
| `api.your-domain.com` | `http://容器IP:8000` | 后端 API |
| `admin.your-domain.com` | 静态文件目录 | Admin Panel |

然后修改 `mobile/.env`：
```env
EXPO_PUBLIC_API_URL=https://api.your-domain.com
```

---

## 六、运维命令

### 日常管理

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f api
docker compose logs --tail=100

# 重启服务
docker compose restart api

# 停止服务
docker compose down
```

### 数据库备份

```bash
# 备份
docker compose exec db pg_dump -U postgres ddl_tracker > backup_$(date +%Y%m%d).sql

# 恢复
docker compose exec -T db psql -U postgres ddl_tracker < backup_20260401.sql
```

### 更新部署

```bash
git pull origin main

# 方案 A
docker compose -f docker-compose.simple.yml up -d --build

# 方案 B
cd admin-panel && npm run build && cd ..
docker compose up -d --build
```

---

## 七、常见问题

### Q: API 连接失败
```bash
# 检查服务状态
docker compose ps

# 检查日志
docker compose logs api

# 测试健康检查
curl http://localhost:8000/health
```

### Q: 数据库连接失败
```bash
docker compose logs db
docker compose exec api ping db
```

### Q: 邮件发送失败
检查 `.env` 中的 SMTP 配置是否正确。

---

## 快速部署检查清单

- [ ] `.env` 配置完成（POSTGRES_PASSWORD, SESSION_SECRET_KEY, SMTP）
- [ ] `docker compose up -d --build` 成功
- [ ] `docker compose ps` 显示所有服务 healthy
- [ ] 数据库初始化完成
- [ ] 管理员账户创建完成
- [ ] 网关/反代配置完成（HTTPS）
- [ ] `mobile/.env` 配置正确的 API 地址
- [ ] Mobile App 打包测试通过
