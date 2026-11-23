# 5. Events and book sidecars

With events, a plugin can **react to what happens on the reader**: a book opened or
closed, a reading session ended, the device going to sleep, a download finished. You
declare HTTP requests in `device.json`, and the firmware sends them. There's no
browser and no code.

## 5.1 How it works (and why it's delayed)

Most events happen while Wi-Fi is **off** (closing a book, falling asleep). So:

```
event happens ──► one JSON line appended to  <plugin dir>/events.jsonl   (cheap SD write)
                                    │
                    later, when the reader is online:
                                    ▼
             each queued line → your declared request → 2xx = delivered, line removed
```

The queue is **drained** (sent):
- whenever Wi-Fi connects (any Wi-Fi connection the user makes),
- when File Transfer starts in "Join network" mode,
- **at sleep entry**: only for handlers that opt in with `"connect": true`, and
  always for `sleep.enter`. The reader then turns on Wi-Fi for up to ~10 s just
  to deliver.

Delivery is **at-least-once and in order** per plugin. A failed request stops that
plugin's drain, and the rest wait for next time. Each line has a unique
`{event.id}`. Deduplicate on it server-side.

## 5.2 The events

| Event | Fires when | `{event.*}` variables |
|---|---|---|
| `reader.open` | a book (EPUB/TXT/XTC) opens | `book` (SD path) |
| `reader.exit` | the reader is left (Home, sleep, other screen) | `book`, `percent`, `end_percent` |
| `reader.session` | an active-reading summary is flushed (before sleep / on exit) | `book`, `document`, `start_time`, `end_time`, `duration_seconds`, `start_progress_bp`, `end_progress_bp`, `progress_scale` |
| `book.downloaded` | an on-device catalog download (or bundle install) finished | `path`, `title`, `plugin` |
| `sleep.enter` | the device starts going to sleep | `book`, `percent`, `end_percent` if sleeping from a book; otherwise none |

Always available: `{event.ts}` (Unix time the event fired, `0` if the clock was
never set) and `{event.id}` (unique, stable across retries).

**Progress values** (all strings):
- `percent`: whole-book %, 0–100, measured at the **top** of the page (it can stay
  at 99 on the last page).
- `end_percent`: measured at the **bottom** of the page. It is `100` only on the last
  page or the end screen. **A book is finished when `end_percent` is `100`.**
- `*_progress_bp`: basis points, 0–10000 (`progress_scale` is always `10000`).

**`reader.session`** counts only real reading: forward page turns where the page
stayed visible ≥ 2 s (each page counts at most 30 min). It is emitted only for
≥ 10 active seconds and when the clock is trustworthy. `end_time` is always
`start_time + duration_seconds` (idle gaps removed). `document` is the KOReader
binary partial-MD5 of the file (32 hex chars), the same value KOSync uses.

Unknown event names in your manifest are ignored (logged). A manifest written for
newer firmware still works on older firmware.

## 5.3 Declaring handlers

```jsonc
{
  "title": "Reading Webhook",
  "config": { "file": "config.json" },          // {cfg.*} for URLs/secrets
  "token":  { "file": "token.json" },            // {token}, optional
  "events": {
    "reader.exit": {
      "request": {
        "method": "POST",                        // default POST
        "url": "{cfg.server}/hooks/progress",
        "headers": { "Content-Type": "application/json", "X-Secret": "{cfg.secret}" },
        "body": "{\"id\":\"{event.id}\",\"book\":\"{event.book}\",\"pct\":{event.percent},\"ts\":{event.ts}}"
      },
      "toast": "Progress sent",                  // popup after success, if a screen is available
      "connect": true                            // also deliver at sleep entry (turns on Wi-Fi)
    },
    "sleep.enter": {
      "download": { "url": "{cfg.server}/sleep.bmp", "dest": "/sleep.bmp" }
    }
  }
}
```

**One handler per event** per plugin. A handler is **either**:

- **`request`**: `url`, `method` (POST), `headers`, `body`. Any 2xx counts as
  delivered. The response is read (max 8 KB) and ignored.
- **`download`**: `url`, `method` (GET), `headers`, `dest`. The response streams to
  `dest` (absolute path, no `..`, ≤ 1 MB). It goes to `dest.part` first and replaces
  `dest` only on a 2xx, so an error page never overwrites your file.

Optional per handler:

| Key | Meaning |
|---|---|
| `toast` | template shown as a popup after success (sleep entry, File Transfer session) |
| `connect` | `true` = also deliver at sleep entry, turning Wi-Fi on. Implied for `sleep.enter`. |
| `require_meta` | a sidecar key such as `"myservice_id"`: queue this event **only** for books whose sidecar has that key (non-empty string or whole number). Other books cost nothing. |

