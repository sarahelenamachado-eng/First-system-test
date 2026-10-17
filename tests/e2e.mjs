// Teste de ponta a ponta no navegador (Chromium/Playwright), com a pasta de trabalho simulada pela pasta privada
// do navegador (OPFS, mesma API da pasta do computador). Roda nos dois modos: sem chave (heurístico) e com a chave
// do Claude (resposta da API simulada). Uso: node tests/e2e.mjs  [pasta para screenshots]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright")); }

const html = fileURLToPath(new URL("../index.html", import.meta.url));
const shots = process.argv[2] || "";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];

async function newPage(aiMock) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "pt-BR" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.route("https://teste.local/**", (r) => r.fulfill({ path: html, contentType: "text/html" }));
  if (aiMock) await page.route("https://api.anthropic.com/v1/messages", aiMock);
  await page.goto("https://teste.local/index.html");
  await page.waitForSelector(".welcome");
  if (aiMock) await page.evaluate(() => AI.configure("sk-ant-teste", "claude-opus-5-5"));
  await page.evaluate(async () => { await Store.use(await navigator.storage.getDirectory()); await boot(); });
  await page.waitForSelector("#as-text");
  return page;
}
const go = async (page, hash, sel) => { await page.evaluate((h) => { location.hash = h; }, hash); if (sel) await page.waitForSelector(sel); };
const readFile = (page, rel) => page.evaluate(async (rel) => { const f = await Store.read(rel); return f ? f.text() : null; }, rel);

/** Base de exemplo: projeto com 3 itens (2 parados há 6 dias) e 2 itens na lista geral. */
async function seed(page) {
  await page.evaluate(async () => {
    const old = addDays(todayISO(), -6) + "T09:00:00";
    const p = await api("projects", "POST", { name: "Subestação", owner: "Ana" });
    for (const title of ["Cabos de média tensão", "Teste do transformador", "Projeto elétrico"]) await api(`projects/${p.id}/sub`, "POST", { list: "pitems", entry: { title, status: "Em andamento", owner: "Ana", progress_desc: "" } });
    const pr = Core.find("projects", p.id);
    pr.pitems[0].created_at = pr.pitems[0].updated_at = old;   // parado há 6 dias
    pr.pitems[1].created_at = pr.pitems[1].updated_at = old;   // parado há 6 dias
    await api("items", "POST", { title: "Relatório de Xushui para o HQ", area_main: "GA", priority: "Alta", owner: "Carlos" });
    await api("items", "POST", { title: "Contrato de limpeza", area_main: "Compras", owner: "Wang" });
    const g2 = Core.find("items", "GOV002"); await api("items/GOV002/link", "POST", { collection: "projects", id: p.id }); g2.status = "Em andamento";
    await Core.save();
    await refresh();
  });
}

