/**
 * MemLite - 睡眠巩固模块
 *
 * 基于睡眠启发的记忆巩固理论
 * - 后台压缩任务
 * - 记忆整合与去重
 * - 相似记忆合并
 */

import type { MemoryExchange } from '../types/memory.js';
import { ForgetModel, type MemoryStrength } from './ForgetModel.js';
import { ImportanceScoring } from './ImportanceScoring.js';

/**
 * 睡眠巩固配置
 */
export interface SleepGateConfig {
  /** 空闲触发阈值（毫秒）- 系统空闲超过此时间触发巩固 */
  idleThreshold: number;
  /** 相似度阈值 - 高于此值认为记忆重复 */
  similarityThreshold: number;
  /** 批量处理大小 */
  batchSize: number;
  /** 巩固间隔（毫秒）- 定期巩固间隔 */
  consolidationInterval: number;
  /** 启用自动巩固 */
  enableAutoConsolidation: boolean;
  /** 最小巩固间隔（毫秒）- 防止频繁巩固 */
  minConsolidationInterval: number;
  /** 保留的最小记忆数量 */
  minMemoryRetention: number;
}

/**
 * 默认配置
 */
const DEFAULT_SLEEPGATE_CONFIG: SleepGateConfig = {
  idleThreshold: 5 * 60 * 1000, // 5分钟
  similarityThreshold: 0.95, // 95% 相似度
  batchSize: 100,
  consolidationInterval: 30 * 60 * 1000, // 30分钟
  enableAutoConsolidation: true,
  minConsolidationInterval: 60 * 1000, // 1分钟
  minMemoryRetention: 10,
};

/**
 * 巩固结果
 */
export interface ConsolidationResult {
  /** 处理的记忆数量 */
  processed: number;
  /** 合并的记忆组 */
  mergedGroups: MergedGroup[];
  /** 清理的记忆ID */
  cleanedIds: string[];
  /** 巩固耗时（毫秒） */
  duration: number;
  /** 巩固时间 */
  timestamp: number;
}

/**
 * 合并的记忆组
 */
export interface MergedGroup {
  /** 保留的记忆ID */
  keptId: string;
  /** 被合并的记忆ID列表 */
  mergedIds: string[];
  /** 相似度分数 */
  similarity: number;
  /** 合并原因 */
  reason: string;
}

/**
 * 相似度计算结果
 */
interface SimilarityResult {
  id1: string;
  id2: string;
  similarity: number;
  type: 'semantic' | 'text' | 'entity';
}

/**
 * 巩固统计
 */
export interface ConsolidationStats {
  /** 总巩固次数 */
  totalConsolidations: number;
  /** 总处理记忆数 */
  totalProcessed: number;
  /** 总合并记忆数 */
  totalMerged: number;
  /** 总清理记忆数 */
  totalCleaned: number;
  /** 平均巩固耗时 */
  avgDuration: number;
  /** 最近巩固时间 */
  lastConsolidation: number | null;
  /** 空闲时间统计 */
  idleTime: {
    total: number;
    count: number;
    avg: number;
  };
}

/**
 * 睡眠巩固引擎
 *
 * 模拟睡眠期间的记忆巩固过程：
 * 1. 空闲检测 - 系统空闲时触发
 * 2. 相似度检测 - 识别重复或高度相似的记忆
 * 3. 合并策略 - 保留高重要性版本
 * 4. 清理策略 - 移除低强度记忆
 */
export class SleepGate {
  private config: SleepGateConfig;
  private _forgetModel: ForgetModel;
  private _importanceScoring: ImportanceScoring;

  // 状态追踪
  private lastActivity: number;
  private lastConsolidation: number;
  private consolidationTimer: NodeJS.Timeout | null = null;
  private isConsolidating: boolean;

  // 统计
  private stats: {
    totalConsolidations: number;
    totalProcessed: number;
    totalMerged: number;
    totalCleaned: number;
    durations: number[];
    idleTimes: number[];
  };

