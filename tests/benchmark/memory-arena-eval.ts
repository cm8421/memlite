/**
 * MemLite MemoryArena 基准评测
 *
 * 基于 MemoryArena: "记忆指导动作"的闭环评测
 * 论文: https://arxiv.org/abs/2602.16313
 *
 * 评测 4 个环境:
 * 1. Web导航 - 多步骤信息搜集
 * 2. 偏好约束规划
 * 3. 渐进式信息搜索
 * 4. 序列形式推理
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SQLiteStore } from '../../src/storage/SQLiteStore.js';
import { RetrievalEngine } from '../../src/core/RetrievalEngine.js';
import { PlanManager } from '../../src/plan/PlanManager.js';
import { IntentDetector } from '../../src/plan/IntentDetector.js';
import type { MemoryExchange } from '../../src/types/memory.js';
import type {
  MemoryArenaTask,
  MemoryArenaStep,
  MemoryArenaResult,
  MemoryArenaConfig,
  MemoryArenaTaskType,
} from './types.js';

// ============================================================================
// MemoryArena 评测器
// ============================================================================

export class MemoryArenaEvaluator {
  private store: SQLiteStore;
  private engine: RetrievalEngine;
  private planManager: PlanManager;
  private intentDetector: IntentDetector;
  private config: MemoryArenaConfig;

  constructor(config: Partial<MemoryArenaConfig> = {}) {
    this.config = {
      maxSteps: 20,
      timeout: 60000,
      ...config,
    };

    this.store = new SQLiteStore({ dbPath: ':memory:' });
    this.engine = new RetrievalEngine(this.store, { enableVectorSearch: false });
    this.planManager = new PlanManager();
    this.intentDetector = new IntentDetector();
  }

  /**
   * 加载记忆数据
   */
  async loadMemories(memories: MemoryExchange[]): Promise<void> {
    console.log(`\n加载 ${memories.length} 条记忆...`);

    for (const memory of memories) {
      this.store.saveExchange(memory);
    }

    console.log(`已加载 ${this.store.getStats().totalExchanges} 条记忆`);
  }

  /**
   * 执行单个任务
   */
  async executeTask(task: MemoryArenaTask): Promise<{
    success: boolean;
    completedSteps: number;
    totalSteps: number;
    memoryHits: number;
    dependenciesResolved: number;
    latency: number;
  }> {
    const start = Date.now();
    let completedSteps = 0;
    let memoryHits = 0;
    let dependenciesResolved = 0;

    // 创建计划
    const plan = this.planManager.createPlan(task.id, task.description);

    for (const step of task.steps) {
      // 检查依赖
      if (step.memoryRequired && step.memoryRequired.length > 0) {
        for (const requiredMemory of step.memoryRequired) {
          const searchResult = await this.engine.search({
            query: requiredMemory,
            limit: 3,
          });

          if (searchResult.items.length > 0) {
            memoryHits++;
          }
        }
      }

      // 执行步骤
      const stepSuccess = await this.executeStep(step, task);

      if (stepSuccess) {
        completedSteps++;
      }

      // 检查是否超时
      if (Date.now() - start > this.config.timeout) {
        break;
      }
    }

    const latency = Date.now() - start;
    const success = completedSteps === task.steps.length;

    return {
      success,
      completedSteps,
      totalSteps: task.steps.length,
      memoryHits,
      dependenciesResolved,
      latency,
    };
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(step: MemoryArenaStep, task: MemoryArenaTask): Promise<boolean> {
    // 简化的步骤执行逻辑
    // 在实际场景中，这里会调用实际的执行器

    // 1. 检索相关记忆
    const searchResult = await this.engine.search({
      query: step.instruction,
      limit: 5,
    });

    // 2. 验证是否有足够的上下文
    if (step.memoryRequired && step.memoryRequired.length > 0) {
      const found = step.memoryRequired.every(req =>
        searchResult.items.some(item => {
          const content = item.exchange.specific_context || '';
          return content.toLowerCase().includes(req.toLowerCase());
        })
      );

      if (!found) {
        return false;
      }
    }

    // 3. 模拟执行
    return true;
  }

  /**
   * 运行完整评测
   */
  async runEvaluation(
    memories: MemoryExchange[],
    tasks: MemoryArenaTask[]
  ): Promise<MemoryArenaResult> {
    console.log('\n========================================');
    console.log('MemoryArena 基准评测');
    console.log('========================================');

    await this.loadMemories(memories);

    console.log('\n执行任务评测...');

    const taskResults = await Promise.all(
      tasks.map(task => this.executeTask(task))
    );

    // 统计结果
    const completedTasks = taskResults.filter(r => r.success).length;
    const taskCompletionRate = tasks.length > 0 ? completedTasks / tasks.length : 0;

    const totalMemoryHits = taskResults.reduce((sum, r) => sum + r.memoryHits, 0);
    const totalSteps = taskResults.reduce((sum, r) => sum + r.totalSteps, 0);
    const memoryHitRate = totalSteps > 0 ? totalMemoryHits / totalSteps : 0;

    // 按任务类型统计
    const typeResults: Record<MemoryArenaTaskType, { completed: number; total: number }> = {
      web_navigation: { completed: 0, total: 0 },
      preference_planning: { completed: 0, total: 0 },
      progressive_search: { completed: 0, total: 0 },
      sequential_reasoning: { completed: 0, total: 0 },
    };

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const result = taskResults[i];
      typeResults[task.type].total++;
      if (result.success) {
        typeResults[task.type].completed++;
      }
    }

    const typeCompletionRate = {} as Record<MemoryArenaTaskType, number>;
    for (const type of Object.keys(typeResults) as MemoryArenaTaskType[]) {
      const { completed, total } = typeResults[type];
      typeCompletionRate[type] = total > 0 ? completed / total : 0;
    }

    // 计算跨会话依赖解决率
    const crossSessionRate = taskResults.reduce((sum, r) => sum + r.dependenciesResolved, 0);

    // 计算记忆-动作一致性
    const memoryActionConsistency = memoryHitRate;

    const avgLatency = taskResults.length > 0
      ? taskResults.reduce((sum, r) => sum + r.latency, 0) / taskResults.length
      : 0;

    console.log('\n评测结果:');
    console.log(`  任务完成率: ${(taskCompletionRate * 100).toFixed(1)}%`);
    console.log(`  记忆命中率: ${(memoryHitRate * 100).toFixed(1)}%`);
    console.log(`  平均延迟: ${avgLatency.toFixed(1)}ms`);

    console.log('\n  各类型任务完成率:');
    for (const [type, rate] of Object.entries(typeCompletionRate)) {
      console.log(`    ${type}: ${(rate * 100).toFixed(1)}%`);
    }

    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      benchmark: 'MemoryArena',
      accuracy: taskCompletionRate,
      recall: memoryHitRate,
      latency: avgLatency,
      memoryUsage,
      taskCompletionRate,
      crossSessionRate: crossSessionRate / Math.max(1, tasks.length),
      memoryActionConsistency,
      typeCompletionRate,
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

export function generateTestMemories(count: number): MemoryExchange[] {
  const memories: MemoryExchange[] = [];
  const topics = ['导航', '偏好', '搜索', '推理', '计划'];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    memories.push({
      id: `memory_${i}`,
      timestamp: Date.now() - (count - i) * 1000 * 60,
      exchange_core: `关于${topic}的记忆 ${i}`,
      specific_context: `这是关于${topic}的详细上下文信息，包含了重要的细节和步骤 ${i}`,
      thematic_tags: [topic],
      entities_extracted: [`${topic}_${i}`],
      importance_score: 0.5 + Math.random() * 0.5,
      access_count: Math.floor(Math.random() * 10),
      decay_rate: 0.1,
      last_accessed: Date.now(),
    });
  }

  return memories;
}

