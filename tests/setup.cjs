// Test bootstrap: resolves the "@/" alias and replaces next/* modules with light stubs so
// server code and pages can be exercised with plain Node (no Next.js runtime needed).
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
process.env.DATABASE_PATH = process.env.DATABASE_PATH || ':memory:';
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret';
const g = '/home/claude/.npm-global/lib/node_modules';
if (fs.existsSync(g) && !fs.existsSync(path.join(root, 'node_modules', 'react'))) {
  process.env.NODE_PATH = [process.env.NODE_PATH, g].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}
const stubs = {
  'next/link': 'link.jsx', 'next/navigation': 'navigation.js', 'next/headers': 'headers.js', 'next/server': 'server.js',
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2));
  else if (stubs[request]) request = path.join(__dirname, 'stubs', stubs[request]);
  return orig.call(this, request, parent, ...rest);
};
