/**
 * MemLite SQLite 存储层
 *
 * 使用 better-sqlite3 + sqlite-vec 实现高性能向量存储
 * 支持混合检索：向量相似度 + BM25全文搜索
 */

import Database from 'better-sqlite3';
import type {
  MemoryExchange,
  SearchParams,
  SearchResult,
  StorageConfig,
} from '../types/memory.js';
import { DEFAULT_STORAGE_CONFIG } from '../types/memory.js';

/**
 * SQLite存储类
 */
export class SQLiteStore {
  private db: Database.Database;
  private config: StorageConfig;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.db = new Database(this.config.dbPath);
    this.initializeSchema();
  }

  /**
   * 初始化数据库Schema
   */
  private initializeSchema(): void {
    // 启用外键约束
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // 创建记忆交换表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exchanges (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,

        -- 四元组结构
        exchange_core TEXT NOT NULL,
        specific_context TEXT,
        thematic_tags TEXT,  -- JSON array
        entities_extracted TEXT,  -- JSON array

        -- 遗忘曲线参数
        importance_score REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        decay_rate REAL DEFAULT 0.1,
        last_accessed INTEGER,

        -- 原始数据
        raw_content TEXT,
        metadata TEXT,  -- JSON object

        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_exchanges_timestamp ON exchanges(timestamp);
      CREATE INDEX IF NOT EXISTS idx_exchanges_importance ON exchanges(importance_score);
      CREATE INDEX IF NOT EXISTS idx_exchanges_last_accessed ON exchanges(last_accessed);
    `);

    // 创建向量嵌入表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        exchange_id TEXT NOT NULL UNIQUE,
        embedding BLOB NOT NULL,  -- Float32 array as blob
        model TEXT DEFAULT 'gte-small-int8',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),

        FOREIGN KEY (exchange_id) REFERENCES exchanges(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_exchange ON embeddings(exchange_id);
    `);

    // 创建全文搜索虚拟表（FTS5）
    if (this.config.enableFTS) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS exchanges_fts USING fts5(
          exchange_core,
          specific_context,
          content='exchanges',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );

        -- FTS5 触发器：插入
        CREATE TRIGGER IF NOT EXISTS exchanges_fts_insert AFTER INSERT ON exchanges BEGIN
          INSERT INTO exchanges_fts(rowid, exchange_core, specific_context)
          VALUES (NEW.rowid, NEW.exchange_core, NEW.specific_context);
        END;

        -- FTS5 触发器：删除
        CREATE TRIGGER IF NOT EXISTS exchanges_fts_delete AFTER DELETE ON exchanges BEGIN
          INSERT INTO exchanges_fts(exchanges_fts, rowid, exchange_core, specific_context)
          VALUES ('delete', OLD.rowid, OLD.exchange_core, OLD.specific_context);
        END;

        -- FTS5 触发器：更新
        CREATE TRIGGER IF NOT EXISTS exchanges_fts_update AFTER UPDATE ON exchanges BEGIN
          INSERT INTO exchanges_fts(exchanges_fts, rowid, exchange_core, specific_context)
          VALUES ('delete', OLD.rowid, OLD.exchange_core, OLD.specific_context);
          INSERT INTO exchanges_fts(rowid, exchange_core, specific_context)
          VALUES (NEW.rowid, NEW.exchange_core, NEW.specific_context);
        END;
      `);
    }

    // 创建sqlite-vec虚拟表（如果可用）
    // 注意：sqlite-vec需要额外加载扩展
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
          exchange_id TEXT PRIMARY KEY,
          embedding FLOAT[${this.config.vectorDimension}]
        );
      `);
    } catch {
      // sqlite-vec扩展未加载，使用纯JS向量计算
      console.error('sqlite-vec extension not available, using JS fallback for vector search');
    }
  }

  // ==========================================================================
  // CRUD 操作
  // ==========================================================================

  /**
   * 保存记忆交换
   */
  saveExchange(exchange: MemoryExchange): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO exchanges (
        id, timestamp, exchange_core, specific_context,
        thematic_tags, entities_extracted,
        importance_score, access_count, decay_rate, last_accessed,
        raw_content, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      exchange.id,
      exchange.timestamp,
      exchange.exchange_core,
      exchange.specific_context || null,
      JSON.stringify(exchange.thematic_tags || []),
      JSON.stringify(exchange.entities_extracted || []),
      exchange.importance_score ?? 0.5,
      exchange.access_count ?? 0,
      exchange.decay_rate ?? 0.1,
      exchange.last_accessed || Date.now(),
      exchange.raw_content || null,
      exchange.metadata ? JSON.stringify(exchange.metadata) : null
    );
  }

  /**
   * 批量保存
   */
  saveExchanges(exchanges: MemoryExchange[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO exchanges (
        id, timestamp, exchange_core, specific_context,
        thematic_tags, entities_extracted,
        importance_score, access_count, decay_rate, last_accessed,
        raw_content, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: MemoryExchange[]) => {
      for (const exchange of items) {
        stmt.run(
          exchange.id,
          exchange.timestamp,
          exchange.exchange_core,
          exchange.specific_context || null,
          JSON.stringify(exchange.thematic_tags || []),
          JSON.stringify(exchange.entities_extracted || []),
          exchange.importance_score ?? 0.5,
          exchange.access_count ?? 0,
          exchange.decay_rate ?? 0.1,
          exchange.last_accessed || Date.now(),
          exchange.raw_content || null,
          exchange.metadata ? JSON.stringify(exchange.metadata) : null
        );
      }
    });

    insertMany(exchanges);
  }

  /**
   * 获取单个记忆
   */
  getExchange(id: string): MemoryExchange | null {
    const stmt = this.db.prepare(`
      SELECT * FROM exchanges WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    return row ? this.rowToExchange(row) : null;
  }

  /**
   * 批量获取记忆
   */
  getExchanges(ids: string[]): MemoryExchange[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM exchanges WHERE id IN (${placeholders})
    `);
    const rows = stmt.all(...ids) as any[];
    return rows.map(row => this.rowToExchange(row));
  }

  /**
   * 删除记忆
   */
  deleteExchange(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM exchanges WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * 获取所有记忆ID列表
   */
  getAllExchangeIds(limit = 100, offset = 0): { ids: string[]; total: number } {
    const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM exchanges');
    const { total } = countStmt.get() as { total: number };

    const stmt = this.db.prepare(`
      SELECT id FROM exchanges ORDER BY timestamp DESC LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(limit, offset) as { id: string }[];

    return {
      ids: rows.map(r => r.id),
      total,
    };
  }

  // ==========================================================================
  // 检索操作
  // ==========================================================================

  /**
   * 全文搜索（BM25）
   */
  searchFTS(params: SearchParams): SearchResult[] {
    if (!this.config.enableFTS) {
      return [];
    }

    const limit = params.limit ?? 20;

    // 清理查询：移除 FTS5 特殊字符
    // FTS5 特殊字符: ? * " ' ( ) { } [ ] ^ - + : | ! ~
    const cleanQuery = params.query
      .replace(/[?*"'\(\)\{\}\[\]\^\-\+\:\|!~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanQuery) {
      return [];
    }

    // FTS5 关键词处理：保留有意义的词，过滤常见停用词
    const stopwords = new Set([
      'a', 'an', 'the', 'and', 'but', 'if', 'then', 'else', 'when',
      'at', 'by', 'for', 'with', 'about', 'to', 'from', 'in', 'out', 'on',
      'off', 'up', 'down', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
      'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
      'these', 'those', 'what', 'which', 'who', 'whom', 'how', 'why', 'where',
      'go', 'goes', 'went', 'come', 'came', 'get', 'got', 'make', 'made',
      'take', 'took', 'see', 'saw', 'know', 'knew', 'think', 'thought',
      'want', 'tell', 'told', 'say', 'said', 'ask', 'asked', 'does',
    ]);

    const keywords = cleanQuery
      .split(/\s+/)
      .filter(word => word.length > 1 && !stopwords.has(word.toLowerCase()))
      .slice(0, 10);  // 最多保留 10 个关键词

    if (keywords.length === 0) {
      return [];
    }

    // FTS5 查询：使用显式 OR 语法
    // 对于多个关键词，使用 OR 连接以获得更宽松的匹配
    const ftsQuery = keywords.join(' OR ');

    const stmt = this.db.prepare(`
      SELECT
        e.id,
        e.exchange_core,
        e.specific_context,
        e.thematic_tags,
        e.entities_extracted,
        e.importance_score,
        e.access_count,
        e.decay_rate,
        e.last_accessed,
        e.timestamp,
        e.raw_content,
        e.metadata,
        bm25(exchanges_fts) as bm25_score
      FROM exchanges e
      JOIN exchanges_fts fts ON e.rowid = fts.rowid
      WHERE exchanges_fts MATCH ?
      ORDER BY bm25_score ASC
      LIMIT ?
    `);

    try {
      const rows = stmt.all(ftsQuery, limit) as any[];
      return rows.map(row => ({
        id: row.id,
        score: this.normalizeBM25Score(row.bm25_score),
        exchange: this.rowToExchange(row),
      }));
    } catch {
      // FTS查询可能失败（如特殊字符）
      return [];
    }
  }

  /**
   * 获取时间线上下文
   */
  getTimelineContext(
    anchorId: string,
    depthBefore = 5,
    depthAfter = 5
  ): { before: SearchResult[]; anchor: SearchResult | null; after: SearchResult[] } {
    // 获取锚点
    const anchorStmt = this.db.prepare('SELECT * FROM exchanges WHERE id = ?');
    const anchorRow = anchorStmt.get(anchorId) as any;

    if (!anchorRow) {
      return { before: [], anchor: null, after: [] };
    }

    const anchorTimestamp = anchorRow.timestamp;

    // 获取之前的记忆
    const beforeStmt = this.db.prepare(`
      SELECT * FROM exchanges
      WHERE timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const beforeRows = beforeStmt.all(anchorTimestamp, depthBefore) as any[];

    // 获取之后的记忆
    const afterStmt = this.db.prepare(`
      SELECT * FROM exchanges
      WHERE timestamp > ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    const afterRows = afterStmt.all(anchorTimestamp, depthAfter) as any[];

    return {
      before: beforeRows.map(row => ({
        id: row.id,
        score: 1,
        exchange: this.rowToExchange(row),
      })),
      anchor: {
        id: anchorRow.id,
        score: 1,
        exchange: this.rowToExchange(anchorRow),
      },
      after: afterRows.map(row => ({
        id: row.id,
        score: 1,
        exchange: this.rowToExchange(row),
      })),
    };
  }

  /**
   * 更新访问统计
   */
  updateAccessStats(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE exchanges
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  /**
   * 应用遗忘曲线衰减
   */
  applyDecay(): number {
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    // 计算衰减后的重要性
    const stmt = this.db.prepare(`
      UPDATE exchanges
      SET importance_score = importance_score * (1 - decay_rate * (? - last_accessed) / ?)
      WHERE last_accessed < ?
    `);

    const result = stmt.run(now, dayInMs, now - dayInMs);
    return result.changes;
  }

  /**
   * 清理低重要性记忆
   */
  cleanupLowImportance(threshold = 0.1): number {
    const stmt = this.db.prepare(`
      DELETE FROM exchanges WHERE importance_score < ?
    `);
    const result = stmt.run(threshold);
    return result.changes;
  }

  // ==========================================================================
  // 嵌入向量操作
  // ==========================================================================

  /**
   * 保存嵌入向量
   */
  saveEmbedding(exchangeId: string, embedding: Float32Array, model = 'gte-small-int8'): void {
    const id = `emb_${exchangeId}`;
    const buffer = Buffer.from(embedding.buffer);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (id, exchange_id, embedding, model)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, exchangeId, buffer, model);
  }

  /**
   * 获取嵌入向量
   */
  getEmbedding(exchangeId: string): Float32Array | null {
    const stmt = this.db.prepare(`
      SELECT embedding FROM embeddings WHERE exchange_id = ?
    `);
    const row = stmt.get(exchangeId) as { embedding: Buffer } | undefined;

    if (!row) return null;
    return new Float32Array(row.embedding.buffer);
  }

  /**
   * 获取所有嵌入向量
   */
  getAllEmbeddings(): Map<string, Float32Array> {
    const stmt = this.db.prepare('SELECT exchange_id, embedding FROM embeddings');
    const rows = stmt.all() as { exchange_id: string; embedding: Buffer }[];

    const map = new Map<string, Float32Array>();
    for (const row of rows) {
      map.set(row.exchange_id, new Float32Array(row.embedding.buffer));
    }
    return map;
  }

  // ==========================================================================
  // 工具方法
  // ==========================================================================

  /**
   * 行数据转MemoryExchange对象
   */
  private rowToExchange(row: any): MemoryExchange {
    return {
      id: row.id,
      timestamp: row.timestamp,
      exchange_core: row.exchange_core,
      specific_context: row.specific_context || '',
      thematic_tags: JSON.parse(row.thematic_tags || '[]'),
      entities_extracted: JSON.parse(row.entities_extracted || '[]'),
      importance_score: row.importance_score,
      access_count: row.access_count,
      decay_rate: row.decay_rate,
      last_accessed: row.last_accessed,
      raw_content: row.raw_content || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * 归一化BM25分数 (负数转0-1)
   */
  private normalizeBM25Score(bm25Score: number): number {
    // BM25分数通常是负数（越小越好），转换为0-1
    return 1 / (1 + Math.exp(bm25Score / 10));
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalExchanges: number;
    totalEmbeddings: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
    avgImportance: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest,
        AVG(importance_score) as avg_importance
      FROM exchanges
    `).get() as any;

    const embStats = this.db.prepare('SELECT COUNT(*) as total FROM embeddings').get() as any;

    return {
      totalExchanges: stats.total || 0,
      totalEmbeddings: embStats.total || 0,
      oldestTimestamp: stats.oldest || null,
      newestTimestamp: stats.newest || null,
      avgImportance: stats.avg_importance || 0,
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }

  /**
   * 获取原始数据库实例（用于高级操作）
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}

export default SQLiteStore;
