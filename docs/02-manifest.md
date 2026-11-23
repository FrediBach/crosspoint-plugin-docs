# 2. `manifest.json` reference

`manifest.json` holds the plugin's metadata. It is optional for a sideloaded
plugin, but **you need it** for:

- version tracking (Installed / Update badges in catalogs and Plugin Hub),
- choosing where the browser UI appears (`mount`),
- publishing to Plugin Hub.

```json
{
  "name": "my-plugin",
  "title": "My Plugin",
  "description": "One line that shows under the title on the reader.",
  "author": "Your Name",
  "version": "1.2.0",
  "mount": "settings",
  "files": ["manifest.json", "plugin.js", "device.json", "README.md"]
}
```

## Fields the firmware reads

| Field | Used by | Default | Meaning |
|---|---|---|---|
| `title` | reader list, web UI | folder name | Display name. |
| `description` | reader list | none | One-line summary under the title on the reader. |
| `version` | web UI, catalog badges | none | `MAJOR.MINOR.PATCH`, digits only (`1.2.0`, not `v1.2` or `1.2.0-beta`). |
| `author` | web UI info card | none | Shown on the `/plugins` page. |
| `mount` | web UI | `"settings"` | `"settings"`: `plugin.js` renders on `/plugins`. `"files"`: renders on the File Manager `/files`. |

Only **string** values count. A number such as `"version": 1` is ignored.

### Precedence with `device.json`

`device.json` may also contain `title`, `description`, `version`, `author` and
`mount`. When both files have a field, **`device.json` wins**, both on the reader
and on the web page.

**One exception:** version tracking (the "Update available" badge) reads
`version` **only from `manifest.json`**. A plugin without a `manifest.json`
version always looks outdated to a catalog. Keep the two versions in sync, or
only put the version in `manifest.json`.

### Version comparison

Versions are compared numerically, part by part: `1.10.0` is newer than `1.9.3`.
- A catalog version that is not valid `X.Y.Z` is **never** offered as an update.
- An installed copy with a missing or invalid version is **always** offered the update.
- An older catalog version never offers a downgrade.

## Fields only Plugin Hub reads

| Field | Meaning |
|---|---|
| `name` | Plugin id. Must equal the folder name (lowercase, digits, hyphens). |
| `files` | Every runtime file to install, relative to the plugin folder. Nested paths like `lib/api.js` are allowed. |
| `compatibility` | `{ "firmware_family": ["crosspoint"], "plugin_api_min": 1, "requires": ["catalog.lists"] }`. Plugin Hub uses it to hide plugins the firmware cannot run. |

The firmware ignores these fields. See [Publishing](08-publishing.md).

## Size limits

The web server reads up to 64 KB of `manifest.json`, but the reader's catalog
reads only **8 KB**. Keep it small.
