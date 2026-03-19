/**
 * MemLite - 上下文快照模块
 *
 * 实现注意力恢复的断点续传：
 * - 自动快照（中断检测）
 * - 增量快照（仅保存变更）
 * - 快照压缩与恢复
 * - LRU 淘汰策略
 */

import type { PlanMemory, PlanTask } from './PlanMemory.js';
import { PlanStatus } from './PlanMemory.js';

/**
 * 快照类型
 */
export enum SnapshotType {
  /** 完整快照 */
  FULL = 'full',
  /** 增量快照 */
  INCREMENTAL = 'incremental',
  /** 自动快照（中断触发） */
  AUTO = 'auto',
  /** 手动快照 */
  MANUAL = 'manual',
}

/**
 * 快照状态
 */
export enum SnapshotStatus {
  /** 已创建 */
  CREATED = 'created',
  /** 已恢复 */
  RESTORED = 'restored',
  /** 已过期 */
  EXPIRED = 'expired',
  /** 已删除 */
  DELETED = 'deleted',
}

/**
 * 快照数据
 */
export interface Snapshot {
  /** 快照ID */
  id: string;
  /** 快照类型 */
  type: SnapshotType;
  /** 快照状态 */
  status: SnapshotStatus;
  /** 关联的计划ID */
  planId: string;
  /** 计划标题 */
  planTitle: string;
  /** 快照时间 */
  timestamp: number;
  /** 快照数据（压缩后） */
  data: string;
  /** 原始大小（字节） */
  originalSize: number;
  /** 压缩后大小（字节） */
  compressedSize: number;
  /** 压缩率 */
  compressionRatio: number;
  /** 基础快照ID（增量快照） */
  baseSnapshotId?: string;
  /** 变更集（增量快照） */
  changes?: SnapshotChange[];
  /** 元数据 */
  metadata?: {
    interruptionDuration?: number;
    autoCreated?: boolean;
    tags?: string[];
    note?: string;
  };
}

/**
 * 快照变更
 */
export interface SnapshotChange {
  /** 变更类型 */
  type: 'add' | 'update' | 'delete';
  /** 变更路径 */
  path: string;
  /** 变更前值 */
  oldValue?: unknown;
  /** 变更后值 */
  newValue?: unknown;
  /** 变更时间 */
  timestamp: number;
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  /** 是否成功 */
  success: boolean;
  /** 恢复的计划 */
  plan?: PlanMemory;
  /** 恢复耗时（毫秒） */
  duration: number;
  /** 恢复的快照ID */
  snapshotId: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 上下文快照配置
 */
export interface ContextSnapshotConfig {
  /** 中断检测阈值（毫秒）- 超过此时间自动创建快照 */
  interruptionThreshold: number;
  /** 最大快照数量 */
  maxSnapshots: number;
  /** 启用压缩 */
  enableCompression: boolean;
  /** 启用自动快照 */
  enableAutoSnapshot: boolean;
  /** 快照过期时间（毫秒）- 0 表示永不过期 */
  snapshotExpiration: number;
  /** 增量快照最小间隔（毫秒） */
  incrementalInterval: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONTEXT_SNAPSHOT_CONFIG: ContextSnapshotConfig = {
  interruptionThreshold: 10 * 60 * 1000, // 10分钟
  maxSnapshots: 10,
  enableCompression: true,
  enableAutoSnapshot: true,
  snapshotExpiration: 0, // 永不过期
  incrementalInterval: 60000, // 1分钟
};

/**
 * 快照统计
 */
export interface SnapshotStats {
  /** 总快照数 */
  totalSnapshots: number;
  /** 完整快照数 */
  fullSnapshots: number;
  /** 增量快照数 */
  incrementalSnapshots: number;
  /** 平均压缩率 */
  avgCompressionRatio: number;
  /** 平均恢复时间 */
  avgRestoreTime: number;
  /** 总节省空间（字节） */
  totalSpaceSaved: number;
}

/**
 * 上下文快照管理器
 *
 * 核心功能：
 * 1. 自动快照（中断检测）
 * 2. 增量快照（变更追踪）
 * 3. 快照压缩（减少存储）
 * 4. 断点续传（完整恢复）
 */
export class ContextSnapshot {
  private config: ContextSnapshotConfig;

