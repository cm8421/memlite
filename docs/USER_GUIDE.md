# MemLite 使用指南

> 轻量级 AI Agent 记忆系统

## 目录

- [快速开始](#快速开始)
- [安装方式](#安装方式)
- [CLI 命令](#cli-命令)
- [Claude Code 集成](#claude-code-集成)
- [MCP Server 配置](#mcp-server-配置)
- [API 参考](#api-参考)
- [配置选项](#配置选项)
- [数据存储](#数据存储)
- [故障排除](#故障排除)

---

## 快速开始

### 1. 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/memlite.git
cd memlite

# 安装依赖并构建
npm install && npm run build

# 初始化（创建数据目录）
mkdir -p ~/.memlite
```

### 2. 验证安装

```bash
# 查看帮助
node dist/cli.js

# 查看统计
node dist/cli.js stats
```

---

## 安装方式

### 方式一：源码安装（推荐用于开发）

```bash
git clone https://github.com/your-username/memlite.git
cd memlite
npm install
npm run build
```

### 方式二：npm 安装（未来发布后）

```bash
npm install -g memlite-mcp-server
```

### 方式三：一键安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/your-username/memlite/main/scripts/install.sh | bash
```

---

## CLI 命令

### 查看统计

查看记忆库统计信息：

```bash
node dist/cli.js stats
# 或
npm run stats
```

输出示例：
```
MemLite 记忆统计
================
总记忆数: 42
总嵌入数: 42
最早记忆: 2026/3/19 上午10:30:00
最新记忆: 2026/3/19 下午2:46:17
平均重要性: 0.342
```

### 搜索记忆

搜索相关记忆：

```bash
node dist/cli.js search "关键词"
# 或
npm run search "关键词"
```

### Hook 命令（自动记忆）

Claude Code Hooks 会自动调用这些命令。

**处理用户提示（自动检索相关记忆）**：

```bash
node dist/cli.js hook --event=prompt --query="用户输入的提示"
```

**处理助手响应（自动保存对话）**：

```bash
node dist/cli.js hook --event=response --prompt="用户提示" --response="助手响应"
```

---

## Claude Code 集成

### 第一步：配置 Hooks

在项目根目录的 `CLAUDE.md` 文件中添加以下内容：

```markdown
# MemLite 自动记忆

## Hooks 配置
<hooks>
{
  "user-prompt-submit": [{
    "command": "node /path/to/memlite/dist/cli.js hook --event=prompt --query=\"$PROMPT\"",
    "timeout": 500
  }],
  "assistant-response-complete": [{
    "command": "node /path/to/memlite/dist/cli.js hook --event=response --prompt=\"$PROMPT\" --response=\"$RESPONSE\"",
    "timeout": 1000
  }]
}
</hooks>
```

### 第二步：调整超时（可选）

如果提示较长，可以增加超时时间：

```markdown
<hooks>
{
  "user-prompt-submit": [{
    "command": "node /path/to/memlite/dist/cli.js hook --event=prompt --query=\"$PROMPT\"",
    "timeout": 1000
  }],
  "assistant-response-complete": [{
    "command": "node /path/to/memlite/dist/cli.js hook --event=response --prompt=\"$PROMPT\" --response=\"$RESPONSE\"",
    "timeout": 2000
  }]
}
</hooks>
```

### 第三步：验证

与 Claude Code 对话几次，然后查看统计：

```bash
node dist/cli.js stats
```

如果看到记忆数量增加，说明集成成功。

---

## MCP Server 配置

MemLite 也可以作为 MCP Server 运行，为其他 MCP 客户端提供记忆服务。

### Claude Desktop

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "memlite": {
      "command": "node",
      "args": ["/path/to/memlite/dist/index.js"],
      "env": {
        "MEMLITE_DB_PATH": "/path/to/memories.db"
      }
    }
  }
}
```

### npx 运行

```json
{
  "mcpServers": {
    "memlite": {
      "command": "npx",
      "args": ["-y", "memlite-mcp-server"]
    }
  }
}
```

---

## API 参考

### MCP 工具

#### search

语义搜索记忆。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `query` | string | 是 | - | 搜索查询字符串 |
| `limit` | number | 否 | 20 | 返回结果数量限制 |
| `offset` | number | 否 | 0 | 分页偏移量 |
| `minImportance` | number | 否 | 0 | 最小重要性分数过滤 |
| `dateStart` | number | 否 | - | 时间范围开始（Unix ms） |
| `dateEnd` | number | 否 | - | 时间范围结束（Unix ms） |

**返回**：匹配的观察ID列表和简要信息

**示例**：

```json
{
  "query": "TypeScript 学习",
  "limit": 10
}
```

#### timeline

获取锚点周围的时间线上下文。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `anchor` | string | 是 | - | 锚点记忆ID |
| `depth_before` | number | 否 | 5 | 锚点前获取数量 |
| `depth_after` | number | 否 | 5 | 锚点后获取数量 |

**示例**：

```json
{
  "anchor": "mem_123456",
  "depth_before": 5,
  "depth_after": 5
}
```

#### get_observations

获取完整的观察详情。

**参数**：

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `ids` | string[] | 是 | 要获取的记忆ID列表 |

**示例**：

```json
{
  "ids": ["mem_123456", "mem_789012"]
}
```

#### save_memory

保存一条新的记忆观察。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `text` | string | 是 | - | 要记忆的内容 |
| `title` | string | 否 | 自动生成 | 简短标题 |
| `project` | string | 否 | - | 项目名称 |
| `obs_type` | string | 否 | - | 观察类型 |
| `importance` | number | 否 | 0.5 | 重要性评分 (0-1) |

**示例**：

```json
{
  "text": "用户提到他们喜欢使用 TypeScript",
  "title": "用户技术偏好",
  "project": "my-project",
  "obs_type": "discovery",
  "importance": 0.7
}
```

---

## 配置选项

### 环境变量

| 环境变量 | 默认值 | 描述 |
|----------|--------|------|
| `MEMLITE_DB_PATH` | `~/.memlite/memlite.db` | 数据库文件路径 |
| `MEMLITE_ENABLED` | `true` | 启用/禁用静默模式 |
| `MEMLITE_FILTER_SENSITIVE` | `true` | 过滤敏感信息 |
| `MEMLITE_IMPORTANCE_THRESHOLD` | `0.3` | 最小重要性阈值 |
| `MEMLITE_MAX_INJECTIONS` | `5` | 注入记忆的最大数量 |

### 示例

```bash
# 使用自定义数据库路径
export MEMLITE_DB_PATH="/data/my-memories.db"

# 禁用敏感信息过滤（谨慎使用）
export MEMLITE_FILTER_SENSITIVE=false

# 调整重要性阈值
export MEMLITE_IMPORTANCE_THRESHOLD=0.5

# 运行命令
node dist/cli.js stats
```

### 敏感信息模式

自动过滤以下模式：

- `password`
- `api_key`、`api-key`
- `token`
- `secret`
- `credential`
- `bearer`
- `authorization`

---

## 数据存储

### 存储位置

默认存储在 `~/.memlite/memlite.db`

### 数据库格式

SQLite 单文件，可以直接用 SQLite 工具查看：

```bash
sqlite3 ~/.memlite/memlite.db

# 查看表结构
sqlite> .schema exchanges

# 查看记录数
sqlite> SELECT COUNT(*) FROM exchanges;
```

### 备份

```bash
# 复制数据库文件
cp ~/.memlite/memlite.db ~/.memlite/memlite-backup-$(date +%Y%m%d).db

# 或导出为 JSON（未来功能）
memlite export > memories-$(date +%Y%m%d).json
```

---

## 故障排除

### 问题：Hook 不工作

**检查 1**：确认路径正确

```bash
# 确认 CLI 文件存在
ls -la /path/to/memlite/dist/cli.js
```

**检查 2**：确认命令可执行

```bash
node /path/to/memlite/dist/cli.js stats
```

**检查 3**：检查 CLAUDE.md 语法

确保 JSON 格式正确，路径使用绝对路径。

### 问题：记忆数量为 0

**原因**：Hook 可能未触发或数据库路径问题

```bash
# 检查数据库是否存在
ls -la ~/.memlite/

# 查看统计
node dist/cli.js stats
```

### 问题：敏感信息未被过滤

**原因**：环境变量 `MEMLITE_FILTER_SENSITIVE` 可能被设置为 `false`

```bash
# 检查环境变量
echo $MEMLITE_FILTER_SENSITIVE

# 明确启用过滤
export MEMLITE_FILTER_SENSITIVE=true
node dist/cli.js hook --event=response --prompt="..." --response="..."
```

### 问题：向量搜索不工作

**现象**：`sqlite-vec extension not available, using JS fallback`

**原因**：sqlite-vec 扩展未安装，向量搜索回退到 JS 实现

**解决**：安装 sqlite-vec 扩展（或忽略，不影响基本功能）

```bash
# 安装 sqlite-vec（需要编译）
npm install @aspect26/sqlite-vec
```

### 问题：数据库目录不存在

**错误**：`Cannot open database because the directory does not exist`

**解决**：创建数据目录

```bash
mkdir -p ~/.memlite
```

---

## 性能指标

| 指标 | 目标 | 实际（参考） |
|------|------|--------------|
| 检索延迟 (P95) | <50ms | ~25ms |
| 内存占用 | <50MB | ~30MB |
| 启动时间 | <200ms | <100ms |
| 压缩率 | >10x | 11x |

---

## 技术支持

- **问题反馈**：https://github.com/your-username/memlite/issues
- **文档更新**：https://github.com/your-username/memlite#readme
