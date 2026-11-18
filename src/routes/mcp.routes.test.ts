import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Response } from 'express';

const mocks = vi.hoisted(() => ({
  servers: [] as Array<{ connect: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  opened: undefined as undefined | ((res: Response) => void),
}));

vi.mock('../mcp/create-mcp-server.js', () => ({
  createMcpServer: () => {
    const server = { connect: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    mocks.servers.push(server);
    return server;
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    sessionId?: string;
    onclose?: () => void;
    private streams: Response[] = [];
    constructor(private options: {
      sessionIdGenerator: () => string;
      onsessioninitialized: (id: string) => void;
      onsessionclosed: (id: string) => Promise<void>;
    }) {}
    async close() {
      for (const res of this.streams) res.end();
      this.onclose?.();
    }
    async handleRequest(req: express.Request, res: Response) {
      if (req.body?.method === 'initialize') {
        this.sessionId = this.options.sessionIdGenerator();
        this.options.onsessioninitialized(this.sessionId);
        res.setHeader('mcp-session-id', this.sessionId);
      }
      if (req.method === 'DELETE') await this.options.onsessionclosed(this.sessionId!);
      if (req.method === 'GET' || req.body?.method === 'long-operation') {
        this.streams.push(res);
        mocks.opened?.(res);
        return; // O transporte pode retornar antes de terminar a resposta SSE.
      }
      res.status(this.sessionId ? 200 : 400).json({ ok: !!this.sessionId });
    }
  },
}));

import router, { shutdownMcpSessions } from './mcp.routes.js';

const app = express().use(express.json()).use('/mcp', router);
const IDLE_MS = 30 * 60_000;
const initialize = async () => {
  const res = await request(app).post('/mcp').send({ method: 'initialize' }).expect(200);
  return res.headers['mcp-session-id'] as string;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  mocks.servers.length = 0;
});

afterEach(async () => {
  mocks.opened = undefined;
  await shutdownMcpSessions();
  vi.useRealTimers();
});

describe('sessões MCP inativas', () => {
  it('expira após 30 minutos, fecha os recursos e permite uma nova sessão', async () => {
    const id = await initialize();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(mocks.servers[0].close).toHaveBeenCalledOnce();
    await request(app).post('/mcp').set('mcp-session-id', id).send({ method: 'ping' }).expect(404);
    expect(await initialize()).not.toBe(id);
  });

  it('renova o prazo quando o cliente envia outra solicitação', async () => {
    const id = await initialize();
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    await request(app).post('/mcp').set('mcp-session-id', id).send({ method: 'ping' }).expect(200);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(mocks.servers[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.servers[0].close).toHaveBeenCalledOnce();
  });

  it('aguarda uma resposta POST em andamento antes de contar a inatividade', async () => {
    const id = await initialize();
    const opened = new Promise<Response>((resolve) => { mocks.opened = resolve; });
    const pending = request(app).post('/mcp').set('mcp-session-id', id)
      .send({ method: 'long-operation' }).then((res) => res);
    const res = await opened;
    await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
    expect(mocks.servers[0].close).not.toHaveBeenCalled();
    res.json({ ok: true });
    await pending;
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(mocks.servers[0].close).toHaveBeenCalledOnce();
  });

  it('um canal GET aberto e sem atividade não mantém a sessão para sempre', async () => {
    const id = await initialize();
    const opened = new Promise<Response>((resolve) => { mocks.opened = resolve; });
    const pending = request(app).get('/mcp').set('mcp-session-id', id).then((res) => res);
    await opened;
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(mocks.servers[0].close).toHaveBeenCalledOnce();
    await pending;
  });

  it('encerramento explícito cancela a limpeza pendente', async () => {
    const id = await initialize();
    await request(app).delete('/mcp').set('mcp-session-id', id).expect(200);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(mocks.servers[0].close).toHaveBeenCalledOnce();
  });

  it('shutdown cancela os timers e fecha cada sessão uma vez', async () => {
    await initialize();
    await initialize();
    await shutdownMcpSessions();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    for (const server of mocks.servers) expect(server.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fecha o servidor criado para uma solicitação que não inicializa sessão', async () => {
    await request(app).post('/mcp').send({ method: 'invalid' }).expect(400);
    expect(mocks.servers[0].close).toHaveBeenCalledOnce();
  });
});
