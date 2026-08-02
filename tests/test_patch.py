"""Tests for Fusion-Doc MaxKB patch module."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Import the module using importlib since the filename has hyphens
spec = importlib.util.spec_from_file_location(
    "fusion_mlx_integration",
    str(Path(__file__).parent.parent / "patches" / "maxkb" / "fusion-mlx-integration.py"),
)
fusion_mlx_integration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fusion_mlx_integration)


class TestFusionMLXModelProvider:
    def test_init(self):
        provider = fusion_mlx_integration.FusionMLXModelProvider()
        assert provider.client is not None

    def test_chat(self):
        provider = fusion_mlx_integration.FusionMLXModelProvider()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": [{"message": {"content": "test"}}]}
        provider.client.post = MagicMock(return_value=mock_resp)
        result = provider.chat([{"role": "user", "content": "hi"}])
        assert result["choices"][0]["message"]["content"] == "test"

    def test_embed(self):
        provider = fusion_mlx_integration.FusionMLXModelProvider()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"embedding": [0.1, 0.2, 0.3]}]}
        provider.client.post = MagicMock(return_value=mock_resp)
        result = provider.embed(["hello world"])
        assert len(result) == 1
        assert len(result[0]) == 3

    def test_rerank(self):
        provider = fusion_mlx_integration.FusionMLXModelProvider()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"results": [{"index": 0, "score": 0.95}]}
        provider.client.post = MagicMock(return_value=mock_resp)
        result = provider.rerank("query", ["doc1", "doc2"])
        assert len(result) >= 1

    def test_env_vars(self):
        assert fusion_mlx_integration.FUSION_MLX_URL == os.environ.get("FUSION_MLX_URL", "http://localhost:8000")