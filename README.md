# MemLite - 轻量级Agent记忆系统

> 零依赖、单文件存储、高性能向量检索的AI Agent记忆系统

## 特性

- 🚀 **高性能**: <50ms检索延迟（P95）
- 💾 **轻量级**: 单文件SQLite存储，零外部依赖
- 🧠 **智能压缩**: 11倍压缩率（基于Structured Distillation论文）
- 🔍 **混合检索**: 向量相似度 + BM25全文搜索 + RRF融合
- 🔄 **遗忘机制**: 艾宾浩斯曲线自动衰减
- 🔌 **MCP协议**: 原生支持Claude Code等MCP客户端

## 架构

```
┌─────────────────────────────────────┐
│         MemLite MCP Server          │
│  ┌─────────────────────────────┐   │
│  │     Memory Manager          │   │
│  │  ┌──────────┬──────────┐   │   │
│  │  │ Episodic │ Semantic │   │   │
│  │  │ Memory   │ Memory   │   │   │
│  │  └──────────┴──────────┘   │   │
│  └─────────────────────────────┘   │
│  ┌─────────────┬─────────────┐     │
│  │ Compression │  Retrieval  │     │
│  │   Engine    │   Engine    │     │
│  └─────────────┴─────────────┘     │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│     SQLite + sqlite-vec             │
│  ┌────────┬─────────┬──────────┐   │
│  │ Vector │ BM25    │ Time     │   │
│  │ Index  │ FTS5    │ Index    │   │
│  └────────┴─────────┴──────────┘   │
└─────────────────────────────────────┘
```

## 安装

```bash
npm install memlite-mcp-server
```

## 使用

### 作为MCP服务器

在Claude Desktop配置中添加：

```json
{
  "mcpServers": {
    "memlite": {
      "command": "npx",
      "args": ["memlite-mcp-server"],
      "env": {
        "MEMLITE_DB_PATH": "/path/to/memories.db"
      }
    }
  }
}
```

### 3层工作流

MemLite使用3层工作流来优化token使用：

```
1. search(query) → 获取ID列表 (~50-100 tokens/结果)
2. timeline(anchor=ID) → 获取锚点周围的上下文
3. get_observations([IDs]) → 获取完整详情
```

**重要**: 不要在没有过滤的情况下获取完整详情。10倍节省token。

### MCP工具

#### `search`

搜索记忆库。

参数：
- `query` (string): 搜索查询
- `limit` (number): 结果数量限制 (默认20)
- `offset` (number): 分页偏移 (默认0)
- `minImportance` (number): 最小重要性过滤 (0-1)
- `dateStart` (number): 开始时间戳
- `dateEnd` (number): 结束时间戳

#### `timeline`

获取时间线上下文。

参数：
- `anchor` (string): 锚点记忆ID
- `depth_before` (number): 锚点前数量 (默认5)
- `depth_after` (number): 锚点后数量 (默认5)

#### `get_observations`

获取完整观察详情。

参数：
- `ids` (string[]): 记忆ID列表

#### `save_memory`

保存新记忆。

参数：
- `text` (string): 要记忆的内容
- `title` (string, 可选): 简短标题
- `project` (string, 可选): 项目名称
- `obs_type` (string, 可选): 观察类型
- `importance` (number, 可选): 重要性评分 (0-1)

## Claude Code Hooks 集成

MemLite 支持通过 Claude Code Hooks 实现后台自动记忆：

### 配置 Hooks

在项目的 `CLAUDE.md` 中添加：

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

### CLI 命令

```bash
# Hook 命令（Claude Code hooks 调用）
memlite hook --event=prompt --query="..."
memlite hook --event=response --prompt="..." --response="..."

# 管理命令
memlite stats            # 查看记忆统计
memlite search "关键词"   # 搜索记忆
```

### 环境变量

| 环境变量 | 默认值 | 描述 |
|----------|--------|------|
| `MEMLITE_ENABLED` | `true` | 启用/禁用静默模式 |
| `MEMLITE_FILTER_SENSITIVE` | `true` | 过滤敏感信息 |
| `MEMLITE_IMPORTANCE_THRESHOLD` | `0.3` | 最小重要性阈值 |
| `MEMLITE_MAX_INJECTIONS` | `5` | 注入记忆的最大数量 |

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式
npm run dev

# 测试
npm test

# 类型检查
npm run typecheck

# 运行基准测试
npm run benchmark
```

## 技术栈

| 组件 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript | 与Claude生态（MCP SDK）天然兼容 |
| 存储 | SQLite + better-sqlite3 | 零配置、单文件、高性能 |
| 向量 | 纯JS实现 | 无需编译原生扩展 |
| 协议 | MCP | Claude Code原生支持 |

## 核心数据模型

### MemoryExchange (四元组结构)

```typescript
interface MemoryExchange {
  id: string;
  timestamp: number;

  // 四元组（11倍压缩核心）
  exchange_core: string;         // 核心摘要 (~15 tokens)
  specific_context: string;      // 具体上下文 (~20 tokens)
  thematic_tags: string[];       // 主题标签
  entities_extracted: string[];  // 提取的实体

  // 遗忘曲线参数
  importance_score: number;      // 重要性 (0-1)
  access_count: number;          // 访问次数
  decay_rate: number;            // 衰减率
  last_accessed: number;         // 最后访问时间
}
```

## 参考论文

1. **Structured Distillation** (2026) - 11倍压缩，四元组结构
2. **SleepGate** (2025) - 睡眠启发的记忆巩固
3. **HIMM** (2025) - 情景-语义双通路
4. **FadeMem** (2025) - 艾宾浩斯遗忘曲线

## 许可证

MIT