  constructor(
    config: Partial<SleepGateConfig> = {},
    forgetModel?: ForgetModel,
    importanceScoring?: ImportanceScoring
  ) {
    this.config = { ...DEFAULT_SLEEPGATE_CONFIG, ...config };
    this._forgetModel = forgetModel || new ForgetModel();
    this._importanceScoring = importanceScoring || new ImportanceScoring();

    this.lastActivity = Date.now();
    this.lastConsolidation = 0;
    this.isConsolidating = false;

    this.stats = {
      totalConsolidations: 0,
      totalProcessed: 0,
      totalMerged: 0,
      totalCleaned: 0,
      durations: [],
      idleTimes: [],
    };
  }

  /**
   * 记录活动（重置空闲计时器）
   */
  recordActivity(): void {
    this.lastActivity = Date.now();
  }

  /**
   * 检查是否空闲
   */
  isIdle(): boolean {
    const idleTime = Date.now() - this.lastActivity;
    return idleTime >= this.config.idleThreshold;
  }

  /**
   * 获取空闲时间（毫秒）
   */
  getIdleTime(): number {
    return Date.now() - this.lastActivity;
  }

  /**
   * 启动自动巩固
   */
  startAutoConsolidation(
    getExchanges: () => MemoryExchange[],
    onSave: (exchanges: MemoryExchange[]) => void,
    onDelete: (ids: string[]) => void
  ): void {
    if (!this.config.enableAutoConsolidation) return;

    // 定期检查
    this.consolidationTimer = setInterval(() => {
      if (this.isIdle() && !this.isConsolidating) {
        const exchanges = getExchanges();
        this.consolidate(exchanges, onSave, onDelete);
      }
    }, this.config.minConsolidationInterval);
  }

  /**
   * 停止自动巩固
   */
  stopAutoConsolidation(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
  }

  /**
   * 执行记忆巩固
   *
   * @param exchanges 当前所有记忆
   * @param onSave 保存回调
   * @param onDelete 删除回调
   */
  async consolidate(
    exchanges: MemoryExchange[],
    onSave: (exchanges: MemoryExchange[]) => void,
    onDelete: (ids: string[]) => void
  ): Promise<ConsolidationResult> {
    // 防止重复巩固
    if (this.isConsolidating) {
      return {
        processed: 0,
        mergedGroups: [],
        cleanedIds: [],
        duration: 0,
        timestamp: Date.now(),
      };
    }

    // 检查最小间隔
    const now = Date.now();
    if (now - this.lastConsolidation < this.config.minConsolidationInterval) {
      return {
        processed: 0,
        mergedGroups: [],
        cleanedIds: [],
        duration: 0,
        timestamp: now,
      };
    }

    this.isConsolidating = true;
    const startTime = Date.now();

    try {
      // 1. 计算所有记忆的强度
      const strengths = new Map<string, MemoryStrength>();
      for (const exchange of exchanges) {
        strengths.set(exchange.id, this._forgetModel.calculateStrength(exchange));
      }

      // 2. 识别需要清理的记忆
      const toCleanup: string[] = [];
      const toKeep: MemoryExchange[] = [];

      for (const exchange of exchanges) {
        const strength = strengths.get(exchange.id)!;
        // 使用重要性评分辅助决策
        const importanceResult = this._importanceScoring.calculate(exchange);

        // 结合强度和重要性来决定是否清理
        if (strength.shouldCleanup && importanceResult.score < 0.3) {
          toCleanup.push(exchange.id);
        } else {
          toKeep.push(exchange);
        }
      }

      // 确保保留最小数量
      if (toKeep.length < this.config.minMemoryRetention) {
        // 按强度排序，保留最强的
        const sorted = toCleanup
          .map(id => ({ id, strength: strengths.get(id)! }))
          .sort((a, b) => b.strength.strength - a.strength.strength);

        const needToRecover = this.config.minMemoryRetention - toKeep.length;
        const recovered = sorted.slice(0, needToRecover).map(r => r.id);

        toKeep.push(...exchanges.filter(e => recovered.includes(e.id)));
        toCleanup.splice(0, needToRecover);
      }

      // 3. 检测相似记忆并合并
      const mergedGroups = this.detectAndMerge(toKeep, strengths);

      // 4. 执行删除
      const mergedIds = mergedGroups.flatMap(g => g.mergedIds);
      const allDeleted = [...toCleanup, ...mergedIds];

      if (allDeleted.length > 0) {
        onDelete(allDeleted);
      }

      // 5. 更新保留的记忆（更新衰减率）
      const updatedExchanges = toKeep
        .filter(e => !mergedIds.includes(e.id))
        .map(exchange => {
          const result = this._forgetModel.applyDecay(exchange);
          return {
            ...exchange,
            decay_rate: result.newDecayRate,
          };
        });

      // 添加合并后保留的记忆
      const keptIds = new Set(mergedGroups.map(g => g.keptId));
      for (const exchange of toKeep) {
        if (keptIds.has(exchange.id)) {
          const result = this._forgetModel.applyDecay(exchange);
          updatedExchanges.push({
            ...exchange,
            decay_rate: result.newDecayRate,
          });
        }
      }

      if (updatedExchanges.length > 0) {
        onSave(updatedExchanges);
      }

      // 6. 更新统计
      const duration = Date.now() - startTime;
      this.updateStats(exchanges.length, mergedGroups.length, allDeleted.length, duration);

      this.lastConsolidation = Date.now();

      return {
        processed: exchanges.length,
        mergedGroups,
        cleanedIds: allDeleted,
        duration,
        timestamp: this.lastConsolidation,
      };
    } finally {
      this.isConsolidating = false;
    }
  }

