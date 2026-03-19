import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// 读取真实的 LoCoMo 数据集
const dataPath = 'data/benchmarks/locomo10.json';
if (existsSync(dataPath)) {
  const content = readFileSync(dataPath, 'utf-8');
  const data = JSON.parse(content);
  
  console.log(`LoCoMo 数据集包含 ${data.length} 个对话`);
  
  // 分析第一个对话的结构
  const firstConv = data[0];
  console.log('\n=== 第一个对话结构 ===');
  console.log('对话ID:', firstConv.sample_id);
  console.log('对话键:', Object.keys(firstConv.conversation));
  
  // 检查第一个对话的内容
  const conversationKeys = Object.keys(firstConv.conversation).filter(k => k.startsWith('session_') && !k.includes('_date') && !k.includes('_observation'));
  console.log('会话键:', conversationKeys);
  
  if (conversationKeys.length > 0) {
    const firstSessionKey = conversationKeys[0];
    const firstSession = firstConv.conversation[firstSessionKey];
    console.log('第一个会话长度:', firstSession.length);
    console.log('第一个会话的第一个turn:', firstSession[0]);
    
    // 检查第一个 QA
    if (firstConv.qa && firstConv.qa.length > 0) {
      console.log('\n=== 第一个 QA ===');
      console.log('问题:', firstConv.qa[0].question);
      console.log('答案:', firstConv.qa[0].answer);
      
      // 测试用真实数据的关键词
      const answer = firstConv.qa[0].answer.toLowerCase();
      const keywords = answer.split(/\s+/).filter(w => w.length > 3);
      console.log('关键词:', keywords);
      
      // 检查这些关键词是否存在于我们加载的数据中
      const firstText = firstSession[0].text.toLowerCase();
      console.log('第一个turn文本:', firstText);
      
      for (const kw of keywords) {
        const found = firstText.includes(kw);
        console.log(`关键词 "${kw}" 在文本中: ${found}`);
      }
    }
  }
  
  // 检查数据加载时是否有问题
  console.log('\n=== 数据加载分析 ===');
  console.log('第一个对话的conversation结构:');
  console.log(JSON.stringify(firstConv.conversation, null, 2));
  
} else {
  console.log('数据集文件不存在');
}
