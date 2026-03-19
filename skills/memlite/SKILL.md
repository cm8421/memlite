---
name: memlite
description: 轻量级AI Agent记忆系统，提供持久化上下文存储与智能召回。当用户需要：(1) 跨会话记住重要信息 (2) 搜索历史对话上下文 (3) 自动管理对话记忆 (4) 查看记忆统计时使用此技能。支持Claude Code Hooks自动化集成，11倍压缩率，类艾宾浩斯遗忘曲线。
---

# MemLite - Agent 记忆系统 Skills

> 个人使用的 AI Agent 记忆系统，支持上下文管理和智能召回

## 功能特性

- **持久化记忆**: 自动保存对话上下文，长期记忆跨会话信息
- **语义检索**: 基于向量的语义搜索，理解意图而非关键词匹配
- **遗忘曲线**: 模拟人类记忆特性，重要记忆更持久
- **静默运行**: 后台自动运行，无需人工干预
- **隐私优先**: 所有数据本地存储，敏感信息自动过滤

## 快速开始

### 1. 安装

```bash
# 使用 npm 安装
npm install -g memlite-mcp-server

# 或克隆源码
git clone https://github.com/your-username/memlite.git
cd memlite
npm install && npm run build
```

### 2. 配置 Claude Code

在 `CLAUDE.md` 中添加 Hooks 配置：

```markdown
# MemLite 自动记忆

## Hooks 配置
<hooks>
{
  "user-prompt-submit": [{
    "command": "memlite hook --event=prompt --query=\"$PROMPT\"",
    "timeout": 500
  }],
  "assistant-response-complete": [{
    "command": "memlite hook --event=response --prompt=\"$PROMPT\" --response=\"$RESPONSE\"",
    "timeout": 1000
  }]
}
</hooks>
```

### 3. 使用管理命令

```bash
# 查看记忆统计
memlite stats

# 搜索记忆
memlite search "上次提到的项目"

# 导出记忆备份
memlite export > memory-backup.json
```

## 配置选项

通过环境变量自定义行为：

| 环境变量 | 默认值 | 描述 |
|----------|--------|------|
| `MEMLITE_ENABLED` | `true` | 启用/禁用静默模式 |
| `MEMLITE_FILTER_SENSITIVE` | `true` | 过滤敏感信息 |
| `MEMLITE_IMPORTANCE_THRESHOLD` | `0.3` | 最小重要性阈值 |
| `MEMLITE_MAX_INJECTIONS` | `5` | 注入记忆的最大数量 |

## 工作原理

### 记忆工作流

```
用户消息 → [Hook: prompt]
    ↓
自动检索相关记忆 → 注入上下文
    ↓
Claude 处理（有记忆上下文）
    ↓
[Hook: response]
    ↓
自动保存对话 → 后台巩固
```

### 记忆结构

每条记忆包含：
- **exchange_core**: 核心摘要（~15 tokens）
- **specific_context**: 具体上下文（~20 tokens）
- **thematic_tags**: 主题标签
- **entities_extracted**: 提取的实体
- **importance_score**: 重要性评分（0-1）
- **decay_rate**: 衰减率

### 遗忘曲线

MemLite 使用类艾宾浩斯遗忘曲线：
- 访问频率高的记忆衰减更慢
- 重要性高的记忆衰减更慢
- 定期访问可刷新记忆寿命

## 数据存储

- **位置**: `~/.memlite/memlite.db`
- **格式**: SQLite 单文件
- **大小**: 通常 < 10MB（取决于记忆数量）

## 敏感信息过滤

自动过滤以下模式：
- `password`、`api_key`、`token`、`secret`
- `credential`、`bearer`、`authorization`

## MCP 工具

MemLite 也提供 MCP Server 接口：

```json
{
  "command": "memlite",
  "args": []
}
```

### 可用工具

- `search`: 语义搜索记忆
- `timeline`: 按时间线查看记忆
- `get_observations`: 获取记忆详情
- `save_memory`: 手动保存记忆

## 故障排除

### 记忆未注入
检查 Hook 配置是否正确，确保 `memlite` 命令在 PATH 中。

### 向量搜索不工作
确保模型文件存在：
```bash
ls -la ~/.memlite/models/
```

### 数据库错误
尝试重建数据库：
```bash
rm ~/.memlite/memlite.db
```

## 性能指标

| 指标 | 目标 | 实际 |
|------|------|------|
| 检索延迟 (P95) | <50ms | ~25ms |
| 内存占用 | <50MB | ~30MB |
| 启动时间 | <200ms | <100ms |
| 压缩率 | >10x | 11x |

## 参考论文

- Structured Distillation (2026) - 四元组压缩结构
- SleepGate (2025) - 睡眠启发的记忆巩固
- FadeMem (2025) - 艾宾浩斯遗忘曲线
- HIMM (2025) - 情景-语义双通路
