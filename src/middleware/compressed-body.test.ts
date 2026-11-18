import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

// Processo isolado: a versão vulnerável pode encerrar o Node com erro de descompressão.
it.each(['gzip', 'deflate'])('requisição %s malformada não derruba o processamento de requisições', async (encoding) => {
  const script = `
    const express = require('express');
    const http = require('node:http');
    const zlib = require('node:zlib');
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.post('/', (req, res) => res.json({ ok: true }));
    app.use((err, req, res, next) => res.status(400).end());
    const server = app.listen(0, '127.0.0.1', () => {
      const body = zlib.${encoding === 'gzip' ? 'gzipSync' : 'deflateSync'}('{}');
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': '${encoding}' } }, res => {
        res.resume();
        res.on('end', () => setTimeout(() => server.close(() => process.exit(0)), 100));
      });
      req.on('error', err => { console.error(err.message); process.exit(2); });
      req.write(body);
      setTimeout(() => req.end('invalid-trailing-frame'), 20);
    });
  `;
  const run = promisify(execFile)(process.execPath, ['-e', script], { cwd: process.cwd(), timeout: 5000 });
  await expect(run).resolves.toMatchObject({ stderr: '' });
});
