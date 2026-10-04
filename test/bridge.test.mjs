/**
 * Checks for the NDJSON ↔ `Content-Length` bridge.
 *
 * Two layers: the framing helpers directly, then the bridge as a process —
 * spawned exactly the way the plugin spawns it, against a fixture server that
 * frames its headers the awkward Windows way.
 *
 * Run: `node test/bridge.test.mjs`
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createFrameParser, encodeFrame } from "../bridge.mjs";

const BRIDGE = fileURLToPath(new URL("../bridge.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/content-length-server.mjs", import.meta.url));

let failed = 0;
async function check(label, body) {
	try {
		const detail = await body();
		console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
	} catch (error) {
		failed++;
		console.log(`  FAIL  ${label} — ${error.message}`);
	}
}

console.log("NDJSON bridge");

await check("encodeFrame writes an LSP-style header and the exact body", async () => {
	const frame = encodeFrame('{"jsonrpc":"2.0","id":1,"method":"ping"}');
	const text = frame.toString("utf8");
	const [header, ...rest] = text.split("\r\n\r\n");
	assert.equal(header, `Content-Length: ${Buffer.byteLength(rest.join("\r\n\r\n"))}`);
	assert.equal(rest.join("\r\n\r\n"), '{"jsonrpc":"2.0","id":1,"method":"ping"}');
	return header;
});

await check("the parser reassembles a frame split across chunks", async () => {
	const messages = [];
	const sink = createFrameParser((message) => messages.push(message));
	const frame = encodeFrame('{"id":7,"result":"ok"}');
	sink(frame.subarray(0, 12));
	assert.deepEqual(messages, [], "nothing should be emitted before the frame is complete");
	sink(frame.subarray(12));
	assert.deepEqual(messages, ['{"id":7,"result":"ok"}']);
	return "1 message";
});

await check("the parser accepts the CR-doubled header a Windows server writes", async () => {
	const messages = [];
	const sink = createFrameParser((message) => messages.push(message));
	const body = '{"id":8,"result":"doubled"}';
	sink(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\r\n\r\r\n${body}`, "utf8"));
	assert.deepEqual(messages, [body]);
	return "doubled CR accepted";
});

await check("the parser emits two frames that arrive in one chunk", async () => {
	const messages = [];
	const sink = createFrameParser((message) => messages.push(message));
	sink(Buffer.concat([encodeFrame('{"id":1}'), encodeFrame('{"id":2}')]));
	assert.deepEqual(messages, ['{"id":1}', '{"id":2}']);
	return "2 messages";
});

await check("the bridge round-trips one request through a framed server", async () => {
	const child = spawn(process.execPath, [BRIDGE, "--", process.execPath, FIXTURE], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
	const code = await new Promise((resolve) => {
		setTimeout(() => child.stdin.end(), 200);
		child.on("exit", resolve);
	});
	assert.equal(stderr, "", `the bridge wrote to stderr: ${stderr}`);
	assert.equal(code, 0, `bridge exited with ${code}`);
	const lines = stdout.trim().split("\n");
	assert.equal(lines.length, 1, `expected one reply, got ${JSON.stringify(lines)}`);
	const reply = JSON.parse(lines[0]);
	assert.equal(reply.id, 1);
	assert.deepEqual(reply.result, { echoed: "tools/list" });
	return lines[0];
});

await check("the bridge exits with the child's status", async () => {
	const child = spawn(process.execPath, [BRIDGE, "--", process.execPath, "-e", "process.exit(3)"], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	child.stdin.end();
	const code = await new Promise((resolve) => child.on("exit", resolve));
	assert.equal(code, 3);
	return "exit 3";
});

await check("a missing command is reported, not swallowed", async () => {
	const child = spawn(process.execPath, [BRIDGE, "--", "__no-such-command__"], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdin.end();
	const code = await new Promise((resolve) => child.on("exit", resolve));
	assert.equal(code, 1);
	assert.match(stderr, /cannot start/);
	return stderr.trim();
});

console.log(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