  /**
   * 检测并合并相似记忆
   */
  private detectAndMerge(
    exchanges: MemoryExchange[],
    strengths: Map<string, MemoryStrength>
  ): MergedGroup[] {
    const mergedGroups: MergedGroup[] = [];
    const processed = new Set<string>();

    // 批量处理
    for (let i = 0; i < exchanges.length; i += this.config.batchSize) {
      const batch = exchanges.slice(i, i + this.config.batchSize);

      for (let j = 0; j < batch.length; j++) {
        if (processed.has(batch[j].id)) continue;

        const similarities = this.findSimilarMemories(batch[j], batch, j + 1);

        if (similarities.length > 0) {
          // 找出最相似的组
          const group = [batch[j]];
          const groupSimilarities: SimilarityResult[] = [];

          for (const sim of similarities) {
            if (!processed.has(sim.id2) && sim.similarity >= this.config.similarityThreshold) {
              const other = exchanges.find(e => e.id === sim.id2);
              if (other) {
                group.push(other);
                groupSimilarities.push(sim);
                processed.add(sim.id2);
              }
            }
          }

          if (group.length > 1) {
            // 选择保留哪个：优先高重要性，其次高强度
            const chosen = this.selectMemoryToKeep(group, strengths);
            const mergedIds = group.filter(e => e.id !== chosen.id).map(e => e.id);

            processed.add(chosen.id);

            mergedGroups.push({
              keptId: chosen.id,
              mergedIds,
              similarity: Math.max(...groupSimilarities.map(s => s.similarity)),
              reason: 'semantic_similarity',
            });
          }
        }

        processed.add(batch[j].id);
      }
    }

    return mergedGroups;
  }

  /**
   * 查找相似记忆
   */
  private findSimilarMemories(
    source: MemoryExchange,
    candidates: MemoryExchange[],
    startIndex: number
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];

    for (let i = startIndex; i < candidates.length; i++) {
      const target = candidates[i];

      // 1. 文本相似度（Jaccard）
      const textSim = this.calculateTextSimilarity(
        source.exchange_core,
        target.exchange_core
      );

      // 2. 实体重叠度
      const entitySim = this.calculateEntityOverlap(
        source.entities_extracted,
        target.entities_extracted
      );

      // 3. 标签重叠度
      const tagSim = this.calculateTagOverlap(
        source.thematic_tags,
        target.thematic_tags
      );

      // 综合相似度
      const similarity = textSim * 0.4 + entitySim * 0.3 + tagSim * 0.3;

      if (similarity >= this.config.similarityThreshold * 0.8) {
        results.push({
          id1: source.id,
          id2: target.id,
          similarity,
          type: similarity >= this.config.similarityThreshold ? 'semantic' : 'text',
        });
      }
    }

