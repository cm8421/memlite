/**
 * 关键词提取工具
 *
 * 用于基准测试的智能关键词提取，替代简单的长度过滤
 */

// 英文停用词列表
const ENGLISH_STOPWORDS = new Set([
  // 基本停用词
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'where', 'why', 'how', 'all',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can',
  'will', 'just', 'should', 'now', 'also', 'been', 'being', 'have',
  'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'would', 'could',
  'ought', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his',
  'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who',
  'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was',
  'were', 'be', 'because', 'as', 'until', 'while', 'of', 'both',
  // 常见无意义词
  'like', 'get', 'got', 'go', 'goes', 'went', 'come', 'came', 'make',
  'made', 'take', 'took', 'see', 'saw', 'know', 'knew', 'think', 'thought',
  'want', 'needs', 'need', 'say', 'said', 'tell', 'told', 'ask', 'asked',
  'look', 'looking', 'looked', 'use', 'used', 'using', 'try', 'tried',
]);

// 月份名称
const MONTH_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

// 星期名称
const DAY_NAMES = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
]);

/**
 * 判断是否为数字（包括纯数字字符串）
 */
function isNumber(word: string): boolean {
  return /^\d+(\.\d+)?$/.test(word);
}

/**
 * 判断是否为日期相关词
 */
function isDateRelated(word: string): boolean {
  const lower = word.toLowerCase();
  return MONTH_NAMES.has(lower) || DAY_NAMES.has(lower);
}

/**
 * 判断是否为年份
 */
function isYear(word: string): boolean {
  return /^(19|20)\d{2}$/.test(word);
}

/**
 * 判断是否为特殊格式（时间、电话、邮箱等）
 */
function isSpecialFormat(word: string): boolean {
  // 时间格式 (HH:MM, HH:MM AM/PM)
  if (/^\d{1,2}:\d{2}(\s*(am|pm|AM|PM))?$/.test(word)) return true;
  // 电话号码格式
  if (/^\+?[\d\-()]{7,}$/.test(word)) return true;
  // 邮箱格式
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(word)) return true;
  // URL格式
  if (/^https?:\/\//.test(word)) return true;
  return false;
}

/**
 * 清理单词（移除标点符号）
 */
function cleanWord(word: string): string {
  // 移除首尾标点
  return word.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
}

/**
 * 提取关键词
 *
 * 策略：
 * 1. 保留所有数字（如 "7", "2023"）
 * 2. 保留月份和星期名称
 * 3. 保留年份（1900-2099）
 * 4. 保留特殊格式（时间、电话、邮箱）
 * 5. 过滤停用词
 * 6. 保留长度 >= 2 的有意义词
 */
export function extractKeywords(text: string): string[] {
  // 类型检查
  if (!text || typeof text !== 'string') return [];

  // 按空白分割
  const words = text.split(/\s+/);
  const keywords: string[] = [];

  for (const rawWord of words) {
    const word = cleanWord(rawWord);
    if (!word) continue;

    // 1. 保留数字
    if (isNumber(word)) {
      keywords.push(word);
      continue;
    }

    // 2. 保留日期相关词
    if (isDateRelated(word)) {
      keywords.push(word);
      continue;
    }

    // 3. 保留年份
    if (isYear(word)) {
      keywords.push(word);
      continue;
    }

    // 4. 保留特殊格式
    if (isSpecialFormat(word)) {
      keywords.push(word);
      continue;
    }

    // 5. 过滤停用词
    if (ENGLISH_STOPWORDS.has(word)) {
      continue;
    }

    // 6. 保留长度 >= 2 的有意义词
    if (word.length >= 2) {
      keywords.push(word);
    }
  }

  return [...new Set(keywords)]; // 去重
}

/**
 * 检查关键词是否在文本中匹配
 *
 * @param keywords 关键词列表
 * @param text 要搜索的文本
 * @param minMatches 最少匹配数量（默认 1）
 * @returns 匹配的关键词列表
 */
export function matchKeywords(
  keywords: string[],
  text: string,
  minMatches: number = 1
): string[] {
  if (!text || keywords.length === 0) return [];

  const textLower = text.toLowerCase();
  const matches: string[] = [];

  for (const keyword of keywords) {
    if (textLower.includes(keyword)) {
      matches.push(keyword);
    }
  }

  return matches.length >= minMatches ? matches : [];
}

/**
 * 计算关键词匹配率
 */
export function calculateMatchRate(
  keywords: string[],
  text: string
): number {
  if (keywords.length === 0) return 0;

  const matches = matchKeywords(keywords, text);
  return matches.length / keywords.length;
}

/**
 * 判断答案是否被成功检索
 *
 * @param answer 预期答案（可以是字符串、数字或其他类型）
 * @param content 检索到的内容
 * @param threshold 匹配阈值（默认 0.2，即至少匹配 20% 关键词）
 */
export function isAnswerRetrieved(
  answer: string | number | any,
  content: string,
  threshold: number = 0.2
): boolean {
  // 参数验证
  if (answer === null || answer === undefined || !content) {
    return false;
  }

  // 将答案转换为字符串
  const answerStr = String(answer);

  const keywords = extractKeywords(answerStr);

  if (keywords.length === 0) {
    // 如果无法提取关键词，使用原始字符串匹配
    const contentLower = content.toLowerCase();
    const answerLower = answerStr.toLowerCase();
    return contentLower.includes(answerLower);
  }

  // 特殊处理：如果只有 1-2 个关键词，只要匹配 1 个就算成功
  if (keywords.length <= 2) {
    const matches = matchKeywords(keywords, content);
    return matches.length >= 1;
  }

  // 对于更多关键词，使用阈值
  const matchRate = calculateMatchRate(keywords, content);
  return matchRate >= threshold;
}
