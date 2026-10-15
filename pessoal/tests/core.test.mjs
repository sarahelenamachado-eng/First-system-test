// Testes da lógica (sem navegador): node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load() {
  const ctx = vm.createContext({ console, KV: { get: async () => "", set: async () => {} }, fetch: undefined });
  for (const f of ["core.js", "ai.js"]) vm.runInContext(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"), ctx, { filename: f });
  const g = (x) => vm.runInContext(x, ctx);
  g("Core.load(null)");
  return { ctx, g, Core: g("Core"), AI: g("AI"), today: g("todayISO()"), addDays: g("addDays") };
}
const plain = (x) => JSON.parse(JSON.stringify(x)); // objetos do vm vêm de outro "realm"
const kinds = (r) => plain(r.proposals.map((p) => p.kind));

test("modo heurístico: classifica as anotações do dia", async () => {
  const { Core, AI, today, addDays } = load();
  const text = `Fui à academia
- Estudei 2h para a prova de estatística
Não fiz o relatório do estágio
Preciso pagar o boleto da faculdade amanhã
Aprendi que revisar de manhã rende mais
Errei ao deixar tudo para a noite — da próxima vez começar cedo
Ideia: montar um quadro de metas
[ ] Ligar para a dentista`;
  const r = await AI.capture(Core.db, text, today);
  assert.equal(r.engine, "heuristica");
  assert.deepEqual(kinds(r), ["done", "done", "missed", "todo", "learned", "mistake", "note", "todo"]);
  const by = (i) => r.proposals[i];
  assert.equal(by(0).area, "Saúde");
  assert.equal(by(1).area, "Estudos");
  assert.equal(by(2).title, "Relatório do estágio");
  assert.equal(by(3).due, addDays(today, 1));
  assert.equal(by(3).title, "Pagar o boleto da faculdade");
  assert.equal(by(3).area, "Finanças");
  assert.equal(by(5).title, "Errei ao deixar tudo para a noite");
  assert.equal(by(5).lesson, "começar cedo");
  assert.equal(by(7).title, "Ligar para a dentista");
});

test("liga a anotação a uma tarefa em aberto (concluir, avançar, faltou)", async () => {
  const { Core, AI, today } = load();
  const a = Core.addTask({ title: "Relatório do estágio", area: "Estudos", due: today });
  const b = Core.addTask({ title: "Ler capítulo 3 do livro de cálculo", area: "Estudos", due: today });
  const c = Core.addTask({ title: "Lavar o carro", area: "Casa", due: today });
  const r = await AI.capture(Core.db, "Terminei o relatório do estágio\nComecei o capítulo 3 do livro de cálculo, fiz metade\nNão consegui lavar o carro", today);
  assert.deepEqual(plain(r.proposals.map((p) => [p.kind, p.target])), [["done", a.id], ["progress", b.id], ["missed", c.id]]);
});

test("aplicar propostas + sumário diário (feitas, faltaram, aprendi, errei)", async () => {
  const { Core, AI, today, addDays } = load();
  const old = Core.addTask({ title: "Enviar formulário da bolsa", due: addDays(today, -2), date: addDays(today, -3) });
  const t1 = Core.addTask({ title: "Relatório do estágio", due: today });
  Core.addTask({ title: "Comprar presente da mãe", due: addDays(today, 3) });
  const r = await AI.capture(Core.db, "Terminei o relatório do estágio\nFui à academia\nNão fiz a lista de exercícios\nPreciso marcar o médico sexta\nAprendi a usar tabelas dinâmicas\nEsqueci a reunião das 14h — da próxima vez pôr alarme", today);
  r.proposals[1].kind = "done"; // confirma
  Core.applyProposals(r.proposals, today);
  const d = Core.dayData(today);
  assert.equal(d.done.length, 2);                     // relatório + academia
  assert.equal(Core.task(t1.id).status, "Feita");
  assert.equal(d.planned.length, 3);                  // relatório (hoje), bolsa (atrasada), exercícios (faltou)
  assert.equal(d.missed.length, 2);
  assert.ok(d.missed.some((t) => t.id === old.id));
  assert.equal(d.late.length, 1);
  assert.equal(d.pct, 33);
  assert.equal(d.learned.length, 1);
  assert.equal(d.mistakes.length, 1);
  assert.equal(d.mistakes[0].lesson, "pôr alarme");
  assert.equal(d.pending.length, 4);                  // bolsa, presente, exercícios, médico
  assert.equal(Core.assistStats().n, 6);
  const html = Core.summaryHTML(d, { standalone: true });
  for (const s of ["Coisas que fiz", "Faltaram fazer (2)", "O que aprendi", "Onde errei", "pôr alarme", "relatório do estágio"]) assert.ok(html.includes(s), s);
  assert.match(Core.heuristicReflection(d), /Para amanhã, comece por/);
});

