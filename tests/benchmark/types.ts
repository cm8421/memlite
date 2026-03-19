/**
 * MemLite 基准评测共享类型定义
 *
 * 定义 LoCoMo、LongMemEval、MemoryArena 等基准的通用接口
 */

// ============================================================================
// 评测结果基础类型
// ============================================================================

/**
 * 评测结果
 */
export interface EvalResult {
  /** 基准名称 */
  benchmark: string;
  /** 语义级准确率（GPT-4评判） */
  accuracy: number;
  /** 事实召回率 */
  recall: number;
  /** 检索延迟(ms) */
  latency: number;
  /** 内存占用(MB) */
  memoryUsage: number;
  /** 压缩率 */
  compressionRatio?: number;
  /** 任务完成率（MemoryArena专用） */
  taskCompletionRate?: number;
  /** 详细指标 */
  details?: Record<string, number>;
}

/**
 * 评测报告
 */
export interface EvalReport {
  /** 评测时间 */
  timestamp: string;
  /** 系统版本 */
  version: string;
  /** 总体评分 */
  overallScore: number;
  /** 各基准结果 */
  results: EvalResult[];
  /** 环境信息 */
  environment: {
    nodeVersion: string;
    platform: string;
    memory: number;
    cpuCores: number;
  };
}

// ============================================================================
// LoCoMo 基准类型
// ============================================================================

/**
 * LoCoMo 对话数据
 */
export interface LoCoMoConversation {
  id: string;
  sessions: LoCoMoSession[];
  metadata?: Record<string, unknown>;
}

/**
 * LoCoMo 会话
 */
export interface LoCoMoSession {
  id: string;
  turns: LoCoMoTurn[];
  timestamp?: number;
}

/**
 * LoCoMo 对话轮次
 */
