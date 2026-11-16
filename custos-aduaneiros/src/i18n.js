/* Idiomas: português (pt), inglês (en), chinês simplificado (zh) e bilíngue (bi = 中文 + English).
 * t("texto em português", {variáveis}) devolve a tradução do idioma escolhido (dicionário em dict.js).
 * No modo bilíngue cada texto vira um par marcado [zh|en]; depois de desenhar a tela, biRender() mostra
 * o chinês e, logo abaixo, o inglês (em atributos e listas de opção: "中文 / English"). */
let LANG = (() => { try { return localStorage.getItem("custos-lang") || "pt"; } catch { return "pt"; } })();
const LOCALE = { pt: "pt-BR", en: "en-US", zh: "zh-CN", bi: "en-US" };
const BI_S = "\uE000", BI_M = "\uE001", BI_E = "\uE002";
const BI_RE = /\uE000([^\uE000-\uE002]*)\uE001([^\uE000-\uE002]*)\uE002/g;

/** Escolhe um dos idiomas de um texto que pode ter pares bilíngues (ou junta os dois com sep). */
function biPick(s, which, sep) {
  if (typeof s !== "string" || !s.includes(BI_S)) return s;
  let prev;
  do { prev = s; s = s.replace(BI_RE, (_, zh, en) => (which === "zh" ? zh : which === "en" ? en : zh === en ? zh : zh + sep + en)); } while (s !== prev && s.includes(BI_S));
  return s;
}
const biFlat = (s, sep = " / ") => biPick(String(s ?? ""), "both", sep);

function tr(s, lang, vars) {
  let out = lang === "pt" ? s : (typeof DICT !== "undefined" && DICT[s] && DICT[s][lang]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => biPick(String(vars[k] ?? ""), lang === "zh" ? "zh" : "en"));
  return out;
}
function t(s, vars) {
  if (LANG !== "bi") return tr(s, LANG, vars);
  const zh = tr(s, "zh", vars), en = tr(s, "en", vars);
  if (zh === en) return zh;
  // textos com HTML (negrito) ficam em dois blocos; os demais viram par marcado
  if (/[<>]/.test(zh + en)) return `<span class="bi-zh">${zh}</span><span class="bi-en bi-block">${en}</span>`;
  return BI_S + zh + BI_M + en + BI_E;
}
/** Conteúdo com as três versões {pt, en, zh}. */
const tx = (o) => {
  if (!o || typeof o !== "object") return o ?? "";
  if (LANG === "bi") return o.zh === o.en ? o.zh : BI_S + (o.zh || o.pt) + BI_M + (o.en || o.pt) + BI_E;
  return o[LANG] || o.pt;
};

/** Mostra os pares bilíngues que acabaram de entrar na tela. */
function biRender(root) {
  if (!root) return;
  const doAttrs = (el) => {
    for (const a of [...(el.attributes || [])]) if (a.value.includes(BI_S)) el.setAttribute(a.name, biFlat(a.value, a.name === "data-tip" ? "<br>" : " / "));
  };
  if (root.nodeType === 3) return biText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  root.querySelectorAll("*").forEach(doAttrs);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list = [];
  while (w.nextNode()) if (w.currentNode.nodeValue.includes(BI_S)) list.push(w.currentNode);
  list.forEach(biText);
}
function biText(node) {
  const v = node.nodeValue;
  if (!v.includes(BI_S)) return;
  const p = node.parentNode;
  if (!p) return;
  if (["OPTION", "TEXTAREA", "TITLE", "SCRIPT", "STYLE"].includes(p.nodeName)) { node.nodeValue = biFlat(v); return; }
  const zh = biPick(v, "zh"), en = biPick(v, "en");
  if (zh === en) { node.nodeValue = zh; return; }
  const span = document.createElement("span"); span.className = "bi-en"; span.textContent = en.trim();
  let f = document.createDocumentFragment();
  f.append(zh, document.createElement("br"), span);
  // em containers flex os pedaços ficariam lado a lado: agrupa num bloco
  let disp = ""; try { disp = getComputedStyle(p).display; } catch { /* fora da tela */ }
  if (/flex|grid/.test(disp)) { const w = document.createElement("span"); w.className = "bi-pair"; w.append(f); f = w; }
  p.replaceChild(f, node);
}
new MutationObserver((muts) => {
  if (LANG !== "bi") return;
  for (const m of muts) {
    if (m.type === "attributes") { const val = m.target.getAttribute(m.attributeName); if (val && val.includes(BI_S)) m.target.setAttribute(m.attributeName, biFlat(val, m.attributeName === "data-tip" ? "<br>" : " / ")); }
    else m.addedNodes.forEach((n) => biRender(n));
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true });

function setLang(l) {
  LANG = l;
  try { localStorage.setItem("custos-lang", l); } catch { /* sem armazenamento */ }
  document.documentElement.lang = LOCALE[l];
  if (typeof renderShell === "function") renderShell();
  if (typeof route === "function") route();
}
