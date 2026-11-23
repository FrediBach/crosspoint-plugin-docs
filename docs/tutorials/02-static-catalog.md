# Tutorial 2: Your own book shelf (static JSON catalog)

**You'll build:** an on-device catalog of **your own EPUBs**, hosted for free on
GitHub (or any static web host). It has shelves (lists), a details page with a
description, and a sidecar per book. No server code and no browser needed.

**You'll learn:** `browse`, `items`/`fields`, static paging, `lists` with URL
overrides, the Details screen, `download`, `sidecar`, config `dest_dir`.

## Step 1: Host your books

Create a public GitHub repo, for example `my-shelf`:

```
my-shelf/
├── books/
│   ├── dune.epub
│   └── the-hobbit.epub
├── all.json
├── scifi.json
└── tools/make_catalog.py
```

Files are then served at
`https://raw.githubusercontent.com/<you>/my-shelf/main/<path>`.

> Any HTTPS static host works: GitHub Pages, Netlify, an S3 bucket, your NAS.
> Large files: GitHub rejects files over 100 MB in normal repos.

## Step 2: The catalog files

`all.json`:
```json
{
  "books": [
    {
      "id": "dune",
      "title": "Dune",
      "author": "Frank Herbert",
      "summary": "A desert planet, a noble family, and the spice that controls the universe.",
      "file": "https://raw.githubusercontent.com/<you>/my-shelf/main/books/dune.epub"
    },
    {
      "id": "the-hobbit",
      "title": "The Hobbit",
      "author": "J.R.R. Tolkien",
      "summary": "A reluctant hobbit joins a company of dwarves on a quest.",
      "file": "https://raw.githubusercontent.com/<you>/my-shelf/main/books/the-hobbit.epub"
    }
  ]
}
```

`scifi.json` has the same shape with only the sci-fi books.

### Generate them instead of typing

`tools/make_catalog.py` reads the title and author from each EPUB's OPF:

```python
#!/usr/bin/env python3
"""Build a CrossPoint catalog JSON from a folder of EPUBs.
usage: make_catalog.py books/ https://raw.githubusercontent.com/<you>/my-shelf/main/books > all.json
"""
import json, sys, zipfile, re, pathlib, urllib.parse
import xml.etree.ElementTree as ET

NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container",
      "dc": "http://purl.org/dc/elements/1.1/"}

def meta(epub):
    with zipfile.ZipFile(epub) as z:
        root = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = root.find(".//c:rootfile", NS).get("full-path")
        opf = ET.fromstring(z.read(opf_path))
        def get(tag):   # itertext: descriptions may contain nested XHTML elements
            el = opf.find(f".//dc:{tag}", NS)
            return "".join(el.itertext()).strip() if el is not None else ""
        desc = re.sub(r"<[^>]+>", "", get("description"))[:600]
        return get("title") or epub.stem, get("creator"), desc

folder, base = pathlib.Path(sys.argv[1]), sys.argv[2].rstrip("/")
books = []
for epub in sorted(folder.glob("*.epub")):
    title, author, desc = meta(epub)
    books.append({
        "id": epub.stem,
        "title": title,
        "author": author,
        "summary": desc,
        "file": f"{base}/{urllib.parse.quote(epub.name)}",   # spaces etc. must be encoded
    })
json.dump({"books": books}, sys.stdout, ensure_ascii=False, indent=1)
```

## Step 3: The plugin

```
/plugins/my-shelf/
├── device.json
└── README.md
```

`device.json`:
```json
{
  "title": "My Shelf",
  "description": "My own EPUB collection.",
  "browse": {
    "url": "https://raw.githubusercontent.com/<you>/my-shelf/main/all.json",
    "items": "books",
    "page_size": 10,
    "fields": {
      "title": "title",
      "author": "author",
      "id": "id",
      "url": "file",
      "description": "summary"
    },
    "lists": [
      { "title": "All books" },
      { "title": "Science fiction",
        "url": "https://raw.githubusercontent.com/<you>/my-shelf/main/scifi.json" }
    ]
  },
  "download": {
    "url": "{url}",
    "dest_dir": "/Books/My Shelf",
    "filename": "{title}.epub",
    "sidecar": {
      "path": "{dest}.meta.json",
      "body": "{\"myshelf_id\":\"{id}\"}"
    }
  }
}
```

`README.md` is optional. Note that **a catalog plugin never shows its README on
the reader**: selecting it opens the catalog. The README is still useful for
people browsing the files, and for Plugin Hub.

## Step 4: Use it

**Home → Plugins → My Shelf → Science fiction → Dune → Details → Fetch.**
The book lands in `/Books/My Shelf/Dune.epub`, next to
`Dune.epub.meta.json` containing `{"myshelf_id":"dune"}`.

## What's going on

- **No `{page}`/`{offset}` in the URL**, so this is a *static* catalog. The reader
  downloads the whole file once and pages locally (10 rows per page here). Up to
  1 MB of JSON is fine. Hundreds of books work.
- **`lists`**: "All books" has no overrides, so it uses `browse.url`.
  "Science fiction" overrides only `url`. Everything else (`items`, `fields`) is shared.
- **Mapping `description`** turns on the Details screen. Without it, picking a row
  downloads immediately.
- **`{dest}`** in the sidecar path is the real, sanitized file path, so the sidecar
  always sits next to the book even if the title contained odd characters.
- `id` is used in the sidecar **inside a JSON string**. Keep ids simple (no
  quotes), because templates are not JSON-escaped.

## Variations

**Let the user choose the folder.** Add `"config": { "file": "config.json" }` and
a `plugin.js` (Tutorial 1) that writes `{"dest_dir": "/Books/Shelf"}`.

**Use a dictionary store instead of books.** Point `dest_dir` at
`/dictionaries/` and use `filename` for single-file items. For a dictionary made of
several files (`.ifo`, `.idx`, `.dict.dz`), see the bundle installer in
[Tutorial 7](07-bundle-store.md).

**Very big libraries**: split into `all-1.json`, `all-2.json`, … and use
`"url": ".../all-{page}.json"`. Every file except the last must hold **one extra
row** at the end (for example the next file's first book) so the reader knows a next
page exists. `page_size` must equal the number of "real" rows per file.

**No search.** A static file host can't answer queries. For search, you need an
API, see [Tutorial 3](03-authenticated-catalog.md).

Next: [Tutorial 3: Signed-in server catalog](03-authenticated-catalog.md).