  // 快照存储
  private snapshots: Map<string, Snapshot>;
  private snapshotOrder: string[]; // LRU 顺序

  // 状态追踪
  private lastActivity: number;
  private lastSnapshotTime: number;
  private lastPlanState: Map<string, PlanMemory>;

  // 统计
  private stats: {
    totalSnapshots: number;
    fullSnapshots: number;
    incrementalSnapshots: number;
    compressionRatios: number[];
    restoreTimes: number[];
    spaceSaved: number;
  };

  constructor(config: Partial<ContextSnapshotConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_SNAPSHOT_CONFIG, ...config };

    this.snapshots = new Map();
    this.snapshotOrder = [];
    this.lastActivity = Date.now();
    this.lastSnapshotTime = 0;
    this.lastPlanState = new Map();

    this.stats = {
      totalSnapshots: 0,
      fullSnapshots: 0,
      incrementalSnapshots: 0,
      compressionRatios: [],
      restoreTimes: [],
      spaceSaved: 0,
    };
  }

  // ============================================================================
  // 活动追踪与自动快照
  // ============================================================================

  /**
   * 记录活动（重置中断计时器）
   */
  recordActivity(): void {
    this.lastActivity = Date.now();
  }

  /**
   * 检查是否需要自动快照
   *
   * @returns 如果需要自动快照，返回快照；否则返回 null
   */
  checkAutoSnapshot(activePlan: PlanMemory | null): Snapshot | null {
    if (!this.config.enableAutoSnapshot || !activePlan) {
      return null;
    }

    const now = Date.now();
    const idleTime = now - this.lastActivity;

    // 检查中断阈值
    if (idleTime >= this.config.interruptionThreshold) {
      return this.createSnapshot(activePlan, SnapshotType.AUTO, {
        interruptionDuration: idleTime,
        autoCreated: true,
      });
    }

    return null;
  }

  /**
   * 获取空闲时间
   */
  getIdleTime(): number {
    return Date.now() - this.lastActivity;
  }

  // ============================================================================
  // 快照创建
  // ============================================================================

  /**
   * 创建快照
   */
  createSnapshot(
    plan: PlanMemory,
    type: SnapshotType = SnapshotType.MANUAL,
    metadata?: Snapshot['metadata']
  ): Snapshot {
    const now = Date.now();

    // 检查是否可以创建增量快照
    const canIncremental =
      type !== SnapshotType.AUTO &&
      this.lastSnapshotTime > 0 &&
      now - this.lastSnapshotTime >= this.config.incrementalInterval &&
      this.lastPlanState.has(plan.id);

    if (canIncremental) {
      return this.createIncrementalSnapshot(plan, metadata);
    }

    return this.createFullSnapshot(plan, type, metadata);
  }

  /**
   * 创建完整快照
   */
  private createFullSnapshot(
    plan: PlanMemory,
    type: SnapshotType,
    metadata?: Snapshot['metadata']
  ): Snapshot {
    const now = Date.now();

    // 序列化
    const originalData = JSON.stringify(plan);
    const originalSize = Buffer.byteLength(originalData, 'utf8');

    // 压缩（简化版：移除空白）
    const compressedData = this.compress(originalData);
    const compressedSize = Buffer.byteLength(compressedData, 'utf8');

    // 计算压缩率
    const compressionRatio = originalSize > 0 ? 1 - compressedSize / originalSize : 0;

    const snapshot: Snapshot = {
      id: `snap_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      status: SnapshotStatus.CREATED,
      planId: plan.id,
      planTitle: plan.title,
      timestamp: now,
      data: compressedData,
      originalSize,
      compressedSize,
      compressionRatio,
      metadata,
    };

    // 保存
    this.saveSnapshot(snapshot);

    // 更新状态
    this.lastSnapshotTime = now;
    this.lastPlanState.set(plan.id, JSON.parse(JSON.stringify(plan)));

    // 更新统计
    this.stats.totalSnapshots++;
    this.stats.fullSnapshots++;
    this.stats.compressionRatios.push(compressionRatio);
    this.stats.spaceSaved += originalSize - compressedSize;

    if (this.stats.compressionRatios.length > 100) {
      this.stats.compressionRatios.shift();
    }

    return snapshot;
  }

  /**
   * 创建增量快照
   */
  private createIncrementalSnapshot(
    plan: PlanMemory,
    metadata?: Snapshot['metadata']
  ): Snapshot {
    const now = Date.now();
    const lastState = this.lastPlanState.get(plan.id);

    if (!lastState) {
      return this.createFullSnapshot(plan, SnapshotType.INCREMENTAL, metadata);
    }

    // 计算变更
    const changes = this.computeChanges(lastState, plan);

    if (changes.length === 0) {
      // 无变更，返回空快照
      const snapshot: Snapshot = {
        id: `snap_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: SnapshotType.INCREMENTAL,
        status: SnapshotStatus.CREATED,
        planId: plan.id,
        planTitle: plan.title,
        timestamp: now,
        data: '',
        originalSize: 0,
        compressedSize: 0,
        compressionRatio: 0,
        changes: [],
        metadata,
      };
      return snapshot;
    }