async function scenario(page, label) {
  await seed(page);
  // 1) itens do projeto parados há 5+ dias aparecem na lista geral para confirmar
  await go(page, "lista", ".confirm-box");
  const stale = await page.$$eval(".stale-row", (r) => r.map((x) => x.dataset.key));
  assert.deepEqual(stale, ["PROJ001-IT001", "PROJ001-IT002"], label + ": itens parados");
  assert.match(await page.textContent(".confirm-box"), /5 dias ou mais/);
  if (shots) await page.screenshot({ path: `${shots}/${label}-1-confirmar.png`, fullPage: true });
  await page.fill("#sc-p-PROJ001-IT001", "Cabos lançados até o painel 3");
  await page.click(".stale-row[data-key='PROJ001-IT001'] button:has-text('Confirmar')");
  await page.waitForSelector("text=Item confirmado");
  assert.deepEqual(await page.$$eval(".stale-row", (r) => r.map((x) => x.dataset.key)), ["PROJ001-IT002"], label + ": confirmado sai da caixa");
  // 3) finalizar pela caixa de confirmação: sai da lista e vai para a pasta do projeto, no mês
  await page.click(".stale-row[data-key='PROJ001-IT002'] button:has-text('Finalizado')");
  await page.waitForSelector("text=Item finalizado e salvo no histórico");
  assert.equal(await page.$(".confirm-box"), null, label + ": caixa vazia some");
  // progresso num item da lista geral e finalização de outro (GOV002, ligado ao projeto)
  await page.evaluate(() => api("items/GOV001/progress", "POST", { text: "Rascunho enviado para revisão da diretora" }));
  await go(page, "lista/GOV002", "#i-status");
  await page.selectOption("#i-status", "Concluído");
  await page.click("#modal-body button:has-text('Salvar')");
  await page.waitForSelector("text=Item atualizado");
  await page.evaluate(() => closeModal());
  await go(page, "lista", "table");
  const ids = await page.$$eval("#view table tr.click td:first-child", (t) => t.map((x) => x.textContent));
  assert.deepEqual(ids, ["GOV001"], label + ": finalizado sai da lista geral");
  await go(page, "lista/finalizados", "#view h2");
  const fin = await page.textContent("#view");
  for (const s of ["PROJ001 · Subestação", "GOV002", "Contrato de limpeza", "PROJ001 · IT002", "Teste do transformador"]) assert.ok(fin.includes(s), label + ": histórico tem " + s);
  if (shots) await page.screenshot({ path: `${shots}/${label}-2-finalizados.png`, fullPage: true });
  const month = await page.evaluate(() => todayISO().slice(0, 7));
  const files = await page.evaluate(() => S.db.finished.map((f) => f.file));
  assert.ok(files.every((f) => f.startsWith(`PROJECTS/PROJ001 INFOS AND GENERAL OVERVIEW/FINALIZADOS/${month}/`)), label + ": arquivos na pasta do projeto/mês " + files);
  for (const f of files) assert.ok((await readFile(page, f))?.includes("Finalizado em"), label + ": arquivo gravado " + f);
  // item sem projeto finalizado vai para FINALIZADOS/<departamento>/<mês>
  await page.evaluate(async () => { await api("items", "POST", { title: "Treinamento de brigada", area_main: "SSMA" }); await api("items/GOV003", "PATCH", { status: "Concluído" }); await refresh(); });
  const f3 = await page.evaluate(() => Core.find("items", "GOV003").archive_file);
  assert.equal(f3, `FINALIZADOS/SSMA/${month}/GOV003 - Treinamento de brigada.html`);
  assert.ok((await readFile(page, f3)).includes("Treinamento de brigada"));
  // reabrir volta para a lista
  await page.evaluate(async () => { await api("items/GOV003", "PATCH", { status: "Em andamento" }); await refresh(); });
  assert.equal(await page.evaluate(() => S.db.finished.some((f) => f.id === "GOV003")), false, label + ": reaberto sai do histórico");
  // 2) summary diário: itens com progresso hoje, com o progresso
  await go(page, "summaries", "#s-type");
  await page.click("button:has-text('Gerar summary')");
  await page.waitForSelector("#s-progress");
  const prog = await page.textContent("#s-progress");
  for (const s of ["GOV001", "Rascunho enviado para revisão da diretora", "IT001", "Cabos lançados até o painel 3", "IT002", "Finalizado", "GOV002"]) assert.ok(prog.includes(s), label + ": summary tem " + s);
  assert.match(await page.textContent(".summary-doc"), /3\. Itens com progresso hoje/);
  if (shots) await page.screenshot({ path: `${shots}/${label}-3-summary.png`, fullPage: true });
  const sumFile = await page.evaluate(() => S.summaries.at(-1).file);
  const sumHtml = await readFile(page, sumFile);
  assert.ok(sumHtml.includes("Itens com progresso hoje") && sumHtml.includes("Cabos lançados até o painel 3"), label + ": summary salvo na pasta");
  return { prog, narrative: await page.textContent(".summary-doc .ai-box") };
}

// ---------------------------------------------------------------- 1) modo heurístico (sem chave)
{
  const page = await newPage();
  assert.match(await page.textContent("#ai-badge"), /heurística/);
  const r = await scenario(page, "heuristico");
  assert.match(r.narrative, /Itens com progresso hoje: \d+/);
  assert.match(r.narrative, /PROJ001 · IT001 Cabos de média tensão: Cabos lançados até o painel 3/);
  await page.context().close();
  console.log("ok - modo heurístico (sem chave)");
}

// ---------------------------------------------------------------- 2) modo com a chave do Claude (API simulada)
{
  let prompt = "";
  const page = await newPage(async (route) => {
    const body = JSON.parse(route.request().postData());
    assert.equal(route.request().headers()["x-api-key"], "sk-ant-teste");
    const text = body.messages[0].content;
    if (/DESTAQUES/.test(text)) prompt = text;
    const out = body.output_config.format ? "{}" : "- Itens com progresso hoje: IT001 cabos lançados até o painel 3; GOV001 rascunho em revisão.";
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ content: [{ type: "text", text: out }], stop_reason: "end_turn" }) });
  });
  assert.match(await page.textContent("#ai-badge"), /claude-opus-5-5/);
  const r = await scenario(page, "ia");
  assert.match(r.narrative, /Itens com progresso hoje: IT001 cabos lançados/);
  assert.ok(prompt.includes('comece por um bullet "Itens com progresso hoje:"') && prompt.includes('"progress_items"') && prompt.includes("Cabos lançados até o painel 3"), "prompt da IA leva os itens com progresso");
  await page.context().close();
  console.log("ok - modo com IA (API simulada)");
}

await browser.close();
assert.deepEqual(errors, [], "erros de JavaScript na página");
console.log("ok - nenhum erro de JavaScript");
