/**
 * MemLite MCP Server
 *
 * 轻量级Agent记忆系统的MCP服务器实现
 * 提供3层工作流：search → timeline → get_observations
 * Phase 2: 集成压缩引擎和嵌入模型
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SQLiteStore } from '../storage/SQLiteStore.js';
import { RetrievalEngine } from '../core/RetrievalEngine.js';
import { GTEEmbedding } from '../embedding/GTEEmbedding.js';
import {
  DistillationEngine,
  CompressionMode,
} from '../compression/DistillationEngine.js';
import type { MemoryExchange } from '../types/memory.js';
import { DEFAULT_STORAGE_CONFIG } from '../types/memory.js';

// ============================================================================
// Zod Schemas (使用shape格式)
// ============================================================================

const searchInputShape = {
  query: z.string()
    .min(1, '查询不能为空')
    .max(500, '查询不能超过500字符')
    .describe('搜索查询字符串'),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('返回结果数量限制'),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe('分页偏移量'),
  minImportance: z.number()
    .min(0)
    .max(1)
    .optional()
    .describe('最小重要性分数过滤'),
  dateStart: z.number()
    .int()
    .optional()
    .describe('时间范围开始（Unix毫秒时间戳）'),
  dateEnd: z.number()
    .int()
    .optional()
    .describe('时间范围结束（Unix毫秒时间戳）'),
  response_format: z.enum(['markdown', 'json'])
    .default('markdown')
    .describe('输出格式：markdown（人类可读）或 json（机器可读）'),
};

const timelineInputShape = {
  anchor: z.string()
    .optional()
    .describe('锚点记忆ID'),
  depth_before: z.number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe('锚点前获取数量'),
  depth_after: z.number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe('锚点后获取数量'),
};

const getObservationsInputShape = {
  ids: z.array(z.string())
    .min(1, '至少需要一个ID')
    .max(100, '最多100个ID')
    .describe('要获取的记忆ID列表'),
  response_format: z.enum(['markdown', 'json'])
    .default('markdown')
    .describe('输出格式'),
};

const saveMemoryInputShape = {
  text: z.string()
    .min(1, '内容不能为空')
    .max(10000, '内容不能超过10000字符')
    .describe('要记忆的内容'),
  title: z.string()
    .max(200, '标题不能超过200字符')
    .optional()
    .describe('简短标题（可选，从内容自动生成）'),
  project: z.string()
    .max(100, '项目名不能超过100字符')
    .optional()
    .describe('项目名称'),
  obs_type: z.enum(['discovery', 'bugfix', 'feature', 'refactor', 'change', 'decision'])
    .optional()
    .describe('观察类型'),
  importance: z.number()
    .min(0)
    .max(1)
    .optional()
    .describe('重要性评分（0-1）'),
};

// 完整的schema对象
const SearchInputSchema = z.object(searchInputShape).strict();
const TimelineInputSchema = z.object(timelineInputShape).strict();
const GetObservationsInputSchema = z.object(getObservationsInputShape).strict();
const SaveMemoryInputSchema = z.object(saveMemoryInputShape).strict();

// ============================================================================
// 类型定义
// ============================================================================

type SearchInput = z.infer<typeof SearchInputSchema>;
type TimelineInput = z.infer<typeof TimelineInputSchema>;
type GetObservationsInput = z.infer<typeof GetObservationsInputSchema>;
type SaveMemoryInput = z.infer<typeof SaveMemoryInputSchema>;

// ============================================================================
// MCP Server
// ============================================================================

// 全局存储实例
let store: SQLiteStore | null = null;
let engine: RetrievalEngine | null = null;
let compression: DistillationEngine | null = null;
let embedding: GTEEmbedding | null = null;

/**
 * 创建MCP服务器
 */
