/**
 * 核心模块导出入口
 */

// 检索引擎
export { RetrievalEngine } from './RetrievalEngine.js';
export type { RetrievalConfig, RetrievalStats } from './RetrievalEngine.js';

// 遗忘机制（Phase 3）
export { ForgetModel, getForgetModel } from './ForgetModel.js';
export type {
  ForgetConfig,
  MemoryStrength,
  ForgetStats,
} from './ForgetModel.js';

// 重要性评分（Phase 3）
export { ImportanceScoring, getImportanceScoring } from './ImportanceScoring.js';
export type {
  ImportanceConfig,
  ScoreFactors,
  ScoringResult,
  ScoringStats,
} from './ImportanceScoring.js';

// 双通路记忆管理（Phase 3）
export { MemoryManager } from './MemoryManager.js';
export type {
  MemoryPathway,
  GatingDecision,
  MemoryManagerConfig,
  MemoryStats,
  MemoryStore,
} from './MemoryManager.js';

// 睡眠巩固（Phase 3）
export { SleepGate, getSleepGate } from './SleepGate.js';
export type {
  SleepGateConfig,
  ConsolidationResult,
  MergedGroup,
  ConsolidationStats,
} from './SleepGate.js';
