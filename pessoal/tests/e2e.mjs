// Teste de ponta a ponta no navegador (Chromium/Playwright), nos dois modos: sem chave (heurístico) e com a
// chave do Claude (resposta da API simulada). Uso: node tests/e2e.mjs  [pasta para screenshots]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright")); }

const file = "file://" + fileURLToPath(new URL("../index.html", import.meta.url));
const shots = process.argv[2] || "";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];

async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(file);
  await page.click("#b-browser");
  await page.waitForSelector("#cap-text");
  return page;
}
async function capture(page, text) {
  await page.fill("#cap-text", text);
  await page.click("#b-capture");
  await page.waitForSelector("#b-apply", { timeout: 10000 }).catch((e) => { console.error("erros na página:", errors); throw e; });
}

// ---------------------------------------------------------------- 1) modo heurístico (sem chave)
{
  const page = await newPage();
  assert.match(await page.textContent("#ai-badge"), /sem IA/);
  // tarefa planejada para hoje, criada pelo formulário
  await page.click("text=+ Nova tarefa");
  await page.fill("#tf-title", "Relatório do estágio");
  await page.fill("#tf-due", await page.evaluate(() => todayISO()));
  await page.click("#tf-save");
  await page.waitForSelector("text=Tarefa salva.");
  await capture(page, "Terminei o relatório do estágio\nFui à academia\nNão fiz a lista de exercícios\nPreciso pagar o boleto amanhã\nAprendi que revisar de manhã rende mais\nErrei ao deixar tudo para a noite — da próxima vez começar cedo");
  const kinds = await page.$$eval(".p-kind", (s) => s.map((x) => x.value));
  assert.deepEqual(kinds, ["done", "done", "missed", "todo", "learned", "mistake"]);
  assert.equal(await page.$eval(".p-target", (s) => s.value), "TAR001");
  if (shots) await page.screenshot({ path: `${shots}/1-propostas.png`, fullPage: true });
  await page.click("#b-apply");
  await page.waitForSelector("text=6 registros feitos");
  await page.click("a[href='#sumario']");
  await page.waitForSelector("#summary");
  const sum = await page.textContent("#summary");
  for (const s of ["Coisas que fiz", "relatório do estágio", "Fui à academia", "Faltaram fazer (1)", "Lista de exercícios", "revisar de manhã", "Da próxima vez: começar cedo"]) assert.ok(sum.includes(s), "sumário: " + s);
  await page.click(".star-btn >> nth=3");
  await page.click("#b-reflect");
  await page.waitForSelector("text=Reflexão do assistente");
  assert.match(await page.textContent("#summary"), /Para amanhã, comece por: Lista de exercícios/);
  if (shots) await page.screenshot({ path: `${shots}/2-sumario.png`, fullPage: true });
  // os dados continuam lá depois de recarregar
  await page.reload();
  await page.waitForSelector("nav:not(.hidden)");
  await page.goto(file + "#tarefas");
  await page.waitForSelector("text=Minhas tarefas");
  const rows = await page.$$eval("tr.click", (r) => r.length);
  assert.equal(rows, 2); // exercícios (faltou) + boleto
  if (shots) await page.screenshot({ path: `${shots}/3-tarefas.png`, fullPage: true });
  await page.context().close();
  console.log("ok - modo heurístico (sem chave)");
}

