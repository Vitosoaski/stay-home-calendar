import { test } from "node:test";
import assert from "node:assert/strict";
import { createServerApp } from "../server.js";
import { testConfig } from "./helpers.js";

async function start() {
	const app = createServerApp({ config: { ...testConfig, dbPath: ":memory:" } });
	await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${app.server.address().port}`;
	return {
		base,
		fetch: (path, options) => fetch(base + path, options),
		close: () =>
			new Promise((resolve) => {
				app.schedule.stop();
				app.server.close(resolve);
			}),
	};
}

test("serve a página inicial", async () => {
	const app = await start();
	const res = await app.fetch("/");
	assert.equal(res.status, 200);
	assert.match(res.headers.get("content-type"), /text\/html/);
	assert.match(await res.text(), /<!DOCTYPE html>/i);
	await app.close();
});

test("aplica os cabeçalhos de segurança nos estáticos", async () => {
	const app = await start();
	const res = await app.fetch("/");
	assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
	assert.equal(res.headers.get("x-content-type-options"), "nosniff");
	await app.close();
});

test("caminho inexistente devolve 404", async () => {
	const app = await start();
	assert.equal((await app.fetch("/nao-existe.js")).status, 404);
	await app.close();
});

test("não serve arquivo fora de public/", async () => {
	const app = await start();
	const res = await app.fetch("/../server.js");
	assert.ok([403, 404].includes(res.status), `esperava bloqueio, veio ${res.status}`);
	await app.close();
});

test("a API responde", async () => {
	const app = await start();
	const res = await app.fetch("/api/me");
	assert.equal(res.status, 401);
	await app.close();
});
