/**
 * MemLite - 意图识别模块
 *
 * 基于脑科学启发的意图检测：
 * - 分支信号识别（工作记忆切换）
 * - 回归信号识别（上下文恢复）
 * - 置信度评估（决策阈值）
 */

import type { PlanMemory } from './PlanMemory.js';

/**
 * 意图类型
 */
export enum IntentType {
  /** 创建分支 - 暂停当前任务，开始新任务 */
  BRANCH = 'branch',
  /** 回归 - 返回之前的任务 */
  RETURN = 'return',
  /** 暂停 - 仅暂停当前任务 */
  PAUSE = 'pause',
  /** 完成 - 标记当前任务完成 */
  COMPLETE = 'complete',
  /** 无意图 - 继续当前任务 */
  NONE = 'none',
}

/**
 * 意图置信度级别
 */
export enum ConfidenceLevel {
  /** 高置信度 - 自动执行 */
  HIGH = 'high',
  /** 中置信度 - 需确认 */
  MEDIUM = 'medium',
  /** 低置信度 - 忽略 */
  LOW = 'low',
}

/**
 * 意图检测结果
 */
export interface IntentResult {
  /** 意图类型 */
  type: IntentType;
  /** 置信度 (0-1) */
  confidence: number;
  /** 置信度级别 */
  confidenceLevel: ConfidenceLevel;
  /** 目标计划ID（用于回归） */
  targetPlanId?: string;
  /** 目标计划标题 */
  targetPlanTitle?: string;
  /** 检测到的关键词 */
  matchedKeywords: string[];
  /** 上下文匹配信息 */
  contextMatch?: {
    tagOverlap: number;
    entityOverlap: number;
    combinedScore: number;
  };
  /** 检测时间 */
  detectedAt: number;
}

/**
 * 意图识别配置
 */
export interface IntentDetectorConfig {
  /** 分支信号关键词 */
  branchKeywords: string[];
  /** 回归信号关键词 */
  returnKeywords: string[];
  /** 暂停信号关键词 */
  pauseKeywords: string[];
  /** 完成信号关键词 */
  completeKeywords: string[];
  /** 高置信度阈值 */
  highConfidenceThreshold: number;
  /** 低置信度阈值 */
  lowConfidenceThreshold: number;
  /** 上下文匹配权重 */
  contextMatchWeight: number;
  /** 启用上下文匹配 */
  enableContextMatch: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_INTENT_DETECTOR_CONFIG: IntentDetectorConfig = {
  branchKeywords: [
    '先做', '暂停', '切换到', '等一下',
    '换个话题', '先处理', '插个队',
    '临时有', '紧急', '马上要'
  ],
  returnKeywords: [
    '继续', '回到', '恢复', '返回',
    '继续做', '回去', '接着', '刚才'
  ],
  pauseKeywords: [
    '暂停', '停下', '等会', '待会',
    '先放一放', '暂时'
  ],
  completeKeywords: [
    '完成', '结束', '搞定', '做好了',
    '做完了', '可以了', 'OK'
  ],
  highConfidenceThreshold: 0.8,
  lowConfidenceThreshold: 0.5,
  contextMatchWeight: 0.3,
  enableContextMatch: true,
};

/**
 * 意图检测统计
 */
export interface IntentDetectorStats {
  /** 总检测次数 */
  totalDetections: number;
  /** 各意图类型计数 */
  intentCounts: Record<IntentType, number>;
  /** 平均置信度 */
  avgConfidence: number;
  /** 高置信度决策数 */
  highConfidenceDecisions: number;
  /** 中置信度决策数 */
  mediumConfidenceDecisions: number;
  /** 低置信度决策数 */
  lowConfidenceDecisions: number;
  /** 上下文匹配成功次数 */
  contextMatchSuccesses: number;
}

/**
 * 意图检测器
 *
 * 核心功能：
 * 1. 关键词匹配
 * 2. 上下文相似度计算
 * 3. 置信度评估
 * 4. 多信号融合
 */
export class IntentDetector {
  private config: IntentDetectorConfig;