    // 序列化变更
    const changesData = JSON.stringify(changes);
    const originalSize = Buffer.byteLength(changesData, 'utf8');
    const compressedData = this.compress(changesData);
    const compressedSize = Buffer.byteLength(compressedData, 'utf8');
    const compressionRatio = originalSize > 0 ? 1 - compressedSize / originalSize : 0;

    // 找到基础快照
    const baseSnapshot = this.findLatestFullSnapshot(plan.id);

    const snapshot: Snapshot = {
      id: `snap_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type: SnapshotType.INCREMENTAL,
      status: SnapshotStatus.CREATED,
      planId: plan.id,
      planTitle: plan.title,
      timestamp: now,
      data: compressedData,
      originalSize,
      compressedSize,
      compressionRatio,
      baseSnapshotId: baseSnapshot?.id,
      changes,
      metadata,
    };

    // 保存
    this.saveSnapshot(snapshot);

    // 更新状态
    this.lastSnapshotTime = now;
    this.lastPlanState.set(plan.id, JSON.parse(JSON.stringify(plan)));

    // 更新统计
    this.stats.totalSnapshots++;
    this.stats.incrementalSnapshots++;
    this.stats.compressionRatios.push(compressionRatio);
    this.stats.spaceSaved += originalSize - compressedSize;

    if (this.stats.compressionRatios.length > 100) {
      this.stats.compressionRatios.shift();
    }

    return snapshot;
  }

  /**
   * 计算变更集
   */
  private computeChanges(oldState: PlanMemory, newState: PlanMemory): SnapshotChange[] {
    const changes: SnapshotChange[] = [];
    const now = Date.now();

    // 简化：比较任务变更
    const oldTasks = new Map(oldState.tasks.map(t => [t.id, t]));
    const newTasks = new Map(newState.tasks.map(t => [t.id, t]));

    // 新增的任务
    for (const [id, task] of newTasks) {
      if (!oldTasks.has(id)) {
        changes.push({
          type: 'add',
          path: `tasks.${id}`,
          newValue: task,
          timestamp: now,
        });
      }
    }

    // 删除的任务
    for (const [id, task] of oldTasks) {
      if (!newTasks.has(id)) {
        changes.push({
          type: 'delete',
          path: `tasks.${id}`,
          oldValue: task,
          timestamp: now,
        });
      }
    }

    // 更新的任务
    for (const [id, newTask] of newTasks) {
      const oldTask = oldTasks.get(id);
      if (oldTask && JSON.stringify(oldTask) !== JSON.stringify(newTask)) {
        changes.push({
          type: 'update',
          path: `tasks.${id}`,
          oldValue: oldTask,
          newValue: newTask,
          timestamp: now,
        });
      }
    }

    // 状态变更
    if (oldState.status !== newState.status) {
      changes.push({
        type: 'update',
        path: 'status',
        oldValue: oldState.status,
        newValue: newState.status,
        timestamp: now,
      });
    }

    return changes;
  }

  /**
   * 查找最新的完整快照
   */
  private findLatestFullSnapshot(planId: string): Snapshot | undefined {
    for (let i = this.snapshotOrder.length - 1; i >= 0; i--) {
      const snapshot = this.snapshots.get(this.snapshotOrder[i]);
      if (
        snapshot &&
        snapshot.planId === planId &&
        snapshot.type === SnapshotType.FULL
      ) {
        return snapshot;
      }
    }
    return undefined;
  }

  // ============================================================================
  // 快照恢复
  // ============================================================================

  /**
   * 恢复快照
   */
  restore(snapshotId: string): RestoreResult {
    const startTime = Date.now();

    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return {
        success: false,
        duration: Date.now() - startTime,
        snapshotId,
        error: 'Snapshot not found',
      };
    }

    try {
      let plan: PlanMemory;

      if (snapshot.type === SnapshotType.INCREMENTAL && snapshot.baseSnapshotId) {
        // 增量恢复
        plan = this.restoreIncremental(snapshot);
      } else {
        // 完整恢复
        plan = this.restoreFull(snapshot);
      }

      // 更新状态
      snapshot.status = SnapshotStatus.RESTORED;

      // 更新统计
      const duration = Date.now() - startTime;
      this.stats.restoreTimes.push(duration);
      if (this.stats.restoreTimes.length > 100) {
        this.stats.restoreTimes.shift();
      }

      return {
        success: true,
        plan,
        duration,
        snapshotId,
      };
    } catch (e) {
      return {
        success: false,
        duration: Date.now() - startTime,
        snapshotId,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * 完整恢复
   */
  private restoreFull(snapshot: Snapshot): PlanMemory {
    const data = this.decompress(snapshot.data);
    return JSON.parse(data);
  }

  /**
   * 增量恢复
   */
  private restoreIncremental(snapshot: Snapshot): PlanMemory {
    // 找到基础快照
    const baseSnapshot = snapshot.baseSnapshotId
      ? this.snapshots.get(snapshot.baseSnapshotId)
      : null;

    if (!baseSnapshot) {
      throw new Error('Base snapshot not found');
    }

    // 恢复基础快照
    const basePlan = this.restoreFull(baseSnapshot);

    // 应用变更
    if (!snapshot.changes || snapshot.changes.length === 0) {
      return basePlan;
    }

    for (const change of snapshot.changes) {
      this.applyChange(basePlan, change);
    }

    return basePlan;
  }

  /**
   * 应用变更
   */
  private applyChange(plan: PlanMemory, change: SnapshotChange): void {
    const pathParts = change.path.split('.');

    if (pathParts[0] === 'tasks' && pathParts[1]) {
      const taskId = pathParts[1];

      switch (change.type) {
        case 'add':
        case 'update':
          if (change.newValue) {
            const index = plan.tasks.findIndex(t => t.id === taskId);
            if (index >= 0) {
              plan.tasks[index] = change.newValue as PlanTask;
            } else {
              plan.tasks.push(change.newValue as PlanTask);
            }
          }
          break;

        case 'delete':
          plan.tasks = plan.tasks.filter(t => t.id !== taskId);
          break;
      }
    } else if (change.path === 'status') {
      plan.status = change.newValue as PlanStatus;
    }
  }

  // ============================================================================
  // 压缩/解压（简化版）
  // ============================================================================

  /**
   * 压缩数据
   *
   * 简化实现：移除冗余空白，缩短键名
   */
  private compress(data: string): string {
    if (!this.config.enableCompression) {
      return data;
    }

    // 移除多余空白
    let compressed = data.replace(/\s+/g, ' ').trim();

    // 缩短常见键名（简单映射）
    const keyMap: Record<string, string> = {
      '"description"': '"d"',
      '"status"': '"s"',
      '"priority"': '"p"',
      '"created_at"': '"ca"',
      '"updated_at"': '"ua"',
      '"completed_at"': '"ca2"',
      '"dependencies"': '"deps"',
      '"importance_score"': '"imp"',
      '"access_count"': '"ac"',
      '"decay_rate"': '"dr"',
      '"last_accessed"': '"la"',
    };

    for (const [long, short] of Object.entries(keyMap)) {
      compressed = compressed.replace(new RegExp(long, 'g'), short);
    }

    return compressed;
  }

  /**
   * 解压数据
   */
  private decompress(data: string): string {
    if (!this.config.enableCompression) {
      return data;
    }

    // 还原键名
    const keyMap: Record<string, string> = {
      '"d"': '"description"',
      '"s"': '"status"',
      '"p"': '"priority"',
      '"ca"': '"created_at"',
      '"ua"': '"updated_at"',
      '"ca2"': '"completed_at"',
      '"deps"': '"dependencies"',
      '"imp"': '"importance_score"',
      '"ac"': '"access_count"',
      '"dr"': '"decay_rate"',
      '"la"': '"last_accessed"',
    };

    let decompressed = data;
    for (const [short, long] of Object.entries(keyMap)) {
      decompressed = decompressed.replace(new RegExp(short, 'g'), long);
    }

    return decompressed;
  }

  // ============================================================================
  // 快照管理
  // ============================================================================

  /**
   * 保存快照（带 LRU 淘汰）
   */
  private saveSnapshot(snapshot: Snapshot): void {
    // 检查容量
    while (this.snapshots.size >= this.config.maxSnapshots) {
      // LRU 淘汰
      const oldest = this.snapshotOrder.shift();
      if (oldest) {
        this.snapshots.delete(oldest);
      }
    }

    this.snapshots.set(snapshot.id, snapshot);
    this.snapshotOrder.push(snapshot.id);
  }

  /**
   * 获取快照
   */
  getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * 获取计划的所有快照
   */
  getPlanSnapshots(planId: string): Snapshot[] {
    return Array.from(this.snapshots.values())
      .filter(s => s.planId === planId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取最新快照
   *
   * 当多个快照时间戳相同时，返回最后创建的快照
   */
  getLatestSnapshot(planId?: string): Snapshot | undefined {
    let latest: Snapshot | undefined;

    for (const snapshot of this.snapshots.values()) {
      if (planId && snapshot.planId !== planId) continue;

      // 使用 >= 确保相同时间戳时返回最后创建的快照
      if (!latest || snapshot.timestamp >= latest.timestamp) {
        latest = snapshot;
      }
    }

    return latest;
  }

  /**
   * 删除快照
   */
  deleteSnapshot(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;

    snapshot.status = SnapshotStatus.DELETED;
    this.snapshots.delete(snapshotId);

    const index = this.snapshotOrder.indexOf(snapshotId);
    if (index > -1) {
      this.snapshotOrder.splice(index, 1);
    }

    return true;
  }

  /**
   * 清理过期快照
   */
  cleanup(): number {
    if (this.config.snapshotExpiration === 0) return 0;

    const now = Date.now();
    let cleaned = 0;

    for (const [id, snapshot] of this.snapshots) {
      if (now - snapshot.timestamp > this.config.snapshotExpiration) {
        snapshot.status = SnapshotStatus.EXPIRED;
        this.snapshots.delete(id);

        const index = this.snapshotOrder.indexOf(id);
        if (index > -1) {
          this.snapshotOrder.splice(index, 1);
        }

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
  getStats(): SnapshotStats {
    const avgCompressionRatio =
      this.stats.compressionRatios.length > 0
        ? this.stats.compressionRatios.reduce((a, b) => a + b, 0) /
          this.stats.compressionRatios.length
        : 0;

    const avgRestoreTime =
      this.stats.restoreTimes.length > 0
        ? this.stats.restoreTimes.reduce((a, b) => a + b, 0) /
          this.stats.restoreTimes.length
        : 0;

    return {
      totalSnapshots: this.stats.totalSnapshots,
      fullSnapshots: this.stats.fullSnapshots,
      incrementalSnapshots: this.stats.incrementalSnapshots,
      avgCompressionRatio,
      avgRestoreTime,
      totalSpaceSaved: this.stats.spaceSaved,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalSnapshots: 0,
      fullSnapshots: 0,
      incrementalSnapshots: 0,
      compressionRatios: [],
      restoreTimes: [],
      spaceSaved: 0,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextSnapshotConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ContextSnapshotConfig {
    return { ...this.config };
  }
}

export default ContextSnapshot;
