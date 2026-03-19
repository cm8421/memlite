import { SQLiteStore } from './src/storage/SQLiteStore.js';
import type { MemoryExchange } from './src/types/memory.js';

const store = new SQLiteStore({ dbPath: ':memory:' });

console.log('测试基准测试中的关键词匹配逻辑...');

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

// 模拟基准测试中的关键词匹配逻辑
function testKeywordMatching(question: string, answer: string) {
  console.log(`\n=== 测试问题: "${question}" ===`);
  console.log(`预期答案: "${answer}" ===`);
  
  // 模拟基准测试中的检索
  const searchResult = store.searchFTS({ query: question, limit: 10 });
  
  console.log(`检索到 ${searchResult.length} 条结果`);
  
  // 模拟基准测试中的关键词匹配算法
  const answerLower = answer.toLowerCase();
  const keywords = answerLower.split(/\s+/).filter(w => w.length > 3);
  console.log(`提取的关键词: ${keywords.join(', ')}`);
  
  let foundMatch = false;
  for (const item of searchResult) {
    const content = item.exchange.specific_context?.toLowerCase() || '';
    const core = item.exchange.exchange_core.toLowerCase();
    
    console.log(`检查记忆: "${core}"`);
    
    // 检查是否有任何关键词匹配
    const hasKeyword = keywords.some(kw => {
      const foundInContent = content.includes(kw);
      const foundInCore = core.includes(kw);
      console.log(`  关键词 "${kw}": content=${foundInContent}, core=${foundInCore}`);
      return foundInContent || foundInCore;
    });
    
    if (hasKeyword) {
      foundMatch = true;
      console.log(`  匹配成功!`);
      break;
    } else {
      console.log(`  没有匹配`);
    }
  }
  
  console.log(`最终结果: ${foundMatch ? '成功' : '失败'}`);
  return foundMatch;
}

// 测试几个基准测试案例
testKeywordMatching('When did Caroline go to the LGBTQ support group?', '7 May 2023');
testKeywordMatching('When did Melanie paint a sunrise?', '2022');
testKeywordMatching('What is Caroline\'s identity?', 'Transgender woman');
testKeywordMatching('What did Caroline research?', 'Adoption agencies');

// 测试一个复杂案例
console.log('\n=== 测试复杂案例 ===');
testKeywordMatching('What fields would Caroline be likely to pursue in her education?', 'Psychology, counseling certification');
