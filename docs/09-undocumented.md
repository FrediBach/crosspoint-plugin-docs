# 9. What the official docs leave out

These findings come from reading the firmware source (`develop` branch, copy in
[`crosspoint-reader-develop/`](../crosspoint-reader-develop/)). Each item says
where to look, so you can check it again when the firmware changes.

## Features with no official documentation

| Finding | Where in the source |
|---|---|
| **Catalog search**: `browse.search.url` / `browse.search.body`, `{query}` / `{query_raw}`, a Search action on the top row, JSON only | `src/activities/plugins/PluginCatalogActivity.cpp` (`loadManifest`, `performSearch`, `activeBrowseUrl`) |
| **Bundle installs**: `download.bundle.{base, files, subdir}` (field paths, `subdir` defaults to `{id}`), staged `.new` files, rollback, in-place update across roots | `PluginCatalogActivity.cpp` (`downloadBundle`), `src/util/PluginLocations.h` (`shouldReuseInstalledBundleDir`) |
| **`api.pluginFile(file)`**: URL for a file in the plugin folder; also `api.name` | `src/network/html/js/plugin-host.js` (`render`) |
| **Uninstall from the reader**: long-press Confirm (1 s) or long-press the row in Home → Plugins deletes the folder and its notice acknowledgements | `PluginCatalogActivity.cpp` (`confirmUninstallPlugin`, `PLUGIN_UNINSTALL_HOLD_MS`) |
| **Config key `dest_dir`** overrides `download.dest_dir` (described only in a comment in the schema) | `PluginCatalogActivity.cpp` (`downloadDir`) |
| A **relative `dest_dir`** resolves inside the plugin folder | `loadManifest` → `pluginhttp::inPluginDir` |
| `token.path` defaults to `"token"`; the device writes nested JSON following the path | `src/util/PluginHttp.cpp` (`saveTokenToFile`) |
| `config.json` values: only strings and whole numbers work (booleans and decimals → empty) | `PluginHttp.cpp` (`variantToString`, `loadConfigFile`) |
| Defaults: `filename` = `{title}.epub`; XML `download.url` = `{url}`; JSON `fields.title` = `"title"`; XML has no title default | `loadManifest` |
| `auth.request` / `auth.poll` methods default to POST; `{device_code}` is substituted in poll URL and body (not headers); minimum poll interval 3 s; minimum lifetime 60 s | `beginAuth`, `pollAuth` |
| XML rows are sorted folders first, then A–Z | `parseXmlList` |
| Version-tracked static catalogs list **updates first** | `parseUpdateFirstBrowseResponse` |
| Items are matched for Details by `id`, or by title+version without ids | `loadItemDetails` |
| The `/plugins` page sorts Plugin Hub first, then by title; non-settings plugins get an info card with version/author | `plugin-host.js` (`loadPlugins`) |
| `/plugins-run` renders **all** plugins (any `mount`) into a hidden container and reloads itself every 10 s on failure | `src/network/html/RunnerPage.html` |
| The File Manager preloads JSZip **before the first plugin**, only on `/files` | `src/network/html/FilesPage.html` (`ensureJszip`) |
| Job results ≥ 192 bytes are replaced by `{"error":"result too large"}` while the state stays `done` | `src/network/CrossPointWebServer.cpp` (`handlePluginJobComplete`) |
| Job action names may only contain `A-Z a-z 0-9 _ - .` | `handlePluginJobSubmit` (`identifierSafe`) |
| The executor polls every 2.5 s; a 4xx on completion is dropped, a 5xx is retried | `plugin-host.js` (`registerAction`, `_sendCompletion`) |
| `/api/plugin-fs` creates missing parent folders | `handlePluginFsUpload` |
| `/plugin?name=&file=` serves `.js .css .html .json .svg` with types, everything else as octet-stream; single path component only | `handlePluginFile`, `pluginContentType` |
| `/download` refuses only paths whose **last** component starts with `.`, so `/.crosspoint/plugins/x/token.json` is readable | `handleDownload` |
| Plugin folders whose names start with `.` are skipped by discovery | `src/util/PluginLocations.cpp` (`scanPluginsOnDisk`) |
| Plugin HTTP timeout is 30 s | `PluginHttp.cpp` |
| Bundle file GETs are sent without `download.headers` | `downloadBundle` → `downloadFile(url, dest)` |

## Places where the official docs are outdated or misleading

| Official docs say | Source says |
|---|---|
| "A plugin installed mid-session starts receiving events after the next restart" (`plugin-events.md`) | Subscriptions are also rebuilt when Home → Plugins opens, when File Transfer ends, when the Plugins setting changes, and after a bundle install (`refreshSubscriptions()` call sites in `PluginCatalogActivity.cpp`, `CrossPointWebServerActivity.cpp`, `SettingsActivity.cpp`, `main.cpp`). |
| Use `crypto.subtle` for request signing (`sd-plugins.md` ideas) | The web UI is served over plain HTTP, where browsers don't provide `crypto.subtle`. Use `api.crypto` or a bundled JS implementation. |
| Plugin Hub's `docs/firmware-plugin-api.md`: relay cap ~32 KB, `fetchToSd` doesn't follow redirects, `{limit}` is always `page_size + 1` | Firmware: relay cap **64 KB** (`RELAY_BODY_LIMIT`); `/api/fetch` GET follows **5 redirects**; `{limit}` equals `page_size` when the request uses both `{page}` and `{limit}` (`PluginCatalogPaging.h`). |
| `webserver-endpoints.md` example capability list stops at `catalog.list_index_mapping` | `src/util/FirmwareIdentity.h` also advertises `catalog.list_requirements` and `catalog.server_paths`. |

## Things that are unclear or that I could not verify

- `JsonListParser` and `XmlListParser` (the streaming parsers) live in the FreeInk
  SDK, which is not included in this copy. How the `bundle.files` array and XML
  selectors behave with unusual input (mixed types, several matching `<link>` elements)
  was inferred from the call sites, not read directly.
- Whether plain `http://` URLs work for every request type depends on the SDK's
  `SecureHttpClient`. LAN plugins such as WebDAV rely on it, but test it on your
  device.
- Behavior on boards other than the ESP32-C3 X3/X4 (more RAM, touch) may differ in
  limits not listed here.
