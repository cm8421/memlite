/**
 * MemLite - 计划管理器
 *
 * 实现脑科学启发的计划管理系统：
 * - 工作记忆过载的认知卸载
 * - 前额叶执行功能的计划分支
 * - 前瞻性记忆的未来触发
 * - 注意力恢复的断点续传
 */

import {
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

/**
 * 计划管理器
 *
 * 核心功能：
 * 1. 计划创建与销毁
 * 2. 状态转换（active/paused/completed/abandoned）
 * 3. 分支创建与合并
 * 4. 任务依赖管理
 * 5. 上下文保存与恢复
 */
export class PlanManager {
  private config: PlanConfig;
  private context: PlanContext;
  private store: PlanStore | null = null;

  // 统计
  private stats: {
    planCreations: number;
    branchCreations: number;
    planSwitches: number;
    taskCompletions: number;
    latencies: number[];
  };

  constructor(config: Partial<PlanConfig> = {}) {
    this.config = { ...DEFAULT_PLAN_CONFIG, ...config };

    this.context = {
      activePlan: null,
      allPlans: [],
      branches: [],
      recentSwitches: [],
      pausedStack: [],
    };

    this.stats = {
      planCreations: 0,
      branchCreations: 0,
      planSwitches: 0,
      taskCompletions: 0,
      latencies: [],
    };
  }

  /**
   * 设置存储后端
   */
  setStore(store: PlanStore): void {
    this.store = store;
    this.loadFromStore();
  }

  /**
   * 从存储加载计划
   */
  private loadFromStore(): void {
    if (!this.store) return;

    this.context.allPlans = this.store.loadAllPlans();
    this.context.branches = this.store.loadAllBranches();
    this.context.recentSwitches = this.store.loadRecentSwitches(20);

    // 恢复活跃计划
    const activePlanId = this.store.getActivePlanId();
    if (activePlanId) {
      this.context.activePlan =
        this.context.allPlans.find(p => p.id === activePlanId) || null;
    }
  }

  // ============================================================================
  // 计划生命周期
  // ============================================================================

  /**
   * 创建新计划
   */
  createPlan(
    title: string,
    description: string,
    options: {
      priority?: number;
      contextTags?: string[];
      tasks?: Array<{ description: string; priority?: number }>;
      parentPlanId?: string;
    } = {}
  ): PlanMemory {
    const start = Date.now();

    const plan = createPlanMemory(title, description, {
      priority: options.priority ?? 5,
      context_tags: options.contextTags ?? [],
      parent_plan_id: options.parentPlanId,
    });

    // 添加任务
    if (options.tasks) {
      for (const taskDef of options.tasks) {
        const task = createPlanTask(plan.id, taskDef.description, {
          priority: taskDef.priority ?? 5,
        });
        plan.tasks.push(task);
      }
    }

    // 保存到存储
    if (this.store) {
      this.store.savePlan(plan);
    }

    // 添加到上下文
    this.context.allPlans.push(plan);

    // 如果有父计划，创建分支关系
    if (options.parentPlanId) {
      const branch = createPlanBranch(
        options.parentPlanId,
        plan.id,
        BranchType.SUBTASK
      );
      this.context.branches.push(branch);
      if (this.store) {
        this.store.saveBranch(branch);
      }
      this.stats.branchCreations++;
    }

    // 更新统计
    this.stats.planCreations++;
    this.stats.latencies.push(Date.now() - start);
    if (this.stats.latencies.length > 100) {
      this.stats.latencies.shift();
    }

    return plan;
  }

  /**
   * 激活计划
   */
  activatePlan(planId: string): {
    success: boolean;
    previousPlan?: PlanMemory;
    switchPoint?: SwitchPoint;
  } {
    const plan = this.context.allPlans.find(p => p.id === planId);
    if (!plan) {
      return { success: false };
    }

    // 检查是否已经是活跃计划
    if (this.context.activePlan?.id === planId) {
      return { success: true };
    }

    const previousPlan = this.context.activePlan;

    // 创建切换点
    let switchPoint: SwitchPoint | undefined;
    if (previousPlan) {
      // 保存当前计划状态
      previousPlan.last_active_at = Date.now();
      if (this.store) {
        this.store.savePlan(previousPlan);
      }

      // 将当前计划加入暂停栈
      this.context.pausedStack.push(previousPlan.id);
      if (this.context.pausedStack.length > this.config.maxPausedStackDepth) {
        this.context.pausedStack.shift();
      }

      // 创建切换记录
      switchPoint = createSwitchPoint(
        previousPlan.id,
        planId,
        SwitchReason.USER_REQUEST
      );
      this.context.recentSwitches.push(switchPoint);
      if (this.store) {
        this.store.saveSwitchPoint(switchPoint);
      }

      this.stats.planSwitches++;
    }

    // 激活新计划
    plan.status = PlanStatus.ACTIVE;
    plan.last_active_at = Date.now();
    this.context.activePlan = plan;

    if (this.store) {
      this.store.setActivePlanId(planId);
      this.store.savePlan(plan);
    }

    return { success: true, previousPlan: previousPlan ?? undefined, switchPoint };
  }

  /**
   * 暂停当前计划
   */
  pauseCurrentPlan(_reason: SwitchReason = SwitchReason.USER_REQUEST): {
    success: boolean;
    pausedPlan?: PlanMemory;
  } {
    if (!this.context.activePlan) {
      return { success: false };
    }

    const plan = this.context.activePlan;
    plan.status = PlanStatus.PAUSED;
    plan.updated_at = Date.now();

    if (this.store) {
      this.store.savePlan(plan);
    }

    this.context.activePlan = null;
    if (this.store) {
      this.store.setActivePlanId(null);
    }

    return { success: true, pausedPlan: plan };
  }

  /**
   * 完成计划
   */
  completePlan(planId: string): { success: boolean; plan?: PlanMemory } {
    const plan = this.context.allPlans.find(p => p.id === planId);
    if (!plan) {
      return { success: false };
    }

    // 检查是否可完成
    if (!isPlanCompletable(plan)) {
      return { success: false };
    }

    plan.status = PlanStatus.COMPLETED;
    plan.completed_at = Date.now();
    plan.updated_at = Date.now();

    // 计算实际耗时
    const completedTasks = plan.tasks.filter(t => t.status === TaskStatus.COMPLETED);
    plan.actual_total_minutes = completedTasks.reduce(
      (sum, t) => sum + (t.actual_minutes ?? 0),
      0
    );

    if (this.store) {
      this.store.savePlan(plan);
    }

    // 如果是当前活跃计划，清空
    if (this.context.activePlan?.id === planId) {
      this.context.activePlan = null;
      if (this.store) {
        this.store.setActivePlanId(null);
      }
    }

    return { success: true, plan };
  }

  /**
   * 放弃计划
   */
  abandonPlan(planId: string, note?: string): { success: boolean; plan?: PlanMemory } {
    const plan = this.context.allPlans.find(p => p.id === planId);
    if (!plan) {
      return { success: false };
    }

    plan.status = PlanStatus.ABANDONED;
    plan.updated_at = Date.now();

    if (note && this.store) {
      plan.metadata = { ...plan.metadata, abandonNote: note };
    }

    if (this.store) {
      this.store.savePlan(plan);
    }

    // 如果是当前活跃计划，清空
    if (this.context.activePlan?.id === planId) {
      this.context.activePlan = null;
      if (this.store) {
        this.store.setActivePlanId(null);
      }
    }

    return { success: true, plan };
  }

  // ============================================================================
  // 任务管理
  // ============================================================================

  /**
   * 添加任务
   */
  addTask(
    planId: string,
    description: string,
    options: {
      priority?: number;
      dependencies?: string[];
      estimatedMinutes?: number;
    } = {}
  ): PlanTask | null {
    const plan = this.context.allPlans.find(p => p.id === planId);
    if (!plan) return null;

    const task = createPlanTask(planId, description, {
      priority: options.priority ?? 5,
      dependencies: options.dependencies ?? [],
      estimated_minutes: options.estimatedMinutes,
    });

    plan.tasks.push(task);
    plan.updated_at = Date.now();

    if (this.store) {
      this.store.savePlan(plan);
    }

    return task;
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(
    planId: string,
    taskId: string,
    status: TaskStatus,
    options: { actualMinutes?: number } = {}
  ): { success: boolean; task?: PlanTask } {
    const plan = this.context.allPlans.find(p => p.id === planId);
    if (!plan) return { success: false };

    const task = plan.tasks.find(t => t.id === taskId);
    if (!task) return { success: false };

    // 检查依赖
    if (status === TaskStatus.IN_PROGRESS || status === TaskStatus.COMPLETED) {
      const { satisfied } = checkTaskDependencies(task, plan.tasks);
      if (!satisfied) {
        task.status = TaskStatus.BLOCKED;
        if (this.store) {
          this.store.savePlan(plan);
        }
        return {
          success: false,
          task,
        };
      }
    }

    task.status = status;
    task.updated_at = Date.now();

    if (status === TaskStatus.COMPLETED) {
      task.completed_at = Date.now();
      task.actual_minutes = options.actualMinutes;
      this.stats.taskCompletions++;
    }

    plan.updated_at = Date.now();

    if (this.store) {
      this.store.savePlan(plan);
    }

    return { success: true, task };
  }

  /**
   * 获取下一个可执行任务
   */
  getNextTask(planId?: string): PlanTask | null {
    const targetPlan = planId
      ? this.context.allPlans.find(p => p.id === planId)
      : this.context.activePlan;

    if (!targetPlan) return null;

    return getNextExecutableTask(targetPlan);
  }

  // ============================================================================
  // 分支管理
  // ============================================================================

  /**
   * 创建分支计划
   */
  createBranch(
    parentPlanId: string,
    title: string,
    description: string,
    branchType: BranchType = BranchType.SUBTASK,
    options: {
      branchAtTaskId?: string;
      inheritTasks?: boolean;
    } = {}
  ): PlanMemory | null {
    const parentPlan = this.context.allPlans.find(p => p.id === parentPlanId);
    if (!parentPlan) return null;

    // 创建子计划
    const childPlan = this.createPlan(title, description, {
      priority: parentPlan.priority,
      contextTags: [...parentPlan.context_tags],
      parentPlanId,
    });

    // 如果需要继承任务
    if (options.inheritTasks && options.branchAtTaskId) {
      const branchIndex = parentPlan.tasks.findIndex(
        t => t.id === options.branchAtTaskId
      );
      if (branchIndex >= 0) {
        // 复制分支点之后的任务到子计划
        for (let i = branchIndex; i < parentPlan.tasks.length; i++) {
          const originalTask = parentPlan.tasks[i];
          const newTask = createPlanTask(childPlan.id, originalTask.description, {
            priority: originalTask.priority,
            dependencies: originalTask.dependencies,
          });
          childPlan.tasks.push(newTask);
        }
      }
    }

    // 创建分支关系
    const branch = createPlanBranch(parentPlanId, childPlan.id, branchType, {
      branch_at_task_id: options.branchAtTaskId,
    });

    this.context.branches.push(branch);
    if (this.store) {
      this.store.saveBranch(branch);
      this.store.savePlan(childPlan);
    }

    this.stats.branchCreations++;

    return childPlan;
  }

  /**
   * 合并分支回主计划
   */
  mergeBranch(
    childPlanId: string,
    options: { copyTasks?: boolean } = {}
  ): { success: boolean; mergedTasks?: number } {
    const branch = this.context.branches.find(b => b.child_plan_id === childPlanId);
    if (!branch || branch.merged) {
      return { success: false };
    }

    const parentPlan = this.context.allPlans.find(
      p => p.id === branch.parent_plan_id
    );
    const childPlan = this.context.allPlans.find(p => p.id === childPlanId);

    if (!parentPlan || !childPlan) {
      return { success: false };
    }

    let mergedTasks = 0;

    // 如果需要复制任务
    if (options.copyTasks) {
      const childCompletedTasks = childPlan.tasks.filter(
        t => t.status === TaskStatus.COMPLETED
      );

      for (const childTask of childCompletedTasks) {
        const newTask = createPlanTask(parentPlan.id, childTask.description, {
          priority: childTask.priority,
          status: TaskStatus.COMPLETED,
          completed_at: childTask.completed_at,
          actual_minutes: childTask.actual_minutes,
        });
        parentPlan.tasks.push(newTask);
        mergedTasks++;
      }

      parentPlan.updated_at = Date.now();
      if (this.store) {
        this.store.savePlan(parentPlan);
      }
    }

    // 标记分支已合并
    branch.merged = true;
    branch.merged_at = Date.now();

    // 标记子计划已完成
    childPlan.status = PlanStatus.COMPLETED;
    childPlan.completed_at = Date.now();

    if (this.store) {
      this.store.saveBranch(branch);
      this.store.savePlan(childPlan);
    }

    return { success: true, mergedTasks };
  }

  // ============================================================================
  // 上下文管理
  // ============================================================================

  /**
   * 获取当前上下文
   */
  getContext(): PlanContext {
    return { ...this.context };
  }

  /**
   * 获取活跃计划
   */
  getActivePlan(): PlanMemory | null {
    return this.context.activePlan;
  }

  /**
   * 获取所有计划
   */
  getAllPlans(): PlanMemory[] {
    return [...this.context.allPlans];
  }

  /**
   * 获取计划
   */
  getPlan(planId: string): PlanMemory | null {
    return this.context.allPlans.find(p => p.id === planId) || null;
  }

  /**
   * 获取计划进度
   */
  getPlanProgress(planId: string): ReturnType<typeof calculatePlanProgress> | null {
    const plan = this.getPlan(planId);
    if (!plan) return null;
    return calculatePlanProgress(plan);
  }

  /**
   * 获取暂停栈
   */
  getPausedStack(): PlanMemory[] {
    return this.context.pausedStack
      .map(id => this.context.allPlans.find(p => p.id === id))
      .filter((p): p is PlanMemory => p !== undefined);
  }

  /**
   * 返回上一个暂停的计划
   */
  returnToPreviousPlan(): {
    success: boolean;
    plan?: PlanMemory;
  } {
    if (this.context.pausedStack.length === 0) {
      return { success: false };
    }

    const previousPlanId = this.context.pausedStack.pop();
    if (!previousPlanId) {
      return { success: false };
    }

    const result = this.activatePlan(previousPlanId);
    return {
      success: result.success,
      plan: this.context.activePlan ?? undefined,
    };
  }

  // ============================================================================
  // 搜索与过滤
  // ============================================================================

  /**
   * 搜索计划
   */
  searchPlans(query: string, options: {
    status?: PlanStatus[];
    tags?: string[];
    limit?: number;
  } = {}): PlanMemory[] {
    let results = this.context.allPlans;

    // 状态过滤
    if (options.status && options.status.length > 0) {
      results = results.filter(p => options.status!.includes(p.status));
    }

    // 标签过滤
    if (options.tags && options.tags.length > 0) {
      results = results.filter(p =>
        options.tags!.some(tag => p.context_tags.includes(tag))
      );
    }

    // 文本搜索
    const lowerQuery = query.toLowerCase();
    results = results.filter(p =>
      p.title.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.tasks.some(t => t.description.toLowerCase().includes(lowerQuery))
    );

    // 限制数量
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  // ============================================================================
  // 统计
  // ============================================================================

  /**
   * 获取统计信息
   */
  getStats(): PlanStats {
    const totalPlans = this.context.allPlans.length;
    const activePlans = this.context.allPlans.filter(
      p => p.status === PlanStatus.ACTIVE
    ).length;
    const completedPlans = this.context.allPlans.filter(
      p => p.status === PlanStatus.COMPLETED
    ).length;
    const abandonedPlans = this.context.allPlans.filter(
      p => p.status === PlanStatus.ABANDONED
    ).length;

    const allTasks = this.context.allPlans.flatMap(p => p.tasks);
    const completedTasks = allTasks.filter(
      t => t.status === TaskStatus.COMPLETED
    ).length;

    // 计算平均完成时间
    const completedPlansWithData = this.context.allPlans.filter(
      p => p.status === PlanStatus.COMPLETED && p.actual_total_minutes
    );
    const avgCompletionTime =
      completedPlansWithData.length > 0
        ? completedPlansWithData.reduce(
            (sum, p) => sum + (p.actual_total_minutes ?? 0),
            0
          ) / completedPlansWithData.length
        : 0;

    return {
      totalPlans,
      activePlans,
      completedPlans,
      abandonedPlans,
      totalTasks: allTasks.length,
      completedTasks,
      avgCompletionTime,
      branchCount: this.stats.branchCreations,
      switchCount: this.stats.planSwitches,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      planCreations: 0,
      branchCreations: 0,
      planSwitches: 0,
      taskCompletions: 0,
      latencies: [],
    };
  }
}

/**
 * 计划存储接口
 */
export interface PlanStore {
  savePlan(plan: PlanMemory): void;
  loadAllPlans(): PlanMemory[];
  saveBranch(branch: PlanBranch): void;
  loadAllBranches(): PlanBranch[];
  saveSwitchPoint(switchPoint: SwitchPoint): void;
  loadRecentSwitches(limit: number): SwitchPoint[];
  getActivePlanId(): string | null;
  setActivePlanId(planId: string | null): void;
}

export default PlanManager;
