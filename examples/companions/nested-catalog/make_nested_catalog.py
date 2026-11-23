#!/usr/bin/env python3
"""Write an index.xml into every folder of a book tree, for the nested-catalog example.

usage:
  make_nested_catalog.py LIBRARY_DIR

  LIBRARY_DIR  the root folder of your books, with any number of subfolders:

      library/
      ├── Fiction/
      │   ├── Science Fiction/
      │   │   ├── Dune.epub
      │   │   └── Hyperion.epub
      │   └── Fantasy/The Hobbit.epub
      └── Non-Fiction/Cosmos.epub

Afterwards every folder that contains books (at any depth) has an index.xml.
Upload the whole tree to a static host (GitHub, Pages, S3, a NAS...) and point
device.json "browse.url" at <public URL of LIBRARY_DIR>/index.xml.

All links in the XML are RELATIVE (a subfolder's "Fantasy/index.xml", a book's
"Dune.epub"), and the reader resolves them against the folder of the index.xml
it is browsing. That's why the same files work on any host, with no base URL
baked in. The reader's limits per folder: 200 entries, about 64 KB of
titles/subtitles/links.
"""
import pathlib
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from xml.sax.saxutils import escape, quoteattr

BOOK_TYPES = {".epub", ".xtc", ".txt", ".md"}   # keep in sync with device.json "extensions"
INDEX = "index.xml"
MAX_ENTRIES = 200
FIELD_BUDGET = 60 * 1024
NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container",
      "dc": "http://purl.org/dc/elements/1.1/"}


def epub_meta(path: pathlib.Path):
    """(title, author) from the EPUB's OPF, or (None, None) when unreadable."""
    try:
        with zipfile.ZipFile(path) as z:
            container = ET.fromstring(z.read("META-INF/container.xml"))
            opf = ET.fromstring(z.read(container.find(".//c:rootfile", NS).get("full-path")))
    except (KeyError, AttributeError, ET.ParseError, zipfile.BadZipFile, OSError):
        return None, None

    def get(tag):
        el = opf.find(f".//dc:{tag}", NS)
        return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""

    return get("title") or None, get("creator") or None


def is_book(p: pathlib.Path):
    return p.is_file() and p.suffix.lower() in BOOK_TYPES and not p.name.startswith(".")


def count_books(folder: pathlib.Path) -> int:
    return sum(1 for p in folder.rglob("*") if is_book(p) and not any(
        part.startswith(".") for part in p.relative_to(folder).parts))


def entry(title, info, href, is_folder=False, file_name=None):
    parts = [f"<title>{escape(title)}</title>"]
    if info:
        parts.append(f"<info>{escape(info)}</info>")
    if file_name:
        parts.append(f"<file>{escape(file_name)}</file>")   # → {id} → the saved file name
    parts.append(f"<link href={quoteattr(urllib.parse.quote(href))}/>")
    if is_folder:
        parts.append("<folder/>")                           # marks a navigable folder
    return "  <entry>" + "".join(parts) + "</entry>"


def write_index(folder: pathlib.Path, root: pathlib.Path) -> int:
    """Writes folder/index.xml (recursively) and returns the number of books below folder."""
    rows, budget = [], 0
    subfolders = sorted(p for p in folder.iterdir() if p.is_dir() and not p.name.startswith("."))
    total = 0
    for sub in subfolders:
        n = write_index(sub, root)
        if n == 0:
            continue                                         # no empty folders on the reader
        total += n
        rows.append(entry(sub.name, f"{n} book" + ("" if n == 1 else "s"), f"{sub.name}/{INDEX}", is_folder=True))
    for book in sorted(p for p in folder.iterdir() if is_book(p)):
        title, author = epub_meta(book) if book.suffix.lower() == ".epub" else (None, None)
        rows.append(entry(title or book.stem, author, book.name, file_name=book.name))
        total += 1
    if total == 0:
        stale = folder / INDEX
        if stale.exists():
            stale.unlink()
        return 0

    rel = folder.relative_to(root).as_posix()
    if len(rows) > MAX_ENTRIES:
        print(f"WARNING {rel}: {len(rows)} entries; the reader shows only the first {MAX_ENTRIES}. "
              "Split it into subfolders.", file=sys.stderr)
    budget = sum(len(r) for r in rows)
    if budget > FIELD_BUDGET:
        print(f"WARNING {rel}: about {budget // 1024} KB of entries; the reader may refuse a folder "
              "this large. Split it into subfolders.", file=sys.stderr)
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<catalog>\n' + "\n".join(rows) + "\n</catalog>\n")
    (folder / INDEX).write_text(xml, encoding="utf-8")
    print(f"{rel or '.'}/{INDEX}: {len(rows)} entries", file=sys.stderr)
    return total


def main():
    if len(sys.argv) != 2 or not pathlib.Path(sys.argv[1]).is_dir():
        sys.exit(__doc__)
    root = pathlib.Path(sys.argv[1]).resolve()
    n = write_index(root, root)
    print(f"done: {n} books", file=sys.stderr)


if __name__ == "__main__":
    main()