export interface LoCoMoTurn {
  speaker: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

/**
 * LoCoMo 问答对
 */
export interface LoCoMoQA {
  conversationId: string;
  question: string;
  answer: string;
  evidence?: string[];
  questionType: 'fact' | 'summary' | 'reasoning' | 'multisession';
}

/**
 * LoCoMo 评测配置
 */
export interface LoCoMoConfig {
  /** 评测子集大小（轮数） */
  subsetSize: number;
  /** 是否使用 GPT-4 评判 */
  useGPT4Judge: boolean;
  /** 召回数量 */
  retrievalTopK: number;
  /** 是否跳过网络请求 */
  offlineMode: boolean;
}

/**
 * LoCoMo 评测结果
 */
export interface LoCoMoResult extends EvalResult {
  benchmark: 'LoCoMo';
  /** QA 准确率 */
  qaAccuracy: number;
  /** 事件摘要准确率 */
  summarizationAccuracy: number;
  /** 多会话理解准确率 */
  multiSessionAccuracy: number;
  /** 平均检索延迟 */
  avgRetrievalLatency: number;
}

// ============================================================================
// LongMemEval 基准类型
// ============================================================================

/**
 * LongMemEval 问题类型
 */
export type LongMemEvalQuestionType =
  | 'information_extraction'
  | 'multi_session_reasoning'
  | 'knowledge_update'
  | 'time_reasoning'
  | 'abstention';

/**
 * LongMemEval 问题
 */
export interface LongMemEvalQuestion {
  id: string;
  question: string;
  answer: string;
  questionType: LongMemEvalQuestionType;
  hasAnswer: boolean;
  sessionId?: string;
  turnId?: string;
  relatedSessions?: string[];
}

/**
 * LongMemEval 会话
 */
export interface LongMemEvalSession {
  id: string;
  turns: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * LongMemEval 配置
 */
export interface LongMemEvalConfig {
  /** 难度级别 */
  difficulty: 'oracle' | 'medium' | 'extreme';
  /** 最大会话数 */
  maxSessions: number;
  /** 是否测试弃权 */
  testAbstention: boolean;
  /** 召回数量 */
  retrievalTopK: number;
}

/**
 * LongMemEval 评测结果
 */
export interface LongMemEvalResult extends EvalResult {
  benchmark: 'LongMemEval';
  /** 会话级召回率 */
  sessionRecall: number;
  /** 轮级召回率 */
  turnRecall: number;
  /** 各类型准确率 */
  typeAccuracy: Record<LongMemEvalQuestionType, number>;
  /** 弃权准确率 */
  abstentionAccuracy: number;
}

// ============================================================================
// MemoryArena 基准类型
// ============================================================================

/**
 * MemoryArena 任务类型
 */
export type MemoryArenaTaskType =
  | 'web_navigation'
  | 'preference_planning'
  | 'progressive_search'
  | 'sequential_reasoning';

/**
 * MemoryArena 任务
 */
export interface MemoryArenaTask {
  id: string;
  type: MemoryArenaTaskType;
  description: string;
  steps: MemoryArenaStep[];
  expectedOutcome: string;
  dependencies?: string[];
}

/**
 * MemoryArena 任务步骤
 */
export interface MemoryArenaStep {
  id: string;
  instruction: string;
  expectedAction?: string;
  memoryRequired?: string[];
}

/**
 * MemoryArena 配置
 */
export interface MemoryArenaConfig {
  /** 任务类型过滤 */
  taskTypes?: MemoryArenaTaskType[];
  /** 最大步骤数 */
  maxSteps: number;
  /** 超时时间(ms) */
  timeout: number;
}

/**
 * MemoryArena 评测结果
 */
export interface MemoryArenaResult extends EvalResult {
  benchmark: 'MemoryArena';
  /** 任务完成率 */
  taskCompletionRate: number;
  /** 跨会话依赖解决率 */
  crossSessionRate: number;
  /** 记忆-动作一致性 */
  memoryActionConsistency: number;
  /** 各类型任务完成率 */
  typeCompletionRate: Record<MemoryArenaTaskType, number>;
}

// ============================================================================
// 评测工具函数
// ============================================================================

/**
 * 计算召回率
 */
export function calculateRecall(retrieved: string[], relevant: string[]): number {
  if (relevant.length === 0) return 1;
  const retrievedSet = new Set(retrieved);
  const relevantSet = new Set(relevant);
  const intersection = [...relevantSet].filter(id => retrievedSet.has(id));
  return intersection.length / relevantSet.size;
}

/**
 * 计算精确率
 */
export function calculatePrecision(retrieved: string[], relevant: string[]): number {
  if (retrieved.length === 0) return 0;
  const retrievedSet = new Set(retrieved);
  const relevantSet = new Set(relevant);
  const intersection = [...retrievedSet].filter(id => relevantSet.has(id));
  return intersection.length / retrievedSet.size;
}

/**
 * 计算 F1 分数
 */
export function calculateF1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * 计算 MRR (Mean Reciprocal Rank)
 */
export function calculateMRR(rankings: Array<{ retrieved: string[]; relevant: string }>): number {
  let totalReciprocal = 0;

  for (const { retrieved, relevant } of rankings) {
    const rank = retrieved.findIndex(id => id === relevant);
    if (rank !== -1) {
      totalReciprocal += 1 / (rank + 1);
    }
  }

  return rankings.length > 0 ? totalReciprocal / rankings.length : 0;
}

/**
 * 计算百分位数
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * 格式化评测报告
 */
export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [
    `# MemLite 评测报告`,
    ``,
    `**评测时间**: ${report.timestamp}`,
    `**系统版本**: ${report.version}`,
    `**总体评分**: ${(report.overallScore * 100).toFixed(1)}%`,
    ``,
    `## 环境信息`,
    ``,
    `- Node.js: ${report.environment.nodeVersion}`,
    `- 平台: ${report.environment.platform}`,
    `- 内存: ${(report.environment.memory / 1024 / 1024).toFixed(0)} MB`,
    `- CPU核心: ${report.environment.cpuCores}`,
    ``,
    `## 评测结果`,
    ``,
  ];

  for (const result of report.results) {
    lines.push(`### ${result.benchmark}`);
    lines.push(``);
    lines.push(`| 指标 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 准确率 | ${(result.accuracy * 100).toFixed(1)}% |`);
    lines.push(`| 召回率 | ${(result.recall * 100).toFixed(1)}% |`);
    lines.push(`| 延迟(P95) | ${result.latency.toFixed(1)}ms |`);
    lines.push(`| 内存占用 | ${result.memoryUsage.toFixed(1)}MB |`);

    if (result.compressionRatio) {
      lines.push(`| 压缩率 | ${result.compressionRatio.toFixed(1)}x |`);
    }

    if (result.details) {
      for (const [key, value] of Object.entries(result.details)) {
        lines.push(`| ${key} | ${(value * 100).toFixed(1)}% |`);
      }
    }
    lines.push(``);
  }

  return lines.join('\n');
}
