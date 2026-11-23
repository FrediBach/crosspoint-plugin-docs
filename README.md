# CrossPoint SD Plugins: The Complete Guide

A practical, example-driven guide to building plugins for
[CrossPoint Reader](https://github.com/crosspoint-reader/crosspoint-reader)
e-reader firmware.

The official docs (`docs/sd-plugins.md`, `docs/plugin-events.md`,
`docs/webserver-endpoints.md` in the firmware repo) are accurate, but they are
written for firmware developers. They spread one topic over several files and
leave out details you only find in the source. This guide was put together by
reading the firmware source (the `develop` branch). Where the official docs and
the code disagree, this guide follows the code and says so.

---

## What is a CrossPoint plugin?

A plugin is **a folder on the SD card**. You never rebuild firmware. Copy the
folder onto the card and the reader finds it.

```
/plugins/my-plugin/
├── manifest.json   ← name, version, where the web UI shows it        (optional)
├── plugin.js       ← JavaScript that runs in your BROWSER             (optional)
├── device.json     ← declarative catalog/events that run ON THE READER (optional)
├── README.md       ← help text shown on the reader                    (optional)
└── ...anything else (icons, config.json, token.json, extra JS)
```

A folder counts as a plugin if it has **at least one** of `manifest.json`,
`plugin.js` or `device.json`.

## The mental model: two places code can run

```
┌──────────────────────────────┐          ┌──────────────────────────────────┐
│  Your phone / laptop browser │   Wi-Fi  │         The e-reader             │
│                              │ ◄──────► │                                  │
│  plugin.js                   │          │  device.json  (no code, only     │
│  • real JavaScript           │          │   declarative JSON config)       │
│  • any UI, any logic         │          │  • browse a JSON/XML catalog     │
│  • reaches the internet      │          │  • sign in (device code/password)│
│    THROUGH the reader        │          │  • download books/files to SD    │
│    (/api/relay, /api/fetch)  │          │  • react to events (book closed, │
│  • only runs while a browser │          │    going to sleep...) with HTTP  │
│    page is open              │          │    requests                      │
└──────────────────────────────┘          └──────────────────────────────────┘
                 ▲                                          ▲
                 └──────── they share files on the SD ──────┘
                     (config.json, token.json, sidecars)
```

The most common pattern combines the two:
**`plugin.js` is the settings page** (enter a server URL, sign in, save a
token), and **`device.json` does the daily work on the reader** (browse,
download, sync). They talk to each other only through files in the plugin
folder.

## Which one do I need?

| I want to... | Use |
|---|---|
| Browse a library/catalog and download books **on the reader**, no phone needed | `device.json` catalog |
| Send something to a server when a book is closed / the reader sleeps | `device.json` `events` |
| Fetch a fresh sleep-screen image every night | `device.json` `events` → `sleep.enter` download |
| A settings form, sign-in page, or any custom UI | `plugin.js` |
| Convert formats (HTML→EPUB), sign requests (OAuth 1.0a), scrape HTML | `plugin.js` |
| Tools that work on files already on the SD card (rename, organise) | `plugin.js` with `"mount": "files"` |
| Let a script or app on another computer trigger plugin actions | `plugin.js` + job queue |

Rule of thumb from the firmware authors: *if the service is "log in, list a
JSON/XML catalog, download files", put it on the device. If it needs computed
request bodies or format conversion, do it in the browser.*

---

## Table of contents

### Learn
1. [Getting started](docs/01-getting-started.md): enable plugins, folder layout, your first three plugins in 5 minutes
2. [`manifest.json` reference](docs/02-manifest.md)
3. [Browser plugins (`plugin.js`)](docs/03-browser-plugins.md): the full `api` object, host pages, device endpoints
4. [On-device catalogs (`device.json`)](docs/04-device-catalogs.md): browse, paging, lists, search, auth, download, bundles
5. [Events and book sidecars](docs/05-events-and-sidecars.md): react to reading, sleep and downloads
6. [The job queue](docs/06-job-queue.md): trigger plugin actions from outside the browser

### Build (tutorials)
- [Tutorial 1: A settings page that saves config](docs/tutorials/01-settings-page.md)
- [Tutorial 2: Your own book shelf (static JSON catalog)](docs/tutorials/02-static-catalog.md)
- [Tutorial 3: Signed-in server catalog (password grant + web setup)](docs/tutorials/03-authenticated-catalog.md)
- [Tutorial 4: Reading webhooks and a daily sleep image (events)](docs/tutorials/04-events.md)
- [Tutorial 5: A File Manager tool](docs/tutorials/05-file-manager-tool.md)
- [Tutorial 6: Remote control with the job queue](docs/tutorials/06-job-queue.md)
- [Tutorial 7: Your own plugin/asset store (bundle installs)](docs/tutorials/07-bundle-store.md)

### Reference
- [Limits, gotchas and debugging](docs/07-limits-and-gotchas.md)
- [Publishing to Plugin Hub](docs/08-publishing.md)
- [What the official docs leave out](docs/09-undocumented.md): features and behavior found only in the source, with file references
