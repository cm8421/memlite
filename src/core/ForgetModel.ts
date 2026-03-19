/**
 * MemLite - 遗忘机制模块
 *
 * 基于艾宾浩斯遗忘曲线实现记忆衰减
 * 参考 FadeMem 论文的自适应衰减策略
 */

import type { MemoryExchange } from '../types/memory.js';

/**
 * 遗忘曲线配置
 */
export interface ForgetConfig {
  /** 基础衰减率（每小时） */
  baseDecayRate: number;
  /** 清理阈值（低于此值的记忆将被标记删除） */
  cleanupThreshold: number;
  /** 高重要性衰减因子（高重要性记忆衰减更慢） */
  highImportanceFactor: number;
  /** 高访问衰减因子 */
  highAccessFactor: number;
  /** 高重要性阈值 */
  highImportanceThreshold: number;
  /** 高访问阈值 */
  highAccessThreshold: number;
  /** 批量处理大小 */
  batchSize: number;
}

/**
 * 默认遗忘配置
 */
const DEFAULT_FORGET_CONFIG: ForgetConfig = {
  baseDecayRate: 0.01, // 每小时衰减 1%
  cleanupThreshold: 0.1,
  highImportanceFactor: 0.5, // 高重要性衰减率降低 50%
  highAccessFactor: 0.7, // 高访问衰减率降低 30%
  highImportanceThreshold: 0.7,
  highAccessThreshold: 10,
  batchSize: 100,
};

/**
 * 记忆强度计算结果
 */
export interface MemoryStrength {
  /** 记忆ID */
  id: string;
  /** 当前强度 (0-1) */
  strength: number;
  /** 自适应衰减率 */
  effectiveDecayRate: number;
  /** 是否应该清理 */
  shouldCleanup: boolean;
  /** 计算时间 */
  computedAt: number;
}

/**
 * 遗忘统计
 */
export interface ForgetStats {
  /** 总计算次数 */
  totalCalculations: number;
  /** 清理记忆数量 */
  cleanedMemories: number;
  /** 平均强度 */
  avgStrength: number;
  /** 高强度记忆占比 */
  highStrengthRatio: number;
}

/**
 * 遗忘模型 - 艾宾浩斯遗忘曲线实现
 *
 * 核心公式：
 * 1. 初始强度：strength = importance_score * (1 + log(access_count + 1))
 * 2. 时间衰减：strength *= exp(-decay_rate * hours_since_access)
 * 3. 自适应衰减：根据重要性和访问频率调整
 */
export class ForgetModel {
  private config: ForgetConfig;
  private stats: {
    totalCalculations: number;
    cleanedMemories: number;
    strengthHistory: number[];
  };

  constructor(config: Partial<ForgetConfig> = {}) {
    this.config = { ...DEFAULT_FORGET_CONFIG, ...config };
    this.stats = {
      totalCalculations: 0,
      cleanedMemories: 0,
      strengthHistory: [],
    };
  }

  /**
   * 计算单条记忆的当前强度
   */
  calculateStrength(exchange: MemoryExchange): MemoryStrength {
    this.stats.totalCalculations++;

    const now = Date.now();
    const hoursSinceAccess =
      (now - exchange.last_accessed) / (1000 * 60 * 60);

    // 1. 计算自适应衰减率
    const effectiveDecayRate = this.calculateEffectiveDecayRate(exchange);

    // 2. 计算初始强度（基于重要性和访问次数）
    let strength =
      exchange.importance_score * (1 + Math.log10(exchange.access_count + 1));

    // 归一化到 [0, 1] 范围
    // importance_score: 0-1, log10(access+1): 0-3 (假设最大访问 1000 次)
    strength = strength / 4; // 归一化

    // 3. 应用时间衰减
    strength *= Math.exp(-effectiveDecayRate * hoursSinceAccess);

    // 确保在有效范围内
    strength = Math.max(0, Math.min(1, strength));

    // 4. 判断是否应该清理
    const shouldCleanup = strength < this.config.cleanupThreshold;

    // 记录统计
    this.stats.strengthHistory.push(strength);
    if (this.stats.strengthHistory.length > 1000) {
      this.stats.strengthHistory.shift();
    }

    return {
      id: exchange.id,
      strength,
      effectiveDecayRate,
      shouldCleanup,
      computedAt: now,
    };
  }

  /**
   * 批量计算记忆强度
   */
  calculateBatchStrength(exchanges: MemoryExchange[]): MemoryStrength[] {
    return exchanges.map(exchange => this.calculateStrength(exchange));
  }

