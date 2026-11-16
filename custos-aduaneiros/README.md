# Custos Aduaneiros — monitoramento, breakdown e controle de pagamentos

Sistema para acompanhar os custos de terminal do desembaraço (**KPI 1 · Storage**, **KPI 2 · Demurrage**, **KPI 3 · Customs costs**),
com os demonstrativos da Santos Brasil, o controle do canal vermelho e o histórico COMEX. Interface em **português, inglês, chinês ou 中文 + English** (chinês e inglês juntos, um abaixo do outro)
(seletor no menu lateral).

## Como usar
1. Baixe `custos-aduaneiros/index.html` e abra no Edge ou Chrome (funciona offline, sem instalar nada).
2. **Importar** → arraste os arquivos (vários de uma vez; o tipo é reconhecido sozinho):
   - `IRAxxxx-xx_Cost_Breakdown.xlsx` (demonstrativos da Santos Brasil);
   - planilha **Red Channel Status**;
   - planilha **COMEX expenses analysis** (histórico de muitos processos + pagamentos feitos pelo sistema).
3. Para ver funcionando sem importar: **Ver com os processos de exemplo** (5 processos críticos + histórico COMEX).
4. Cada arquivo importado aparece em **Importar → Arquivos importados** e pode ser **excluído**: o sistema desfaz o que ele trouxe.

## Páginas (menu vertical)
- **Painel** — resumo, KPIs (estadia sem custo extra ≤ 15 dias, custo regular por contêiner × meta, extras KPI 1 / KPI 3), gráficos e pontos de atenção.
- **Processos** e página de cada processo — breakdown, contêiner a contêiner, conferência com o tarifário, desembaraço, dados COMEX, **pagamento e controle**.
- **Custos extras** — por tipo, por processo (com motivo) e por contêiner.
- **Canal vermelho** — a planilha Red Channel ligada aos processos da Santos Brasil pelo número IRA (**sem duplicar**), com resumo em PT / EN / 中文.
- **Estrutura de custos** — fluxo das 9 etapas da importação: custo gerado em cada etapa, quem cobra, como é pago, KPI, anormalidades que aumentam o custo, breakdown e **como confirmar se a cobrança está correta**.
- **Pagamentos e controle** — fluxo do pagamento por responsável (fornecedor, Comex, diretoria, ICG, banco), o **risco do ICG** (pagamento sem aprovação de diretor) e a **contramedida** (e-mail de aprovação aos diretores, gerado pelo sistema), riscos, evidências, aprovação de cada processo e procedimento passo a passo.
- **Histórico COMEX** — processos anteriores por canal e por mês, dias até desembaraço × até retirada, armazenagem por contêiner × meta.
- **Configurações** — regras de classificação, tarifário, KPIs, pasta de trabalho, backup.

## Regras principais
| Serviço no demonstrativo | Grupo |
|---|---|
| Armazenagem — 1º período (15 dias) | Regular |
| Armazenagem — dias adicionais | Extra · armazenagem (KPI 1) |
| Escaneamento, carregamento, processamento eletrônico | Regular |
| Posicionamento, lacres, desova/ova, exames, movimentações | Extra · desembaraço (KPI 3) |

- Cada cobrança é conferida com o **tarifário** Santos Brasil (editável em Config.) e com os totais do terminal.
- **Canal verde com posicionamento/lacres** gera alerta "MAPA?": o tarifário prevê esses serviços só para MAPA ou canal diferente de verde.
- Canal e situação: planilha Red Channel > planilha COMEX.
- Nomes de pessoas e de fornecedores das planilhas de pagamento não são guardados.

## Código
`src/` — i18n.js + dict.js (idiomas), book.js (leitura .xlsx), parse.js (leitura, classificação, tarifário, COMEX), flows.js (estrutura de custos e de pagamentos),
data.js (base, importações), app.js (telas), seed.js (exemplos). Depois de editar, gere o arquivo único com `node tools/build-custos.mjs`.
