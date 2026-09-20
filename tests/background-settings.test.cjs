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
        onInstalled: event(), onStartup: event(),
        onMessage: { addListener(listener) { onMessage = listener; } },
      },
      storage: { local: {
        async get() { return { ...stored }; },
        async set(values) { Object.assign(stored, values); },
      } },
      alarms: { onAlarm: event(), async clear() {}, async create() {} },
      contextMenus: { onClicked: event(), async removeAll() {}, async create() {} },
    };
    const context = vm.createContext({ chrome: api, URL, console, setTimeout, clearTimeout });
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
  });
}
