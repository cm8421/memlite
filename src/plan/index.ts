/**
 * MemLite - 计划管理模块
 *
 * 脑科学启发的计划管理系统：
 * - 工作记忆过载的认知卸载
 * - 前额叶执行功能的计划分支
 * - 前瞻性记忆的未来触发
 * - 注意力恢复的断点续传
 */

// 数据模型
export {
  type PlanMemory,
  type PlanTask,
  type PlanConfig,
  type PlanContext,
  type PlanStats,
  type SwitchPoint,
  type PlanBranch,
  PlanStatus,
  TaskStatus,
  BranchType,
  SwitchReason,
  DEFAULT_PLAN_CONFIG,
  createPlanMemory,
  createPlanTask,
  createSwitchPoint,
  createPlanBranch,
  calculatePlanProgress,
  checkTaskDependencies,
  getNextExecutableTask,
  isPlanCompletable,
} from './PlanMemory.js';

// 计划管理器
export { PlanManager, type PlanStore } from './PlanManager.js';

// 意图检测器
export {
  IntentDetector,
  IntentType,
  ConfidenceLevel,
  type IntentResult,
  type IntentDetectorConfig,
  type IntentDetectorStats,
} from './IntentDetector.js';

// 前瞻触发引擎
export {
  TriggerEngine,
  TriggerType,
  TriggerStatus,
  type Trigger,
  type TimeTriggerConfig,
  type EventTriggerConfig,
  type DependencyTriggerConfig,
  type TriggerResult,
  type TriggerEngineConfig,
  type TriggerEngineStats,
} from './TriggerEngine.js';

// 上下文快照
export {
  ContextSnapshot,
  SnapshotType,
  SnapshotStatus,
  type Snapshot,
  type SnapshotChange,
  type RestoreResult,
  type ContextSnapshotConfig,
  type SnapshotStats,
} from './ContextSnapshot.js';
