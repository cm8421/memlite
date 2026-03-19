/**
 * MemLite - 核心数据类型定义
 *
 * 基于 Structured Distillation 论文的四元组压缩结构
 */

// ============================================================================
// 基础类型
// ============================================================================

/**
 * 记忆交换核心 - 四元组结构（11倍压缩核心）
 */
export interface MemoryExchange {
  /** 唯一标识符 */
  id: string;
  /** 创建时间戳 (Unix ms) */
  timestamp: number;

  // 四元组压缩结构
  /** 核心摘要 (~15 tokens) - 高度压缩的关键信息 */
  exchange_core: string;
  /** 具体上下文 (~20 tokens) - 补充细节 */
  specific_context: string;
  /** 主题标签 - 语义分类 */
  thematic_tags: string[];
  /** 提取的实体 - 关键命名实体 */
  entities_extracted: string[];

  // 遗忘曲线参数（参考 FadeMem 论文）
  /** 重要性评分 (0-1) */
  importance_score: number;
  /** 访问次数 */
  access_count: number;
  /** 衰减率 (0-1) */
  decay_rate: number;
  /** 最后访问时间戳 */
  last_accessed: number;

  // 原始数据（可选保留）
  /** 原始内容（可选） */
  raw_content?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 观察记录（用于API返回）
 */
export interface Observation extends MemoryExchange {
  // 继承MemoryExchange所有字段
}

/**
 * 计划任务
 */
export interface PlanTask {
  /** 任务ID */
  id: string;
  /** 任务描述 */
  description: string;
  /** 任务状态 */
  status: 'pending' | 'in_progress' | 'completed';
  /** 依赖任务ID列表 */
  dependencies: string[];
}

/**
 * 计划切换点
 */
export interface SwitchPoint {
  /** 源计划ID */
  from_plan: string;
  /** 目标计划ID */
  to_plan: string;
  /** 切换原因 */
  reason: string;
  /** 上下文快照 */
  context_snapshot: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 计划记忆
 */
export interface PlanMemory {
  /** 计划ID */
  id: string;
  /** 父计划ID（支持分支） */
  parent_plan_id?: string;

  // 计划内容
  /** 计划标题 */
  title: string;
  /** 计划描述 */
  description: string;
  /** 任务列表 */
  tasks: PlanTask[];

  // 状态管理
  /** 计划状态 */
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  /** 优先级 */
  priority: number;
  /** 上下文标签 */
  context_tags: string[];

  // 切换点记录
  /** 切换点列表 */
  switch_points: SwitchPoint[];

  // 元数据
  /** 创建时间 */
  created_at: number;
  /** 更新时间 */
  updated_at: number;
  /** 最后活跃时间 */
  last_active_at: number;
}

// ============================================================================
// 检索类型
// ============================================================================

/**
 * 搜索结果项
 */
export interface SearchResult {
  /** 记忆ID */
  id: string;
  /** 相似度分数 (0-1) */
  score: number;
  /** 记忆数据 */
  exchange: MemoryExchange;
}

/**
 * 搜索参数
 */
export interface SearchParams {
  /** 搜索查询 */
  query: string;
  /** 返回数量限制 */
  limit?: number;
  /** 偏移量（分页） */
  offset?: number;
  /** 主题标签过滤 */
  tags?: string[];
  /** 时间范围开始 */
  dateStart?: number;
  /** 时间范围结束 */
  dateEnd?: number;
  /** 最小重要性分数 */
  minImportance?: number;
  /** 排序字段 */
  orderBy?: 'timestamp' | 'importance_score' | 'access_count';
  /** 排序方向 */
  orderDirection?: 'asc' | 'desc';
}

/**
 * 时间线参数
 */
export interface TimelineParams {
  /** 锚点记忆ID */
  anchor?: string;
  /** 锚点前数量 */
  depth_before?: number;
  /** 锚点后数量 */
  depth_after?: number;
  /** 项目名称过滤 */
  project?: string;
}

/**
 * 检索结果
 */
export interface RetrievalResult {
  /** 总数 */
  total: number;
  /** 当前页数量 */
  count: number;
  /** 偏移量 */
  offset: number;
  /** 结果列表 */
  items: SearchResult[];
  /** 是否有更多 */
  has_more: boolean;
  /** 下一页偏移 */
  next_offset?: number;
}

// ============================================================================
// 存储类型
// ============================================================================

/**
 * 存储配置
 */
export interface StorageConfig {
  /** 数据库文件路径 */
  dbPath: string;
  /** 向量维度 */
  vectorDimension: number;
  /** 是否启用FTS5全文搜索 */
  enableFTS: boolean;
  /** 记忆保留天数（0=永久） */
  retentionDays: number;
}

/**
 * 默认存储配置
 * 支持环境变量配置：
 * - MEMLITE_DB_PATH: 数据库路径
 * - 默认路径: ~/.memlite/memlite.db
 */
function getDefaultDbPath(): string {
  if (process.env.MEMLITE_DB_PATH) {
    return process.env.MEMLITE_DB_PATH;
  }
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return `${home}/.memlite/memlite.db`;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  dbPath: getDefaultDbPath(),
  vectorDimension: 384, // GTE-small 维度
  enableFTS: true,
  retentionDays: 0,
};

// ============================================================================
// MCP 工具类型
// ============================================================================

/**
 * 响应格式
 */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

/**
 * 记忆类型
 */
export enum MemoryType {
  EXCHANGE = 'exchange',
  PLAN = 'plan',
  OBSERVATION = 'observation',
}

/**
 * 观察类型
 */
export enum ObservationType {
  DISCOVERY = 'discovery',
  BUGFIX = 'bugfix',
  FEATURE = 'feature',
  REFACTOR = 'refactor',
  CHANGE = 'change',
  DECISION = 'decision',
}
