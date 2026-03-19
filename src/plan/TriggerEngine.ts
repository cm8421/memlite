/**
 * MemLite - 前瞻触发引擎
 *
 * 实现前瞻性记忆的未来触发：
 * - 时间触发（cron/相对时间）
 * - 事件触发（条件/依赖链）
 * - 触发可靠性与重试
 */

// PlanMemory and PlanTask types are used for future integration

/**
 * 触发类型
 */
export enum TriggerType {
  /** 时间触发 */
  TIME = 'time',
  /** 事件触发 */
  EVENT = 'event',
  /** 依赖触发 */
  DEPENDENCY = 'dependency',
}

/**
 * 触发状态
 */
export enum TriggerStatus {
  /** 待触发 */
  PENDING = 'pending',
  /** 已触发 */
  TRIGGERED = 'triggered',
  /** 已完成 */
  COMPLETED = 'completed',
  /** 已取消 */
  CANCELLED = 'cancelled',
  /** 失败 */
  FAILED = 'failed',
}

/**
 * 时间触发配置
 */
export interface TimeTriggerConfig {
  /** cron 表达式或相对时间描述 */
  schedule: string;
  /** 时区（默认本地） */
  timezone?: string;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
}

/**
 * 事件触发配置
 */
export interface EventTriggerConfig {
  /** 条件表达式 */
  condition: string;
  /** 监听的事件类型 */
  eventTypes: string[];
}

/**
 * 依赖触发配置
 */
export interface DependencyTriggerConfig {
  /** 依赖的任务ID */
  dependsOnTaskId: string;
  /** 依赖的计划ID */
  dependsOnPlanId: string;
}

/**
 * 触发器定义
 */
export interface Trigger {
  /** 触发器ID */
  id: string;
  /** 触发类型 */
  type: TriggerType;
  /** 触发状态 */
  status: TriggerStatus;
  /** 目标计划ID */
  targetPlanId: string;
  /** 目标任务ID（可选） */
  targetTaskId?: string;
  /** 触发配置 */
  config: TimeTriggerConfig | EventTriggerConfig | DependencyTriggerConfig;
  /** 触发消息 */
  message: string;
  /** 创建时间 */
  createdAt: number;
  /** 下次触发时间 */
  nextTriggerAt?: number;
  /** 最后触发时间 */
  lastTriggeredAt?: number;
  /** 触发次数 */
  triggerCount: number;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 触发结果
 */
export interface TriggerResult {
  /** 触发器ID */
  triggerId: string;
  /** 是否成功 */
  success: boolean;
  /** 触发时间 */
  triggeredAt: number;
  /** 触发消息 */
  message: string;
  /** 目标计划ID */
  targetPlanId: string;
  /** 目标任务ID */
  targetTaskId?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 触发引擎配置
 */
export interface TriggerEngineConfig {
  /** 检查间隔（毫秒） */
  checkInterval: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
  /** 触发精度（毫秒） */
  triggerPrecision: number;
  /** 最大待触发器数量 */
  maxPendingTriggers: number;
  /** 启用自动检查 */
  enableAutoCheck: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_TRIGGER_ENGINE_CONFIG: TriggerEngineConfig = {
  checkInterval: 60000, // 1分钟
  maxRetries: 3,
  retryDelay: 5000, // 5秒
  triggerPrecision: 60000, // ±1分钟
  maxPendingTriggers: 100,
  enableAutoCheck: true,
};

/**
 * 触发引擎统计
 */
export interface TriggerEngineStats {
  /** 总触发器数 */
  totalTriggers: number;
  /** 待触发数 */
  pendingTriggers: number;
  /** 已触发数 */
  triggeredCount: number;
  /** 成功触发数 */
  successCount: number;
  /** 失败触发数 */
  failedCount: number;
  /** 重试次数 */
  retryCount: number;
  /** 平均触发延迟（毫秒） */
  avgTriggerLatency: number;
}

/**
 * 前瞻触发引擎
 *
 * 核心功能：
 * 1. 时间触发（支持 cron 和相对时间）
 * 2. 事件触发（条件表达式）
 * 3. 依赖触发（任务依赖链）
 * 4. 触发可靠性与重试
 */
export class TriggerEngine {
  private config: TriggerEngineConfig;
  private triggers: Map<string, Trigger>;
  private checkTimer: NodeJS.Timeout | null = null;

