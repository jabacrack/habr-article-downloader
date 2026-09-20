# Публикация в Firefox Add-ons

Подготовлен выпуск 3.5.0 для Firefox Desktop 140+. Android пока не заявляем: интерфейс и интеграция с Joplin Desktop не проверены на телефоне.

## Пакет

Для подготовки полного комплекта используйте:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-firefox-release.ps1
```

В `dist/` создаются четыре файла с текущей версией из манифеста:

- `habr-article-downloader-<version>-firefox.zip` — расширение;
- `habr-article-downloader-<version>-firefox-sources.zip` — исходники для поля Source code;
- `habr-article-downloader-<version>-firefox-reviewer-notes.txt` — текст для Notes for Reviewers;
- `habr-article-downloader-<version>-firefox-build-instructions.md` — инструкция сборки, также включённая в исходники.

Windows PowerShell 5.1 достаточно; установка зависимостей и доступ в интернет не нужны. Команда работает из любой текущей папки, если указан правильный путь к скрипту. Исходный проект не изменяется, результаты той же версии перезаписываются. Тексты генерируются из `docs/templates/` с подстановкой `{{VERSION}}` и `{{NAME}}`; правьте эти шаблоны при изменении инструкций.

Перед выдачей результатов скрипт пересобирает расширение из созданного архива исходников и сверяет содержимое. Проверка не заменяет тесты, `web-ext lint` и ручную проверку в Firefox. Примеры версии ниже относятся к первоначально подготовленной карточке; для новой отправки используйте файлы и тексты с текущей версией из `dist/`.

Из корня проекта выполните:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-firefox.ps1
```

Загрузить в AMO: `dist/habr-article-downloader-3.5.0-firefox.zip`.
В корне архива находится manifest.json. Исходный Chrome-манифест не меняется.
Сборка удаляет service_worker и ненужный Firefox полифилл dom-shim.js, добавляет Gecko ID, минимальную версию, декларацию данных и запрещает приватные окна (журнал сохраняется локально).

ID: `habr-article-downloader@shydamn`. Сохраните его для следующих выпусков. Если расширение уже зарегистрировано в AMO с другим ID, перед сборкой замените ID в скрипте на существующий. При обновлении увеличивайте version в extension/manifest.json.

## Что сделать владельцу

1. Войти с Mozilla Account в https://addons.mozilla.org/developers/ и принять соглашение разработчика.
2. До отправки проверить пакет в Firefox: `about:debugging` → «Этот Firefox» → «Загрузить временное дополнение» → выбрать ZIP. При необходимости распаковать ZIP в отдельную папку и выбрать manifest.json. Разрешить доступ к habr.com, если Firefox его запрашивает.
3. Проверить скачивание статьи, таблицы/картинки в Markdown, пакет из двух URL, слежение, настройки после перезапуска, контекстное меню. Отдельно проверить Joplin: разрешение localhost, подтверждение в Joplin Desktop, выбор блокнота и сохранение с комментариями. Проверить персональную ленту со своим Habr-аккаунтом; пароль никому не передавать.
4. Сделать 2–3 скриншота реального интерфейса: кнопки на Habr, вкладка пакета/слежения, панель Joplin. Скрыть личные данные. Это материалы карточки, в ZIP они не нужны.
5. В Developer Hub выбрать Submit a New Add-on → On this site, загрузить ZIP и выбрать Firefox Desktop. Проверить результаты валидатора.
6. Заполнить карточку текстами ниже, указать свой контакт поддержки, выбрать MIT, приложить политику конфиденциальности из docs/privacy-policy.html. Текст политики можно вставить в форму AMO; если нужен отдельный URL, сначала опубликовать страницу на доступном вам сайте.
7. Проверить декларацию передачи данных и Notes for Reviewers. Нажать Submit Version, следить за письмами Mozilla и отвечать на вопросы проверки.

API-ключи для ручной публикации не нужны. ZIP до подписи Mozilla предназначен для отправки в магазин и временной установки, а не обычной постоянной установки.

## Тексты карточки

**Название:** Habr Article Downloader (with Joplin support)

**Кратко:** Сохраняйте статьи, посты и новости Habr в Markdown или локальный Joplin — по одной, списком и по расписанию.

**Описание:**

Сохраняйте публикации Habr в Markdown с метаданными, таблицами, ссылками и форматированием. Кнопки на странице и в ленте помогают сохранить материал в один клик. Есть пакетная загрузка по списку ссылок, слежение за лентами и хабами, фильтры и защита от повторных скачиваний.

Дополнительно можно отправить статью в Joplin Desktop: включите службу Web Clipper в Joplin, подключите её в настройках расширения и выберите блокнот. Эта функция требует установленного Joplin Desktop.

Обработка Markdown и хранение настроек выполняются локально. Расширение запрашивает страницы и ленты у Habr, используя существующую сессию для персональных лент; при локальном сохранении картинок обращается к их хостингам. При включённой интеграции выбранная статья, её заголовок и URL передаются локальному Joplin. Аналитики и сервера разработчика нет.

Независимый проект, не связанный с администрацией Habr. Файлы сохраняются в папку загрузок браузера. Комментарии доступны в пределах данных, полученных от Habr.

**Лицензия:** MIT.

**Поддержка:** https://github.com/ShyDamn/habr-article-downloader/issues

**Иконка:** extension/icons/icon128.png.

## Notes for Reviewers (English)

This is a Firefox Desktop Manifest V3 extension. The background uses an event page and native DOMParser. There is no remote executable code, telemetry or developer backend. Source files in this Firefox package are readable JavaScript; no transpilation or minification step is used for this package. Turndown and turndown-plugin-gfm are bundled in lib/. The Chrome-only bundled DOM shim is excluded.

To test, open a public Habr article and click the .md button, or use the popup batch tab with public Habr article URLs. Personalized feeds require the user's own Habr login; public article downloads do not. Optional Joplin support requires Joplin Desktop with its Web Clipper service enabled: connect in the extension settings, grant localhost access, approve in Joplin, then select a notebook and save an article. The localhost token is kept in local extension storage and excluded from settings exports.

Data declarations cover website content and source URLs sent to local Joplin, requested Habr URLs and authenticated requests using the existing Habr session, plus the local Joplin token. No browser-wide history is read or uploaded. Image downloads may contact image hosts. Private browsing is disabled because the duplicate-prevention journal persists locally.

The package is produced by scripts/package-firefox.ps1: it copies extension files, omits lib/dom-shim.js and icons/icon.svg, removes background.service_worker and the DOM shim from background.scripts, adds Firefox metadata and LICENSE. The remaining application JavaScript is copied unchanged. If a source archive is requested, provide the exact corresponding repository snapshot with this script and its instructions, excluding .git, local archives and credentials.

## Официальные инструкции

- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/

Локальные автоматические тесты и lint не заменяют ручную проверку в Firefox и решение модерации AMO.
