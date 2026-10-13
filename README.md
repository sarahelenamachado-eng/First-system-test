# Plataforma de Governança IA + HTML

Plataforma local (navegador + pasta no computador) que implementa a lógica de governança da planilha
*Systems flows*: **Inputs management → Lista geral de governança → Projetos, Reuniões e Riscos → Summaries**.

## Como rodar

1. Instale o Python 3.10+.
2. (Opcional, recomendado) `pip install -r requirements.txt` e configure a IA:
   - Windows (PowerShell): `$env:ANTHROPIC_API_KEY="sk-ant-..."`
   - macOS/Linux: `export ANTHROPIC_API_KEY=sk-ant-...`
3. Execute `iniciar.bat` (Windows) ou `./iniciar.sh` (macOS/Linux) e abra http://localhost:8765

Sem chave da IA a plataforma funciona normalmente com sugestões heurísticas (palavras‑chave, similaridade
com o histórico e decisões anteriores). O selo no canto superior direito mostra se a IA está ativa.

### Variáveis opcionais

| Variável | Padrão | Uso |
|---|---|---|
| `GOV_WORKSPACE` | `./workspace` | Pasta local onde ficam a base de dados e as pastas de projetos/riscos (pode ser uma pasta do OneDrive/SharePoint sincronizada) |
| `GOV_MODEL` | `claude-opus-5-5` | Modelo Claude |
| `GOV_PORT` / `GOV_HOST` | `8765` / `127.0.0.1` | Endereço do servidor |
| `GOV_AI` | `on` | `off` desliga a IA |

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
governance/
  server.py     # servidor HTTP local + regras de governança (fluxo, alertas, summaries, exportação)
  ai.py         # integração com Claude + heurísticas offline + aprendizado por feedback
  storage.py    # base JSON e pastas locais
  static/       # interface HTML/CSS/JS
workspace/      # (gerado) db.json, PROJECTS/, RISKS/, MEETINGS/, SUMMARIES/
```

## Próximos passos sugeridos
- Ajustar o layout do summary ao modelo que você enviar.
- Definir a regra "classificação × definição" (ainda em aberto na planilha) — hoje a IA sugere e o usuário decide.
- Módulo de gestão pessoal (aba *Personnal Management* está vazia).
