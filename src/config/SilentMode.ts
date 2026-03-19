/**
 * MemLite - 静默模式配置
 *
 * 控制自动记忆行为的配置：
 * - 敏感信息过滤
 * - 重要性阈值
 * - 注入记忆数量限制
 */

import { clamp, PATTERNS } from '../utils/index.js';

export interface SilentModeConfig {
  /** 启用静默模式 */
  enabled: boolean;
  /** 过滤敏感信息 */
  filterSensitive: boolean;
  /** 最小重要性阈值（0-1），只有高于此值的记忆才会保存 */
  importanceThreshold: number;
  /** 注入记忆的最大数量 */
  maxInjections: number;
  /** 是否包含上下文详情 */
  includeContext: boolean;
  /** 敏感信息正则模式 */
  sensitivePatterns: (string | RegExp)[];
  /** 空闲巩固时间（毫秒）*/
  idleConsolidationMs: number;
}

const DEFAULT_CONFIG: SilentModeConfig = {
  enabled: true,
  filterSensitive: true,
  importanceThreshold: 0.3,
  maxInjections: 5,
  includeContext: false,
  sensitivePatterns: [
    /password/i,
    /api[_-]?key/i,
    /token/i,
    /secret/i,
    /credential/i,
    /bearer/i,
    /authorization/i,
  ],
  idleConsolidationMs: 5 * 60 * 1000, // 5 分钟
};

/**
 * 静默模式配置管理
 */
export class SilentMode {
  private config: SilentModeConfig;

  constructor(config: Partial<SilentModeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 是否应该注入记忆
   */
  shouldInject(): boolean {
    return this.config.enabled;
  }

  /**
   * 是否应该保存记忆
   */
  shouldSave(importanceScore: number): boolean {
    return this.config.enabled && importanceScore >= this.config.importanceThreshold;
  }

  /**
   * 最大注入数量
   */
  getMaxInjections(): number {
    return this.config.maxInjections;
  }

  /**
   * 是否包含上下文
   */
  includeContext(): boolean {
    return this.config.includeContext;
  }

  /**
   * 是否启用过滤
   */
  isFilteringEnabled(): boolean {
    return this.config.filterSensitive;
  }

  /**
   * 过滤敏感信息
   */
  filterSensitiveInfo(text: string): string {
    if (!this.config.filterSensitive) {
      return text;
    }

    let filtered = text;

    for (const pattern of this.config.sensitivePatterns) {
      filtered = filtered.replace(pattern, '[FILTERED]');
    }

    return filtered;
  }

  /**
   * 计算对话的重要性评分
   */
  calculateImportance(prompt: string, response: string): number {
    let score = 0.5; // 基础分数

    // 长度因子：更长的对话可能更重要
    const totalLength = prompt.length + response.length;
    if (totalLength > 500) score += 0.1;
    if (totalLength > 2000) score += 0.1;

    // 问题词因子：包含疑问词的对话可能包含更多知识
    if (PATTERNS.question.test(prompt)) score += 0.1;

    // 代码因子：涉及代码的对话通常更重要
    if (PATTERNS.code.test(prompt) || PATTERNS.code.test(response)) score += 0.1;

    // 重复因子：太短的对话价值有限
    if (totalLength < 50) score -= 0.2;

    // 确保分数在 0-1 范围内
    return clamp(score, 0, 1);
  }

  /**
   * 获取空闲巩固时间
   */
  getIdleConsolidationMs(): number {
    return this.config.idleConsolidationMs;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SilentModeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): SilentModeConfig {
    return { ...this.config };
  }

  /**
   * 从环境变量加载配置
   */
  static fromEnv(): SilentMode {
    const config: Partial<SilentModeConfig> = {};

    if (process.env.MEMLITE_ENABLED !== undefined) {
      config.enabled = process.env.MEMLITE_ENABLED === 'true';
    }

    if (process.env.MEMLITE_FILTER_SENSITIVE !== undefined) {
      config.filterSensitive = process.env.MEMLITE_FILTER_SENSITIVE === 'true';
    }

    if (process.env.MEMLITE_IMPORTANCE_THRESHOLD !== undefined) {
      config.importanceThreshold = parseFloat(process.env.MEMLITE_IMPORTANCE_THRESHOLD);
    }

    if (process.env.MEMLITE_MAX_INJECTIONS !== undefined) {
      config.maxInjections = parseInt(process.env.MEMLITE_MAX_INJECTIONS, 10);
    }

    return new SilentMode(config);
  }
}

export default SilentMode;
