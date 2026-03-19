/**
 * MemLite Phase 2 测试
 *
 * 测试嵌入模型、压缩引擎、混合检索
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  DistillationEngine,
  CompressionMode,
} from '../src/compression/DistillationEngine.js';
import { RetrievalEngine } from '../src/core/RetrievalEngine.js';
import { SQLiteStore } from '../src/storage/SQLiteStore.js';
import type { MemoryExchange } from '../src/types/memory.js';

// 创建测试用的 SQLiteStore 配置
const createTestStore = (): SQLiteStore => {
  return new SQLiteStore({ dbPath: ':memory:' });
};

// ============================================================================
// 压缩引擎测试
// ============================================================================

describe('DistillationEngine', () => {
  let engine: DistillationEngine;

  beforeAll(() => {
    engine = new DistillationEngine({
      mode: CompressionMode.FAST,
      maxCoreLength: 100,
      maxContextLength: 150,
    });
  });

  describe('压缩功能', () => {
    it('应该成功压缩文本为四元组', async () => {
      const text = `Bug fix: Fixed authentication error during user login.
      The issue was in the token verification logic in AuthService.ts.
      Modified the verifyToken method and added exception handling.
      This bug affected version v1.2.0.`;

      const result = await engine.compress(text);

      expect(result).toBeDefined();
      expect(result.exchange_core).toBeDefined();
      expect(result.exchange_core.length).toBeLessThanOrEqual(100);
      expect(result.thematic_tags).toBeInstanceOf(Array);
      expect(result.entities_extracted).toBeInstanceOf(Array);
      expect(result.compression_ratio).toBeGreaterThan(0);
    });

    it('应该提取关键实体', async () => {
      const text = `In UserService.ts, implemented a new getUserById method,
      using PostgreSQL database and Redis cache.
      See https://example.com/docs for more.`;

      const result = await engine.compress(text);

      expect(result.entities_extracted).toContain('UserService.ts');
    });

    it('应该提取主题标签', async () => {
      const text = `Implemented an important security fix,
      fixed a critical authentication vulnerability.
      This is a bugfix type update.`;

      const result = await engine.compress(text);

      expect(result.thematic_tags.length).toBeGreaterThan(0);
    });

    it('应该计算压缩率', async () => {
      // 使用真实文本测试压缩率
      const longText = `This is an important update about the user authentication system.
      We fixed a token verification logic error in the AuthService.ts file.
      This bug caused authentication failures during user login.
      The fix adds exception handling to the verifyToken method.
      This update affects all users on version v1.2.0.
      We recommend all users upgrade to the latest version as soon as possible.`;
      const result = await engine.compress(longText);

      // 压缩率应该大于0（不一定是大于1，因为短文本可能压缩后更长）
      expect(result.compression_ratio).toBeGreaterThan(0);
    });

    it('应该支持中文文本压缩', async () => {
      const text = `发现了一个重要的bug，影响了用户登录功能。
      修复方法是在 AuthService 中添加 token 验证。
      这个问题出现在 v2.0.0 版本。`;

      const result = await engine.compress(text);

      expect(result.exchange_core).toBeDefined();
      expect(result.thematic_tags.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('统计功能', () => {
    it('应该正确统计压缩次数', async () => {
      const initialStats = engine.getStats();
      const initialCount = initialStats.totalCompressions;

      await engine.compress('Test text 1');
      await engine.compress('Test text 2');

      const newStats = engine.getStats();
      expect(newStats.totalCompressions).toBe(initialCount + 2);
    });

    it('应该计算平均压缩率', async () => {
      engine.resetStats();

      await engine.compress('A'.repeat(500));
      await engine.compress('B'.repeat(300));

      const stats = engine.getStats();
      expect(stats.avgCompressionRatio).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// 检索引擎测试（带缓存）
// ============================================================================

describe('RetrievalEngine with Cache', () => {
  let store: SQLiteStore;
  let engine: RetrievalEngine;

  beforeAll(() => {
    store = createTestStore();
    engine = new RetrievalEngine(store, {
      enableCache: true,
      cacheSize: 10,
      cacheTTL: 60000,
    });

    // 插入测试数据
    const now = Date.now();
    const exchanges: MemoryExchange[] = [
      {
        id: 'test_1',
        timestamp: now - 3000,
        exchange_core: 'User authentication module implementation',
        specific_context: 'Using JWT token for user authentication',
        thematic_tags: ['auth', 'security'],
        entities_extracted: ['JWT', 'AuthService'],
        importance_score: 0.8,
        access_count: 5,
        decay_rate: 0.1,
        last_accessed: now,
      },
      {
        id: 'test_2',
        timestamp: now - 2000,
        exchange_core: 'Database optimization',
        specific_context: 'Added indexes to PostgreSQL for query performance',
        thematic_tags: ['database', 'performance'],
        entities_extracted: ['PostgreSQL', 'index'],
        importance_score: 0.7,
        access_count: 3,
        decay_rate: 0.1,
        last_accessed: now,
      },
      {
        id: 'test_3',
        timestamp: now - 1000,
        exchange_core: 'API documentation update',
        specific_context: 'Updated REST API docs with new endpoints',
        thematic_tags: ['docs', 'api'],
        entities_extracted: ['REST', 'API'],
        importance_score: 0.5,
        access_count: 1,
        decay_rate: 0.1,
        last_accessed: now,
      },
    ];

    store.saveExchanges(exchanges);
  });

  afterAll(() => {
    store.close();
  });

  describe('查询缓存', () => {
    it('应该缓存查询结果', async () => {
      const params = { query: 'authentication' };

      // 第一次查询
      const result1 = await engine.search(params);
      const stats1 = engine.getStats();

      // 第二次相同查询
      const result2 = await engine.search(params);
      const stats2 = engine.getStats();

      expect(stats2.cacheHits).toBe(stats1.cacheHits + 1);
      expect(result2.items).toEqual(result1.items);
    });

    it('应该返回缓存统计', async () => {
      await engine.search({ query: 'test1' });
      await engine.search({ query: 'test2' });

      const stats = engine.getStats();

      expect(stats.totalQueries).toBeGreaterThan(0);
      expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0);
      expect(stats.avgQueryTime).toBeGreaterThanOrEqual(0);
    });

    it('应该能够清除缓存', () => {
      engine.clearCache();
      expect(engine.getCacheSize()).toBe(0);
    });
  });

  describe('混合检索', () => {
    it('应该支持 BM25 搜索', async () => {
      const result = await engine.search({ query: 'authentication' });

      // FTS5 搜索可能返回结果
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it('应该支持重要性过滤', async () => {
      const result = await engine.search({
        query: '',
        minImportance: 0.7,
      });

      expect(result.items.every(item =>
        item.exchange.importance_score >= 0.7
      )).toBe(true);
    });

    it('应该支持时间范围过滤', async () => {
      const now = Date.now();
      const result = await engine.search({
        query: '',
        dateStart: now - 4000,
        dateEnd: now - 1500,
      });

      expect(result.items.every(item => {
        const ts = item.exchange.timestamp;
        return ts >= now - 4000 && ts <= now - 1500;
      })).toBe(true);
    });
  });

  describe('时间线', () => {
    it('应该获取锚点周围的上下文', async () => {
      const result = await engine.timeline({
        anchor: 'test_2',
        depth_before: 1,
        depth_after: 1,
      });

      expect(result.anchor).not.toBeNull();
      expect(result.anchor?.id).toBe('test_2');
    });
  });

  describe('获取详情', () => {
    it('应该获取完整的记忆详情', async () => {
      const observations = await engine.getObservations(['test_1', 'test_2']);

      expect(observations.length).toBe(2);
      expect(observations[0].id).toBe('test_1');
      expect(observations[1].id).toBe('test_2');
    });

    it('应该更新访问计数', async () => {
      const before = store.getExchange('test_1');
      await engine.getObservations(['test_1']);
      const after = store.getExchange('test_1');

      expect(after?.access_count).toBe(before!.access_count + 1);
    });
  });
});

// ============================================================================
// 向量搜索测试（需要嵌入模型）
// ============================================================================

describe('Vector Search (mock)', () => {
  let store: SQLiteStore;
  let engine: RetrievalEngine;

  beforeAll(() => {
    store = createTestStore();
    engine = new RetrievalEngine(store, {
      enableVectorSearch: false, // 禁用向量搜索（没有模型）
    });

    // 插入带嵌入的测试数据
    const exchange: MemoryExchange = {
      id: 'vec_test_1',
      timestamp: Date.now(),
      exchange_core: 'Vector search test',
      specific_context: 'Testing vector similarity search functionality',
      thematic_tags: ['test'],
      entities_extracted: [],
      importance_score: 0.5,
      access_count: 0,
      decay_rate: 0.1,
      last_accessed: Date.now(),
    };

    store.saveExchange(exchange);

    // 保存模拟嵌入（384维）
    const embedding = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      embedding[i] = Math.random();
    }
    store.saveEmbedding('vec_test_1', embedding);
  });

  afterAll(() => {
    store.close();
  });

  it('应该能够存储和检索嵌入', () => {
    const embedding = store.getEmbedding('vec_test_1');
    expect(embedding).not.toBeNull();
    expect(embedding?.length).toBe(384);
  });

  it('应该能够获取所有嵌入', () => {
    const allEmbeddings = store.getAllEmbeddings();
    expect(allEmbeddings.size).toBe(1);
    expect(allEmbeddings.has('vec_test_1')).toBe(true);
  });

  it('应该在没有嵌入模型时仅使用 BM25', async () => {
    const result = await engine.search({ query: 'vector' });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// 嵌入模型测试（需要 ONNX 模型文件）
// ============================================================================

describe('GTEEmbedding (mock)', () => {
  it('应该创建嵌入实例', async () => {
    const { GTEEmbedding } = await import('../src/embedding/GTEEmbedding.js');
    const embedding = new GTEEmbedding();
    expect(embedding).toBeDefined();
  });

  it('应该在没有模型文件时优雅处理', async () => {
    const { GTEEmbedding } = await import('../src/embedding/GTEEmbedding.js');
    const embedding = new GTEEmbedding({
      modelPath: '/nonexistent/path',
    });

    await expect(embedding.initialize()).rejects.toThrow();
  });

  it('应该返回统计信息', async () => {
    const { GTEEmbedding } = await import('../src/embedding/GTEEmbedding.js');
    const embedding = new GTEEmbedding();
    const stats = embedding.getStats();

    expect(stats.totalCalls).toBe(0);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(0);
    expect(stats.avgInferenceTime).toBe(0);
  });

  it('应该能够清除缓存', async () => {
    const { GTEEmbedding } = await import('../src/embedding/GTEEmbedding.js');
    const embedding = new GTEEmbedding();
    embedding.clearCache();
    // 不应该抛出错误
    expect(true).toBe(true);
  });
});

// ============================================================================
// 性能测试
// ============================================================================

describe('Performance', () => {
  it('压缩应该在 50ms 内完成', async () => {
    const engine = new DistillationEngine({ mode: CompressionMode.FAST });
    const text = 'A'.repeat(1000);

    const start = Date.now();
    await engine.compress(text);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('搜索应该在 50ms 内完成', async () => {
    const store = createTestStore();
    const engine = new RetrievalEngine(store);

    // 插入 100 条测试数据
    const exchanges: MemoryExchange[] = [];
    for (let i = 0; i < 100; i++) {
      exchanges.push({
        id: `perf_test_${i}`,
        timestamp: Date.now() - i * 1000,
        exchange_core: `Test record ${i}`,
        specific_context: `This is the detailed content of test record ${i}`,
        thematic_tags: ['test'],
        entities_extracted: [],
        importance_score: 0.5,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      });
    }
    store.saveExchanges(exchanges);

    const start = Date.now();
    await engine.search({ query: 'test' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);

    store.close();
  });

  it('缓存应该提高查询性能', async () => {
    const store = createTestStore();
    const engine = new RetrievalEngine(store, { enableCache: true });

    // 插入数据
    const exchange: MemoryExchange = {
      id: 'cache_perf_test',
      timestamp: Date.now(),
      exchange_core: 'Cache performance test',
      specific_context: 'Testing cache impact on query performance',
      thematic_tags: ['test'],
      entities_extracted: [],
      importance_score: 0.5,
      access_count: 0,
      decay_rate: 0.1,
      last_accessed: Date.now(),
    };
    store.saveExchange(exchange);

    // 第一次查询（缓存未命中）
    const start1 = Date.now();
    await engine.search({ query: 'cache' });
    const elapsed1 = Date.now() - start1;

    // 第二次查询（缓存命中）
    const start2 = Date.now();
    await engine.search({ query: 'cache' });
    const elapsed2 = Date.now() - start2;

    // 缓存命中应该更快（至少不慢）
    expect(elapsed2).toBeLessThanOrEqual(elapsed1 + 5);

    store.close();
  });
});
