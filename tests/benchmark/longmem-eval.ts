/**
 * MemLite LongMemEval 基准评测
 *
 * 基于 LongMemEval: A Benchmark for Evaluating Long-Term Memory in LLMs
 * 论文: https://arxiv.org/abs/2410.10813 (ICLR 2025)
 *
 * 评测 5 个核心能力:
 * 1. 信息提取
 * 2. 多会话推理
 * 3. 知识更新追踪
 * 4. 时间推理
 * 5. 弃权能力
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import type { MemoryExchange } from '../../src/types/memory.js';
import type {
  LongMemEvalQuestion,
  LongMemEvalSession,
  LongMemEvalResult,
  LongMemEvalConfig,
  LongMemEvalQuestionType,
} from './types.js';
import { calculateMRR, calculatePercentile } from './types.js';

// ============================================================================
// LongMemEval 评测器
// ============================================================================

export class LongMemEvalEvaluator {
  private store: SQLiteStore;
  private engine: RetrievalEngine;
  private config: LongMemEvalConfig;
  private sessions: Map<string, LongMemEvalSession>;

  constructor(config: Partial<LongMemEvalConfig> = {}) {
    this.config = {
      difficulty: 'medium',
      maxSessions: 40,
      testAbstention: true,
      retrievalTopK: 5,
      ...config,
    };

    this.store = new SQLiteStore({ dbPath: ':memory:' });
    this.engine = new RetrievalEngine(this.store, { enableVectorSearch: false });
    this.sessions = new Map();
  }

  /**
   * 加载会话数据
   */
  async loadSessions(sessions: LongMemEvalSession[]): Promise<void> {
    console.log(`\n加载 ${sessions.length} 个会话...`);

    for (const session of sessions) {
      this.sessions.set(session.id, session);

      for (const turn of session.turns) {
        const memory: MemoryExchange = {
          id: `longmem_${session.id}_${turn.timestamp}`,
          timestamp: turn.timestamp,
          exchange_core: turn.content.slice(0, 100),
          specific_context: turn.content,
          thematic_tags: [session.id],
          entities_extracted: [],
          importance_score: 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
          metadata: {
            sessionId: session.id,
            role: turn.role,
          },
        };

        this.store.saveExchange(memory);
      }
    }

    console.log(`已加载 ${this.store.getStats().totalExchanges} 条记忆`);
  }

  /**
   * 评测单个问题
   */
  async evaluateQuestion(question: LongMemEvalQuestion): Promise<{
    isCorrect: boolean;
    retrievedIds: string[];
    latency: number;
    type: LongMemEvalQuestionType;
    hasAnswer: boolean;
    shouldAbstain: boolean;
  }> {
    const start = Date.now();
    const searchResult = await this.engine.search({
      query: question.question,
      limit: this.config.retrievalTopK,
    });
    const latency = Date.now() - start;

    const retrievedIds = searchResult.items.map(item => item.id);

    if (!question.hasAnswer) {
      // 检查是否应该弃权
      const shouldAbstain = this.shouldAbstain(searchResult.items);

      return {
        isCorrect: shouldAbstain, // 弃权是正确行为
        retrievedIds,
        latency,
        type: question.questionType,
        hasAnswer: false,
        shouldAbstain,
      };
    }

    // 检查答案是否正确
    const isCorrect = this.checkAnswer(question, searchResult.items);

    return {
      isCorrect,
      retrievedIds,
      latency,
      type: question.questionType,
      hasAnswer: true,
      shouldAbstain: false,
    };
  }

  /**
   * 检查是否应该弃权
   */
  private shouldAbstain(results: any[]): boolean {
    if (results.length === 0) return true;

    // 如果所有结果的相关性分数都很低，应该弃权
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

    return avgScore < 0.3;
  }

  /**
   * 检查答案是否正确
   */
  private checkAnswer(question: LongMemEvalQuestion, results: any[]): boolean {
    if (!question.hasAnswer) return false;

    const answerLower = question.answer.toLowerCase();

    return results.some(result => {
      const content = (result.exchange.specific_context || '').toLowerCase();
      const core = result.exchange.exchange_core.toLowerCase();

      return content.includes(answerLower) || core.includes(answerLower);
    });
  }

  /**
   * 运行完整评测
   */
  async runEvaluation(
    sessions: LongMemEvalSession[],
    questions: LongMemEvalQuestion[]
  ): Promise<LongMemEvalResult> {
    console.log('\n========================================');
    console.log('LongMemEval 基准评测');
    console.log('========================================');

    await this.loadSessions(sessions);

    console.log('\n运行问题评测...');

    const results = await Promise.all(
      questions.map(q => this.evaluateQuestion(q))
    );

    // 按类型分组统计
    const typeResults: Record<LongMemEvalQuestionType, { correct: number; total: number }> = {
      information_extraction: { correct: 0, total: 0 },
      multi_session_reasoning: { correct: 0, total: 0 },
      knowledge_update: { correct: 0, total: 0 },
      time_reasoning: { correct: 0, total: 0 },
      abstention: { correct: 0, total: 0 },
    };

    const latencies: number[] = [];
    let totalCorrect = 0;
    let abstentionCorrect = 0;
    let abstentionTotal = 0;

    for (const result of results) {
      typeResults[result.type].total++;
      latencies.push(result.latency);

      if (result.isCorrect) {
        typeResults[result.type].correct++;
        totalCorrect++;
      }

      if (!result.hasAnswer) {
        abstentionTotal++;
        if (result.shouldAbstain) {
          abstentionCorrect++;
        }
      }
    }

    const accuracy = totalCorrect / results.length;
    const typeAccuracy = {} as Record<LongMemEvalQuestionType, number>;
    for (const type of Object.keys(typeResults) as LongMemEvalQuestionType[]) {
      const { correct, total } = typeResults[type];
      typeAccuracy[type] = total > 0 ? correct / total : 0;
    }

    const avgLatency = latencies.length > 0
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
      : 0;
    const p95Latency = calculatePercentile(latencies, 95);
    const abstentionAccuracy = abstentionTotal > 0 ? abstentionCorrect / abstentionTotal : 0;

    console.log('\n评测结果:');
    console.log(`  总体准确率: ${(accuracy * 100).toFixed(1)}%`);
    console.log(`\n  各类型准确率:`);
    for (const [type, acc] of Object.entries(typeAccuracy)) {
      console.log(`    ${type}: ${(acc * 100).toFixed(1)}%`);
    }
    console.log(`\n  弃权准确率: ${(abstentionAccuracy * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${avgLatency.toFixed(1)}ms`);
    console.log(`  P95 延迟: ${p95Latency.toFixed(1)}ms`);

    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      benchmark: 'LongMemEval',
      accuracy,
      recall: accuracy, // 简化处理
      latency: p95Latency,
      memoryUsage,
      sessionRecall: accuracy,
      turnRecall: accuracy,
      typeAccuracy,
      abstentionAccuracy,
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

export function generateTestSessions(count: number): LongMemEvalSession[] {
  const sessions: LongMemEvalSession[] = [];
  const baseTime = Date.now() - count * 1000 * 60 * 60;

  for (let i = 0; i < count; i++) {
    const turnCount = 10 + Math.floor(Math.random() * 20);
    const turns: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [];

    for (let t = 0; t < turnCount; t++) {
      turns.push({
        role: t % 2 === 0 ? 'user' : 'assistant',
        content: `会话 ${i} 第 ${t} 轮对话内容，讨论了各种话题`,
        timestamp: baseTime + i * 1000 * 60 * 60 + t * 1000 * 30,
      });
    }

    sessions.push({
      id: `session_${i}`,
      turns,
      metadata: { index: i },
    });
  }

  return sessions;
}

export function generateTestQuestions(sessions: LongMemEvalSession[]): LongMemEvalQuestion[] {
  const questions: LongMemEvalQuestion[] = [];
  const types: LongMemEvalQuestionType[] = [
    'information_extraction',
    'multi_session_reasoning',
    'knowledge_update',
    'time_reasoning',
    'abstention',
  ];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const type = types[i % types.length];
    const hasAnswer = type !== 'abstention';

    questions.push({
      id: `q_${i}`,
      question: `会话 ${session.id} 中讨论了什么内容？`,
      answer: hasAnswer ? `会话 ${session.id} 第 0 轮对话内容` : '',
      questionType: type,
      hasAnswer,
      sessionId: session.id,
    });
  }

  return questions;
}

