# 4. On-device catalogs (`device.json`)

A `device.json` with a `browse.url` turns your plugin into a **catalog screen on
the reader**. It needs no code. The firmware has one generic catalog screen, and
your JSON configures it: which URL to call, where the rows are in the answer,
how to sign in, and where to save downloads.

This chapter covers everything except `events` (see [chapter 5](05-events-and-sidecars.md)).

## 4.1 What the user sees

```
Home → Plugins → [your plugin]
   │
   ├─ connects Wi-Fi (asks for a network if needed)
   ├─ no token?  → sign-in screen (QR + code) or "set up in web UI" screen
   ├─ has lists? → list picker ("All Books", "Favorites", …)
   │                 └─ optional notice ("Community content – Continue / Go Back")
   └─ book list (rows: title + author)  ◄── Previous page / Next page rows
         │  Search (top row, if the catalog has search)
         ├─ Details screen (if you mapped details fields) → [Fetch / Install / Update]
         └─ download → "Done"
Back: book list → list picker → plugin list
```

## 4.2 The smallest useful manifest

```json
{
  "title": "My Catalog",
  "browse": {
    "url": "https://example.com/catalog.json",
    "fields": { "title": "name", "url": "download" }
  },
  "download": { "url": "{url}" }
}
```

The response is a JSON **array at the root** (`items` defaults to `""`, the
root). Each row's `name` is the title and `download` is a file URL. Files land in
the SD root as `{title}.epub`.

## 4.3 Top-level keys

| Key | Required | Purpose |
|---|---|---|
| `title` | no | Name in the plugin list (default: folder name) |
| `description` | no | Subtitle in the plugin list |
| `browse` | **yes** (for a catalog) | Request + how to read rows. `browse.url` makes it a catalog. |
| `download` | for downloads | What happens when a row is picked |
| `token` | no | Where the access token lives: `{ "file": "token.json", "path": "token" }` |
| `config` | no | Flat JSON of user settings: `{ "file": "config.json" }` → `{cfg.KEY}` |
| `auth` | no | On-device sign-in (`device_code` or `password`) |
| `events` | no | Event handlers (chapter 5) |
| `version`, `author`, `mount` | no | Metadata; see chapter 2 |

**Hard limit: `device.json` ≤ 8 KB.** Bigger files fail as "invalid manifest".

Relative file paths (`token.file`, `config.file`, a relative `download.dest_dir`)
are resolved **inside your plugin folder**. Absolute paths work too, except for
the three credential stores, which are refused.

## 4.4 Templates and variables

Most string values are **templates**: `{...}` placeholders are replaced before
use.

