/**
 * MemLite 检索引擎
 *
 * 实现混合检索：向量相似度 + BM25 + RRF融合
 * 支持3层工作流：search → timeline → get_observations
 * Phase 2: 集成嵌入模型 + 查询缓存
 */

import { SQLiteStore } from '../storage/SQLiteStore.js';
import { GTEEmbedding, type EmbeddingConfig } from '../embedding/GTEEmbedding.js';
import type {
  MemoryExchange,
  SearchParams,
  SearchResult,
  RetrievalResult,
  TimelineParams,
} from '../types/memory.js';

/**
 * LRU 查询缓存
 */
class QueryCache {
  private cache: Map<string, { result: RetrievalResult; timestamp: number }>;
  private maxSize: number;
  private ttl: number; // 生存时间（毫秒）

  constructor(maxSize = 100, ttl = 60000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  private hashParams(params: SearchParams): string {
    return JSON.stringify({
      query: params.query,
      limit: params.limit,
      offset: params.offset,
      tags: params.tags?.sort(),
      dateStart: params.dateStart,
      dateEnd: params.dateEnd,
      minImportance: params.minImportance,
    });
  }

  get(params: SearchParams): RetrievalResult | null {
    const key = this.hashParams(params);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // 检查是否过期
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // 移动到最近使用
    this.cache.delete(key);
    this.cache.set(key, cached);

    return cached.result;
  }

  set(params: SearchParams, result: RetrievalResult): void {
    const key = this.hashParams(params);

    // 清理过期条目
    if (this.cache.size >= this.maxSize) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now - v.timestamp > this.ttl) {
          this.cache.delete(k);
        }
      }

      // 如果还是满了，删除最旧的
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * 向量相似度计算（余弦距离）
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * RRF (Reciprocal Rank Fusion) 融合算法
 *
 * @param rankings 多个排序列表
 * @param k RRF参数（默认60）
 * @returns 融合后的排序分数
 */
function reciprocalRankFusion(
  rankings: string[][],
  k = 60
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) || 0) + rrfScore);
    });
  }

  return scores;
}

/**
 * 检索引擎配置
 */
export interface RetrievalConfig {
  /** 向量搜索权重 */
  vectorWeight: number;
  /** BM25搜索权重 */
  bm25Weight: number;
  /** RRF融合参数k */
  rrfK: number;
  /** 默认返回数量 */
  defaultLimit: number;
  /** 是否启用向量搜索 */
  enableVectorSearch: boolean;
  /** 是否启用查询缓存 */
  enableCache: boolean;
  /** 缓存大小 */
  cacheSize: number;
  /** 缓存 TTL（毫秒） */
  cacheTTL: number;
  /** 嵌入模型配置 */
  embeddingConfig?: Partial<EmbeddingConfig>;
}

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  vectorWeight: 0.6,
  bm25Weight: 0.4,
  rrfK: 60,
  defaultLimit: 20,
  enableVectorSearch: true,
  enableCache: true,
  cacheSize: 100,
  cacheTTL: 60000, // 1分钟
};

/**
 * 检索统计
 */
export interface RetrievalStats {
  /** 总查询次数 */
  totalQueries: number;
  /** 缓存命中次数 */
  cacheHits: number;
  /** 缓存未命中次数 */
  cacheMisses: number;
  /** 向量搜索次数 */
  vectorSearches: number;
  /** BM25搜索次数 */
  bm25Searches: number;
  /** 平均查询时间（ms） */
  avgQueryTime: number;
  /** 缓存命中率 */
  cacheHitRate: number;
}

/**
 * 检索引擎
 */
export class RetrievalEngine {
  private store: SQLiteStore;
  private config: RetrievalConfig;
  private embedding: GTEEmbedding | null = null;
  private queryCache: QueryCache;
  private stats: {
    totalQueries: number;
    cacheHits: number;
    cacheMisses: number;
    vectorSearches: number;
    bm25Searches: number;
    queryTimes: number[];
  };

