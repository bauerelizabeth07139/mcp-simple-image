# mcp-simple-image

A simple MCP (Model Context Protocol) tool for generating images from text prompts using StepFun-compatible APIs. Configurable endpoint, API key, and model.

## Features

- Simple MCP tool: `simple_image`
- Fully configurable: API base URL, API key, model name
- Zero external dependencies (pure Python stdlib)
- Works with StepFun `step_plan` API and compatible endpoints

## Installation

```bash
git clone https://github.com/bauerelizabeth07139/mcp-simple-image.git
cd mcp-simple-image
```

## Configuration

Set your API key via **environment variables** (recommended) or a `config.json` file.

### Option 1: Environment Variables

```bash
STEP_API_KEY=your_api_key_here
STEP_API_BASE=https://api.stepfun.com/step_plan/v1
STEP_MODEL=step-image-edit-2
```

### Option 2: Config File

Copy `config.example.json` to `config.json` and fill in your values:

```json
{
  "api_key": "your_api_key_here",
  "api_base": "https://api.stepfun.com/step_plan/v1",
  "model": "step-image-edit-2",
  "size": "1024x1024",
  "n": 1
}
```

## Usage

### Run the MCP server

```bash
python server.py
```

### Use with opencode

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "simple-image": {
      "type": "local",
      "command": [
        "python",
        "/path/to/mcp-simple-image/server.py"
      ],
      "enabled": true,
      "environment": {
        "STEP_API_KEY": "your_key_here",
        "STEP_API_BASE": "https://api.stepfun.com/step_plan/v1",
        "STEP_MODEL": "step-image-edit-2"
      }
    }
  }
}
```

Or if you use a `config.json` file in the same directory:

```json
{
  "mcp": {
    "simple-image": {
      "type": "local",
      "command": ["python", "/path/to/mcp-simple-image/server.py"],
      "enabled": true
    }
  }
}
```

### Tool: `simple_image`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Text description of the image |
| `model` | string | No | (from config) | Model name |
| `size` | string | No | (from config) | Image dimensions, e.g. `1024x1024` |
| `n` | integer | No | (from config) | Number of images (1-4) |

Example prompt in opencode:

```
Use simple_image to generate: a cute cat astronaut floating in space, cinematic lighting, 8K
```

## Testing

```bash
# Direct API test
python test_api.py

# MCP protocol test
python test_mcp.py
```

## License

MIT