| Variable | Value | Where |
|---|---|---|
| `{token}` | token from `token.file` | everywhere |
| `{cfg.KEY}` | `KEY` from `config.file` | everywhere |
| `{firmware_family}` `{firmware_version}` `{plugin_api}` `{plugin_capabilities}` | firmware identity | everywhere |
| `{page}` | current page, 1-based | browse |
| `{offset}` | `(page-1) × page_size` | browse |
| `{limit}` | see [paging](#46-paging) | browse |
| `{query}` / `{query_raw}` | search text, URL-encoded / raw | search |
| `{list_id}` / `{list_id_enc}` | `id` of the open list, raw / encoded | browse, download, details |
| `{id}` `{title}` `{author}` `{url}` | the picked row's fields, **raw** | download, sidecar, details |
| `{id_enc}` `{title_enc}` `{author_enc}` `{url_enc}` | same, percent-encoded | download, sidecar, details |
| `{dest}` | final SD path of the downloaded file | sidecar |
| `{md5}` | MD5 of `{dest}` | sidecar |
| `{device_code}` | from the auth response | auth poll (URL and body only) |

### Encoding rules

- Values are inserted **as-is**. Before sending, the firmware percent-encodes
  only spaces, control characters and non-ASCII bytes **in the URL**.
  `& ? # / + = %` are kept.
  → Inside a query string or a single path segment, **use the `_enc` form**:
  `"https://x/search?q={title_enc}"`, `"https://x/files/{id_enc}"`.
- **Nothing is JSON-escaped.** `"body": "{\"q\":\"{query_raw}\"}"` breaks if the
  user searches for `a "quoted" word`. The same goes for `{title}` in a sidecar
  body. Prefer numeric ids in JSON bodies, and use search via URL (`{query}`)
  where the API allows it.
- An unknown variable stays **literally** in the text (`{cfg.typo}` is sent as is).
- Because bodies are JSON *inside* a JSON string, escape the quotes:
  `"body": "{\"page\":{page},\"per_page\":{limit}}"`.

## 4.5 `browse`: request and rows

```jsonc
"browse": {
  "format": "json",                  // "json" (default) or "xml" (see 4.11)
  "url": "https://api.example.com/books?page={page}&per_page={limit}",
  "method": "GET",                   // default GET
  "headers": { "Authorization": "Bearer {token}", "Accept": "application/json" },
  "body": "",                        // for POST APIs
  "items": "data.books",             // dotted path to the row array; "" = root
  "page_size": 8,                    // rows per screen page, 1..16 (default 8)
  "fields": {
    "title":  "title",               // REQUIRED; rows with an empty title are dropped
    "author": "authors.0.name",      // subtitle under the title
    "id":     "id",                  // → {id}
    "url":    "links.epub"           // → {url}
  }
}
```

**Dotted paths:** `a.b.c` walks objects, and a numeric segment indexes arrays
(`authors.0.name`). A key that itself contains a dot (for example
`"application/epub+zip"`) **can't be addressed**. Use an `id` and build the URL
in `download.url` instead.

Field values may be strings or whole numbers. Other types read as empty.

**Big responses are fine.** The response streams to an SD temp file and is
parsed from there, keeping only the mapped fields. A 1 MB cap protects against
broken servers.

### All `fields` keys

| Key | Purpose |
|---|---|
| `title` | Row title (required; defaults to `"title"`) |
| `author` | Row subtitle (up to 3 lines) |
| `id` | `{id}`; also the plugin folder name for version tracking |
| `url` | `{url}` |
| `version` | Turns on version tracking: rows show `v1.2.0` / *Installed* / *Update available* (see 4.10) |
| `description` | Details screen: long text |
| `detail_author` | Details screen author (defaults to `author`) |
| `repository` | Details screen line under the author |
| `details_url` | Details screen: URL fetched when Details opens (≤ 24 KB) |
| `details_format` | `"html"` or `"text"` (default) for `details_url` |

## 4.6 Paging

The firmware picks a paging mode from **which variables your request uses**
(URL, body **or** headers):

| You use | Mode | `{limit}` = | "Next page" appears when |
|---|---|---|---|
| neither `{page}` nor `{offset}` | **Static**: the whole list comes in one response, and the reader pages through it locally | `page_size + 1` | more rows remain |
| `{offset}` (wins over `{page}`) | **Offset** | `page_size + 1` | the server returned that extra lookahead row |
| `{page}` **and** `{limit}` | **Sized pages** | `page_size` | the page is full (a full last page leads to an empty next page) |
| `{page}` without `{limit}` | **Server page size** | `page_size + 1` | the response has **more than** `page_size` rows |

Examples:

```jsonc
// Static: a hand-written JSON file. Easiest.
"url": "https://example.com/all-books.json"

// Offset/limit APIs
"url": "https://api.example.com/books?offset={offset}&limit={limit}"

// page/per_page APIs
"url": "https://api.example.com/books?page={page}&per_page={limit}"

// One static file per page: books-1.json, books-2.json, …
// Each file except the last needs ONE extra row at the end
// (for example a copy of the next file's first row) so the reader knows more exist.
"url": "https://example.com/books-{page}.json"
```

> **Watch out:** the "server page size" mode only works when the server's page
> size equals `page_size`. If an API always returns 32 rows and `page_size` is
> 16, the reader shows rows 1–16, then fetches page 2 (rows 33–48). Rows
> 17–32 are never shown.

Navigation rows: "Previous page" appears above the rows on pages > 1, and "Next
page" below them.

## 4.7 Lists (sub-catalogs)

`browse.lists` shows a **picker** before the book list. Each list can override
`url` and/or `body`. Anything not overridden comes from `browse`.

```jsonc
"browse": {
  "url": "https://api.example.com/books?shelf={list_id_enc}&page={page}&per_page={limit}",
  "items": "books",
  "fields": { "title": "title", "id": "id" },
  "lists": [
    { "title": "Everything", "id": "" },
    { "title": "To read",    "id": "to-read" },
    { "title": "Favorites",  "id": "favorites" },
    { "title": "Newest",     "url": "https://api.example.com/books/new" },
    { "title": "Adult section", "id": "adult",
      "notice": {
        "title": "Heads up",                  // default: the list title
        "message": "Contains mature content.",// a notice needs a message
        "confirm": "Continue",                // default: translated "Confirm"
        "cancel":  "Go Back",                 // default: translated "Cancel"
        "id": "mature-ok", "once": true       // remember Continue across reboots
      } }
  ]
}
```

- **A single list** skips the picker (after its notice), and Back leaves the
  catalog.
- A list without a `title` is dropped.
- `notice.once: true` + `id` (1–64 chars of `A-Z a-z 0-9 - _ .`) remembers
  "Continue" on the SD card, per plugin. Lists with the same `id` share one
  acknowledgement. Uninstalling the plugin forgets it.
- A list may have `"requires": ["catalog.something"]`. It is hidden unless the
  firmware advertises **all** of these capabilities.
- Lists only apply to JSON catalogs.

### Dynamic lists from your server

```jsonc
"browse": {
  ...
  "lists_url": "https://api.example.com/folders",
  "lists_headers": { "Authorization": "Bearer {token}" },  // ONLY these headers are sent here
  "lists_items": "folders",                // default "lists"
  "lists_fields": { "title": "name", "id": "folder_id" }   // defaults: title, url, id, requires
}
```

- Fetched with GET once per catalog visit, ≤ 16 KB, at most 64 lists. These come
  **after** any static `lists`.
- Each entry needs a title plus a `url` or an `id`. An id-only entry browses
  `browse.url` with `{list_id}` filled in.
- Entries can also carry `body` and `notice` (read by those exact names).
- A `url` like `/api/x` (a "server path") is joined to the lists server's origin.
- If the fetch fails, static `lists` still show. Without any, you get an error with Retry.

## 4.8 Search

**Not in the official docs.** Add `browse.search` and the catalog gets a Search
action on its top row:

```jsonc
"browse": {
  "url": "https://api.example.com/books?page={page}&per_page={limit}",
  ...
  "search": {
    "url": "https://api.example.com/search?q={query}&page={page}&per_page={limit}"
    // and/or "body": "{\"query\":\"{query_raw}\",\"page\":{page}}"
  }
}
```

- Either `url` or `body` (or both) can be set. Whichever you leave out is taken from `browse`.
- `{query}` is URL-encoded. `{query_raw}` is the typed text (not JSON-escaped!).
- Search covers the whole catalog, not the open list. Back leaves the results.
- Paging works as described in 4.6, based on the search URL/body.
- JSON catalogs only.

## 4.9 The Details screen

Normally, picking a row starts the download right away. If you map **any** of
`description`, `repository` or `details_url` (or `version`), picking a row
opens a **Details** page first, with the title, author, description, version and a
**Fetch** (or **Install**/**Update**) button.

```jsonc
"fields": {
  "title": "title", "author": "author", "id": "id",
  "description": "summary",
  "repository": "publisher",
  "details_url": "links.about",     // optional: fetched only when Details opens
  "details_format": "links.about_format"   // row field holding "html" or "text"
}
```

`details_format` is a **field path** like every other entry in `fields`, not the literal
word `"html"`. The row itself must contain `"html"` or `"text"`. The details GET
sends **no headers** and falls back to `description` if it fails. HTML is shown
with the reader's simple HTML renderer.

## 4.10 Version tracking and compatibility (catalogs of plugins)

These are built for plugin stores, but any catalog can use them.

**Version badges**: map `fields.version`. For each row, the firmware looks for an
installed plugin whose **folder name equals the row's `id`**, reads that
plugin's `manifest.json` `version`, and shows:

- `v1.2.0`: not installed,
- *Installed*: same or newer installed,
- *Update available*: the catalog is newer. In a static list, rows with updates are
  sorted **first**.

With `version` mapped, the Details screen is always used, and these conventional
item keys are read automatically if you don't map them: `description`,
`author`, `repository`, `details.url`, `details.format`.

**Compatibility filtering**: hide rows the firmware can't run:

```jsonc
"browse": {
  ...
  "compatibility": {
    "firmware_family": "compatibility.firmware_family", // "crosspoint" or "a,b"
    "plugin_api_min":  "compatibility.plugin_api_min",  // number, e.g. 1
    "requires":        "compatibility.requires"         // "catalog.lists,catalog.notices"
  }
}
```

Rows without these values are always shown. Rows that fail a check are silently
skipped (and don't count toward pages in a static list).

> In the **catalog rows**, write `firmware_family` and `requires` as
> **comma-separated strings** (`"catalog.lists,catalog.notices"`), the way
> Plugin Hub's `catalog.json` does. The Hub's *`manifest.json`* contract uses
> arrays, but that is a different file.

## 4.11 XML catalogs (WebDAV, OPDS, anything XML)

```jsonc
"browse": {
  "format": "xml",
  "url": "{cfg.server}/remote.php/dav/files/{cfg.user}/Books/",
  "method": "PROPFIND",
  "headers": { "Depth": "1", "Authorization": "Basic {cfg.basic}" },
  "item": "response",                 // REQUIRED: local name of the repeating element
  "container_element": "collection",  // an item containing this element is a folder
  "skip_self": true,                  // drop the entry whose url is the request url
  "resolve_urls": true,               // "/path" urls → full urls on the same origin
  "extensions": [".epub", ".pdf"],    // only list files ending in these (folders always shown)
  "fields": {
    "title": "displayname",           // REQUIRED for XML (no default)
    "url":   "href"
  }
},
"download": { "username": "{cfg.user}", "password": "{cfg.pass}" }  // url defaults to "{url}"
```

Selectors (matched by local name, so namespace prefixes don't matter):
- `"elem"`: the leading text of the **first descendant** `<elem>` of the item,
- `"elem@attr"`: an attribute of the first descendant `<elem>` (OPDS: `"link@href"`,
  which takes the *first* `<link>`),
- `"@attr"`: an attribute of the item element itself.

Rules the parser applies (FreeInk SDK `XmlListParser`):
- A row **without a url is dropped**. A row with an empty title gets the url's last
  path segment as its title.
- An item is a **folder** when it contains the `container_element` anywhere inside it.
  `extensions` filters only files. Folders are always shown.
- `resolve_urls: true` turns `/path` **and relative** links (`sub/index.xml`) into full
  URLs, resolved against the folder of the XML being browsed. `..` is not normalised.
- Items nested inside another item are ignored. Each folder is its own request.
- Limits: 200 entries, 768 characters per field, about 64 KB of captured field text,
  and 32 levels of XML element nesting per response.

Behavior: Confirm on a folder fetches its `url` and lists it, and Back goes up
(any depth). Folders are listed first, then files, each sorted A–Z. You can't
choose the order. **No paging, lists, search or Details screen.**

## 4.11a Nested catalogs (folders inside folders)

A **JSON** catalog has at most two levels: an optional list picker (`lists`), then
the rows. Picking a row always downloads (or opens Details). Rows can't be folders,
and one response has only one `items` array. So nesting in the JSON itself doesn't help.

For deeper trees, use the **XML** format, even for plain static files. Every
folder is a small XML file whose folder entries link to the next file:

```xml
<!-- library/index.xml -->
<catalog>
  <entry><title>Fiction</title><info>3 books</info><link href="Fiction/index.xml"/><folder/></entry>
  <entry><title>Cosmos</title><info>Carl Sagan</info><file>Cosmos.epub</file><link href="Cosmos.epub"/></entry>
</catalog>
```

```json
"browse": {
  "format": "xml",
  "url": "https://example.com/library/index.xml",
  "item": "entry", "container_element": "folder", "resolve_urls": true,
  "fields": { "title": "title", "author": "info", "id": "file", "url": "link@href" }
},
"download": { "url": "{url}", "filename": "{id}" }
```

With relative links, the whole tree can be uploaded to any static host unchanged.
The [`nested-catalog`](../examples/plugins/nested-catalog/) example includes a
script that writes one `index.xml` per folder of a local book tree.

| | JSON catalog | XML catalog |
|---|---|---|
| Depth | 2 (lists → rows) | unlimited |
| Paging | yes | no (200 entries per folder) |
| Search, Details, version badges, bundles | yes | no |
| Order | as in the file | folders first, then A–Z |

## 4.12 `token` and `config` files

```jsonc
"token":  { "file": "token.json", "path": "token" },   // path defaults to "token"
"config": { "file": "config.json" }
```

- **token file**: any JSON. `path` is a dotted path to the token string. When
  the device signs in, it writes the file as `{"token": "..."}` (or nested,
  following `path`). Your `plugin.js` can write the same file, so the web sign-in
  and the device sign-in are interchangeable.
- **config file**: a **flat** JSON object. Every top-level key becomes
  `{cfg.KEY}`. Strings and whole numbers work. Booleans, decimals and nested
  values become empty strings.
- Both are capped at **2 KB**.
- The special config key **`dest_dir`** overrides `download.dest_dir`. Your
  web page can offer "Save books to: ___". (`"/"` means SD root. A rejected path is
  logged and the manifest value is used.)

**When is the user "not signed in"?** When a `token` block exists and the file
is missing, unreadable, or has an empty value at `path`. Without a `token` block
the catalog is token-less and never asks.

## 4.13 `auth`: signing in on the device

### Device code (OAuth 2.0 device authorization grant)

The reader shows a **QR code + user code**. The user approves on their phone,
and the reader polls until a token comes back.

```jsonc
"auth": {
  "type": "device_code",       // the default
  "request": { "url": "https://auth.example.com/device/code", "method": "POST",
               "headers": { "Content-Type": "application/x-www-form-urlencoded" },
               "body": "client_id=my-reader&scope=library" },
  "poll":    { "url": "https://auth.example.com/token", "method": "POST",
               "headers": { "Content-Type": "application/x-www-form-urlencoded" },
               "body": "grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=my-reader&device_code={device_code}" },
  // response paths (these are the defaults):
  "code_path": "user_code", "verify_url_path": "verification_uri",
  "device_code_path": "device_code", "interval_path": "interval",
  "expires_path": "expires_in", "token_path": "access_token", "error_path": "error"
}
```

- Both `request` and `poll` need a `url`. Their methods default to POST.
- Polling: at least every 3 s (default 5). `slow_down` adds 5 s.
  `expired_token`/`access_denied` fail. Anything else keeps polling. The code
  lives at least 60 s (default 900).
- Needs a `token` block, since that is where the token is saved.
- If there's no token, the reader shows a "Sign in" screen. Confirm (or a tap)
  starts the QR/code flow. Catalogs with `lists`/`lists_url` go straight to the
  QR screen. A rejected token (401/403) also lands on the Sign in screen.

### Password (silent token minting)

For "POST username+password → get token" APIs, including the OAuth2 password grant.
There's no UI on the device. Credentials come from `config.json`, which your
`plugin.js` writes.

```jsonc
"token":  { "file": "token.json" },
"config": { "file": "config.json" },
"auth": {
  "type": "password",
  "request": {
    "url": "{cfg.server}/oauth/v2/token",
    "method": "POST",
    "headers": { "Content-Type": "application/json" },
    "body": "{\"grant_type\":\"password\",\"client_id\":\"{cfg.client_id}\",\"client_secret\":\"{cfg.client_secret}\",\"username\":\"{cfg.username}\",\"password\":\"{cfg.password}\"}"
  },
  "token_path": "access_token"
}
```

- Runs when there's no token, **and again automatically on any 401/403** (from
  browse, lists or download; it retries once).
- **Needs a `token` block.** Without a token file to save into, minting fails.

Without an `auth` block, a missing or rejected token shows a screen that sends
the user to the web UI.

## 4.14 `download`

### Direct file URL

```jsonc
"download": {
  "url": "https://api.example.com/books/{id_enc}/file",  // or "{url}" from the row
  "headers": { "Authorization": "Bearer {token}" },        // sent with the file GET
  "dest_dir": "/Books/Example",
  "filename": "{title}.epub"
}
```

### One API hop ("give me a download link")

```jsonc
"download": {
  "url": "https://api.example.com/books/{id}/download",
  "method": "POST",
  "headers": { "Authorization": "Bearer {token}" },
  "body": "{}",
  "url_path": "url"            // answer: {"url": "https://cdn.example.com/signed/…"}
}
```

- The hop answer must be JSON, ≤ 48 KB.
- If `url_path` returns a **full URL**, the file GET is sent **without** your headers
  (pre-signed URLs often reject a second auth).
- If it returns a **server path** (`/files/12`), it's joined to the API origin and
  your headers **are** sent.
- On an error, the screen shows `Download failed (HTTP 404): <error or message from the JSON>`.

### Options

| Key | Default | Notes |
|---|---|---|
| `url` | `{url}` for XML, otherwise none | template |
| `method` | `GET` | for the hop (or the GET) |
| `headers`, `body` | none | templates |
| `url_path` | none | see above |
| `username`, `password` | none | HTTP Basic auth for the file GET (templates) |
| `dest_dir` | SD root | **absolute** → that folder (created if missing). **relative** → *inside your plugin folder*. Overridable by config `dest_dir`. |
| `filename` | `{title}.epub` | sanitized, cut to 100 bytes, extension kept; must not contain `/` or `..` |
| `sidecar` | none | `{ "path": "{dest}.meta.json", "body": "{\"myservice_id\":\"{id}\"}" }`, written after a successful download (see chapter 5) |
| `bundle` | none | multi-file installs (see [Tutorial 7](tutorials/07-bundle-store.md)) |

- Downloads follow up to 5 redirects. Credentials go only to the starting origin.
- After a download: the book's layout cache is cleared, `.epub/.txt/.md/.xtc` files
  make the Library re-index, the sidecar is written, and a `book.downloaded` event fires.
- A file with the same name in `dest_dir` is replaced.

## 4.15 Failure behavior

| Situation | Result |
|---|---|
| `device.json` invalid JSON, > 8 KB, no `browse.url`, or bad `dest_dir` | "Invalid manifest" |
| browse answers 401/403 | password grant: mint + retry once; otherwise the sign-in screen |
| browse answers other non-2xx (207 counts as success) | "Failed to fetch" + Retry |
| response not parseable / wrong `items` path | "Failed to parse", or an empty list |
| no Wi-Fi | Wi-Fi picker; Back cancels |

## 4.16 Debugging checklist

1. Start **token-less** with a public or static URL to get `items`/`fields` right.
2. `curl` your URL and check the paths: `curl -s URL | jq '.data.books[0]'`.
3. Watch serial for `[PCAT]` lines. They include HTTP status and parse errors.
4. Validate your JSON (a trailing comma breaks the whole manifest).
5. Check the size: `wc -c device.json` must be under 8192.

Next: [Events and sidecars](05-events-and-sidecars.md).