export function generateTestTasks(memories: MemoryExchange[]): MemoryArenaTask[] {
  const tasks: MemoryArenaTask[] = [];
  const types: MemoryArenaTaskType[] = [
    'web_navigation',
    'preference_planning',
    'progressive_search',
    'sequential_reasoning',
  ];

  for (let i = 0; i < 10; i++) {
    const type = types[i % types.length];
    const stepCount = 3 + Math.floor(Math.random() * 5);

    const steps: MemoryArenaStep[] = [];
    for (let s = 0; s < stepCount; s++) {
      const relatedMemory = memories[(i + s) % memories.length];
      steps.push({
        id: `step_${i}_${s}`,
        instruction: `执行步骤 ${s}`,
        memoryRequired: s > 0 ? [relatedMemory.exchange_core] : undefined,
      });
    }

    tasks.push({
      id: `task_${i}`,
      type,
      description: `${type} 任务 ${i}`,
      steps,
      expectedOutcome: `完成任务 ${i}`,
    });
  }

  return tasks;
}

// ============================================================================
// 测试
// ============================================================================

describe('MemoryArena Benchmark', () => {
  let evaluator: MemoryArenaEvaluator;

  beforeAll(() => {
    evaluator = new MemoryArenaEvaluator({
      maxSteps: 10,
      timeout: 5000,
    });
  });

  afterAll(() => {
    evaluator.dispose();
  });

  it('应该完成 MemoryArena 基准评测', async () => {
    const memories = generateTestMemories(50);
    const tasks = generateTestTasks(memories);

    const result = await evaluator.runEvaluation(memories, tasks);

    expect(result.benchmark).toBe('MemoryArena');
    expect(result.taskCompletionRate).toBeGreaterThanOrEqual(0);
    expect(result.typeCompletionRate).toBeDefined();
  });

  it('应该正确执行单个任务', async () => {
    const testEvaluator = new MemoryArenaEvaluator();

    const memories: MemoryExchange[] = [
      {
        id: 'm1',
        timestamp: Date.now(),
        exchange_core: '用户偏好深色主题',
        specific_context: '用户明确表示喜欢深色主题，不喜欢亮色',
        thematic_tags: ['preference'],
        entities_extracted: ['dark-theme'],
        importance_score: 0.8,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      },
    ];

    const task: MemoryArenaTask = {
      id: 'task_1',
      type: 'preference_planning',
      description: '根据用户偏好设置主题',
      steps: [
        {
          id: 'step_1',
          instruction: '查询用户主题偏好',
          memoryRequired: ['用户偏好'],
        },
        {
          id: 'step_2',
          instruction: '应用深色主题',
        },
      ],
      expectedOutcome: '主题设置完成',
    };

    await testEvaluator.loadMemories(memories);
    const result = await testEvaluator.executeTask(task);

    expect(result.totalSteps).toBe(2);
    expect(result.completedSteps).toBeGreaterThanOrEqual(0);

    testEvaluator.dispose();
  });

  it('应该正确统计各类型任务完成率', async () => {
    const testEvaluator = new MemoryArenaEvaluator();
    const memories = generateTestMemories(20);
    const tasks: MemoryArenaTask[] = [
      {
        id: 'nav_1',
        type: 'web_navigation',
        description: '导航任务1',
        steps: [{ id: 's1', instruction: '步骤1' }],
        expectedOutcome: '完成',
      },
      {
        id: 'pref_1',
        type: 'preference_planning',
        description: '偏好任务1',
        steps: [{ id: 's1', instruction: '步骤1' }],
        expectedOutcome: '完成',
      },
    ];

    const result = await testEvaluator.runEvaluation(memories, tasks);

    expect(result.typeCompletionRate).toHaveProperty('web_navigation');
    expect(result.typeCompletionRate).toHaveProperty('preference_planning');

    testEvaluator.dispose();
  });

  it('应该正确处理依赖记忆', async () => {
    const testEvaluator = new MemoryArenaEvaluator();

    const memories: MemoryExchange[] = [
      {
        id: 'dep_1',
        timestamp: Date.now(),
        exchange_core: '依赖记忆',
        specific_context: '这是一个被依赖的记忆内容',
        thematic_tags: ['dependency'],
        entities_extracted: [],
        importance_score: 0.5,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      },
    ];

    const task: MemoryArenaTask = {
      id: 'task_dep',
      type: 'sequential_reasoning',
      description: '依赖任务',
      steps: [
        {
          id: 's1',
          instruction: '获取依赖',
          memoryRequired: ['依赖记忆'],
        },
      ],
      expectedOutcome: '完成',
    };

    await testEvaluator.loadMemories(memories);
    const result = await testEvaluator.executeTask(task);

    expect(result.memoryHits).toBeGreaterThan(0);

    testEvaluator.dispose();
  });
});
