/**
 * A deliberately awkward stand-in for the servers this bridge exists for: it
 * speaks `Content-Length` framing and, like a Python server running on Windows
 * in text mode, doubles the carriage returns in its header
 * (`\r\r\n\r\r\n` instead of `\r\n\r\n`).
 *
 * It answers every request with `{ result: { echoed: <method> } }`.
 */

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	for (;;) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd === -1) return;
		const header = buffer.subarray(0, headerEnd).toString("ascii");
		const match = /content-length:\s*(\d+)/i.exec(header);
		if (match === null) {
			buffer = buffer.subarray(headerEnd + 4);
			continue;
		}
		const start = headerEnd + 4;
		const length = Number(match[1]);
		if (buffer.length < start + length) return;
		const body = JSON.parse(buffer.subarray(start, start + length).toString("utf8"));
		buffer = buffer.subarray(start + length);
		const reply = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { echoed: body.method } });
		process.stdout.write(`Content-Length: ${Buffer.byteLength(reply)}\r\r\n\r\r\n${reply}`);
	}
});

process.stdin.on("end", () => process.exit(0));
