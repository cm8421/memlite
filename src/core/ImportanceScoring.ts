/**
 * MemLite - 重要性评分模块
 *
 * 基于多因素计算记忆重要性
 * 支持实时更新和动态权重调整
 */

import type { MemoryExchange } from '../types/memory.js';

/**
 * 重要性评分配置
 */
export interface ImportanceConfig {
  /** 初始重要性权重 */
  initialWeight: number;
  /** 访问频率权重 */
  frequencyWeight: number;
  /** 检索命中权重 */
  hitWeight: number;
  /** 时间衰减权重（可选） */
  timeDecayWeight: number;
  /** 最大访问次数（用于归一化） */
  maxAccessCount: number;
  /** 命中时间窗口（毫秒） */
  hitTimeWindow: number;
  /** 启用时间衰减 */
  enableTimeDecay: boolean;
  /** 时间衰减半衰期（小时） */
  timeDecayHalfLife: number;
}

/**
 * 默认重要性配置
 */
const DEFAULT_IMPORTANCE_CONFIG: ImportanceConfig = {
  initialWeight: 0.4,
  frequencyWeight: 0.3,
  hitWeight: 0.3,
  timeDecayWeight: 0.1,
  maxAccessCount: 100,
  hitTimeWindow: 7 * 24 * 60 * 60 * 1000, // 7天
  enableTimeDecay: false,
  timeDecayHalfLife: 168, // 7天
};

/**
 * 评分因素详情
 */
export interface ScoreFactors {
  /** 初始评分 */
  initial: number;
  /** 访问频率评分 */
  frequency: number;
  /** 命中评分 */
  hit: number;
  /** 时间衰减因子 */
  timeDecay: number;
  /** 原始访问次数 */
  rawAccessCount: number;
  /** 原始命中次数 */
  rawHitCount: number;
}

/**
 * 评分结果
 */
export interface ScoringResult {
  /** 最终评分 (0-1) */
  score: number;
  /** 各因素详情 */
  factors: ScoreFactors;
  /** 计算时间 */
  computedAt: number;
}

/**
 * 评分统计
 */
export interface ScoringStats {
  /** 总计算次数 */
  totalCalculations: number;
  /** 平均评分 */
  avgScore: number;
  /** 高重要性记忆占比 */
  highImportanceRatio: number;
  /** 低重要性记忆占比 */
  lowImportanceRatio: number;
}

/**
 * 重要性评分引擎
 *
 * 综合评分公式：
 * importance = w1 * initial + w2 * frequency + w3 * hit
 *
 * 其中：
 * - frequency = log(access_count + 1) / log(max_access + 1)
 * - hit = recent_hits / total_queries * time_decay
 */
export class ImportanceScoring {
  private config: ImportanceConfig;
  private stats: {
    totalCalculations: number;
    scoreHistory: number[];
  };

  constructor(config: Partial<ImportanceConfig> = {}) {
    this.config = { ...DEFAULT_IMPORTANCE_CONFIG, ...config };
    this.stats = {
      totalCalculations: 0,
      scoreHistory: [],
    };
  }

  /**
   * 计算单条记忆的重要性评分
   */
  calculate(exchange: MemoryExchange): ScoringResult {
    this.stats.totalCalculations++;

    const now = Date.now();
    const factors = this.calculateFactors(exchange, now);

    // 加权求和
    let score =
      this.config.initialWeight * factors.initial +
      this.config.frequencyWeight * factors.frequency +
      this.config.hitWeight * factors.hit;

    // 应用时间衰减（可选）
    if (this.config.enableTimeDecay) {
      score *= factors.timeDecay;
    }

    // 确保在有效范围内
    score = Math.max(0, Math.min(1, score));

    // 记录统计
    this.stats.scoreHistory.push(score);
    if (this.stats.scoreHistory.length > 1000) {
      this.stats.scoreHistory.shift();
    }

    return {
      score,
      factors,
      computedAt: now,
    };
  }

  /**
   * 批量计算评分
   */
  calculateBatch(exchanges: MemoryExchange[]): ScoringResult[] {
    return exchanges.map(exchange => this.calculate(exchange));
  }

