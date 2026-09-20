const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function client(handler, initial = {}) {
  const stored = { ...initial };
  const calls = [];
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    chrome: { storage: { local: {
      async get(keys) { return Object.fromEntries(keys.filter(k => k in stored).map(k => [k, stored[k]])); },
      async set(data) { Object.assign(stored, data); },
    } } },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      calls.push({ url: parsed, options });
      const value = await handler(parsed, options);
      const status = typeof value.status === 'number' ? value.status : 200;
      return { ok: status < 400, status,
        text: async () => typeof value === 'string' ? value : JSON.stringify(value),
        json: async () => value };
    },
  });
  const file = path.join(__dirname, '../extension/utils/joplin.js');
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const api = vm.runInContext('typeof HabrJoplin === "undefined" ? null : HabrJoplin', context);
  assert.ok(api, 'Joplin integration is available');
  return { api, stored, calls };
}
const connected = { joplinConnection: { port: 41184, token: 'secret' } };

test('discovers clipper and persists authorization across client restarts', async () => {
  const handler = (url) => {
    if (url.pathname === '/ping') return url.port === '41185' ? 'JoplinClipperServer' : 'other';
    if (url.pathname === '/auth') return { auth_token: 'pending' };
    assert.equal(url.searchParams.get('auth_token'), 'pending');
    return { status: 'accepted', token: 'secret' };
  };
  const first = client(handler);
  await first.api.connect();
  const second = client(handler, first.stored);
  assert.equal((await second.api.checkAuth()).connected, true);
  assert.equal(second.stored.joplinConnection.port, 41185);
  assert.equal(second.stored.joplinConnection.token, 'secret');
  assert.equal(JSON.stringify(await second.api.status()).includes('secret'), false);
  // Another open window may poll after the first one stored the token.
  assert.equal((await second.api.checkAuth()).connected, true);
});

test('lists all pages and distinguishes nested notebooks', async () => {
  const { api } = client(url => url.searchParams.get('page') === '1'
    ? { items: [{ id: 'a', title: 'Работа', parent_id: '' }], has_more: true }
    : { items: [{ id: 'b', title: 'Статьи', parent_id: 'a' }], has_more: false }, connected);
  const result = await api.folders();
  assert.equal(result.find(f => f.id === 'b').label, 'Работа / Статьи');
  assert.equal(result.length, 2);
});

test('creates note with edited title, selected notebook and original source', async () => {
  const { api, stored, calls } = client((url) => url.pathname === '/folders/b'
    ? { id: 'b' } : { id: 'note-1' }, connected);
  const result = await api.save({ title: '  Новый заголовок  ', folderId: 'b',
    body: '**Текст**\n![image](https://example.org/a.png)', url: 'https://habr.com/ru/articles/123/' });
  const payload = JSON.parse(calls.find(c => c.url.pathname === '/notes').options.body);
  assert.equal(payload.title, 'Новый заголовок');
  assert.equal(payload.parent_id, 'b');
  assert.equal(payload.source_url, 'https://habr.com/ru/articles/123/');
  assert.match(payload.body, /\*\*Текст\*\*/);
  assert.equal(result.id, 'note-1');
  assert.equal(stored.joplinLastFolder, 'b');
});

test('rejects blank titles and missing notebooks before creating a note', async () => {
  const { api, calls } = client(() => ({ status: 404 }), connected);
  await assert.rejects(api.save({ title: ' ', folderId: 'b', body: 'x' }), /заголовок/i);
  await assert.rejects(api.save({ title: 'x', folderId: '', body: 'x' }), /блокнот/i);
  await assert.rejects(api.save({ title: 'x', folderId: 'gone', body: 'x' }), /блокнот/i);
  assert.equal(calls.some(c => c.url.pathname === '/notes'), false);
});

test('does not retry note creation on network failure or remember failed destination', async () => {
  const { api, calls, stored } = client(url => {
    if (url.pathname.startsWith('/folders/')) return { id: 'b' };
    throw new Error('Network failed with secret token');
  }, connected);
  await assert.rejects(api.save({ title: 'x', folderId: 'b', body: 'x' }), /Проверьте Joplin/);
  assert.equal(calls.filter(c => c.url.pathname === '/notes').length, 1);
  assert.equal(stored.joplinLastFolder, undefined);
});

test('reports revoked access without exposing token', async () => {
  const { api } = client(() => ({ status: 403, error: 'secret' }), connected);
  await assert.rejects(api.folders(), /Подключите Joplin заново/);
});

test('reports rejected authorization', async () => {
  const { api } = client(() => ({ status: 'rejected' }), {
    joplinPendingAuth: { port: 41184, authToken: 'pending', expires: Date.now() + 60000 },
  });
  await assert.rejects(api.checkAuth(), /отклонён/);
});

test('supports the documented folder tree including children without parent_id', async () => {
  const { api } = client(() => [{ id: 'a', title: 'Работа', children: [
    { id: 'b', title: 'Статьи', children: [{ id: 'c', title: 'Habr' }] },
  ] }], connected);
  const result = await api.folders();
  assert.equal(result.find(f => f.id === 'c').label, 'Работа / Статьи / Habr');
  assert.equal(result.length, 3);
});
