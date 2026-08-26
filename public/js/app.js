import { api, el } from "./api.js";
import { renderAuth } from "./auth.js";
import { renderGrid, renderHeader } from "./grid.js";
import { renderPanels } from "./panels.js";
import { toast, askReason as promptReason } from "./feedback.js";

const root = document.querySelector("#app");
const POLL_MS = 60_000;

const state = { me: null, data: null, monday: null, timer: null };

async function load({ force = false } = {}) {
	const params = new URLSearchParams();
	if (state.monday) params.set("week", state.monday);
	if (!force && state.data) params.set("v", state.data.version);

	const next = await api.get(`/api/state?${params}`);
	if (next.unchanged) return;

	state.data = next;
	state.monday = next.week.monday;
	draw();
}

function draw() {
	const { data, me } = state;
	root.replaceChildren(
		renderHeader(data, { me, onWeek: goWeek, onLogout: logout }),
		el(
			"div",
			{ class: "corpo" },
			renderGrid(data, { me, users: data.users, onToggle: toggle, onReason: setReason }),
			renderPanels(data, { me, users: data.users }),
		),
	);
}

function shiftMonday(monday, weeks) {
	const date = new Date(`${monday}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + weeks * 7);
	return date.toISOString().slice(0, 10);
}

async function goWeek(direction) {
	state.monday = direction === 0 ? null : shiftMonday(state.monday, direction);
	await load({ force: true });
}

// Aplica a mudança na tela antes da resposta do servidor. Se falhar, volta
// atrás e avisa — é melhor que travar a cada clique numa rede de celular.
async function toggle(block, value) {
	const target = state.data.days.flatMap((day) => day.blocks).find((candidate) => candidate.id === block.id);
	if (!target) return;

	const previous = target.absences ?? [];
	target.absences = value
		? [...previous, { userId: state.me.id, reason: null }]
		: previous.filter((mark) => mark.userId !== state.me.id);
	draw();

	try {
		await api.put("/api/absences", { blockId: block.id, value });
		if (value) {
			toast(`Falta marcada em ${block.subject}`, {
				action: { label: "adicionar motivo", onClick: () => setReason(block, "") },
			});
		}
		await load({ force: true });
	} catch (failure) {
		target.absences = previous;
		draw();
		toast(failure.message ?? "Não consegui salvar");
	}
}

async function setReason(block, current) {
	const reason = await promptReason({ title: block.name, current });
	if (reason === null) return;
	try {
		await api.patch("/api/absences", { blockId: block.id, reason });
		await load({ force: true });
	} catch (failure) {
		toast(failure.message ?? "Não consegui salvar o motivo");
	}
}

async function logout() {
	await api.post("/api/logout");
	location.reload();
}

async function start() {
	try {
		state.me = (await api.get("/api/me")).user;
	} catch {
		renderAuth(root, { onDone: () => start() });
		return;
	}

	await load({ force: true });

	clearInterval(state.timer);
	state.timer = setInterval(() => load().catch(() => {}), POLL_MS);
	// Voltar para a aba é o momento em que mais importa estar atualizado.
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) load().catch(() => {});
	});
}

start();
