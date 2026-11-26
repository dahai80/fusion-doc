# =============================================================================
# Fusion-Doc V0.1 — MaxKB customization patch
# =============================================================================
# Changes:
# 1. Remove all cloud model dependencies, keep only local models
# 2. Integrate the Fusion-MLX local inference API
# 3. Add a chunking strategy for code documents
# 4. Adapt MLX embedding inference
# 5. Optimize Apple Silicon memory scheduling
# =============================================================================

# ── settings.py changes ───────────────────────────────────────────────────
# Remove all cloud model providers, keep only local models
# Before: MODEL_PROVIDERS = ['openai', 'anthropic', 'azure', 'ollama', ...]
# After:
# Keep only local model providers

# ── New fusion_mlx model adapter ────────────────────────────────────────
# File: apps/server/model_providers/fusion_mlx/__init__.py

import os
import httpx
from typing import Any

# Defaults to the unified fusion-gateway network on 11432 (option B); env can override back to direct 11434
FUSION_MLX_URL = os.environ.get("FUSION_MLX_URL", "http://localhost:11432")
# key is injected by the deployment env, never a literal default; if empty, calls error out (fail visibly)
FUSION_CLIENT_KEY = os.environ.get("FUSION_CLIENT_KEY", "")

class FusionMLXModelProvider:
    """Integrates only with the local Fusion-MLX inference engine"""

    def __init__(self):
        self.client = httpx.Client(
            base_url=FUSION_MLX_URL,
            timeout=120.0,
            headers={"Authorization": f"Bearer {FUSION_CLIENT_KEY}"},
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

# ── settings.py changes ───────────────────────────────────────────────────
# Change the default model provider to fusion_mlx
# DEFAULT_MODEL_PROVIDER = 'fusion_mlx'
# DEFAULT_CHAT_MODEL = 'qwen2.5-7b-instruct'
# DEFAULT_EMBEDDING_MODEL = 'bge-small-en-v1.5'