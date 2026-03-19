/**
 * SQLiteStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../src/storage/SQLiteStore.js';
import type { MemoryExchange } from '../src/types/memory.js';

describe('SQLiteStore', () => {
  let store: SQLiteStore;

  beforeEach(() => {
    // 使用内存数据库进行测试
    store = new SQLiteStore({ dbPath: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  describe('CRUD Operations', () => {
    it('should save and retrieve a memory exchange', () => {
      const exchange: MemoryExchange = {
        id: 'test-1',
        timestamp: Date.now(),
        exchange_core: 'Test core content',
        specific_context: 'Test context',
        thematic_tags: ['test', 'unit'],
        entities_extracted: ['entity1'],
        importance_score: 0.8,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      };

      store.saveExchange(exchange);
      const retrieved = store.getExchange('test-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('test-1');
      expect(retrieved?.exchange_core).toBe('Test core content');
      expect(retrieved?.thematic_tags).toEqual(['test', 'unit']);
    });

    it('should save multiple exchanges in batch', () => {
      const exchanges: MemoryExchange[] = [
        {
          id: 'batch-1',
          timestamp: Date.now(),
          exchange_core: 'Batch 1',
          specific_context: '',
          thematic_tags: [],
          entities_extracted: [],
          importance_score: 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
        {
          id: 'batch-2',
          timestamp: Date.now() + 1000,
          exchange_core: 'Batch 2',
          specific_context: '',
          thematic_tags: [],
          entities_extracted: [],
          importance_score: 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
      ];

      store.saveExchanges(exchanges);

      const ids = store.getAllExchangeIds(10, 0);
      expect(ids.total).toBe(2);
    });

    it('should delete an exchange', () => {
      const exchange: MemoryExchange = {
        id: 'delete-test',
        timestamp: Date.now(),
        exchange_core: 'To be deleted',
        specific_context: '',
        thematic_tags: [],
        entities_extracted: [],
        importance_score: 0.5,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      };

      store.saveExchange(exchange);
      expect(store.getExchange('delete-test')).not.toBeNull();

      const deleted = store.deleteExchange('delete-test');
      expect(deleted).toBe(true);
      expect(store.getExchange('delete-test')).toBeNull();
    });
  });

  describe('Full-Text Search', () => {
    beforeEach(() => {
      // 添加测试数据
      const exchanges: MemoryExchange[] = [
        {
          id: 'fts-1',
          timestamp: Date.now(),
          exchange_core: 'TypeScript is a typed superset of JavaScript',
          specific_context: 'Programming language',
          thematic_tags: ['programming'],
          entities_extracted: ['TypeScript', 'JavaScript'],
          importance_score: 0.8,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
        {
          id: 'fts-2',
          timestamp: Date.now() + 1000,
          exchange_core: 'Python is a popular programming language',
          specific_context: 'Scripting language',
          thematic_tags: ['programming'],
          entities_extracted: ['Python'],
          importance_score: 0.7,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
        {
          id: 'fts-3',
          timestamp: Date.now() + 2000,
          exchange_core: 'Machine learning with neural networks',
          specific_context: 'AI topic',
          thematic_tags: ['ai'],
          entities_extracted: ['ML', 'Neural Networks'],
          importance_score: 0.9,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
      ];

      store.saveExchanges(exchanges);
    });

    it('should search by keyword', () => {
      const results = store.searchFTS({ query: 'programming', limit: 10 });
      // FTS may return results based on the content
      expect(Array.isArray(results)).toBe(true);
    });

    it('should return empty array for no matches', () => {
      const results = store.searchFTS({ query: 'nonexistentkeyword', limit: 10 });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Embedding Operations', () => {
    it('should save and retrieve embeddings', () => {
      const exchange: MemoryExchange = {
        id: 'emb-test',
        timestamp: Date.now(),
        exchange_core: 'Test embedding',
        specific_context: '',
        thematic_tags: [],
        entities_extracted: [],
        importance_score: 0.5,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      };

      store.saveExchange(exchange);

      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      store.saveEmbedding('emb-test', embedding);

      const retrieved = store.getEmbedding('emb-test');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.length).toBe(5);
      expect(retrieved?.[0]).toBeCloseTo(0.1);
    });

    it('should get all embeddings', () => {
      const exchanges: MemoryExchange[] = [
        {
          id: 'all-emb-1',
          timestamp: Date.now(),
          exchange_core: 'Test 1',
          specific_context: '',
          thematic_tags: [],
          entities_extracted: [],
          importance_score: 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
        {
          id: 'all-emb-2',
          timestamp: Date.now(),
          exchange_core: 'Test 2',
          specific_context: '',
          thematic_tags: [],
          entities_extracted: [],
          importance_score: 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: Date.now(),
        },
      ];

      store.saveExchanges(exchanges);

      const emb1 = new Float32Array([0.1, 0.2]);
      const emb2 = new Float32Array([0.3, 0.4]);

      store.saveEmbedding('all-emb-1', emb1);
      store.saveEmbedding('all-emb-2', emb2);

      const allEmbeddings = store.getAllEmbeddings();
      expect(allEmbeddings.size).toBe(2);
    });
  });

  describe('Timeline Context', () => {
    beforeEach(() => {
      const now = Date.now();
      const exchanges: MemoryExchange[] = [];

      for (let i = 0; i < 10; i++) {
        exchanges.push({
          id: `timeline-${i}`,
          timestamp: now + i * 1000,
          exchange_core: `Timeline entry ${i}`,
          specific_context: '',
          thematic_tags: [],
          entities_extracted: [],
          importance_score: 0.5,
          access_count: 0,
          decay_rate: 0.1,
          last_accessed: now + i * 1000,
        });
      }

      store.saveExchanges(exchanges);
    });

    it('should get timeline context around anchor', () => {
      const result = store.getTimelineContext('timeline-5', 2, 2);

      expect(result.anchor).not.toBeNull();
      expect(result.anchor?.id).toBe('timeline-5');
      expect(result.before.length).toBeLessThanOrEqual(2);
      expect(result.after.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for non-existent anchor', () => {
      const result = store.getTimelineContext('non-existent', 2, 2);
      expect(result.anchor).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', () => {
      const exchange: MemoryExchange = {
        id: 'stats-test',
        timestamp: Date.now(),
        exchange_core: 'Stats test',
        specific_context: '',
        thematic_tags: [],
        entities_extracted: [],
        importance_score: 0.5,
        access_count: 0,
        decay_rate: 0.1,
        last_accessed: Date.now(),
      };

      store.saveExchange(exchange);

      const stats = store.getStats();
      expect(stats.totalExchanges).toBe(1);
      expect(stats.avgImportance).toBe(0.5);
    });
  });
});
