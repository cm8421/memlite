#!/usr/bin/env python3
"""
MemLite 嵌入模型对比脚本

评估 GTE-small 和 all-MiniLM-L6-v2 在 MemLite 基准测试上的表现
"""

import os
import sys
import time
import json
import subprocess
from dataclasses import dataclass

@dataclass
class ModelResult:
    name: str
    size_mb: float
    avg_latency_ms: float
    recall: float = 0.0

def get_model_size(path):
    return os.path.getsize(path) / (1024 * 1024)

def run_benchmark(model_path: str, model_name: str) -> ModelResult:
    """运行单个模型的基准测试"""
    print(f"\n{'='*60}")
    print(f"测试模型: {model_name}")
    print(f"模型路径: {model_path}")
    print(f"{'='*60}")

    size = get_model_size(model_path)
    print(f"模型大小: {size:.2f} MB")

    # 临时修改测试配置使用该模型
    # 这里需要运行 Node.js 测试

    return ModelResult(
        name=model_name,
        size_mb=size,
        avg_latency_ms=0.0,
        recall=0.0
    )

def main():
    print("="*60)
    print("MemLite 嵌入模型对比评估")
    print("="*60)

    models = {
        'GTE-small': './models/gte-small-int8/model.onnx',
        'all-MiniLM-L6-v2': './models/all-MiniLM-L6-v2/model.onnx',
    }

    results = []

    for name, path in models.items():
        if not os.path.exists(path):
            print(f"\n⚠️  模型不存在: {name} ({path})")
            continue

        result = run_benchmark(path, name)
        results.append(result)

    # 对比表格
    print("\n" + "="*60)
    print("模型对比结果")
    print("="*60)
    print(f"{'模型':<25} {'大小':<12} {'延迟':<12}")
    print("-"*60)
    for r in results:
        print(f"{r.name:<25} {r.size_mb:>8.2f} MB  {r.avg_latency_ms:>8.2f} ms")

    if len(results) > 1:
        r1, r2 = results[0], results[1]
        print("\n对比:")
        print(f"  体积: {r2.name} 是 {r1.name} 的 {r2.size_mb/r1.size_mb:.2f}x")
        print(f"  速度: {r2.name} 是 {r1.name} 的 {r1.avg_latency_ms/r2.avg_latency_ms:.2f}x (更快)")

if __name__ == '__main__':
    main()
