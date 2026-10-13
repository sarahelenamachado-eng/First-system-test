/* Editor visual de fluxos (SVG): nós arrastáveis, ligações com rótulo, geração pelos dados ou pela IA.
 * Cada fluxo é um registro em db.flows: { nodes:[{id,label,type,ref,x,y}], edges:[{id,from,to,label}] }. */
const FlowEd = {
  flow: null,
  sel: null,          // { kind: "node"|"edge", id }
  connecting: null,   // id do nó de origem quando em modo "Conectar"
  connectMode: false,
  drag: null,
  _saveTimer: null,

  TYPES: ["project", "risk", "item", "cause", "impact", "action", "other"],
  TYPE_LABEL: { project: "Projeto", risk: "Risco", item: "Item", cause: "Causa", impact: "Impacto", action: "Ação", other: "Outro" },

  style(type) {
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#C00000";
    return {
      project: { fill: "#ffffff", stroke: accent, sw: 2.5, text: "#1a1a1a" },
      risk: { fill: "#fdeaea", stroke: accent, sw: 1.5, text: "#7a0000" },
      impact: { fill: "#efefef", stroke: "#6b6b6b", sw: 1.2, text: "#1a1a1a" },
      item: { fill: "#ffffff", stroke: "#9a9a9a", sw: 1.2, text: "#1a1a1a" },
      cause: { fill: "#ffffff", stroke: "#9a9a9a", sw: 1.2, text: "#1a1a1a" },
      action: { fill: "#fff6e5", stroke: "#a86500", sw: 1.2, text: "#5a3600" },
      other: { fill: "#ffffff", stroke: "#bdbdbd", sw: 1, text: "#333333" },
    }[type] || { fill: "#fff", stroke: "#bbb", sw: 1, text: "#333" };
  },
  lines(label) {
    const words = String(label || "").split(/\s+/), out = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > 28 && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    }
    if (cur) out.push(cur);
    if (out.length > 3) { out.length = 3; out[2] = out[2].slice(0, 25) + "…"; }
    return out.length ? out : [""];
  },
  size(n) { const ls = this.lines(n.label); return { w: Math.min(230, Math.max(120, Math.max(...ls.map((l) => l.length)) * 7 + 26)), h: 18 + ls.length * 16, ls }; },

  // ------------------------------------------------------------ desenho
  svg() {
    const f = this.flow, E = (x) => esc(x);
    const nodes = f.nodes || [], edges = f.edges || [];
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    let W = 900, H = 500;
    for (const n of nodes) { const s = this.size(n); W = Math.max(W, n.x + s.w + 80); H = Math.max(H, n.y + s.h + 80); }
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#C00000";
    const edgeSvg = edges.map((e) => {
      const a = byId[e.from], b = byId[e.to];
      if (!a || !b) return "";
      const sa = this.size(a), sb = this.size(b);
      let x1 = a.x + sa.w, y1 = a.y + sa.h / 2, x2 = b.x, y2 = b.y + sb.h / 2;
      if (b.x + sb.w / 2 < a.x + sa.w / 2) { x1 = a.x; x2 = b.x + sb.w; }        // destino à esquerda
      const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (x2 >= x1 ? 1 : -1);
      const sel = this.sel?.kind === "edge" && this.sel.id === e.id;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, lab = tv(e.label);
      return `<g class="fl-edge" data-edge="${E(e.id)}">
        <path d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" fill="none" stroke="transparent" stroke-width="14"/>
        <path d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" fill="none" stroke="${sel ? accent : "#8a8a8a"}" stroke-width="${sel ? 2.5 : 1.5}" marker-end="url(#arrow${sel ? "S" : ""})"/>
        ${lab ? `<rect x="${mx - lab.length * 3.4 - 6}" y="${my - 10}" width="${lab.length * 6.8 + 12}" height="18" rx="9" fill="#ffffff" stroke="#d6d6d6"/>
        <text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="11" fill="#444">${E(lab)}</text>` : ""}
      </g>`;
    }).join("");
    const nodeSvg = nodes.map((n) => {
      const s = this.size(n), st = this.style(n.type), sel = this.sel?.kind === "node" && this.sel.id === n.id;
      const src = this.connecting === n.id;
      return `<g class="fl-node" data-node="${E(n.id)}" transform="translate(${n.x},${n.y})">
        <rect width="${s.w}" height="${s.h}" rx="8" fill="${st.fill}" stroke="${sel || src ? accent : st.stroke}" stroke-width="${sel || src ? 3 : st.sw}" ${src ? 'stroke-dasharray="5 3"' : ""}/>
        ${n.type === "project" ? `<rect width="6" height="${s.h}" rx="3" fill="${accent}"/>` : ""}
        <text x="${s.w / 2}" y="18" text-anchor="middle" font-size="12.5" fill="${st.text}" font-weight="${n.type === "project" || n.type === "risk" ? 700 : 500}">
          ${s.ls.map((l, i) => `<tspan x="${s.w / 2}" dy="${i ? 16 : 0}">${E(l)}</tspan>`).join("")}</text>
        <title>${E(t(this.TYPE_LABEL[n.type] || n.type))}${n.ref ? " · " + E(n.ref) : ""}: ${E(n.label)}</title>
      </g>`;
    }).join("");
    return `<svg id="fl-svg" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fbfbfb">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8a8a8a"/></marker>
        <marker id="arrowS" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${accent}"/></marker>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#efefef"/></pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" class="fl-bg"/>
      ${edgeSvg}${nodeSvg}
    </svg>`;
  },

  panel() {
    const f = this.flow, sel = this.sel;
    const labels = S.db.settings.lists.flow_edge_labels || [];
    let props = `<p class="muted">${t("Clique em um nó ou ligação para editar. Arraste os nós para organizar. Duplo clique no fundo cria um nó.")}</p>`;
    if (sel?.kind === "node") {
      const n = f.nodes.find((x) => x.id === sel.id);
      if (n) props = `<h3>${t("Nó selecionado")}</h3>${L("Texto")}<textarea id="fl-label" style="min-height:60px">${esc(n.label)}</textarea>
        <div class="row"><div>${L("Tipo")}<select id="fl-type">${this.TYPES.map((x) => `<option value="${x}" ${x === n.type ? "selected" : ""}>${esc(t(this.TYPE_LABEL[x]))}</option>`).join("")}</select></div>
        <div>${L("Registro (ID)")}<input id="fl-ref" value="${esc(n.ref)}" placeholder="PROJ001"></div></div>
        <div class="actions"><button class="small" onclick="FlowEd.applyNode()">${t("Aplicar")}</button>
        ${n.ref ? `<button class="small ghost" onclick="FlowEd.openRef('${esc(n.ref)}')">${t("Abrir registro")}</button>` : ""}
        <button class="small ghost danger" onclick="FlowEd.removeSel()">${t("Excluir")}</button></div>`;
    } else if (sel?.kind === "edge") {
      const e = f.edges.find((x) => x.id === sel.id);
      if (e) props = `<h3>${t("Ligação selecionada")}</h3>${L("Rótulo")}<input id="fl-elabel" list="fl-labels" value="${esc(tv(e.label))}">
        <datalist id="fl-labels">${labels.map((l) => `<option value="${esc(t(l))}">`).join("")}</datalist>
        <div class="actions"><button class="small" onclick="FlowEd.applyEdge()">${t("Aplicar")}</button><button class="small ghost" onclick="FlowEd.reverseEdge()">${t("Inverter sentido")}</button>
        <button class="small ghost danger" onclick="FlowEd.removeSel()">${t("Excluir")}</button></div>`;
    }
    return props;
  },

  view(flow) {
    this.flow = flow;
    const scopeName = flow.scope_col === "geral" ? t("Geral (todos os projetos e riscos)")
      : `${flow.scope_id} · ${esc((Core.find(flow.scope_col, flow.scope_id) || {}).name || (Core.find(flow.scope_col, flow.scope_id) || {}).title || "")}`;
    return `<p><a href="#fluxos">← ${t("Fluxos")}</a></p>
    <h1>${flow.id} · ${esc(flow.title)}</h1><p class="muted">${t("Escopo")}: ${scopeName} · ${t("gerado por")} ${esc(tv(flow.engine) || "—")}</p>
    <div class="toolbar">
      <select id="fl-newtype">${this.TYPES.map((x) => `<option value="${x}">${esc(t(this.TYPE_LABEL[x]))}</option>`).join("")}</select>
      <button class="small" onclick="FlowEd.addNode()">${t("+ Nó")}</button>
      <button class="small ${this.connectMode ? "" : "ghost"}" id="fl-connect" onclick="FlowEd.toggleConnect()">${t(this.connectMode ? "Conectando… (clique origem e destino)" : "Conectar nós")}</button>
      <button class="small ghost" onclick="FlowEd.relayout()">${t("Reorganizar")}</button>
      <button class="small ghost" onclick="busy(this, ()=>FlowEd.generate('data'))">${t("Gerar pelos dados")}</button>
      <button class="small" onclick="busy(this, ()=>FlowEd.generate('ai'))">${t("Gerar com IA")}</button>
      <button class="small ghost" onclick="FlowEd.exportSvg()">${t("Exportar imagem (SVG)")}</button>
    </div>
    <div class="flow-wrap"><div class="flow-canvas" id="fl-canvas">${this.svg()}</div>
      <div class="flow-side card" id="fl-panel">${this.panel()}</div></div>
    <div class="grid" style="margin-top:14px">
      <div class="card"><h2>${t("Descrição para a IA")}</h2>
        <p class="muted">${t("Descreva o que este fluxo deve mostrar: causas, consequências, quais projetos e riscos se relacionam e por quê.")}</p>
        <textarea id="fl-desc" style="min-height:110px">${esc(flow.description)}</textarea>
        <div class="actions"><button onclick="busy(this, ()=>FlowEd.generate('ai'))">${t("Gerar com IA")}</button></div></div>
      <div class="card"><h2>${t("Ensinar a IA")}</h2>
        <p class="muted">${t("FLOW_TEACH_HELP")}</p>
        ${L("Regras para montar fluxos (valem para todos)")}<textarea id="fl-guide" style="min-height:110px" placeholder="${esc(t("FLOW_GUIDE_PLACEHOLDER"))}">${esc(S.db.settings.flow_guidelines)}</textarea>
        <div class="actions"><button class="ghost" onclick="busy(this, ()=>FlowEd.saveGuide())">${t("Salvar regras")}</button>
          <button onclick="busy(this, ()=>FlowEd.learn())">${t("Salvar este fluxo como exemplo")}</button>
          <span class="muted">${t("{n} exemplos salvos", { n: (S.db.flow_examples || []).length })}</span></div></div>
    </div>`;
  },

  mount() {
    const c = $("#fl-canvas");
    if (!c) return;
    c.onpointerdown = (ev) => this.down(ev);
    c.onpointermove = (ev) => this.move(ev);
    c.onpointerup = (ev) => this.up(ev);
    c.ondblclick = (ev) => this.dbl(ev);
  },
  redraw() { $("#fl-canvas").innerHTML = this.svg(); $("#fl-panel").innerHTML = this.panel(); },
  pt(ev) { const r = $("#fl-svg").getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; },

  // ------------------------------------------------------------ interação
  down(ev) {
    const g = ev.target.closest("[data-node],[data-edge]");
    if (!g) { this.sel = null; this.redraw(); return; }
    if (g.dataset.edge) { this.sel = { kind: "edge", id: g.dataset.edge }; this.redraw(); return; }
    const id = g.dataset.node;
    if (this.connectMode) {
      if (!this.connecting) { this.connecting = id; this.redraw(); return; }
      if (this.connecting !== id) {
        const labels = S.db.settings.lists.flow_edge_labels || [];
        this.flow.edges.push({ id: "E" + Date.now().toString(36), from: this.connecting, to: id, label: labels[2] || "" });
        this.sel = { kind: "edge", id: this.flow.edges.at(-1).id };
        this.save();
      }
      this.connecting = null; this.redraw(); return;
    }
    const n = this.flow.nodes.find((x) => x.id === id), p = this.pt(ev);
    this.drag = { id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    this.sel = { kind: "node", id };
    $("#fl-canvas").setPointerCapture(ev.pointerId);
    $("#fl-panel").innerHTML = this.panel();
  },
  move(ev) {
    if (!this.drag) return;
    const n = this.flow.nodes.find((x) => x.id === this.drag.id), p = this.pt(ev);
    n.x = Math.max(0, Math.round((p.x - this.drag.dx) / 10) * 10);
    n.y = Math.max(0, Math.round((p.y - this.drag.dy) / 10) * 10);
    this.drag.moved = true;
    $("#fl-canvas").innerHTML = this.svg();
  },
  up() { if (this.drag?.moved) this.save(); this.drag = null; this.redraw(); },
  dbl(ev) {
    if (ev.target.closest("[data-node]")) { $("#fl-label")?.focus(); return; }
    const p = this.pt(ev);
    const label = prompt(t("Texto do novo nó:"));
    if (!label) return;
    this.flow.nodes.push({ id: "N" + Date.now().toString(36), label, type: $("#fl-newtype").value, ref: "", x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 });
    this.sel = { kind: "node", id: this.flow.nodes.at(-1).id };
    this.save(); this.redraw();
  },
  addNode() {
    const label = prompt(t("Texto do novo nó:"));
    if (!label) return;
    const maxY = Math.max(0, ...this.flow.nodes.map((n) => n.y + this.size(n).h));
    this.flow.nodes.push({ id: "N" + Date.now().toString(36), label, type: $("#fl-newtype").value, ref: "", x: 40, y: maxY + 30 });
    this.sel = { kind: "node", id: this.flow.nodes.at(-1).id };
    this.save(); this.redraw();
  },
  toggleConnect() { this.connectMode = !this.connectMode; this.connecting = null; $("#view").innerHTML = this.view(this.flow); this.mount(); },
  applyNode() {
    const n = this.flow.nodes.find((x) => x.id === this.sel.id);
    Object.assign(n, { label: $("#fl-label").value, type: $("#fl-type").value, ref: $("#fl-ref").value.trim().toUpperCase() });
    this.save(); this.redraw();
  },
  applyEdge() {
    const e = this.flow.edges.find((x) => x.id === this.sel.id);
    const typed = $("#fl-elabel").value.trim();
    // guarda o código original quando o texto é a tradução de um rótulo padrão
    const code = (S.db.settings.lists.flow_edge_labels || []).find((l) => t(l) === typed);
    e.label = code || typed;
    this.save(); this.redraw();
  },
  reverseEdge() { const e = this.flow.edges.find((x) => x.id === this.sel.id); [e.from, e.to] = [e.to, e.from]; this.save(); this.redraw(); },
  removeSel() {
    if (!this.sel) return;
    if (this.sel.kind === "node") {
      this.flow.nodes = this.flow.nodes.filter((n) => n.id !== this.sel.id);
      this.flow.edges = this.flow.edges.filter((e) => e.from !== this.sel.id && e.to !== this.sel.id);
    } else this.flow.edges = this.flow.edges.filter((e) => e.id !== this.sel.id);
    this.sel = null; this.save(); this.redraw();
  },
  relayout() { Core.layoutFlow(this.flow.nodes, this.flow.edges); this.save(); this.redraw(); },
  openRef(ref) {
    const view = { PROJ: "projetos", RISK: "riscos", GOV: "lista", MEET: "reunioes", INP: "entradas" }[ref.replace(/\d+$/, "")];
    if (view) location.hash = `${view}/${ref}`;
  },
  save() {
    clearTimeout(this._saveTimer);
    const f = this.flow;
    this._saveTimer = setTimeout(() => api(`flows/${f.id}`, "PATCH", { nodes: f.nodes, edges: f.edges, _silent: true }).catch((e) => toast(e.message)), 400);
  },
  async generate(mode) {
    if (this.flow.nodes?.length && !confirm(t("Substituir o fluxo atual pelo novo gerado?"))) return;
    clearTimeout(this._saveTimer);
    const desc = $("#fl-desc") ? $("#fl-desc").value : this.flow.description;
    const r = await api(`flows/${this.flow.id}/generate`, "POST", { mode, description: desc });
    S.db.flows = S.db.flows.map((f) => (f.id === r.id ? r : f));
    this.flow = r; this.sel = null;
    $("#view").innerHTML = this.view(r); this.mount();
    if (r.engine === "heuristica" && mode === "ai") toast(t("IA offline: fluxo montado pelos vínculos registrados."));
  },
  async saveGuide() {
    await api("settings", "PATCH", { flow_guidelines: $("#fl-guide").value });
    S.db.settings.flow_guidelines = $("#fl-guide").value;
    toast(t("Regras salvas"));
  },
  async learn() {
    clearTimeout(this._saveTimer);
    await api(`flows/${this.flow.id}`, "PATCH", { nodes: this.flow.nodes, edges: this.flow.edges, description: $("#fl-desc").value, _silent: true });
    await api(`flows/${this.flow.id}/learn`, "POST");
    await refresh();
    toast(t("Exemplo salvo: a IA vai usar este fluxo como referência."));
  },
  exportSvg() {
    const blob = new Blob([$("#fl-svg").outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    download(url, `${this.flow.id}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};

/** Abre (ou cria e gera pelos dados) o fluxo de um projeto/risco. */
async function openFlowFor(col, id) {
  let f = S.db.flows.find((x) => x.scope_col === col && x.scope_id === id);
  if (!f) {
    const rec = byId(col, id);
    f = await api("flows", "POST", { title: `${t("Fluxo")} — ${rec.name || rec.title}`, scope_col: col, scope_id: id, nodes: [], edges: [], description: "" });
    await api(`flows/${f.id}/generate`, "POST", { mode: "data" });
    await refresh();
  }
  location.hash = "fluxos/" + f.id;
}
