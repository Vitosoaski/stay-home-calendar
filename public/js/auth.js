import { api, el } from "./api.js";
import { resizeToSquare } from "./photo.js";

export function renderAuth(root, { onDone }) {
	let mode = "login";
	let photo = null;
	let busy = false;

	const draw = () => {
		root.replaceChildren(build());
	};

	function build() {
		const error = el("p", { class: "erro", role: "alert" });
		const preview = el(
			"div",
			{ class: "foto-previa" },
			photo ? el("img", { src: photo, alt: "" }) : el("span", {}, "📷"),
		);

		const fields = {
			name: el("input", { type: "text", maxlength: "24", autocomplete: "username", required: true }),
			pin: el("input", {
				type: "password",
				inputmode: "numeric",
				maxlength: "6",
				autocomplete: "current-password",
				required: true,
			}),
			groupCode: el("input", { type: "password", autocomplete: "off" }),
		};

		const fileInput = el("input", {
			type: "file",
			accept: "image/*",
			class: "oculto",
			onchange: async (event) => {
				const [file] = event.target.files;
				if (!file) return;
				try {
					photo = await resizeToSquare(file);
					draw();
				} catch (failure) {
					error.textContent = failure.message;
				}
			},
		});

		async function submit(event) {
			event.preventDefault();
			if (busy) return;
			busy = true;
			error.textContent = "";

			try {
				const payload =
					mode === "login"
						? { name: fields.name.value, pin: fields.pin.value }
						: { name: fields.name.value, pin: fields.pin.value, groupCode: fields.groupCode.value, photo };
				const result = await api.post(mode === "login" ? "/api/login" : "/api/signup", payload);
				onDone(result.user);
			} catch (failure) {
				error.textContent = failure.message;
				busy = false;
			}
		}

		return el(
			"form",
			{ class: "cartao-entrada", onsubmit: submit },
			el("h1", {}, "Calendário de Faltas"),
			el(
				"p",
				{ class: "sub" },
				mode === "login" ? "Entre para marcar suas faltas." : "Crie seu perfil com o código do grupo.",
			),

			mode === "cadastro" &&
				el(
					"label",
					{ class: "campo-foto" },
					preview,
					el("span", {}, photo ? "Trocar foto" : "Escolher foto"),
					fileInput,
				),

			el("label", {}, "Nome", fields.name),
			el("label", {}, "PIN (4 a 6 dígitos)", fields.pin),
			mode === "cadastro" && el("label", {}, "Código do grupo", fields.groupCode),

			error,
			el("button", { type: "submit", class: "primario" }, mode === "login" ? "Entrar" : "Criar perfil"),
			el(
				"button",
				{
					type: "button",
					class: "link",
					onclick: () => {
						mode = mode === "login" ? "cadastro" : "login";
						draw();
					},
				},
				mode === "login" ? "Não tenho perfil ainda" : "Já tenho perfil",
			),
		);
	}

	draw();
}