test("passar o que faltou para amanhã mantém o 'faltou' de hoje", () => {
  const { Core, today, addDays } = load();
  const t = Core.addTask({ title: "Organizar a mesa", due: today });
  assert.equal(Core.rollOver(today), 1);
  assert.equal(t.due, addDays(today, 1));
  assert.equal(Core.dayData(today).missed.length, 1);
  assert.equal(Core.dayData(addDays(today, 1)).planned.length, 1);
  Core.completeTask(t.id, addDays(today, 1));
  assert.equal(Core.dayData(addDays(today, 1)).missed.length, 0);
  assert.equal(Core.dayData(today).missed.length, 1);
});

test("aprende com as correções: caso parecido segue a decisão anterior", async () => {
  const { Core, AI, today } = load();
  let r = await AI.capture(Core.db, "Meditação 10 minutos", today);
  assert.equal(r.proposals[0].kind, "done");
  r.proposals[0].kind = "note";
  Core.applyProposals(r.proposals, today);
  r = await AI.capture(Core.db, "Meditação 15 minutos", today);
  assert.equal(r.proposals[0].kind, "note");
  assert.match(r.proposals[0].reason, /caso parecido/);
});

test("modo com IA: usa a resposta do Claude e cai no heurístico se falhar", async () => {
  const { Core, AI, ctx, today } = load();
  const t = Core.addTask({ title: "Relatório do estágio", due: today });
  let sent = null;
  ctx.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ proposals: [
      { text: "terminei o relatorio", title: "Relatório do estágio", kind: "done", target_id: t.id, area: "Estudos", priority: "Média", due_date: "", lesson: "", reason: "ok" },
      { text: "esqueci o guarda-chuva", title: "Esqueci o guarda-chuva", kind: "mistake", target_id: "TAR999", area: "Inexistente", priority: "Baixa", due_date: "x", lesson: "ver a previsão", reason: "ok" },
    ] }) }] }) };
  };
  await AI.configure("sk-ant-teste", "claude-opus-5-5");
  const r = await AI.capture(Core.db, "terminei o relatorio\nesqueci o guarda-chuva", today);
  assert.equal(r.engine, "claude-opus-5-5");
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.ok(sent.messages[0].content.includes(t.id));
  assert.deepEqual([r.proposals[0].kind, r.proposals[0].target], ["done", t.id]);
  assert.equal(r.proposals[1].target, "");             // tarefa inexistente é descartada
  assert.ok(Core.db.settings.areas.includes(r.proposals[1].area));
  assert.equal(r.proposals[1].due, "");
  ctx.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const r2 = await AI.capture(Core.db, "Fui à academia", today);
  assert.equal(r2.engine, "heuristica");
  assert.match(r2.error, /401/);
  ctx.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "O que foi bem: tudo." }] }) });
  const refl = await AI.reflect(Core.db, Core.dayData(today));
  assert.equal(refl.text, "O que foi bem: tudo.");
});
