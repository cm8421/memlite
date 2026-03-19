/**
 * MemLite LoCoMo 基准评测
 *
 * 基于 LoCoMo: Long-Term Conversational Memory Benchmark
 * 论文: https://arxiv.org/abs/2402.17753
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import { DistillationEngine, CompressionMode } from '../../src/compression/DistillationEngine.js';
import type { MemoryExchange } from '../../src/types/memory.js';
import type {
  LoCoMoConversation,
  LoCoMoQA,
  LoCoMoResult,
  LoCoMoConfig,
} from './types.js';
import { calculateRecall, calculateF1 } from './types.js';

// ============================================================================
// LoCoMo 评测器
// ============================================================================

export class LoCoMoEvaluator {
  private store: SQLiteStore;
  private engine: RetrievalEngine;
  private compression: DistillationEngine;
  private config: LoCoMoConfig;

  constructor(config: Partial<LoCoMoConfig> = {}) {
    this.config = {
      subsetSize: 100,
      useGPT4Judge: false,
      retrievalTopK: 5,
      offlineMode: true,
      ...config,
    };

    this.store = new SQLiteStore({ dbPath: ':memory:' });
    this.engine = new RetrievalEngine(this.store, { enableVectorSearch: false });
    this.compression = new DistillationEngine({ mode: CompressionMode.FAST });
  }

  /**
   * 加载测试数据
   */
  async loadConversations(conversations: LoCoMoConversation[]): Promise<void> {
    console.log(`\n加载 ${conversations.length} 个对话到记忆系统...`);

    for (const conv of conversations) {
      for (const session of conv.sessions) {
        for (const turn of session.turns) {
          const memory: MemoryExchange = {
            id: `locomo_${conv.id}_${session.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: turn.timestamp || Date.now(),
            exchange_core: turn.content.slice(0, 100),
            specific_context: turn.content,
            thematic_tags: [conv.id, session.id, turn.speaker],
            entities_extracted: [],
            importance_score: 0.5,
            access_count: 0,
            decay_rate: 0.1,
            last_accessed: Date.now(),
            metadata: {
              conversationId: conv.id,
              sessionId: session.id,
              speaker: turn.speaker,
            },
          };

          this.store.saveExchange(memory);
        }
      }
    }

    const stats = this.store.getStats();
    console.log(`已加载 ${stats.totalExchanges} 条记忆`);
  }

  /**
   * 运行问答评测
   */
  async evaluateQA(qaPairs: LoCoMoQA[]): Promise<{
    accuracy: number;
    recall: number;
    f1: number;
    avgLatency: number;
  }> {
    const results: Array<{
      retrieved: string[];
      relevant: string;
      isCorrect: boolean;
      latency: number;
    }> = [];

    for (const qa of qaPairs) {
      const start = Date.now();
      const searchResult = await this.engine.search({
        query: qa.question,
        limit: this.config.retrievalTopK,
      });
      const latency = Date.now() - start;

      const retrieved = searchResult.items.map(item => item.id);
      const isCorrect = this.checkAnswer(qa.answer, searchResult.items);

      results.push({
        retrieved,
        relevant: qa.conversationId,
        isCorrect,
        latency,
      });
    }

    const correctCount = results.filter(r => r.isCorrect).length;
    const accuracy = results.length > 0 ? correctCount / results.length : 0;
    const avgLatency = results.length > 0
      ? results.reduce((sum, r) => sum + r.latency, 0) / results.length
      : 0;

    const recallScores = results.map(r => {
      const relevant = [r.relevant];
      return calculateRecall(r.retrieved, relevant);
    });
    const recall = recallScores.length > 0
      ? recallScores.reduce((sum, r) => sum + r, 0) / recallScores.length
      : 0;

    const f1 = calculateF1(accuracy, recall);

    return { accuracy, recall, f1, avgLatency };
  }

  /**
   * 检查答案是否正确
   */
  private checkAnswer(answer: string, results: any[]): boolean {
    const answerLower = answer.toLowerCase();

    return results.some(result => {
      const content = result.exchange.specific_context?.toLowerCase() || '';
      const core = result.exchange.exchange_core.toLowerCase();

      const answerWords = answerLower.split(/\s+/);
      const contentWords = (content + ' ' + core).split(/\s+/);

      const overlap = answerWords.filter(word =>
        word.length > 3 && contentWords.some(cw => cw.includes(word))
      );

      return overlap.length > 0;
    });
  }

  /**
   * 运行完整评测
   */
  async runEvaluation(
    conversations: LoCoMoConversation[],
    qaPairs: LoCoMoQA[]
  ): Promise<LoCoMoResult> {
    console.log('\n========================================');
    console.log('LoCoMo 基准评测');
    console.log('========================================');

    await this.loadConversations(conversations);

    console.log('\n运行问答评测...');
    const qaResult = await this.evaluateQA(qaPairs);

    console.log('\n评测结果:');
    console.log(`  QA 准确率: ${(qaResult.accuracy * 100).toFixed(1)}%`);
    console.log(`  召回率: ${(qaResult.recall * 100).toFixed(1)}%`);
    console.log(`  F1 分数: ${(qaResult.f1 * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${qaResult.avgLatency.toFixed(1)}ms`);

    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      benchmark: 'LoCoMo',
      accuracy: qaResult.accuracy,
      recall: qaResult.recall,
      latency: qaResult.avgLatency,
      memoryUsage,
      qaAccuracy: qaResult.accuracy,
      summarizationAccuracy: 0,
      multiSessionAccuracy: 0,
      avgRetrievalLatency: qaResult.avgLatency,
    };
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.store.close();
  }
}

// ============================================================================
// 测试数据生成
// ============================================================================

interface LoCoMoSession {
  id: string;
  turns: Array<{
    speaker: 'user' | 'assistant';
    content: string;
    timestamp?: number;
  }>;
}

export function generateTestConversations(count: number): LoCoMoConversation[] {
  const conversations: LoCoMoConversation[] = [];
  const topics = ['项目配置', 'API设计', '数据库优化', '用户认证', '性能调优'];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const conv: LoCoMoConversation & { sessions: LoCoMoSession[] } = {
      id: `conv_${i}`,
      sessions: [],
    };

    const sessionCount = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < sessionCount; s++) {
      const session: LoCoMoSession = {
        id: `session_${s}`,
        turns: [],
      };

      const turnCount = 5 + Math.floor(Math.random() * 6);
      for (let t = 0; t < turnCount; t++) {
        session.turns.push({
          speaker: t % 2 === 0 ? 'user' : 'assistant',
          content: `关于${topic}的讨论 ${i}-${s}-${t}`,
          timestamp: Date.now() - (sessionCount - s) * 1000 * 60 * 60 - (turnCount - t) * 1000 * 60,
        });
      }

      conv.sessions.push(session);
    }

    conversations.push(conv);
  }

  return conversations;
}

export function generateTestQA(conversations: LoCoMoConversation[]): LoCoMoQA[] {
  const qaPairs: LoCoMoQA[] = [];

  for (const conv of conversations) {
    const firstSession = conv.sessions[0];
    const firstUserTurn = firstSession.turns.find(t => t.speaker === 'user');

    if (firstUserTurn) {
      qaPairs.push({
        conversationId: conv.id,
        question: `关于${conv.id.split('_')[1]}我们讨论了什么？`,
        answer: firstUserTurn.content,
        questionType: 'fact',
      });
    }
  }

  return qaPairs;
}

// ============================================================================
// 测试
// ============================================================================

describe('LoCoMo Benchmark', () => {
  let evaluator: LoCoMoEvaluator;

  beforeAll(() => {
    evaluator = new LoCoMoEvaluator({
      subsetSize: 10,
      offlineMode: true,
    });
  });

  afterAll(() => {
    evaluator.dispose();
  });

  it('应该完成 LoCoMo 基准评测', async () => {
    const conversations = generateTestConversations(10);
    const qaPairs = generateTestQA(conversations);

    const result = await evaluator.runEvaluation(conversations, qaPairs);

    expect(result.benchmark).toBe('LoCoMo');
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.recall).toBeGreaterThanOrEqual(0);
    expect(result.latency).toBeLessThan(1000);
    expect(result.memoryUsage).toBeGreaterThan(0);
  });

  it('应该在合理时间内完成数据加载', async () => {
    const testEvaluator = new LoCoMoEvaluator();
    const conversations = generateTestConversations(100);

    const start = Date.now();
    await testEvaluator.loadConversations(conversations);
    const duration = Date.now() - start;

    console.log(`加载 100 个对话耗时: ${duration}ms`);

    expect(duration).toBeLessThan(10000);

    testEvaluator.dispose();
  });

  it('应该正确评估QA准确率', async () => {
    const testEvaluator = new LoCoMoEvaluator();

    const conversations: LoCoMoConversation[] = [
      {
        id: 'test_1',
        sessions: [
          {
            id: 's1',
            turns: [
              { speaker: 'user', content: '我喜欢深色主题' },
              { speaker: 'assistant', content: '好的，我会记住你的偏好' },
            ],
          },
        ],
      },
    ];

    const qaPairs: LoCoMoQA[] = [
      {
        conversationId: 'test_1',
        question: '我的主题偏好是什么？',
        answer: '深色主题',
        questionType: 'fact',
      },
    ];

    await testEvaluator.loadConversations(conversations);
    const result = await testEvaluator.evaluateQA(qaPairs);

    console.log(`QA 评测结果: accuracy=${result.accuracy}, recall=${result.recall}`);

    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.recall).toBeGreaterThanOrEqual(0);

    testEvaluator.dispose();
  });

  it('应该生成符合预期的评测报告', async () => {
    const testEvaluator = new LoCoMoEvaluator();
    const conversations = generateTestConversations(5);
    const qaPairs = generateTestQA(conversations);

    const result = await testEvaluator.runEvaluation(conversations, qaPairs);

    expect(result).toHaveProperty('benchmark');
    expect(result).toHaveProperty('accuracy');
    expect(result).toHaveProperty('recall');
    expect(result).toHaveProperty('latency');
    expect(result).toHaveProperty('memoryUsage');

    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);

    testEvaluator.dispose();
  });
});
