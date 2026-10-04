/**
 * NDJSON ↔ `Content-Length` bridge for MCP servers that frame their stdio
 * transport the LSP way.
 *
 * The Model Context Protocol's stdio transport is newline-delimited JSON, and
 * the client DeepSeek Harness uses (`@modelcontextprotocol/client` 2.x) reads
 * exactly that: it looks for `\n` and writes `JSON.stringify(message) + "\n"`.
 * Some older servers — this repository's `server.py` among them — frame each
 * message with an LSP-style `Content-Length: <n>\r\n\r\n` header instead, and
 * then no message ever matches and the handshake times out.
 *
 * This bridge sits between the two. It reads NDJSON from the harness on stdin,
 * writes `Content-Length` frames to the server, and translates the server's
 * frames back into NDJSON on stdout. Both directions are byte-exact: message
 * bodies are never re-encoded, only reframed.
 *
 * Usage:
 *
 *     node bridge.mjs -- <command> [args...]
 *
 * A `Content-Length` header is matched tolerantly, because a server running on
 * Windows in text mode writes its header as `\r\r\n\r\r\n`.
 *
 * @module bridge
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Frame one JSON message the LSP way.
 * @param {string} body - the JSON text.
 * @returns {Buffer} header + body, ready for a child's stdin.
 */
export function encodeFrame(body) {
	const payload = Buffer.from(body, "utf8");
	return Buffer.concat([
		Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "ascii"),
		payload,
	]);
}

/**
 * Build a parser that turns `Content-Length`-framed bytes into messages.
 * @param {(body: string) => void} onMessage - called once per complete frame,
 *   in arrival order.
 * @returns {(chunk: Buffer) => void} the chunk sink.
 */
export function createFrameParser(onMessage) {
	let buffer = Buffer.alloc(0);
	return (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			// Header bytes are ASCII; bodies are UTF-8 and are decoded only once
			// the whole frame has arrived.
			const text = buffer.toString("latin1");
			const header = /content-length:\s*(\d+)/i.exec(text);
			if (header === null) return;
			const boundary = /\r*\n\r*\n/.exec(text.slice(header.index));
			if (boundary === null) return;
			const bodyStart = header.index + boundary.index + boundary[0].length;
			const length = Number(header[1]);
			if (buffer.length < bodyStart + length) return;
			const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
			buffer = buffer.subarray(bodyStart + length);
			onMessage(body);
		}
	};
}

function main() {
	const separator = process.argv.indexOf("--");
	if (separator === -1 || process.argv.length <= separator + 1) {
		process.stderr.write("usage: node bridge.mjs -- <command> [args...]\n");
		process.exit(2);
	}
	const command = process.argv[separator + 1];
	const args = process.argv.slice(separator + 2);

	const child = spawn(command, args, {
		stdio: ["pipe", "pipe", "inherit"],
		windowsHide: true,
	});
	child.on("error", (error) => {
		process.stderr.write(`bridge: cannot start ${command}: ${error.message}\n`);
		process.exit(1);
	});
	child.on("exit", (code, signal) => {
		process.exit(signal === null ? code ?? 0 : 1);
	});

	let pending = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk) => {
		pending += chunk;
		let newline;
		while ((newline = pending.indexOf("\n")) !== -1) {
			const line = pending.slice(0, newline);
			pending = pending.slice(newline + 1);
			if (line.trim().length === 0) continue;
			child.stdin.write(encodeFrame(line));
		}
	});
	process.stdin.on("end", () => child.stdin.end());

	child.stdout.on(
		"data",
		createFrameParser((message) => {
			process.stdout.write(`${message.trim()}\n`);
		}),
	);
}

// Only run the bridge when it is the entry point, so the helpers above stay
// importable by the tests.
const isEntryPoint =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) main();
