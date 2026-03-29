# 校园 DDL Tracker

面向全校学生的 DDL 追踪与任务管理系统。

## 🚀 快速开始

### 环境要求
- Docker & Docker Compose
- Python 3.11+ (本地开发)
- Node.js 18+ (管理面板开发)

### 本地开发

1. **克隆项目并配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库和邮件等参数
```

2. **启动基础服务（数据库 + Redis）**
```bash
docker compose up -d db redis
```

3. **安装 Python 依赖并运行迁移**
```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
```

4. **启动开发服务器**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

5. **访问 API 文档**
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### 管理面板开发
```bash
cd admin-panel
npm install
npm run dev
```
访问 http://localhost:4321

### 移动端开发
```bash
cd mobile
npm install
npx expo start
```
扫描二维码在 Expo Go 中运行，或按 `i` / `a` 启动 iOS/Android 模拟器

### Docker 部署

```bash
# 生产环境部署
docker compose up -d

# 查看日志
docker compose logs -f api

# 运行数据库迁移
docker compose exec api alembic upgrade head
```

## 📁 项目结构

```
ddl-tracker/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py          # FastAPI 入口
│   │   ├── config.py        # 配置管理
│   │   ├── database.py      # 数据库连接
│   │   ├── redis.py         # Redis 连接 & Session
│   │   ├── dependencies.py  # 依赖注入
│   │   ├── models/          # SQLAlchemy 模型
│   │   ├── schemas/         # Pydantic 模式
│   │   ├── routers/         # API 路由
│   │   └── services/        # 业务逻辑
│   ├── alembic/             # 数据库迁移
│   └── Dockerfile
├── admin-panel/             # Astro + Tailwind 管理面板
│   ├── src/
│   │   ├── layouts/         # 布局组件
│   │   ├── components/      # UI 组件
│   │   └── pages/           # 页面
│   └── dist/                # 构建输出
├── mobile/                  # React Native + Expo 移动端
│   ├── app/                 # Expo Router 页面
│   │   ├── (auth)/          # 认证相关页面
│   │   ├── (tabs)/          # 底部标签页
│   │   └── task/            # 任务详情/创建
│   └── src/
│       ├── components/      # UI 组件
│       ├── hooks/           # React Hooks
│       ├── services/        # API 服务
│       └── types/           # TypeScript 类型
├── nginx/                   # Nginx 配置
├── docker-compose.yml
└── .env.example
```

## 🔐 认证机制

- 仅支持教育邮箱注册（`@smail.nju.edu.cn` / `@nju.edu.cn`）
- 基于 Session + Redis 的认证
- 验证码有效期 10 分钟

## ⭐ Karma 信誉系统

| 操作 | Karma 变化 |
|------|-----------|
| 贡献的 DDL 被确认 (Upvote) | +5 |
| 贡献的 DDL 被踩 (Downvote) | -2 |

| Karma 等级 | 特权 |
|-----------|------|
| ≥ 50 | 提交的 DDL 自动标记为"已验证" |
| < -10 | 提交的内容自动折叠隐藏 |

## 📡 API 端点

### 认证 `/api/auth`
- `POST /send-code` - 发送验证码
- `POST /register` - 注册
- `POST /login` - 登录
- `POST /logout` - 登出
- `GET /me` - 当前用户信息

### 课程 `/api/courses`
- `GET /` - 课程列表
- `GET /followed` - 关注的课程
- `POST /{id}/follow` - 关注课程
- `DELETE /{id}/follow` - 取消关注

### 任务 `/api/tasks`
- `GET /` - 任务列表
- `GET /my-deadlines` - 我的 DDL（本周）
- `GET /overdue` - 已逾期 DDL
- `POST /` - 创建任务
- `POST /{id}/vote` - 投票

### 管理 `/api/admin`
- `GET /dashboard` - 大盘数据
- `GET /tasks/reported` - 被举报任务
- `POST /tasks/{id}/verify` - 验证任务
- `POST /tasks/{id}/hide` - 隐藏任务

## 🖥️ 管理面板

管理面板提供以下功能：
- **大盘概览**: 用户统计、任务统计、活跃度趋势
- **任务审核**: 审核被举报和低评分的任务
- **用户管理**: 查看用户、设置管理员
- **课程管理**: 添加和管理课程底库

## 📄 License

MIT
