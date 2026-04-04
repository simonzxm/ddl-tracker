# DDL Tracker 管理面板

基于 [Astro](https://astro.build/) + [Tailwind CSS v4](https://tailwindcss.com/) 构建的管理面板，用于管理 DDL Tracker 的课程、任务和用户数据。

## 功能

- **大盘概览** — 用户统计、任务统计、活跃度趋势
- **任务审核** — 审核被举报和低评分的任务，验证/隐藏/删除操作
- **用户管理** — 查看用户列表、设置管理员、修改 Karma
- **课程管理** — 添加/编辑/删除课程，批量导入，数据导出
- **修改建议** — 审批/拒绝用户提交的任务描述修改提案

## 开发

```bash
npm install
npm run dev        # 启动开发服务器 → http://localhost:4321
```

## 构建

```bash
npm run build      # 产出到 ./dist/
npm run preview    # 本地预览构建结果
```

## 目录结构

```
src/
├── layouts/       # 页面布局（AdminLayout, Layout）
├── components/    # 可复用组件（StatCard, Welcome）
├── pages/         # 路由页面
│   ├── index.astro       # 大盘概览
│   ├── login.astro       # 登录
│   ├── tasks.astro       # 任务管理
│   ├── users.astro       # 用户管理
│   ├── courses.astro     # 课程管理
│   └── proposals.astro   # 修改建议
└── styles/        # 全局样式
```
