/**
 * MemLite - 双通路记忆管理器
 *
 * 实现 HIMM（Hippocampal-Insular Memory Model）双通路架构
 * - 情景记忆（Episodic Memory）：快速通路，完整保留
 * - 语义记忆（Semantic Memory）：慢速通路，压缩存储
 * - 门控机制：D-MEM 多巴胺门控
 */

import type { MemoryExchange, SearchResult } from '../types/memory.js';
import { ForgetModel } from './ForgetModel.js';
import { ImportanceScoring } from './ImportanceScoring.js';
import { clamp } from '../utils/index.js';

/**
 * 记忆通路类型
 */
export enum MemoryPathway {
  /** 情景记忆 - 快速通路 */
  EPISODIC = 'episodic',
  /** 语义记忆 - 慢速通路 */
  SEMANTIC = 'semantic',
  /** 丢弃 */
  DISCARD = 'discard',
}

/**
 * 门控决策结果
 */
export interface GatingDecision {
  /** 选择的通路 */
  pathway: MemoryPathway;
  /** 决策置信度 (0-1) */
  confidence: number;
  /** 多巴胺信号（奖励预测误差） */
  dopamineSignal: number;
  /** 决策因素 */
  factors: {
    importance: number;
    novelty: number;
    emotionalValence: number;
    workload: number;
  };
  /** 决策时间 */
  decidedAt: number;
}

/**
 * 记忆管理器配置
 */
export interface MemoryManagerConfig {
  /** 情景记忆容量 */
  episodicCapacity: number;
  /** 语义记忆容量（0=无限） */
  semanticCapacity: number;
  /** 门控阈值 - 高于此值进入情景记忆 */
  episodicThreshold: number;
  /** 门控阈值 - 低于此值丢弃 */
  discardThreshold: number;
  /** 新颖性权重 */
  noveltyWeight: number;
  /** 情感效价权重 */
  emotionalWeight: number;
  /** 工作记忆负载阈值 */
  workloadThreshold: number;
  /** 启用自动巩固 */
  enableAutoConsolidation: boolean;
  /** 巩固触发阈值（情景记忆占比） */
  consolidationTrigger: number;
}

/**
 * 默认配置
 */
const DEFAULT_MEMORY_MANAGER_CONFIG: MemoryManagerConfig = {
  episodicCapacity: 100,
  semanticCapacity: 0, // 无限
  episodicThreshold: 0.6,
  discardThreshold: 0.2,
  noveltyWeight: 0.3,
  emotionalWeight: 0.2,
  workloadThreshold: 0.8,
  enableAutoConsolidation: true,
  consolidationTrigger: 0.9, // 90% 容量触发
};

/**
 * 记忆统计
 */
export interface MemoryStats {
  /** 情景记忆数量 */
  episodicCount: number;
  /** 语义记忆数量 */
  semanticCount: number;
  /** 情景记忆容量使用率 */
  episodicUsage: number;
  /** 平均门控延迟 */
  avgGatingLatency: number;
  /** 多巴胺信号统计 */
  dopamineStats: {
    avg: number;
    max: number;
    min: number;
  };
  /** 通路选择分布 */
  pathwayDistribution: {
    episodic: number;
    semantic: number;
    discard: number;
  };
}

/**
 * 存储接口（抽象层）
 */
export interface MemoryStore {
  saveExchange(exchange: MemoryExchange): void;
  getExchange(id: string): MemoryExchange | null;
  getExchanges(ids: string[]): MemoryExchange[];
  deleteExchange(id: string): boolean;
  searchFTS(params: { query: string; limit?: number }): SearchResult[];
  getStats(): {
    totalExchanges: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
    avgImportance: number;
  };
}

/**
 * 双通路记忆管理器
 *
 * 实现脑科学启发的记忆架构：
 * 1. 情景记忆（海马体）：快速编码，临时存储
 * 2. 语义记忆（新皮层）：慢速巩固，长期存储
 * 3. 门控机制（D-MEM）：基于多巴胺信号的通路选择
 */
export class MemoryManager {
  private config: MemoryManagerConfig;
  private _forgetModel: ForgetModel;
  private _importanceScoring: ImportanceScoring;
  private _store: MemoryStore | null = null;

  // 情景记忆缓存
  private episodicBuffer: Map<string, MemoryExchange>;
  private episodicOrder: string[]; // LRU 顺序

  // 统计
  private stats: {
    gatingLatencies: number[];
    dopamineSignals: number[];
    pathwayCounts: { episodic: number; semantic: number; discard: number };
  };

