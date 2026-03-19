
import { SQLiteStore } from './src/storage/SQLiteStore.js';
import type { MemoryExchange } from './src/types/memory.js';

const store = new SQLiteStore({ dbPath: ':memory:' });

console.log('数据库初始化完成');

// 检查表结构
const db = store.getDatabase();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('数据库表:', tables.map(t => t.name));

// 检查 FTS 表是否存在
const ftsTables = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%fts%'").all();
console.log('FTS 表:', ftsTables.map(t => t.name));

// 添加一条测试数据
const testExchange: MemoryExchange = {
  id: 'test_1',
  timestamp: Date.now(),
  exchange_core: 'Hello world',
  specific_context: 'This is a test conversation',
  thematic_tags: ['test'],
  entities_extracted: [],
  importance_score: 0.5,
  access_count: 0,
  decay_rate: 0.1,
  last_accessed: Date.now(),
};

store.saveExchange(testExchange);
console.log('测试数据保存完成');

// 检查数据是否正确保存
const savedData = db.prepare('SELECT * FROM exchanges').all();
console.log('交换表数据数量:', savedData.length);

// 检查 FTS 表是否有数据
const ftsData = db.prepare('SELECT * FROM exchanges_fts').all();
console.log('FTS 表数据数量:', ftsData.length);

// 测试搜索
const searchResult = store.searchFTS({ query: 'hello', limit: 10 });
console.log('搜索 "hello" 结果数量:', searchResult.length);

// 测试其他搜索查询
const search2 = store.searchFTS({ query: 'world', limit: 10 });
console.log('搜索 "world" 结果数量:', search2.length);

// 测试 BM25 分数
const search4 = store.searchFTS({ query: 'hello world conversation', limit: 10 });
console.log('搜索 "hello world conversation" 结果:', search4);