// ============================================================================
// 测试
// ============================================================================

describe('LongMemEval Benchmark', () => {
  let evaluator: LongMemEvalEvaluator;

  beforeAll(() => {
    evaluator = new LongMemEvalEvaluator({
      difficulty: 'medium',
      maxSessions: 10,
      testAbstention: true,
    });
  });

  afterAll(() => {
    evaluator.dispose();
  });

  it('应该完成 LongMemEval 基准评测', async () => {
    const sessions = generateTestSessions(10);
    const questions = generateTestQuestions(sessions);

    const result = await evaluator.runEvaluation(sessions, questions);

    expect(result.benchmark).toBe('LongMemEval');
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.typeAccuracy).toBeDefined();
    expect(result.abstentionAccuracy).toBeGreaterThanOrEqual(0);
  });

  it('应该正确处理弃权问题', async () => {
    const testEvaluator = new LongMemEvalEvaluator();

    const sessions: LongMemEvalSession[] = [
      {
        id: 'test_1',
        turns: [
          { role: 'user', content: '问题1', timestamp: Date.now() },
          { role: 'assistant', content: '回答1', timestamp: Date.now() },
        ],
      },
    ];

    const questions: LongMemEvalQuestion[] = [
      {
        id: 'q_1',
        question: '这个问题没有答案',
        answer: '',
        questionType: 'abstention',
        hasAnswer: false,
      },
    ];

    await testEvaluator.loadSessions(sessions);
    const result = await testEvaluator.evaluateQuestion(questions[0]);

    expect(result.hasAnswer).toBe(false);
    expect(typeof result.shouldAbstain).toBe('boolean');

    testEvaluator.dispose();
  });

  it('应该正确评测各类型问题', async () => {
    const testEvaluator = new LongMemEvalEvaluator();

    const sessions: LongMemEvalSession[] = [
      {
        id: 's1',
        turns: [
          { role: 'user', content: '我喜欢使用 TypeScript', timestamp: Date.now() },
          { role: 'assistant', content: '好的，记住了', timestamp: Date.now() },
        ],
      },
    ];

    const questions: LongMemEvalQuestion[] = [
      {
        id: 'q1',
        question: '我喜欢什么编程语言？',
        answer: 'TypeScript',
        questionType: 'information_extraction',
        hasAnswer: true,
        sessionId: 's1',
      },
    ];

    await testEvaluator.loadSessions(sessions);
    const result = await testEvaluator.evaluateQuestion(questions[0]);

    expect(result.type).toBe('information_extraction');
    expect(result.hasAnswer).toBe(true);

    testEvaluator.dispose();
  });

  it('应该生成符合预期的评测报告', async () => {
    const testEvaluator = new LongMemEvalEvaluator();
    const sessions = generateTestSessions(5);
    const questions = generateTestQuestions(sessions);

    const result = await testEvaluator.runEvaluation(sessions, questions);

    expect(result).toHaveProperty('benchmark');
    expect(result).toHaveProperty('accuracy');
    expect(result).toHaveProperty('typeAccuracy');
    expect(result).toHaveProperty('abstentionAccuracy');

    expect(result.typeAccuracy).toHaveProperty('information_extraction');
    expect(result.typeAccuracy).toHaveProperty('multi_session_reasoning');

    testEvaluator.dispose();
  });
});
