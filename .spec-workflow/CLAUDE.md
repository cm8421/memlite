[根目录](../CLAUDE.md) > **.spec-workflow**

# Spec Workflow 模块

## 模块职责

提供项目规格化工作流的文档模板系统，支持：
- 需求文档 (requirements)
- 设计文档 (design)
- 任务清单 (tasks)
- 产品规划 (product)
- 技术栈定义 (tech)
- 项目结构 (structure)

## 入口与启动

此模块为纯模板资源，无需运行。

## 对外接口

### 模板文件

| 模板文件 | 用途 |
|---------|------|
| `templates/requirements-template.md` | 需求文档模板，包含用户故事与验收标准 |
| `templates/design-template.md` | 设计文档模板，包含架构图与组件定义 |
| `templates/tasks-template.md` | 任务清单模板，包含详细任务分解与 AI 提示词 |
| `templates/product-template.md` | 产品规划模板，定义愿景与目标 |
| `templates/tech-template.md` | 技术栈模板，定义语言/框架/依赖 |
| `templates/structure-template.md` | 项目结构模板，定义目录组织与命名规范 |

### 模板变量

模板支持以下占位符：
- `{{projectName}}` - 项目名称
- `{{featureName}}` - 功能名称
- `{{date}}` - 当前日期
- `{{author}}` - 文档作者

## 关键依赖与配置

- 无外部依赖
- `user-templates/` 目录用于存放自定义模板，可覆盖默认模板

### 模板加载优先级
1. 优先检查 `user-templates/` 目录
2. 若无自定义模板，使用 `templates/` 默认模板

## 数据模型

不适用

## 测试与质量

不适用（模板资源）

## 常见问题 (FAQ)

**Q: 如何自定义模板？**
A: 在 `user-templates/` 目录创建同名文件即可覆盖默认模板。

**Q: 模板中的 Mermaid 图表如何使用？**
A: 设计模板包含 Mermaid 语法示例，可在支持 Mermaid 的 Markdown 渲染器中显示流程图。

## 相关文件清单

```
.spec-workflow/
├── templates/
│   ├── requirements-template.md
│   ├── design-template.md
│   ├── tasks-template.md
│   ├── product-template.md
│   ├── tech-template.md
│   └── structure-template.md
└── user-templates/
    └── README.md
```

## 变更记录 (Changelog)

| 日期 | 变更内容 |
|------|---------|
| 2026-03-18 | 初始化模块文档 |
