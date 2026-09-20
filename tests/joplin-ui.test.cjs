const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../extension');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const compact of [false, true]) {
test(`${compact ? 'compact panel' : 'save window'} stays open on failure and closes after successful retry`, async () => {
  const sent = [];
  let completeSave;
  let completeArticle;
  const context = vm.createContext({ URL, setTimeout, clearTimeout, console,
    location: { href: `chrome-extension://test/joplin.html?compact=${compact ? 1 : 0}&url=https://habr.com/ru/articles/123/` },
    chrome: { runtime: { async sendMessage(message) {
      sent.push(message);
      switch (message.type) {
        case 'JOPLIN_STATUS': return { success: true, connected: true, lastFolder: 'b' };
        case 'JOPLIN_FOLDERS': return { success: true, folders: [{ id: 'b', label: 'Работа / Habr' }] };
        case 'JOPLIN_PREPARE':
          if (typeof message.includeComments === 'boolean') return { success: true, title: 'Original', body: 'Changed comments', url: 'https://habr.com/ru/articles/123/', includeComments: message.includeComments };
          return new Promise(resolve => { completeArticle = resolve; });
        case 'JOPLIN_SAVE': return new Promise(resolve => { completeSave = resolve; });
        default: throw new Error(message.type);
      }
    } } },
  });
  vm.runInContext(read('lib/dom-shim.js'), context);
  const doc = vm.runInContext('new DOMParser()', context).parseFromString(read('joplin.html'), 'text/html');
  context.document = doc;
  context.window = doc.defaultView;
  const parentMessages = [];
  let closed = 0;
  context.window.close = () => { closed++; };
  context.window.parent = { postMessage: (...args) => parentMessages.push(args) };
  // Linkedom does not implement the browser's select.value setter.
  Object.defineProperty(doc.querySelector('#folder'), 'value', { value: '', writable: true });
  vm.runInContext(read('joplin.js'), context);
  await flush();
  assert.equal(parentMessages.length, 0, 'does not reveal the panel before the article arrives');
  completeArticle({ success: true, title: 'Original', body: '**Article**', url: 'https://habr.com/ru/articles/123/', includeComments: compact });
  await flush();
  const input = doc.querySelector('#title');
  assert.equal(input.value, 'Original');
  assert.equal(doc.querySelector('#folder').value, 'b');
  assert.equal(doc.querySelector('#save').disabled, false);
  assert.equal(doc.querySelector('#includeComments').checked, compact);
  doc.querySelector('#includeComments').checked = !compact;
  input.value = 'Edited title';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  const submit = () => doc.querySelector('#noteForm').dispatchEvent(new doc.defaultView.Event('submit', { cancelable: true }));
  submit();
  submit();
  await flush();
  assert.equal(doc.querySelector('#save').disabled, true);
  assert.equal(sent.filter(message => message.type === 'JOPLIN_SAVE').length, 1);
  const saved = sent.find(message => message.type === 'JOPLIN_SAVE');
  assert.equal(saved.title, 'Edited title');
  assert.equal(saved.folderId, 'b');
  assert.equal(saved.body, 'Changed comments');
  assert.equal(sent.find(message => typeof message.includeComments === 'boolean').includeComments, !compact);
  assert.equal(sent.some(message => message.type === 'SAVE_SETTINGS'), false);
  completeSave({ success: false, error: 'Блокнот недоступен: нет прав на запись.' });
  await flush();
  assert.match(doc.querySelector('#status').textContent, /Блокнот недоступен: нет прав на запись/);
  assert.equal(doc.querySelector('#status').className, 'error');
  assert.equal(doc.querySelector('#save').disabled, false);
  assert.equal(input.value, 'Edited title');
  assert.equal(doc.querySelector('#folder').value, 'b');
  assert.equal(closed, 0);
  assert.equal(parentMessages.some(([data]) => data.type === 'HABR_JOPLIN_CLOSE'), false);
  submit();
  await flush();
  completeSave({ success: true, id: 'note1' });
  await flush();
  assert.match(doc.querySelector('#status').textContent, /сохранена/);
  assert.equal(doc.querySelector('#save').disabled, true);
  if (compact) {
    assert.equal(doc.documentElement.classList.contains('compact'), true);
    assert.equal(parentMessages[0][0].type, 'HABR_JOPLIN_READY');
    assert.equal(parentMessages.at(-1)[0].type, 'HABR_JOPLIN_CLOSE');
    assert.equal(parentMessages[0][1], 'https://habr.com');
  } else {
    assert.equal(closed, 1);
  }
});
}

