const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('prepares an already downloaded article without downloading files or changing history', async () => {
  const root = path.join(__dirname, '../extension');
  const context = vm.createContext({ URL, console, setTimeout, clearTimeout, AbortController,
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      id: 123, titleHtml: 'Original title', textHtml: '<p>Hello <strong>world</strong></p>',
    }) }),
    chrome: { storage: { local: { async get() { throw new Error('History must not be read'); },
      async set() { throw new Error('History must not be written'); } } },
      downloads: { download() { throw new Error('Must not download a file'); } } },
  });
  const files = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).background.scripts;
  files.filter(f => f !== 'background.js').forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context));
  const core = vm.runInContext('HabrCore', context);
  assert.equal(typeof core.preparePublication, 'function');
  const article = await core.preparePublication('https://habr.com/ru/articles/123/', { downloadComments: false });
  assert.equal(article.meta.title, 'Original title');
  assert.equal(article.body, 'Hello **world**');
  assert.match(article.markdown, /^---\n/);
  await assert.rejects(core.preparePublication('https://evilhabr.com/ru/articles/123/', {}), /URL/);
});
