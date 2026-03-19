#!/usr/bin/env node
/**
 * MemLite - 轻量级Agent记忆系统
 *
 * MCP服务器入口点
 * 使用方法：
 *   npx memlite-mcp-server
 *   或
 *   node dist/index.js
 *
 * 环境变量：
 *   MEMLITE_DB_PATH - 数据库文件路径 (默认: 内存数据库)
 */

import { runServer } from './mcp/server.js';

// 获取数据库路径（如果设置）
const dbPath = process.env.MEMLITE_DB_PATH;

// 启动服务器
runServer(dbPath).catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
