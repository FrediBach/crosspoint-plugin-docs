# 6. The job queue: triggering plugins from outside

The job queue lets **another program** (a shell script, a phone shortcut, a home
server, a companion app) ask your `plugin.js` to do something, without anyone
clicking in the web UI.

```
your script ──POST /api/plugin-jobs──►  reader (stores the job; does NOT run it)
                                             ▲  │
                         claim / complete    │  ▼
                    a browser page with your plugin loaded  ──► runs your action
your script ──GET /api/plugin-jobs/status?id=…──► {state:"done", result:{…}}
```

The reader only **stores** jobs. They are **executed by a browser page** that
has your plugin loaded: `/plugins`, `/files`, or the dedicated headless page
**`/plugins-run`**. No page open = jobs wait as `pending`.

## 6.1 In your plugin

```js
CrossPoint.registerPlugin((container, api) => {
  api.registerAction('save-url', async (args) => {
    if (!args.url) throw new Error('url required');        // → state "error", result {error: "url required"}
    const name = (args.name || 'download') + '.epub';
    const res = await api.fetchToSd(args.url, '/Books/Inbox/' + name);
    return { path: '/Books/Inbox/' + name, bytes: res.bytes };  // → state "done", result {...}
  });
});
```

- `fn(args)` may be async. Its return value becomes `result` (`undefined`/`null` → `{}`).
- Throwing → state `error` with `{error: message}`.
- Returning something `JSON.stringify` can't handle (BigInt, circular) → `error`.
- An unknown action name → `error` `{error: "unknown action: x"}`.
- Register actions **inside** the render function. They exist only once your
  plugin has rendered on that page.
- Which pages load your plugin depends on `mount` (see chapter 3). `/plugins-run`
  loads **every** plugin regardless of `mount`.

## 6.2 From outside

```sh
R=http://crosspoint.local

# 1. enqueue
curl -s -X POST $R/api/plugin-jobs \
  -d '{"plugin":"my-plugin","action":"save-url","args":{"url":"https://example.com/b.epub","name":"b"}}'
# → {"id":7}

# 2. make sure an executor page is open (once), e.g. in a browser tab or a hidden webview:
#    http://crosspoint.local/plugins-run

# 3. poll
curl -s "$R/api/plugin-jobs/status?id=7"
# → {"id":7,"state":"pending","result":null}
# → {"id":7,"state":"running","result":null}
# → {"id":7,"state":"done","result":{"path":"/Books/Inbox/b.epub","bytes":48213}}
```

The POST body is raw JSON (no `Content-Type` needed, but sending
`application/json` is fine).

## 6.3 Rules and limits

| Thing | Limit / behavior |
|---|---|
| Slots | **6 jobs in total** across all plugins. When full: `503 {"error":"job queue full"}`. Finished jobs are recycled oldest-first, so poll promptly. |
| `plugin` name | < 24 chars, the plugin's folder name |
| `action` name | < 24 chars, only `A-Z a-z 0-9 _ - .` |
| `args` | < 192 bytes of JSON |
| `result` | < 192 bytes of JSON. If bigger, the result is replaced with `{"error":"result too large"}` (the state stays `done`). **Return a path or id, not data.** Write big results to SD. |
| States | `pending` → `running` → `done` / `error`; `unknown` = never existed or slot recycled |
| Executor polling | every 2.5 s, one job at a time per page |
| Crashed executor | a `running` job goes back to `pending` after **10 minutes** |
| Plugins disabled | all job endpoints answer `403` |
| Reader not in File Transfer mode | no web server, so nothing works |

Bad requests get `400 {"error":"bad plugin/action/args"}`.

## 6.4 The executor protocol (if you write your own executor)

You normally don't need this, because `plugin-host.js` does it for you.

```
GET  /api/plugin-jobs/claim?plugin=<name>   → {"id":3,"claim":7,"action":"x","args":{…}}  or {"id":0}
POST /api/plugin-jobs/complete  {"id":3,"claim":7,"ok":true,"result":{…}}  → {"ok":true}
                                 409 {"error":"stale claim"} when the lease expired and someone else re-claimed
```

## 6.5 Tips

- `/plugins-run` **reloads itself every 10 s** if the plugin list fails to load,
  which makes it a robust thing to leave open on an always-on tablet or in a
  headless browser.
- Your plugin's render function runs on `/plugins-run` too, into a hidden
  container. Keep render cheap, and don't start work there automatically.
- Several open pages can all execute jobs. Each job is claimed by exactly one
  of them.

See [Tutorial 6](tutorials/06-job-queue.md) for an end-to-end "send to reader"
script.
