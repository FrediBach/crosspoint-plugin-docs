# Example plugins

Eleven plugins, each a good starting point for a different kind of CrossPoint
plugin. Each folder in [`plugins/`](plugins/) is a **complete plugin**. Copy it to
`/plugins/` on the SD card (or upload it through the web File Manager) and it
shows up under **Home → Plugins** and on the web **Plugins** page.

[`companions/`](companions/) holds the computer-side helpers: test servers,
catalog generators, scripts. They are **not** copied to the reader.

## Pick a starting point

| Example | Kind | Runs on | Shows | Companion |
|---|---|---|---|---|
| [`web-settings`](plugins/web-settings/) | Settings page only | browser | `FIELDS`-driven form → flat `config.json`, `api.relay` test, native styles | none |
| [`static-catalog`](plugins/static-catalog/) | Catalog, no login | reader | JSON file you host, local paging, lists, Details screen, sidecar | [`make_catalog.py`](companions/static-catalog/make_catalog.py), sample [`all.json`](companions/static-catalog/all.json) |
| [`nested-catalog`](plugins/nested-catalog/) | Catalog with folders inside folders, no login | reader | static `index.xml` per folder, unlimited depth, relative links, original file names | [`make_nested_catalog.py`](companions/nested-catalog/make_nested_catalog.py) |
| [`password-catalog`](plugins/password-catalog/) | Catalog with username/password | both | `auth.type: password`, auto re-login on 401, `lists_url`, search, offset paging, download hop, capability check | [`mock_library.py`](companions/password-catalog/mock_library.py) |
| [`device-code-catalog`](plugins/device-code-catalog/) | Catalog with QR sign-in | both | OAuth device-code flow on the reader **and** in the browser, shared `token.json` | [`mock_device_auth.py`](companions/device-code-catalog/mock_device_auth.py) |
| [`webdav-browser`](plugins/webdav-browser/) | XML folder browser | both | `format: xml`, PROPFIND, folders, extension filter, Basic auth computed in JS | any WebDAV server |
| [`event-webhooks`](plugins/event-webhooks/) | Background events | reader | all five events, `connect`, `toast`, sleep-image download, test delivery from the web page | [`hook_receiver.py`](companions/event-webhooks/hook_receiver.py), [`make_sleep.py`](companions/event-webhooks/make_sleep.py) |
| [`file-tool`](plugins/file-tool/) | File Manager tool | browser | `mount: files`, `/api/files`, `/mkdir`, `/move`, safe scanning | none |
| [`job-runner`](plugins/job-runner/) | Remote-controlled action | browser | `api.registerAction`, `fetchToSd`, sidecar from JS | [`send-to-reader.sh`](companions/job-runner/send-to-reader.sh) |
| [`bundle-store`](plugins/bundle-store/) | Plugin/asset store | reader | multi-file `bundle` installs, version badges, compatibility filter | [`build_store.py`](companions/bundle-store/build_store.py), generated [`store.json`](companions/bundle-store/store.json) |
| [`text-adventures`](plugins/text-adventures/) | Interactive app on the catalog screen (**experimental**) | both | a game loop out of catalog parts: Search as a command line, `details_url` HTML pages that run commands, dynamic `lists_url`, `{cfg.*}`, Fetch for a transcript | [`server.js`](companions/text-adventures/server.js) with a small Z-machine interpreter, [`zmachine.js`](companions/text-adventures/zmachine.js) |

"Runs on": **reader** = `device.json` only, **browser** = `plugin.js` only,
**both** = a web setup page plus an on-device catalog sharing `config.json`/`token.json`.

## Making one your own

1. Copy the folder and **rename it**. The folder name is the plugin id:
   lowercase letters, digits and hyphens, ≤ 23 characters.
2. Update `manifest.json`: `name` (= folder name), `title`, `description`, `version`.
   If `device.json` has a `title`/`description`/`version`, change those too (they win on the reader).
3. Replace the `YOU/YOUR-REPO` URLs and example endpoints.
4. Rename the sidecar key to your own namespace (`staticcat_id` → `myservice_id`).
5. Keep `device.json` under 8 KB: `wc -c device.json`.

## Trying the server examples locally

The test servers use only the Python standard library (3.9+), except `text-adventures`, which is plain Node 22+ (no packages).

```sh
# password-catalog: login reader / secret, put some .epub files in ./books
cd examples/companions/password-catalog && mkdir -p books && python3 mock_library.py      # :8080

# device-code-catalog: open the printed /activate page on your phone to approve
cd examples/companions/device-code-catalog && python3 mock_device_auth.py                # :8081

# event-webhooks: use the same secret on the plugin's web page; put a sleep.bmp next to it
cd examples/companions/event-webhooks && HOOK_SECRET=s3cret python3 hook_receiver.py      # :8090
```

```sh
# text-adventures: downloads four freeware games from the IF Archive, then serves them
cd examples/companions/text-adventures && ./fetch-games.sh && node server.js                # :8095
```

On the plugin's web page, enter `http://<your computer's LAN IP>:<port>`.

```sh
# job-runner: with the reader in File Transfer mode and /plugins-run open in a browser
READER=http://crosspoint.local ./examples/companions/job-runner/send-to-reader.sh https://example.com/book.epub

# bundle-store: build a catalog of these examples (pin BASE_URL to a tag for real releases)
python3 examples/companions/bundle-store/build_store.py examples/plugins \
  https://raw.githubusercontent.com/YOU/YOUR-REPO/main/examples/plugins > store.json
```

## What was tested

- All JSON is valid. Every `device.json` is under 2 KB, and every `manifest.json`
  `name` matches its folder and lists files that exist.
- All `plugin.js` files ran in headless Chrome against the firmware's real
  `plugin-host.js`, using a fake device server that implements `/api/plugins`,
  `/plugin`, `/api/plugin-fs`, `/api/relay`, `/api/fetch`, `/api/files`,
  `/mkdir` and `/move`. Each plugin's main flow ran without console errors:
  saving settings, password and device-code sign-in against the mock servers,
  webhook test delivery, the job-runner download, and the file-tool scan and move.
- The mock servers were checked with the same requests the reader's
  `device.json` would send.
- The `nested-catalog` XML was parsed by the SDK's real `XmlListParser` (FreeInk
  SDK `main` branch), compiled on a computer and configured like the reader
  configures it. A driver opened every folder from the root and checked that
  every book link points to an existing file.
- The `text-adventures` interpreter passes the CZECH conformance suite (406/406) and
  Praxix (everything except multi-level undo, which it doesn't offer). The server
  was played with curl through the same URLs `device.json` builds, with
  Adventure, Lost Pig, 9:05 and Shade.
- **Not tested on a real e-reader.** The on-device behavior (catalog screens,
  events, bundle installs) follows the firmware source and the docs in
  [`../docs/`](../docs/), but hasn't been run on hardware. Please report what
  differs.

The tutorials in [`../docs/tutorials/`](../docs/tutorials/) walk through most of
these examples step by step.
