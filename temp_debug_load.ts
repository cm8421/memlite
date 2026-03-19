import { SQLiteStore } from './src/storage/SQLiteStore.js';
import type { MemoryExchange } from './src/types/memory.js';

const store = new SQLiteStore({ dbPath: ':memory:' });

console.log('测试完整的数据加载流程...');

// 模拟 LoCoMo 数据
const testMemories: MemoryExchange[] = [
  {
    id: 'test_locomo_1',
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
    id: 'test_locomo_2',
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
  console.log(`保存记忆: ${memory.id} - ${memory.exchange_core}`);
});

// 检查保存的数据
const savedData = store.getExchanges(testMemories.map(m => m.id));
console.log(`\n总共保存了 ${savedData.length} 条记忆`);

// 测试查询效果
console.log('\n=== 测试各种查询 ===');

// 1. 测试精确关键词匹配
const search1 = store.searchFTS({ query: 'Caroline', limit: 10 });
console.log('搜索 "Caroline":', search1.length > 0 ? '成功' : '失败');

// 2. 测试另一个关键词
const search2 = store.searchFTS({ query: 'LGBTQ', limit: 10 });
console.log('搜索 "LGBTQ":', search2.length > 0 ? '成功' : '失败');

// 3. 测试复合搜索
const search3 = store.searchFTS({ query: 'Melanie sunrise', limit: 10 });
console.log('搜索 "Melanie sunrise":', search3.length > 0 ? '成功' : '失败');

// 4. 测试小写搜索
const search4 = store.searchFTS({ query: 'melanie', limit: 10 });
console.log('搜索 "melanie" (小写):', search4.length > 0 ? '成功' : '失败');

// 5. 测试年份搜索
const search5 = store.searchFTS({ query: '2022', limit: 10 });
console.log('搜索 "2022":', search5.length > 0 ? '成功' : '失败');

// 6. 测试复杂问题
const search6 = store.searchFTS({ query: 'Caroline support group', limit: 10 });
console.log('搜索 "Caroline support group":', search6.length > 0 ? '成功' : '失败');

// 7. 测试完全不相关的搜索
const search7 = store.searchFTS({ query: 'banana', limit: 10 });
console.log('搜索 "banana" (不相关):', search7.length > 0 ? '失败 - 应该有结果' : '成功 - 确实没有结果');

// 检查 FT5 触发器是否正常工作
console.log('\n=== 检查 FTS 触发器 ===');
const db = store.getDatabase();
const ftsCount = db.prepare('SELECT COUNT(*) as count FROM exchanges_fts').get();
console.log('FTS 表中的记录数:', ftsCount.count);

const exchangesCount = db.prepare('SELECT COUNT(*) as count FROM exchanges').get();
console.log('Exchanges 表中的记录数:', exchangesCount.count);

if (ftsCount.count !== exchangesCount.count) {
  console.log('警告: FTS 表记录数与 exchanges 表不匹配!');
} else {
  console.log('✅ FTS 触发器正常工作');
}
