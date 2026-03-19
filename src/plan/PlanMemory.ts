/**
 * MemLite - 计划管理数据模型
 *
 * 实现脑科学启发的计划管理系统：
 * - 工作记忆过载的认知卸载
 * - 前额叶执行功能的计划分支
 * - 前瞻性记忆的未来触发
 * - 注意力恢复的断点续传
 */

/**
 * 计划状态
 */
export enum PlanStatus {
  /** 活跃 - 正在执行 */
  ACTIVE = 'active',
  /** 暂停 - 临时中断 */
  PAUSED = 'paused',
  /** 完成 - 所有任务完成 */
  COMPLETED = 'completed',
  /** 放弃 - 不再执行 */
  ABANDONED = 'abandoned',
}

/**
 * 任务状态
 */
export enum TaskStatus {
  /** 待处理 */
  PENDING = 'pending',
  /** 进行中 */
  IN_PROGRESS = 'in_progress',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已阻塞 */
  BLOCKED = 'blocked',
  /** 已取消 */
  CANCELLED = 'cancelled',
}

/**
 * 分支类型
 */
export enum BranchType {
  /** 独立分支 - 完全独立的新计划 */
  INDEPENDENT = 'independent',
  /** 子任务分支 - 主计划的子任务 */
  SUBTASK = 'subtask',
  /** 探索分支 - 临时探索，可能合并回主计划 */
  EXPLORATORY = 'exploratory',
  /** 中断分支 - 被外部中断创建 */
  INTERRUPTION = 'interruption',
}

/**
 * 切换点原因
 */
export enum SwitchReason {
  /** 用户主动切换 */
  USER_REQUEST = 'user_request',
  /** 阻塞等待 */
  BLOCKED_WAIT = 'blocked_wait',
  /** 优先级更高 */
  HIGHER_PRIORITY = 'higher_priority',
  /** 外部中断 */
  INTERRUPTION = 'interruption',
  /** 定时触发 */
  SCHEDULED = 'scheduled',
  /** 依赖满足 */
  DEPENDENCY_MET = 'dependency_met',
}

/**
 * 计划任务
 */
export interface PlanTask {
  /** 任务ID */
  id: string;
  /** 所属计划ID */
  plan_id: string;
  /** 任务描述 */
  description: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 依赖的任务ID列表 */
  dependencies: string[];
  /** 优先级 (1-10) */
  priority: number;
  /** 预估时间（分钟） */
  estimated_minutes?: number;
  /** 实际耗时（分钟） */
  actual_minutes?: number;
  /** 创建时间 */
  created_at: number;
  /** 更新时间 */
  updated_at: number;
  /** 完成时间 */
  completed_at?: number;
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 切换点记录
 */
export interface SwitchPoint {
  /** 切换点ID */
  id: string;
  /** 源计划ID */
  from_plan_id: string;
  /** 目标计划ID */
  to_plan_id: string;
  /** 切换原因 */
  reason: SwitchReason;
  /** 切换时的上下文快照ID */
  context_snapshot_id?: string;
  /** 切换时间 */
  timestamp: number;
  /** 切换备注 */
  note?: string;
}

/**
 * 计划分支信息
 */
export interface PlanBranch {
  /** 分支ID */
  id: string;
  /** 父计划ID */
  parent_plan_id: string;
  /** 子计划ID */
  child_plan_id: string;
  /** 分支类型 */
  branch_type: BranchType;
  /** 分支点任务ID（从哪个任务分出） */
  branch_at_task_id?: string;
  /** 创建时间 */
  created_at: number;
  /** 是否已合并 */
  merged: boolean;
  /** 合并时间 */
  merged_at?: number;
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
  status: PlanStatus;
  /** 优先级 (1-10) */
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
  /** 完成时间 */
  completed_at?: number;
  /** 预估总时间（分钟） */
  estimated_total_minutes?: number;
  /** 实际总时间（分钟） */
  actual_total_minutes?: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 计划上下文
 */
export interface PlanContext {
  /** 当前活跃计划 */
  activePlan: PlanMemory | null;
  /** 所有计划列表 */
  allPlans: PlanMemory[];
  /** 计划分支关系 */
  branches: PlanBranch[];
  /** 最近切换历史 */
  recentSwitches: SwitchPoint[];
  /** 暂停的计划栈 */
  pausedStack: string[];
}

/**
 * 计划配置
 */
export interface PlanConfig {
  /** 最大活跃计划数 */
  maxActivePlans: number;
  /** 最大暂停栈深度 */
  maxPausedStackDepth: number;
  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;
  /** 上下文快照保留数量 */
  maxContextSnapshots: number;
  /** 启用自动分支检测 */
  enableAutoBranchDetection: boolean;
  /** 启用自动回归检测 */
  enableAutoReturnDetection: boolean;
}

/**
 * 默认计划配置
 */
export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  maxActivePlans: 5,
  maxPausedStackDepth: 10,
  autoSaveInterval: 30000, // 30秒
  maxContextSnapshots: 10,
  enableAutoBranchDetection: true,
  enableAutoReturnDetection: true,
};

/**
 * 计划统计
 */
export interface PlanStats {
  /** 总计划数 */
  totalPlans: number;
  /** 活跃计划数 */
  activePlans: number;
  /** 已完成计划数 */
  completedPlans: number;
  /** 已放弃计划数 */
  abandonedPlans: number;
  /** 总任务数 */
  totalTasks: number;
  /** 已完成任务数 */
  completedTasks: number;
  /** 平均完成时间（分钟） */
  avgCompletionTime: number;
  /** 分支创建次数 */
  branchCount: number;
  /** 计划切换次数 */
  switchCount: number;
}

/**
 * 创建新计划任务的工厂函数
 */
export function createPlanTask(
  planId: string,
  description: string,
  options: Partial<PlanTask> = {}
): PlanTask {
  const now = Date.now();
  return {
    id: `task_${now}_${Math.random().toString(36).substr(2, 9)}`,
    plan_id: planId,
    description,
    status: TaskStatus.PENDING,
    dependencies: [],
    priority: 5,
    created_at: now,
    updated_at: now,
    ...options,
  };
}

/**
 * 创建新计划的工厂函数
 */
export function createPlanMemory(
  title: string,
  description: string,
  options: Partial<PlanMemory> = {}
): PlanMemory {
  const now = Date.now();
  const id = `plan_${now}_${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    title,
    description,
    tasks: [],
    status: PlanStatus.ACTIVE,
    priority: 5,
    context_tags: [],
    switch_points: [],
    created_at: now,
    updated_at: now,
    last_active_at: now,
    ...options,
  };
}

/**
 * 创建切换点的工厂函数
 */
export function createSwitchPoint(
  fromPlanId: string,
  toPlanId: string,
  reason: SwitchReason,
  options: Partial<SwitchPoint> = {}
): SwitchPoint {
  return {
    id: `switch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    from_plan_id: fromPlanId,
    to_plan_id: toPlanId,
    reason,
    timestamp: Date.now(),
    ...options,
  };
}