  // 统计
  private stats: {
    totalDetections: number;
    intentCounts: Record<IntentType, number>;
    confidences: number[];
    confidenceLevels: Record<ConfidenceLevel, number>;
    contextMatchSuccesses: number;
  };

  constructor(config: Partial<IntentDetectorConfig> = {}) {
    this.config = { ...DEFAULT_INTENT_DETECTOR_CONFIG, ...config };

    this.stats = {
      totalDetections: 0,
      intentCounts: {
        [IntentType.BRANCH]: 0,
        [IntentType.RETURN]: 0,
        [IntentType.PAUSE]: 0,
        [IntentType.COMPLETE]: 0,
        [IntentType.NONE]: 0,
      },
      confidences: [],
      confidenceLevels: {
        [ConfidenceLevel.HIGH]: 0,
        [ConfidenceLevel.MEDIUM]: 0,
        [ConfidenceLevel.LOW]: 0,
      },
      contextMatchSuccesses: 0,
    };
  }

  /**
   * 检测意图
   *
   * @param text 用户输入文本
   * @param context 当前上下文（可用计划列表）
   * @returns 意图检测结果
   */
  detect(text: string, context?: {
    activePlan?: PlanMemory | null;
    pausedPlans?: PlanMemory[];
    recentPlans?: PlanMemory[];
  }): IntentResult {
    const startTime = Date.now();

    // 1. 关键词匹配
    const branchMatches = this.findKeywords(text, this.config.branchKeywords);
    const returnMatches = this.findKeywords(text, this.config.returnKeywords);
    const pauseMatches = this.findKeywords(text, this.config.pauseKeywords);
    const completeMatches = this.findKeywords(text, this.config.completeKeywords);

    // 2. 计算各意图的基础分数
    const scores = {
      [IntentType.BRANCH]: this.calculateKeywordScore(branchMatches),
      [IntentType.RETURN]: this.calculateKeywordScore(returnMatches),
      [IntentType.PAUSE]: this.calculateKeywordScore(pauseMatches),
      [IntentType.COMPLETE]: this.calculateKeywordScore(completeMatches),
    };

    // 3. 上下文增强（用于回归意图）
    let contextMatch: IntentResult['contextMatch'] | undefined;
    let targetPlanId: string | undefined;
    let targetPlanTitle: string | undefined;

    if (this.config.enableContextMatch && context && scores[IntentType.RETURN] > 0) {
      const matchResult = this.findBestMatchingPlan(text, context);
      if (matchResult) {
        contextMatch = matchResult.contextMatch;
        targetPlanId = matchResult.plan.id;
        targetPlanTitle = matchResult.plan.title;

        // 增强回归分数
        if (contextMatch.combinedScore > 0.5) {
          scores[IntentType.RETURN] += contextMatch.combinedScore * this.config.contextMatchWeight;
          this.stats.contextMatchSuccesses++;
        }
      }
    }

    // 4. 选择最佳意图
    let bestType = IntentType.NONE;
    let bestScore = 0;

    for (const [type, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type as IntentType;
      }
    }

    // 如果没有明确意图，返回 NONE
    if (bestScore < this.config.lowConfidenceThreshold) {
      bestType = IntentType.NONE;
    }

    // 5. 确定置信度级别
    const confidenceLevel = this.getConfidenceLevel(bestScore);

    // 6. 收集匹配的关键词
    const matchedKeywords = [
      ...branchMatches,
      ...returnMatches,
      ...pauseMatches,
      ...completeMatches,
    ];

    // 7. 更新统计
    this.updateStats(bestType, bestScore, confidenceLevel);

    return {
      type: bestType,
      confidence: bestScore,
      confidenceLevel,
      targetPlanId,
      targetPlanTitle,
      matchedKeywords,
      contextMatch,
      detectedAt: startTime,
    };
  }

