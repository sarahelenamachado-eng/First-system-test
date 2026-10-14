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

**Idiomas:** português, inglês e chinês simplificado — escolha no seletor no canto superior direito.
A interface, os alertas, o histórico, os summaries e as respostas da IA seguem o idioma escolhido.
O que você digita (títulos, descrições, atas) fica como foi escrito.

**Tradução automática do conteúdo (com a IA ligada):** o que você escreve (entradas, itens, projetos, riscos,
reuniões, atas, notas) é traduzido ao salvar para português, inglês e chinês — escreva em qualquer um deles.
Com a tela em inglês ou chinês, o conteúdo aparece traduzido. O botão **🌐 Traduções** de cada registro mostra as três
versões e copia no formato bilíngue (cada frase em inglês seguida da mesma frase em chinês). Glossário e opções em
Configurações → Módulos e idioma.

**Onde ficam as coisas**
- Tudo (base `db.json`, pastas de projetos, riscos, reuniões e summaries) fica **na pasta que você escolheu**.
  Pode ser uma pasta do OneDrive/SharePoint sincronizada, para ter backup.
- A chave da IA fica guardada **só no navegador** deste computador (não vai para a pasta).
- A IA precisa de internet com acesso a `api.anthropic.com`; o resto funciona offline.

## Módulos

### 1. Entradas (Inputs management)
Fluxo em 3 etapas para cada entrada vinda da **Diretora, Reunião, Departamento ou HQ**: entrada da informação →
assessment (relação com itens já levantados + classificação de escopo, prioridade, urgência, impactos e gaps) →
definição (risco a monitorar/investigar, info a reportar, novo projeto, ação dentro de um projeto, ação geral).
A IA sugere, você confirma ou corrige, e a decisão fica guardada para a IA aprender.

### 2. Lista geral de governança
Filtros (status, prioridade, origem, definição, prazo), busca, paginação (concluídos ocultos por padrão), coluna
"Último progresso" e download em planilha (CSV). Em cada item: **Ações do item** (responsável, prazo, status e
progresso) e **Progresso e histórico geral**.
- **Por departamento:** aba com um quadro por departamento (GA, BS…): clique e veja os itens daquele departamento.
  O departamento é a "Área principal" do item; itens sem departamento ficam em **Geral**. A lista geral continua igual.
- **Prazos:** itens vencidos ficam em vermelho com os dias de atraso; os que vencem em breve, em amarelo.
- **Duplicidade:** ao registrar uma entrada com o mesmo título de um item existente, a plataforma avisa e sugere
  incluir no item existente. Duplicados já criados podem ser juntados com **Mesclar**.

### Dashboards (Projetos, Reuniões e Riscos)
Cada módulo abre com um dashboard: frase-resumo, indicadores e gráficos, e o botão **Analisar com IA**, que
interpreta os números e sugere a ação.
- **Projetos:** "de XX projetos ativos, XX têm itens atrasados e XX representam risco em relação ao atraso";
  situação (no prazo / atrasados / risco de atraso), atrasos por tipo, distribuição da conclusão e projetos que exigem atenção.
  *Risco de atraso* = projeto "Em risco", ou com itens atrasados somados a risco aberto ligado ou ≥ 30% dos itens com prazo atrasados.
- **Reuniões (hoje / semana / mês):** realizadas, de nível gerencial, de reporte, pré-agendadas e urgentes;
  reuniões gerenciais realizadas × não realizadas; por nível e tipo; cumprimento das obrigatórias.
- **Riscos:** abertos, críticos, em investigação/monitoramento, matriz probabilidade × impacto, impactos principais.

### 3. Projetos
Abas de cada projeto:
- **Visão geral** — dados, objetivo, status, *projeto principal* (★) e reuniões do projeto.
- **Itens do projeto** — itens com objetivo e descrição do progresso. Ao marcar como *Finalizado*, o projeto mostra
  automaticamente "concluído em XX%" (itens finalizados ÷ total).
- **Atividades (planilha)** — importe a planilha no layout `Scope | Target | Item | nº | Subitem | Last Progress`
  (células mescladas são entendidas). Cada linha vira uma atividade onde você registra % e novas atualizações.
  As colunas são reconhecidas sozinhas e podem ser ajustadas; reimportar mantém o progresso já registrado.
- **Itens adicionais do projeto** — entradas classificadas como "Ação dentro de um projeto" entram aqui automaticamente.
- **Impactos e riscos** — o que acontece *se o projeto for realizado* e *se não for*.
- **Arquivos / master schedule** — arquivos na pasta local do projeto, com organização pela IA.
- **Fluxo** — mapa visual do projeto.

