#!/usr/bin/env node
// 스토어 스크린샷용 하네스 서버. 확장 소스를 그대로 쓰되 chrome.* API 만 흉내 내고 샘플 데이터를 채운다.
//   node scripts/screenshots/serve.mjs  →  http://127.0.0.1:8731/frame.html?src=/src/popup/popup.html&w=700&h=610
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const HERE = import.meta.dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    let file;
    if (path === '/frame.html' || path === '/shim.js') file = join(HERE, path);
    else file = join(ROOT, path);
    let body = await readFile(file);
    // 팝업·설정·기록 페이지에 shim 을 끼워 넣는다 (원본 파일은 건드리지 않는다)
    if (path.endsWith('.html') && path.startsWith('/src/')) {
      body = Buffer.from(String(body).replace(/<script type="module"/, '<script src="/shim.js"></script>\n<script type="module"'));
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
server.listen(8731, '127.0.0.1', () => console.log('http://127.0.0.1:8731/frame.html?src=/src/popup/popup.html&w=700&h=610'));
