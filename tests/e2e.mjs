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

const SUBS_TEXT = "1. 1. 发动机本地化组装前研究，测算成本，对标 Ale。 Preliminary study on localized engine assembly, cost estimation, and benchmarking with Ale. 2. P11 变速箱巴西产。 Local production of the P11 transmission in Brazil. 3. P30 巴西产发动机。 Local production of the P30 engine in Brazil. 4. 仪表台本地化。 Instrument panel localization. 5. 二工厂冲压件、一工厂钣金件。 Stamped parts from Plant 2 and sheet metal components from Plant 1. 6. Márcio 的本地化课题。 Márcio's localization projects.";

/** Departamentos e pessoas em Configurações viram listas de seleção; entrada com subitens numerados vira projeto com itens. */
async function scenarioDeptsAndSubitems(page, label) {
  // lista inicial de departamentos e responsáveis já vem carregada
  await go(page, "config/deptos", "#dp-text");
  const txt = await page.inputValue("#dp-text");
  for (const l of ["Logistic 物流: Alessandro Barbosa, Peter 姜大鹏", "Production 生产: Lira, Fred, Pino 刘明松", "IT: Chicon, Ridge 崔亚岭"]) assert.ok(txt.includes(l), label + ": departamentos " + l);
  await page.fill("#dp-text", txt + "\nPurchasing 采购: Wang, Ana Paula");
  await page.click("#dp-save");
  await page.waitForSelector("#dp-table >> text=Ana Paula");
  if (shots) await page.screenshot({ path: `${shots}/${label}-4-departamentos.png`, fullPage: true });
  // nova entrada: departamento e responsável são listas; escolher a pessoa preenche o departamento
  await go(page, "entradas", "#f-owner");
  assert.equal(await page.$eval("#f-area", (e) => e.tagName), "SELECT");
  const groups = await page.$$eval("#f-owner optgroup", (g) => g.map((x) => x.label));
  assert.deepEqual(groups.slice(0, 3), ["Logistic 物流", "Production 生产", "Production Control 生产管理"], label + ": pessoas por departamento");
  assert.ok(groups.includes("Purchasing 采购"));
  await page.selectOption("#f-owner", "Peter 姜大鹏");
  assert.equal(await page.inputValue("#f-area"), "Logistic 物流", label + ": departamento preenchido pela pessoa");
  await page.click("#f-areas-imp-chips >> text=EHS");
  await page.click("#f-areas-imp-chips >> text=Quality 品质");
  assert.equal(await page.inputValue("#f-areas-imp"), "EHS, Quality 品质");
  // entrada com subitens numerados (como a INP025) -> projeto com os 6 itens
  const id = await page.evaluate(async (d) => (await api("inputs", "POST", { title: "Localization and Policies", description: d, source: "Diretora", source_detail: "Pedido pontual", owner: "Peter 姜大鹏", area_main: "Logistic 物流" })).id, SUBS_TEXT);
  await page.evaluate(async (id) => { await api(`inputs/${id}/suggest`, "POST"); await refresh(); location.hash = "entradas/" + id; }, id);
  await page.waitForSelector("#t-subs");
  const subs = (await page.inputValue("#t-subs")).split("\n");
  assert.equal(subs.length, 6, label + ": 6 subitens");
  assert.ok(subs[4].endsWith("Plant 1.") && subs[5].startsWith("Márcio"), label + ": subitens separados certo");
  assert.equal(await page.$eval(".t-def[value='novo_projeto']", (c) => c.checked), true, label + ": sugere novo projeto");
  if (shots) await page.screenshot({ path: `${shots}/${label}-5-subitens.png`, fullPage: true });
  await page.click("button:has-text('Confirmar e registrar na lista geral')");
  await page.waitForSelector("text=6 itens");
  const proj = await page.evaluate(() => { const p = S.db.projects.find((x) => x.name === "Localization and Policies"); return { id: p.id, items: p.pitems.map((x) => x.title), owner: p.owner }; });
  assert.equal(proj.items.length, 6);
  assert.ok(proj.items[0].startsWith("发动机本地化组装前研究") && proj.items[1].startsWith("P11 变速箱巴西产"), label + ": itens do projeto");
  await go(page, `projetos/${proj.id}/itens`, "#pi-new-t");
  assert.equal(await page.$eval(`#pi-w-IT001`, (e) => e.tagName + ":" + e.value), "SELECT:Peter 姜大鹏", label + ": responsável do item é lista");
  if (shots) await page.screenshot({ path: `${shots}/${label}-6-projeto.png`, fullPage: true });
  // item já registrado na lista geral com subitens -> botão "Transformar em projeto"
  await page.evaluate(async () => { await api("items", "POST", { title: "Ações de 5S", description: "1. Organizar almoxarifado\n2. Pintar faixas\n3. Auditoria mensal" }); await refresh(); });
  const gid = await page.evaluate(() => S.db.items.find((i) => i.title === "Ações de 5S").id);
  await go(page, "lista/" + gid, ".subs-box button");
  await page.click(".subs-box button");
  await page.waitForSelector("text=3 itens criados");
  assert.deepEqual(await page.evaluate(() => S.db.projects.find((p) => p.name === "Ações de 5S").pitems.map((x) => x.title)), ["Organizar almoxarifado", "Pintar faixas", "Auditoria mensal"]);
}

// ---------------------------------------------------------------- 1) modo heurístico (sem chave)
{
  const page = await newPage();
  assert.match(await page.textContent("#ai-badge"), /heurística/);
  const r = await scenario(page, "heuristico");
  await scenarioDeptsAndSubitems(page, "heuristico");
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
    const sch = body.output_config.format?.schema;
    // avaliação da IA sem "novo projeto": a regra dos subitens tem que valer mesmo assim
    const out = sch?.properties?.relation_mode ? JSON.stringify({ related: [], relation_mode: "novo", include_in: "", relation_explanation: "", scope: "Localização", scope_action: "Estudar",
        priority: "Alta", urgency: "Média", risk_reason: "", impacts: ["Custo"], impact_details: "", definitions: ["acao_geral"], project_id: "", gap_analysis: "", rationale: "Simulado" })
      : sch ? "{}" : "- Itens com progresso hoje: IT001 cabos lançados até o painel 3; GOV001 rascunho em revisão.";
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ content: [{ type: "text", text: out }], stop_reason: "end_turn" }) });
  });
  assert.match(await page.textContent("#ai-badge"), /claude-opus-5-5/);
  const r = await scenario(page, "ia");
  await scenarioDeptsAndSubitems(page, "ia");
  assert.match(await page.evaluate(() => S.db.inputs.at(-1).ai_suggestion.engine), /claude/, "avaliação veio da IA simulada");
  assert.match(r.narrative, /Itens com progresso hoje: IT001 cabos lançados/);
  assert.ok(prompt.includes('comece por um bullet "Itens com progresso hoje:"') && prompt.includes('"progress_items"') && prompt.includes("Cabos lançados até o painel 3"), "prompt da IA leva os itens com progresso");
  await page.context().close();
  console.log("ok - modo com IA (API simulada)");
}

await browser.close();
assert.deepEqual(errors, [], "erros de JavaScript na página");
console.log("ok - nenhum erro de JavaScript");
