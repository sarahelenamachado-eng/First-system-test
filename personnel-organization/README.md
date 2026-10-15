# Personnel Organization (IA + HTML)

Plataforma pessoal para controlar as suas atividades, com a mesma lógica da plataforma de governança:
você escreve o dia em texto livre, **um ponto por linha**, e o assistente transforma cada linha em um registro organizado.
No fim do dia, ela monta o **sumário diário**: o que fiz, quantas tarefas faltaram, o que aprendi e onde errei.

A plataforma de governança (raiz do repositório) não foi alterada; esta fica só na pasta `personnel-organization/`.

## Como usar (sem instalar nada)

1. Baixe o zip, descompacte e dê dois cliques em **`personnel-organization/index.html`**.
2. Escolha onde guardar os dados:
   - **Escolher pasta de trabalho** (Edge ou Chrome): cria um `db.json` na pasta e salva os sumários em `SUMARIOS/`.
     Pode ser uma pasta do OneDrive/Google Drive, para ter backup.
   - **Usar só neste navegador**: funciona em qualquer navegador, mas os dados ficam só ali (faça backup em Config.).
3. (Opcional) Em **Config.**, cole a chave da API da Anthropic para ativar a IA (Claude). Sem chave, tudo funciona no modo heurístico.

## Abas

### Painel — registro rápido do dia
Escreva livremente, por exemplo:

```
Fui à academia
Terminei o relatório do estágio
Não fiz a lista de exercícios
Preciso pagar o boleto amanhã
Aprendi que revisar de manhã rende mais
Errei ao deixar tudo para a noite — da próxima vez começar cedo
```

O assistente propõe, para cada linha: **✅ Fiz**, **⏳ Não fiz (faltou)**, **📝 Nova tarefa**, **➡️ Avancei numa tarefa**,
**💡 Aprendi**, **⚠️ Errei** (com "da próxima vez…"), **🗒️ Anotação** ou **Ignorar**. Ele também liga a linha a uma tarefa
que já existe (ex.: "Terminei o relatório" conclui a tarefa *Relatório do estágio*), sugere a área e entende prazos
("amanhã", "sexta", "20/10"). Você confere, corrige e confirma. Atalhos: `[x]` = feito, `[ ]` = tarefa,
`aprendi:`, `errei:`, `nota:`.

Ao lado, **Para hoje** mostra as tarefas com prazo até hoje (marque a caixinha quando fizer) e o botão
**Passar o que faltou para amanhã** (a tarefa muda de prazo, mas continua contando como "faltou" no sumário de hoje).

### Tarefas (os seus itens pessoais)
Lista com área, prioridade, prazo e status (Pendente, Em andamento, Feita, Cancelada), filtro por área, busca,
atrasadas em vermelho, histórico e quantas vezes cada tarefa "faltou".

### Registros
Tudo o que foi registrado, dia a dia: fiz, avancei, aprendi, errei, anotações. Dá para filtrar por tipo e período.

### Sumário diário
- **Coisas que fiz**, **avanços**, **faltaram fazer** (das planejadas para o dia, incluindo as atrasadas), % do planejado concluído,
  total de tarefas em aberto, **o que aprendi**, **onde errei** (com o que fazer diferente) e anotações.
- **Como foi o dia** (1 a 5 estrelas) e a sua reflexão escrita.
- **🤖 Reflexão do assistente**: o que foi bem, onde melhorar e prioridades para amanhã (com IA; sem IA, um resumo automático).
- Gráfico dos últimos 7 dias (feitas × faltaram).
- **Salvar na pasta** (`SUMARIOS/AAAA-MM-DD.html`), **Baixar HTML**, **Copiar como texto** ou **Imprimir / PDF**.

### Config.
Chave e modelo da IA, **regras para o assistente** (ex.: "academia é sempre Saúde"), áreas da sua vida,
taxa de acerto do assistente, opção de deixar ele registrar sozinho quando acertar 90%+, backup e restauração.

## Como o assistente aprende
Cada proposta que você confirma ou corrige vira exemplo. Na próxima vez que escrever algo parecido, ele repete a sua
decisão (também sem IA, por semelhança de palavras). Com a IA ligada, os exemplos parecidos e as suas regras vão junto
para o Claude.

## Estrutura

```
personnel-organization/
  index.html        # abra este arquivo (gerado: tudo embutido, funciona sozinho)
  src/              # código-fonte — edite aqui e rode `node tools/build.mjs`
    store.js        # pasta do computador ou armazenamento do navegador
    core.js         # tarefas, registros, sumário diário
    ai.js           # Claude + heurísticas offline + aprendizado
    ui.js           # interface
    style.css
  tools/build.mjs   # junta src/ em um único index.html
  tests/            # testes automáticos
```

## Testes

```
node --test tests/*.test.mjs   # lógica: classificação, ligação com tarefas, sumário, aprendizado, modo IA (API simulada)
node tests/e2e.mjs             # navegador: modo heurístico, modo com IA (API simulada) e modo pasta
```

## Começa vazia
A Personnel Organization não importa nada da plataforma de governança: nem itens, nem histórico, nem configurações.
Cada uma guarda os dados no seu próprio lugar, então dá para usar as duas no mesmo computador sem misturar.