export function createMCPServer(dbPath?: string): McpServer {
  // 初始化存储和检索引擎
  store = new SQLiteStore({ ...DEFAULT_STORAGE_CONFIG, dbPath: dbPath || ':memory:' });

  // 初始化压缩引擎（快速模式）
  compression = new DistillationEngine({ mode: CompressionMode.FAST });

  // 初始化嵌入模型（延迟加载）
  embedding = new GTEEmbedding();

  // 创建检索引擎
  engine = new RetrievalEngine(store, { enableVectorSearch: false }, embedding);

  // 创建MCP服务器实例
  const server = new McpServer({
    name: 'memlite-mcp-server',
    version: '0.2.0',
  });

  // ==========================================================================
  // Tool: search - 第一层搜索
  // ==========================================================================
  server.registerTool(
    'search',
    {
      title: 'Search Memory',
      description: `搜索记忆库。返回匹配的观察ID列表和简要信息。

这是一个3层工作流的第一步：
1. search(query) → 获取ID列表 (~50-100 tokens/结果)
2. timeline(anchor=ID) → 获取锚点周围的上下文
3. get_observations([IDs]) → 获取完整详情

重要：不要在没有过滤的情况下获取完整详情。这样可以节省10倍的token。`,
      inputSchema: searchInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: SearchInput) => {
      try {
        const result = await engine!.search(params);

        let textContent: string;
        if (params.response_format === 'json') {
          textContent = JSON.stringify(result, null, 2);
        } else {
          const lines = [
            `# 搜索结果: "${params.query}"`,
            '',
            `找到 ${result.total} 条记录 (显示 ${result.count} 条)`,
            '',
          ];

          for (const item of result.items) {
            const date = new Date(item.exchange.timestamp).toLocaleString('zh-CN');
            lines.push(`## #${item.id}`);
            lines.push(`- **时间**: ${date}`);
            lines.push(`- **分数**: ${item.score.toFixed(3)}`);
            lines.push(`- **重要性**: ${item.exchange.importance_score.toFixed(2)}`);
            lines.push(`- **摘要**: ${item.exchange.exchange_core}`);
            if (item.exchange.thematic_tags.length > 0) {
              lines.push(`- **标签**: ${item.exchange.thematic_tags.join(', ')}`);
            }
            lines.push('');
          }

          if (result.has_more) {
            lines.push(`_还有更多结果，使用 offset=${result.next_offset} 获取_`);
          }

          textContent = lines.join('\n');
        }

        return {
          content: [{ type: 'text', text: textContent }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `搜索错误: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ==========================================================================
  // Tool: timeline - 第二层获取上下文
  // ==========================================================================
  server.registerTool(
    'timeline',
    {
      title: 'Get Timeline Context',
      description: `获取锚点周围的时间线上下文。

这是3层工作流的第二步：
- 使用锚点ID获取周围相关的记忆
- 有助于理解特定观察的上下文`,
      inputSchema: timelineInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: TimelineInput) => {
      try {
        const result = await engine!.timeline(params);

        const lines = ['## 时间线上下文', ''];

        if (result.before.length > 0) {
          lines.push('### 之前');
          for (const item of result.before) {
            const date = new Date(item.exchange.timestamp).toLocaleString('zh-CN');
            lines.push(`- **#${item.id}** (${date}): ${item.exchange.exchange_core}`);
          }
          lines.push('');
        }

        if (result.anchor) {
          lines.push('### 锚点');
          const date = new Date(result.anchor.exchange.timestamp).toLocaleString('zh-CN');
          lines.push(`- **#${result.anchor.id}** (${date}): ${result.anchor.exchange.exchange_core}`);
          lines.push('');
        }

        if (result.after.length > 0) {
          lines.push('### 之后');
          for (const item of result.after) {
            const date = new Date(item.exchange.timestamp).toLocaleString('zh-CN');
            lines.push(`- **#${item.id}** (${date}): ${item.exchange.exchange_core}`);
          }
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `时间线错误: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ==========================================================================
  // Tool: get_observations - 第三层获取完整详情
  // ==========================================================================
  server.registerTool(
    'get_observations',
    {
      title: 'Get Full Observations',
      description: `获取完整的观察详情。

这是3层工作流的第三步：
- 仅在过滤后获取完整详情
- 10倍节省token`,
      inputSchema: getObservationsInputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: GetObservationsInput) => {
      try {
        const observations = await engine!.getObservations(params.ids);

        let textContent: string;
        if (params.response_format === 'json') {
          textContent = JSON.stringify({ observations }, null, 2);
        } else {
          const lines = [`# 观察详情 (${observations.length}条)`, ''];

          for (const obs of observations) {
            const date = new Date(obs.timestamp).toLocaleString('zh-CN');
            lines.push(`## #${obs.id}`);
            lines.push(`- **时间**: ${date}`);
            lines.push(`- **核心**: ${obs.exchange_core}`);
            if (obs.specific_context) {
              lines.push(`- **上下文**: ${obs.specific_context}`);
            }
            if (obs.thematic_tags.length > 0) {
              lines.push(`- **标签**: ${obs.thematic_tags.join(', ')}`);
            }
            if (obs.entities_extracted.length > 0) {
              lines.push(`- **实体**: ${obs.entities_extracted.join(', ')}`);
            }
            lines.push(`- **重要性**: ${obs.importance_score.toFixed(2)}`);
            lines.push(`- **访问次数**: ${obs.access_count}`);
            lines.push('');
          }

          textContent = lines.join('\n');
        }

        return {
          content: [{ type: 'text', text: textContent }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `获取观察错误: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ==========================================================================
  // Tool: save_memory - 保存记忆（带自动压缩）
  // ==========================================================================
  server.registerTool(
    'save_memory',
    {
      title: 'Save Memory',
      description: `保存一条新的记忆观察。

用于手动保存重要信息，供语义搜索使用。
支持自动四元组压缩（11倍压缩率）。`,
      inputSchema: saveMemoryInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: SaveMemoryInput) => {
      try {
        // 生成ID
        const id = `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 使用压缩引擎提取四元组
        const compressed = await compression!.compress(params.text);

        // 创建记忆交换（使用压缩结果）
        const exchange: MemoryExchange = {
          id,
          timestamp: Date.now(),
          exchange_core: params.title || compressed.exchange_core,
          specific_context: compressed.specific_context,
          thematic_tags: [
            ...compressed.thematic_tags,
            ...(params.project ? [params.project] : []),
          ],
          entities_extracted: compressed.entities_extracted,
          importance_score: params.importance ?? 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
          raw_content: params.text, // 保留原始内容
          metadata: {
            obs_type: params.obs_type,
            project: params.project,
            compression_ratio: compressed.compression_ratio,
          },
        };

        // 保存记忆（尝试生成嵌入）
        await engine!.saveWithEmbedding(exchange);

        return {
          content: [{
            type: 'text',
            text: `✅ 记忆已保存

ID: ${id}
标题: ${exchange.exchange_core}
压缩率: ${compressed.compression_ratio.toFixed(1)}x
标签: ${exchange.thematic_tags.join(', ')}
实体: ${exchange.entities_extracted.slice(0, 5).join(', ')}${exchange.entities_extracted.length > 5 ? '...' : ''}`,
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `保存记忆错误: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  return server;
}

/**
 * 启动MCP服务器 (stdio模式)
 */
export async function runServer(dbPath?: string): Promise<void> {
  const server = createMCPServer(dbPath);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('MemLite MCP Server v0.2.0 running via stdio');
}
