// Gera o index.html da raiz em um único arquivo (CSS e JS embutidos), para funcionar
// mesmo quando aberto direto de dentro do .zip. Uso: node tools/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(join(root, "src", f), "utf8");
let html = src("index.html");
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${src(f)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${src(f).replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace("<!doctype html>", "<!doctype html>\n<!-- Arquivo gerado por tools/build.mjs a partir de src/. Edite os arquivos em src/. -->");
writeFileSync(join(root, "index.html"), html);
console.log("index.html gerado:", (html.length / 1024).toFixed(0), "KB");
