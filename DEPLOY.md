# 🚀 DDL Tracker 部署指南

## 部署架构

```
┌─────────────────────────────────────────────────────────┐
│                     Nginx (80/443)                       │
│   ┌─────────────┬─────────────┬─────────────────────┐   │
│   │  /api/*     │  /admin/*   │  /docs              │   │
│   └──────┬──────┴──────┬──────┴──────────┬──────────┘   │
│          │             │                 │              │
│          ▼             ▼                 ▼              │
│   ┌────────────┐ ┌───────────┐    ┌────────────┐       │
│   │ FastAPI    │ │ 静态文件   │    │ Swagger UI │       │
│   │ (8000)     │ │ (admin)   │    │            │       │
│   └─────┬──────┘ └───────────┘    └────────────┘       │
│         │                                               │
│   ┌─────┴─────┬─────────────┐                          │
│   ▼           ▼             ▼                          │
│ ┌──────┐  ┌───────┐  ┌───────────┐                     │
│ │Postgr│  │ Redis │  │ Mobile App│ (独立分发)          │
│ │(5432)│  │(6379) │  └───────────┘                     │
│ └──────┘  └───────┘                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 一、准备工作

### 1. 服务器要求
- **系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **配置**: 最低 1C2G，推荐 2C4G
- **存储**: 20GB+ SSD
- **网络**: 开放 80, 443 端口

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
# 数据库密码 (使用强密码)
POSTGRES_PASSWORD=your-strong-password-here

# Session 密钥 (随机生成)
SESSION_SECRET_KEY=$(openssl rand -hex 32)

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

### 3. 构建 Admin Panel

```bash
cd admin-panel
npm install
npm run build
cd ..
```

构建后的静态文件在 `admin-panel/dist/` 目录。

### 4. 启动服务

```bash
# 构建并启动所有服务
docker compose up -d --build

# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 5. 初始化数据库

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

### 6. 创建管理员账户

```bash
# 进入容器
docker compose exec api python

# 在 Python shell 中执行
>>> import asyncio
>>> from app.database import async_session
>>> from app.models import User, UserRole
>>> from app.services.auth import get_password_hash

>>> async def create_admin():
...     async with async_session() as db:
...         admin = User(
...             email="admin@nju.edu.cn",
...             nickname="系统管理员",
...             hashed_password=get_password_hash("your-admin-password"),
...             role=UserRole.ADMIN,
...             is_verified=True,
...             karma=100
...         )
...         db.add(admin)
...         await db.commit()
...         print("Admin created!")

>>> asyncio.run(create_admin())
>>> exit()
```

---

## 三、HTTPS 配置 (生产环境必须)

### 方式一：使用 Let's Encrypt (推荐)

```bash
# 安装 certbot
sudo apt install certbot

# 获取证书 (先停止 nginx)
docker compose stop nginx
sudo certbot certonly --standalone -d your-domain.com

# 复制证书
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ./nginx/ssl/
sudo chmod 644 ./nginx/ssl/*.pem
```

### 修改 nginx.conf 启用 HTTPS

编辑 `nginx/nginx.conf`，取消 HTTPS server 块的注释，并修改域名。

```bash
# 重启 nginx
docker compose restart nginx
```

### 自动续期证书

```bash
# 添加 cron job
sudo crontab -e

# 添加以下行 (每月1日凌晨3点续期)
0 3 1 * * certbot renew --quiet && docker compose restart nginx
```

---

## 四、移动端构建与分发

### iOS

```bash
cd mobile

# 安装依赖
npm install

# 构建 iOS
npx expo prebuild --platform ios
cd ios && pod install && cd ..

# 打包 (需要 macOS 和 Xcode)
npx expo run:ios --configuration Release
```

发布到 App Store 需要 Apple Developer 账号 ($99/年)。

### Android

```bash
cd mobile

# 构建 Android APK
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease

# APK 位置
ls android/app/build/outputs/apk/release/
```

或使用 EAS Build：
```bash
npm install -g eas-cli
eas login
eas build --platform android
```

---

## 五、运维命令

### 日常管理

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f api        # API 日志
docker compose logs -f db         # 数据库日志
docker compose logs --tail=100    # 最近100行

# 重启服务
docker compose restart api
docker compose restart            # 重启所有

# 停止服务
docker compose down

# 停止并删除数据卷 (⚠️ 会删除数据库!)
docker compose down -v
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
# 拉取最新代码
git pull origin main

# 重新构建 admin panel
cd admin-panel && npm install && npm run build && cd ..

# 重新构建并重启服务
docker compose up -d --build
```

---

## 六、监控与告警

### 健康检查

```bash
# API 健康检查
curl http://localhost/health

# 数据库连接测试
docker compose exec db pg_isready -U postgres

# Redis 连接测试
docker compose exec redis redis-cli ping
```

### 简易监控脚本

创建 `monitor.sh`:

```bash
#!/bin/bash
API_URL="http://localhost/health"

if ! curl -sf "$API_URL" > /dev/null; then
    echo "[$(date)] API is down! Restarting..."
    docker compose restart api
    # 发送告警邮件/通知
fi
```

添加到 cron:
```bash
*/5 * * * * /home/user/ddl-tracker/monitor.sh >> /var/log/ddl-monitor.log 2>&1
```

---

## 七、常见问题

### Q: 数据库连接失败
```bash
# 检查数据库是否运行
docker compose ps db
docker compose logs db

# 检查网络
docker network ls
docker compose exec api ping db
```

### Q: 邮件发送失败
```bash
# 测试 SMTP
docker compose exec api python -c "
import smtplib
from email.mime.text import MIMEText
import os

msg = MIMEText('Test')
msg['Subject'] = 'Test'
msg['From'] = os.environ['SMTP_FROM']
msg['To'] = 'your-email@example.com'

with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ['SMTP_PORT'])) as s:
    s.starttls()
    s.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
    s.send_message(msg)
    print('Email sent!')
"
```

### Q: Admin Panel 404
```bash
# 确认构建成功
ls -la admin-panel/dist/

# 检查 nginx 挂载
docker compose exec nginx ls /usr/share/nginx/html/admin/
```

### Q: 磁盘空间不足
```bash
# 清理 Docker 缓存
docker system prune -a

# 清理旧日志
docker compose logs --tail=0
```

---

## 八、安全建议

1. **定期更新** - `docker compose pull && docker compose up -d`
2. **数据库密码** - 使用至少 32 位随机密码
3. **HTTPS** - 生产环境必须启用
4. **防火墙** - 只开放必要端口 (80, 443)
5. **备份** - 设置自动每日备份
6. **监控** - 配置健康检查和告警

---

## 快速部署检查清单

- [ ] 服务器准备就绪 (Docker, Docker Compose)
- [ ] 代码上传到服务器
- [ ] `.env` 配置完成 (数据库密码、SMTP、Session 密钥)
- [ ] Admin Panel 构建完成
- [ ] `docker compose up -d --build` 成功
- [ ] 数据库初始化完成
- [ ] 管理员账户创建完成
- [ ] HTTPS 证书配置 (生产环境)
- [ ] 健康检查通过
- [ ] 备份脚本配置
