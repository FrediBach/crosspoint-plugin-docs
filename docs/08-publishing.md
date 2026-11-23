# 8. Publishing to Plugin Hub

You don't need to publish anything: a sideloaded folder works. To make a plugin
installable from the reader for everyone, publish it so **Plugin Hub** picks it
up. Plugin Hub is itself an on-device bundle store (see
[Tutorial 7](tutorials/07-bundle-store.md)).

The authoritative rules are in the Hub repo:
<https://github.com/crosspoint-reader/crosspoint-plugin-hub> →
`PLUGIN_HUB_CONTRACT.md`. Here's a summary as of November 2026.

## Repository layout

One public GitHub repo per plugin, with **exactly one** direct-child folder ending in
`.crosspoint-plugin`:

```
my-plugin-repo/
├── README.md                     ← for developers (not installed)
├── tests/ tools/ .github/        ← not installed
└── my-plugin.crosspoint-plugin/  ← the payload; stem == manifest "name"
    ├── manifest.json             ← REQUIRED
    ├── device.json and/or plugin.js   ← at least one REQUIRED
    ├── README.md                 ← recommended (shown on the reader for non-catalog plugins)
    ├── DETAILS.md                ← optional; rendered on the Hub's Details page
    └── assets/icon.png …         ← optional, list in "files"
```

## `manifest.json` for the Hub

```json
{
  "name": "my-plugin",
  "title": "My Plugin",
  "description": "What it does, in one line.",
  "author": "Your Name",
  "version": "1.2.0",
  "compatibility": { "firmware_family": ["crosspoint"], "plugin_api_min": 1 },
  "files": ["manifest.json", "device.json", "plugin.js", "README.md", "DETAILS.md"]
}
```

- `name`: lowercase letters, digits, hyphens; equals the folder stem.
- `version`: `MAJOR.MINOR.PATCH`.
- `files`: paths relative to the payload folder. Without it, the Hub only installs
  `manifest.json`, `device.json`, `plugin.js`, `README.md` (whichever exist), so
  anything else (extra JS, `DETAILS.md`) must be listed.
- `compatibility`: only for **real** requirements. For example, add
  `"requires": ["catalog.server_paths"]` if your `device.json` depends on that
  firmware feature.

## Releases

- Create a **non-draft, non-prerelease GitHub Release** whose tag matches the
  version (`1.2.0` or `v1.2.0`).
- Add the GitHub topic **`crosspoint-plugin`** to the repo.
- The Hub builds its catalog from releases and pins installs to the release tag,
  so every version's files are immutable.

## Before you release

- Test a **fresh install** *and* an **update over an older version** (files you
  dropped stay on the card. Bundle installs never delete files).
- Never ship `config.json` or `token.json`. Those belong to the user. Because
  updates keep files that aren't in the bundle, users keep their settings.
- Keep `version` in `manifest.json` and `device.json` identical (or only in
  `manifest.json`).
- Check the size of `device.json` (< 8 KB).

## Capabilities you can depend on (stock firmware, `plugin_api` 1)

```
catalog.lists  catalog.notices  catalog.bundle_install  catalog.version_tracking
catalog.compatibility  catalog.item_details  catalog.encoded_item_fields
catalog.list_index_mapping  catalog.list_requirements  catalog.server_paths
```

Check what a device advertises with `GET /api/status` → `pluginCapabilities`.
Older firmware (some forks or older builds) may lack the newer ones. Require them
if you use `{id_enc}`-style variables, `lists_headers`/`{list_id}`, list `requires`,
or server-path answers.
