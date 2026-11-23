# 7. Limits, gotchas and debugging

The reader is an ESP32-C3 with about 380 KB of RAM. Every limit below exists to
keep it from running out of memory. Hard caps are enforced, not advisory.

## 7.1 All limits on one page

### Files and names
| Thing | Limit |
|---|---|
| Plugin folder name (for events) | ≤ 23 bytes; full path ≤ 63 bytes |
| `device.json` | ≤ 8 KB |
| `manifest.json` | ≤ 8 KB (reader) / 64 KB (web list) |
| `README.md` shown on device | ≤ 16 KB |
| `token.json`, `config.json`, book sidecar | ≤ 2 KB each |
| Downloaded filename | sanitized, ≤ 100 bytes |

### Browser side
| Thing | Limit |
|---|---|
| `registerPlugin` script load | 30 s, then "Failed to load plugin" |
| `api.relay` response body | 64 KB (more → error with `status 502`) |
| `api.writeFile` | 256 KB, must not be empty |
| `api.fetchToSd` body (non-GET) | 4 KB; GET segments 2 MB (the host loops for you) |
| `api.crypto` field | 64 KB base64 each; `random` ≤ 4096 bytes |

### On-device catalog
| Thing | Limit |
|---|---|
| `page_size` | 1–16 (default 8) |
| Browse response | 1 MB (streamed to SD) |
| Auth / download-hop response | 48 KB |
| `lists_url` response | 16 KB, ≤ 64 lists |
| `details_url` response | 24 KB |
| XML entries per folder | 200 |
| HTTP timeout | 30 s |
| Redirects (downloads) | 5 |

### Events
| Thing | Limit |
|---|---|
| Subscribed plugins | 8 |
| Outbox per plugin | 4 KB, then dropped wholesale |
| One event line | 512 bytes |
| Handlers per drain | 4 |
| Event download | 1 MB |
| Sleep-time Wi-Fi | battery ≥ 20 %, 10 s join deadline |

### Job queue
| Thing | Limit |
|---|---|
| Slots | 6 total |
| plugin / action names | < 24 chars |
| args / result | < 192 bytes JSON each |
| Stuck job lease | 10 min |

## 7.2 Gotchas (the ones that cost people an evening)

**Browser side**
1. `registerPlugin` after an `await` is silently ignored.
2. `btoa('é')` throws. Encode UTF-8 first (see the `b64` helper in chapter 3).
3. `api.relay` doesn't follow redirects, and its body is text only.
4. `crypto.subtle` is usually **missing**: `http://crosspoint.local` is not a secure context.
5. `api.writeFile(path, '')` fails. Write `{}` to "clear" a JSON file.
6. `document.getElementById('status')` may find *another plugin's* element.
7. A `"mount": "files"` plugin doesn't render on `/plugins`, and vice versa.
8. Your render function also runs (hidden) on `/plugins-run`. Don't auto-start work there.
9. The reader handles one request at a time. `Promise.all` of 50 fetches won't be faster, just flakier.

**device.json**
10. **No JSON escaping in templates.** `{title}` / `{query_raw}` / `{event.book}`
    containing `"` produce invalid JSON bodies.
11. In URLs, use `{x_enc}` for query values and path segments. Raw `&`, `?`, `#`, `+` pass through.
12. A typo in a variable is sent literally: `{cfg.sever}` → the server receives `{cfg.sever}`.
13. `config.json` must be **flat**. Booleans and decimals become empty strings.
14. A relative `dest_dir` means *inside the plugin folder*, not inside the SD root.
15. `auth.type: "password"` **requires** a `token` block, or there's nowhere to save the token.
16. `lists_url` gets **only** `lists_headers`, not `browse.headers`.
17. `details_format` is a *field path*, not the literal `"html"`.
18. Version badges read `version` from the installed **`manifest.json`** only.
19. "Server page size" paging silently skips rows if the server's page size ≠ `page_size`.
20. A catalog plugin never shows its README on the device.
21. Keys containing dots (e.g. `"application/epub+zip"`) can't be addressed by dotted paths.
22. In catalog rows, compatibility lists are comma-separated **strings**, not arrays.

**Events**
23. A non-2xx answer blocks that plugin's queue until it succeeds. Answer 2xx for junk you'll never accept.
24. Handlers without `connect: true` wait for the next Wi-Fi session (or ride along with an opted-in sleep drain).
25. One handler per event per plugin. Don't repeat an event key in `events`.
26. Expect duplicates (at-least-once). Dedupe on `{event.id}`.

## 7.3 Debugging

**Serial log** (USB): filter by tag.

| Tag | Area |
|---|---|
| `[PCAT]` | catalog: manifest load, requests, parse errors, rejected paths, bundles |
| `[PHTP]` | plugin HTTP client, token/config file access ("Manifest file not allowed") |
| `[PEVT]` | events: subscriptions, queueing, delivery |
| `[WEB]` | web endpoints: relay, fetch, plugin-fs, jobs |

**Browser**: the dev tools console shows `Plugin render failed: <name> <error>` and
`Plugin load failed: …`. The network tab shows every `/api/relay` call, with the
upstream status in the `X-Relay-Status` header.

**Reproduce device requests from a computer.** Replace the variables by hand and
use `curl`:

```sh
TOKEN=$(jq -r .token token.json)
curl -s -H "Authorization: Bearer $TOKEN" "https://api.example.com/books?offset=0&limit=9" | jq '.items[0]'
```

If `jq '<your items path>.0.<your title path>'` prints the title, the reader will too.

**Check manifests before copying:**

```sh
for f in device.json manifest.json; do
  python3 -m json.tool "$f" > /dev/null && echo "$f ok ($(wc -c < "$f") bytes)"
done
```

**Talk to the device from a terminal:**

```sh
R=http://crosspoint.local
curl -s $R/api/status | jq
curl -s $R/api/plugins | jq
curl -s -X POST $R/api/relay -d '{"plugin":"my-plugin","method":"GET","url":"https://httpbin.org/get"}' -D -
```

## 7.4 Security checklist before you publish

- [ ] No API keys, tokens or passwords in published files.
- [ ] Tell users that credentials are stored in plain text on the SD card.
- [ ] Destructive actions (delete, move, overwrite) ask for confirmation.
- [ ] Paths built from user or server input are validated (no `..`, stay within your folders).
- [ ] Server-side: authenticate event webhooks (a secret header from config), dedupe on `{event.id}`.
- [ ] Remember: TLS from the reader is **not certificate-verified**.
