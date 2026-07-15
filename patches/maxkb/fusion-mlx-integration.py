# =============================================================================
# Fusion-Doc V0.1 — MaxKB 自定义改造补丁
# =============================================================================
# 改造内容：
# 1. 移除所有云端模型依赖，仅保留本地模型
# 2. 对接 Fusion-MLX 本地推理接口
# 3. 新增代码文档分块策略
# 4. 适配 MLX Embedding 推理
# 5. 优化 Apple Silicon 显存调度
# =============================================================================

# ── settings.py 修改 ──────────────────────────────────────────────────────
# 移除所有云端模型供应商，仅保留本地模型
# 原: MODEL_PROVIDERS = ['openai', 'anthropic', 'azure', 'ollama', ...]
# 改为:
# 仅保留本地模型供应商

# ── 新增 fusion_mlx 模型适配器 ──────────────────────────────────────────
# 文件: apps/server/model_providers/fusion_mlx/__init__.py

import os
import httpx
from typing import Any

FUSION_MLX_URL = os.environ.get("FUSION_MLX_URL", "http://localhost:8000")
FUSION_MLX_API_KEY = os.environ.get("FUSION_MLX_API_KEY", "fusion-mlx")

class FusionMLXModelProvider:
    """仅对接本地 Fusion-MLX 推理引擎"""

    def __init__(self):
        self.client = httpx.Client(
            base_url=FUSION_MLX_URL,
            timeout=120.0,
            headers={"Authorization": f"Bearer {FUSION_MLX_API_KEY}"},
        )

    def chat(self, messages: list[dict], model: str = "qwen2.5-7b-instruct",
             temperature: float = 0.7, max_tokens: int = 4096, stream: bool = False) -> Any:
        return self.client.post("/v1/chat/completions", json={
            "model": model, "messages": messages,
            "temperature": temperature, "max_tokens": max_tokens, "stream": stream,
        }).json()

    def embed(self, texts: list[str], model: str = "bge-small-en-v1.5") -> list[list[float]]:
        resp = self.client.post("/v1/embeddings", json={"model": model, "input": texts})
        return [item["embedding"] for item in resp.json()["data"]]

    def rerank(self, query: str, docs: list[str], model: str = "bge-reranker-v2-m3",
               top_n: int = 5) -> list[dict]:
        resp = self.client.post("/v1/rerank", json={
            "model": model, "query": query, "documents": docs, "top_n": top_n,
        })
        return resp.json()["results"]

# ── settings.py 修改 ──────────────────────────────────────────────────────
# 将默认模型供应商改为 fusion_mlx
# DEFAULT_MODEL_PROVIDER = 'fusion_mlx'
# DEFAULT_CHAT_MODEL = 'qwen2.5-7b-instruct'
# DEFAULT_EMBEDDING_MODEL = 'bge-small-en-v1.5'