  constructor(
    config: Partial<MemoryManagerConfig> = {},
    forgetModel?: ForgetModel,
    importanceScoring?: ImportanceScoring
  ) {
    this.config = { ...DEFAULT_MEMORY_MANAGER_CONFIG, ...config };
    this._forgetModel = forgetModel || new ForgetModel();
    this._importanceScoring = importanceScoring || new ImportanceScoring();

    this.episodicBuffer = new Map();
    this.episodicOrder = [];

    this.stats = {
      gatingLatencies: [],
      dopamineSignals: [],
      pathwayCounts: { episodic: 0, semantic: 0, discard: 0 },
    };
  }

  /**
   * 设置存储后端
   */
  setStore(store: MemoryStore): void {
    this._store = store;
  }

  /**
   * 门控决策 - 选择记忆存储通路
   *
   * 基于多因素决策：
   * 1. 重要性评分
   * 2. 新颖性（与现有记忆的差异）
   * 3. 情感效价
   * 4. 当前工作记忆负载
   */
  gating(exchange: MemoryExchange): GatingDecision {
    const start = Date.now();

    // 1. 计算重要性
    const importanceResult = this._importanceScoring.calculate(exchange);
    const importance = importanceResult.score;

    // 2. 计算新颖性（简化：基于标签和实体的独特性）
    const novelty = this.calculateNovelty(exchange);

    // 3. 情感效价（从元数据获取，默认中性）
    const emotionalValence = this.extractEmotionalValence(exchange);

    // 4. 工作记忆负载
    const workload = this.calculateWorkload();

    // 5. 计算多巴胺信号（奖励预测误差）
    const dopamineSignal = this.calculateDopamineSignal(
      importance,
      novelty,
      emotionalValence,
      workload
    );

    // 6. 做出通路决策
    let pathway: MemoryPathway;
    let confidence: number;

    const combinedScore =
      importance * (1 - this.config.noveltyWeight - this.config.emotionalWeight) +
      novelty * this.config.noveltyWeight +
      Math.abs(emotionalValence) * this.config.emotionalWeight;

    if (combinedScore >= this.config.episodicThreshold && workload < this.config.workloadThreshold) {
      pathway = MemoryPathway.EPISODIC;
      confidence = (combinedScore - this.config.episodicThreshold) /
        (1 - this.config.episodicThreshold);
    } else if (combinedScore < this.config.discardThreshold) {
      pathway = MemoryPathway.DISCARD;
      confidence = 1 - combinedScore / this.config.discardThreshold;
    } else {
      pathway = MemoryPathway.SEMANTIC;
      confidence = 0.5 + Math.random() * 0.3; // 中等置信度
    }

    // 记录统计
    const latency = Date.now() - start;
    this.stats.gatingLatencies.push(latency);
    if (this.stats.gatingLatencies.length > 100) {
      this.stats.gatingLatencies.shift();
    }

    this.stats.dopamineSignals.push(dopamineSignal);
    if (this.stats.dopamineSignals.length > 100) {
      this.stats.dopamineSignals.shift();
    }

    this.stats.pathwayCounts[pathway]++;

    return {
      pathway,
      confidence: clamp(confidence, 0, 1),
      dopamineSignal,
      factors: {
        importance,
        novelty,
        emotionalValence,
        workload,
      },
      decidedAt: Date.now(),
    };
  }

  /**
   * 存储记忆到选定通路
   */
  store(exchange: MemoryExchange, decision?: GatingDecision): {
    stored: boolean;
    pathway: MemoryPathway;
    decision: GatingDecision;
    consolidated?: boolean;
  } {
    const gatingDecision = decision || this.gating(exchange);

    switch (gatingDecision.pathway) {
      case MemoryPathway.EPISODIC:
        return this.storeToEpisodic(exchange, gatingDecision);

      case MemoryPathway.SEMANTIC:
        return this.storeToSemantic(exchange, gatingDecision);

      case MemoryPathway.DISCARD:
      default:
        return {
          stored: false,
          pathway: MemoryPathway.DISCARD,
          decision: gatingDecision,
        };
    }
  }

