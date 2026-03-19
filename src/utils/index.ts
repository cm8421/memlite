/**
 * MemLite 通用工具函数
 */

// ============================================================================
// 数学工具
// ============================================================================

/**
 * 数值边界限制
 */
export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ============================================================================
// ID生成
// ============================================================================

/**
 * 生成带前缀的ID
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

// ============================================================================
// 字符串工具
// ============================================================================

/**
 * 截断字符串
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 生成哈希键
 */
export function hashKey(text: string): string {
  // 使用更快的哈希方式
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// LRU缓存
// ============================================================================

export interface LRUCacheOptions<K, V> {
  maxSize: number;
  onEvict?: (key: K, value: V) => void;
}

export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;
  private readonly onEvict?: (key: K, value: V) => void;

  constructor(options: LRUCacheOptions<K, V>) {
    this.maxSize = options.maxSize;
    this.onEvict = options.onEvict;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.cache.get(oldestKey);
        this.cache.delete(oldestKey);
        if (evicted !== undefined && this.onEvict) {
          this.onEvict(oldestKey, evicted);
        }
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const value = this.cache.get(key);
    const deleted = this.cache.delete(key);
    if (deleted && value !== undefined && this.onEvict) {
      this.onEvict(key, value);
    }
    return deleted;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.cache) {
        this.onEvict(key, value);
      }
    }
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  values(): V[] {
    return Array.from(this.cache.values());
  }

  entries(): [K, V][] {
    return Array.from(this.cache.entries());
  }
}

// ============================================================================
// 滑动窗口统计
// ============================================================================

export class RollingWindow {
  private values: number[];
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.values = [];
  }

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.maxSize) {
      this.values.shift();
    }
  }

  get average(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }

  get max(): number {
    if (this.values.length === 0) return 0;
    return Math.max(...this.values);
  }

  get min(): number {
    if (this.values.length === 0) return 0;
    return Math.min(...this.values);
  }

  get length(): number {
    return this.values.length;
  }

  clear(): void {
    this.values = [];
  }
}

// ============================================================================
// 停用词
// ============================================================================

export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing',
  'done', 'for', 'from', 'had', 'has', 'have', 'having', 'he',
  'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'might', 'more', 'most', 'my', 'myself', 'no',
  'not', 'of', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
  'ourselves', 'out', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to',
  'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
]);

// ============================================================================
// 常用正则模式
// ============================================================================

export const PATTERNS = {
  // 代码检测
  code: /```|function|class|const|let|var|import|export|interface|type|enum|async|await/i,

  // 问句检测
  question: /\?|what|how|why|when|where|who|which|whose/i,

  // 敏感信息
  sensitive: /(?:password|passwd|pwd)|(?:api[_-]?key)|(?:token|secret|bearer|credential|authorization)/gi,
};

// ============================================================================
// 数组工具
// ============================================================================

/**
 * O(1) 索引查找的数组包装
 */
export class IndexedArray<T> {
  private items: T[] = [];
  private indexMap: Map<string, number> = new Map();
  private idExtractor: (item: T) => string;

  constructor(idExtractor: (item: T) => string) {
    this.idExtractor = idExtractor;
  }

  push(item: T): void {
    const id = this.idExtractor(item);
    if (!this.indexMap.has(id)) {
      this.indexMap.set(id, this.items.length);
      this.items.push(item);
    }
  }

  get(id: string): T | undefined {
    const index = this.indexMap.get(id);
    return index !== undefined ? this.items[index] : undefined;
  }

  remove(id: string): boolean {
    const index = this.indexMap.get(id);
    if (index === undefined) return false;

    // O(1) removal by swapping with last
    const lastIndex = this.items.length - 1;
    if (index !== lastIndex) {
      const lastItem = this.items[lastIndex];
      this.items[index] = lastItem;
      this.indexMap.set(this.idExtractor(lastItem), index);
    }
    this.items.pop();
    this.indexMap.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.indexMap.has(id);
  }

  get length(): number {
    return this.items.length;
  }

  values(): T[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
    this.indexMap.clear();
  }
}
