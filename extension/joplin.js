if (typeof browser !== 'undefined' && browser.runtime?.id) globalThis.chrome = browser;

const $ = selector => document.querySelector(selector);
const articleUrl = new URL(location.href).searchParams.get('url');
const compact = new URL(location.href).searchParams.get('compact') === '1';
if (compact) document.documentElement.classList.add('compact');
let article;
let saving = false;
let saved = false;
let pollTimer;

async function send(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.success) throw new Error(result?.error || 'Нет ответа от расширения.');
  return result;
}

function status(text, error = false, target = '#status') {
  $(target).textContent = text;
  $(target).title = text;
  $(target).className = error ? 'error' : '';
}

function updateSave() {
  $('#save').disabled = !article || $('#folder').disabled || !$('#folder').value || !$('#title').value.trim() || saving || saved;
}

async function loadFolders() {
  const previous = $('#folder').value;
  $('#refresh').disabled = true;
  $('#folder').disabled = true;
  $('#save').disabled = true;
  try {
    const [result, state] = await Promise.all([send('JOPLIN_FOLDERS'), send('JOPLIN_STATUS')]);
    $('#folder').replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = result.folders.length ? 'Выберите блокнот' : 'Нет блокнотов — создайте блокнот в Joplin';
    $('#folder').append(placeholder);
    for (const folder of result.folders) {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.label;
      $('#folder').append(option);
    }
    const preferred = previous || state.lastFolder;
    $('#folder').value = result.folders.some(folder => folder.id === preferred) ? preferred : '';
    $('#folder').disabled = saved || !result.folders.length;
    status('Joplin подключён.', false, '#connectionStatus');
    $('#setup').hidden = true;
    if (compact) status(article ? '' : 'Загружаю статью…');
    updateSave();
  } catch (err) {
    $('#folder').replaceChildren();
    status(err.message, true, '#connectionStatus');
    if (compact) {
      $('#setup').hidden = false;
      status('Нет связи с Joplin. Проверьте подключение.', true);
      $('#status').title = err.message;
    }
  } finally {
    $('#refresh').disabled = saved;
  }
}

async function pollAuth() {
  try {
    const result = await send('JOPLIN_AUTH_CHECK');
    if (result.connected) {
      $('#connect').disabled = false;
      $('#connect').textContent = 'Подключить заново';
      status('Joplin подключён.', false, '#connectionStatus');
      if (articleUrl) await loadFolders();
    } else {
      pollTimer = setTimeout(pollAuth, 1000);
    }
  } catch (err) {
    status(err.message, true, '#connectionStatus');
    $('#connect').disabled = false;
  }
}

$('#connect').addEventListener('click', async () => {
  $('#connect').disabled = true;
  clearTimeout(pollTimer);
  try {
    // Must run directly from the user's click for optional host permission.
    const granted = await chrome.permissions.request({ origins: ['http://127.0.0.1/*'] });
    if (!granted) throw new Error('Разрешите доступ к локальной службе Joplin для подключения.');
    status('Ищу Joplin…', false, '#connectionStatus');
    await send('JOPLIN_CONNECT');
    status('Подтвердите запрос доступа в Joplin Desktop. Оставьте это окно открытым.', false, '#connectionStatus');
    await pollAuth();
  } catch (err) {
    status(err.message, true, '#connectionStatus');
    $('#connect').disabled = false;
  }
});

$('#refresh').addEventListener('click', loadFolders);
$('#title').addEventListener('input', updateSave);
$('#folder').addEventListener('change', updateSave);
function closePanel() {
  if (compact) window.parent.postMessage({ type: 'HABR_JOPLIN_CLOSE' }, 'https://habr.com');
  else window.close();
}
$('#close').addEventListener('click', closePanel);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
$('#setup').addEventListener('click', async () => {
  try { await send('JOPLIN_OPEN'); } catch (err) { status(err.message, true); }
});
window.addEventListener('pagehide', () => clearTimeout(pollTimer));

$('#noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('#save').disabled) return;
  saving = true;
  updateSave();
  $('#title').disabled = $('#folder').disabled = $('#refresh').disabled = $('#connect').disabled = true;
  status('Сохраняю статью…');
  $('#includeComments').disabled = true;
  try {
    if ($('#includeComments').checked !== article.includeComments) {
      article = await send('JOPLIN_PREPARE', { url: article.url, includeComments: $('#includeComments').checked });
    }
    await send('JOPLIN_SAVE', { title: $('#title').value, folderId: $('#folder').value, body: article.body, url: article.url });
    saved = true;
    status('Статья сохранена в Joplin.');
    $('#status').className = 'success';
    $('#save').textContent = 'Сохранено';
    closePanel();
  } catch (err) {
    status(`${err.message} Если связь прервалась при отправке, проверьте блокнот перед повторной попыткой.`, true);
    $('#title').disabled = $('#folder').disabled = $('#refresh').disabled = $('#connect').disabled = false;
    $('#includeComments').disabled = false;
  } finally {
    saving = false;
    updateSave();
  }
});

async function init() {
  if (articleUrl) {
    $('#noteForm').hidden = false;
    status('Загружаю статью…');
  } else {
    $('h1').textContent = 'Подключение Joplin';
  }
  const connectionTask = (async () => {
    const state = await send('JOPLIN_STATUS');
    if (compact && !state.connected) {
      $('#setup').hidden = false;
      status('Подключите Joplin, затем обновите блокноты.');
      $('#refresh').disabled = false;
      return;
    }
    if (state.pending) {
      $('#connect').disabled = true;
      status('Ожидаю подтверждения доступа в Joplin Desktop…', false, '#connectionStatus');
      await pollAuth();
    } else if (state.connected) {
      $('#connect').textContent = 'Подключить заново';
      status('Joplin подключён.', false, '#connectionStatus');
      if (articleUrl) await loadFolders();
    }
  })().catch(err => status(err.message, true, '#connectionStatus'));
  if (articleUrl) {
    try {
      article = await send('JOPLIN_PREPARE', { url: articleUrl });
      $('#title').value = article.title;
      $('#includeComments').checked = article.includeComments;
      $('#title').disabled = false;
      $('#source').href = article.url;
      if (!compact || $('#setup').hidden) status('');
      updateSave();
      if (compact) window.parent.postMessage({ type: 'HABR_JOPLIN_READY' }, 'https://habr.com');
    } catch (err) {
      status(err.message, true);
      if (compact) window.parent.postMessage({ type: 'HABR_JOPLIN_ERROR', error: err.message }, 'https://habr.com');
    }
  }
  await connectionTask;
}

init();