  /**
   * 存储到情景记忆（快速通路）
   */
  private storeToEpisodic(
    exchange: MemoryExchange,
    decision: GatingDecision
  ): {
    stored: boolean;
    pathway: MemoryPathway;
    decision: GatingDecision;
    consolidated?: boolean;
  } {
    let consolidated = false;

    // 检查容量
    if (this.episodicBuffer.size >= this.config.episodicCapacity) {
      if (this.config.enableAutoConsolidation) {
        this.consolidate();
        consolidated = true;
      } else {
        // LRU 淘汰
        const oldest = this.episodicOrder.shift();
        if (oldest) {
          this.episodicBuffer.delete(oldest);
        }
      }
    }

    // 存储到情景记忆
    this.episodicBuffer.set(exchange.id, exchange);
    this.episodicOrder.push(exchange.id);

    // 同时存储到持久层
    if (this._store) {
      this._store.saveExchange({
        ...exchange,
        metadata: {
          ...exchange.metadata,
          pathway: MemoryPathway.EPISODIC,
          gatingDecision: decision,
        },
      });
    }

    return {
      stored: true,
      pathway: MemoryPathway.EPISODIC,
      decision,
      consolidated,
    };
  }

  /**
   * 存储到语义记忆（慢速通路）
   */
  private storeToSemantic(
    exchange: MemoryExchange,
    decision: GatingDecision
  ): {
    stored: boolean;
    pathway: MemoryPathway;
    decision: GatingDecision;
  } {
    // 直接存储到持久层
    if (this._store) {
      this._store.saveExchange({
        ...exchange,
        metadata: {
          ...exchange.metadata,
          pathway: MemoryPathway.SEMANTIC,
          gatingDecision: decision,
        },
      });
    }

    return {
      stored: true,
      pathway: MemoryPathway.SEMANTIC,
      decision,
    };
  }

  /**
   * 巩固：将情景记忆压缩到语义记忆
   *
   * @returns 巩固的记忆数量
   */
  consolidate(): number {
    if (!this._store || this.episodicBuffer.size === 0) {
      return 0;
    }

    let consolidated = 0;
    const toConsolidate: MemoryExchange[] = [];

    // 选择要巩固的记忆（按重要性排序）
    const entries = Array.from(this.episodicBuffer.entries());

    // 使用 forgetModel 计算强度来辅助决策
    const entriesWithStrength = entries.map(([id, exchange]) => ({
      id,
      exchange,
      strength: this._forgetModel.calculateStrength(exchange),
    }));

    // 按强度和重要性综合排序
    entriesWithStrength.sort((a, b) => {
      const scoreA = a.strength.strength * 0.6 + a.exchange.importance_score * 0.4;
      const scoreB = b.strength.strength * 0.6 + b.exchange.importance_score * 0.4;
      return scoreB - scoreA;
    });

    // 保留最新的 20%，其余的巩固
    const keepCount = Math.floor(this.config.episodicCapacity * 0.2);
    const consolidateEntries = entriesWithStrength.slice(keepCount);

    for (const { id, exchange } of consolidateEntries) {
      // 更新通路为语义记忆
      this._store.saveExchange({
        ...exchange,
        metadata: {
          ...exchange.metadata,
          pathway: MemoryPathway.SEMANTIC,
          consolidatedAt: Date.now(),
        },
      });

      toConsolidate.push(exchange);
      this.episodicBuffer.delete(id);

      // 从顺序列表中移除
      const index = this.episodicOrder.indexOf(id);
      if (index > -1) {
        this.episodicOrder.splice(index, 1);
      }

      consolidated++;
    }

    return consolidated;
  }

