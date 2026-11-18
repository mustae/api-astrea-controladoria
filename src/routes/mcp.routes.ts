import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../utils/logger.js';
import { createMcpServer } from '../mcp/create-mcp-server.js';

type McpSession = {
  server: ReturnType<typeof createMcpServer>;
  transport: StreamableHTTPServerTransport;
  pendingPosts: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>;
};

const MCP_SESSION_HEADER = 'mcp-session-id';
const MCP_IDLE_TIMEOUT_MS = 30 * 60_000;
const sessions = new Map<string, McpSession>();

function removeSession(session: McpSession): void {
  clearTimeout(session.idleTimer);
  if (session.transport.sessionId) sessions.delete(session.transport.sessionId);
}

function closeSession(session: McpSession): Promise<void> {
  if (session.closing) return session.closing;
  removeSession(session);
  session.closing = (async () => {
    await session.transport.close().catch((err) => {
      logger.warn({ err }, 'Falha ao encerrar transporte MCP HTTP');
    });
    await session.server.close().catch((err) => {
      logger.warn({ err }, 'Falha ao encerrar servidor MCP HTTP');
    });
  })();
  return session.closing;
}

function refreshIdleTimeout(session: McpSession): void {
  clearTimeout(session.idleTimer);
  const id = session.transport.sessionId;
  if (session.pendingPosts > 0 || !id || !sessions.has(id)) return;
  session.idleTimer = setTimeout(() => {
    logger.info({ sessionId: id }, 'Sessao MCP HTTP encerrada por inatividade');
    void closeSession(session);
  }, MCP_IDLE_TIMEOUT_MS);
  session.idleTimer.unref();
}

function getSessionId(req: Request): string | undefined {
  const header = req.headers[MCP_SESSION_HEADER];
  return typeof header === 'string' ? header : undefined;
}

async function createSession(): Promise<McpSession> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    maxRequestBodySize: 1_048_576,
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, session);
      refreshIdleTimeout(session);
      logger.info({ sessionId }, 'Sessao MCP HTTP inicializada');
    },
    onsessionclosed: async (sessionId) => {
      await closeSession(session);
      logger.info({ sessionId }, 'Sessao MCP HTTP encerrada');
    },
  });
  const session: McpSession = { server, transport, pendingPosts: 0 };

  transport.onclose = () => removeSession(session);

  transport.onerror = (err) => {
    logger.warn({ err, sessionId: transport.sessionId }, 'Erro no transporte MCP HTTP');
  };

  try {
    await server.connect(transport);
    return session;
  } catch (err) {
    await closeSession(session);
    throw err;
  }
}

async function resolveSession(req: Request): Promise<McpSession> {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    if (req.method !== 'POST') {
      throw new Error('Sessao MCP ausente ou invalida.');
    }
    return createSession();
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Sessao MCP nao encontrada.');
  }

  return session;
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  let session: McpSession | undefined;
  try {
    session = await resolveSession(req);
    if (req.method === 'POST') {
      const activeSession = session;
      activeSession.pendingPosts++;
      // O transporte pode retornar antes de terminar o POST; GET SSE ocioso não prende a sessão.
      res.once('close', () => {
        activeSession.pendingPosts--;
        refreshIdleTimeout(activeSession);
      });
    }
    refreshIdleTimeout(session);
    const parsedBody = req.method === 'POST' ? req.body : undefined;

    await session.transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    const sessionId = getSessionId(req);
    logger.warn({ err, sessionId, method: req.method }, 'Falha ao processar requisicao MCP HTTP');

    if (!res.headersSent) {
      res.status(sessionId ? 404 : 400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: sessionId ? 'Sessao MCP nao encontrada.' : 'Sessao MCP ausente ou invalida.',
        },
        id: null,
      });
    }
  } finally {
    if (session && !session.transport.sessionId) await closeSession(session);
  }
}

export async function shutdownMcpSessions(): Promise<void> {
  const activeSessions = Array.from(sessions.values());
  sessions.clear();

  await Promise.allSettled(activeSessions.map(closeSession));
}

const router = Router();

router.get('/', (req, res) => {
  void handleMcpRequest(req, res);
});

router.post('/', (req, res) => {
  void handleMcpRequest(req, res);
});

router.delete('/', (req, res) => {
  void handleMcpRequest(req, res);
});

export default router;