    return results;
  }

  /**
   * 计算文本相似度（Jaccard）
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 计算实体重叠度
   */
  private calculateEntityOverlap(
    entities1: string[],
    entities2: string[]
  ): number {
    if (entities1.length === 0 && entities2.length === 0) return 1;
    if (entities1.length === 0 || entities2.length === 0) return 0;

    const set1 = new Set(entities1.map(e => e.toLowerCase()));
    const set2 = new Set(entities2.map(e => e.toLowerCase()));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 计算标签重叠度
   */
  private calculateTagOverlap(tags1: string[], tags2: string[]): number {
    if (tags1.length === 0 && tags2.length === 0) return 1;
    if (tags1.length === 0 || tags2.length === 0) return 0;

    const set1 = new Set(tags1.map(t => t.toLowerCase()));
    const set2 = new Set(tags2.map(t => t.toLowerCase()));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 选择保留的记忆
   *
   * 策略：优先高重要性，其次高强度，最后最新
   */
  private selectMemoryToKeep(
    group: MemoryExchange[],
    strengths: Map<string, MemoryStrength>
  ): MemoryExchange {
    // 按重要性排序
    const sorted = group.sort((a, b) => {
      // 1. 重要性
      const importanceDiff = b.importance_score - a.importance_score;
      if (Math.abs(importanceDiff) > 0.1) return importanceDiff;

      // 2. 强度
      const strengthA = strengths.get(a.id)?.strength || 0;
      const strengthB = strengths.get(b.id)?.strength || 0;
      const strengthDiff = strengthB - strengthA;
      if (Math.abs(strengthDiff) > 0.1) return strengthDiff;

      // 3. 最新
      return b.timestamp - a.timestamp;
    });

    return sorted[0];
  }

  /**
   * 更新统计
   */
  private updateStats(
    processed: number,
    merged: number,
    cleaned: number,
    duration: number
  ): void {
    this.stats.totalConsolidations++;
    this.stats.totalProcessed += processed;
    this.stats.totalMerged += merged;
    this.stats.totalCleaned += cleaned;
    this.stats.durations.push(duration);

    if (this.stats.durations.length > 100) {
      this.stats.durations.shift();
    }

    // 记录空闲时间
    const idleTime = this.getIdleTime();
    this.stats.idleTimes.push(idleTime);
    if (this.stats.idleTimes.length > 100) {
      this.stats.idleTimes.shift();
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): ConsolidationStats {
    const avgDuration =
      this.stats.durations.length > 0
        ? this.stats.durations.reduce((a, b) => a + b, 0) / this.stats.durations.length
        : 0;

    const avgIdleTime =
      this.stats.idleTimes.length > 0
        ? this.stats.idleTimes.reduce((a, b) => a + b, 0) / this.stats.idleTimes.length
        : 0;

    return {
      totalConsolidations: this.stats.totalConsolidations,
      totalProcessed: this.stats.totalProcessed,
      totalMerged: this.stats.totalMerged,
      totalCleaned: this.stats.totalCleaned,
      avgDuration,
      lastConsolidation:
        this.lastConsolidation > 0 ? this.lastConsolidation : null,
      idleTime: {
        total: this.stats.idleTimes.reduce((a, b) => a + b, 0),
        count: this.stats.idleTimes.length,
        avg: avgIdleTime,
      },
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalConsolidations: 0,
      totalProcessed: 0,
      totalMerged: 0,
      totalCleaned: 0,
      durations: [],
      idleTimes: [],
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SleepGateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): SleepGateConfig {
    return { ...this.config };
  }
}

// 导出单例工厂
let defaultSleepGate: SleepGate | null = null;

/**
 * 获取默认睡眠巩固引擎
 */
export function getSleepGate(config?: Partial<SleepGateConfig>): SleepGate {
  if (!defaultSleepGate) {
    defaultSleepGate = new SleepGate(config);
  }
  return defaultSleepGate;
}

export default SleepGate;
