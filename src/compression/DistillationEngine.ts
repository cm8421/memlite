/**
 * MemLite - 四元组压缩引擎
 *
 * 基于 Structured Distillation 论文实现 11 倍压缩
 * 四元组结构：
 * - exchange_core: 核心摘要 (~15 tokens)
 * - specific_context: 具体上下文 (~20 tokens)
 * - thematic_tags: 主题标签
 * - entities_extracted: 提取的实体
 */

/**
 * 压缩结果
 */
export interface CompressionResult {
  /** 核心摘要 (~15 tokens) */
  exchange_core: string;
  /** 具体上下文 (~20 tokens) */
  specific_context: string;
  /** 主题标签 */
  thematic_tags: string[];
  /** 提取的实体 */
  entities_extracted: string[];
  /** 压缩率 */
  compression_ratio: number;
}

/**
 * 压缩模式
 */
export enum CompressionMode {
  /** 快速模式：启发式规则 */
  FAST = 'fast',
  /** 高质量模式：LLM 辅助 */
  QUALITY = 'quality',
}

/**
 * 压缩配置
 */
export interface CompressionConfig {
  /** 压缩模式 */
  mode: CompressionMode;
  /** 最大核心摘要长度（字符） */
  maxCoreLength: number;
  /** 最大上下文长度（字符） */
  maxContextLength: number;
  /** 最大标签数量 */
  maxTags: number;
  /** 最大实体数量 */
  maxEntities: number;
  /** LLM API 端点（高质量模式） */
  llmEndpoint?: string;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: CompressionConfig = {
  mode: CompressionMode.FAST,
  maxCoreLength: 100,  // ~15 tokens
  maxContextLength: 150,  // ~20 tokens
  maxTags: 5,
  maxEntities: 10,
};

/**
 * 统计信息
 */
export interface CompressionStats {
  /** 总压缩次数 */
  totalCompressions: number;
  /** 平均压缩率 */
  avgCompressionRatio: number;
  /** 快速模式次数 */
  fastModeCount: number;
  /** 高质量模式次数 */
  qualityModeCount: number;
}

/**
 * 关键词权重（用于重要性评分）
 */
const KEYWORD_WEIGHTS: Record<string, number> = {
  // 高优先级关键词
  'bug': 2.0,
  'error': 2.0,
  'fix': 2.0,
  'important': 2.0,
  'critical': 2.5,
  'security': 2.5,
  'api': 1.5,
  'config': 1.5,
  'decision': 2.0,
  'architecture': 1.8,

  // 中优先级关键词
  'feature': 1.3,
  'update': 1.2,
  'change': 1.2,
  'refactor': 1.3,
  'optimize': 1.4,
  'test': 1.2,
  'implement': 1.3,

  // 低优先级关键词
  'minor': 0.8,
  'typo': 0.7,
  'format': 0.7,
  'whitespace': 0.5,
};

/**
 * 四元组压缩引擎
 */
export class DistillationEngine {
  private config: CompressionConfig;
  private stats: {
    totalCompressions: number;
    compressionRatios: number[];
    fastModeCount: number;
    qualityModeCount: number;
  };

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalCompressions: 0,
      compressionRatios: [],
      fastModeCount: 0,
      qualityModeCount: 0,
    };
  }

  /**
   * 压缩文本为四元组
   */
  async compress(text: string): Promise<CompressionResult> {
    this.stats.totalCompressions++;

    const originalLength = text.length;

    let result: CompressionResult;

    if (this.config.mode === CompressionMode.QUALITY && this.config.llmEndpoint) {
      result = await this.compressWithLLM(text);
      this.stats.qualityModeCount++;
    } else {
      result = this.compressFast(text);
      this.stats.fastModeCount++;
    }

    // 计算压缩率
    const compressedLength =
      result.exchange_core.length +
      result.specific_context.length +
      result.thematic_tags.join(' ').length +
      result.entities_extracted.join(' ').length;

    result.compression_ratio = originalLength / Math.max(compressedLength, 1);

    // 记录统计
    this.stats.compressionRatios.push(result.compression_ratio);
    if (this.stats.compressionRatios.length > 100) {
      this.stats.compressionRatios.shift();
    }

    return result;
  }

  /**
   * 快速模式：启发式压缩
   */
  private compressFast(text: string): CompressionResult {
    // 提取核心摘要
    const exchange_core = this.extractCore(text);

    // 提取具体上下文
    const specific_context = this.extractContext(text, exchange_core);

    // 提取主题标签
    const thematic_tags = this.extractTags(text);

    // 提取实体
    const entities_extracted = this.extractEntities(text);

    return {
      exchange_core,
      specific_context,
      thematic_tags,
      entities_extracted,
      compression_ratio: 1,
    };
  }

  /**
   * 高质量模式：LLM 辅助压缩
   */
  private async compressWithLLM(text: string): Promise<CompressionResult> {
    // 构建提示词
    const prompt = `请将以下文本压缩为四元组格式：

文本：
${text}

请提取：
1. 核心摘要（15 tokens以内，最重要的信息）
2. 具体上下文（20 tokens以内，补充细节）
3. 主题标签（3-5个关键词）
4. 关键实体（人名、项目名、文件名等）

以JSON格式返回：
{
  "core": "核心摘要",
  "context": "具体上下文",
  "tags": ["标签1", "标签2"],
  "entities": ["实体1", "实体2"]
}`;

    try {
      const response = await fetch(this.config.llmEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          max_tokens: 200,
          temperature: 0.3,
        }),
      });

      const data = await response.json() as { text?: string; content?: string };
      const content = data.text || data.content || '';

      // 解析 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          exchange_core: parsed.core?.slice(0, this.config.maxCoreLength) || '',
          specific_context: parsed.context?.slice(0, this.config.maxContextLength) || '',
          thematic_tags: (parsed.tags || []).slice(0, this.config.maxTags),
          entities_extracted: (parsed.entities || []).slice(0, this.config.maxEntities),
          compression_ratio: 1,
        };
      }
    } catch (error) {
      // LLM 失败，回退到快速模式
      console.warn('LLM compression failed, falling back to fast mode:', error);
    }

    return this.compressFast(text);
  }

  /**
   * 提取核心摘要
   */
  extractCore(text: string): string {
    const sentences = text.split(/[。！？.!?]+/).filter(s => s.trim());

    if (sentences.length === 0) {
      return text.slice(0, this.config.maxCoreLength);
    }

    // 评分每个句子
    const scored = sentences.map(sentence => ({
      sentence: sentence.trim(),
      score: this.scoreSentence(sentence),
    }));

    // 按分数排序
    scored.sort((a, b) => b.score - a.score);

    // 选择最重要的句子
    let core = scored[0]?.sentence || sentences[0];

    // 如果太长，进一步压缩
    if (core.length > this.config.maxCoreLength) {
      core = this.summarizeSentence(core);
    }

    return core.slice(0, this.config.maxCoreLength);
  }

  /**
   * 提取具体上下文
   */
  extractContext(text: string, core: string): string {
    // 移除核心部分，保留上下文
    let context = text.replace(core, '').trim();

    // 如果上下文太长，提取关键片段
    if (context.length > this.config.maxContextLength) {
      const sentences = context.split(/[。！？.!?]+/).filter(s => s.trim());

      // 选择与核心相关的句子
      const coreWords = new Set(core.toLowerCase().split(/\s+/));
      const relevant = sentences.filter(sentence => {
        const words = sentence.toLowerCase().split(/\s+/);
        return words.some(w => coreWords.has(w));
      });

      context = relevant.join(' ').slice(0, this.config.maxContextLength);
    }

    return context;
  }

  /**
   * 提取主题标签
   */
  extractTags(text: string): string[] {
    const tags: Set<string> = new Set();

    // 1. 提取已存在的标签格式 (#tag, [tag])
    const hashTags = text.match(/#\w+/g) || [];
    hashTags.forEach(t => tags.add(t.slice(1).toLowerCase()));

    const bracketTags = text.match(/\[([^\]]+)\]/g) || [];
    bracketTags.forEach(t => {
      const content = t.slice(1, -1).toLowerCase();
      if (content.length < 20) {
        tags.add(content);
      }
    });

    // 2. 提取高权重关键词
    const words = text.toLowerCase().split(/\s+/);
    const wordScores: Map<string, number> = new Map();

    for (const word of words) {
      const cleanWord = word.replace(/[^a-z0-9]/g, '');
      if (cleanWord.length < 3) continue;

      const weight = KEYWORD_WEIGHTS[cleanWord] || 1;
      wordScores.set(cleanWord, (wordScores.get(cleanWord) || 0) + weight);
    }

    // 按分数排序并添加
    const sortedWords = Array.from(wordScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.maxTags);

    sortedWords.forEach(([word]) => tags.add(word));

    return Array.from(tags).slice(0, this.config.maxTags);
  }

  /**
   * 提取实体
   */
  extractEntities(text: string): string[] {
    const entities: Set<string> = new Set();

    // 1. 提取文件路径
    const filePaths = text.match(/[a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,4}/g) || [];
    filePaths.forEach(p => entities.add(p));

    // 2. 提取 URL
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    urls.forEach(u => entities.add(u));

    // 3. 提取驼峰命名（类名、函数名）
    const camelCase = text.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g) || [];
    camelCase.forEach(c => entities.add(c));

    // 4. 提取全大写缩写
    const acronyms = text.match(/\b[A-Z]{2,}\b/g) || [];
    acronyms.forEach(a => entities.add(a));

    // 5. 提取带引号的内容
    const quoted = text.match(/["'`]([^"'`]+)["'`]/g) || [];
    quoted.forEach(q => {
      const content = q.slice(1, -1);
      if (content.length > 2 && content.length < 50) {
        entities.add(content);
      }
    });

    // 6. 提取版本号
    const versions = text.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) || [];
    versions.forEach(v => entities.add(v));

    return Array.from(entities).slice(0, this.config.maxEntities);
  }

  /**
   * 评分句子重要性
   */
  private scoreSentence(sentence: string): number {
    let score = 0;
    const words = sentence.toLowerCase().split(/\s+/);

    // 位置权重（开头的句子更重要）
    score += 1;

    // 长度权重（适中的长度更好）
    const length = sentence.length;
    if (length > 20 && length < 200) {
      score += 1;
    }

    // 关键词权重
    for (const word of words) {
      const cleanWord = word.replace(/[^a-z0-9]/g, '');
      score += KEYWORD_WEIGHTS[cleanWord] || 0;
    }

    // 包含数字（可能是重要数据）
    if (/\d+/.test(sentence)) {
      score += 0.5;
    }

    // 包含专有名词（大写开头）
    if (/\b[A-Z][a-z]+\b/.test(sentence)) {
      score += 0.5;
    }

    return score;
  }

  /**
   * 压缩单个句子
   */
  private summarizeSentence(sentence: string): string {
    const words = sentence.split(/\s+/);

    // 保留关键部分：开头 + 关键词 + 结尾
    const important: string[] = [];
    const keyPhrases: string[] = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase().replace(/[^a-z0-9]/g, '');

      // 开头和结尾的词
      if (i < 3 || i >= words.length - 3) {
        important.push(words[i]);
      }
      // 关键词
      else if (KEYWORD_WEIGHTS[word]) {
        keyPhrases.push(words[i]);
      }
    }

    // 组合结果
    const result = [...important.slice(0, 3), ...keyPhrases.slice(0, 3)].join(' ');
    return result.length < sentence.length ? result : sentence.slice(0, this.config.maxCoreLength);
  }

  /**
   * 计算文本的预估 token 数量
   */
  estimateTokens(text: string): number {
    // 简单估算：英文约 4 字符 = 1 token，中文约 2 字符 = 1 token
    const englishChars = (text.match(/[a-zA-Z0-9]/g) || []).length;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - englishChars - chineseChars;

    return Math.ceil(englishChars / 4 + chineseChars / 2 + otherChars / 3);
  }

  /**
   * 获取统计信息
   */
  getStats(): CompressionStats {
    const avgCompressionRatio =
      this.stats.compressionRatios.length > 0
        ? this.stats.compressionRatios.reduce((a, b) => a + b, 0) /
          this.stats.compressionRatios.length
        : 0;

    return {
      totalCompressions: this.stats.totalCompressions,
      avgCompressionRatio,
      fastModeCount: this.stats.fastModeCount,
      qualityModeCount: this.stats.qualityModeCount,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalCompressions: 0,
      compressionRatios: [],
      fastModeCount: 0,
      qualityModeCount: 0,
    };
  }
}

// 导出单例
let defaultEngine: DistillationEngine | null = null;

/**
 * 获取默认压缩引擎
 */
export function getDistillationEngine(
  config?: Partial<CompressionConfig>
): DistillationEngine {
  if (!defaultEngine) {
    defaultEngine = new DistillationEngine(config);
  }
  return defaultEngine;
}

export default DistillationEngine;
