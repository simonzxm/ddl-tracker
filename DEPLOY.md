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
git clone https://github.com/simonzxm/ddl-tracker.git
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

### 4. 初始化数据库

```bash
# 运行数据库迁移
docker compose exec api alembic upgrade head
```

> **管理员账户**：第一个通过 API 注册的用户会自动成为管理员（角色 `admin`，karma 100）。
> 部署完成后，使用移动端或直接调用 API 注册第一个账户即可。

```bash
# 快速验证：通过 API 注册管理员
curl -X POST http://localhost:8000/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@nju.edu.cn"}'

# 收到验证码后注册
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@nju.edu.cn", "code": "123456", "nickname": "管理员", "password": "your-password"}'
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
