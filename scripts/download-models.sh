#!/bin/bash
# MemLite 嵌入模型下载脚本
#
# 使用方法:
#   chmod +x scripts/download-models.sh
#   ./scripts/download-models.sh
#
# 默认下载 all-MiniLM-L6-v2 模型:
#   - 模型大小: ~22MB (量化后)
#   - 向量维度: 384
#   - 推理延迟: ~14ms/条
#   - MTEB 分数: 56.3

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELS_DIR="$PROJECT_ROOT/models/gte-small-int8"

mkdir -p "$MODELS_DIR"

echo "================================================"
echo "MemLite 嵌入模型下载"
echo "================================================"
echo "模型目录: $MODELS_DIR"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 模型文件 URL
# 默认使用 all-MiniLM-L6-v2 (22MB, 更快)
# https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
MODEL_URL="https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/model.onnx"

download_file() {
    local url="$1"
    local output="$2"
    local description="$3"

    echo "下载 $description..."
    echo "  URL: $url"

    if curl -L --connect-timeout 30 --max-time 300 -o "$output" "$url" 2>/dev/null; then
        if [ -s "$output" ]; then
            echo -e "  ${GREEN}✅ 下载成功${NC}"
            return 0
        fi
    fi

    echo -e "  ${RED}❌ 下载失败${NC}"
    return 1
}

MODEL_FILE="$MODELS_DIR/model.onnx"

echo "[1/1] 检查模型文件..."

if [ -f "$MODEL_FILE" ] && [ -s "$MODEL_FILE" ]; then
    SIZE=$(wc -c < "$MODEL_FILE" | tr -d ' ')
    echo -e "  ${GREEN}✅ model.onnx 已存在 ($(($SIZE / 1024 / 1024)) MB)${NC}"
else
    download_file "$MODEL_URL" "$MODEL_FILE" "all-MiniLM-L6-v2 ONNX 模型"
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${YELLOW}⚠️  自动下载失败，请手动下载:${NC}"
        echo ""
        echo "  使用 curl:"
        echo "    curl -L -o $MODEL_FILE $MODEL_URL"
        exit 1
    fi
fi

echo ""
echo "================================================"
echo "模型状态:"
echo "================================================"

if [ -d "$MODELS_DIR" ]; then
    ls -lh "$MODELS_DIR/"
fi

echo ""
echo "------------------------------------------------"
echo "验证:"
echo "------------------------------------------------"

if [ -f "$MODEL_FILE" ] && [ -s "$MODEL_FILE" ]; then
    MODEL_SIZE=$(wc -c < "$MODEL_FILE" | tr -d ' ')
    if [ "$MODEL_SIZE" -gt 5000000 ]; then
        echo -e "${GREEN}✅ all-MiniLM-L6-v2 模型: $(($MODEL_SIZE / 1024 / 1024)) MB${NC}"
    else
        echo -e "${YELLOW}⚠️  模型文件可能不完整: $(($MODEL_SIZE / 1024)) KB${NC}"
    fi
else
    echo -e "${RED}❌ 模型文件不存在${NC}"
fi

echo ""
echo "================================================"
echo "下一步:"
echo "================================================"
echo "  运行基准测试:"
echo "    npm run benchmark:vector"
echo ""
echo "  或运行单个基准测试:"
echo "    npm test -- --run tests/benchmark/locomo-real.test.ts"
