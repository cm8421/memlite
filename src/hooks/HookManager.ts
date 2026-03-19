/**
 * MemLite - Claude Code Hooks 集成管理器
 *
 * 处理 Claude Code 的 Hook 事件：
 * - user-prompt-submit: 用户提交提示时，自动检索相关记忆并注入
 * - assistant-response-complete: 助手响应完成时，自动保存对话
 */

import { RetrievalEngine } from '../core/RetrievalEngine.js';
import { SQLiteStore } from '../storage/SQLiteStore.js';
import { SilentMode } from '../config/SilentMode.js';
import type { MemoryExchange } from '../types/memory.js';

export interface HookContext {
  prompt?: string;
  response?: string;
  timestamp: number;
}

export interface HookResult {
  injectedContent: string[];
  stats: {
    memoriesRetrieved: number;
    memoriesSaved: number;
    filtered: boolean;
  };
}

/**
 * Hook 事件类型
 */
export type HookEvent = 'prompt' | 'response';

export class HookManager {
  private store: SQLiteStore;
  private retrievalEngine: RetrievalEngine;
  private silentMode: SilentMode;

  constructor(
    store: SQLiteStore,
    retrievalEngine: RetrievalEngine,
    silentMode: SilentMode
  ) {
    this.store = store;
    this.retrievalEngine = retrievalEngine;
    this.silentMode = silentMode;
  }

  /**
   * 处理 user-prompt-submit hook
   * 自动检索相关记忆并返回注入内容
   */
  async handlePromptHook(prompt: string): Promise<HookResult> {
    const result: HookResult = {
      injectedContent: [],
      stats: {
        memoriesRetrieved: 0,
        memoriesSaved: 0,
        filtered: false,
      },
    };

    // 检查是否应该注入记忆
    if (this.silentMode.shouldInject()) {
      const searchResult = await this.retrievalEngine.search({
        query: prompt,
        limit: this.silentMode.getMaxInjections(),
      });

      result.stats.memoriesRetrieved = searchResult.items.length;

      // 格式化注入内容
      for (const item of searchResult.items) {
        const content = this.formatMemoryForInjection(item.exchange);
        result.injectedContent.push(content);
      }
    }

    result.stats.filtered = this.silentMode.isFilteringEnabled();

    return result;
  }

  /**
   * 处理 assistant-response-complete hook
   * 自动保存对话到记忆系统
   */
  async handleResponseHook(
    prompt: string,
    response: string
  ): Promise<HookResult> {
    const result: HookResult = {
      injectedContent: [],
      stats: {
        memoriesRetrieved: 0,
        memoriesSaved: 0,
        filtered: false,
      },
    };

    // 过滤敏感信息
    const filteredPrompt = this.silentMode.filterSensitiveInfo(prompt);
    const filteredResponse = this.silentMode.filterSensitiveInfo(response);

    // 计算重要性评分
    const importanceScore =
      this.silentMode.calculateImportance(filteredPrompt, filteredResponse);

    // 检查是否应该保存
    if (this.silentMode.shouldSave(importanceScore)) {
      const exchange = this.createMemoryExchange(filteredPrompt, filteredResponse, importanceScore);
      this.store.saveExchange(exchange);
      result.stats.memoriesSaved = 1;
    }

    result.stats.filtered = this.silentMode.isFilteringEnabled();

    return result;
  }

  /**
   * 创建记忆交换对象
   */
  private createMemoryExchange(
    prompt: string,
    response: string,
    importanceScore: number
  ): MemoryExchange {
    const id = `hook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = Date.now();

    // 提取核心内容（取对话的核心部分）
    const combined = `${prompt}\n${response}`;
    const exchangeCore = this.truncate(combined, 500);
    const specificContext = this.truncate(response, 200);

    // 简单提取标签（从问题中提取）
    const tags = this.extractTags(prompt);

    return {
      id,
      timestamp,
      exchange_core: exchangeCore,
      specific_context: specificContext,
      thematic_tags: tags,
      entities_extracted: [],
      importance_score: importanceScore,
      access_count: 0,
      decay_rate: 0.1,
      last_accessed: timestamp,
    };
  }

  /**
   * 截断文本到指定长度
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * 从文本中提取简单标签
   */
  private extractTags(text: string): string[] {
    const tags: string[] = ['hook'];

    // 检测语言
    if (/[\u4e00-\u9fa5]/.test(text)) {
      tags.push('chinese');
    }

    // 检测代码
    if (/```|function|class|const|let|var/.test(text)) {
      tags.push('code');
    }

    // 检测问题
    if (/\?|what|how|why|when|where|who|which/.test(text.toLowerCase())) {
      tags.push('question');
    }

    return tags;
  }

  /**
   * 格式化记忆用于注入
   */
  private formatMemoryForInjection(exchange: MemoryExchange): string {
    const lines: string[] = [];

    if (exchange.exchange_core) {
      lines.push(`[${exchange.thematic_tags?.[0] || 'memory'}] ${exchange.exchange_core}`);
    }

    if (exchange.specific_context && this.silentMode.includeContext()) {
      lines.push(`  Context: ${exchange.specific_context.slice(0, 200)}`);
    }

    return lines.join('\n');
  }

  /**
   * 处理 hook 事件（统一入口）
   */
  async handleHook(event: HookEvent, context: HookContext): Promise<HookResult> {
    switch (event) {
      case 'prompt':
        if (!context.prompt) {
          throw new Error('Prompt is required for prompt hook');
        }
        return this.handlePromptHook(context.prompt);

      case 'response':
        if (!context.prompt || !context.response) {
          throw new Error('Both prompt and response are required for response hook');
        }
        return this.handleResponseHook(context.prompt, context.response);

      default:
        throw new Error(`Unknown hook event: ${event}`);
    }
  }
}

export default HookManager;
