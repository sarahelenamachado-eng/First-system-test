/* Idiomas: português (pt), inglês (en) e chinês simplificado (zh).
 * t("texto em português", {variáveis}) devolve a tradução do idioma escolhido (dicionário em dict.js). */
let LANG = (() => { try { return localStorage.getItem("custos-lang") || "pt"; } catch { return "pt"; } })();
const LOCALE = { pt: "pt-BR", en: "en-US", zh: "zh-CN" };

function t(s, vars) {
  let out = LANG === "pt" ? s : (typeof DICT !== "undefined" && DICT[s] && DICT[s][LANG]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  return out;
}
/** Conteúdo com as três versões {pt, en, zh}. */
const tx = (o) => (o && typeof o === "object" ? o[LANG] || o.pt : o ?? "");

function setLang(l) {
  LANG = l;
  try { localStorage.setItem("custos-lang", l); } catch { /* sem armazenamento */ }
  document.documentElement.lang = LOCALE[l];
  if (typeof renderShell === "function") renderShell();
  if (typeof route === "function") route();
}
