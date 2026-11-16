# Custos Aduaneiros — monitoramento e breakdown

Sistema para acompanhar os custos de terminal do desembaraço (foco em **KPI 1 · Storage** e **KPI 3 · Customs costs**),
a partir dos demonstrativos da Santos Brasil e do controle manual do canal vermelho.

## Como usar
1. Abra **`custos-aduaneiros/index.html`** no Edge ou Chrome (funciona offline, sem instalar nada).
2. **Importar** → arraste os arquivos `IRAxxxx-xx_Cost_Breakdown.xlsx` (vários de uma vez) e/ou a planilha **Red Channel Status**.
   O tipo de cada planilha é reconhecido sozinho. Confira a prévia e clique em **Salvar**.
3. Para ver funcionando sem importar nada: **Ver com os 5 processos de exemplo** (IRA1818, 2416, 2419, 2420, 2424).

## Telas
- **Painel**: resumo em texto, totais (processos, contêineres, custo total, regular × extra, extra de armazenagem × extra de desembaraço,
  contêineres além do período livre, inspeção física, canal vermelho em aberto), custo por processo, custos extras por tipo,
  estadia no terminal e processos que exigem atenção. Filtros por busca, canal e mês de entrada. Tudo é clicável.
- **Processo** (clique em qualquer processo): dados do BL/DUIMP/navio, conferência com o total do terminal, composição do custo,
  breakdown dos extras e dos regulares, contêiner a contêiner (clique para ver cada serviço cobrado e a observação do terminal),
  linha do tempo do desembaraço, motivo da estadia/custos extras e anotações.
- **Custos extras**: por tipo de custo, por processo (com o motivo registrado) e por contêiner.
- **Canal vermelho**: a tabela da planilha Red Channel dentro do sistema, editável, com o resumo pronto em PT / EN / 中文.
- **Config.**: regras de classificação, período livre, pasta de trabalho (OneDrive/SharePoint), backup e exportação CSV.

## Como os custos são classificados
| Serviço no demonstrativo | Grupo |
|---|---|
| Armazenagem — 1º período (15 dias) | Regular |
| Armazenagem — períodos adicionais | **Extra · armazenagem (KPI 1)** |
| Inspeção não invasiva (escaneamento), carregamento, processamento eletrônico | Regular |
| Posicionamento, colocação/retirada de lacre, desova/ova, exames, movimentações | **Extra · desembaraço (KPI 3)** |
| Serviço novo sem regra | Extra · desembaraço, com aviso para revisar |

É a mesma lógica da planilha de breakdown manual. As regras ficam em Config. e, ao mudar uma regra, todos os processos são recalculados.
Cada importação confere a soma dos serviços com o "Valor Total do Contêiner" e o "Total Geral" do terminal.

## Dados
Salvos automaticamente no navegador. Com uma **pasta de trabalho** (Config.), a base vai para `custos-aduaneiros.json`
e as planilhas originais são arquivadas em `SANTOS_BRASIL/` e `RED_CHANNEL/`.

## Código
`src/` (book.js = leitura de .xlsx, parse.js = leitura e classificação, data.js = base, app.js = telas, seed.js = exemplos).
Depois de editar, gere o arquivo único com `node tools/build-custos.mjs`.
