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
  // a plataforma abre em inglês + chinês; os cenários abaixo conferem os textos em português
  await page.evaluate(() => setLang("pt"));
  if (aiMock) await page.evaluate(() => AI.configure("sk-ant-teste", "claude-opus-5-5"));
  await page.evaluate(async () => { await Store.use(await navigator.storage.getDirectory()); await boot(); });
  await page.waitForSelector("#as-text");
  return page;
}
const go = async (page, hash, sel) => { await page.evaluate((h) => { location.hash = h; }, hash); if (sel) await page.waitForSelector(sel); };
/** Escolhe pessoas no campo de responsáveis (lista com caixas de seleção), como a usuária faria. */
async function pickPeople(page, id, names) {
  await page.click(`#${id}-pm summary`);
  for (const n of names) await page.check(`#${id}-pm .pm-o input[value="${n}"]`);
  if (shots && id.startsWith("g-o-")) await page.screenshot({ path: `${shots}/responsaveis-${id}.png` });
  await page.click(`#${id}-pm .pm-foot button:has-text('OK')`);
}
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
    await api("meetings", "POST", { title: "Reunião GPS", date: todayISO(), time: "10:15", duration: 45, actual_duration: 45, status: "Realizada", attendees: ["Peter 姜大鹏", "Carlos"], decisions: ["Aprovar o plano de cabos"] });
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
  await go(page, "lista", ".glist");
  const ids = await page.$$eval("#view .glist tr[data-id]", (t) => t.map((x) => x.dataset.id));
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
  for (const s of ["GOV001", "Rascunho enviado para revisão da diretora", "Subestação", "Cabos de média tensão: Cabos lançados até o painel 3", "Teste do transformador: Finalizado", "GOV002"]) assert.ok(prog.includes(s), label + ": summary tem " + s);
  const doc = await page.textContent(".summary-doc .report");
  const today = await page.evaluate(() => new Date(todayISO() + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long" }));
  for (const s of [`Resumo de ${today}`, "1. Conclusão", "2. Reuniões", "Reunião GPS", "10:15 – 11:00", "Logistic 物流", "Aprovar o plano de cabos", "3. Pendências", "3.1 Pendentes", "Relatório de Xushui para o HQ",
    "3.2 Concluídos hoje", "Contrato de limpeza", "4. Projetos e itens com progresso hoje"]) assert.ok(doc.includes(s), label + ": modelo do summary tem " + s);
  if (shots) await page.screenshot({ path: `${shots}/${label}-3-summary.png`, fullPage: true });
  const sumFile = await page.evaluate(() => S.summaries.at(-1).file);
  const sumHtml = await readFile(page, sumFile);
  assert.ok(sumHtml.includes("Projetos e itens com progresso hoje") && sumHtml.includes("Cabos lançados até o painel 3") && sumHtml.includes("Reunião GPS"), label + ": summary salvo na pasta");
  return { prog, narrative: await page.textContent(".summary-doc .r-conclusion") };
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
  // nova entrada rápida: uma caixa de texto + responsável; departamento e o resto ficam em "Mais detalhes"
  await go(page, "entradas", "#f-text");
  assert.equal(await page.$eval("#f-area", (e) => e.tagName), "SELECT");
  const groups = await page.$$eval("#f-owner-pm .pm-g > b", (g) => g.map((x) => x.textContent));
  assert.deepEqual(groups.slice(0, 3), ["Logistic 物流", "Production 生产", "Production Control 生产管理"], label + ": pessoas por departamento");
  assert.ok(groups.includes("Purchasing 采购"));
  await pickPeople(page, "f-owner", ["Peter 姜大鹏"]);
  assert.equal(await page.inputValue("#f-area"), "Logistic 物流", label + ": departamento preenchido pela pessoa");
  await page.click("summary:has-text('Mais detalhes (opcional)')");
  await page.click("#f-areas-imp-chips >> text=EHS");
  await page.click("#f-areas-imp-chips >> text=Quality 品质");
  assert.equal(await page.inputValue("#f-areas-imp"), "EHS, Quality 品质");
  if (shots) await page.screenshot({ path: `${shots}/${label}-5-entrada-rapida.png`, fullPage: true });
  // entrada com subitens numerados (como a INP025): "Registrar" já cria o projeto com os 6 itens, sem passar pela triagem
  await page.fill("#f-text", "Localization and Policies\n" + SUBS_TEXT);
  await page.click("#f-quick");
  await page.waitForSelector(".quick-ok >> text=6 itens");
  const proj = await page.evaluate(() => { const p = S.db.projects.find((x) => x.name === "Localization and Policies"); return { id: p.id, items: p.pitems.map((x) => x.title), owner: p.owner }; });
  assert.equal(proj.items.length, 6);
  assert.ok(proj.items[0].startsWith("发动机本地化组装前研究") && proj.items[1].startsWith("P11 变速箱巴西产"), label + ": itens do projeto");
  assert.ok(proj.items[4].endsWith("Plant 1.") && proj.items[5].startsWith("Márcio"), label + ": subitens separados certo");
  const inpRec = await page.evaluate(() => S.db.inputs.find((i) => i.title === "Localization and Policies"));
  assert.equal(inpRec.status, "Registrado");
  assert.equal(inpRec.area_main, "Logistic 物流");
  // "Registrar e revisar": triagem mostra os subitens para ajustar e o botão de aceitar a sugestão
  await page.fill("#f-text", "Ações de 5S\n1. Organizar almoxarifado\n2. Pintar faixas\n3. Auditoria mensal");
  await page.click("#f-review");
  await page.waitForSelector("#t-subs");
  assert.equal(await page.inputValue("#t-subs"), "Organizar almoxarifado\nPintar faixas\nAuditoria mensal");
  assert.equal(await page.$eval(".t-def[value='novo_projeto']", (c) => c.checked), true, label + ": sugere novo projeto");
  if (shots) await page.screenshot({ path: `${shots}/${label}-6-triagem.png` });
  await page.fill("#t-subs", "Organizar almoxarifado\nPintar faixas");
  await page.click("button:has-text('Aceitar a sugestão e registrar')");
  await page.waitForFunction(() => S.db.projects.some((p) => p.name === "Ações de 5S"));
  assert.deepEqual(await page.evaluate(() => S.db.projects.find((p) => p.name === "Ações de 5S").pitems.map((x) => x.title)), ["Organizar almoxarifado", "Pintar faixas"]);
  await go(page, `projetos/${proj.id}/itens`, "#pi-new-t");
  assert.equal(await page.inputValue(`#pi-w-IT001`), "Peter 姜大鹏", label + ": responsável do item vem da lista de pessoas");
  // mais de um responsável num item de projeto
  await pickPeople(page, "pi-w-IT001", ["Alessandro Barbosa"]);
  assert.equal(await page.inputValue(`#pi-w-IT001`), "Alessandro Barbosa, Peter 姜大鹏", label + ": dois responsáveis no item do projeto");
  if (shots) await page.screenshot({ path: `${shots}/${label}-7-projeto.png`, fullPage: true });
  // item já registrado na lista geral com subitens -> botão "Transformar em projeto"
  await page.evaluate(async () => { await api("items", "POST", { title: "Programa 5S", description: "1. Organizar almoxarifado\n2. Pintar faixas\n3. Auditoria mensal" }); await refresh(); });
  const gid = await page.evaluate(() => S.db.items.find((i) => i.title === "Programa 5S").id);
  await go(page, "lista/" + gid, ".subs-box button");
  await page.click(".subs-box button");
  await page.waitForSelector("text=3 itens criados");
  await page.waitForFunction(() => S.db.projects.some((p) => p.name === "Programa 5S"));
  assert.deepEqual(await page.evaluate(() => S.db.projects.find((p) => p.name === "Programa 5S").pitems.map((x) => x.title)), ["Organizar almoxarifado", "Pintar faixas", "Auditoria mensal"]);
}

/** Lista geral editável na linha, botão Fechar, projetos menores e aba de riscos e problemas. */
async function scenarioListAndSmall(page, label) {
  const listIds = () => page.$$eval("#view .glist tr[data-id]", (t) => t.map((x) => x.dataset.id));
  await go(page, "lista", "#qa-title");
  // novo item direto na lista: escreve e aperta Enter
  await page.fill("#qa-title", "Comprar EPIs para a brigada");
  await pickPeople(page, "qa-owner", ["Alfredo"]);
  await page.press("#qa-title", "Enter");
  await page.waitForSelector(".glist >> text=Comprar EPIs para a brigada");
  const gid = await page.evaluate(() => S.db.items.find((i) => i.title === "Comprar EPIs para a brigada").id);
  assert.equal(await page.evaluate((id) => Core.find("items", id).area_main, gid), "EHS", label + ": departamento vem da pessoa");
  // mais de um responsável direto na linha: a mudança é salva quando a lista de pessoas fecha
  await pickPeople(page, `g-o-${gid}`, ["Barry 姚鹤康"]);
  await page.waitForFunction((id) => S.db.items.find((i) => i.id === id).owner === "Alfredo, Barry 姚鹤康", gid);
  assert.equal(await page.textContent(`tr[data-id='${gid}'] .pm-sum`), "Alfredo, Barry 姚鹤康");
  // edição na linha: prioridade e progresso
  await page.selectOption(`tr[data-id='${gid}'] td:nth-child(5) select`, "Alta");
  await page.waitForFunction((id) => S.db.items.find((i) => i.id === id).priority === "Alta", gid);
  await page.fill(`tr[data-id='${gid}'] .g-prog`, "Cotação recebida");
  await page.press(`tr[data-id='${gid}'] .g-prog`, "Enter");
  await page.waitForSelector(`tr[data-id='${gid}'] .lp >> text=Cotação recebida`);
  if (shots) await page.screenshot({ path: `${shots}/${label}-8-lista-editavel.png`, fullPage: true });
  // Fechar: sai da lista geral e aparece só em Itens fechados
  await page.click(`tr[data-id='${gid}'] .g-close`);
  await page.waitForSelector(`text=${gid} fechado`);
  await page.waitForFunction((id) => !S.db.items.find((i) => i.id === id).status.includes("Andamento") && !document.querySelector(`.glist tr[data-id='${id}']`), gid);
  assert.ok(!(await listIds()).includes(gid), label + ": item fechado sai da lista geral");
  await go(page, "lista/finalizados", "#view h2");
  assert.ok((await page.textContent("#view")).includes("Comprar EPIs para a brigada"), label + ": item fechado na aba Itens fechados");
  assert.match(await page.textContent("#view .tabs"), /Itens fechados/);
  // Editar título e descrição de um item existente (✎ na linha abre a janela do item)
  await go(page, "lista", ".glist");
  await page.click("tr[data-id='GOV001'] .g-edit");
  await page.waitForSelector("#i-title");
  assert.equal(await page.inputValue("#i-title"), "Relatório de Xushui para o HQ");
  await page.fill("#i-title", "Relatório mensal de Xushui para o HQ");
  await page.fill("#i-desc", "Enviar até sexta com os indicadores de segurança");
  await page.click("#modal-body button:has-text('Salvar')");
  await page.waitForFunction(() => S.db.items.find((i) => i.id === "GOV001").title === "Relatório mensal de Xushui para o HQ", null, { polling: 200 }); // a checagem por intervalo evita depender de quadros de animação com a janela aberta
  assert.equal(await page.evaluate(() => Core.find("items", "GOV001").description), "Enviar até sexta com os indicadores de segurança");
  await page.waitForFunction(() => document.querySelector("#modal h2")?.textContent.includes("Relatório mensal") && !document.querySelector("#modal").classList.contains("hidden"));
  await page.evaluate(() => { closeModal(); location.hash = "lista"; });
  await page.waitForSelector(".glist tr[data-id='GOV001'] >> text=Relatório mensal de Xushui para o HQ");
  // Excluir: pede confirmação e apaga de vez (pela linha, pela janela do item e pela aba Itens fechados)
  const del = await page.evaluate(async () => { const a = await api("items", "POST", { title: "Item criado por engano" }); const b = await api("items", "POST", { title: "Outro item por engano" }); await refresh(); return [a.id, b.id]; });
  await go(page, "lista", `tr[data-id='${del[0]}']`);
  let asked = "";
  const onDialog = (d) => { asked = d.message(); };
  page.on("dialog", onDialog);
  await page.click(`tr[data-id='${del[0]}'] .g-del`);
  await page.waitForFunction((id) => !S.db.items.some((i) => i.id === id) && !document.querySelector(`.glist tr[data-id='${id}']`), del[0]);
  assert.ok(asked.includes(del[0]) && asked.includes("Item criado por engano"), label + ": confirmação antes de excluir: " + asked);
  await go(page, "lista/" + del[1], "#i-delete");
  await page.click("#i-delete");
  await page.waitForFunction((id) => !S.db.items.some((i) => i.id === id), del[1]);
  assert.ok(await page.evaluate(() => document.querySelector("#modal").classList.contains("hidden")), label + ": janela fecha após excluir");
  await go(page, "lista/finalizados", ".f-del");
  await page.click(`tr:has-text('Comprar EPIs para a brigada') .f-del`);
  await page.waitForFunction((id) => !S.db.items.some((i) => i.id === id) && !S.db.finished.some((f) => f.id === id), gid);
  page.off("dialog", onDialog);
  // projetos menores e temporários: aba própria, fora da lista de projetos
  await go(page, "temporarios", "#tp-name");
  await page.fill("#tp-name", "Mutirão de 5S no almoxarifado");
  await pickPeople(page, "tp-owner", ["Lira", "Fred"]);
  await page.selectOption("#tp-purpose", "Controle de risco temporário");
  await page.fill("#tp-end", await page.evaluate(() => addDays(todayISO(), 20)));
  await page.fill("#tp-items", "Separar materiais\nPintar faixas");
  await page.click("#tp-add");
  await page.waitForSelector("#view table >> text=Mutirão de 5S no almoxarifado");
  const sp = await page.evaluate(() => S.db.projects.find((p) => p.name === "Mutirão de 5S no almoxarifado"));
  assert.equal(sp.owner, "Lira, Fred", label + ": projeto menor com dois responsáveis");
  assert.equal(sp.small, true); assert.equal(sp.purpose, "Controle de risco temporário"); assert.equal(sp.dept, "Production 生产");
  assert.deepEqual(sp.pitems.map((x) => x.title), ["Separar materiais", "Pintar faixas"]);
  assert.ok((await page.textContent("#view table")).includes("Controle de risco temporário"));
  if (shots) await page.screenshot({ path: `${shots}/${label}-9-projetos-menores.png`, fullPage: true });
  await go(page, "projetos", "#view table");
  assert.ok(!(await page.textContent("#view")).includes("Mutirão de 5S"), label + ": projeto menor não aparece em Projetos");
  // Projetos abre na lista de projetos (o dashboard é a segunda aba)
  assert.match(await page.textContent("#view .tabs a.on"), /Lista de projetos/, label + ": Projetos abre na lista");
  assert.ok((await page.textContent("#view table")).includes("Subestação"), label + ": lista de projetos na primeira página");
  // aba Riscos e problemas no projeto menor e no projeto normal
  for (const pid of [sp.id, "PROJ001"]) {
    await go(page, `projetos/${pid}/riscos`, "#is-text");
    await page.selectOption("#is-type", "Risco");
    await page.fill("#is-text", "Chuva pode atrasar a pintura " + pid);
    await page.selectOption("#is-sev", "Alta");
    await page.fill("#is-action", "Pintar na área coberta");
    await page.click("#is-add");
    await page.waitForSelector("#is-table >> text=Chuva pode atrasar a pintura " + pid);
    await page.fill("#is-text", "Faltou tinta " + pid);
    await page.click("#is-add");
    await page.waitForSelector("#is-table >> text=Faltou tinta " + pid);
  }
  if (shots) await page.screenshot({ path: `${shots}/${label}-10-riscos-problemas.png`, fullPage: true });
  await page.click("#is-table button:has-text('Riscos')");
  await page.waitForFunction(() => Core.find("projects", "PROJ001").issues.some((x) => x.risk_id));
  const rid = await page.evaluate(() => Core.find("projects", "PROJ001").issues.find((x) => x.risk_id).risk_id);
  assert.ok((await page.evaluate((r) => Core.find("risks", r).title, rid)).startsWith("Chuva pode atrasar"), label + ": risco enviado ao registro de riscos");
  await page.selectOption("#is-table tr:has-text('Faltou tinta') select", "Resolvido");
  await page.waitForFunction(() => Core.find("projects", "PROJ001").issues.some((x) => x.status === "Resolvido"));
  await go(page, "temporarios", "#view table");
  assert.match(await page.textContent(`#view tr:has-text('${sp.id}')`), /2/, label + ": contagem de riscos e problemas abertos");
  // excluir projetos: pede confirmação dizendo o que acontece com itens, riscos e reuniões
  let msg = "";
  const onDlg = (d) => { msg = d.message(); };
  page.on("dialog", onDlg);
  await page.click(`#view tr:has-text('${sp.id}') .p-del`);
  await page.waitForFunction((id) => !S.db.projects.some((p) => p.id === id), sp.id, { polling: 100 });
  assert.ok(msg.includes(sp.id) && msg.includes("2 itens") && msg.includes("2 riscos/problemas") && msg.includes("pasta do projeto"), label + ": confirmação explica o que acontece: " + msg);
  assert.ok(!(await page.textContent("#view")).includes("Mutirão de 5S"), label + ": projeto menor excluído some da lista");
  const p5 = await page.evaluate(() => S.db.projects.find((p) => p.name === "Programa 5S").id);
  const g5 = await page.evaluate(() => S.db.items.find((i) => i.title === "Programa 5S").id);
  await go(page, `projetos/${p5}`, "#pd-delete");
  await page.click("#pd-delete");
  await page.waitForFunction((id) => !S.db.projects.some((p) => p.id === id) && location.hash === "#projetos", p5, { polling: 100 });
  assert.ok(msg.includes("1 itens da lista geral"), label + ": avisa do item da lista geral ligado: " + msg);
  assert.deepEqual(await page.evaluate((g) => Core.find("items", g).links.projects || [], g5), [], label + ": item da lista geral fica, sem o vínculo");
  page.off("dialog", onDlg);
}

/** Reunião escrita de forma corrida: a IA (ou a heurística) preenche os campos e a usuária só ajusta antes de salvar. */
async function scenarioMeetingText(page, label, ai) {
  const today = await page.evaluate(() => todayISO()), yesterday = await page.evaluate(() => addDays(todayISO(), -1)), tomorrow = await page.evaluate(() => addDays(todayISO(), 1));
  await go(page, "reunioes/confirmar", "#mt-text");
  assert.equal(await page.$eval("#m-review", (d) => d.open), false, label + ": campos começam fechados (opcionais)");
  const text = "Reunião de segurança ontem às 9h30, 40 min, com Alfredo e Barry. Decidimos trocar os extintores do almoxarifado.\nAção: Alfredo compra os extintores até sexta.";
  await page.fill("#mt-text", text);
  await page.click("#mt-fill");
  await page.waitForFunction(() => document.querySelector("#m-review").open && document.querySelector("#m-filled .alert"), null, { polling: 100 });
  assert.equal(await page.inputValue("#m-date"), yesterday, label + ": data (ontem)");
  assert.equal(await page.inputValue("#m-time"), "09:30", label + ": horário");
  assert.equal(await page.inputValue("#m-dur"), "40", label + ": duração");
  assert.equal(await page.inputValue("#m-attn"), "Alfredo, Barry 姚鹤康", label + ": participantes do cadastro");
  assert.equal(await page.inputValue("#m-dept"), "EHS", label + ": departamento dos participantes");
  assert.equal(await page.inputValue("#m-title"), ai ? "Segurança: troca de extintores" : "Reunião de segurança ontem às 9h30, 40 min, com Alfredo e Barry", label + ": título sugerido");
  if (shots) await page.screenshot({ path: `${shots}/${label}-14-reuniao-texto.png`, fullPage: true });
  // versão editável: ajusta o título e salva
  await page.fill("#m-title", "Reunião de segurança");
  await page.click("#m-save");
  await page.waitForFunction(() => S.db.meetings.some((m) => m.title === "Reunião de segurança"), null, { polling: 100 });
  const m = await page.evaluate(() => S.db.meetings.find((x) => x.title === "Reunião de segurança"));
  assert.equal(m.minutes, text); assert.equal(m.date, yesterday); assert.equal(m.time, "09:30"); assert.equal(m.status, "Realizada");
  assert.deepEqual(m.attendees, ["Alfredo", "Barry 姚鹤康"]); assert.equal(m.departments, "EHS");
  // solicitação: só o texto e "Registrar solicitação" (os campos são preenchidos sozinhos)
  await go(page, "reunioes/solicitadas", "#rqt-text");
  await page.fill("#rqt-text", "Alinhamento com Lira sobre o mutirão de 5S, amanhã às 14h, 30 min");
  await page.click("#rq-save");
  await page.waitForFunction(() => S.db.meetings.some((x) => x.kind === "Solicitada" && (x.agenda || "").includes("mutirão de 5S")), null, { polling: 100 });
  const rq = await page.evaluate(() => S.db.meetings.find((x) => x.kind === "Solicitada" && (x.agenda || "").includes("mutirão de 5S")));
  assert.equal(rq.date, tomorrow); assert.equal(rq.time, "14:00"); assert.equal(rq.duration, 30); assert.equal(rq.status, "Agendada");
  assert.deepEqual(rq.attendees, ["Lira"], label + ": participante da solicitação");
  // agendada: abre o convite para Teams e DingTalk, sai da lista de solicitações e vai para a aba Agendadas
  await page.waitForSelector("#inv-box");
  const href = await page.getAttribute("#inv-teams", "href");
  assert.ok(href.startsWith("https://teams.microsoft.com/l/meeting/new?") && href.includes("subject=") && href.includes("startTime="), label + ": link do Teams preenchido");
  const ics = await page.evaluate((id) => icsFor(byId("meetings", id)), rq.id);
  assert.ok(ics.includes("BEGIN:VEVENT") && ics.includes("DTSTART:") && /SUMMARY:.*mutir/i.test(ics), label + ": convite .ics");
  await page.check("#inv-done-teams");
  await page.waitForFunction((id) => S.db.meetings.find((x) => x.id === id).in_teams === true && !document.querySelector("input:disabled"), rq.id, { polling: 100 });
  await page.evaluate(() => closeModal());
  await go(page, "reunioes/solicitadas", "#rqt-text");
  assert.ok(!(await page.textContent("#view")).includes(rq.id), label + ": agendada sai da lista de solicitações");
  await go(page, "reunioes/agendadas", ".sched-list");
  assert.ok((await page.textContent(`.sched-list tr[data-id='${rq.id}']`)).includes(tomorrow), label + ": aparece em Agendadas");
  await page.check(`.sched-list tr[data-id='${rq.id}'] .sc-ding`);
  await page.waitForFunction((id) => S.db.meetings.find((x) => x.id === id).in_dingtalk === true && !document.querySelector("input:disabled"), rq.id, { polling: 100 });
  if (shots) await page.screenshot({ path: `${shots}/${label}-16-agendadas.png`, fullPage: true });
  // solicitação sem data: fica em Solicitações; "Agendar" leva para Agendadas
  await go(page, "reunioes/solicitadas", "#rqt-text");
  await page.fill("#rqt-text", "Revisão do layout do almoxarifado com Fred");
  await page.click("#rq-save");
  await page.waitForFunction(() => S.db.meetings.some((x) => x.kind === "Solicitada" && (x.agenda || "").includes("layout do almoxarifado")), null, { polling: 100 });
  const r2 = await page.evaluate(() => S.db.meetings.find((x) => (x.agenda || "").includes("layout do almoxarifado")).id);
  await page.waitForSelector(`#view tr:has-text('${r2}') button:has-text('Agendar')`);
  await page.click(`#view tr:has-text('${r2}') button:has-text('Agendar')`);
  await page.fill("#sc-date", tomorrow); await page.fill("#sc-time", "16:00");
  await page.click("#modal-body button:has-text('Agendar e gerar convite')");
  await page.waitForSelector("#inv-box");
  assert.equal(await page.evaluate((id) => Core.find("meetings", id).status, r2), "Agendada");
  if (shots) await page.screenshot({ path: `${shots}/${label}-17-convite.png` });
  await page.evaluate(() => closeModal());
  assert.ok(!(await page.textContent("#view")).includes(r2), label + ": agendada sai da lista de solicitações");
  await go(page, "reunioes/solicitadas", "#rqt-text");
  // solicitação sem data no texto não ganha a data de hoje
  await page.fill("#rqt-text", "Conversa com o RH sobre treinamentos");
  await page.click("#rqt-fill");
  await page.waitForFunction(() => document.querySelector("#rq-review").open, null, { polling: 100 });
  assert.equal(await page.inputValue("#rq-date"), "", label + ": sem data citada, a data fica vazia");
  assert.ok(today);
}

/** Ações do administrador: ações para ela, sugestões e preocupações, com entrada rápida, editar, fechar e excluir. */
async function scenarioAdmin(page, label, ai) {
  await go(page, "admin", "#ad-text");
  const friday = await page.evaluate(() => { const c = new Date(todayISO() + "T12:00:00").getDay(); return addDays(todayISO(), ((5 - c + 7) % 7) || 7); });
  await page.fill("#ad-text", "A diretora me pediu para revisar o orçamento de segurança até sexta");
  await page.click("#ad-add");
  await page.waitForFunction(() => (S.db.admin || []).length === 1, null, { polling: 100 });
  let a = await page.evaluate(() => S.db.admin[0]);
  assert.equal(a.type, "Ação para mim"); assert.equal(a.from, "Diretora"); assert.equal(a.due, friday, label + ": prazo até sexta");
  assert.equal(a.title, ai ? "Revisar orçamento de segurança" : "A diretora me pediu para revisar o orçamento de segurança até sexta", label + ": título");
  // sugestão: preencher os campos, ajustar e salvar
  await page.fill("#ad-text", "Sugestão: fazer uma reunião semanal de 15 min com EHS para acompanhar as inspeções");
  await page.click("#ad-fill");
  await page.waitForFunction(() => document.querySelector("#ad-review").open, null, { polling: 100 });
  assert.equal(await page.inputValue("#ad-type"), "Sugestão", label + ": tipo sugestão");
  await page.fill("#ad-title", "Reunião semanal de 15 min com EHS");
  await page.click("#ad-save");
  await page.waitForFunction(() => (S.db.admin || []).length === 2, null, { polling: 100 });
  assert.equal(await page.evaluate(() => S.db.admin[1].title), "Reunião semanal de 15 min com EHS");
  await page.fill("#ad-text", "Estou preocupada com o atraso da subestação, pode afetar o prazo do projeto");
  await page.click("#ad-add");
  await page.waitForFunction(() => (S.db.admin || []).length === 3, null, { polling: 100 });
  assert.equal(await page.evaluate(() => S.db.admin[2].type), "Preocupação", label + ": tipo preocupação");
  if (shots) await page.screenshot({ path: `${shots}/${label}-15-acoes-admin.png`, fullPage: true });
  // abas por tipo
  await go(page, "admin/sugestoes", ".adlist");
  assert.deepEqual(await page.$$eval(".adlist tr[data-id]", (r) => r.map((x) => x.dataset.id)), ["ADM002"], label + ": aba Sugestões");
  // editar
  await go(page, "admin", ".adlist");
  await page.click("tr[data-id='ADM003'] .ad-edit");
  await page.waitForSelector("#ae-title");
  await page.fill("#ae-title", "Atraso da subestação");
  await page.fill("#ae-note", "Conversei com a Ana");
  await page.click("#ae-save");
  await page.waitForFunction(() => S.db.admin.find((x) => x.id === "ADM003").title === "Atraso da subestação", null, { polling: 100 });
  assert.equal(await page.evaluate(() => S.db.admin.find((x) => x.id === "ADM003").history[0].text), "Conversei com a Ana");
  // fechar: sai dos abertos e vai para Fechados
  await page.click("tr[data-id='ADM001'] .ad-close");
  await page.waitForFunction(() => S.db.admin.find((x) => x.id === "ADM001").status === "Fechado" && !document.querySelector(".adlist tr[data-id='ADM001']"), null, { polling: 100 });
  await go(page, "admin/fechados", ".adlist");
  assert.deepEqual(await page.$$eval(".adlist tr[data-id]", (r) => r.map((x) => x.dataset.id)), ["ADM001"], label + ": aba Fechados");
  // excluir (com confirmação)
  await go(page, "admin", ".adlist");
  await page.click("tr[data-id='ADM002'] .ad-del");
  await page.waitForFunction(() => !S.db.admin.some((x) => x.id === "ADM002"), null, { polling: 100 });
  assert.equal(await page.evaluate(() => S.db.admin.length), 2);
}

/** Interface em inglês e chinês: cada texto com o inglês em cima e o chinês embaixo. */
async function scenarioBilingual(page, label) {
  await page.evaluate(() => setLang("bi"));
  await go(page, "lista", ".glist");
  const nav = await page.$$eval("nav a[href='#lista'] .bi-pair", (e) => e.map((x) => [x.childNodes[0].textContent, x.querySelector(".bi-zh").textContent]));
  assert.deepEqual(nav, [["General list", "总清单"]], label + ": menu em duas linhas");
  assert.match(await page.$eval("nav a[href='#admin']", (e) => e.innerText), /Admin actions\s*\n\s*管理员事项/, label + ": aba Ações do administrador");
  const h1 = await page.$eval("#view h1", (e) => e.innerText);
  assert.ok(/General governance list|General list/i.test(h1.split("\n")[0]) && /[\u4e00-\u9fff]/.test(h1.split("\n")[1] || ""), label + ": título inglês em cima, chinês embaixo: " + h1);
  assert.match(await page.$eval(".g-close", (e) => e.innerText), /Close\s*\n?\s*关闭/);
  const ph = await page.getAttribute("#qa-title", "placeholder");
  assert.equal(ph, "What needs to be done? / 需要做什么？", label + ": placeholder sem marcadores");
  assert.ok(!(await page.content()).includes("\uE000"), label + ": nenhum marcador sobrando");
  if (shots) await page.screenshot({ path: `${shots}/${label}-11-ingles-chines.png`, fullPage: true });
  await go(page, "temporarios", "#tp-name");
  assert.match(await page.$eval("#view h1", (e) => e.innerText), /Small and temporary projects\s*\n\s*小型及临时项目/);
  if (shots) await page.screenshot({ path: `${shots}/${label}-12-temporarios-bi.png`, fullPage: true });
  await go(page, "entradas", "#f-text");
  assert.match(await page.$eval("#f-quick", (e) => e.innerText), /Register\s*\n\s*登记/);
  if (shots) await page.screenshot({ path: `${shots}/${label}-13-entradas-bi.png`, fullPage: true });
  await page.evaluate(() => setLang("pt"));
}

// ---------------------------------------------------------------- 1) modo heurístico (sem chave)
{
  const page = await newPage();
  assert.match(await page.textContent("#ai-badge"), /heurística/);
  const r = await scenario(page, "heuristico");
  await scenarioDeptsAndSubitems(page, "heuristico");
  await scenarioListAndSmall(page, "heuristico");
  await scenarioMeetingText(page, "heuristico", false);
  await scenarioAdmin(page, "heuristico", false);
  await scenarioBilingual(page, "heuristico");
  assert.match(r.narrative, /^Hoje foram realizadas 1 reuniões e discutidos 1 tópicos/);
  assert.match(r.narrative, /\n1\. Reunião GPS: Aprovar o plano de cabos/);
  assert.match(r.narrative, /Subestação: /);
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
    if (/CONCLUSÃO/.test(text)) prompt = text;
    const sch = body.output_config.format?.schema;
    // avaliação da IA sem "novo projeto": a regra dos subitens tem que valer mesmo assim
    const out0 = sch?.properties?.type?.enum ? JSON.stringify(/orçamento/.test(text) ? { type: "Ação para mim", title: "Revisar orçamento de segurança", from: "Diretora", due: "", priority: "Alta", dept: "EHS" } : { type: "", title: "", from: "", due: "", priority: "", dept: "" })
      : sch?.properties?.attendees && sch?.properties?.mtype ? JSON.stringify(/troca/.test(text) || /extintores/.test(text)
        ? { title: "Segurança: troca de extintores", date: "", time: "", duration: 0, attendees: ["Alfredo", "Barry 姚鹤康"], departments: ["EHS"], project_id: "", level: "Gerencial", mtype: "Decisão", scheduling: "Pré-agendada", agenda: "Trocar extintores" }
        : { title: "", date: "", time: "", duration: 0, attendees: [], departments: [], project_id: "", level: "", mtype: "", scheduling: "", agenda: "" })
      : sch?.properties?.relation_mode ? JSON.stringify({ related: [], relation_mode: "novo", include_in: "", relation_explanation: "", scope: "Localização", scope_action: "Estudar",
        priority: "Alta", urgency: "Média", risk_reason: "", impacts: ["Custo"], impact_details: "", definitions: ["acao_geral"], project_id: "", gap_analysis: "", rationale: "Simulado" })
      : sch ? "{}" : "Hoje houve 1 reunião (GPS).\n1. Itens com progresso hoje: IT001 cabos lançados até o painel 3; GOV001 rascunho em revisão.";
    const out = out0;
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ content: [{ type: "text", text: out }], stop_reason: "end_turn" }) });
  });
  assert.match(await page.textContent("#ai-badge"), /claude-opus-5-5/);
  const r = await scenario(page, "ia");
  await scenarioDeptsAndSubitems(page, "ia");
  await scenarioListAndSmall(page, "ia");
  await scenarioMeetingText(page, "ia", true);
  await scenarioAdmin(page, "ia", true);
  await scenarioBilingual(page, "ia");
  assert.match(await page.evaluate(() => S.db.inputs.at(-1).ai_suggestion.engine), /claude/, "avaliação veio da IA simulada");
  assert.match(r.narrative, /Itens com progresso hoje: IT001 cabos lançados/);
  assert.ok(prompt.includes("lista numerada") && prompt.includes('"projetos_e_itens_com_progresso"') && prompt.includes("Cabos lançados até o painel 3") && prompt.includes("Aprovar o plano de cabos"), "prompt da IA leva reuniões e progresso");
  await page.context().close();
  console.log("ok - modo com IA (API simulada)");
}

await browser.close();
assert.deepEqual(errors, [], "erros de JavaScript na página");
console.log("ok - nenhum erro de JavaScript");
