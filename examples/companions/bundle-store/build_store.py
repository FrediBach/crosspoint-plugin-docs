#!/usr/bin/env python3
"""Build store.json for the bundle-store example from plugin folders.

usage:
  build_store.py PLUGINS_DIR BASE_URL > store.json

  PLUGINS_DIR  folder containing one subfolder per plugin (like examples/plugins)
  BASE_URL     public URL of PLUGINS_DIR, e.g.
               https://raw.githubusercontent.com/YOU/YOUR-REPO/main/examples/plugins
               (pin it to a tag or commit for immutable releases)

Each plugin needs a manifest.json with name == folder name and an X.Y.Z version.
"files" in the manifest lists what gets installed; without it, the standard
files that exist are used.
"""
import json
import pathlib
import re
import sys

STANDARD = ["manifest.json", "device.json", "plugin.js", "README.md"]
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def as_csv(value):
    """Catalog rows want comma-separated strings, manifests may use arrays."""
    if isinstance(value, list):
        return ",".join(str(v) for v in value)
    return value


def entry(folder: pathlib.Path, base: str):
    manifest = json.loads((folder / "manifest.json").read_text())
    name = manifest.get("name", folder.name)
    if name != folder.name:
        raise ValueError(f"manifest name {name!r} != folder {folder.name!r}")
    if not VERSION.match(str(manifest.get("version", ""))):
        raise ValueError("version must be MAJOR.MINOR.PATCH")
    files = manifest.get("files") or [f for f in STANDARD if (folder / f).exists()]
    for f in files:
        if f.startswith("/") or ".." in f or "\\" in f or not (folder / f).is_file():
            raise ValueError(f"bad or missing file {f!r}")
    row = {
        "name": name,
        "title": manifest.get("title", name),
        "description": manifest.get("description", ""),
        "author": manifest.get("author", ""),
        "version": manifest["version"],
        "base": f"{base}/{name}/",
        "files": files,
    }
    if "repository" in manifest:
        row["repository"] = manifest["repository"]
    compat = manifest.get("compatibility")
    if compat:
        row["compatibility"] = {k: as_csv(v) for k, v in compat.items()}
    return row


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    root, base = pathlib.Path(sys.argv[1]), sys.argv[2].rstrip("/")
    rows = []
    for folder in sorted(p for p in root.iterdir() if (p / "manifest.json").is_file()):
        try:
            rows.append(entry(folder, base))
        except (ValueError, json.JSONDecodeError) as e:
            print(f"skipping {folder.name}: {e}", file=sys.stderr)
    json.dump({"plugins": rows}, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