  // 统计
  private stats: {
    totalTriggers: number;
    triggeredCount: number;
    successCount: number;
    failedCount: number;
    retryCount: number;
    latencies: number[];
  };

  // 触发回调
  private onTriggerCallback: ((result: TriggerResult) => void) | null = null;

  constructor(config: Partial<TriggerEngineConfig> = {}) {
    this.config = { ...DEFAULT_TRIGGER_ENGINE_CONFIG, ...config };
    this.triggers = new Map();

    this.stats = {
      totalTriggers: 0,
      triggeredCount: 0,
      successCount: 0,
      failedCount: 0,
      retryCount: 0,
      latencies: [],
    };
  }

  /**
   * 设置触发回调
   */
  onTrigger(callback: (result: TriggerResult) => void): void {
    this.onTriggerCallback = callback;
  }

  /**
   * 启动自动检查
   */
  start(): void {
    if (!this.config.enableAutoCheck || this.checkTimer) return;

    this.checkTimer = setInterval(() => {
      this.checkTriggers();
    }, this.config.checkInterval);
  }

  /**
   * 停止自动检查
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  // ============================================================================
  // 时间触发
  // ============================================================================

  /**
   * 创建时间触发器
   *
   * @param targetPlanId 目标计划ID
   * @param schedule cron表达式或相对时间
   * @param message 触发消息
   * @param options 可选配置
   */
  createTimeTrigger(
    targetPlanId: string,
    schedule: string,
    message: string,
    options: {
      targetTaskId?: string;
      timezone?: string;
      startTime?: number;
      endTime?: number;
    } = {}
  ): Trigger {
    const now = Date.now();
    const trigger: Trigger = {
      id: `trigger_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type: TriggerType.TIME,
      status: TriggerStatus.PENDING,
      targetPlanId,
      targetTaskId: options.targetTaskId,
      config: {
        schedule,
        timezone: options.timezone,
        startTime: options.startTime,
        endTime: options.endTime,
      },
      message,
      createdAt: now,
      nextTriggerAt: this.parseSchedule(schedule),
      triggerCount: 0,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    this.triggers.set(trigger.id, trigger);
    this.stats.totalTriggers++;

    return trigger;
  }

  /**
   * 解析时间表达式
   *
   * 支持格式：
   * - cron: "0 9 * * *" (每天9点)
   * - 相对: "明天早上9点", "1小时后", "2024-12-25 10:00"
   */
  private parseSchedule(schedule: string): number {
    const now = Date.now();

    // 尝试解析相对时间
    const relativeTime = this.parseRelativeTime(schedule);
    if (relativeTime) {
      return relativeTime;
    }

    // 尝试解析绝对时间
    const absoluteTime = Date.parse(schedule);
    if (!isNaN(absoluteTime)) {
      return absoluteTime;
    }

    // 尝试解析 cron（简化版：仅支持每天固定时间）
    const cronMatch = schedule.match(/^(\d{1,2}):(\d{2})$/);
    if (cronMatch) {
      const hours = parseInt(cronMatch[1], 10);
      const minutes = parseInt(cronMatch[2], 10);

      const target = new Date();
      target.setHours(hours, minutes, 0, 0);

      // 如果时间已过，设为明天
      if (target.getTime() <= now) {
        target.setDate(target.getDate() + 1);
      }

      return target.getTime();
    }

    // 默认：1小时后
    return now + 3600000;
  }

  /**
   * 解析相对时间
   */
  private parseRelativeTime(text: string): number | null {
    const now = Date.now();
    const lowerText = text.toLowerCase();

    // "X小时后"
    const hoursMatch = lowerText.match(/(\d+)\s*小时后/);
    if (hoursMatch) {
      return now + parseInt(hoursMatch[1], 10) * 3600000;
    }

    // "X分钟后"
    const minutesMatch = lowerText.match(/(\d+)\s*分钟后/);
    if (minutesMatch) {
      return now + parseInt(minutesMatch[1], 10) * 60000;
    }

    // "X天后"
    const daysMatch = lowerText.match(/(\d+)\s*天后/);
    if (daysMatch) {
      return now + parseInt(daysMatch[1], 10) * 86400000;
    }

    // "明天早上X点"
    const tomorrowMorningMatch = lowerText.match(/明天早上\s*(\d{1,2})\s*点/);
    if (tomorrowMorningMatch) {
      const hours = parseInt(tomorrowMorningMatch[1], 10);
      const target = new Date();
      target.setDate(target.getDate() + 1);
      target.setHours(hours, 0, 0, 0);
      return target.getTime();
    }

    // "今天下午X点"
    const todayAfternoonMatch = lowerText.match(/今天下午\s*(\d{1,2})\s*点/);
    if (todayAfternoonMatch) {
      const hours = parseInt(todayAfternoonMatch[1], 10) + 12;
      const target = new Date();
      target.setHours(hours, 0, 0, 0);
      if (target.getTime() > now) {
        return target.getTime();
      }
    }

    return null;
  }

  // ============================================================================
  // 事件触发
  // ============================================================================

  /**
   * 创建事件触发器
   *
   * @param targetPlanId 目标计划ID
   * @param condition 条件表达式
   * @param message 触发消息
   * @param options 可选配置
   */
  createEventTrigger(
    targetPlanId: string,
    condition: string,
    message: string,
    options: {
      targetTaskId?: string;
      eventTypes?: string[];
    } = {}
  ): Trigger {
    const now = Date.now();
    const trigger: Trigger = {
      id: `trigger_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type: TriggerType.EVENT,
      status: TriggerStatus.PENDING,
      targetPlanId,
      targetTaskId: options.targetTaskId,
      config: {
        condition,
        eventTypes: options.eventTypes || ['*'],
      },
      message,
      createdAt: now,
      triggerCount: 0,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    this.triggers.set(trigger.id, trigger);
    this.stats.totalTriggers++;

    return trigger;
  }

  /**
   * 检查事件条件
   */
  checkEventCondition(
    trigger: Trigger,
    event: { type: string; data: Record<string, unknown> }
  ): boolean {
    if (trigger.type !== TriggerType.EVENT) return false;

    const config = trigger.config as EventTriggerConfig;

    // 检查事件类型
    if (!config.eventTypes.includes('*') && !config.eventTypes.includes(event.type)) {
      return false;
    }

    // 简化条件评估（实际实现可能需要更复杂的表达式解析）
    const condition = config.condition.toLowerCase();

    // "当X完成时"
    if (condition.includes('完成') && event.type === 'task_completed') {
      return true;
    }

    // "当X开始时"
    if (condition.includes('开始') && event.type === 'task_started') {
      return true;
    }

    return false;
  }

  // ============================================================================
  // 依赖触发
  // ============================================================================

  /**
   * 创建依赖触发器
   *
   * @param targetPlanId 目标计划ID
   * @param dependsOnPlanId 依赖的计划ID
   * @param dependsOnTaskId 依赖的任务ID
   * @param message 触发消息
   * @param options 可选配置
   */
  createDependencyTrigger(
    targetPlanId: string,
    dependsOnPlanId: string,
    dependsOnTaskId: string,
    message: string,
    options: {
      targetTaskId?: string;
    } = {}
  ): Trigger {
    const now = Date.now();
    const trigger: Trigger = {
      id: `trigger_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type: TriggerType.DEPENDENCY,
      status: TriggerStatus.PENDING,
      targetPlanId,
      targetTaskId: options.targetTaskId,
      config: {
        dependsOnPlanId,
        dependsOnTaskId,
      },
      message,
      createdAt: now,
      triggerCount: 0,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    this.triggers.set(trigger.id, trigger);
    this.stats.totalTriggers++;

    return trigger;
  }

  /**
   * 检查依赖是否满足
   */
  checkDependency(
    trigger: Trigger,
    completedTasks: Array<{ planId: string; taskId: string }>
  ): boolean {
    if (trigger.type !== TriggerType.DEPENDENCY) return false;

    const config = trigger.config as DependencyTriggerConfig;

    return completedTasks.some(
      t => t.planId === config.dependsOnPlanId && t.taskId === config.dependsOnTaskId
    );
  }

  // ============================================================================
  // 触发执行
  // ============================================================================

  /**
   * 检查所有触发器
   */
  checkTriggers(): TriggerResult[] {
    const now = Date.now();
    const results: TriggerResult[] = [];

    for (const [_id, trigger] of this.triggers) {
      if (trigger.status !== TriggerStatus.PENDING) continue;

      let shouldTrigger = false;

      // 时间触发检查
      if (trigger.type === TriggerType.TIME && trigger.nextTriggerAt) {
        const diff = Math.abs(now - trigger.nextTriggerAt);
        if (diff <= this.config.triggerPrecision) {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        const result = this.executeTrigger(trigger);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 检查事件触发
   */
  checkEventTriggers(event: { type: string; data: Record<string, unknown> }): TriggerResult[] {
    const results: TriggerResult[] = [];

    for (const trigger of this.triggers.values()) {
      if (trigger.status !== TriggerStatus.PENDING) continue;
      if (trigger.type !== TriggerType.EVENT) continue;

      if (this.checkEventCondition(trigger, event)) {
        const result = this.executeTrigger(trigger);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 检查依赖触发
   */
  checkDependencyTriggers(
    completedTasks: Array<{ planId: string; taskId: string }>
  ): TriggerResult[] {
    const results: TriggerResult[] = [];

    for (const trigger of this.triggers.values()) {
      if (trigger.status !== TriggerStatus.PENDING) continue;
      if (trigger.type !== TriggerType.DEPENDENCY) continue;

      if (this.checkDependency(trigger, completedTasks)) {
        const result = this.executeTrigger(trigger);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 执行触发
   */
  private executeTrigger(trigger: Trigger): TriggerResult {
    const startTime = Date.now();
    let success = false;
    let error: string | undefined;

    try {
      // 更新触发状态
      trigger.status = TriggerStatus.TRIGGERED;
      trigger.lastTriggeredAt = startTime;
      trigger.triggerCount++;

      // 调用回调
      if (this.onTriggerCallback) {
        this.onTriggerCallback({
          triggerId: trigger.id,
          success: true,
          triggeredAt: startTime,
          message: trigger.message,
          targetPlanId: trigger.targetPlanId,
          targetTaskId: trigger.targetTaskId,
        });
      }

      success = true;
      trigger.status = TriggerStatus.COMPLETED;
      this.stats.successCount++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      trigger.retryCount++;

      if (trigger.retryCount >= trigger.maxRetries) {
        trigger.status = TriggerStatus.FAILED;
        this.stats.failedCount++;
      } else {
        // 重试
        trigger.status = TriggerStatus.PENDING;
        this.stats.retryCount++;
      }
    }

    this.stats.triggeredCount++;
    const latency = Date.now() - startTime;
    this.stats.latencies.push(latency);
    if (this.stats.latencies.length > 100) {
      this.stats.latencies.shift();
    }

    return {
      triggerId: trigger.id,
      success,
      triggeredAt: startTime,
      message: trigger.message,
      targetPlanId: trigger.targetPlanId,
      targetTaskId: trigger.targetTaskId,
      error,
    };
  }

  // ============================================================================
  // 触发器管理
  // ============================================================================

  /**
   * 获取触发器
   */
  getTrigger(triggerId: string): Trigger | undefined {
    return this.triggers.get(triggerId);
  }

  /**
   * 获取所有待触发器
   */
  getPendingTriggers(): Trigger[] {
    return Array.from(this.triggers.values()).filter(
      t => t.status === TriggerStatus.PENDING
    );
  }

  /**
   * 取消触发器
   */
  cancelTrigger(triggerId: string): boolean {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    trigger.status = TriggerStatus.CANCELLED;
    return true;
  }

  /**
   * 删除触发器
   */
  deleteTrigger(triggerId: string): boolean {
    return this.triggers.delete(triggerId);
  }

  /**
   * 清理已完成/已取消的触发器
   */
  cleanup(): number {
    let cleaned = 0;

    for (const [id, trigger] of this.triggers) {
      if (
        trigger.status === TriggerStatus.COMPLETED ||
        trigger.status === TriggerStatus.CANCELLED ||
        trigger.status === TriggerStatus.FAILED
      ) {
        this.triggers.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  // ============================================================================
  // 统计
  // ============================================================================

  /**
   * 获取统计信息
   */
  getStats(): TriggerEngineStats {
    const pendingTriggers = this.getPendingTriggers().length;
    const avgTriggerLatency =
      this.stats.latencies.length > 0
        ? this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length
        : 0;

    return {
      totalTriggers: this.stats.totalTriggers,
      pendingTriggers,
      triggeredCount: this.stats.triggeredCount,
      successCount: this.stats.successCount,
      failedCount: this.stats.failedCount,
      retryCount: this.stats.retryCount,
      avgTriggerLatency,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalTriggers: 0,
      triggeredCount: 0,
      successCount: 0,
      failedCount: 0,
      retryCount: 0,
      latencies: [],
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TriggerEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): TriggerEngineConfig {
    return { ...this.config };
  }
}

export default TriggerEngine;
