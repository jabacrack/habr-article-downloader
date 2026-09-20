# Firefox source submission - version {{VERSION}}

## Requirements

Windows with Windows PowerShell 5.1 and the built-in .NET Framework compression libraries. No npm dependencies, network connection, API keys, environment variables or credentials are needed to build the Firefox extension.

## Build

Extract the source ZIP into an empty directory. Open PowerShell in that directory (the directory containing this file), then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-firefox.ps1
```

Output: `dist/habr-article-downloader-{{VERSION}}-firefox.zip`.

The version and extension name come from `extension/manifest.json`.

## Processing performed

The script copies files from `extension/` into the ZIP without modifying their contents, except for `manifest.json`:

- Removes `background.service_worker` and keeps the Firefox background script list.
- Removes `lib/dom-shim.js` from that list. Firefox uses its native DOM implementation.
- Adds the Gecko ID, minimum versions and data collection declarations.
- Sets `incognito` to `not_allowed` because the download journal persists locally.

The script excludes `lib/dom-shim.js` and `icons/icon.svg` from the package and includes the root `LICENSE`. No application JavaScript, HTML or CSS is generated, minified, transpiled or combined during this build. The readable Turndown and turndown-plugin-gfm files are included in `extension/lib/` and copied unchanged; rebuilding those libraries is not part of this packaging process. The Chrome-only DOM shim is included in this source snapshot for completeness but is not part of the Firefox output.

ZIP timestamps and JSON object property order can differ between builds. Compare the extracted files byte-for-byte, with `manifest.json` compared as parsed JSON ignoring object key order. Array order must remain unchanged.

## Optional automated tests

With Node.js 24 installed, run:

```powershell
node --test tests/*.test.cjs
```

Node.js is only needed for tests, not for building the package. Test files are not shipped in the extension ZIP.

## Manual review

Load the built ZIP as a temporary add-on using Firefox `about:debugging`. Test downloading a public Habr article, batch downloads and the watch settings. Optional Joplin support requires Joplin Desktop with Web Clipper enabled and authorization approved in Joplin. See `docs/amo-reviewer-notes.txt` for details.
