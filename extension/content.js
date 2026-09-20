// Firefox: chrome.* здесь коллбэчный, browser.* — промисифицированный. Выравниваем.
if (typeof browser !== 'undefined' && browser.runtime?.id) {
  globalThis.chrome = browser;
}

(function initHabrDownloaderUi() {
  const PUBLICATION_PATH_RE = /\/(?:companies\/[^/]+\/)?(?:articles|news|post)\/\d+/;

  let fabEnabled = true;
  let lastPath = location.pathname;
  let feedObserver = null;
  let syncTimer = null;
  let joplinPanel = null;

  function closeJoplinPanel() {
    if (!joplinPanel) return;
    const { panel, button, cleanup } = joplinPanel;
    cleanup();
    panel.remove();
    button.setAttribute('aria-expanded', 'false');
    joplinPanel = null;
  }

  function openJoplinPanel(button) {
    const sameButton = joplinPanel?.button === button;
    closeJoplinPanel();
    if (sameButton) return;
    const panel = document.createElement('div');
    panel.className = 'habr-joplin-panel';
    panel.style.visibility = 'hidden';
    button.textContent = 'Загрузка…';
    button.setAttribute('aria-busy', 'true');
    panel.setAttribute('popover', 'manual');
    const frame = document.createElement('iframe');
    frame.title = 'Сохранить статью в Joplin';
    frame.src = chrome.runtime.getURL(`joplin.html?compact=1&url=${encodeURIComponent(button.dataset.url)}`);
    panel.append(frame);
    document.body.append(panel);
    const position = () => {
      if (!button.isConnected) { closeJoplinPanel(); return; }
      const rect = button.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      const height = 260;
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 8 ? below : rect.top - height - 6;
      panel.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    };
    const outside = event => {
      if (!panel.contains(event.target) && !button.contains(event.target)) closeJoplinPanel();
    };
    const escape = event => { if (event.key === 'Escape') closeJoplinPanel(); };
    const loadTimeout = setTimeout(() => {
      closeJoplinPanel();
      showToast(button, 'Не удалось загрузить статью. Попробуйте ещё раз.', 'error');
    }, 45000);
    const message = event => {
      if (event.source !== frame.contentWindow || event.origin !== chrome.runtime.getURL('').replace(/\/$/, '')) return;
      if (event.data?.type === 'HABR_JOPLIN_READY') {
        clearTimeout(loadTimeout);
        position();
        // Reveal only after the iframe has filled in the article title.
        panel.style.visibility = 'visible';
        panel.showPopover?.();
        button.textContent = 'В Joplin';
        button.removeAttribute('aria-busy');
        button.setAttribute('aria-expanded', 'true');
      }
      if (event.data?.type === 'HABR_JOPLIN_ERROR') {
        closeJoplinPanel();
        showToast(button, event.data.error || 'Не удалось загрузить статью.', 'error');
      }
      if (event.data?.type === 'HABR_JOPLIN_CLOSE') { closeJoplinPanel(); button.focus(); }
    };
    joplinPanel = { panel, button, cleanup() {
      clearTimeout(loadTimeout);
      button.textContent = 'В Joplin';
      button.removeAttribute('aria-busy');
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('message', message);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('message', message);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    position();
  }

  function scheduleSync(delay = 400) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncUi, delay);
  }

  function normalizePublicationUrl(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!url.hostname.includes('habr.com')) return null;
      if (!PUBLICATION_PATH_RE.test(url.pathname)) return null;
      const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      return `${url.origin}${path}`;
    } catch {
      return null;
    }
  }

  function isPublicationPath(pathname = location.pathname) {
    return PUBLICATION_PATH_RE.test(pathname);
  }

  function getPublicationUrlFromPage() {
    if (isPublicationPath()) {
      return normalizePublicationUrl(location.href);
    }

    const canonical = document.querySelector('link[rel="canonical"]')?.href
      || document.querySelector('meta[property="og:url"]')?.content;
    const fromCanonical = normalizePublicationUrl(canonical || '');
    if (fromCanonical) return fromCanonical;

    if (document.querySelector('.tm-article-presenter, .post__body')) {
      const titleLink = document.querySelector(
        'h1.tm-title a[href*="/articles/"], h1.tm-title a[href*="/news/"], h1.tm-title a[href*="/post/"]',
      );
      if (titleLink) return normalizePublicationUrl(titleLink.href);
    }

    const expandedBody = document.querySelector(
      '.tm-articles-list__item .article-formatted-body, article.tm-articles-list__item .article-formatted-body',
    );
    if (expandedBody) {
      const item = expandedBody.closest('article.tm-articles-list__item, .tm-articles-list__item');
      return getCardUrl(item);
    }

    return null;
  }

  function isFeedPage() {
    return Boolean(document.querySelector('.tm-articles-list, .tm-feed, .tm-posts-list, .tm-news-list'))
      && !isPublicationPath();
  }

  function isOurNode(node) {
    return node?.nodeType === 1 && (
      node.classList?.contains('habr-md-btn')
      || node.classList?.contains('habr-md-toast')
      || Boolean(node.closest?.('.habr-md-btn, .habr-md-toast'))
    );
  }

  function resetButtonState(btn) {
    btn.classList.remove(
      'habr-md-btn--loading',
      'habr-md-btn--success',
      'habr-md-btn--skip',
      'habr-md-btn--error',
    );
    delete btn.dataset.habrMdBusy;
    btn.disabled = false;
    const label = btn.querySelector('.habr-md-label');
    if (label) label.textContent = '.md';
    btn.title = btn.dataset.defaultTitle || 'Скачать в Markdown';
  }

  function showToast(btn, text, type = 'info') {
    const host = btn.closest('.habr-md-host') || btn.parentElement;
    if (!host) return;

    let toast = host.querySelector(':scope > .habr-md-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'habr-md-toast';
      host.appendChild(toast);
    }

    toast.className = `habr-md-toast habr-md-toast--${type}`;
    toast.textContent = text;
    toast.hidden = false;

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.hidden = true;
    }, 4000);
  }

  async function downloadUrl(url, button) {
    const label = button.querySelector('.habr-md-label') || button;

    button.dataset.habrMdBusy = '1';
    button.disabled = true;
    button.classList.remove('habr-md-btn--success', 'habr-md-btn--skip', 'habr-md-btn--error');
    button.classList.add('habr-md-btn--loading');
    label.textContent = '…';
    showToast(button, 'Скачиваю…', 'info');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_URL',
        url,
        skipFilters: true,
      });

      if (!result?.success || result.result?.error) {
        throw new Error(result?.result?.error || result?.error || 'Ошибка скачивания');
      }

      button.classList.remove('habr-md-btn--loading');

      if (result.result?.skipped) {
        button.classList.add('habr-md-btn--skip');
        label.textContent = '—';
        const msg = result.result.reason === 'downloaded'
          ? 'Уже скачано ранее'
          : 'Пропущено фильтром';
        showToast(button, msg, 'skip');
      } else {
        button.classList.add('habr-md-btn--success');
        label.textContent = '✓';
        const file = result.result?.filename || result.result?.path?.split('/').pop() || 'файл .md';
        showToast(button, `Сохранено: ${file}`, 'success');
      }
    } catch (err) {
      button.classList.remove('habr-md-btn--loading');
      button.classList.add('habr-md-btn--error');
      label.textContent = '!';
      button.title = err.message;
      showToast(button, err.message, 'error');
    } finally {
      setTimeout(() => {
        if (button.isConnected) resetButtonState(button);
      }, 3500);
    }
  }

  function removeButtons(selector) {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.habrMdBusy) return;
      el.remove();
    });
  }

  function removeAllButtons() {
    closeJoplinPanel();
    document.querySelectorAll('.habr-md-btn').forEach((el) => {
      if (!el.dataset.habrMdBusy) el.remove();
    });
    document.querySelectorAll('.habr-md-toast').forEach((el) => el.remove());
    document.querySelectorAll('.habr-md-host').forEach((host) => {
      if (!host.querySelector('.habr-md-btn[data-habr-md-busy]')) {
        host.classList.remove('habr-md-host');
      }
    });
  }

  function createDownloadButton(url, variant) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `habr-md-btn habr-md-btn--${variant}`;
    btn.dataset.url = url;
    btn.dataset.defaultTitle = 'Скачать в Markdown';
    btn.title = btn.dataset.defaultTitle;
    // Собираем иконку через DOM: линтеры магазинов флагуют любое присваивание innerHTML
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v2H5v-2z');
    svg.append(path);

    const label = document.createElement('span');
    label.className = 'habr-md-label';
    label.textContent = '.md';

    btn.append(svg, label);
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadUrl(btn.dataset.url || url, btn);
    });
    return btn;
  }

  function mountArticleButton(url) {
    if (!fabEnabled || !url) return;

    const host = document.querySelector('.tm-article-presenter__snippet')
      || document.querySelector('.tm-article-presenter__header .article-snippet')
      || document.querySelector('.tm-article-presenter__header')
      || document.querySelector('.tm-article-presenter');

    if (!host) return;

    host.classList.add('habr-md-host');
    mountJoplinButton(host, url, 'article');

    let btn = host.querySelector('.habr-md-btn--article:not(.habr-joplin-btn)');
    if (btn) {
      if (!btn.dataset.habrMdBusy) btn.dataset.url = url;
      return;
    }

    btn = createDownloadButton(url, 'article');
    host.insertBefore(btn, host.firstChild);
  }

  function getCardUrl(card) {
    if (!card) return null;
    const link = card.querySelector(
      'a.tm-title__link[href], a[data-article-link="true"][href], h2.tm-title a[href], a[href*="/articles/"], a[href*="/news/"], a[href*="/post/"]',
    );
    if (link) return normalizePublicationUrl(link.href);
    const id = card.id;
    if (id && /^\d+$/.test(id)) {
      return normalizePublicationUrl(`${location.origin}/ru/articles/${id}/`);
    }
    return null;
  }

  function mountJoplinButton(host, url, variant) {
    let button = host.querySelector('.habr-joplin-btn');
    if (button) {
      button.dataset.url = url;
      return;
    }
    button = document.createElement('button');
    button.type = 'button';
    button.className = `habr-md-btn habr-md-btn--${variant} habr-joplin-btn`;
    button.textContent = 'В Joplin';
    button.title = 'Сохранить статью в блокнот Joplin';
    button.dataset.url = url;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        openJoplinPanel(button);
      } catch (err) {
        showToast(button, err.message, 'error');
      }
    });
    host.insertBefore(button, host.firstChild);
  }

  function injectFeedButtons() {
    if (!fabEnabled || !isFeedPage()) return;

    document.querySelectorAll('article.tm-articles-list__item, .tm-articles-list__item').forEach((card) => {
      const url = getCardUrl(card);
      if (!url) return;

      const host = card.querySelector('.article-snippet') || card;
      host.classList.add('habr-md-host');
      mountJoplinButton(host, url, 'feed');

      let btn = host.querySelector('.habr-md-btn--feed:not(.habr-joplin-btn)');
      if (btn) {
        if (!btn.dataset.habrMdBusy) btn.dataset.url = url;
        return;
      }

      btn = createDownloadButton(url, 'feed');
      host.insertBefore(btn, host.firstChild);
    });
  }

  function syncUi() {
    if (!fabEnabled) return;

    const pathChanged = location.pathname !== lastPath;
    if (pathChanged) {
      lastPath = location.pathname;
      removeAllButtons();
    }

    if (isFeedPage()) {
      removeButtons('.habr-md-btn--article');
      injectFeedButtons();
      return;
    }

    removeButtons('.habr-md-btn--feed');

    const url = getPublicationUrlFromPage();
    if (url && document.querySelector('.tm-article-presenter, .post__body')) {
      mountArticleButton(url);
    } else {
      removeButtons('.habr-md-btn--article');
    }
  }

  function isRelevantMutation(mutations) {
    for (const mutation of mutations) {
      if (isOurNode(mutation.target)) continue;

      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1 || isOurNode(node)) continue;
        if (node.matches?.('.tm-articles-list__item, .tm-article-presenter, .tm-articles-list, .article-snippet')) {
          return true;
        }
        if (node.querySelector?.('.tm-articles-list__item, .tm-article-presenter')) return true;
      }
    }
    return false;
  }

  function watchRouteChanges() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function pushStatePatched(...args) {
      origPush.apply(this, args);
      scheduleSync(0);
    };

    history.replaceState = function replaceStatePatched(...args) {
      origReplace.apply(this, args);
      scheduleSync(0);
    };

    window.addEventListener('popstate', () => scheduleSync(0));
  }

  function watchDomChanges() {
    if (feedObserver) feedObserver.disconnect();

    const root = document.querySelector('.tm-layout, main.tm-layout__container, body');

    feedObserver = new MutationObserver((mutations) => {
      if (!isRelevantMutation(mutations)) return;
      scheduleSync();
    });

    feedObserver.observe(root, { childList: true, subtree: true });
  }

  chrome.storage.local.get(['showFloatingButton']).then((data) => {
    fabEnabled = data.showFloatingButton !== false;
    syncUi();
    watchRouteChanges();
    watchDomChanges();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('showFloatingButton' in changes)) return;
    fabEnabled = changes.showFloatingButton.newValue !== false;
    if (!fabEnabled) removeAllButtons();
    else syncUi();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_ARTICLE') {
      const url = getPublicationUrlFromPage() || location.href;
      sendResponse(HabrParser.extractPublicationFromDocument(document, url, {
        includeComments: message.includeComments !== false,
      }));
    }
    return false;
  });
})();
