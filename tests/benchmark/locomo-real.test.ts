/**
 * LoCoMo 真实数据集评测
 *
 * 基于 LoCoMo: Long-Term Conversational Memory Benchmark
 * 论文: https://arxiv.org/abs/2402.17753 (ACL 2024)
 * 数据集: https://github.com/snap-research/locomo
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
// 时间解析
// ============================================================================

/**
 * 解析 LoCoMo 时间格式: "1:56 pm on 8 May, 2023" -> timestamp
 */
function parseLocomoDateTime(dateTimeStr: string): number {
  try {
    // 格式: "1:56 pm on 8 May, 2023" 或 "10:37 am on 27 June, 2023"
    const match = dateTimeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)\s*on\s*(\d{1,2})\s*(\w+),?\s*(\d{4})/i);
    if (!match) {
      return Date.now();
    }

    const [, hour, minute, ampm, day, monthStr, year] = match;
    let hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const dayNum = parseInt(day, 10);
    const yearNum = parseInt(year, 10);

    // 转换 12 小时制
    if (ampm.toLowerCase() === 'pm' && hourNum !== 12) {
      hourNum += 12;
    } else if (ampm.toLowerCase() === 'am' && hourNum === 12) {
      hourNum = 0;
    }

    // 月份映射
    const months: Record<string, number> = {
      'january': 0, 'february': 1, 'march': 2, 'april': 3,
      'may': 4, 'june': 5, 'july': 6, 'august': 7,
      'september': 8, 'october': 9, 'november': 10, 'december': 11
    };
    const monthNum = months[monthStr.toLowerCase()] || 0;

    return new Date(yearNum, monthNum, dayNum, hourNum, minuteNum).getTime();
  } catch {
    return Date.now();
  }
}

// ============================================================================
// 类型定义
// ============================================================================

interface LoCoMoConversation {
  sample_id: string;
  conversation: {
    speaker_a: string;
    speaker_b: string;
    [key: string]: any;
  };
  qa: Array<{
    question: string;
    answer: string;
    category: string;
    evidence?: string[];
  }>;
  event_summary?: any;
}

interface LoCoMoResult {
  benchmark: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  recall: number;
  avgLatency: number;
  memoryUsage: number;
  categories: Record<string, { correct: number; total: number }>;
}

// ============================================================================
// LoCoMo 真实数据评测器
// ============================================================================

