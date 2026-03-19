#!/bin/bash
# MemLite 基准评测数据集下载脚本
#
# 使用方法:
#   chmod +x scripts/download-benchmarks.sh
#   ./scripts/download-benchmarks.sh
#
# 此脚本会下载以下真实基准数据集:
#   1. LoCoMo - 长对话记忆评测 (ACL 2024)
#   2. LongMemEval - 长期记忆评测 (ICLR 2025)
#   3. MemoryArena - 记忆-动作闭环评测 (在线评测)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/data/benchmarks"

mkdir -p "$DATA_DIR"

echo "================================================"
echo "MemLite 基准评测数据集下载"
echo "================================================"
echo "数据目录: $DATA_DIR"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. LoCoMo 数据集
echo "[1/3] 下载 LoCoMo 数据集..."
echo "      论文: Evaluating Very Long-Term Conversational Memory of LLM Agents (ACL 2024)"
echo "      来源: https://github.com/snap-research/locomo"

LOCOMO_FILE="$DATA_DIR/locomo10.json"

if [ -f "$LOCOMO_FILE" ] && [ -s "$LOCOMO_FILE" ]; then
    echo -e "      ${GREEN}✅ LoCoMo 数据集已存在${NC}"
else
    # 尝试多种下载源
    DOWNLOADED=false

    # 方式1: 直接从 GitHub 下载
    echo "      尝试从 GitHub 下载..."
    if curl -L --connect-timeout 15 --max-time 120 -o "$LOCOMO_FILE" \
        "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json" 2>/dev/null; then
        if [ -s "$LOCOMO_FILE" ]; then
            DOWNLOADED=true
            echo -e "      ${GREEN}✅ LoCoMo 数据集下载成功 (GitHub)${NC}"
        fi
    fi

    # 方式2: 使用 GitHub 代理
    if [ "$DOWNLOADED" = false ]; then
        echo "      尝试使用代理下载..."
        for proxy in "ghproxy.com" "gh-proxy.com" "mirror.ghproxy.com"; do
            if curl -L --connect-timeout 15 --max-time 120 -o "$LOCOMO_FILE" \
                "https://$proxy/https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json" 2>/dev/null; then
                if [ -s "$LOCOMO_FILE" ]; then
                    DOWNLOADED=true
                    echo -e "      ${GREEN}✅ LoCoMo 数据集下载成功 ($proxy)${NC}"
                    break
                fi
            fi
        done
    fi

    # 方式3: 使用 Gitee 镜像 (如果有)
    if [ "$DOWNLOADED" = false ]; then
        echo -e "      ${YELLOW}⚠️  自动下载失败，请手动下载:${NC}"
        echo ""
        echo "      方法1 - 使用 wget:"
        echo "        wget -O $LOCOMO_FILE https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json"
        echo ""
        echo "      方法2 - 使用 curl:"
        echo "        curl -L -o $LOCOMO_FILE https://ghproxy.com/https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json"
        echo ""
        echo "      方法3 - 克隆整个仓库:"
        echo "        git clone https://github.com/snap-research/locomo.git /tmp/locomo"
        echo "        cp /tmp/locomo/data/locomo10.json $LOCOMO_FILE"
    fi
fi
echo ""

# 2. LongMemEval 数据集
echo "[2/3] 下载 LongMemEval 数据集..."
echo "      论文: LongMemEval: Benchmarking Chat Assistants on Long-Term Memory (ICLR 2025)"
echo "      来源: https://github.com/xiaowu0162/LongMemEval"

LONGMEM_FILE="$DATA_DIR/longmemeval_oracle.json"

if [ -f "$LONGMEM_FILE" ] && [ -s "$LONGMEM_FILE" ]; then
    echo -e "      ${GREEN}✅ LongMemEval 数据集已存在${NC}"
else
    DOWNLOADED=false

    # 尝试从 Hugging Face 下载
    echo "      尝试从 Hugging Face 下载..."

    if command -v python3 &> /dev/null; then
        python3 << 'PYEOF' 2>/dev/null
