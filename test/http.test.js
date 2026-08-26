import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { HttpError, readJson, securityHeaders, sameOrigin, clientIp, serveStatic } from "../src/http.js";

const fakeRequest = (body, headers = {}) => {
	const stream = Readable.from([Buffer.from(body)]);
	stream.headers = headers;
	return stream;
};

test("lê JSON do corpo", async () => {
	assert.deepEqual(await readJson(fakeRequest('{"a":1}')), { a: 1 });
});

test("corpo vazio vira objeto vazio", async () => {
	assert.deepEqual(await readJson(fakeRequest("")), {});
});

test("JSON inválido vira erro 400", async () => {
	await assert.rejects(
		() => readJson(fakeRequest("{nao é json")),
		(error) => error instanceof HttpError && error.status === 400,
	);
});

test("corpo grande demais vira erro 413", async () => {
	await assert.rejects(
		() => readJson(fakeRequest("x".repeat(200)), { limit: 100 }),
		(error) => error.status === 413,
	);
});

test("os cabeçalhos de segurança bloqueiam recurso externo e sniffing", () => {
	const headers = securityHeaders();
	assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
	assert.match(headers["Content-Security-Policy"], /img-src 'self' data:/);
	assert.equal(headers["X-Content-Type-Options"], "nosniff");
});

test("sameOrigin aceita requisição sem Origin e a do próprio host", () => {
	assert.equal(sameOrigin(fakeRequest("", { host: "site.com" })), true);
	assert.equal(sameOrigin(fakeRequest("", { host: "site.com", origin: "https://site.com" })), true);
	assert.equal(sameOrigin(fakeRequest("", { host: "site.com", origin: "https://malicioso.com" })), false);
});

test("clientIp prefere o cabeçalho do proxy quando existe", () => {
	const request = fakeRequest("", { "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
	request.socket = { remoteAddress: "10.0.0.1" };
	assert.equal(clientIp(request), "1.2.3.4");

	const direct = fakeRequest("", {});
	direct.socket = { remoteAddress: "10.0.0.1" };
	assert.equal(clientIp(direct), "10.0.0.1");
});

test("serveStatic não escapa da raiz por prefixo parecido", async () => {
	const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");

	const base = mkdtempSync(join(tmpdir(), "faltas-"));
	const root = join(base, "public");
	mkdirSync(root);
	writeFileSync(join(base, "public-outro"), "segredo");

	const req = { url: "/..%2fpublic-outro", headers: {} };
	let status = null;
	const res = {
		writeHead(s) {
			status = s;
		},
		end() {},
	};
	await serveStatic(req, res, root);
	assert.equal(status, 403);
});

test("o CSP permite as fontes de imagem que o app usa e nada além", () => {
	const csp = securityHeaders()["Content-Security-Policy"];
	assert.match(csp, /img-src 'self' data: blob:/);
	assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});
