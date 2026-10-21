# Paridade com o mcp.ai/astrea — roadmap

Decisão (21/10/2026): **implementar no próprio repo** as funcionalidades do
[mcp.ai/astrea](https://mcp.ai/astrea), usando a lista de tools e o contrato REST
deles como especificação de interface. **Não** usar o mcp.ai como gateway, por três motivos:

- **Sessão única do Astrea:** uma sessão por usuário. Com o mesmo login, o mcp.ai derrubaria a sessão da api (ver `.claude/napkin.md`).
- **Sigilo e LGPD:** dados de clientes passariam por um terceiro que não informa onde os armazena.
- **Código fechado:** o mcp.ai é fechado e sem opção self-hosted.

Prioridade definida: **Etiquetas** e **Processos/andamentos**.

## Status

| mcp.ai | Aqui | Status | Endpoint Astrea |
|---|---|---|---|
| `astrea_etiquetas` | `listar_etiquetas` · `GET /api/etiquetas` | ✅ feito | `GET /api/v2/tags/get-all-tags` |
| `astrea_processos_list` / `buscar` (filtro `tag_ids`, `contact_ids`) | `listar_processos` + `etiquetasIds`/`clienteIds` | ✅ feito, **validar ao vivo** o filtro `tagIds` | `POST /case/query` (`queryDTO.tagIds`, `contacts`) |
| `astrea_processos_count` | `contar_processos` · `GET /api/casos/processos/contagem` | ✅ feito | `POST /case-list/count` |
| `astrea_processos_por_cliente` | `processos_por_cliente` · `GET /api/casos/processos/por-cliente` | ✅ feito | `POST /case/query` paginado, agrupado localmente |
| `astrea_compromisso_excluir` | `excluir_evento_agenda` | ✅ feito (service já existia) | `DELETE /appointments/{id}` |
| `astrea_responsaveis` | `listar_usuarios` | ✅ já existia | — |
| `astrea_andamentos` | `listar_andamentos` | ✅ já existia | `POST /historical/query-history` |
| `astrea_etiquetar_aplicar` / `remover` (lote) | `etiquetar_processos` · `POST /api/casos/etiquetas` | ✅ feito | `GET /_ah/api/folders/v1/addTagToCase` / `removeTagFromCase` (síncrono, 1 por processo × etiqueta) |
| `astrea_processo_editar` | `editar_processo` · `PATCH /api/casos/:id` | ✅ feito (só processos judiciais) | `getCaseById` → `POST /_ah/api/folders/v1/saveLawsuit` |
| `astrea_encerrar` (lote) | `encerrar_processos` · `POST /api/casos/encerrar` + `reativar_processo` | ✅ feito | `POST /folder/inactivate` · `PUT /case/toggle-activate-inactivate-case` (TOGGLE — checa status antes) |
| `astrea_andamento_criar` | `criar_andamento` · `POST /api/casos/:id/andamentos` + `excluir_andamento` | ✅ feito | `POST /_ah/api/histories/v1/saveHistoricalByCase` · `DELETE /historical/{id}` |
| `astrea_tarefa_excluir` | `excluir_tarefa` · `DELETE /api/tarefas/:id` | ✅ feito | `getTaskWithComments` → `POST /_ah/api/workspace/v1/deleteTask` (vai para a lixeira; não precisa do processo) |
| `astrea_processos_novos_por_mes` | `processos_novos_por_mes` · `GET /api/casos/processos/novos-por-mes` | ✅ feito | `/case-list/count` por mês com `queryDTO.fromDate`/`toDate` (03:00Z = meia-noite BRT) e `createddate: null` |
| `astrea_tarefa_criar` (etiquetas) | `criar_tarefa` + `etiquetasIds` · `etiquetar_tarefa` · `POST /api/tarefas/:id/etiquetas` | ✅ feito (aplicar em tarefa existente: rota deduzida, validar) | `taskInfoDTO.tagIds` · `GET /_ah/api/workspace/v1/removeTagFromTask` / `addTagToTask` |
| `astrea_compromisso_criar` (etiquetas) | `criar_evento_agenda` + `etiquetasIds` | ✅ feito | appointment usa `tags: [objeto completo]` (não `tagIds`) |
| — (mcp.ai não tem) | `criar_prazo`, `buscar_prazo`, `editar_prazo`, `concluir_prazo`, `excluir_prazo` · `/api/casos/:id/prazos`, `/api/prazos/:id` | ✅ feito | `POST /deadlines/save` · `GET /deadlines/{id}` · `POST /deadlines/update-status` · `POST /deadlines/{id}/delete` |
| — (mcp.ai não tem) | `criar_audiencia`, `buscar_audiencia`, `editar_audiencia`, `excluir_audiencia` · `/api/casos/:id/audiencias`, `/api/audiencias/:id` | ✅ feito | `POST /hearings/save` · `GET /hearings/{id}` · `POST /hearings/{id}/delete` · conflito: `POST /calendar-pro/calendar-conflicts` |
| Financeiro, modelos/documentos, conta | — | ⏸ fora da prioridade atual | — |

## Discovery de 21/10/2026

Rodado com a conta de teste no processo "TESTE DISCOVERY - APAGAR" (11 etapas). Contratos documentados no topo de `src/services/processos-mutacoes.service.ts`.

- A UI usa `POST /api/v2/batch-action/enqueue` (`CASE_TAG_ADD` / `CASE_TAG_REMOVE`) para etiquetas em lote. Essa rota é assíncrona: devolve um `firebaseToken` e não dá o resultado de cada processo. Por isso a implementação usa a chamada síncrona por processo.
- `toggle-activate-inactivate-case` **alterna** o estado. Chamado num processo ativo, ele o encerra. Por isso `reativar_processo` lê o status antes.

**Validação ao vivo:** suba a API com a conta de teste (`npm run dev`) e rode `node scripts/validar-mutacoes.mjs <idDoProcessoDeTeste>`. O script desfaz o que fez em cada passo.

## Discovery — rodada 2 (21/10/2026)

Rodada sobre prazos, audiências e etiquetas em tarefa e compromisso. Contratos no topo de `src/services/prazos-audiencias.service.ts`.

- Prazo e audiência são entidades **próprias**, não tarefa ou compromisso com uma marcação. Têm endpoints REST próprios: `/deadlines/*` e `/hearings/*`.
- As etiquetas vão como `tagIds` (strings) em tarefa, prazo e audiência. No compromisso, vão como `tags` com o objeto completo da etiqueta.
- Cada etiqueta tem `restrictions`, que limita onde ela pode ser usada: CASES, TASKS, APPOINTMENTS, DEADLINE, HEARING, HISTORIES… Use `listar_etiquetas` com `uso` para filtrar.
- Na criação, os campos de kanban ficam de fora. Falta validar ao vivo se o Astrea aceita isso para prazo e audiência (`scripts/validar-mutacoes.mjs` cobre).

## Como destravar os itens 🔎

1. Crie no Astrea um processo **"TESTE DISCOVERY - APAGAR"**.
2. **Fora do expediente**, rode:
   `DISC_EMAIL=... DISC_PASS=... node scripts/discover-etiquetas-processos.mjs`.
   É preciso rodar fora do expediente porque o login derruba a sessão da produção.
3. Siga o roteiro no terminal: são 11 etapas, com ENTER entre elas.
4. O JSON sai em `scripts/discovery-output/`, que está no gitignore porque contém dados reais.
5. Com o JSON em mãos, implemente cada tool em TDD (Red → Green), no padrão de `agenda-eventos`. Para lote, use concorrência baixa (≤2), limite de itens por chamada e resposta por item `{ id, ok, erro? }`.

## Cuidados das operações em lote

- Exigir uma confirmação explícita nas tools MCP, por exemplo `confirmar: true`. Elas afetam muitos processos de uma vez.
- Limitar a 200 processos por chamada.
- Invalidar o cache de etiquetas e de processos depois de cada mutação.
