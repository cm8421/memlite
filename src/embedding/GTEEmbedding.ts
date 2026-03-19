/**
 * MemLite - 嵌入模型接口
 *
 * 支持多种 ONNX 嵌入模型:
 * - all-MiniLM-L6-v2: 22MB, ~14ms, MTEB 56.3 (默认)
 * - GTE-small: 32MB (INT8), ~26ms, MTEB 61.4
 */

import * as ort from 'onnxruntime-node';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

// ES Module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 嵌入模型配置
 */
export interface EmbeddingConfig {
  /** 模型路径（目录） */
  modelPath: string;
  /** 向量维度 */
  dimension: number;
  /** 最大序列长度 */
  maxSequenceLength: number;
  /** 缓存大小 */
  cacheSize: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: EmbeddingConfig = {
  modelPath: path.join(__dirname, '../../models/gte-small-int8'),
  dimension: 384,
  maxSequenceLength: 512,
  cacheSize: 1000,
};

/**
 * LRU 缓存实现
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移动到最近使用
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最久未使用
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * 统计信息
 */
export interface EmbeddingStats {
  /** 总调用次数 */
  totalCalls: number;
  /** 缓存命中次数 */
  cacheHits: number;
  /** 缓存未命中次数 */
  cacheMisses: number;
  /** 平均推理时间（ms） */
  avgInferenceTime: number;
  /** 缓存命中率 */
  cacheHitRate: number;
}

/**
 * GTE-small INT8 ONNX 嵌入生成器
 */
export class GTEEmbedding {
  private config: EmbeddingConfig;
  private session: ort.InferenceSession | null = null;
  private tokenizer: Map<string, number> | null = null;
  private cache: LRUCache<string, Float32Array>;
  private stats: {
    totalCalls: number;
    cacheHits: number;
    cacheMisses: number;
    inferenceTimes: number[];
  };

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new LRUCache<string, Float32Array>(this.config.cacheSize);
    this.stats = {
      totalCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      inferenceTimes: [],
    };
  }

  /**
   * 初始化模型
   */
  async initialize(): Promise<void> {
    if (this.session) return;

    // 加载 ONNX 模型
    const modelFile = path.join(this.config.modelPath, 'model.onnx');
    if (!fs.existsSync(modelFile)) {
      throw new Error(`Model file not found: ${modelFile}`);
    }

    this.session = await ort.InferenceSession.create(modelFile, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });

