#!/usr/bin/env python3
"""Build a catalog JSON for the static-catalog example from a folder of EPUBs.

usage:
  make_catalog.py BOOK_DIR BASE_URL > all.json

  BOOK_DIR  folder with .epub files
  BASE_URL  public URL of that folder, e.g.
            https://raw.githubusercontent.com/YOU/YOUR-REPO/main/books

Title, author and description come from each EPUB's OPF metadata.
"""
import json
import pathlib
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container",
      "dc": "http://purl.org/dc/elements/1.1/"}


def metadata(epub: pathlib.Path):
    with zipfile.ZipFile(epub) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = container.find(".//c:rootfile", NS).get("full-path")
        opf = ET.fromstring(z.read(opf_path))

    def get(tag):
        el = opf.find(f".//dc:{tag}", NS)
        return "".join(el.itertext()).strip() if el is not None else ""

    description = re.sub(r"<[^>]+>", "", get("description"))
    description = re.sub(r"\s+", " ", description)[:600]
    return get("title") or epub.stem, get("creator"), description


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    folder = pathlib.Path(sys.argv[1])
    base = sys.argv[2].rstrip("/")
    books = []
    for epub in sorted(folder.glob("*.epub")):
        try:
            title, author, description = metadata(epub)
        except (KeyError, AttributeError, ET.ParseError, zipfile.BadZipFile) as e:
            print(f"skipping {epub.name}: {e}", file=sys.stderr)
            continue
        books.append({
            # ids end up inside a JSON sidecar template: keep them simple.
            "id": re.sub(r"[^a-z0-9-]+", "-", epub.stem.lower()).strip("-"),
            "title": title,
            "author": author,
            "summary": description,
            "file": f"{base}/{urllib.parse.quote(epub.name)}",
        })
    json.dump({"books": books}, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
