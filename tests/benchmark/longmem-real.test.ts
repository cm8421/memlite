/**
 * LongMemEval 真实数据集评测
 *
 * 基于 LongMemEval: Benchmarking Chat Assistants on Long-Term Memory
 * 论文: https://arxiv.org/abs/2410.10813 (ICLR 2025)
 * 数据集: https://github.com/xiaowu0162/LongMemEval
 * HuggingFace: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import { GTEEmbedding } from '../../src/embedding/GTEEmbedding.js';
import { DistillationEngine, CompressionMode } from '../../src/compression/DistillationEngine.js';
import type { MemoryExchange } from '../../src/types/memory.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { extractKeywords, isAnswerRetrieved } from './utils/keyword-extractor.js';

// ============================================================================
// 类型定义 (基于 LongMemEval 实际数据格式)
// ============================================================================

interface LongMemEvalMessage {
  role: 'user' | 'assistant';
  content: string;
  has_answer?: boolean;
}

// session 是消息数组的数组
type LongMemEvalSession = LongMemEvalMessage[];

interface LongMemEvalQuestion {
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  question_date: string;
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: LongMemEvalSession[];  // 消息数组的数组
  answer_session_ids: string[];
}

interface LongMemEvalResult {
  benchmark: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  avgLatency: number;
  memoryUsage: number;
  typeAccuracy: Record<string, { correct: number; total: number }>;
}

// ============================================================================
// LongMemEval 真实数据评测器
// ============================================================================

class LongMemEvalBenchmark {
  private store: SQLiteStore;
  private engine: RetrievalEngine;
  private compression: DistillationEngine;
  private embedding: GTEEmbedding | null = null;
  private questions: LongMemEvalQuestion[] = [];
  private sessionsLoaded = false;

  constructor() {
    this.store = new SQLiteStore({ dbPath: ':memory:' });
    // Phase 4.6.1: 启用向量搜索
    this.engine = new RetrievalEngine(this.store, { enableVectorSearch: true });
    this.compression = new DistillationEngine({ mode: CompressionMode.FAST });
  }

  /**
   * 初始化嵌入模型
   */
  async initializeEmbedding(): Promise<boolean> {
    try {
      // 检查模型文件是否存在
      const modelPath = join(process.cwd(), 'models/gte-small-int8');
      const modelFile = join(modelPath, 'model.onnx');

      if (!existsSync(modelFile)) {
        console.log('⚠️  GTE 模型未下载，向量搜索不可用');
        console.log('请运行: ./scripts/download-models.sh');
        return false;
      }

      this.embedding = new GTEEmbedding({ modelPath });
      await this.embedding.initialize();
      this.engine.setEmbedding(this.embedding);
      console.log('✅ GTE 嵌入模型已初始化');
      return true;
    } catch (error) {
      console.warn('⚠️  嵌入模型初始化失败:', error);
      return false;
    }
  }

  /**
   * 加载真实数据集
   */
  loadDataset(dataPath: string): boolean {
    if (!existsSync(dataPath)) {
      console.log(`❌ 数据集文件不存在: ${dataPath}`);
      return false;
    }

    try {
      const content = readFileSync(dataPath, 'utf-8');
      const data = JSON.parse(content);

      // 数据是问题数组格式
      if (Array.isArray(data)) {
        this.questions = data;
      } else if (data.questions) {
        this.questions = data.questions;
      } else {
        console.log(`❌ 未知的数据格式`);
        return false;
      }

      console.log(`✅ 加载了 ${this.questions.length} 个 LongMemEval 问题`);
      return true;
    } catch (error) {
      console.error(`❌ 加载数据集失败: ${error}`);
      return false;
    }
  }

  /**
   * 加载会话到记忆系统（只加载第一个问题的会话用于快速测试）
   * Phase 4.6.1: 添加嵌入生成支持
   */
  async loadSessions(limit: number = 10): Promise<void> {
    if (this.sessionsLoaded) return;

    console.log(`\n加载会话到记忆系统 (前 ${limit} 个问题)...`);

    let totalEvents = 0;
    let sessionIdx = 0;
    let totalWithEmbedding = 0;

    // 只加载前 N 个问题的会话数据
    for (let qIdx = 0; qIdx < Math.min(limit, this.questions.length); qIdx++) {
      const question = this.questions[qIdx];

      for (let sIdx = 0; sIdx < question.haystack_sessions.length; sIdx++) {
        const session = question.haystack_sessions[sIdx];
        const sessionId = question.haystack_session_ids[sIdx] || `session_${qIdx}_${sIdx}`;
        const sessionDate = question.haystack_dates[sIdx] || question.question_date;

        // 批量收集记忆
        const memories: MemoryExchange[] = [];

        // session 是消息数组
        for (let i = 0; i < session.length; i++) {
          const message = session[i];
          const fullContent = message.content;

          const memory: MemoryExchange = {
            id: `${sessionId}_${i}`,
            timestamp: new Date(sessionDate).getTime() + i * 1000,
            exchange_core: fullContent.slice(0, 500),  // 扩展到 500 字符以保留更多上下文
            specific_context: fullContent,  // 保留完整内容
            thematic_tags: [message.role, sessionId],
            entities_extracted: [],
            importance_score: message.role === 'user' ? 0.7 : 0.5,
            access_count: 0,
            decay_rate: 0.1,
            last_accessed: Date.now(),
          };

          memories.push(memory);
          totalEvents++;
        }

        // 批量保存记忆
        this.store.saveExchanges(memories);

        // 生成嵌入（如果模型可用）
        if (this.embedding) {
          const texts = memories.map(m => `${m.exchange_core} ${m.specific_context}`);
          try {
            const embeddings = await this.embedding.generateBatchEmbeddings(texts);
            for (let i = 0; i < memories.length; i++) {
              this.store.saveEmbedding(memories[i].id, embeddings[i]);
              totalWithEmbedding++;
            }
          } catch (error) {
            console.warn(`嵌入生成失败: ${error}`);
          }
        }

        sessionIdx++;
      }
    }

    const stats = this.store.getStats();
    console.log(`✅ 已加载 ${stats.totalExchanges} 条记忆 (${sessionIdx} 个会话, ${totalEvents} 个事件)`);
    if (this.embedding && totalWithEmbedding > 0) {
      console.log(`✅ 已生成 ${totalWithEmbedding} 个嵌入向量`);
    }
    this.sessionsLoaded = true;
  }

  /**
   * 计算两个文本的余弦相似度
   */
  private async computeSimilarity(text1: string, text2: string): Promise<number> {
    if (!this.embedding) return 0;

    try {
      const emb1 = await this.embedding.generateEmbedding(text1);
      const emb2 = await this.embedding.generateEmbedding(text2);

      // 余弦相似度
      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let i = 0; i < emb1.length; i++) {
        dotProduct += emb1[i] * emb2[i];
        norm1 += emb1[i] * emb1[i];
        norm2 += emb2[i] * emb2[i];
      }

      return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    } catch {
      return 0;
    }
  }

  /**
   * 评估单个问题
   */
  private async evaluateQuestion(question: LongMemEvalQuestion): Promise<{
    isCorrect: boolean;
    latency: number;
    semanticScore: number;
  }> {
    const start = Date.now();

    const searchResult = await this.engine.search({
      query: question.question,
      limit: 5,
    });

    const latency = Date.now() - start;

    // 使用语义相似度评估
    const SEMANTIC_THRESHOLD = 0.5;
    let isCorrect = false;
    let bestSemanticScore = 0;

    if (this.embedding && searchResult.items.length > 0) {
      // 计算答案与检索内容的语义相似度
      for (const item of searchResult.items) {
        const content = `${item.exchange.exchange_core} ${item.exchange.specific_context}`;
        const similarity = await this.computeSimilarity(question.answer, content);

        if (similarity > bestSemanticScore) {
          bestSemanticScore = similarity;
        }

        // 如果语义相似度超过阈值，认为匹配成功
        if (similarity >= SEMANTIC_THRESHOLD) {
          isCorrect = true;
          break;
        }
      }
    } else {
      // 如果没有嵌入模型，回退到关键词匹配
      isCorrect = searchResult.items.some(item => {
        const content = (item.exchange.specific_context || '').toLowerCase();
        const core = item.exchange.exchange_core.toLowerCase();
        return isAnswerRetrieved(question.answer, content + ' ' + core);
      });
      bestSemanticScore = isCorrect ? 1 : 0;
    }

    return { isCorrect, latency, semanticScore: bestSemanticScore };
  }

  /**
   * 运行评测（只评测已加载会话的问题）
   */
  async evaluate(): Promise<LongMemEvalResult> {
    console.log('\n运行 LongMemEval 评测...');

    const typeResults: Record<string, { correct: number; total: number }> = {};

    let totalCorrect = 0;
    let totalQuestions = 0;
    let totalLatency = 0;
    let totalSemanticScore = 0;

    // 只评测前 10 个问题（因为我们只加载了前 10 个问题的会话）
    const questionsToEvaluate = this.questions.slice(0, 10);

    for (const question of questionsToEvaluate) {
      const result = await this.evaluateQuestion(question);

      totalQuestions++;
      totalLatency += result.latency;
      totalSemanticScore += result.semanticScore;

      if (result.isCorrect) {
        totalCorrect++;
      }

      // 统计分类
      const type = question.question_type;
      if (!typeResults[type]) {
        typeResults[type] = { correct: 0, total: 0 };
      }
      typeResults[type].total++;
      if (result.isCorrect) {
        typeResults[type].correct++;
      }
    }

    const accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
    const avgLatency = totalQuestions > 0 ? totalLatency / totalQuestions : 0;
    const avgSemanticScore = totalQuestions > 0 ? totalSemanticScore / totalQuestions : 0;

    console.log(`\n评测结果 (语义相似度阈值: 0.5):`);
    console.log(`  总问题数: ${totalQuestions}`);
    console.log(`  正确回答: ${totalCorrect}`);
    console.log(`  准确率: ${(accuracy * 100).toFixed(1)}%`);
    console.log(`  平均语义相似度: ${(avgSemanticScore * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${avgLatency.toFixed(1)}ms`);

    console.log(`\n  各类型准确率:`);
    for (const [type, stats] of Object.entries(typeResults)) {
      const rate = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : '0.0';
      console.log(`    ${type}: ${stats.correct}/${stats.total} (${rate}%)`);
    }

    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      benchmark: 'LongMemEval',
      totalQuestions,
      correctAnswers: totalCorrect,
      accuracy,
      avgLatency,
      memoryUsage,
      typeAccuracy: typeResults,
    };
  }

  dispose(): void {
    this.store.close();
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('LongMemEval Real Benchmark', () => {
  let benchmark: LongMemEvalBenchmark;
  let datasetLoaded = false;
  let embeddingInitialized = false;

  beforeAll(async () => {
    benchmark = new LongMemEvalBenchmark();

    // 尝试加载真实数据集 - 支持多种可能的文件名
    const possiblePaths = [
      join(process.cwd(), 'data/benchmarks/longmemeval_oracle.json'),
      join(process.cwd(), 'data/benchmarks/longmemeval_s.json'),
      join(process.cwd(), 'data/benchmarks/longmemeval_m.json'),
    ];

    for (const dataPath of possiblePaths) {
      if (benchmark.loadDataset(dataPath)) {
        datasetLoaded = true;
        break;
      }
    }

    if (!datasetLoaded) {
      console.log('\n⚠️  LongMemEval 数据集未下载，跳过真实数据评测');
      console.log('请运行以下命令下载数据集:');
      console.log('  ./scripts/download-benchmarks.sh');
      console.log('');
      console.log('或使用 HF 镜像:');
      console.log('  curl -L -o data/benchmarks/longmemeval_oracle.json \\');
      console.log('    https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json');
    } else {
      // 尝试初始化嵌入模型
      embeddingInitialized = await benchmark.initializeEmbedding();
    }
  });

  afterAll(() => {
    benchmark.dispose();
  });

  // 动态跳过测试
  it('应该完成 LongMemEval 评测', async () => {
    if (!datasetLoaded) {
      console.log('⏭️  跳过评测 (数据集未加载)');
      return;
    }

    if (embeddingInitialized) {
      console.log('📊 使用混合检索模式 (向量 + BM25)');
    } else {
      console.log('📊 使用 BM25 检索模式 (向量搜索不可用)');
    }

    await benchmark.loadSessions(10);
    const result = await benchmark.evaluate();

    expect(result.benchmark).toBe('LongMemEval');
    expect(result.totalQuestions).toBeGreaterThan(0);
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.avgLatency).toBeLessThan(1000);

    // 输出详细报告
    console.log('\n========================================');
    console.log('LongMemEval 真实数据集评测报告');
    console.log('========================================');
    console.log(`向量搜索: ${embeddingInitialized ? '✅ 已启用' : '❌ 未启用'}`);
    console.log(`准确率: ${(result.accuracy * 100).toFixed(1)}%`);
    console.log(`平均延迟: ${result.avgLatency.toFixed(1)}ms`);
    console.log(`内存占用: ${result.memoryUsage.toFixed(1)} MB`);
    console.log('========================================');
  });
});