### 4. Reuniões
Abas: Dashboard · **Calendário** (clique num dia para inserir; sugestões da IA tracejadas) · **Obrigatórias** ·
**Solicitadas** (pedidas por alguém: agendar, realizada, não realizada, cancelar) · Confirmar e registrar ata · Todas.
- **Reuniões obrigatórias:** cadastre frequência, dias e horário preferidos, duração e nível. A IA sugere as datas e
  horários do mês que faltam, seguindo as **regras e observações** que você escrever (ex.: "diretora só à tarde").
- Cada reunião tem **nível** (Gerencial, Diretoria…), **tipo** (Reporte, Decisão…), **agendamento** (Pré-agendada / Urgente),
  **duração** e **participantes** cadastrados.
- **Tempo em reuniões:** cadastre as pessoas (Diretor, Sr Manager, Gerente…) e veja as horas gastas em reuniões realizadas
  por pessoa, por cargo e por tipo, na semana, no mês ou num período — com o botão **Só o diretor**.
- Projetos principais geram sozinhos a **necessidade de reunião de acompanhamento** (cadência configurável).
- **Solicitar reunião** — registre reuniões pedidas por alguém.
- Em **Aguardando confirmação**, marque *Foi realizada* ou *Não foi realizada* (com nova data para projetos).
- Atas e anotações, com extração de decisões e demandas que vão para as Entradas.

### Ensinar a IA a avaliar riscos
Nos itens da lista geral, na avaliação das entradas e nos riscos há o campo **Minha análise de risco (ensinar a IA)**:
nível, fatores e o seu raciocínio. A IA usa essas análises (e os critérios gerais em Configurações → IA) nas próximas
avaliações de casos parecidos.

### 5. Riscos
Abas: visão geral (com seleção dos **principais impactos** do risco), **inputs do risco** (com opção de enviar ao
Inputs management), **impactos e riscos** (*se o risco se concretizar* / *se for tratado*), documentos com análise da IA e fluxo.

### 6. Fluxos
Para cada projeto e risco (ou geral), um mapa que conecta causas, itens, projetos, riscos e impactos.
Gere pelos dados registrados ou com a IA a partir da sua descrição, arraste, edite, conecte e exporte (SVG).
Para **ensinar a IA**: escreva regras de como montar os fluxos e salve fluxos bons como exemplo.

### 7. Summaries diário e semanal
Destaques, indicadores, demandas por origem, itens críticos, prazos, projetos (% concluído), riscos,
reuniões e decisões, infos a reportar, alertas e linha do tempo. Também salvos em HTML na pasta `SUMMARIES`.

### 8. Configurações
Aparência (nome, cor, tamanho do texto, densidade, faixa vermelha, logo), módulos visíveis, idioma, listas
(origens, tipos de entrada, categorias de impacto, áreas, rótulos dos fluxos), regras de alertas e reuniões,
IA e aprendizado, pasta de trabalho e backup/restauração.

### Alertas automáticos
Projeto sem atualização há X dias, reunião a confirmar, item ligado a 3+ itens sem projeto, tema recorrente,
prazos vencidos, riscos parados e entradas aguardando classificação.

## Estrutura

```
index.html        # abra este arquivo (gerado: contém todo o CSS/JS embutido, funciona sozinho)
src/              # código-fonte — edite aqui e rode `node tools/build.mjs` para gerar o index.html
  index.html
  i18n.js         # traduções (pt / en / zh)
  brand.js        # logo padrão
  flow.js         # editor visual de fluxos
  dash.js         # dashboards, calendário, reuniões obrigatórias e "ensinar a IA" (risco)
  store.js        # acesso à pasta escolhida (File System Access API) e configurações do navegador
  xlsx.js         # leitura de .xlsx/.csv sem bibliotecas externas
  ai.js           # integração com Claude + heurísticas offline + aprendizado por feedback
  core.js         # base de dados e regras de governança (fluxo, alertas, summaries, exportação)
  ui.js           # interface
  style.css
tools/build.mjs   # junta src/ em um único index.html
```

Na pasta de trabalho escolhida são criados: `db.json`, `PROJECTS/`, `RISKS/`, `MEETINGS/`, `SUMMARIES/`.

## Próximos passos sugeridos
- Ajustar o layout do summary ao modelo que você enviar.
- Definir a regra "classificação × definição" (ainda em aberto na planilha) — hoje a IA sugere e o usuário decide.
- Módulo de gestão pessoal (aba *Personnal Management* está vazia).