  /**
   * 计算各评分因素
   */
  private calculateFactors(
    exchange: MemoryExchange,
    now: number
  ): ScoreFactors {
    // 1. 初始评分
    const initial = exchange.importance_score;

    // 2. 访问频率评分（对数归一化）
    const frequency =
      Math.log10(exchange.access_count + 1) /
      Math.log10(this.config.maxAccessCount + 1);

    // 3. 检索命中评分
    // 从元数据获取命中信息
    const metadata = exchange.metadata as Record<string, unknown> | undefined;
    const hitInfo = metadata?.hitInfo as
      | { count: number; lastHit: number; recentHits: number[] }
      | undefined;

    let hit = 0;
    if (hitInfo) {
      // 只统计时间窗口内的命中
      const recentHits = (hitInfo.recentHits || []).filter(
        hitTime => now - hitTime < this.config.hitTimeWindow
      );

      // 命中率（假设最大命中 100 次）
      hit = Math.min(1, recentHits.length / 100);

      // 时间衰减：最近命中权重更高
      if (recentHits.length > 0) {
        const avgHitAge =
          recentHits.reduce((a, b) => a + (now - b), 0) / recentHits.length;
        const ageHours = avgHitAge / (1000 * 60 * 60);
        const timeDecayFactor = Math.exp(
          -ageHours / this.config.timeDecayHalfLife
        );
        hit *= timeDecayFactor;
      }
    }

    // 4. 时间衰减因子
    let timeDecay = 1;
    if (this.config.enableTimeDecay) {
      const hoursSinceCreation =
        (now - exchange.timestamp) / (1000 * 60 * 60);
      timeDecay = Math.exp(
        -hoursSinceCreation / this.config.timeDecayHalfLife
      );
    }

    return {
      initial,
      frequency,
      hit,
      timeDecay,
      rawAccessCount: exchange.access_count,
      rawHitCount: hitInfo?.count || 0,
    };
  }

  /**
   * 记录访问事件（更新访问频率）
   */
  recordAccess(exchange: MemoryExchange): MemoryExchange {
    return {
      ...exchange,
      access_count: exchange.access_count + 1,
      last_accessed: Date.now(),
    };
  }

  /**
   * 记录检索命中
   */
  recordHit(exchange: MemoryExchange): MemoryExchange {
    const now = Date.now();
    const metadata = (exchange.metadata || {}) as Record<string, unknown>;
    const hitInfo = (metadata.hitInfo || {
      count: 0,
      lastHit: 0,
      recentHits: [],
    }) as { count: number; lastHit: number; recentHits: number[] };

    // 更新命中信息
    const updatedHitInfo = {
      count: hitInfo.count + 1,
      lastHit: now,
      recentHits: [...hitInfo.recentHits, now].slice(-50), // 保留最近 50 次命中
    };

    return {
      ...exchange,
      metadata: {
        ...metadata,
        hitInfo: updatedHitInfo,
      },
    };
  }

  /**
   * 快速更新评分（仅更新访问和命中因素）
   *
   * @returns 新的重要性评分
   */
  quickUpdate(
    exchange: MemoryExchange,
    isHit: boolean
  ): { exchange: MemoryExchange; newScore: number } {
    let updated = this.recordAccess(exchange);

    if (isHit) {
      updated = this.recordHit(updated);
    }

    const result = this.calculate(updated);

    return {
      exchange: {
        ...updated,
        importance_score: result.score,
      },
      newScore: result.score,
    };
  }

  /**
   * 获取重要性级别
   */
  getImportanceLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }

  /**
   * 按重要性排序
   */
  sortByImportance(
    exchanges: MemoryExchange[],
    direction: 'desc' | 'asc' = 'desc'
  ): MemoryExchange[] {
    const withScores = exchanges.map(exchange => ({
      exchange,
      result: this.calculate(exchange),
    }));

    withScores.sort((a, b) => {
      const diff = a.result.score - b.result.score;
      return direction === 'desc' ? -diff : diff;
    });

    return withScores.map(item => item.exchange);
  }

  /**
   * 筛选高重要性记忆
   */
  filterHighImportance(
    exchanges: MemoryExchange[],
    threshold = 0.6
  ): MemoryExchange[] {
    return exchanges.filter(exchange => {
      const result = this.calculate(exchange);
      return result.score >= threshold;
    });
  }

  /**
   * 获取统计信息
   */
  getStats(): ScoringStats {
    const avgScore =
      this.stats.scoreHistory.length > 0
        ? this.stats.scoreHistory.reduce((a, b) => a + b, 0) /
          this.stats.scoreHistory.length
        : 0;

    const highCount = this.stats.scoreHistory.filter(s => s >= 0.6).length;
    const lowCount = this.stats.scoreHistory.filter(s => s < 0.3).length;
    const total = this.stats.scoreHistory.length;

    return {
      totalCalculations: this.stats.totalCalculations,
      avgScore,
      highImportanceRatio: total > 0 ? highCount / total : 0,
      lowImportanceRatio: total > 0 ? lowCount / total : 0,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalCalculations: 0,
      scoreHistory: [],
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ImportanceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ImportanceConfig {
    return { ...this.config };
  }
}

// 导出单例工厂
let defaultScoring: ImportanceScoring | null = null;

/**
 * 获取默认评分引擎
 */
export function getImportanceScoring(
  config?: Partial<ImportanceConfig>
): ImportanceScoring {
  if (!defaultScoring) {
    defaultScoring = new ImportanceScoring(config);
  }
  return defaultScoring;
}

export default ImportanceScoring;
