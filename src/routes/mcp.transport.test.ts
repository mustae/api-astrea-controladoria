import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Transporte real, servidor sem ferramentas do Astrea: nenhum acesso externo.
vi.mock('../mcp/create-mcp-server.js', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  return { createMcpServer: () => new McpServer({ name: 'test', version: '1.0.0' }) };
});

import router, { shutdownMcpSessions } from './mcp.routes.js';

afterEach(async () => {
  await shutdownMcpSessions();
  vi.useRealTimers();
});

it('o transporte real responde, expira e aceita reinicialização', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const app = express().use(express.json()).use('/mcp', router);
  const headers = { Accept: 'application/json, text/event-stream' };
  const init = () => request(app).post('/mcp').set(headers).send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
  }).expect(200);

  const first = await init();
  const id = first.headers['mcp-session-id'];
  expect(id).toBeTypeOf('string');
  await request(app).post('/mcp').set(headers).set('mcp-session-id', id)
    .send({ jsonrpc: '2.0', id: 2, method: 'ping' }).expect(200);
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  await request(app).post('/mcp').set(headers).set('mcp-session-id', id)
    .send({ jsonrpc: '2.0', id: 3, method: 'ping' }).expect(404);
  const second = await init();
  expect(second.headers['mcp-session-id']).not.toBe(id);
  await request(app).delete('/mcp').set(headers)
    .set('mcp-session-id', second.headers['mcp-session-id']).expect(200);
  await request(app).post('/mcp').set(headers).set('mcp-session-id', second.headers['mcp-session-id'])
    .send({ jsonrpc: '2.0', id: 4, method: 'ping' }).expect(404);
});
