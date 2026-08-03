#!/usr/bin/env python3
"""
MCP Server: Simple Image (mcp-simple-image)
Configurable MCP tool for image generation via StepFun-compatible API.

Configuration (priority order):
  1. Environment variables:
       STEP_API_KEY    - API key (required)
       STEP_API_BASE   - API base URL, e.g. https://api.stepfun.com/step_plan/v1
       STEP_MODEL      - Default model name, e.g. step-image-edit-2
       STEP_CONFIG     - Path to JSON config file (optional)
  2. Config file (if STEP_CONFIG is set, or ./config.json exists)
  3. Built-in defaults (step-image-edit-2 / https://api.stepfun.com/step_plan/v1)

Usage:
  python server.py
  STEP_API_KEY=xxx STEP_API_BASE=https://... STEP_MODEL=step-1x-medium python server.py
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULTS = {
    "api_key": "",
    "api_base": "https://api.stepfun.com/step_plan/v1",
    "model": "step-image-edit-2",
    "size": "1024x1024",
    "n": 1,
}

def load_config() -> dict:
    cfg = dict(DEFAULTS)

    # 1. Config file
    config_path = os.environ.get("STEP_CONFIG") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    if os.path.isfile(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                file_cfg = json.load(f)
            if isinstance(file_cfg, dict):
                for k in ("api_key", "api_base", "model", "size", "n"):
                    if k in file_cfg and file_cfg[k]:
                        cfg[k] = file_cfg[k]
        except Exception as e:
            print(f"[config] Warning: failed to load {config_path}: {e}", file=sys.stderr)

    # 2. Environment variables (highest priority)
    if os.environ.get("STEP_API_KEY"):
        cfg["api_key"] = os.environ["STEP_API_KEY"].strip()
    if os.environ.get("STEP_API_BASE"):
        cfg["api_base"] = os.environ["STEP_API_BASE"].strip().rstrip("/")
    if os.environ.get("STEP_MODEL"):
        cfg["model"] = os.environ["STEP_MODEL"].strip()

    if not cfg["api_key"]:
        print("[config] ERROR: STEP_API_KEY is not set. Set it via env var or config.json.", file=sys.stderr)
        sys.exit(1)

    return cfg

CONFIG = load_config()

# ── MCP stdio helpers ─────────────────────────────────────────────────────────

def send(msg: dict):
    payload = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.write(f"Content-Length: {len(payload)}\r\n\r\n")
    sys.stdout.write(payload.decode("utf-8"))
    sys.stdout.flush()

def log(msg: str):
    sys.stderr.write(f"[mcp-simple-image] {msg}\n")
    sys.stderr.flush()

def read_message() -> dict | None:
    header_lines = []
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        line = line.rstrip("\r\n")
        if line == "":
            break
        header_lines.append(line)

    content_length = 0
    for h in header_lines:
        m = re.match(r"Content-Length:\s*(\d+)", h, re.IGNORECASE)
        if m:
            content_length = int(m.group(1))
            break

    if content_length == 0:
        return None

    body = sys.stdin.read(content_length)
    return json.loads(body)

# ── Image Generation API ──────────────────────────────────────────────────────

def call_generate(prompt: str, model: str, size: str, n: int) -> dict:
    url = f"{CONFIG['api_base']}/images/generations"
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "size": size,
        "n": n,
        "response_format": "url",
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CONFIG['api_key']}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err_body}")
    except Exception as e:
        raise RuntimeError(str(e))

# ── Tool handler ──────────────────────────────────────────────────────────────

def handle_simple_image(args: dict) -> dict:
    prompt = args.get("prompt", "")
    model = args.get("model") or CONFIG["model"]
    size = args.get("size") or CONFIG["size"]
    n = int(args.get("n") or CONFIG["n"])

    if not isinstance(prompt, str) or not prompt.strip():
        return {
            "content": [{"type": "text", "text": "Error: 'prompt' is required and must be a non-empty string."}],
            "isError": True,
        }

    try:
        result = call_generate(prompt, model, size, n)
    except RuntimeError as e:
        return {
            "content": [{"type": "text", "text": f"API error: {e}"}],
            "isError": True,
        }

    items = result.get("data", [])
    urls = [item.get("url", "") for item in items if item.get("url")]
    if not urls:
        return {
            "content": [{"type": "text", "text": "API returned success but no image URLs found. Try different parameters."}],
            "isError": True,
        }

    lines = [f"Generated {len(urls)} image(s) (model: {model}, size: {size})"]
    for i, url in enumerate(urls, 1):
        lines.append(f"\nImage {i}:\n{url}")

    return {
        "content": [{"type": "text", "text": "\n".join(lines)}],
        "isError": False,
    }

# ── Tool definitions ──────────────────────────────────────────────────────────

SERVER_INFO = {
    "protocolVersion": "2024-11-05",
    "capabilities": {"tools": {}},
    "serverInfo": {"name": "mcp-simple-image", "version": "1.0.0"},
}

TOOLS = [
    {
        "name": "simple_image",
        "description": (
            "Generate images from text prompts using a StepFun-compatible API. "
            "Configure the API key, base URL, and model via environment variables or config.json."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Text description of the image to generate. More detail = better results.",
                },
                "model": {
                    "type": "string",
                    "description": f"Model name (default: {CONFIG['model']} from config)",
                    "default": CONFIG["model"],
                },
                "size": {
                    "type": "string",
                    "description": f"Image dimensions (default: {CONFIG['size']}). Common: 1024x1024, 768x1344, 1344x768",
                    "default": CONFIG["size"],
                },
                "n": {
                    "type": "integer",
                    "description": f"Number of images to generate (default: {CONFIG['n']})",
                    "default": CONFIG["n"],
                    "maximum": 4,
                    "minimum": 1,
                },
            },
            "required": ["prompt"],
        },
    }
]

# ── Request dispatcher ────────────────────────────────────────────────────────

HANDLERS = {
    "initialize": lambda _id, _args: {
        "id": _id,
        "result": {**SERVER_INFO, "instructions": "MCP Simple Image server - generate images from text."},
    },
    "initialized": lambda _id, _args: None,
    "tools/list": lambda _id, _args: {
        "id": _id,
        "result": {"tools": TOOLS},
    },
    "tools/call": lambda _id, args: {
        "id": _id,
        "result": handle_simple_image(args.get("arguments", {})),
    },
}

def main():
    log(f"Starting mcp-simple-image server")
    log(f"  API base : {CONFIG['api_base']}")
    log(f"  Model    : {CONFIG['model']}")
    log(f"  Key      : {CONFIG['api_key'][:8]}...")

    while True:
        msg = read_message()
        if msg is None:
            log("EOF received, shutting down.")
            break

        method = msg.get("method", "")
        _id = msg.get("id")
        params = msg.get("params", {})

        if method == "ping":
            send({"jsonrpc": "2.0", "id": _id, "result": {}})
            continue

        handler = HANDLERS.get(method)
        if handler is None:
            log(f"Unknown method: {method}")
            if _id is not None:
                send({
                    "jsonrpc": "2.0",
                    "id": _id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                })
            continue

        result = handler(_id, params)
        if result is None:
            continue
        send({"jsonrpc": "2.0", **result})

if __name__ == "__main__":
    main()
