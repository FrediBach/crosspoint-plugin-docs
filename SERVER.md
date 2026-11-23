# Docs server and reader plugin

A small Node server (no dependencies) that serves this guide in two ways:

- **On the e-reader**, as a `device.json` XML catalog: folders inside folders,
  and every page is a short plain-text file (at most 1.5 KB of text, about one screen).
- **In a browser**, as a minimal website with the same tree and install instructions.

```
Overview / Learn / Tutorials / Examples / Reference
  └─ chapter (one .md file)
       └─ section (## heading)
            └─ pages (### headings, cut into one-screen parts)
```

The pages are built from `README.md`, `docs/` and `examples/` when the server
starts, so edits to the docs show up after a restart or a new deploy.

## Run it locally

```sh
npm start          # http://localhost:3000/
npm test           # walks the whole catalog and checks the reader's limits
```

Node 22 or newer. To try it on a reader on your network, start it with
`PUBLIC_URL=http://<your computer's LAN IP>:3000 npm start` and install the
plugin from that address.

## Deploy to Vercel

```sh
vercel            # preview
vercel --prod     # production
```

`vercel.json` sends every path to `api/index.js`. Set the `PUBLIC_URL`
environment variable to your production domain so the plugin files always point
there. Without it, the server uses the host of each request, which also works
for previews.

## Install the plugin

Open the site, download `plugin-docs.zip`, and copy the `plugin-docs/` folder to
`/plugins/` on the SD card. Then open **Home → Plugins → Plugin Docs**.

## Routes

| Path | What |
|---|---|
| `/` | Install page |
| `/docs/...` | The tree for browsers |
| `/cat/index.xml`, `/cat/.../index.xml` | Reader catalog folders |
| `/cat/....txt` | One page, as the reader downloads it |
| `/plugin/device.json`, `manifest.json`, `README.md`, `plugin-docs.zip` | The plugin, with this server's URL filled in |

## Why it looks the way it does

These rules come from the firmware (see [chapter 4.11](docs/04-device-catalogs.md)):

- An XML catalog lists **folders first, then A to Z**, and can't be told
  otherwise. So every title starts with a number, and the children of one folder
  are either all folders or all pages.
- The reader shows `.txt` as typed. Paragraphs are joined into single lines,
  tables become `label: value` lines, and arrows and box drawing become ASCII.
- A picked page is **downloaded** to `/Books/Plugin Docs`, not shown in place
  (XML catalogs have no Details screen). File names start with the page's position
  (`2.04.05.02 Encoding rules.txt`) so the Library lists them in reading order.
  Each chapter also has a *Whole chapter in one file* page.
- Titles and subtitles in the XML never need entities (`&`, `<`, `>`, `"` are
  rewritten), because it isn't verified that the reader's XML parser decodes them.
