import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from './create-mcp-server.js';
import { listarClientes } from '../services/clientes.service.js';

vi.mock('../services/clientes.service.js');

const servers: ReturnType<typeof createMcpServer>[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all([...clients, ...servers].map((item) => item.close()));
  clients.length = servers.length = 0;
  vi.clearAllMocks();
});

it('recusa coleções excessivas antes de validar ou executar a ferramenta', async () => {
  vi.mocked(listarClientes).mockResolvedValue({ ok: true, data: [] });
  const server = createMcpServer();
  const client = new Client({ name: 'security-test', version: '1.0' });
  servers.push(server);
  clients.push(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const excessive = await client.callTool({ name: 'listar_clientes', arguments: { etiquetasIds: Array(10_001).fill(1) } });
  expect(excessive.isError).toBe(true);
  expect(listarClientes).not.toHaveBeenCalled();

  const normal = await client.callTool({ name: 'listar_clientes', arguments: { etiquetasIds: Array(200).fill(1) } });
  expect(normal.isError).not.toBe(true);
  expect(listarClientes).toHaveBeenCalledOnce();
});