  constructor(
    store: SQLiteStore,
    config: Partial<RetrievalConfig> = {},
    embedding?: GTEEmbedding
  ) {
    this.store = store;
    this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };
    this.embedding = embedding || null;
    this.queryCache = new QueryCache(
      this.config.cacheSize,
      this.config.cacheTTL
    );
    this.stats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      vectorSearches: 0,
      bm25Searches: 0,
      queryTimes: [],
    };
  }

  /**
   * 设置嵌入模型
   */
  setEmbedding(embedding: GTEEmbedding): void {
    this.embedding = embedding;
  }

  /**
   * 初始化嵌入模型
   */
  async initializeEmbedding(config?: Partial<EmbeddingConfig>): Promise<void> {
    if (!this.embedding) {
      this.embedding = new GTEEmbedding(config);
    }
    await this.embedding.initialize();
  }

  // ==========================================================================
  // 三层工作流
  // ==========================================================================

  /**
   * 第一层：搜索 - 返回ID列表和基本信息
   *
   * 使用混合检索（向量 + BM25 + RRF融合）
   */
  async search(params: SearchParams): Promise<RetrievalResult> {
    const startTime = Date.now();
    this.stats.totalQueries++;

    // 检查缓存
    if (this.config.enableCache) {
      const cached = this.queryCache.get(params);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }

    const limit = params.limit ?? this.config.defaultLimit;
    const offset = params.offset ?? 0;

    // 1. BM25 搜索
    this.stats.bm25Searches++;
    const bm25Results = this.store.searchFTS({
      ...params,
      limit: limit * 2, // 获取更多用于融合
    });

    // 2. 向量搜索
    let vectorResults: SearchResult[] = [];
    if (
      this.config.enableVectorSearch &&
      this.embedding &&
      params.query.trim()
    ) {
      try {
        this.stats.vectorSearches++;
        const queryEmbedding = await this.embedding.generateEmbedding(
          params.query
        );
        vectorResults = await this.vectorSearch(queryEmbedding, limit * 2);
      } catch (error) {
        // 向量搜索失败，仅使用 BM25
        console.warn('Vector search failed:', error);
      }
    }

    // 3. RRF融合
    const fusedResults = this.fuseResults([bm25Results, vectorResults]);

    // 4. 应用过滤
    let filteredResults = fusedResults;
    if (params.minImportance !== undefined) {
      filteredResults = filteredResults.filter(
        r => r.exchange.importance_score >= params.minImportance!
      );
    }

    if (params.dateStart !== undefined) {
      filteredResults = filteredResults.filter(
        r => r.exchange.timestamp >= params.dateStart!
      );
    }

    if (params.dateEnd !== undefined) {
      filteredResults = filteredResults.filter(
        r => r.exchange.timestamp <= params.dateEnd!
      );
    }

    // 5. 排序
    if (params.orderBy) {
      filteredResults.sort((a, b) => {
        const field = params.orderBy as keyof MemoryExchange;
        const aVal = a.exchange[field] as number;
        const bVal = b.exchange[field] as number;
        const direction = params.orderDirection === 'desc' ? -1 : 1;
        return (aVal - bVal) * direction;
      });
    }

    // 6. 分页
    const total = filteredResults.length;
    const paginatedResults = filteredResults.slice(offset, offset + limit);

    const result: RetrievalResult = {
      total,
      count: paginatedResults.length,
      offset,
      items: paginatedResults,
      has_more: offset + paginatedResults.length < total,
      next_offset:
        offset + paginatedResults.length < total
          ? offset + paginatedResults.length
          : undefined,
    };

    // 缓存结果
    if (this.config.enableCache) {
      this.queryCache.set(params, result);
    }

    // 记录查询时间
    const queryTime = Date.now() - startTime;
    this.stats.queryTimes.push(queryTime);
    if (this.stats.queryTimes.length > 100) {
      this.stats.queryTimes.shift();
    }

    return result;
  }

  /**
   * 第二层：时间线 - 获取锚点周围的上下文
   */
  async timeline(params: TimelineParams): Promise<{
    before: SearchResult[];
    anchor: SearchResult | null;
    after: SearchResult[];
  }> {
    const depthBefore = params.depth_before ?? 5;
    const depthAfter = params.depth_after ?? 5;

    if (!params.anchor) {
      // 没有锚点，返回最近的记忆
      const result = await this.search({
        query: '',
        limit: depthBefore + depthAfter + 1,
        orderBy: 'timestamp',
        orderDirection: 'desc',
      });

      if (result.items.length === 0) {
        return { before: [], anchor: null, after: [] };
      }

      const anchorIndex = Math.min(depthBefore, result.items.length - 1);
      return {
        before: result.items.slice(0, anchorIndex),
        anchor: result.items[anchorIndex],
        after: result.items.slice(anchorIndex + 1),
      };
    }

    return this.store.getTimelineContext(params.anchor, depthBefore, depthAfter);
  }

  /**
   * 第三层：获取完整详情
   */
  async getObservations(ids: string[]): Promise<MemoryExchange[]> {
    if (ids.length === 0) return [];

    // 更新访问统计
    for (const id of ids) {
      this.store.updateAccessStats(id);
    }

    return this.store.getExchanges(ids);
  }

  // ==========================================================================
  // 混合检索
  // ==========================================================================

  /**
   * 向量相似度搜索
   */
  async vectorSearch(
    queryEmbedding: Float32Array,
    limit: number
  ): Promise<SearchResult[]> {
    const allEmbeddings = this.store.getAllEmbeddings();

    if (allEmbeddings.size === 0) {
      return [];
    }

    const results: Array<{ id: string; score: number }> = [];

    for (const [id, embedding] of allEmbeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding);
      results.push({ id, score });
    }

    // 按分数降序排序
    results.sort((a, b) => b.score - a.score);

    // 获取前limit个结果
    const topResults = results.slice(0, limit);
    const exchanges = this.store.getExchanges(topResults.map(r => r.id));

    return topResults.map(r => ({
      id: r.id,
      score: r.score,
      exchange: exchanges.find(e => e.id === r.id)!,
    }));
  }

  /**
   * RRF融合多个搜索结果
   */
  private fuseResults(resultSets: SearchResult[][]): SearchResult[] {
    // 过滤空结果集
    const nonEmptySets = resultSets.filter(set => set.length > 0);
    if (nonEmptySets.length === 0) return [];
    if (nonEmptySets.length === 1) return nonEmptySets[0];

    // 提取每个结果集的ID排序列表
    const rankings = nonEmptySets.map(set => set.map(r => r.id));

    // RRF融合
    const fusedScores = reciprocalRankFusion(rankings, this.config.rrfK);

    // 创建ID到exchange的映射
    const idToExchange = new Map<string, MemoryExchange>();
    for (const set of nonEmptySets) {
      for (const result of set) {
        if (!idToExchange.has(result.id)) {
          idToExchange.set(result.id, result.exchange);
        }
      }
    }

    // 转换为排序后的SearchResult
    const sortedResults = Array.from(fusedScores.entries())
      .map(([id, score]) => ({
        id,
        score,
        exchange: idToExchange.get(id)!,
      }))
      .filter(r => r.exchange)
      .sort((a, b) => b.score - a.score);

    return sortedResults;
  }

  // ==========================================================================
  // 记忆保存（包含嵌入生成）
  // ==========================================================================

  /**
   * 保存记忆（带自动嵌入生成）
   */
  async saveWithEmbedding(
    exchange: MemoryExchange,
    embedding?: Float32Array
  ): Promise<void> {
    // 保存记忆
    this.store.saveExchange(exchange);

    // 如果提供了嵌入，直接保存
    if (embedding) {
      this.store.saveEmbedding(exchange.id, embedding);
      return;
    }

    // 否则自动生成嵌入
    if (this.embedding) {
      const text = `${exchange.exchange_core} ${exchange.specific_context}`;
      const generatedEmbedding = await this.embedding.generateEmbedding(text);
      this.store.saveEmbedding(exchange.id, generatedEmbedding);
    }
  }

  /**
   * 批量保存记忆（带嵌入生成）
   */
  async saveBatchWithEmbedding(
    exchanges: MemoryExchange[],
    embeddings?: Float32Array[]
  ): Promise<void> {
    // 保存记忆
    this.store.saveExchanges(exchanges);

    // 保存嵌入
    if (embeddings) {
      for (let i = 0; i < exchanges.length; i++) {
        if (embeddings[i]) {
          this.store.saveEmbedding(exchanges[i].id, embeddings[i]);
        }
      }
    } else if (this.embedding) {
      // 批量生成嵌入
      const texts = exchanges.map(
        e => `${e.exchange_core} ${e.specific_context}`
      );
      const generatedEmbeddings =
        await this.embedding.generateBatchEmbeddings(texts);

      for (let i = 0; i < exchanges.length; i++) {
        this.store.saveEmbedding(exchanges[i].id, generatedEmbeddings[i]);
      }
    }
  }

  // ==========================================================================
  // 遗忘机制
  // ==========================================================================

  /**
   * 应用遗忘曲线衰减
   */
  applyDecay(): number {
    // 清除缓存（数据已变更）
    this.queryCache.clear();
    return this.store.applyDecay();
  }

  /**
   * 清理低重要性记忆
   */
  cleanup(threshold = 0.1): number {
    // 清除缓存
    this.queryCache.clear();
    return this.store.cleanupLowImportance(threshold);
  }

  // ==========================================================================
  // 统计与管理
  // ==========================================================================

  /**
   * 获取统计信息
   */
  getStats(): RetrievalStats {
    const avgQueryTime =
      this.stats.queryTimes.length > 0
        ? this.stats.queryTimes.reduce((a, b) => a + b, 0) /
          this.stats.queryTimes.length
        : 0;

    return {
      totalQueries: this.stats.totalQueries,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      vectorSearches: this.stats.vectorSearches,
      bm25Searches: this.stats.bm25Searches,
      avgQueryTime,
      cacheHitRate:
        this.stats.totalQueries > 0
          ? this.stats.cacheHits / this.stats.totalQueries
          : 0,
    };
  }

  /**
   * 清除查询缓存
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.queryCache.size;
  }

  /**
   * 获取存储实例
   */
  getStore(): SQLiteStore {
    return this.store;
  }

  /**
   * 获取嵌入模型实例
   */
  getEmbedding(): GTEEmbedding | null {
    return this.embedding;
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    this.clearCache();
    if (this.embedding) {
      await this.embedding.dispose();
    }
  }
}

export default RetrievalEngine;
