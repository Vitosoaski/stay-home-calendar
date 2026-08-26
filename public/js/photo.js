const MAX_SIDE = 96;

// Corta no centro, reduz para 96x96 e devolve WebP. O arquivo original do
// celular tem alguns MB; o resultado tem ~4 KB, que é o que vai para o banco.
export function resizeToSquare(file, size = MAX_SIDE) {
	return new Promise((resolve, reject) => {
		if (!file.type.startsWith("image/")) {
			reject(new Error("Escolha um arquivo de imagem"));
			return;
		}

		const url = URL.createObjectURL(file);
		const image = new Image();

		image.onload = () => {
			URL.revokeObjectURL(url);
			const side = Math.min(image.width, image.height);
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;

			const context = canvas.getContext("2d");
			context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);

			// WebP economiza bastante; se o navegador não tiver, o toDataURL cai em PNG.
			resolve(canvas.toDataURL("image/webp", 0.8));
		};

		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("Não consegui ler essa imagem"));
		};
		image.src = url;
	});
}