// ---------------------------------------------------------------- 2) modo com a chave do Claude (API simulada)
{
  const page = await newPage();
  let calls = 0;
  await page.route("https://api.anthropic.com/v1/messages", async (route) => {
    calls++;
    const body = JSON.parse(route.request().postData());
    assert.equal(route.request().headers()["x-api-key"], "sk-ant-teste");
    const out = body.output_config.format
      ? { proposals: [
          { text: "Corri 5 km", title: "Corrida de 5 km", kind: "done", target_id: "", area: "Saúde", priority: "Média", due_date: "", lesson: "", reason: "Atividade física feita" },
          { text: "Briguei no trânsito", title: "Perdi a paciência no trânsito", kind: "mistake", target_id: "", area: "Outros", priority: "Baixa", due_date: "", lesson: "Respirar antes de reagir", reason: "Erro de comportamento" },
          { text: "Entregar TCC dia 30", title: "Entregar o TCC", kind: "todo", target_id: "", area: "Estudos", priority: "Alta", due_date: "2026-10-30", lesson: "", reason: "Prazo" },
        ] }
      : "O que foi bem: você treinou.\nOnde melhorar: paciência.\nPara amanhã: TCC.";
    await route.fulfill({ status: 200, contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }], stop_reason: "end_turn" }) });
  });
  await page.goto(file + "#config");
  await page.waitForSelector("#c-key");
  await page.fill("#c-key", "sk-ant-teste");
  await page.click("#c-save-ai");
  await page.waitForSelector("#ai-badge.on");
  await page.goto(file + "#painel");
  await capture(page, "Corri 5 km\nBriguei no trânsito\nEntregar TCC dia 30");
  assert.match(await page.textContent(".props-t ~ p, .assist-card"), /Sugestões da IA/);
  assert.deepEqual(await page.$$eval(".p-kind", (s) => s.map((x) => x.value)), ["done", "mistake", "todo"]);
  await page.click("#b-apply");
  await page.goto(file + "#sumario");
  await page.waitForSelector("#summary");
  await page.click("#b-reflect");
  await page.waitForSelector("text=Reflexão da IA gerada");
  const sum = await page.textContent("#summary");
  for (const s of ["Corrida de 5 km", "Perdi a paciência no trânsito", "Respirar antes de reagir", "O que foi bem: você treinou."]) assert.ok(sum.includes(s), "sumário IA: " + s);
  assert.equal(calls, 2);
  if (shots) await page.screenshot({ path: `${shots}/4-sumario-ia.png`, fullPage: true });
  await page.context().close();
  console.log("ok - modo com IA (API simulada)");
}

// ---------------------------------------------------------------- 3) modo pasta (db.json + SUMARIOS/ numa pasta)
// O seletor de pastas precisa de um clique humano; aqui usamos a pasta privada do navegador (OPFS), que tem a mesma API.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://teste.local/**", (r) => r.fulfill({ path: fileURLToPath(new URL("../index.html", import.meta.url)), contentType: "text/html" }));
  await page.goto("https://teste.local/index.html");
  await page.waitForSelector("#b-browser");
  await page.evaluate(async () => { await Store.use(await navigator.storage.getDirectory()); await start(); });
  await page.waitForSelector("#cap-text");
  assert.match(await page.textContent("#where"), /📁/);
  await capture(page, "Li 20 páginas do livro\nAprendi a fazer pão");
  await page.click("#b-apply");
  await page.waitForSelector("text=2 registros feitos");
  // reabrir: a plataforma lembra a pasta usada da última vez
  await page.goto("https://teste.local/index.html#sumario");
  await page.waitForSelector("#summary");
  assert.match(await page.textContent("#summary"), /Li 20 páginas do livro/);
  await page.click("text=Salvar na pasta");
  await page.waitForSelector("text=Salvo em SUMARIOS/");
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const db = JSON.parse(await (await (await root.getFileHandle("db.json")).getFile()).text());
    const sum = await (await (await (await root.getDirectoryHandle("SUMARIOS")).getFileHandle(todayISO() + ".html")).getFile()).text();
    return { entries: db.entries.length, sum };
  });
  assert.equal(files.entries, 2);
  assert.ok(files.sum.includes("Aprendi a fazer pão"));
  await ctx.close();
  console.log("ok - modo pasta (db.json e SUMARIOS/ gravados)");
}

await browser.close();
assert.deepEqual(errors, [], "erros de JavaScript na página");
console.log("ok - nenhum erro de JavaScript");
