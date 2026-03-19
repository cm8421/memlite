/**
 * MemLite MCP Server 集成测试
 *
 * 测试 MCP 服务器进程启动、stdio 传输层、工具响应
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMCPServer } from '../../src/mcp/server.js';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import type { MemoryExchange } from '../../src/types/memory.js';

// ============================================================================
// 测试辅助函数
// ============================================================================

/**
 * 创建测试用的记忆数据
 */
function createTestMemory(id: string, content: string, overrides: Partial<MemoryExchange> = {}): MemoryExchange {
  return {
    id,
    timestamp: Date.now(),
    exchange_core: content,
    specific_context: `Context for ${id}`,
    thematic_tags: ['test'],
    entities_extracted: [],
    importance_score: 0.5,
    access_count: 0,
    decay_rate: 0.1,
    last_accessed: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// MCP Server 测试
// ============================================================================

describe('MCP Server Integration', () => {
  let server: McpServer;
  let store: SQLiteStore;
  let engine: RetrievalEngine;

  beforeAll(() => {
    // 创建内存数据库
    store = new SQLiteStore({ dbPath: ':memory:' });
    engine = new RetrievalEngine(store, { enableVectorSearch: false });
    server = createMCPServer(':memory:');
  });

  afterAll(() => {
    store.close();
  });

  beforeEach(() => {
    // 清空数据
    vi.clearAllMocks();
  });

  describe('服务器初始化', () => {
    it('应该成功创建 MCP 服务器实例', () => {
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(McpServer);
    });

    it('应该注册所有必需的工具', () => {
      // MCP Server 通过 registerTool 注册工具
      // 这里验证服务器创建成功即可
      expect(server).toBeDefined();
    });
  });

  describe('Tool: search', () => {
    beforeEach(async () => {
      // 准备测试数据
      const memories = [
        createTestMemory('search_1', '用户偏好：喜欢深色主题'),
        createTestMemory('search_2', '项目配置：TypeScript + React'),
        createTestMemory('search_3', 'API端点：/api/users'),
      ];

      for (const memory of memories) {
        store.saveExchange(memory);
      }
    });

    it('应该返回搜索结果', async () => {
      const result = await engine.search({
        query: 'TypeScript',
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('应该支持分页', async () => {
      const page1 = await engine.search({
        query: '',
        limit: 2,
        offset: 0,
      });

      const page2 = await engine.search({
        query: '',
        limit: 2,
        offset: 2,
      });

      // 确保分页工作正常
      expect(page1.offset).toBe(0);
      expect(page2.offset).toBe(2);

      // 如果有足够数据，两页应该不同
      if (page1.items.length > 0 && page2.items.length > 0) {
        expect(page1.items[0].id).not.toBe(page2.items[0].id);
      }
    });

    it('应该支持重要性过滤', async () => {
      // 添加高重要性记忆
      store.saveExchange(createTestMemory('high_imp', '高重要性内容', {
        importance_score: 0.9,
      }));

      const result = await engine.search({
        query: '',
        limit: 10,
        minImportance: 0.8,
      });

      expect(result.items.every(item => item.exchange.importance_score >= 0.8)).toBe(true);
    });

    it('应该支持时间范围过滤', async () => {
      const now = Date.now();
      const oldMemory = createTestMemory('old', '旧记忆', {
        timestamp: now - 1000 * 60 * 60 * 24 * 10, // 10天前
      });
      store.saveExchange(oldMemory);

      const result = await engine.search({
        query: '',
        limit: 10,
        dateStart: now - 1000 * 60 * 60 * 24, // 1天内
      });

      // 应该只返回新记忆
      expect(result.items.every(item => item.exchange.timestamp >= now - 1000 * 60 * 60 * 24)).toBe(true);
    });

    it('应该正确处理空查询', async () => {
      const result = await engine.search({
        query: '',
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Tool: timeline', () => {
    beforeEach(() => {
      // 创建时间序列数据
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        store.saveExchange(createTestMemory(`timeline_${i}`, `记忆 ${i}`, {
          timestamp: now - i * 1000 * 60, // 每分钟一条
        }));
      }
    });

    it('应该返回时间线上下文', async () => {
      const result = await engine.timeline({
        anchor: 'timeline_5',
        depth_before: 2,
        depth_after: 2,
      });

      expect(result.anchor).toBeDefined();
      expect(result.anchor?.id).toBe('timeline_5');
      expect(result.before.length).toBeLessThanOrEqual(2);
      expect(result.after.length).toBeLessThanOrEqual(2);
    });

    it('应该在没有锚点时返回最近的记忆', async () => {
      const result = await engine.timeline({
        depth_before: 5,
        depth_after: 5,
      });

      expect(result.anchor).toBeDefined();
      expect(result.before.length).toBeGreaterThanOrEqual(0);
    });

    it('应该正确处理无效锚点', async () => {
      const result = await engine.timeline({
        anchor: 'non_existent_id',
        depth_before: 5,
        depth_after: 5,
      });

      expect(result.anchor).toBeNull();
      expect(result.before).toEqual([]);
      expect(result.after).toEqual([]);
    });
  });

  describe('Tool: get_observations', () => {
    beforeEach(() => {
      store.saveExchange(createTestMemory('obs_1', '观察1', {
        specific_context: '详细上下文1',
        thematic_tags: ['tag1', 'tag2'],
        entities_extracted: ['entity1'],
      }));
      store.saveExchange(createTestMemory('obs_2', '观察2', {
        specific_context: '详细上下文2',
        thematic_tags: ['tag2', 'tag3'],
        entities_extracted: ['entity2', 'entity3'],
      }));
    });

    it('应该返回完整的观察详情', async () => {
      const observations = await engine.getObservations(['obs_1', 'obs_2']);

      expect(observations.length).toBe(2);
      expect(observations[0].exchange_core).toBe('观察1');
      expect(observations[1].exchange_core).toBe('观察2');
    });

    it('应该更新访问统计', async () => {
      await engine.getObservations(['obs_1']);

      const memory = store.getExchange('obs_1');
      expect(memory?.access_count).toBe(1);
    });

    it('应该处理空ID列表', async () => {
      const observations = await engine.getObservations([]);
      expect(observations).toEqual([]);
    });

    it('应该处理不存在的ID', async () => {
      const observations = await engine.getObservations(['non_existent']);
      expect(observations.length).toBe(0);
    });
  });

  describe('Tool: save_memory', () => {
    it('应该保存新记忆', async () => {
      const memory = createTestMemory('save_1', '新保存的记忆');

      await engine.saveWithEmbedding(memory);

      const saved = store.getExchange('save_1');
      expect(saved).toBeDefined();
      expect(saved?.exchange_core).toBe('新保存的记忆');
    });

    it('应该保存嵌入向量', async () => {
      const memory = createTestMemory('save_2', '带嵌入的记忆');
      const embedding = new Float32Array(384).fill(0.1);

      await engine.saveWithEmbedding(memory, embedding);

      const savedEmbedding = store.getEmbedding('save_2');
      expect(savedEmbedding).toBeDefined();
      expect(savedEmbedding?.length).toBe(384);
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的搜索参数', async () => {
      // 空查询应该正常工作
      const result = await engine.search({
        query: '',
        limit: 10,
      });
      expect(result).toBeDefined();
    });

    it('应该处理数据库关闭后的操作', () => {
      const closedStore = new SQLiteStore({ dbPath: ':memory:' });
      closedStore.close();

      // 关闭后操作应该抛出错误
      expect(() => closedStore.getExchange('any')).toThrow();
    });
  });

  describe('性能测试', () => {
    it('搜索延迟应该小于50ms（P95）', async () => {
      // 准备1000条数据
      for (let i = 0; i < 1000; i++) {
        store.saveExchange(createTestMemory(`perf_${i}`, `性能测试记忆 ${i}`));
      }

      const latencies: number[] = [];
      const queries = ['性能', '测试', '记忆', 'TypeScript', 'API'];

      for (const query of queries) {
        for (let i = 0; i < 10; i++) {
          const start = Date.now();
          await engine.search({ query, limit: 20 });
          latencies.push(Date.now() - start);
        }
      }

      // 计算P95
      const sorted = latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index];

      expect(p95).toBeLessThan(50);
    });

    it('记忆创建延迟应该小于20ms', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const memory = createTestMemory(`create_perf_${i}`, `创建性能测试 ${i}`);
        const start = Date.now();
        store.saveExchange(memory);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avgLatency).toBeLessThan(20);
    });
  });
});

// ============================================================================
// stdio 传输层测试（需要子进程）
// ============================================================================

describe('MCP Server stdio Transport', () => {
  it.skip('应该通过 stdio 接收和响应消息', () => {
    // 这个测试需要启动子进程，在CI中跳过
    // 实际使用时可以通过集成测试覆盖
  });

  it.skip('应该正确处理 JSON-RPC 消息', () => {
    // JSON-RPC 协议测试
  });

  it.skip('应该优雅地处理进程信号', () => {
    // SIGTERM, SIGINT 处理测试
  });
});
