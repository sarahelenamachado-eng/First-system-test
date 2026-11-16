// Gera custos-aduaneiros/index.html (arquivo único, CSS e JS embutidos) a partir de custos-aduaneiros/src/.
// Uso: node tools/build-custos.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "custos-aduaneiros");
const src = (f) => (existsSync(join(root, "src", f)) ? readFileSync(join(root, "src", f), "utf8") : "");
let html = src("index.html");
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${src(f)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${src(f).replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace("<!doctype html>", "<!doctype html>\n<!-- Arquivo gerado por tools/build-custos.mjs a partir de custos-aduaneiros/src/. Edite os arquivos em src/. -->");
writeFileSync(join(root, "index.html"), html);
console.log("custos-aduaneiros/index.html gerado:", (html.length / 1024).toFixed(0), "KB");