Templates in `url`, `headers`, `body`, `dest`, `toast` support `{token}`,
`{cfg.KEY}`, `{event.*}`, and `{meta.KEY}` (the book's sidecar, see below).

> **Watch out:** values are not JSON-escaped and there are no `_enc` forms in
> events. A book path containing `"` breaks a JSON body, and one containing `&`
> breaks a query string. Send paths in a JSON body, and validate on the server.
> `{event.percent}` is a number-like string, so it may go unquoted in JSON.

### Auth in events

`{token}` is read from the same `token` file as the catalog. If a handler gets a
**401/403** and the manifest has an `auth.type: "password"` block, the firmware
mints a new token and retries once.

## 5.4 When new handlers take effect

The subscription table is rebuilt:
- at boot,
- whenever **Home → Plugins** is opened,
- when a File Transfer session ends (non-touch devices also reboot then),
- when the Plugins setting is toggled,
- after a catalog bundle install.

(The official docs say "after the next restart", which is outdated.)

**Max 8 plugins** can subscribe to events. Folder names must be ≤ 23 bytes.

## 5.5 Sleep-time delivery in detail

When the device goes to sleep and **any** queued event belongs to an opted-in
handler (`connect: true` or `sleep.enter`):

1. If Wi-Fi is off, battery ≥ 20 % and a saved network is in range, a popup shows,
   Wi-Fi joins (10 s deadline), and the queue drains.
2. **Everything** queued for that plugin rides along, including events from handlers
   without `connect`.
3. The sleep screen is drawn **after** the drain, so a `sleep.enter` download to
   `/sleep.bmp` appears on that same sleep (with the sleep screen set to Custom).
4. Sleep is never blocked: low battery, no network, or a failure just means the next drain.

Because of at-least-once delivery, a late retry can happen hours later. Check
`{event.ts}` if timing matters.

`sleep.enter` also carries the current book and percent, because the reader's own
`reader.exit` is queued *after* the sleep drain. Binding progress sync to
**both** `sleep.enter` and `reader.exit` pushes the latest position right away.

## 5.6 Limits

| Thing | Limit |
|---|---|
| Outbox per plugin | 4 KB. When full, **the whole queue is dropped** and starts fresh. |
| One event line | 512 bytes |
| Handlers run per drain | 4 (the rest continue on the next drain) |
| Request response | 8 KB (ignored) |
| Download | 1 MB |
| Subscribed plugins | 8 |
| Sidecar / config / token file | 2 KB each |

A corrupt line, or a line whose event no longer has a handler, counts as delivered,
so editing the manifest can't jam the queue.

---

## 5.7 The book metadata sidecar

A small flat JSON file **next to a book**:

```
/Books/Dune.epub
/Books/Dune.epub.meta.json   →   { "myservice_id": "36835", "source": "myservice" }
```

Use it to remember *which service book this file is*, so later events and syncs
can refer to it.

**Who writes it**
- A catalog download: `"sidecar": { "path": "{dest}.meta.json", "body": "{\"myservice_id\":\"{id}\"}" }`
- `plugin.js`: `api.writeFile(bookPath + '.meta.json', b64(JSON.stringify({...})))`
- You, by hand.

**Who reads it**
1. **Event templates**: `{meta.myservice_id}` for events that carry `book` (or
   `path` for `book.downloaded`).
2. **`require_meta`** filters (see above).
3. **KOSync**: with *Send book metadata* enabled in the KOSync settings, all
   fields are merged into the `metadata` object of every progress upload (it can't
   override `filename`, `title`, `authors`). A custom sync server can then route
   progress by `metadata.myservice_id`.

**Rules**
- Flat values only: strings, numbers, booleans. Nested values and `null` are ignored.
  `{meta.*}` sees strings and whole numbers. Decimals and booleans read as empty.
- ≤ 2 KB.
- **Namespace your keys** (`bookfusion_id`, not `id`). All plugins share one sidecar
  per book, and the last writer of a key wins.
- `require_meta` reads the sidecar **when the event fires**, so write it before
  the book is opened.

## 5.8 Recipes

**Mark finished books on a server**

```json
"reader.exit": {
  "require_meta": "shelf_id",
  "request": {
    "url": "{cfg.server}/api/books/{meta.shelf_id}/progress",
    "method": "PUT",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer {token}" },
    "body": "{\"percent\":{event.end_percent},\"event\":\"{event.id}\"}"
  },
  "connect": true
}
```
The server treats `percent == 100` as finished.

**Daily sleep image**

```json
"sleep.enter": { "download": { "url": "https://example.com/today.bmp", "dest": "/sleep.bmp" } }
```
Serve an e-ink-friendly BMP (for example 480×800, grayscale). It must be ≤ 1 MB.

**Log every reading session**

```json
"reader.session": {
  "request": {
    "url": "{cfg.server}/sessions",
    "headers": { "Content-Type": "application/json" },
    "body": "{\"id\":\"{event.id}\",\"doc\":\"{event.document}\",\"start\":{event.start_time},\"end\":{event.end_time},\"secs\":{event.duration_seconds},\"from\":{event.start_progress_bp},\"to\":{event.end_progress_bp}}"
  },
  "connect": true
}
```

See [Tutorial 4](tutorials/04-events.md) for a complete, testable version.

Next: [The job queue](06-job-queue.md).
