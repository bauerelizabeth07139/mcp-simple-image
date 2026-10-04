# mcp-simple-image

**One tool, one endpoint.** `simple_image` posts a prompt to a
StepFun-compatible `/images/generations` API and returns the resulting image
URLs — no SDK, no third-party packages.

*一个工具、一个端点:把提示词发给 StepFun 兼容的图片生成 API,拿回图片 URL。*

As a DeepSeek Harness plugin: the MCP server ships inside the bundle, so
installing one plugin is the whole setup — no `mcpServers` file to hand-edit.

## Install

**DeepSeek Harness Desktop** — open **Plugins** in the sidebar, choose **Add
plugin**, and enter:

```
https://github.com/bauerelizabeth07139/mcp-simple-image
```

Then switch the new **dsh-simple-image** bundle on. The Desktop app boots the
reserved `desktop` profile, so that is where it has to be enabled.

**dsh CLI** — install it into the profile you actually boot:

```sh
dsh plugin --profile web add bauerelizabeth07139/mcp-simple-image
```

**No git on the machine?** pnpm resolves a git shorthand with `git ls-remote`,
which fails with `'git' is not recognized` when git is missing. Use the tarball
instead — that path is plain HTTPS:

```sh
dsh plugin --profile web add https://codeload.github.com/bauerelizabeth07139/mcp-simple-image/tar.gz/main
```

The same address works in the Desktop **Add plugin** dialog. Replace `main`
with a commit SHA to pin an exact revision (`/tar.gz/<sha>`).

Uninstall with `dsh plugin --profile web remove dsh-simple-image`.

## Requirements

- **Python ≥ 3.8** on `PATH`, or pointed at with `python`.
- **No third-party packages** — the server is pure standard library.
- **A StepFun-compatible API key** in `STEP_API_KEY` (or `config.apiKey`).
  Without one the server exits at startup with
  `ERROR: STEP_API_KEY is not set`.
- **An endpoint that already includes `/v1`** — the server appends
  `/images/generations` itself and hardcodes `response_format: url`.

## Tools

The server registers `1` tool(s). DSH namespaces them automatically,
so the model calls them as `mcp__simple_image__<tool>`:

| Tool | What it does |
|---|---|
| `simple_image` | Calls `POST {STEP_API_BASE}/images/generations` and returns the image URLs as text. Parameters: `prompt` (required), `model`, `size` (default `1024x1024`), `n` (1–4). |

## Configuration

| Key | Environment variable | Default | Meaning |
|---|---|---|---|
| `python` | — | discovered | interpreter that runs the server |
| `apiKey` | `STEP_API_KEY` | *(empty)* | required; the server refuses to start without it |
| `baseUrl` | `STEP_API_BASE` | `https://api.stepfun.com/step_plan/v1` | API base, **including `/v1`** |
| `model` | `STEP_MODEL` | `step-image-edit-2` | model id |
| `toolCallTimeoutMs` | — | `300000` | DSH's per-call budget; the server's own HTTP timeout is 120 s |
| `env` | — | `{}` | raw environment passthrough (for example `STEP_CONFIG`, `STEP_SIZE`, `STEP_N`) |

Every field is optional and lives in the loader row. For example, in
`cordis.patch.yml`:

```yaml
- id: dsh-simple-image
  name: 'dsh-simple-image'
  config:
    apiKey: 'sk-...'
    baseUrl: 'https://api.stepfun.com/step_plan/v1'
    model: 'step-image-edit-2'
```

## Why this plugin ships a bridge

The server frames its stdio transport the LSP way — `Content-Length: <n>`
followed by a blank line — while the MCP client inside DeepSeek Harness reads
newline-delimited JSON. Mounted directly, the handshake would time out with no
error worth reading. `bridge.mjs` sits between the two: NDJSON in from the
harness, `Content-Length` frames to the server, and the reverse on the way back.

Messages are never re-encoded, only reframed, and the parser tolerates a
`\r\r\n\r\r\n` header — which is what this server emits on Windows, where
Python's text mode turns each `\n` into `\r\n`.

## Notes

- **`config.json` wins over the environment.** If `config.json` (or `STEP_CONFIG`)
  exists next to the server, its `api_key` / `api_base` / `model` values are
  read first. Do not leave a copied `config.example.json` in place: its
  placeholder key is truthy, so the server starts with a bogus credential.
- **Results are URLs, not files.** The endpoint is asked for
  `response_format: url`, so the tool returns links that expire; nothing is
  written to disk.
- **The base URL must already contain `/v1`.** The server appends
  `/images/generations` verbatim, so an OpenAI-style base URL without `/v1`
  produces a 404.

## How it is mounted

`index.js` resolves a Python interpreter (the configured `python`, then
`python3`/`python` on `PATH`), hands the server its argv and working directory,
and mounts it as a stdio MCP server through `@deepseek-ai/dsh-mcp-client` with
`failOnStartupError: true`, so a server that cannot start is a visible error
rather than a silently missing tool.

Credentials are forwarded explicitly. The harness scrubs credential-shaped
variables (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`) out of the environment a child
process inherits, so `config.apiKey` — falling back to the variable the server
documents — is written into the child's environment by the plugin itself. That
means both of these work:

```yaml
config:
  apiKey: '<your key>'
```

```sh
export STEP_API_KEY='<your key>'   # picked up at load time
```

## Development

No build step and no runtime dependencies — `@deepseek-ai/cordis` and
`@deepseek-ai/dsh-mcp-client` are peers supplied by the Harness.

```sh
npm test    # node >= 22: manifest checks + the stdio mount, both Harness-free
```

The mount test loads `index.js` with `@deepseek-ai/dsh-mcp-client` stubbed and
asserts the exact stdio configuration the plugin produces, including the
credential forwarding above.

## Repository layout

| Path | Purpose |
|---|---|
| `index.js` | the DSH plugin: resolves the interpreter and mounts the server |
| `cordis.patch.yml` | the loader row that activates the plugin |
| `locale/{en,zh}.json` | card title and description for the plugin lists |
| `assets/icon.svg` | card artwork |
| `test/` | `npm test`: manifest composition and the mount contract |
| `server.py` | the MCP server, unchanged |
| `bridge.mjs` | NDJSON ↔ `Content-Length` translation for the harness |
| `config.example.json` | the server's own configuration template, unchanged |
| `package.upstream.json` | the repository's original npm manifest, kept verbatim |

## Other hosts (unchanged)

The server is a plain stdio MCP server and still works anywhere else. The
repository's original README is kept verbatim as
[`README.opencode.md`](README.opencode.md), and the launch stanza from it keeps
working:

```sh
STEP_API_KEY=sk-... python server.py                       # any MCP host that
                                                           # frames with
                                                           # Content-Length
node bridge.mjs -- python server.py                        # …or line-delimited
                                                           # JSON, through the
                                                           # bridge
```

## License

[MIT](LICENSE) — the repository declared MIT in `package.json` and its README but shipped no licence file; this plugin's release adds one.