test('article and feed buttons open the correct URL and disappear when disabled', async () => {
  for (const feed of [false, true]) {
    let onChanged;
    const sent = [];
    const context = vm.createContext({ URL, console, setTimeout, clearTimeout,
      location: { origin: 'https://habr.com', pathname: feed ? '/ru/feed/' : '/ru/articles/123/', href: 'https://habr.com/ru/articles/123/' },
      history: { pushState() {}, replaceState() {} },
      chrome: {
        storage: { local: { async get() { return { showFloatingButton: true }; } },
          onChanged: { addListener(listener) { onChanged = listener; } } },
        runtime: { getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener() {} }, async sendMessage(message) { sent.push(message); return { success: true }; } },
      },
    });
    vm.runInContext(read('lib/dom-shim.js'), context);
    const markup = feed
      ? '<div class="tm-articles-list"><article class="tm-articles-list__item"><div class="article-snippet"><a class="tm-title__link" href="https://habr.com/ru/articles/456/">Feed title</a></div></article></div>'
      : '<div class="tm-article-presenter"><div class="tm-article-presenter__snippet"></div></div>';
    const doc = vm.runInContext('new DOMParser()', context).parseFromString(`<html><body>${markup}</body></html>`, 'text/html');
    context.document = doc;
    context.window = doc.defaultView;
    context.window.innerWidth = 1024;
    context.window.innerHeight = 768;
    context.MutationObserver = doc.defaultView.MutationObserver;
    vm.runInContext(read('content.js'), context);
    await flush();
    assert.equal(doc.querySelectorAll('.habr-md-btn').length, 2);
    doc.querySelector('.habr-joplin-btn').getBoundingClientRect = () => ({ left: 800, right: 880, top: 100, bottom: 138 });
    doc.querySelector('.habr-joplin-btn').click();
    await flush();
    const panel = doc.querySelector('.habr-joplin-panel');
    assert.ok(panel, 'panel opens on the article page');
    assert.equal(panel.style.visibility, 'hidden', 'panel is hidden while the title is loading');
    assert.equal(doc.querySelector('.habr-joplin-btn').textContent, 'Загрузка…');
    const ready = new doc.defaultView.Event('message');
    ready.source = panel.querySelector('iframe').contentWindow;
    ready.origin = 'chrome-extension://test';
    ready.data = { type: 'HABR_JOPLIN_READY' };
    context.window.dispatchEvent(ready);
    assert.equal(panel.style.visibility, 'visible');
    assert.equal(doc.querySelector('.habr-joplin-btn').textContent, 'В Joplin');
    const frameUrl = new URL(panel.querySelector('iframe').src);
    assert.equal(frameUrl.searchParams.get('compact'), '1');
    assert.equal(frameUrl.searchParams.get('url'), `https://habr.com/ru/articles/${feed ? 456 : 123}/`);
    assert.equal(sent.length, 0, 'does not open a separate window');
    assert.equal(panel.style.top, '144px');
    assert.equal(panel.style.left, '540px');
    doc.querySelector('.habr-joplin-btn').getBoundingClientRect = () => ({ left: 10, right: 90, top: 730, bottom: 768 });
    context.window.dispatchEvent(new doc.defaultView.Event('resize'));
    assert.equal(panel.style.left, '8px');
    assert.equal(panel.style.top, '464px', 'opens above the button near the bottom edge');
    onChanged({ showFloatingButton: { newValue: false } }, 'local');
    assert.equal(doc.querySelectorAll('.habr-md-btn').length, 0);
    assert.equal(doc.querySelector('.habr-joplin-panel'), null);
  }
});
