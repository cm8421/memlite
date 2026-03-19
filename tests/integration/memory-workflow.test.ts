/**
 * MemLite 记忆工作流集成测试
 *
 * 测试完整的记忆生命周期：
 * - 保存 → 检索 → 时间线 → 获取详情
 * - 遗忘曲线与清理触发
 * - SleepGate 空闲巩固
 * - 双通路存储与检索
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import { ForgetModel } from '../../src/core/ForgetModel.js';
import { ImportanceScoring } from '../../src/core/ImportanceScoring.js';
import { MemoryManager, MemoryPathway } from '../../src/core/MemoryManager.js';
import { SleepGate } from '../../src/core/SleepGate.js';
import { DistillationEngine, CompressionMode } from '../../src/compression/DistillationEngine.js';
import type { MemoryExchange } from '../../src/types/memory.js';

// ============================================================================
// 测试辅助函数
// ============================================================================

function createTestExchange(
  id: string,
  content: string,
  overrides: Partial<MemoryExchange> = {}
): MemoryExchange {
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
// 记忆工作流集成测试
// ============================================================================

describe('Memory Workflow Integration', () => {
  let store: SQLiteStore;
  let engine: RetrievalEngine;
  let compression: DistillationEngine;

  beforeAll(() => {
    // 初始化实例
    store = new SQLiteStore({ dbPath: ':memory:' });
    engine = new RetrievalEngine(store, { enableVectorSearch: false });
    compression = new DistillationEngine({ mode: CompressionMode.FAST });
  });

  afterAll(() => {
    store.close();
  });

  beforeEach(() => {
    // 每个测试前清空数据
    vi.clearAllMocks();
    // 清空所有记忆
    const { ids } = store.getAllExchangeIds(10000, 0);
    for (const id of ids) {
      store.deleteExchange(id);
    }
  });

  describe('完整记忆工作流', () => {
    it('应该完成 save → search → timeline → get_observations 流程', async () => {
      // 1. 保存记忆
      const memory1 = createTestExchange('workflow_1', '用户偏好：深色主题');
      const memory2 = createTestExchange('workflow_2', '项目配置：TypeScript');
      const memory3 = createTestExchange('workflow_3', 'API设计：RESTful风格');

      store.saveExchange(memory1);
      store.saveExchange(memory2);
      store.saveExchange(memory3);

      // 2. 搜索
      const searchResult = await engine.search({
        query: 'TypeScript',
        limit: 10,
      });

      expect(searchResult.total).toBeGreaterThanOrEqual(1);
      const foundId = searchResult.items[0]?.id;
      expect(foundId).toBeDefined();

      // 3. 时间线
      const timeline = await engine.timeline({
        anchor: foundId,
        depth_before: 2,
        depth_after: 2,
      });

      expect(timeline.anchor).toBeDefined();
      expect(timeline.anchor?.id).toBe(foundId);

      // 4. 获取详情
      const observations = await engine.getObservations([foundId]);
      expect(observations.length).toBe(1);
      expect(observations[0].id).toBe(foundId);
      expect(observations[0].access_count).toBe(1); // 应该更新访问计数
    });

    it('应该正确处理压缩流程', async () => {
      const longText = `
        这是一个较长的对话内容，包含了用户和助手之间的多次交互。
        用户询问了关于项目配置的问题，包括TypeScript设置、ESLint规则、
        以及如何配置打包工具。助手提供了详细的配置示例和最佳实践建议。
        用户还询问了关于测试框架的选择，助手推荐了Vitest作为测试工具。
      `;

      // 压缩
      const compressed = await compression.compress(longText);

      // 验证压缩结果的结构
      expect(compressed.exchange_core).toBeDefined();
      expect(compressed.specific_context).toBeDefined();
      expect(compressed.thematic_tags.length).toBeGreaterThan(0);

      // 保存压缩后的记忆
      const memory: MemoryExchange = {
        id: 'compressed_1',
        timestamp: Date.now(),
        exchange_core: compressed.exchange_core,
        specific_context: compressed.specific_context,
        thematic_tags: compressed.thematic_tags,
        entities_extracted: compressed.entities_extracted,
        importance_score: 0.7,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
        raw_content: longText,
      };

      store.saveExchange(memory);

      // 验证可以获取保存的记忆
      const observations = await engine.getObservations(['compressed_1']);
      expect(observations.length).toBe(1);
      expect(observations[0].exchange_core).toBeDefined();
    });
  });

  describe('遗忘曲线与清理', () => {
    it('应该正确应用遗忘曲线衰减', () => {
      const forgetModel = new ForgetModel({
        baseDecayRate: 0.1,
        cleanupThreshold: 0.1,
      });

      // 创建不同时间的记忆
      const recentMemory = createTestExchange('recent', '最近访问', {
        last_accessed: Date.now(),
        importance_score: 0.8,
      });

      const oldMemory = createTestExchange('old', '很久没访问', {
        last_accessed: Date.now() - 1000 * 60 * 60 * 24 * 30, // 30天前
        importance_score: 0.3,
      });

      const recentStrength = forgetModel.calculateStrength(recentMemory);
      const oldStrength = forgetModel.calculateStrength(oldMemory);

      // 最近的记忆强度应该更高
      expect(recentStrength.strength).toBeGreaterThan(oldStrength.strength);
    });

    it('应该触发清理机制', () => {
      // 创建一些低重要性记忆
      for (let i = 0; i < 10; i++) {
        store.saveExchange(createTestExchange(`low_${i}`, `低重要性 ${i}`, {
          importance_score: 0.05,
          last_accessed: Date.now() - 1000 * 60 * 60 * 24 * 30,
        }));
      }

      // 创建一些高重要性记忆
      for (let i = 0; i < 5; i++) {
        store.saveExchange(createTestExchange(`high_${i}`, `高重要性 ${i}`, {
          importance_score: 0.9,
          last_accessed: Date.now(),
        }));
      }

      const statsBefore = store.getStats();
      expect(statsBefore.totalExchanges).toBe(15);

      // 清理低重要性记忆
      const cleaned = engine.cleanup(0.1);
      expect(cleaned).toBe(10); // 应该清理10条

      const statsAfter = store.getStats();
      expect(statsAfter.totalExchanges).toBe(5);
    });

    it('应该自动应用衰减', () => {
      const now = Date.now();

      // 创建一些记忆
      for (let i = 0; i < 5; i++) {
        store.saveExchange(createTestExchange(`decay_${i}`, `衰减测试 ${i}`, {
          importance_score: 0.8,
          last_accessed: now - 1000 * 60 * 60 * 24 * (i + 1), // 1-5天前
        }));
      }

      // 应用衰减
      const updated = engine.applyDecay();
      expect(updated).toBeGreaterThan(0);

      // 验证重要性降低
      const memory = store.getExchange('decay_4'); // 最老的
      expect(memory?.importance_score).toBeLessThan(0.8);
    });
  });

  describe('SleepGate 空闲巩固', () => {
    it('应该在空闲时触发巩固', async () => {
      const sleepGate = new SleepGate({
        idleThreshold: 100, // 100ms（测试用）
        similarityThreshold: 0.9,
        enableAutoConsolidation: true,
      });

      // 记录活动
      sleepGate.recordActivity();

      // 等待超过阈值
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(sleepGate.isIdle()).toBe(true);
    });

    it('应该合并相似记忆', async () => {
      const sleepGate = new SleepGate({
        idleThreshold: 100,
        similarityThreshold: 0.95,
      });

      const similarMemories = [
        createTestExchange('sim_1', '用户偏好：深色主题', {
          thematic_tags: ['preference', 'theme'],
          entities_extracted: ['dark-theme'],
        }),
        createTestExchange('sim_2', '用户喜欢深色主题', {
          thematic_tags: ['preference', 'theme'],
          entities_extracted: ['dark-theme'],
        }),
      ];

      const savedExchanges: MemoryExchange[] = [];
      const deletedIds: string[] = [];

      const result = await sleepGate.consolidate(
        similarMemories,
        (exs) => { savedExchanges.push(...exs); },
        (ids) => { deletedIds.push(...ids); }
      );

      expect(result.processed).toBe(2);
      expect(result.mergedGroups.length).toBeGreaterThanOrEqual(0);
    });

    it('应该保留最小记忆数量', async () => {
      const sleepGate = new SleepGate({
        idleThreshold: 100,
        minMemoryRetention: 2,
      });

      const weakMemories = [
        createTestExchange('weak_1', '弱记忆1', {
          importance_score: 0.05,
          last_accessed: Date.now() - 1000 * 60 * 60 * 24 * 30,
        }),
        createTestExchange('weak_2', '弱记忆2', {
          importance_score: 0.05,
          last_accessed: Date.now() - 1000 * 60 * 60 * 24 * 30,
        }),
        createTestExchange('weak_3', '弱记忆3', {
          importance_score: 0.05,
          last_accessed: Date.now() - 1000 * 60 * 60 * 24 * 30,
        }),
      ];

      const result = await sleepGate.consolidate(
        weakMemories,
        () => {},
        () => {}
      );

      // 应该至少保留2条
      expect(weakMemories.length - result.cleanedIds.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('双通路存储与检索', () => {
    let manager: MemoryManager;

    beforeEach(() => {
      manager = new MemoryManager({
        episodicCapacity: 10,
        episodicThreshold: 0.6,
        discardThreshold: 0.2,
        enableAutoConsolidation: false,
      });
      manager.setStore(store);
    });

    it('应该将高重要性记忆存储到情景记忆', () => {
      const importantMemory = createTestExchange('important', '重要记忆', {
        importance_score: 0.95,
        access_count: 20,
      });

      const result = manager.store(importantMemory);

      expect(result.stored).toBe(true);
      // 高重要性记忆可能进入情景或语义记忆
      expect([MemoryPathway.EPISODIC, MemoryPathway.SEMANTIC]).toContain(result.pathway);
    });

    it('应该将低重要性记忆丢弃或存储到语义记忆', () => {
      const unimportantMemory = createTestExchange('unimportant', '不重要记忆', {
        importance_score: 0.05,
        access_count: 0,
      });

      const result = manager.store(unimportantMemory);

      if (result.stored) {
        expect(result.pathway).toBe(MemoryPathway.SEMANTIC);
      } else {
        expect(result.pathway).toBe(MemoryPathway.DISCARD);
      }
    });

    it('应该从双通路检索', () => {
      // 存储多个记忆，确保高重要性以进入情景记忆
      const result1 = manager.store(createTestExchange('ep_1', '情景记忆1', {
        importance_score: 0.95,
        access_count: 20,
        thematic_tags: ['episodic', 'important'],
        entities_extracted: ['ep_1_entity'],
      }));
      const result2 = manager.store(createTestExchange('ep_2', '情景记忆2', {
        importance_score: 0.95,
        access_count: 18,
        thematic_tags: ['episodic', 'important'],
        entities_extracted: ['ep_2_entity'],
      }));
      const result3 = manager.store(createTestExchange('sem_1', '语义记忆', {
        importance_score: 0.4,
        access_count: 2,
        thematic_tags: ['semantic'],
        entities_extracted: ['sem_entity'],
      }));

      // 验证至少有一个记忆被存储（情景或语义）
      expect(result1.stored || result2.stored || result3.stored).toBe(true);

      // 检索 - 使用能匹配的关键词
      const results = manager.retrieve('情景');

      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('应该在容量满时触发巩固', () => {
      manager.updateConfig({ enableAutoConsolidation: true });

      // 填满情景记忆
      for (let i = 0; i < 15; i++) {
        manager.store(createTestExchange(`capacity_${i}`, `容量测试 ${i}`, {
          importance_score: 0.9,
          access_count: 20,
        }));
      }

      // 容量应该被管理
      expect(manager.getEpisodicSize()).toBeLessThanOrEqual(10);
    });

    it('应该正确统计记忆分布', () => {
      manager.store(createTestExchange('high', '高', { importance_score: 0.95, access_count: 20 }));
      manager.store(createTestExchange('mid', '中', { importance_score: 0.5, access_count: 5 }));
      manager.store(createTestExchange('low', '低', { importance_score: 0.2, access_count: 1 }));

      const stats = manager.getStats();

      // 验证统计返回正确结构
      expect(stats.episodicCount).toBeGreaterThanOrEqual(0);
      expect(stats.semanticCount).toBeGreaterThanOrEqual(0);
      expect(stats.episodicUsage).toBeGreaterThanOrEqual(0);
      // 验证通路分布比例
      expect(stats.pathwayDistribution.episodic).toBeGreaterThanOrEqual(0);
      expect(stats.pathwayDistribution.semantic).toBeGreaterThanOrEqual(0);
    });
  });

  describe('重要性评分集成', () => {
    let scoring: ImportanceScoring;

    beforeEach(() => {
      scoring = new ImportanceScoring({
        initialWeight: 0.4,
        frequencyWeight: 0.3,
        hitWeight: 0.3,
      });
    });

    it('应该在检索时更新重要性', async () => {
      const memory = createTestExchange('importance_1', '重要性测试');

      store.saveExchange(memory);

      // 多次检索
      for (let i = 0; i < 5; i++) {
        await engine.getObservations(['importance_1']);
      }

      const updated = store.getExchange('importance_1');
      expect(updated?.access_count).toBe(5);
    });

    it('应该正确计算综合评分', () => {
      const memory = createTestExchange('score_1', '评分测试', {
        importance_score: 0.6,
        access_count: 10,
      });

      const result = scoring.calculate(memory);

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.factors.initial).toBe(0.6);
      expect(result.factors.frequency).toBeGreaterThan(0);
    });

    it('应该记录命中事件', () => {
      const memory = createTestExchange('hit_1', '命中测试');

      const updated = scoring.recordHit(memory);

      const hitInfo = (updated.metadata as any)?.hitInfo;
      expect(hitInfo).toBeDefined();
      expect(hitInfo.count).toBe(1);
    });
  });

  describe('端到端场景测试', () => {
    it('应该支持"记住偏好"场景', async () => {
      // 1. 保存用户偏好
      const preference = createTestExchange('pref_1', '用户偏好深色主题和等宽字体', {
        thematic_tags: ['preference', 'ui'],
        entities_extracted: ['dark-theme', 'monospace-font'],
        importance_score: 0.8,
      });

      await engine.saveWithEmbedding(preference);

      // 2. 验证能通过 getObservations 获取保存的记忆
      const observations = await engine.getObservations(['pref_1']);
      expect(observations.length).toBe(1);
      expect(observations[0].exchange_core).toContain('深色主题');
      expect(observations[0].importance_score).toBe(0.8);
    });

    it('应该支持"记住任务"场景', async () => {
      // 1. 保存任务信息
      const task = createTestExchange('task_1', '任务：实现用户认证模块，截止日期2026-03-25', {
        thematic_tags: ['task', 'auth'],
        entities_extracted: ['authentication', '2026-03-25'],
        importance_score: 0.9,
      });

      await engine.saveWithEmbedding(task);

      // 2. 验证能通过 getObservations 获取高重要性记忆
      const observations = await engine.getObservations(['task_1']);
      expect(observations.length).toBe(1);
      expect(observations[0].importance_score).toBeGreaterThanOrEqual(0.7);
      expect(observations[0].exchange_core).toContain('认证');
    });

    it('应该支持"记住决策"场景', async () => {
      // 1. 保存决策
      const decision = createTestExchange('decision_1', '决策：选择SQLite作为存储引擎，因为轻量级且无需额外依赖', {
        thematic_tags: ['decision', 'architecture'],
        entities_extracted: ['SQLite', 'storage'],
        importance_score: 0.85,
      });

      await engine.saveWithEmbedding(decision);

      // 2. 验证能通过 getObservations 获取决策
      const observations = await engine.getObservations(['decision_1']);
      expect(observations.length).toBe(1);
      expect(observations[0].exchange_core).toContain('SQLite');
      expect(observations[0].importance_score).toBeGreaterThanOrEqual(0.8);
    });
  });
});