  /**
   * 计算自适应衰减率
   *
   * 高重要性记忆：衰减率降低 50%
   * 高访问记忆：衰减率降低 30%
   */
  private calculateEffectiveDecayRate(exchange: MemoryExchange): number {
    let rate = this.config.baseDecayRate;

    // 高重要性记忆衰减更慢
    if (exchange.importance_score >= this.config.highImportanceThreshold) {
      rate *= this.config.highImportanceFactor;
    }

    // 高访问记忆衰减更慢
    if (exchange.access_count >= this.config.highAccessThreshold) {
      rate *= this.config.highAccessFactor;
    }

    // 使用记忆自身的衰减率作为额外因子
    rate *= exchange.decay_rate;

    return rate;
  }

  /**
   * 应用遗忘衰减到记忆
   *
   * @returns 更新后的强度和新衰减率
   */
  applyDecay(exchange: MemoryExchange): {
    strength: number;
    newDecayRate: number;
    shouldCleanup: boolean;
  } {
    const result = this.calculateStrength(exchange);

    // 更新衰减率（根据当前强度动态调整）
    let newDecayRate = exchange.decay_rate;

    if (result.strength < 0.3) {
      // 低强度记忆加速衰减
      newDecayRate = Math.min(1, exchange.decay_rate * 1.1);
    } else if (result.strength > 0.7) {
      // 高强度记忆减慢衰减
      newDecayRate = Math.max(0.01, exchange.decay_rate * 0.95);
    }

    return {
      strength: result.strength,
      newDecayRate,
      shouldCleanup: result.shouldCleanup,
    };
  }

  /**
   * 批量应用遗忘衰减
   *
   * @returns 需要清理的记忆ID列表
   */
  applyBatchDecay(exchanges: MemoryExchange[]): {
    toCleanup: string[];
    updated: Array<{ id: string; newDecayRate: number; newStrength: number }>;
  } {
    const toCleanup: string[] = [];
    const updated: Array<{
      id: string;
      newDecayRate: number;
      newStrength: number;
    }> = [];

    for (const exchange of exchanges) {
      const result = this.applyDecay(exchange);

      if (result.shouldCleanup) {
        toCleanup.push(exchange.id);
        this.stats.cleanedMemories++;
      } else {
        updated.push({
          id: exchange.id,
          newDecayRate: result.newDecayRate,
          newStrength: result.strength,
        });
      }
    }

    return { toCleanup, updated };
  }

  /**
   * 艾宾浩斯曲线参考值
   *
   * 根据艾宾浩斯研究，记忆保持率与时间的关系：
   * R = exp(-t/S)
   * 其中 R 是保持率，t 是时间，S 是记忆强度
   */
  getEbbinghausRetention(hours: number, strength: number): number {
    return Math.exp(-hours / (strength * 100 + 1));
  }

  /**
   * 预测未来强度
   *
   * @param exchange 记忆
   * @param hoursFuture 未来小时数
   */
  predictFutureStrength(
    exchange: MemoryExchange,
    hoursFuture: number
  ): number {
    const currentStrength = this.calculateStrength(exchange);
    const futureDecay = Math.exp(
      -currentStrength.effectiveDecayRate * hoursFuture
    );

    return currentStrength.strength * futureDecay;
  }

  /**
   * 计算复习时间建议
   *
   * 基于艾宾浩斯曲线，建议在记忆强度降至某阈值前复习
   *
   * @param exchange 记忆
   * @param targetStrength 目标保持强度（默认 0.5）
   * @returns 建议复习时间（小时后）
   */
  suggestReviewTime(exchange: MemoryExchange, targetStrength = 0.5): number {
    const current = this.calculateStrength(exchange);

    // 反推时间：target = current * exp(-rate * t)
    // t = -ln(target/current) / rate
    if (current.strength <= targetStrength) {
      return 0; // 已经低于目标，立即复习
    }

    const hoursUntilReview =
      -Math.log(targetStrength / current.strength) /
      current.effectiveDecayRate;

    return Math.max(0, hoursUntilReview);
  }

  /**
   * 获取统计信息
   */
  getStats(): ForgetStats {
    const avgStrength =
      this.stats.strengthHistory.length > 0
        ? this.stats.strengthHistory.reduce((a, b) => a + b, 0) /
          this.stats.strengthHistory.length
        : 0;

    const highStrengthCount = this.stats.strengthHistory.filter(
      s => s > 0.7
    ).length;

    return {
      totalCalculations: this.stats.totalCalculations,
      cleanedMemories: this.stats.cleanedMemories,
      avgStrength,
      highStrengthRatio:
        this.stats.strengthHistory.length > 0
          ? highStrengthCount / this.stats.strengthHistory.length
          : 0,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalCalculations: 0,
      cleanedMemories: 0,
      strengthHistory: [],
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ForgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ForgetConfig {
    return { ...this.config };
  }
}

// 导出单例工厂
let defaultForgetModel: ForgetModel | null = null;

/**
 * 获取默认遗忘模型
 */
export function getForgetModel(
  config?: Partial<ForgetConfig>
): ForgetModel {
  if (!defaultForgetModel) {
    defaultForgetModel = new ForgetModel(config);
  }
  return defaultForgetModel;
}

export default ForgetModel;