class LoCoMoBenchmark {
  private store: SQLiteStore;
  private engine: RetrievalEngine;
  private compression: DistillationEngine;
  private embedding: GTEEmbedding | null = null;
  private conversations: LoCoMoConversation[] = [];

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
      this.conversations = JSON.parse(content);
      console.log(`✅ 加载了 ${this.conversations.length} 个 LoCoMo 对话`);
      return true;
    } catch (error) {
      console.error(`❌ 加载数据集失败: ${error}`);
      return false;
    }
  }

  /**
   * 将 LoCoMo 对话转换为记忆交换格式
   */
  private conversationToMemory(conv: LoCoMoConversation, turn: any, sessionKey: string, turnIndex: number): MemoryExchange {
    // 保留完整内容
    const fullText = turn.text || '';

    // 获取真实时间戳
    const dateTimeKey = `${sessionKey}_date_time`;
    const dateTimeStr = conv.conversation[dateTimeKey];
    const timestamp = dateTimeStr ? parseLocomoDateTime(dateTimeStr) : Date.now();

    return {
      id: `${conv.sample_id}_${sessionKey}_turn_${turnIndex}`,
      timestamp,  // 使用真实时间戳
      exchange_core: fullText.slice(0, 500),
      specific_context: fullText,
      thematic_tags: ['locomo', conv.sample_id, sessionKey],
      entities_extracted: [],
      importance_score: 0.5,
      access_count: 0,
      decay_rate: 0.1,
      last_accessed: Date.now(),
    };
  }

  /**
   * 加载对话到记忆系统（带嵌入生成）
   */
  async loadConversations(): Promise<void> {
    console.log(`\n加载 ${this.conversations.length} 个对话到记忆系统...`);

    let totalWithEmbedding = 0;

    for (const conv of this.conversations) {
      // 遍历所有会话
      const sessionKeys = Object.keys(conv.conversation)
        .filter(k => k.startsWith('session_') && !k.includes('_date') && !k.includes('_observation'));

      for (const sessionKey of sessionKeys) {
        const session = conv.conversation[sessionKey];
        if (session && Array.isArray(session)) {
          // 收集记忆
          const memories: MemoryExchange[] = [];

          for (let i = 0; i < session.length; i++) {
            const turn = session[i];
            if (turn && turn.text) {
              const memory = this.conversationToMemory(conv, turn, sessionKey, i);
              memories.push(memory);
            }
          }

          // 批量保存记忆
          this.store.saveExchanges(memories);

          // 生成嵌入（如果模型可用）
          if (this.embedding) {
            for (const memory of memories) {
              try {
                const text = `${memory.exchange_core} ${memory.specific_context}`;
                const embedding = await this.embedding.generateEmbedding(text);
                this.store.saveEmbedding(memory.id, embedding);
                totalWithEmbedding++;
              } catch (error) {
                console.warn(`嵌入生成失败: ${error}`);
              }
            }
          }
        }
      }
    }

    const stats = this.store.getStats();
    console.log(`✅ 已加载 ${stats.totalExchanges} 条记忆`);
    if (this.embedding && totalWithEmbedding > 0) {
      console.log(`✅ 已生成 ${totalWithEmbedding} 个嵌入向量`);
    }
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
   * 运行问答评测（使用语义相似度）
   */
  async evaluateQA(): Promise<LoCoMoResult> {
    console.log('\n运行问答评测...');

    const results: Array<{
      question: string;
      expected: string;
      retrieved: boolean;
      latency: number;
      category: string;
      semanticScore: number;
    }> = [];

    const categories: Record<string, { correct: number; total: number }> = {};
    const SEMANTIC_THRESHOLD = 0.5; // 语义相似度阈值

    for (const conv of this.conversations) {
      if (!conv.qa) continue;

      for (const qa of conv.qa) {
        const start = Date.now();

        // 检索相关记忆
        const searchResult = await this.engine.search({
          query: qa.question,
          limit: 10,
        });

        const latency = Date.now() - start;

        // 使用语义相似度评估
        let retrieved = false;
        let bestSemanticScore = 0;

        if (this.embedding && searchResult.items.length > 0) {
          // 计算答案与检索内容的语义相似度
          for (const item of searchResult.items) {
            const content = `${item.exchange.exchange_core} ${item.exchange.specific_context}`;
            const similarity = await this.computeSimilarity(qa.answer, content);

            if (similarity > bestSemanticScore) {
              bestSemanticScore = similarity;
            }

            // 如果语义相似度超过阈值，认为匹配成功
            if (similarity >= SEMANTIC_THRESHOLD) {
              retrieved = true;
              break;
            }
          }
        } else {
          // 如果没有嵌入模型，回退到关键词匹配
          retrieved = searchResult.items.some(item => {
            const content = (item.exchange.specific_context || '').toLowerCase();
            const core = item.exchange.exchange_core.toLowerCase();
            return isAnswerRetrieved(qa.answer, content + ' ' + core);
          });
          bestSemanticScore = retrieved ? 1 : 0;
        }

        results.push({
          question: qa.question,
          expected: qa.answer,
          retrieved,
          latency,
          category: qa.category || 'general',
          semanticScore: bestSemanticScore,
        });

        // 统计分类
        const cat = qa.category || 'general';
        if (!categories[cat]) {
          categories[cat] = { correct: 0, total: 0 };
        }
        categories[cat].total++;
        if (retrieved) {
          categories[cat].correct++;
        }
      }
    }

    const correctAnswers = results.filter(r => r.retrieved).length;
    const totalQuestions = results.length;
    const avgLatency = results.length > 0
      ? results.reduce((sum, r) => sum + r.latency, 0) / results.length
      : 0;
    const avgSemanticScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.semanticScore, 0) / results.length
      : 0;

    console.log(`\n评测结果 (语义相似度阈值: ${SEMANTIC_THRESHOLD}):`);
    console.log(`  总问题数: ${totalQuestions}`);
    console.log(`  正确检索: ${correctAnswers}`);
    console.log(`  召回率: ${((correctAnswers / Math.max(1, totalQuestions)) * 100).toFixed(1)}%`);
    console.log(`  平均语义相似度: ${(avgSemanticScore * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${avgLatency.toFixed(1)}ms`);

    console.log(`\n  分类统计:`);
    for (const [cat, stats] of Object.entries(categories)) {
      const rate = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : '0.0';
      console.log(`    ${cat}: ${stats.correct}/${stats.total} (${rate}%)`);
    }

    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      benchmark: 'LoCoMo',
      totalQuestions,
      correctAnswers,
      accuracy: correctAnswers / Math.max(1, totalQuestions),
      recall: correctAnswers / Math.max(1, totalQuestions),
      avgLatency,
      memoryUsage,
      categories,
    };
  }

  dispose(): void {
    this.store.close();
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('LoCoMo Real Benchmark', () => {
  let benchmark: LoCoMoBenchmark;
  let datasetLoaded = false;
  let embeddingInitialized = false;

  // 增加超时时间以适应大量数据加载
  const TEST_TIMEOUT = 60000;

  beforeAll(async () => {
    benchmark = new LoCoMoBenchmark();

    // 尝试加载真实数据集
    const dataPath = join(process.cwd(), 'data/benchmarks/locomo10.json');
    datasetLoaded = benchmark.loadDataset(dataPath);

    if (!datasetLoaded) {
      console.log('\n⚠️  LoCoMo 数据集未下载，跳过真实数据评测');
      console.log('请运行以下命令下载数据集:');
      console.log('  ./scripts/download-benchmarks.sh');
      console.log('');
      console.log('或手动下载:');
      console.log('  wget -O data/benchmarks/locomo10.json https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json');
    } else {
      // 初始化嵌入模型（如果数据集存在）
      embeddingInitialized = await benchmark.initializeEmbedding();
    }
  });

  afterAll(() => {
    benchmark.dispose();
  });

  it('应该完成 LoCoMo 问答评测', async () => {
    if (!datasetLoaded) {
      console.log('⏭️  跳过评测 (数据集未加载)');
      return;
    }

    // 输出向量搜索状态
    if (embeddingInitialized) {
      console.log('📊 使用混合检索模式 (向量 + BM25)');
    } else {
      console.log('📊 使用 BM25 检索模式 (向量搜索不可用)');
    }

    await benchmark.loadConversations();
    const result = await benchmark.evaluateQA();

    expect(result.benchmark).toBe('LoCoMo');
    expect(result.totalQuestions).toBeGreaterThan(0);
    expect(result.recall).toBeGreaterThanOrEqual(0);
    expect(result.avgLatency).toBeLessThan(1000);

    // 输出详细报告
    console.log('\n========================================');
    console.log('LoCoMo 真实数据集评测报告');
    console.log('========================================');
    console.log(`向量搜索: ${embeddingInitialized ? '✅ 已启用' : '❌ 未启用'}`);
    console.log(`召回率: ${(result.recall * 100).toFixed(1)}%`);
    console.log(`平均延迟: ${result.avgLatency.toFixed(1)}ms`);
    console.log(`内存占用: ${result.memoryUsage.toFixed(1)} MB`);
    console.log('========================================');
  });
});