/**
 * 创建计划分支的工厂函数
 */
export function createPlanBranch(
  parentPlanId: string,
  childPlanId: string,
  branchType: BranchType,
  options: Partial<PlanBranch> = {}
): PlanBranch {
  return {
    id: `branch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    parent_plan_id: parentPlanId,
    child_plan_id: childPlanId,
    branch_type: branchType,
    created_at: Date.now(),
    merged: false,
    ...options,
  };
}

/**
 * 计划进度计算
 */
export function calculatePlanProgress(plan: PlanMemory): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  percentage: number;
} {
  const total = plan.tasks.length;
  const completed = plan.tasks.filter(t => t.status === TaskStatus.COMPLETED).length;
  const inProgress = plan.tasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length;
  const pending = plan.tasks.filter(t => t.status === TaskStatus.PENDING).length;
  const blocked = plan.tasks.filter(t => t.status === TaskStatus.BLOCKED).length;

  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return { total, completed, inProgress, pending, blocked, percentage };
}

/**
 * 检查任务依赖是否满足
 */
export function checkTaskDependencies(
  task: PlanTask,
  allTasks: PlanTask[]
): { satisfied: boolean; missingDependencies: string[] } {
  const completedTaskIds = new Set(
    allTasks.filter(t => t.status === TaskStatus.COMPLETED).map(t => t.id)
  );

  const missingDependencies = task.dependencies.filter(depId => !completedTaskIds.has(depId));

  return {
    satisfied: missingDependencies.length === 0,
    missingDependencies,
  };
}

/**
 * 获取下一个可执行任务
 */
export function getNextExecutableTask(plan: PlanMemory): PlanTask | null {
  const { tasks } = plan;

  // 按优先级排序
  const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority);

  for (const task of sortedTasks) {
    if (task.status === TaskStatus.PENDING || task.status === TaskStatus.BLOCKED) {
      const { satisfied } = checkTaskDependencies(task, tasks);
      if (satisfied) {
        return task;
      }
    }
  }

  return null;
}

/**
 * 检查计划是否可完成
 */
export function isPlanCompletable(plan: PlanMemory): boolean {
  const { tasks } = plan;
  const allCompleted = tasks.every(t => t.status === TaskStatus.COMPLETED);
  const hasBlockingTasks = tasks.some(t => t.status === TaskStatus.BLOCKED);

  return allCompleted && !hasBlockingTasks;
}

export default PlanMemory;
