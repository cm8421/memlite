import { SQLiteStore } from './src/storage/SQLiteStore.js';
import type { MemoryExchange } from './src/types/memory.js';

const store = new SQLiteStore({ dbPath: ':memory:' });

console.log('测试搜索查询语句...');

// 模拟 LoCoMo 数据
const testMemories: MemoryExchange[] = [
  {
    id: 'locomo_1',
    timestamp: Date.now() - 1000 * 60 * 60,
    exchange_core: 'Caroline went to the LGBTQ support group',
    specific_context: 'Caroline attended the LGBTQ support group on 7 May 2023',
    thematic_tags: ['locomo', 'caroline'],
    entities_extracted: [],
    importance_score: 0.5,
    access_count: 0,
    decay_rate: 0.1,
    last_accessed: Date.now(),
  },
  {
    id: 'locomo_2',
    timestamp: Date.now() - 1000 * 60 * 30,
    exchange_core: 'Melanie painted a sunrise',
    specific_context: 'Melanie painted a beautiful sunrise in 2022',
    thematic_tags: ['locomo', 'melanie'],
    entities_extracted: [],
    importance_score: 0.5,
    access_count: 0,
    decay_rate: 0.1,
    last_accessed: Date.now(),
  },
];

// 批量保存记忆
testMemories.forEach(memory => {
  store.saveExchange(memory);
});

const db = store.getDatabase();

// 直接执行 SQL 查询来测试
console.log('\n=== 直接 SQL 查询测试 ===');

// 测试简单的字符串搜索
const simpleQuery = db.prepare('SELECT * FROM exchanges_fts WHERE exchanges_fts MATCH ?');
try {
  const results = simpleQuery.all('Caroline');
  console.log('搜索 "Caroline" 直接 SQL 结果:', results.length);
} catch (e) {
  console.log('搜索 "Caroline" SQL 错误:', e.message);
}

// 测试 BM25 分数查询
const bm25Query = db.prepare('SELECT e.*, bm25(exchanges_fts) as score FROM exchanges e JOIN exchanges_fts fts ON e.rowid = fts.rowid WHERE exchanges_fts MATCH ? ORDER BY score ASC LIMIT 10');
try {
  const results = bm25Query.all('Caroline');
  console.log('搜索 "Caroline" BM25 结果:', results.length);
  if (results.length > 0) {
    console.log('第一个结果:', results[0]);
  }
} catch (e) {
  console.log('搜索 "Caroline" BM25 SQL 错误:', e.message);
}

// 测试使用 store 的 searchFTS 方法
console.log('\n=== store.searchFTS 方法测试 ===');
const searchResult1 = store.searchFTS({ query: 'Caroline', limit: 10 });
console.log('搜索 "Caroline" store 方法结果:', searchResult1.length);

const searchResult2 = store.searchFTS({ query: 'Melanie', limit: 10 });
console.log('搜索 "Melanie" store 方法结果:', searchResult2.length);

const searchResult3 = store.searchFTS({ query: 'LGBTQ', limit: 10 });
console.log('搜索 "LGBTQ" store 方法结果:', searchResult3.length);

// 测试不同查询语法
console.log('\n=== 测试不同查询语法 ===');
const testQueries = ['Caroline', 'Melanie', '"Melanie sunrise"', 'LGBTQ', 'support group'];
for (const query of testQueries) {
  try {
    const result = store.searchFTS({ query, limit: 5 });
    console.log(`查询 "${query}": ${result.length} 结果`);
  } catch (e) {
    console.log(`查询 "${query}" 错误:`, e.message);
  }
}

// 检查 FTS 表结构
console.log('\n=== FTS 表结构检查 ===');
const ftsInfo = db.prepare('SELECT * FROM exchanges_fts_config').all();
console.log('FTS 配置:', ftsInfo);
