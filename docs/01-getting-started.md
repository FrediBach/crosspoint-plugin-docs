# 1. Getting started

## 1.1 Turn plugins on

Plugins are **off by default** on a fresh install.

On the reader: **Settings → Connectivity → Plugins → Enabled**.

- A **Plugins** entry now appears on the Home screen, even with no plugins installed.
- Turning plugins off later deletes nothing. Your plugin folders, tokens and
  settings stay on the card and come back when you turn plugins on again.
- After a firmware upgrade, plugins stay enabled if plugin folders already exist.
- While plugins are off, every plugin endpoint (`/api/relay`, `/api/fetch`,
  `/plugins-run`, ...) answers `403 plugin system disabled`.

## 1.2 Where plugin folders go

The firmware scans three root folders on the SD card, in this order:

| Root | Notes |
|---|---|
| `/.crosspoint/plugins/` | The original location. Hidden on most computers because it starts with a dot. |
| `/plugins/` | Easiest one to use when copying from a computer. |
| `/.plugins/` | Hidden alternative. |

Rules:

- Only **direct child folders** of a root are plugins: `/plugins/my-plugin/`.
  Folders nested deeper are not.
- A folder whose name **starts with a dot** is skipped.
- If the same folder name exists in two roots, **the earlier root wins** and the
  other copy is ignored completely.
- The **folder name is the plugin's identity** (`api.name`, the job-queue
  `plugin` name, the Plugin Hub `id`). Use lowercase letters, digits and
  hyphens, and keep it **at most 23 bytes**, because event subscriptions are refused
  for longer names. The full path, root included, must also fit in 63 bytes.
- A folder with a `.installing` file inside is hidden. The installer uses this
  marker while an install is in progress. If an install was interrupted, delete the
  marker by hand.

## 1.3 What the reader shows

**Home → Plugins** lists every plugin with its `title` and `description`
(taken from `manifest.json`, with `device.json` values winning if both are
present). If no title is set, the folder name is used. Plugin Hub is always listed
first, and the other plugins are sorted by title.

What happens when you select a plugin:

| Plugin has... | Selecting it... | Row subtitle |
|---|---|---|
| `device.json` with `browse.url` | opens the catalog | its `description` |
| `device.json` with only `events` | shows `README.md` if present, otherwise nothing | events it receives + `description` |
| no `device.json` | shows `README.md` if present, otherwise nothing | "Web-only plugin" |

- The README is shown as **plain paged text** (Markdown is not rendered), up
  to **16 KB**. Write it so it reads well as plain text.
- If a plugin subscribes to events, the reader adds a line like *"Receives: Book
  opened, Sleep"* in front of the description. This tells the user what activity
  the plugin can send off the device.
- **Long-press Confirm (1 second), or long-press the row on touch devices,
  to uninstall a plugin.** After a confirmation, the whole folder is deleted,
  including tokens and config.

## 1.4 What the web UI shows

Put the reader in **File Transfer** mode (it starts a web server) and open
`http://crosspoint.local/` (or the IP address shown on screen).

- **`/plugins`** (the "Plugins" page): one card per installed plugin.
  Plugins with `plugin.js` and `"mount": "settings"` (the default) render their
  UI here. Other plugins get a small info card (title, version, author).
- **`/files`** (the File Manager): plugins with `"mount": "files"` render
  below the file list.
- **`/plugins-run`**: a hidden runner page for the job queue (see chapter 6).

---

## 1.5 Your first plugin: README only (1 minute)

This plugin has no code. It shows that discovery works.

`/plugins/hello-readme/manifest.json`
```json
{
  "title": "Hello Plugin",
  "description": "My very first CrossPoint plugin."
}
```

`/plugins/hello-readme/README.md`
```
HELLO PLUGIN

If you can read this on your e-reader, plugin discovery works.

Next steps:
- add a plugin.js for a web page
- add a device.json for an on-device catalog
```

Copy the folder to the card, open **Home → Plugins**, and select "Hello Plugin".
The README opens.

## 1.6 Your second plugin: a browser page (3 minutes)

`/plugins/hello-web/manifest.json`
```json
{
  "title": "Hello Web",
  "description": "Shows device info in the browser.",
  "version": "1.0.0"
}
```

`/plugins/hello-web/plugin.js`
```js
// registerPlugin MUST be called synchronously when the script runs.
CrossPoint.registerPlugin(async (container, api) => {
  container.innerHTML = '<h2>Hello Web</h2><p id="hw-out">Loading…</p>';
  const out = container.querySelector('#hw-out');

  // Same-origin device endpoints are plain fetch() calls.
  const status = await (await fetch('/api/status')).json();
  out.textContent =
    `Firmware ${status.version} on ${status.device}, ` +
    `free heap ${status.freeHeap} bytes. I live in ${api.dir}.`;
});
```

Upload the folder (File Manager → create `/plugins/hello-web/`, upload both
files), then open `/plugins`. Your card appears.

> **Note:** always look up elements with `container.querySelector(...)` instead
> of `document.getElementById(...)`. Every plugin shares one page, so IDs can
> clash with other plugins. If you do use IDs, prefix them (`hw-out`).

## 1.7 Your third plugin: an on-device catalog (5 minutes)

You need a JSON file reachable over HTTPS. A GitHub Gist ("Raw" link), a
GitHub repo, or any static web host works.

`books.json` (hosted somewhere):
```json
{
  "books": [
    { "title": "My First Book",  "author": "Me",  "file": "https://example.com/books/first.epub" },
    { "title": "My Second Book", "author": "You", "file": "https://example.com/books/second.epub" }
  ]
}
```

`/plugins/hello-shelf/device.json`
```json
{
  "title": "Hello Shelf",
  "description": "Books from my own JSON file.",
  "browse": {
    "url": "https://gist.githubusercontent.com/<you>/<id>/raw/books.json",
    "items": "books",
    "fields": { "title": "title", "author": "author", "url": "file" }
  },
  "download": {
    "url": "{url}",
    "dest_dir": "/Books/Hello Shelf",
    "filename": "{title}.epub"
  }
}
```

On the reader: **Home → Plugins → Hello Shelf**. The reader joins Wi-Fi, lists
the two books, and selecting one downloads it to `/Books/Hello Shelf/`.

What each line does:

- `browse.items: "books"`: the array of rows is at `response.books`.
- `fields`: for every row, which property holds the title, author and URL.
- `download.url: "{url}"`: download the file whose URL the row's `url`
  field holds.
- `filename`: `{title}` is the row's title. The name is sanitized and cut to
  100 bytes.

[Tutorial 2](tutorials/02-static-catalog.md) builds this into a full shelf with
lists and a details screen.

---

## 1.8 Development loop

1. Edit files on your computer.
2. Upload them through the File Manager (`/files`). You don't need to remove the card.
   - `plugin.js` changes: reload `/plugins`. Files are served with an ETag and
     `Cache-Control: no-cache`, so the browser always picks up the new version.
   - `device.json` catalog changes: take effect the next time you open the
     catalog. It is re-read every time.
   - `device.json` **events** changes: take effect after you leave File Transfer
     mode, open Home → Plugins, toggle the Plugins setting, or restart.
3. Watch the serial log over USB (for example `pio device monitor`). Tags: `[PCAT]` catalog,
   `[PEVT]` events, `[PHTP]` plugin HTTP/files, `[WEB]` web endpoints.

Continue with [`manifest.json`](02-manifest.md).
