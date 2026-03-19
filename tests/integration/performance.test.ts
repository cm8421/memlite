/**
 * MemLite 性能基准测试
 *
 * 测试系统性能指标：
 * - 检索延迟（P95 < 50ms）
 * - 计划创建延迟（< 20ms）
 * - 意图识别准确率（> 80%）
 * - 内存占用（< 50MB）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import { ForgetModel } from '../../src/core/ForgetModel.js';
import { ImportanceScoring } from '../../src/core/ImportanceScoring.js';
import { MemoryManager } from '../../src/core/MemoryManager.js';
import { SleepGate } from '../../src/core/SleepGate.js';
import { PlanManager } from '../../src/plan/PlanManager.js';
import { IntentDetector, IntentType } from '../../src/plan/IntentDetector.js';
import { TriggerEngine } from '../../src/plan/TriggerEngine.js';
import { ContextSnapshot, SnapshotType } from '../../src/plan/ContextSnapshot.js';
import type { MemoryExchange } from '../../src/types/memory.js';

// ============================================================================
// 性能测试辅助函数
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

function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / 1024 / 1024;
}

// ============================================================================
// 性能基准测试
// ============================================================================

describe('Performance Benchmarks', () => {
  let store: SQLiteStore;
  let engine: RetrievalEngine;
  let planManager: PlanManager;
  let intentDetector: IntentDetector;

  beforeAll(() => {
    store = new SQLiteStore({ dbPath: ':memory:' });
    engine = new RetrievalEngine(store, { enableVectorSearch: false });
    planManager = new PlanManager();
    intentDetector = new IntentDetector();
  });

  afterAll(() => {
    store.close();
  });

  // ==========================================================================
  // 检索性能测试
  // ==========================================================================

  describe('Retrieval Performance', () => {
    const TARGET_LATENCY_P95 = 50; // ms
    const TARGET_MRR = 0.7;

    beforeAll(() => {
      // 准备 10,000 条测试数据
      console.log('准备 10,000 条测试数据...');
      for (let i = 0; i < 10000; i++) {
        store.saveExchange(createTestExchange(
          `perf_${i}`,
          `性能测试记忆 ${i}：包含关键词和描述信息`,
          {
            thematic_tags: [`tag${i % 10}`, `category${i % 5}`],
            importance_score: 0.3 + Math.random() * 0.7,
          }
        ));
      }
    });

    it('检索延迟 P95 应该 < 50ms', async () => {
      const queries = ['性能', '测试', '关键词', '描述', '信息'];
      const latencies: number[] = [];

      // 预热
      for (const query of queries) {
        await engine.search({ query, limit: 20 });
      }

      // 正式测试
      for (let i = 0; i < 100; i++) {
        const query = queries[i % queries.length];
        const start = Date.now();
        await engine.search({ query, limit: 20 });
        latencies.push(Date.now() - start);
      }

      const p50 = calculatePercentile(latencies, 50);
      const p95 = calculatePercentile(latencies, 95);
      const p99 = calculatePercentile(latencies, 99);

      console.log(`检索延迟: P50=${p50}ms, P95=${p95}ms, P99=${p99}ms`);

      expect(p95).toBeLessThan(TARGET_LATENCY_P95);
    });

    it('时间线检索延迟 P95 应该 < 30ms', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 50; i++) {
        const start = Date.now();
        await engine.timeline({
          anchor: `perf_${i * 100}`,
          depth_before: 5,
          depth_after: 5,
        });
        latencies.push(Date.now() - start);
      }

      const p95 = calculatePercentile(latencies, 95);
      console.log(`时间线检索延迟 P95: ${p95}ms`);

      expect(p95).toBeLessThan(30);
    });

    it('批量获取延迟 P95 应该 < 20ms', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 50; i++) {
        const ids = Array.from({ length: 20 }, (_, j) => `perf_${i * 20 + j}`);
        const start = Date.now();
        await engine.getObservations(ids);
        latencies.push(Date.now() - start);
      }

      const p95 = calculatePercentile(latencies, 95);
      console.log(`批量获取延迟 P95: ${p95}ms`);

      expect(p95).toBeLessThan(20);
    });

    it('缓存命中率应该 > 50%（重复查询）', async () => {
      // 清除缓存统计
      engine.clearCache();
      const queries = ['性能测试', '关键词搜索', '信息检索'];

      // 第一次查询（缓存未命中）
      for (const query of queries) {
        await engine.search({ query, limit: 10 });
      }

      // 重复查询（缓存命中）
      for (let i = 0; i < 3; i++) {
        for (const query of queries) {
          await engine.search({ query, limit: 10 });
        }
      }

      const stats = engine.getStats();
      const hitRate = stats.cacheHitRate;

      console.log(`缓存命中率: ${(hitRate * 100).toFixed(1)}%`);
      expect(hitRate).toBeGreaterThan(0.5);
    });
  });

  // ==========================================================================
  // 计划管理性能测试
  // ==========================================================================

  describe('Plan Management Performance', () => {
    it('计划创建延迟应该 < 20ms', () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        planManager.createPlan(`计划${i}`, `描述${i}`);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      console.log(`计划创建: 平均=${avgLatency.toFixed(2)}ms, 最大=${maxLatency}ms`);

      expect(avgLatency).toBeLessThan(20);
    });

    it('任务添加延迟应该 < 10ms', () => {
      const plan = planManager.createPlan('任务测试', '测试');
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        planManager.addTask(plan.id, `任务${i}`);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      console.log(`任务添加平均延迟: ${avgLatency.toFixed(2)}ms`);

      expect(avgLatency).toBeLessThan(10);
    });

    it('计划搜索延迟应该 < 15ms', () => {
      // 创建 500 个计划
      for (let i = 0; i < 500; i++) {
        planManager.createPlan(`计划${i}`, `这是第${i}个计划的描述`);
      }

      const latencies: number[] = [];
      const queries = ['计划', '描述', '第'];

      for (let i = 0; i < 50; i++) {
        const query = queries[i % queries.length];
        const start = Date.now();
        planManager.searchPlans(query);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      console.log(`计划搜索平均延迟: ${avgLatency.toFixed(2)}ms`);

      expect(avgLatency).toBeLessThan(15);
    });
  });

  // ==========================================================================
  // 意图识别性能测试
  // ==========================================================================

  describe('Intent Detection Performance', () => {
    it('意图识别准确率应该 > 80%', () => {
      const testCases = [
        // 分支信号
        { text: '先做这个任务', expected: IntentType.BRANCH },
        { text: '暂停一下当前工作', expected: IntentType.BRANCH },
        { text: '切换到另一个项目', expected: IntentType.BRANCH },
        { text: '等一下，有个紧急问题', expected: IntentType.BRANCH },
        { text: '临时插入一个任务', expected: IntentType.BRANCH },
        { text: '先处理紧急Bug', expected: IntentType.BRANCH },
        { text: '打断一下', expected: IntentType.BRANCH },
        { text: '需要马上处理这个', expected: IntentType.BRANCH },

        // 回归信号
        { text: '继续之前的任务', expected: IntentType.RETURN },
        { text: '回到刚才的工作', expected: IntentType.RETURN },
        { text: '恢复暂停的计划', expected: IntentType.RETURN },
        { text: '继续主项目', expected: IntentType.RETURN },
        { text: '返回之前的工作', expected: IntentType.RETURN },
        { text: '接着做', expected: IntentType.RETURN },
        { text: '继续', expected: IntentType.RETURN },
        { text: '恢复工作', expected: IntentType.RETURN },

        // 无意图
        { text: '今天天气不错', expected: IntentType.NONE },
        { text: '随机文本没有关键词', expected: IntentType.NONE },
        { text: '这是一段普通的话', expected: IntentType.NONE },
        { text: 'hello world', expected: IntentType.NONE },
      ];

      let correct = 0;
      const results: Array<{ text: string; expected: string; actual: string; confidence: number }> = [];

      for (const { text, expected } of testCases) {
        const result = intentDetector.detect(text);
        const actual = result.type;
        const isCorrect = actual === expected;

        if (isCorrect) correct++;

        results.push({
          text,
          expected,
          actual,
          confidence: result.confidence,
        });
      }

      const accuracy = correct / testCases.length;
      console.log(`\n意图识别准确率: ${(accuracy * 100).toFixed(1)}% (${correct}/${testCases.length})`);

      // 打印错误案例
      const errors = results.filter(r => r.expected !== r.actual);
      if (errors.length > 0) {
        console.log('\n错误案例:');
        for (const error of errors) {
          console.log(`  "${error.text}" - 期望: ${error.expected}, 实际: ${error.actual} (${(error.confidence * 100).toFixed(0)}%)`);
        }
      }

      expect(accuracy).toBeGreaterThanOrEqual(0.8);
    });

    it('意图识别延迟应该 < 5ms', () => {
      const queries = [
        '先做这个',
        '继续之前的工作',
        '随机文本',
        '暂停任务',
        '恢复计划',
      ];

      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const query = queries[i % queries.length];
        const start = Date.now();
        intentDetector.detect(query);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      console.log(`意图识别平均延迟: ${avgLatency.toFixed(2)}ms`);

      expect(avgLatency).toBeLessThan(5);
    });
  });

  // ==========================================================================
  // 内存占用测试
  // ==========================================================================

  describe('Memory Usage', () => {
    const TARGET_MEMORY_MB = 50;

    it('内存占用应该 < 50MB', () => {
      const initialMemory = getMemoryUsageMB();

      // 创建大量数据
      const testStore = new SQLiteStore({ dbPath: ':memory:' });
      for (let i = 0; i < 5000; i++) {
        testStore.saveExchange(createTestExchange(
          `mem_${i}`,
          `内存测试记忆 ${i}：这是一段较长的内容，用于测试内存占用情况`
        ));
      }

      const finalMemory = getMemoryUsageMB();
      const memoryIncrease = finalMemory - initialMemory;

      console.log(`\n内存占用:`);
      console.log(`  初始: ${initialMemory.toFixed(1)} MB`);
      console.log(`  最终: ${finalMemory.toFixed(1)} MB`);
      console.log(`  增量: ${memoryIncrease.toFixed(1)} MB`);

      testStore.close();

      expect(finalMemory).toBeLessThan(TARGET_MEMORY_MB);
    });

    it('遗忘清理应该释放内存', () => {
      const testStore = new SQLiteStore({ dbPath: ':memory:' });

      // 创建低重要性记忆
      for (let i = 0; i < 1000; i++) {
        testStore.saveExchange(createTestExchange(
          `cleanup_${i}`,
          `待清理记忆 ${i}`,
          { importance_score: 0.05 }
        ));
      }

      const beforeStats = testStore.getStats();
      const beforeCount = beforeStats.totalExchanges;

      // 清理
      testStore.cleanupLowImportance(0.1);

      const afterStats = testStore.getStats();
      const afterCount = afterStats.totalExchanges;

      console.log(`\n清理效果:`);
      console.log(`  清理前: ${beforeCount} 条记录`);
      console.log(`  清理后: ${afterCount} 条记录`);
      console.log(`  清理率: ${((1 - afterCount / beforeCount) * 100).toFixed(1)}%`);

      testStore.close();

      expect(afterCount).toBeLessThan(beforeCount);
    });
  });

  // ==========================================================================
  // 并发性能测试
  // ==========================================================================

  describe('Concurrency Performance', () => {
    it('应该支持并发读取', async () => {
      // 准备数据
      for (let i = 0; i < 100; i++) {
        store.saveExchange(createTestExchange(`concurrent_${i}`, `并发测试 ${i}`));
      }

      const concurrentQueries = 10;
      const queriesPerThread = 10;

      const start = Date.now();
      const promises = Array.from({ length: concurrentQueries }, async (_, threadId) => {
        for (let i = 0; i < queriesPerThread; i++) {
          await engine.search({
            query: `并发测试 ${threadId * queriesPerThread + i}`,
            limit: 10,
          });
        }
      });

      await Promise.all(promises);
      const duration = Date.now() - start;

      const totalQueries = concurrentQueries * queriesPerThread;
      const qps = (totalQueries / duration) * 1000;

      console.log(`\n并发性能:`);
      console.log(`  总查询数: ${totalQueries}`);
      console.log(`  总耗时: ${duration}ms`);
      console.log(`  QPS: ${qps.toFixed(1)}`);

      expect(qps).toBeGreaterThan(50); // 至少 50 QPS
    });

    it('应该支持并发写入', async () => {
      const concurrentWrites = 10;
      const writesPerThread = 10;

      const start = Date.now();
      const promises = Array.from({ length: concurrentWrites }, async (_, threadId) => {
        for (let i = 0; i < writesPerThread; i++) {
          const memory = createTestExchange(
            `write_${threadId}_${i}`,
            `并发写入测试 ${threadId}-${i}`
          );
          store.saveExchange(memory);
        }
      });

      await Promise.all(promises);
      const duration = Date.now() - start;

      const totalWrites = concurrentWrites * writesPerThread;
      const wps = (totalWrites / duration) * 1000;

      console.log(`\n并发写入:`);
      console.log(`  总写入数: ${totalWrites}`);
      console.log(`  总耗时: ${duration}ms`);
      console.log(`  WPS: ${wps.toFixed(1)}`);

      expect(wps).toBeGreaterThan(100); // 至少 100 WPS
    });
  });

  // ==========================================================================
  // 压力测试
  // ==========================================================================

  describe('Stress Tests', () => {
    it('应该处理大量数据（50,000条）', async () => {
      const testStore = new SQLiteStore({ dbPath: ':memory:' });
      const batchSize = 1000;
      const totalRecords = 50000;

      console.log(`\n压力测试: 插入 ${totalRecords} 条记录`);

      const start = Date.now();
      for (let batch = 0; batch < totalRecords / batchSize; batch++) {
        const exchanges: MemoryExchange[] = [];
        for (let i = 0; i < batchSize; i++) {
          exchanges.push(createTestExchange(
            `stress_${batch}_${i}`,
            `压力测试记录 ${batch}-${i}`
          ));
        }
        testStore.saveExchanges(exchanges);

        if ((batch + 1) % 10 === 0) {
          console.log(`  已插入: ${(batch + 1) * batchSize} 条`);
        }
      }
      const insertDuration = Date.now() - start;

      const stats = testStore.getStats();
      console.log(`\n插入完成:`);
      console.log(`  总耗时: ${insertDuration}ms`);
      console.log(`  平均速度: ${(totalRecords / insertDuration * 1000).toFixed(0)} 条/秒`);
      console.log(`  实际记录: ${stats.totalExchanges}`);

      // 测试检索性能
      const searchStart = Date.now();
      for (let i = 0; i < 10; i++) {
        await engine.search({ query: `压力测试`, limit: 20 });
      }
      const searchDuration = Date.now() - searchStart;

      console.log(`\n检索性能 (10次):`);
      console.log(`  总耗时: ${searchDuration}ms`);
      console.log(`  平均延迟: ${(searchDuration / 10).toFixed(1)}ms`);

      testStore.close();

      expect(stats.totalExchanges).toBe(totalRecords);
    });

    it('应该处理长查询字符串', async () => {
      const longQuery = '测试'.repeat(500); // 1000字符

      const start = Date.now();
      const result = await engine.search({ query: longQuery, limit: 10 });
      const duration = Date.now() - start;

      console.log(`\n长查询测试:`);
      console.log(`  查询长度: ${longQuery.length} 字符`);
      console.log(`  延迟: ${duration}ms`);

      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // 综合性能报告
  // ==========================================================================

  describe('Performance Summary', () => {
    it('生成性能报告', () => {
      console.log('\n========================================');
      console.log('MemLite 性能基准测试报告');
      console.log('========================================');
      console.log(`\n测试时间: ${new Date().toISOString()}`);
      console.log(`Node.js: ${process.version}`);
      console.log(`平台: ${process.platform}`);
      console.log(`内存: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`);
      console.log('\n----------------------------------------');
      console.log('目标指标:');
      console.log('  - 检索延迟 P95: < 50ms');
      console.log('  - 计划创建延迟: < 20ms');
      console.log('  - 意图识别准确率: > 80%');
      console.log('  - 内存占用: < 50MB');
      console.log('----------------------------------------');
    });
  });
});
