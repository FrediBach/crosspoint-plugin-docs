# Tutorial 6: Remote control with the job queue

**You'll build:** a **Send to Reader** plugin plus a shell script. From any
computer on your network, `./send-to-reader.sh https://example.com/book.epub`
makes the reader download the book, and the script reports the result.

**You'll learn:** `api.registerAction`, `/api/plugin-jobs`, `/plugins-run`,
keeping results under 192 bytes, writing a sidecar from JS.

## The plugin

```
/plugins/send-to-reader/
├── manifest.json
└── plugin.js
```

`manifest.json`
```json
{ "name": "send-to-reader", "title": "Send to Reader", "version": "0.1.0",
  "description": "Download URLs to the reader from scripts." }
```

`plugin.js`
```js
CrossPoint.registerPlugin((container, api) => {
  const b64 = (t) => { let s = ''; for (const c of new TextEncoder().encode(t)) s += String.fromCharCode(c); return btoa(s); };
  const INBOX = '/Books/Inbox';

  // A visible card on /plugins with a manual form, nice for testing.
  container.innerHTML = `
    <h2>Send to Reader</h2>
    <div class="setting-row"><div class="setting-name">Book URL</div>
      <div class="setting-control"><input type="text" data-url placeholder="https://…/book.epub"></div></div>
    <p><button class="btn-small btn-add">Download</button> <span data-out></span></p>`;

  async function save(args) {
    const url = String(args.url || '');
    if (!/^https?:\/\//.test(url)) throw new Error('url must start with http(s)://');
    // Name: explicit, or the last URL segment, made safe for FAT.
    let name = String(args.name || decodeURIComponent(new URL(url).pathname.split('/').pop() || 'book'));
    name = name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    if (!/\.(epub|txt|md|xtc|pdf)$/i.test(name)) name += '.epub';
    const dest = `${INBOX}/${name}`;

    const res = await api.fetchToSd(url, dest);           // follows redirects, resumes, creates /Books/Inbox
    await api.writeFile(dest + '.meta.json',               // sidecar: remember where it came from
      b64(JSON.stringify({ sendtoreader_source: url.slice(0, 500) })));
    return { dest, bytes: res.bytes };                      // small: must stay < 192 bytes of JSON
  }

  // The job-queue entry point.
  api.registerAction('save', save);

  // The manual button uses the same code path.
  container.querySelector('button').onclick = async () => {
    const out = container.querySelector('[data-out]');
    out.textContent = 'Downloading…';
    try {
      const r = await save({ url: container.querySelector('[data-url]').value.trim() });
      out.textContent = `Saved ${r.dest} (${r.bytes} bytes)`;
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    }
  };
});
```

> A `dest` path can be at most ~170 characters to keep the result under 192
> bytes. That's why the name is cut to 80 characters. Return ids or short paths,
> never content.

## The script

`send-to-reader.sh`
```sh
#!/bin/sh
# usage: send-to-reader.sh URL [name]
# needs: curl, python3 (only for JSON parsing). Set READER=http://<ip> if mDNS fails.
set -eu
READER="${READER:-http://crosspoint.local}"
URL="$1"; NAME="${2:-}"

json() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
ARGS="{\"url\":$(json "$URL")"
[ -n "$NAME" ] && ARGS="$ARGS,\"name\":$(json "$NAME")"
ARGS="$ARGS}"

# args must stay < 192 bytes of JSON
ID=$(curl -fsS -X POST "$READER/api/plugin-jobs" \
      -d "{\"plugin\":\"send-to-reader\",\"action\":\"save\",\"args\":$ARGS}" |
     python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "queued job $ID. Make sure $READER/plugins-run (or /plugins) is open in a browser."

while :; do
  S=$(curl -fsS "$READER/api/plugin-jobs/status?id=$ID")
  STATE=$(printf '%s' "$S" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])')
  case "$STATE" in
    done)    echo "OK: $S"; exit 0 ;;
    error)   echo "FAILED: $S"; exit 1 ;;
    unknown) echo "job vanished (slot recycled?)"; exit 1 ;;
  esac
  sleep 2
done
```

## Run it

1. Reader in **File Transfer** mode, plugin uploaded.
2. Open `http://crosspoint.local/plugins-run` in a browser tab and leave it open.
3. `chmod +x send-to-reader.sh && ./send-to-reader.sh https://example.com/some-book.epub`

```
queued job 1. Make sure http://crosspoint.local/plugins-run (or /plugins) is open in a browser.
OK: {"id":1,"state":"done","result":{"dest":"/Books/Inbox/some-book.epub","bytes":312094}}
```

## Running the executor without a visible browser

The executor is just a web page. Any always-on device can host it:

```sh
# a headless Chromium on a Raspberry Pi / home server
chromium --headless=new --disable-gpu --remote-debugging-port=0 http://crosspoint.local/plugins-run
```

Or embed it in a hidden WebView in your companion app. `/plugins-run` reloads
itself every 10 s if it fails to load, so it survives a reader that drops off Wi-Fi.

## Limits to remember

- 6 job slots **shared by all plugins**. Poll promptly: finished jobs are recycled
  oldest-first when new ones arrive.
- `args`/`result` < 192 bytes of JSON each, names < 24 chars.
- Jobs only run while the reader is in File Transfer mode **and** an executor page is open.
- A job whose executor died returns to `pending` after 10 minutes.
