/* Local Web Clipper API. Credentials never leave the background context. */
const HabrJoplin = (() => {
  async function request(port, path, { token, method = 'GET', body, timeout = 10000, plain = false } = {}) {
    if (!Number.isInteger(port) || port < 41184 || port > 41194) throw new Error('Некорректный порт Joplin');
    const url = new URL(`http://127.0.0.1:${port}${path}`);
    if (token) url.searchParams.set('token', token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let response;
      try {
        response = await fetch(url.href, {
          method, signal: controller.signal, redirect: 'error', credentials: 'omit',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new Error('Нет ответа от Web Clipper. Проверьте Joplin и включите службу Web Clipper в его настройках.');
      }
      if (response.status === 401 || response.status === 403) throw new Error('Доступ отклонён. Подключите Joplin заново.');
      if (response.status === 404 && path.startsWith('/folders/')) throw new Error('Блокнот не найден. Обновите список блокнотов.');
      if (!response.ok) throw new Error(`Ошибка Joplin (HTTP ${response.status}).`);
      try {
        return plain ? await response.text() : await response.json();
      } catch {
        throw new Error('Некорректный ответ Joplin. Проверьте службу Web Clipper.');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function status() {
    const data = await chrome.storage.local.get(['joplinConnection', 'joplinPendingAuth', 'joplinLastFolder']);
    return { connected: Boolean(data.joplinConnection?.token),
      pending: Boolean(data.joplinPendingAuth?.expires > Date.now()), lastFolder: data.joplinLastFolder || '' };
  }

  async function connect() {
    let port;
    for (let candidate = 41184; candidate <= 41194; candidate++) {
      try {
        if (await request(candidate, '/ping', { plain: true, timeout: 600 }) === 'JoplinClipperServer') {
          port = candidate;
          break;
        }
      } catch { /* Try the next documented Clipper port. */ }
    }
    if (!port) throw new Error('Joplin не найден. Запустите Joplin Desktop и включите службу Web Clipper в настройках.');
    const result = await request(port, '/auth', { method: 'POST' });
    if (!result.auth_token) throw new Error('Joplin не вернул запрос авторизации.');
    await chrome.storage.local.set({ joplinPendingAuth: {
      port, authToken: result.auth_token, expires: Date.now() + 5 * 60 * 1000,
    } });
    return { pending: true };
  }

  async function checkAuth() {
    const { joplinPendingAuth: pending, joplinConnection: existing } = await chrome.storage.local.get(['joplinPendingAuth', 'joplinConnection']);
    if (!pending && existing?.token) return { connected: true };
    if (!pending || pending.expires <= Date.now()) throw new Error('Время подключения истекло. Нажмите «Подключить Joplin» ещё раз.');
    const result = await request(pending.port, `/auth/check?auth_token=${encodeURIComponent(pending.authToken)}`);
    if (result.status === 'accepted' && result.token) {
      await chrome.storage.local.set({ joplinConnection: { port: pending.port, token: result.token }, joplinPendingAuth: null });
      return { connected: true };
    }
    if (result.status === 'rejected') {
      await chrome.storage.local.set({ joplinPendingAuth: null });
      throw new Error('Запрос доступа отклонён в Joplin.');
    }
    if (result.status !== 'waiting') throw new Error('Неожиданный ответ авторизации Joplin.');
    return { pending: true };
  }

  async function connection() {
    const { joplinConnection: value } = await chrome.storage.local.get(['joplinConnection']);
    if (!value?.token) throw new Error('Сначала подключите Joplin.');
    return value;
  }

  async function folders() {
    const { port, token } = await connection();
    const all = [];
    const collected = new Set();
    function collect(items, parentId = '') {
      for (const folder of items) {
        if (collected.has(folder.id)) continue;
        collected.add(folder.id);
        all.push({ ...folder, parent_id: folder.parent_id || parentId });
        if (Array.isArray(folder.children)) collect(folder.children, folder.id);
      }
    }
    for (let page = 1; ; page++) {
      const result = await request(port, `/folders?fields=id,parent_id,title&limit=100&page=${page}`, { token });
      const items = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(items)) throw new Error('Не удалось получить список блокнотов Joplin.');
      collect(items);
      if (!result.has_more) break;
    }
    const byId = new Map(all.map(folder => [folder.id, folder]));
    return all.map(folder => {
      const names = [folder.title];
      const seen = new Set([folder.id]);
      let parent = byId.get(folder.parent_id);
      while (parent && !seen.has(parent.id)) {
        seen.add(parent.id);
        names.unshift(parent.title);
        parent = byId.get(parent.parent_id);
      }
      return { id: folder.id, label: names.join(' / ') };
    }).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }

  async function save({ title, folderId, body, url }) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('Введите заголовок заметки.');
    if (typeof folderId !== 'string' || !folderId) throw new Error('Выберите блокнот.');
    if (typeof body !== 'string' || !body.trim()) throw new Error('Текст статьи пуст.');
    const { port, token } = await connection();
    const folder = await request(port, `/folders/${encodeURIComponent(folderId)}`, { token });
    if (folder.id !== folderId) throw new Error('Блокнот не найден. Обновите список блокнотов.');
    // Never retry POST: a lost response may still mean the note was created.
    const note = await request(port, '/notes', { token, method: 'POST', body: {
      title: title.trim(), parent_id: folderId, body, source_url: url,
    } });
    if (!note.id) throw new Error('Joplin не подтвердил сохранение. Проверьте блокнот перед повторной отправкой.');
    await chrome.storage.local.set({ joplinLastFolder: folderId });
    return { id: note.id };
  }

  return { status, connect, checkAuth, folders, save };
})();
