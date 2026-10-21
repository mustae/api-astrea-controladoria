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
| `astrea_etiquetar_aplicar` / `remover` (lote) | `etiquetar_processos` | 🔎 discovery | ? |
| `astrea_processo_editar` | `editar_processo` (read-modify-write) | 🔎 discovery | ? (provável save do folder) |
| `astrea_encerrar` (lote) | `encerrar_processos` | 🔎 discovery | ? |
| `astrea_andamento_criar` | `criar_andamento` | 🔎 discovery | ? (`historical` manual) |
| `astrea_tarefa_excluir` | `excluir_tarefa` | 🔎 discovery | ? (mcp.ai pede `case_id`, o que sugere uma rota por caso, como `/tasks/case/{caseId}/...`) |
| `astrea_processos_novos_por_mes` | `processos_novos_por_mes` | 🔎 discovery | `queryDTO.createddate` (formato desconhecido) |
| Financeiro, modelos/documentos, conta | — | ⏸ fora da prioridade atual | — |

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
