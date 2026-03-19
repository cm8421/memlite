#!/usr/bin/env node
/**
 * MemLite CLI - 命令行接口
 *
 * 用法：
 *   npx memlite hook --event=prompt --query="用户输入"
 *   npx memlite hook --event=response --prompt="用户输入" --response="助手响应"
 *   npx memlite stats
 *   npx memlite search "关键词"
 */

import { parseArgs } from 'util';
import { SQLiteStore } from './storage/SQLiteStore.js';
import { RetrievalEngine } from './core/RetrievalEngine.js';
import { HookManager } from './hooks/HookManager.js';
import { SilentMode } from './config/SilentMode.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('MemLite CLI - 轻量级 Agent 记忆系统');
    console.log('');
    console.log('用法：');
    console.log('  memlite hook --event=prompt --query="..."     处理提示 hook');
    console.log('  memlite hook --event=response --prompt="..."   处理响应 hook');
    console.log('  memlite stats                                  查看记忆统计');
    console.log('  memlite search "关键词"                         搜索记忆');
    console.log('');
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'hook':
      await handleHookCommand(args.slice(1));
      break;
    case 'stats':
      await handleStatsCommand();
      break;
    case 'search':
      await handleSearchCommand(args.slice(1));
      break;
    default:
      console.error(`未知命令: ${command}`);
      process.exit(1);
  }
}

async function handleHookCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      event: { type: 'string', short: 'e' },
      query: { type: 'string', short: 'q' },
      prompt: { type: 'string', short: 'p' },
      response: { type: 'string', short: 'r' },
    },
  });

  const event = values.event as 'prompt' | 'response';

  if (!event) {
    console.error('错误: --event 参数是必需的');
    process.exit(1);
  }

  // 初始化组件
  const store = new SQLiteStore();
  const engine = new RetrievalEngine(store, { enableVectorSearch: false });
  const silentMode = SilentMode.fromEnv();
  const hookManager = new HookManager(store, engine, silentMode);

  try {
    let result;

    if (event === 'prompt') {
      const query = values.query || values.prompt;
      if (!query) {
        console.error('错误: --query 参数是必需的');
        process.exit(1);
      }
      result = await hookManager.handleHook('prompt', {
        prompt: query,
        timestamp: Date.now(),
      });
    } else if (event === 'response') {
      const prompt = values.prompt;
      const response = values.response;
      if (!prompt || !response) {
        console.error('错误: --prompt 和 --response 参数都是必需的');
        process.exit(1);
      }
      result = await hookManager.handleHook('response', {
        prompt,
        response,
        timestamp: Date.now(),
      });
    } else {
      console.error(`未知事件类型: ${event}`);
      process.exit(1);
    }

    // 输出 JSON 结果（供 Claude Code hooks 解析）
    console.log(JSON.stringify(result));
  } finally {
    store.close();
  }
}

async function handleStatsCommand() {
  const store = new SQLiteStore();
  const stats = store.getStats();

  console.log('MemLite 记忆统计');
  console.log('================');
  console.log(`总记忆数: ${stats.totalExchanges}`);
  console.log(`总嵌入数: ${stats.totalEmbeddings}`);
  console.log(`最早记忆: ${stats.oldestTimestamp ? new Date(stats.oldestTimestamp).toLocaleString() : 'N/A'}`);
  console.log(`最新记忆: ${stats.newestTimestamp ? new Date(stats.newestTimestamp).toLocaleString() : 'N/A'}`);
  console.log(`平均重要性: ${stats.avgImportance.toFixed(3)}`);

  store.close();
}

async function handleSearchCommand(args: string[]) {
  if (args.length === 0) {
    console.error('错误: 搜索关键词是必需的');
    process.exit(1);
  }

  const query = args.join(' ');

  const store = new SQLiteStore();
  const engine = new RetrievalEngine(store, { enableVectorSearch: false });

  const result = await engine.search({ query, limit: 10 });

  console.log(`搜索结果 (${result.items.length} 条)`);
  console.log('================');

  for (const item of result.items) {
    console.log(`\n[${item.id}] (相似度: ${(item.score * 100).toFixed(1)}%)`);
    console.log(item.exchange.exchange_core);
  }

  store.close();
}

main().catch((error) => {
  console.error('错误:', error.message);
  process.exit(1);
});