import sys
import os
import json

sys.path.insert(0, os.getcwd())

try:
    # 尝试使用 datasets 库
    from datasets import load_dataset

    print("      正在下载 LongMemEval 数据集...")
    dataset = load_dataset("xiaowu0162/longmemeval-cleaned", split="validation", trust_remote_code=True)

    data = [dict(item) for item in dataset]

    with open("data/benchmarks/longmemeval_oracle.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"      ✅ 保存了 {len(data)} 条评测数据")
    sys.exit(0)
except ImportError:
    print("      ⚠️  未安装 datasets 库")
    sys.exit(1)
except Exception as e:
    print(f"      ❌ 下载失败: {e}")
    sys.exit(1)
PYEOF

        if [ $? -eq 0 ]; then
            DOWNLOADED=true
        fi
    else
        echo -e "      ${YELLOW}⚠️  需要 Python 3 来下载 Hugging Face 数据集${NC}"
    fi

    if [ "$DOWNLOADED" = false ]; then
        echo -e "      ${YELLOW}⚠️  自动下载失败，请手动下载:${NC}"
        echo ""
        echo "      方法1 - 使用 Python (推荐):"
        echo "        pip install datasets"
        echo "        python3 -c 'from datasets import load_dataset; ds = load_dataset(\"xiaowu0162/longmemeval-cleaned\"); print(ds)'"
        echo ""
        echo "      方法2 - 直接下载:"
        echo "        wget -O $LONGMEM_FILE https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json"
    fi
fi
echo ""

# 3. MemoryArena 数据集
echo "[3/3] MemoryArena 数据集..."
echo "      论文: MemoryArena: Evaluating Long-Term Memory in LLMs (2026)"
echo "      来源: https://memoryarena.github.io/"
echo ""
echo -e "      ${YELLOW}⚠️  MemoryArena 是一个交互式评测环境${NC}"
echo "      请访问以下链接进行在线评测:"
echo "        https://memoryarena.github.io/"
echo ""

# 检查下载结果
echo "================================================"
echo "数据集状态:"
echo "================================================"

if [ -d "$DATA_DIR" ]; then
    ls -lh "$DATA_DIR/" 2>/dev/null || echo "  (目录为空)"
fi
echo ""

# 统计
echo "------------------------------------------------"
echo "统计信息:"
echo "------------------------------------------------"

if [ -f "$LOCOMO_FILE" ] && [ -s "$LOCOMO_FILE" ]; then
    LOCOMO_SIZE=$(wc -c < "$LOCOMO_FILE" | tr -d ' ')
    LOCOMO_CONV=$(python3 -c "import json; data=json.load(open('$LOCOMO_FILE')); print(len(data))" 2>/dev/null || echo "?")
    echo -e "${GREEN}✅ LoCoMo:${NC} $(( LOCOMO_SIZE / 1024 )) KB, $LOCOMO_CONV 个对话"
else
    echo -e "${RED}❌ LoCoMo: 未下载${NC}"
fi

if [ -f "$LONGMEM_FILE" ] && [ -s "$LONGMEM_FILE" ]; then
    LONGMEM_SIZE=$(wc -c < "$LONGMEM_FILE" | tr -d ' ')
    LONGMEM_Q=$(python3 -c "import json; data=json.load(open('$LONGMEM_FILE')); print(len(data))" 2>/dev/null || echo "?")
    echo -e "${GREEN}✅ LongMemEval:${NC} $(( LONGMEM_SIZE / 1024 )) KB, $LONGMEM_Q 个问题"
else
    echo -e "${RED}❌ LongMemEval: 未下载${NC}"
fi

echo -e "${YELLOW}⏳ MemoryArena: 需要在线评测${NC}"

echo ""
echo "================================================"
echo "下载完成后，运行评测:"
echo "================================================"
echo "  npm run benchmark"
echo ""
echo "或运行单个基准测试:"
echo "  npm test -- --run tests/benchmark/locomo-eval.test.ts"
echo "  npm test -- --run tests/benchmark/longmem-eval.test.ts"

