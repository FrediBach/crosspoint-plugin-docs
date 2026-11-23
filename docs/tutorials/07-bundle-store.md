# Tutorial 7: Your own plugin/asset store (bundle installs)

**You'll build:** an on-device **store** that installs and updates *multi-file*
items: your own plugins (with Installed / Update badges), or asset packs such as
StarDict dictionaries, which are several files per dictionary.

This is the mechanism Plugin Hub itself uses. **The official docs only name it
(`catalog.bundle_install`). This tutorial documents how it works, based on the
source.**

**You'll learn:** `download.bundle`, `fields.version` tracking, the Details screen,
compatibility filters, atomic multi-file installs.

## How a bundle install works

For each catalog row, you provide:
- a **base URL**, and
- a **list of relative file paths**.

On install, the reader:
1. picks the target folder `<dest_dir>/<subdir>` (`subdir` defaults to `{id}`),
2. downloads **every** file as `<file>.new` (nested paths like `assets/x.png` work;
   their folder is created),
3. only when **all** files have arrived, swaps each `.new` over the old file,
4. on any failure, deletes the `.new` files. The installed copy is untouched, and a
   fresh, empty folder is removed again,
5. fires `book.downloaded` (with the first file's path) and refreshes event
   subscriptions, so a newly installed events plugin works immediately.

Files that exist in the folder but not in the list are **kept** (for example a
user's `config.json` or `token.json`). Updates preserve settings.

When `dest_dir` is a plugin root (`/.crosspoint/plugins`, `/plugins`, `/.plugins`)
and a plugin with that folder name is already installed **in another root**, it
is updated **in place** instead of creating a second copy.

## Part A: a plugin store

### The catalog (hosted anywhere, e.g. GitHub)

`store.json`
```json
{
  "plugins": [
    {
      "name": "reading-hooks",
      "title": "Reading Hooks",
      "description": "Sends reading activity to your server.",
      "author": "You",
      "version": "0.2.0",
      "repository": "github.com/you/reading-hooks",
      "base": "https://raw.githubusercontent.com/you/my-store/main/plugins/reading-hooks/0.2.0/",
      "files": ["manifest.json", "device.json", "plugin.js", "README.md"],
      "compatibility": { "firmware_family": "crosspoint", "plugin_api_min": 1 }
    },
    {
      "name": "library-doctor",
      "title": "Library Doctor",
      "description": "Statistics and duplicate finder.",
      "author": "You",
      "version": "0.1.0",
      "base": "https://raw.githubusercontent.com/you/my-store/main/plugins/library-doctor/0.1.0/",
      "files": ["manifest.json", "plugin.js"]
    }
  ]
}
```

### The store plugin

`/plugins/my-store/device.json`
```json
{
  "title": "My Store",
  "description": "Install and update my plugins.",
  "browse": {
    "url": "https://raw.githubusercontent.com/you/my-store/main/store.json",
    "items": "plugins",
    "page_size": 10,
    "fields": {
      "title": "title",
      "author": "description",
      "detail_author": "author",
      "id": "name",
      "version": "version",
      "description": "description",
      "repository": "repository"
    },
    "compatibility": {
      "firmware_family": "compatibility.firmware_family",
      "plugin_api_min": "compatibility.plugin_api_min",
      "requires": "compatibility.requires"
    }
  },
  "download": {
    "dest_dir": "/.crosspoint/plugins",
    "bundle": { "base": "base", "files": "files", "subdir": "{id}" }
  }
}
```

`/plugins/my-store/manifest.json`
```json
{ "name": "my-store", "title": "My Store", "version": "1.0.0" }
```

### What the user sees

```
My Store
  Reading Hooks           Update available     ← installed 0.1.0, catalog has 0.2.0 (sorted first)
  Send events to your…
  Library Doctor          v0.1.0               ← not installed
  Statistics and dup…
```

Selecting a row opens **Details** (description, author, repository, version) with
an **Install** or **Update** button.

### The rules that make it work

| Rule | Why |
|---|---|
| `fields.id` must equal the **plugin folder name** | Version tracking finds the installed copy by folder name |
| Every bundle must contain a **`manifest.json` with `version`** | The badge compares the catalog version with *that file*, not `device.json` |
| Versions are `X.Y.Z` digits only | Anything else never shows "Update" |
| `bundle.base` and `bundle.files` are **field paths** in the row | Not literal URLs. They point into each item. |
| `files` entries must be relative, without `..` | Otherwise the whole install is refused |
| `subdir` must not be empty, absolute, `.` or contain `..`/`\` | Same |
| Immutable `base` per version (like `/0.2.0/`) | A half-cached mix of old and new files can't happen |

Using `"author": "description"` is a trick Plugin Hub uses: the row subtitle shows
the description, while `detail_author` shows the real author on the Details page.

## Part B: an asset store (dictionaries)

The same mechanism installs anything made of several files. StarDict
dictionaries live in `/dictionaries/<name>/`:

`dicts.json`
```json
{
  "items": [
    {
      "id": "en-en-wiktionary",
      "title": "English (Wiktionary)",
      "info": "English-English, about 40 MB",
      "base": "https://example.com/dicts/en-en/",
      "files": ["en-en.ifo", "en-en.idx", "en-en.dict.dz", "en-en.syn"]
    }
  ]
}
```

`device.json`
```json
{
  "title": "Dictionary Store",
  "browse": {
    "url": "https://example.com/dicts/dicts.json",
    "items": "items",
    "fields": { "title": "title", "author": "info", "id": "id", "description": "info" }
  },
  "download": {
    "dest_dir": "/dictionaries",
    "bundle": { "base": "base", "files": "files", "subdir": "{id}" }
  }
}
```

There's no version tracking here (that only works for plugin folders), so the
button says **Fetch**, and re-fetching overwrites.

## Limits and notes

- Each file streams straight to SD, so there is no size limit per file beyond the card.
- There is **no ZIP extraction** on the device. Publish loose files.
- A bundle row needs a non-empty `files` array. Otherwise the reader falls back to a
  normal single-file download.
- Bundle file GETs are sent **without** `download.headers`, so the files must be
  publicly reachable (or carry their own auth in the URL).
- The rare failure case: if the SD card fails *during the final swap*, some files
  may be new and some old. The log says `bundle swap failed`. Installing again fixes it.

You've finished the tutorials. See [Limits and gotchas](../07-limits-and-gotchas.md)
before you ship.