    // 加载词表（简化版，实际应使用 tokenizer）
    await this.loadTokenizer();
  }

  /**
   * 加载词表
   */
  private async loadTokenizer(): Promise<void> {
    const vocabFile = path.join(this.config.modelPath, 'vocab.txt');
    if (!fs.existsSync(vocabFile)) {
      // 如果没有词表文件，使用简单的字符级分词
      this.tokenizer = new Map();
      return;
    }

    const content = await fs.promises.readFile(vocabFile, 'utf-8');
    const lines = content.split('\n');
    const tokenizerMap = new Map<string, number>();

    lines.forEach((line, index) => {
      const token = line.trim();
      if (token) {
        tokenizerMap.set(token, index);
      }
    });

    this.tokenizer = tokenizerMap;
  }

  /**
   * 简单分词器（实际项目中应使用专业的 tokenizer 库）
   */
  private tokenize(text: string): number[] {
    if (!this.tokenizer || this.tokenizer.size === 0) {
      // 回退到简单的哈希分词
      const tokens: number[] = [];
      const words = text.toLowerCase().split(/\s+/);

      for (const word of words) {
        // 使用哈希生成 token ID
        const hash = crypto.createHash('md5').update(word).digest();
        const tokenId = hash.readUInt32LE(0) % 30000; // GTE 词表大小约 30k
        tokens.push(tokenId);
      }

      return tokens;
    }

    // 使用词表分词
    const tokens: number[] = [];
    const words = text.toLowerCase().split(/\s+/);

    for (const word of words) {
      const tokenId = this.tokenizer.get(word);
      if (tokenId !== undefined) {
        tokens.push(tokenId);
      } else {
        // 未知词使用 [UNK] token
        tokens.push(this.tokenizer.get('[UNK]') ?? 1);
      }
    }

    return tokens;
  }

  /**
   * 生成单个文本的嵌入向量
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    // 检查缓存
    const cacheKey = crypto.createHash('md5').update(text).digest('hex');
    const cached = this.cache.get(cacheKey);

    if (cached) {
      this.stats.cacheHits++;
      this.stats.totalCalls++;
      return cached;
    }

    this.stats.cacheMisses++;
    this.stats.totalCalls++;

    // 确保模型已加载
    if (!this.session) {
      await this.initialize();
    }

    const startTime = Date.now();

    // 分词
    const tokens = this.tokenize(text);

    // 截断到最大长度
    const truncatedTokens = tokens.slice(0, this.config.maxSequenceLength);

    // 填充到固定长度
    const inputIds = new BigInt64Array(this.config.maxSequenceLength);
    const attentionMask = new BigInt64Array(this.config.maxSequenceLength);
    const tokenTypeIds = new BigInt64Array(this.config.maxSequenceLength);

    for (let i = 0; i < this.config.maxSequenceLength; i++) {
      if (i < truncatedTokens.length) {
        inputIds[i] = BigInt(truncatedTokens[i]);
        attentionMask[i] = BigInt(1);
        tokenTypeIds[i] = BigInt(0);
      } else {
        inputIds[i] = BigInt(0);
        attentionMask[i] = BigInt(0);
        tokenTypeIds[i] = BigInt(0);
      }
    }

    // 创建输入张量
    const inputIdsTensor = new ort.Tensor('int64', inputIds, [1, this.config.maxSequenceLength]);
    const attentionMaskTensor = new ort.Tensor('int64', attentionMask, [1, this.config.maxSequenceLength]);
    const tokenTypeIdsTensor = new ort.Tensor('int64', tokenTypeIds, [1, this.config.maxSequenceLength]);

    // 运行推理
    const results = await this.session!.run({
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
      token_type_ids: tokenTypeIdsTensor,
    });

    // 获取输出（通常是 last_hidden_state 或 sentence_embedding）
    const outputName = this.session!.outputNames[0];
    const output = results[outputName];

    // 提取 [CLS] token 的嵌入（或使用平均池化）
    const embedding = this.extractEmbedding(output.data as Float32Array);

    // 缓存结果
    this.cache.set(cacheKey, embedding);

    // 记录推理时间
    const inferenceTime = Date.now() - startTime;
    this.stats.inferenceTimes.push(inferenceTime);
    if (this.stats.inferenceTimes.length > 100) {
      this.stats.inferenceTimes.shift();
    }

    return embedding;
  }

  /**
   * 从输出中提取嵌入向量
   */
  private extractEmbedding(output: Float32Array): Float32Array {
    // 假设输出形状为 [1, seq_len, hidden_dim]
    // 提取 [CLS] token（第一个 token）的嵌入
    const embedding = new Float32Array(this.config.dimension);

    // 简单复制前 dimension 个元素
    for (let i = 0; i < this.config.dimension; i++) {
      embedding[i] = output[i];
    }

    // L2 归一化
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * 批量生成嵌入向量
   */
  async generateBatchEmbeddings(texts: string[]): Promise<Float32Array[]> {
    // 并行处理（但限制并发数）
    const batchSize = 8;
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );
      results.push(...embeddings);
    }

    return results;
  }

  /**
   * 获取统计信息
   */
  getStats(): EmbeddingStats {
    const avgInferenceTime =
      this.stats.inferenceTimes.length > 0
        ? this.stats.inferenceTimes.reduce((a, b) => a + b, 0) /
          this.stats.inferenceTimes.length
        : 0;

    return {
      totalCalls: this.stats.totalCalls,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      avgInferenceTime,
      cacheHitRate:
        this.stats.totalCalls > 0
          ? this.stats.cacheHits / this.stats.totalCalls
          : 0,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.clearCache();
  }
}

// 导出单例（延迟初始化）
let defaultEmbedding: GTEEmbedding | null = null;

/**
 * 获取默认嵌入生成器
 */
export function getEmbedding(config?: Partial<EmbeddingConfig>): GTEEmbedding {
  if (!defaultEmbedding) {
    defaultEmbedding = new GTEEmbedding(config);
  }
  return defaultEmbedding;
}

export default GTEEmbedding;
