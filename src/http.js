import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

export async function readJson(req, { limit = 128 * 1024 } = {}) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new HttpError(413, "Conteúdo grande demais");
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (!text) return {};
	try {
		const value = JSON.parse(text);
		if (value === null || typeof value !== "object") throw new Error("não é objeto");
		return value;
	} catch {
		throw new HttpError(400, "JSON inválido");
	}
}

export function securityHeaders() {
	return {
		// Todo o CSS e JS vive em arquivos próprios, então 'self' basta e nada
		// inline roda. img-src precisa de data: por causa da prévia da foto.
		"Content-Security-Policy": [
			"default-src 'self'",
			// data: é a prévia da foto; blob: é o arquivo escolhido antes de redimensionar.
			"img-src 'self' data: blob:",
			"style-src 'self'",
			"script-src 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'",
		].join("; "),
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "same-origin",
	};
}

export function sendJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		...securityHeaders(),
		...headers,
	});
	res.end(payload);
}

export function sendEmpty(res, status, headers = {}) {
	res.writeHead(status, { ...securityHeaders(), ...headers });
	res.end();
}

// Uma requisição de outro site não pode ser distinguida por SameSite sozinho em
// navegadores antigos, então escritas também conferem o Origin.
export function sameOrigin(req) {
	const origin = req.headers.origin;
	if (!origin) return true; // navegação direta e curl não mandam Origin
	try {
		return new URL(origin).host === req.headers.host;
	} catch {
		return false;
	}
}

export function clientIp(req) {
	const forwarded = req.headers["x-forwarded-for"];
	if (forwarded) return String(forwarded).split(",")[0].trim();
	return req.socket?.remoteAddress ?? "desconhecido";
}

const CONTENT_TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webp": "image/webp",
	".ico": "image/x-icon",
};

export async function serveStatic(req, res, rootDir) {
	const url = new URL(req.url, "http://localhost");
	let pathname = decodeURIComponent(url.pathname);
	if (pathname === "/") pathname = "/index.html";

	// normalize resolve '..' antes de checarmos, então o prefixo é garantia real.
	// O separador no fim importa: sem ele '/public-outro' passaria por '/public'.
	const root = normalize(rootDir).replace(new RegExp(`${sep}+$`), "") + sep;
	const filePath = normalize(join(rootDir, pathname));
	if (!filePath.startsWith(root)) {
		sendEmpty(res, 403);
		return true;
	}

	let info;
	try {
		info = await stat(filePath);
	} catch {
		return false;
	}
	if (!info.isFile()) return false;

	const etag = `"${info.size}-${info.mtimeMs}"`;
	if (req.headers["if-none-match"] === etag) {
		sendEmpty(res, 304, { ETag: etag });
		return true;
	}

	res.writeHead(200, {
		"Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
		"Content-Length": info.size,
		ETag: etag,
		"Cache-Control": "no-cache",
		...securityHeaders(),
	});
	createReadStream(filePath).pipe(res);
	return true;
}
