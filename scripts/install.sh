#!/bin/bash
# MemLite 一键安装脚本
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/your-username/memlite/main/scripts/install.sh | bash
#   或者
#   ./scripts/install.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================"
echo "MemLite 安装向导"
echo "================================================"

# 检查 Node.js 版本
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 错误: 未找到 Node.js${NC}"
    echo "请先安装 Node.js: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ 错误: Node.js 版本过低${NC}"
    echo "当前版本: $(node -v)"
    echo "最低要求: v18.0.0"
    exit 1
fi

echo -e "${GREEN}✅ Node.js 版本检查通过: $(node -v)${NC}"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 检查是否已存在（从 npm 安装或 git clone）
if [ -d "$PROJECT_ROOT/node_modules" ]; then
    echo -e "${YELLOW}⚠️  检测到已安装，是否更新？${NC}"
    read -p "继续更新 (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "取消安装"
        exit 0
    fi
fi

cd "$PROJECT_ROOT"

# 安装依赖
echo ""
echo "[1/4] 安装依赖..."
npm install

# 编译 TypeScript
echo ""
echo "[2/4] 编译 TypeScript..."
npm run build

# 下载模型
echo ""
echo "[3/4] 下载嵌入模型..."
if [ -f "scripts/download-models.sh" ]; then
    chmod +x scripts/download-models.sh
    ./scripts/download-models.sh
else
    echo -e "${YELLOW}⚠️  模型下载脚本不存在，跳过${NC}"
fi

# 创建数据目录
echo ""
echo "[4/4] 初始化数据目录..."
mkdir -p ~/.memlite
if [ ! -f ~/.memlite/memlite.db ]; then
    echo -e "${GREEN}✅ 创建数据目录: ~/.memlite/${NC}"
fi

echo ""
echo "================================================"
echo -e "${GREEN}✅ MemLite 安装完成！${NC}"
echo "================================================"
echo ""
echo "下一步："
echo "  1. 配置 Claude Code Hooks（见 SKILL.md）"
echo "  2. 运行测试: npm test"
echo "  3. 查看统计: npm run stats"
echo ""
echo "常用命令："
echo "  npm run start     - 启动 MCP Server"
echo "  npm run stats     - 查看记忆统计"
echo "  npm run search    - 搜索记忆"
echo "  npm run benchmark - 运行基准测试"
echo ""
