# Plataforma de Governança IA + HTML

Plataforma local (navegador + pasta no computador) que implementa a lógica de governança da planilha
*Systems flows*: **Inputs management → Lista geral de governança → Projetos, Reuniões e Riscos → Summaries**.

## Como usar (sem instalar nada)

1. Baixe o repositório (botão **Code → Download ZIP** no GitHub) e descompacte numa pasta do computador.
2. Dê dois cliques em **`index.html`**. Ele abre no navegador — use **Microsoft Edge** ou **Google Chrome**
   (o Firefox não permite acessar pastas do computador).
3. Clique em **Escolher pasta de trabalho** e selecione (ou crie) a pasta onde ficarão os dados.
   O navegador pede permissão para "ver e editar arquivos" — confirme.
   Nas próximas vezes, basta clicar em **Continuar com a pasta …**.
4. (Opcional, recomendado) Em **Config.**, cole a chave da API da Anthropic para ativar a IA (Claude).

Sem chave da IA a plataforma funciona normalmente com sugestões heurísticas (palavras‑chave, similaridade
com o histórico e decisões anteriores). O selo no canto superior direito mostra se a IA está ativa.

**Onde ficam as coisas**
- Tudo (base `db.json`, pastas de projetos, riscos, reuniões e summaries) fica **na pasta que você escolheu**.
  Pode ser uma pasta do OneDrive/SharePoint sincronizada, para ter backup.
- A chave da IA fica guardada **só no navegador** deste computador (não vai para a pasta).
- A IA precisa de internet com acesso a `api.anthropic.com`; o resto funciona offline.

## Módulos

### 1. Inputs management (aba *Inputs management 2*)
Fluxo em 3 etapas para cada entrada vinda da **Diretora, Reunião, Departamento ou HQ**:

1. **Entrada da informação** — layout com background/contexto, de onde a demanda veio, reunião, área principal,
   áreas impactadas e áreas que impactam, responsável e prazo. Registrada como `INPxxx`.
2. **Assessment** — a IA verifica relação com itens já levantados:
   *relação direta* → inclui no item on going; *relação só em impacto* → cria item novo e vincula.
   Classificação: escopo (o que é / o que fazer), prioridade, urgência com justificativa do risco,
   impactos (Custo, Eficiência, Operação, Compliance, People) e gaps.
3. **Definição** (uma ou mais): risco a monitorar / investigar, info a ser reportada, criação de novo projeto,
   ação dentro de um projeto, ação geral.

O usuário confirma ou corrige a sugestão. A decisão final é guardada e usada como exemplo nas próximas sugestões
("a IA aprende com base nos critérios do usuário").

Ao confirmar, a demanda entra na **Lista geral de governança** (`GOVxxx`) e é ligada aos módulos:
- Risco → cria `RISKxxx` e a pasta `RISKS/RISK001 INFOS AND GENERAL OVERVIEW`
- Novo projeto → cria `PROJxxx` e a pasta `PROJECTS/PROJ001 INFOS AND GENERAL OVERVIEW`
- Ação dentro de projeto → entra no portfólio de ações do projeto, com o gap (por que não foi prevista antes)

### 2. Lista geral
Filtros, histórico de atualizações, vínculos entre itens/projetos/riscos/reuniões e download em planilha
(CSV, abre no Excel) com responsáveis, data emitida e classificação.

### 3. Projetos
As **master schedules ficam na pasta local** `PROJECTS/<PROJ> INFOS AND GENERAL OVERVIEW/master_schedule`.
Copie os arquivos direto para a pasta e clique em *Sincronizar pasta*, ou faça upload pela tela.
*Organizar com IA* lê `.xlsx`, `.csv` ou `.pdf` e devolve visão geral, fases, atrasos, próximas entregas,
pontos críticos e ações sugeridas. Portfólio de ações com estrutura fixa.

### 4. Reuniões
Espaço para atas e anotações. A IA resume, registra decisões e extrai demandas, que podem ser enviadas
com um clique para o Inputs management (já vinculadas à reunião). Reuniões ligadas a um projeto reagendam
o próximo acompanhamento (cadência padrão de 15 dias).

### 5. Riscos
Pasta por risco para documentos; *Compilar e analisar com IA* lê os documentos e sugere probabilidade,
impacto, causas, consequências, mitigações e pontos de reporte (para o usuário confirmar).

### 6. Summaries diário e semanal
Layout sugerido (ajustável quando você enviar o seu):
1. Destaques (texto da IA) · 2. Indicadores · 3. Novas demandas por origem · 4. Itens críticos ·
5. Prazos vencidos e próximos 7 dias · 6. Projetos · 7. Riscos · 8. Reuniões e decisões ·
9. Infos a reportar · 10. Alertas · 11. Linha do tempo.
Cada summary é salvo também como HTML na pasta `SUMMARIES` (pode ser impresso em PDF).

### Alertas automáticos
- Projeto com mais de *XX* dias sem monitoramento/atualização (configurável, padrão 15)
- Reunião de acompanhamento de projeto vencida
- Item interligado a 3+ itens sem projeto → sugerir projeto com overview maior
- Tema recorrente (3+ entradas no mesmo item), prazos vencidos, riscos parados, entradas aguardando classificação

## Estrutura

```
index.html        # abra este arquivo
app/
  store.js        # acesso à pasta escolhida (File System Access API) e configurações do navegador
  xlsx.js         # leitura de .xlsx/.csv sem bibliotecas externas
  ai.js           # integração com Claude + heurísticas offline + aprendizado por feedback
  core.js         # base de dados e regras de governança (fluxo, alertas, summaries, exportação)
  ui.js           # interface
  style.css
```

Na pasta de trabalho escolhida são criados: `db.json`, `PROJECTS/`, `RISKS/`, `MEETINGS/`, `SUMMARIES/`.

## Próximos passos sugeridos
- Ajustar o layout do summary ao modelo que você enviar.
- Definir a regra "classificação × definição" (ainda em aberto na planilha) — hoje a IA sugere e o usuário decide.
- Módulo de gestão pessoal (aba *Personnal Management* está vazia).