  /**
   * 查找关键词
   */
  private findKeywords(text: string, keywords: string[]): string[] {
    const lowerText = text.toLowerCase();
    const found: string[] = [];

    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        found.push(keyword);
      }
    }

    return found;
  }

  /**
   * 计算关键词得分
   *
   * 基于匹配数量和位置加权
   */
  private calculateKeywordScore(matches: string[]): number {
    if (matches.length === 0) return 0;

    // 基础分：每个匹配 +0.5
    const baseScore = Math.min(matches.length * 0.5, 0.9);

    // 多关键词加成
    const multiMatchBonus = matches.length > 1 ? 0.1 : 0;

    return Math.min(baseScore + multiMatchBonus, 1);
  }

  /**
   * 查找最佳匹配计划
   */
  private findBestMatchingPlan(
    text: string,
    context: {
      activePlan?: PlanMemory | null;
      pausedPlans?: PlanMemory[];
      recentPlans?: PlanMemory[];
    }
  ): { plan: PlanMemory; contextMatch: NonNullable<IntentResult['contextMatch']> } | null {
    const candidates: PlanMemory[] = [
      ...(context.pausedPlans || []),
      ...(context.recentPlans || []),
    ].filter(p => p && p.id !== context.activePlan?.id);

    if (candidates.length === 0) return null;

    let bestMatch: { plan: PlanMemory; contextMatch: NonNullable<IntentResult['contextMatch']> } | null = null;
    let bestScore = 0;

    for (const plan of candidates) {
      const contextMatch = this.calculateContextMatch(text, plan);

      if (contextMatch.combinedScore > bestScore) {
        bestScore = contextMatch.combinedScore;
        bestMatch = { plan, contextMatch };
      }
    }

    return bestMatch;
  }

  /**
   * 计算上下文匹配度
   *
   * 支持中英文混合匹配：
   * - 使用子字符串包含检查（避免中文分词问题）
   * - 标签和实体都检查是否在文本中出现
   */
  private calculateContextMatch(
    text: string,
    plan: PlanMemory
  ): NonNullable<IntentResult['contextMatch']> {
    const textLower = text.toLowerCase();

    // 1. 标签匹配 - 检查每个标签是否在文本中出现
    let matchedTags = 0;
    for (const tag of plan.context_tags) {
      if (textLower.includes(tag.toLowerCase())) {
        matchedTags++;
      }
    }
    const tagOverlap = plan.context_tags.length > 0
      ? matchedTags / plan.context_tags.length
      : 0;

    // 2. 实体匹配 - 从任务描述中提取并检查
    const planEntities: string[] = [];
    for (const task of plan.tasks) {
      // 分词：支持空格分隔和单个字符
      const words = task.description.toLowerCase().split(/\s+/).filter(w => w.length > 0);
      planEntities.push(...words);
    }

    let matchedEntities = 0;
    for (const entity of planEntities) {
      if (textLower.includes(entity)) {
        matchedEntities++;
      }
    }
    const entityOverlap = planEntities.length > 0
      ? matchedEntities / planEntities.length
      : 0;

    // 3. 综合分数
    const combinedScore = tagOverlap * 0.5 + entityOverlap * 0.5;

    return {
      tagOverlap,
      entityOverlap,
      combinedScore,
    };
  }

  /**
   * 获取置信度级别
   */
  private getConfidenceLevel(confidence: number): ConfidenceLevel {
    if (confidence >= this.config.highConfidenceThreshold) {
      return ConfidenceLevel.HIGH;
    } else if (confidence >= this.config.lowConfidenceThreshold) {
      return ConfidenceLevel.MEDIUM;
    } else {
      return ConfidenceLevel.LOW;
    }
  }

  /**
   * 更新统计
   */
  private updateStats(
    type: IntentType,
    confidence: number,
    level: ConfidenceLevel
  ): void {
    this.stats.totalDetections++;
    this.stats.intentCounts[type]++;
    this.stats.confidences.push(confidence);
    this.stats.confidenceLevels[level]++;

    if (this.stats.confidences.length > 100) {
      this.stats.confidences.shift();
    }
  }

  /**
   * 批量检测意图
   */
  detectBatch(
    texts: string[],
    context?: {
      activePlan?: PlanMemory | null;
      pausedPlans?: PlanMemory[];
      recentPlans?: PlanMemory[];
    }
  ): IntentResult[] {
    return texts.map(text => this.detect(text, context));
  }

  /**
   * 是否应该自动执行
   */
  shouldAutoExecute(result: IntentResult): boolean {
    return result.confidenceLevel === ConfidenceLevel.HIGH &&
           result.type !== IntentType.NONE;
  }

  /**
   * 是否需要确认
   */
  needsConfirmation(result: IntentResult): boolean {
    return result.confidenceLevel === ConfidenceLevel.MEDIUM &&
           result.type !== IntentType.NONE;
  }

  /**
   * 检测意图（带上下文）
   */
  detectWithIntent(text: string, context?: {
    activePlan?: PlanMemory | null;
    pausedPlans?: PlanMemory[];
    recentPlans?: PlanMemory[];
  }): IntentResult {
    return this.detect(text, context);
  }

  /**
   * 获取统计信息
   */
  getStats(): IntentDetectorStats {
    const avgConfidence =
      this.stats.confidences.length > 0
        ? this.stats.confidences.reduce((a, b) => a + b, 0) /
          this.stats.confidences.length
        : 0;

    return {
      totalDetections: this.stats.totalDetections,
      intentCounts: { ...this.stats.intentCounts },
      avgConfidence,
      highConfidenceDecisions: this.stats.confidenceLevels[ConfidenceLevel.HIGH],
      mediumConfidenceDecisions: this.stats.confidenceLevels[ConfidenceLevel.MEDIUM],
      lowConfidenceDecisions: this.stats.confidenceLevels[ConfidenceLevel.LOW],
      contextMatchSuccesses: this.stats.contextMatchSuccesses,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalDetections: 0,
      intentCounts: {
        [IntentType.BRANCH]: 0,
        [IntentType.RETURN]: 0,
        [IntentType.PAUSE]: 0,
        [IntentType.COMPLETE]: 0,
        [IntentType.NONE]: 0,
      },
      confidences: [],
      confidenceLevels: {
        [ConfidenceLevel.HIGH]: 0,
        [ConfidenceLevel.MEDIUM]: 0,
        [ConfidenceLevel.LOW]: 0,
      },
      contextMatchSuccesses: 0,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<IntentDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): IntentDetectorConfig {
    return { ...this.config };
  }

  /**
   * 添加自定义关键词
   */
  addCustomKeyword(type: IntentType, keyword: string): void {
    switch (type) {
      case IntentType.BRANCH:
        if (!this.config.branchKeywords.includes(keyword)) {
          this.config.branchKeywords.push(keyword);
        }
        break;
      case IntentType.RETURN:
        if (!this.config.returnKeywords.includes(keyword)) {
          this.config.returnKeywords.push(keyword);
        }
        break;
      case IntentType.PAUSE:
        if (!this.config.pauseKeywords.includes(keyword)) {
          this.config.pauseKeywords.push(keyword);
        }
        break;
      case IntentType.COMPLETE:
        if (!this.config.completeKeywords.includes(keyword)) {
          this.config.completeKeywords.push(keyword);
        }
        break;
    }
  }

  /**
   * 移除自定义关键词
   */
  removeCustomKeyword(type: IntentType, keyword: string): void {
    const remove = (arr: string[]) => {
      const index = arr.indexOf(keyword);
      if (index > -1) {
        arr.splice(index, 1);
      }
    };

    switch (type) {
      case IntentType.BRANCH:
        remove(this.config.branchKeywords);
        break;
      case IntentType.RETURN:
        remove(this.config.returnKeywords);
        break;
      case IntentType.PAUSE:
        remove(this.config.pauseKeywords);
        break;
      case IntentType.COMPLETE:
        remove(this.config.completeKeywords);
        break;
    }
  }
}

export default IntentDetector;