  /**
   * 双通路检索
   *
   * 优先从情景记忆检索，再从语义记忆检索
   */
  retrieve(query: string, limit = 10): SearchResult[] {
    const results: SearchResult[] = [];
    const seenIds = new Set<string>();

    // 1. 情景记忆检索（快速通路）
    for (const [id, exchange] of this.episodicBuffer) {
      if (results.length >= limit) break;

      if (!seenIds.has(id)) {
        // 简单文本匹配
        const text = `${exchange.exchange_core} ${exchange.specific_context}`;
        if (text.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            id,
            score: 0.9, // 情景记忆高分
            exchange,
          });
          seenIds.add(id);
        }
      }
    }

    // 2. 语义记忆检索（慢速通路）
    if (results.length < limit && this._store) {
      const semanticResults = this._store.searchFTS({
        query,
        limit: limit - results.length,
      });

      for (const result of semanticResults) {
        if (!seenIds.has(result.id)) {
          results.push(result);
          seenIds.add(result.id);
        }
      }
    }

    return results;
  }

  /**
   * 计算新颖性
   */
  private calculateNovelty(exchange: MemoryExchange): number {
    if (!this._store) return 0.5;

    // 基于标签和实体的独特性
    const existingTags = new Set<string>();
    const existingEntities = new Set<string>();

    // 从情景记忆收集
    for (const ex of this.episodicBuffer.values()) {
      ex.thematic_tags.forEach(t => existingTags.add(t));
      ex.entities_extracted.forEach(e => existingEntities.add(e));
    }

    // 计算新标签和新实体比例
    const newTags = exchange.thematic_tags.filter(t => !existingTags.has(t));
    const newEntities = exchange.entities_extracted.filter(
      e => !existingEntities.has(e)
    );

    const tagNovelty =
      exchange.thematic_tags.length > 0
        ? newTags.length / exchange.thematic_tags.length
        : 0.5;

    const entityNovelty =
      exchange.entities_extracted.length > 0
        ? newEntities.length / exchange.entities_extracted.length
        : 0.5;

    return (tagNovelty + entityNovelty) / 2;
  }

  /**
   * 提取情感效价
   */
  private extractEmotionalValence(exchange: MemoryExchange): number {
    const metadata = exchange.metadata as Record<string, unknown> | undefined;
    if (metadata?.emotionalValence !== undefined) {
      return metadata.emotionalValence as number;
    }

    // 基于标签推断（简化）
    const positiveTags = ['success', 'achievement', 'happy', 'good', 'fix'];
    const negativeTags = ['error', 'bug', 'fail', 'crash', 'critical'];

    const tags = exchange.thematic_tags.map(t => t.toLowerCase());
    const hasPositive = tags.some(t => positiveTags.includes(t));
    const hasNegative = tags.some(t => negativeTags.includes(t));

    if (hasPositive && !hasNegative) return 0.3;
    if (hasNegative && !hasPositive) return -0.3;
    return 0; // 中性
  }

  /**
   * 计算工作记忆负载
   */
  private calculateWorkload(): number {
    return this.episodicBuffer.size / this.config.episodicCapacity;
  }

  /**
   * 计算多巴胺信号（奖励预测误差）
   *
   * RPE = 实际奖励 - 预期奖励
   *
   * 在记忆存储中：
   * - 高重要性 + 高新颖性 = 正向 RPE（惊喜）
   * - 低重要性 + 低新颖性 = 负向 RPE（无聊）
   */
  private calculateDopamineSignal(
    importance: number,
    novelty: number,
    emotionalValence: number,
    workload: number
  ): number {
    // 预期奖励（基于工作负载）
    const expectedReward = 1 - workload;

    // 实际奖励
    const actualReward =
      importance * 0.4 + novelty * 0.3 + (emotionalValence + 1) * 0.15;

    // 奖励预测误差
    const rpe = actualReward - expectedReward;

    // 归一化到 [-1, 1]
    return clamp(rpe, -1, 1);
  }

  /**
   * 获取情景记忆大小
   */
  getEpisodicSize(): number {
    return this.episodicBuffer.size;
  }

  /**
   * 获取情景记忆容量
   */
  getEpisodicCapacity(): number {
    return this.config.episodicCapacity;
  }

  /**
   * 清空情景记忆
   */
  clearEpisodic(): void {
    this.episodicBuffer.clear();
    this.episodicOrder = [];
  }

  /**
   * 获取统计信息
   */
  getStats(): MemoryStats {
    const avgGatingLatency =
      this.stats.gatingLatencies.length > 0
        ? this.stats.gatingLatencies.reduce((a, b) => a + b, 0) /
          this.stats.gatingLatencies.length
        : 0;

    const dopamineStats = {
      avg:
        this.stats.dopamineSignals.length > 0
          ? this.stats.dopamineSignals.reduce((a, b) => a + b, 0) /
            this.stats.dopamineSignals.length
          : 0,
      max:
        this.stats.dopamineSignals.length > 0
          ? Math.max(...this.stats.dopamineSignals)
          : 0,
      min:
        this.stats.dopamineSignals.length > 0
          ? Math.min(...this.stats.dopamineSignals)
          : 0,
    };

    const total =
      this.stats.pathwayCounts.episodic +
      this.stats.pathwayCounts.semantic +
      this.stats.pathwayCounts.discard;

    const semanticCount = this._store ? this._store.getStats().totalExchanges - this.episodicBuffer.size : 0;

    return {
      episodicCount: this.episodicBuffer.size,
      semanticCount: Math.max(0, semanticCount),
      episodicUsage: this.episodicBuffer.size / this.config.episodicCapacity,
      avgGatingLatency,
      dopamineStats,
      pathwayDistribution: {
        episodic: total > 0 ? this.stats.pathwayCounts.episodic / total : 0,
        semantic: total > 0 ? this.stats.pathwayCounts.semantic / total : 0,
        discard: total > 0 ? this.stats.pathwayCounts.discard / total : 0,
      },
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default MemoryManager;
