const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));

for (const mode of ['event page', 'service worker']) {
  test(`saves settings in ${mode}`, async () => {
    const stored = {};
    let onMessage;
    const event = () => ({ addListener() {} });
    const api = {
      runtime: {
        id: 'test-extension',
        getURL: file => `chrome-extension://test-extension/${file}`,
        onInstalled: event(), onStartup: event(),
        onMessage: { addListener(listener) { onMessage = listener; } },
      },
      storage: { local: {
        async get(keys) { return keys == null ? { ...stored } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in stored).map(k => [k, stored[k]])); },
        async set(values) { Object.assign(stored, values); },
      } },
      alarms: { onAlarm: event(), async clear() {}, async create() {} },
      contextMenus: { onClicked: event(), async removeAll() {}, async create() {} },
    };
    const context = vm.createContext({ chrome: api, URL, console, setTimeout, clearTimeout, AbortController });
    const load = file => vm.runInContext(
      fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file },
    );
    if (mode === 'service worker') {
      context.importScripts = (...files) => files.forEach(load);
      load(manifest.background.service_worker);
    } else {
      context.browser = api;
      manifest.background.scripts.forEach(load);
    }
    const response = await new Promise(resolve => {
      onMessage({ type: 'SAVE_SETTINGS', settings: {
        downloadFolder: 'saved-articles', watchEnabled: true, watchIntervalMinutes: 30,
      } }, {}, resolve);
    });
    assert.equal(response.success, true, response.error);
    assert.equal(stored.downloadFolder, 'saved-articles');
    assert.equal(response.settings.watchIntervalMinutes, 30);
    assert.equal(response.settings.watchEnabled, true);

    // A Joplin connection must never appear in settings or backups.
    stored.joplinConnection = { port: 41184, token: 'private-token' };
    const send = message => new Promise(resolve => onMessage(message, {}, resolve));
    const state = await send({ type: 'JOPLIN_STATUS' });
    assert.equal(state.success, true, state.error);
    assert.equal(state.connected, true);
    const backup = await send({ type: 'EXPORT_SETTINGS' });
    assert.equal(backup.json.includes('private-token'), false);
    const changed = await send({ type: 'SAVE_SETTINGS', settings: { joplinConnection: { token: 'injected' } } });
    assert.equal(stored.joplinConnection.token, 'private-token');
    assert.equal(JSON.stringify(changed).includes('private-token'), false);
    const blocked = await send({ type: 'JOPLIN_SAVE', title: 'Untrusted' });
    assert.equal(blocked.success, false);
    assert.match(blocked.error, /Откройте окно/);
    const payloads = [];
    context.fetch = async (url, options) => {
      const value = new URL(url).pathname.startsWith('/folders/') ? { id: 'chosen' } : { id: 'created-note' };
      if (options.body) payloads.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => value };
    };
    const savedNote = await new Promise(resolve => onMessage({
      type: 'JOPLIN_SAVE', title: 'Edited title', folderId: 'chosen', body: '**Article**',
      url: 'https://habr.com/ru/articles/123/',
    }, { url: api.runtime.getURL('joplin.html') + '?url=test' }, resolve));
    assert.equal(savedNote.success, true, savedNote.error);
    assert.equal(savedNote.id, 'created-note');
    assert.equal(payloads[0].title, 'Edited title');
    assert.equal(payloads[0].parent_id, 'chosen');
    // Per-save overrides must not leak into the next panel's defaults.
    vm.runInContext(`HabrCore.preparePublication = async (url, settings) => ({
      meta: { title: 'Article', url }, body: settings.downloadComments ? 'With comments' : 'Without comments'
    })`, context);
    const prepare = extra => new Promise(resolve => onMessage({
      type: 'JOPLIN_PREPARE', url: 'https://habr.com/ru/articles/123/', ...extra,
    }, { url: api.runtime.getURL('joplin.html') + '?compact=1' }, resolve));
    for (const defaultValue of [true, false]) {
      stored.downloadComments = defaultValue;
      const initial = await prepare({});
      assert.equal(initial.includeComments, defaultValue);
      const override = await prepare({ includeComments: !defaultValue });
      assert.equal(override.includeComments, !defaultValue);
      assert.equal(override.body, defaultValue ? 'Without comments' : 'With comments');
      assert.equal(stored.downloadComments, defaultValue);
      assert.equal((await prepare({})).includeComments, defaultValue);
    }
  });
}
