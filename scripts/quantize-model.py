#!/usr/bin/env python3
"""
MemLite GTE-small 模型量化脚本

将 FP32 ONNX 模型量化为 INT8
- 输入: models/gte-small-int8/model.onnx (FP32, 127MB)
- 输出: models/gte-small-int8/model-int8.onnx (INT8, ~30-40MB)

量化方法: 动态量化 (Dynamic Quantization)
- 权重: FP32 -> INT8
- 激活: 保持 FP32
- 优点: 无需校准数据，保持较好精度
"""

import os
import sys
import time

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import onnx
from onnx import numpy_helper, TensorProto
from onnxruntime.quantization import quantize_dynamic, QuantType


def get_model_size(path):
    """获取模型文件大小（MB）"""
    return os.path.getsize(path) / (1024 * 1024)


def quantize_model_dynamic(input_path, output_path):
    """动态量化模型（权重 INT8，激活 FP32）"""
    print(f"\n正在量化模型: {input_path}")
    print(f"  输入大小: {get_model_size(input_path):.2f} MB")

    # 动态量化 - 权重为 INT8，激活保持 FP32
    quantize_dynamic(
        input_path,
        output_path,
        weight_type=QuantType.QInt8,  # INT8 权重
    )

    output_size = get_model_size(output_path)
    print(f"  量化后大小: {output_size:.2f} MB")
    print(f"  压缩率: {get_model_size(input_path) / output_size:.1f}x")

    return output_path


def verify_model(model_path):
    """验证模型可以加载"""
    print(f"\n验证模型: {model_path}")
    try:
        model = onnx.load(model_path)
        onnx.checker.check_model(model)
        print(f"  ✅ 模型验证通过")
        return True
    except Exception as e:
        print(f"  ❌ 模型验证失败: {e}")
        return False


def main():
    # 路径配置
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    models_dir = os.path.join(project_root, 'models', 'gte-small-int8')

    input_model = os.path.join(models_dir, 'model.onnx')
    quantized_model = os.path.join(models_dir, 'model-int8.onnx')

    print("=" * 60)
    print("MemLite GTE-small 模型量化工具")
    print("=" * 60)
    print(f"\n模型目录: {models_dir}")
    print(f"原始模型: {input_model}")

    if not os.path.exists(input_model):
        print(f"\n❌ 错误: 原始模型不存在: {input_model}")
        sys.exit(1)

    print(f"\n原始模型大小: {get_model_size(input_model):.2f} MB")

    start_time = time.time()

    # Step 1: 量化模型
    quantize_model_dynamic(input_model, quantized_model)

    # Step 2: 验证量化模型
    if verify_model(quantized_model):
        # 备份原始模型（如果还没备份）
        backup_model = input_model + '.fp32.bak'
        if not os.path.exists(backup_model):
            print(f"\n备份原始模型...")
            os.rename(input_model, backup_model)

        # 用量化模型替换原始模型
        print(f"\n替换原始模型...")
        os.rename(quantized_model, input_model)

        print(f"\n✅ 量化完成!")
        print(f"   原始大小: {get_model_size(backup_model):.2f} MB")
        print(f"   量化后: {get_model_size(input_model):.2f} MB")
        print(f"   压缩率: {get_model_size(backup_model) / get_model_size(input_model):.1f}x")
    else:
        print(f"\n❌ 量化失败，保留原始模型")
        sys.exit(1)

    elapsed = time.time() - start_time
    print(f"\n总耗时: {elapsed:.1f} 秒")


if __name__ == '__main__':
    main()
