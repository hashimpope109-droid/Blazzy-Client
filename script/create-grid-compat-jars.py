#!/usr/bin/env python3
"""Create narrow Minecraft-version adapters from compatible Fabric menu builds."""

import argparse
import json
import zipfile
from pathlib import Path


def rewrite(source: Path, destination: Path, minecraft_range: str, label: str) -> None:
    with zipfile.ZipFile(source) as archive:
        entries = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    metadata = json.loads(entries["fabric.mod.json"].decode("utf-8"))
    metadata["name"] = f"Blazzy Client Modules ({label})"
    metadata["depends"]["minecraft"] = minecraft_range
    entries["fabric.mod.json"] = (json.dumps(metadata, indent=2) + "\n").encode("utf-8")
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr(name, data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("resources", type=Path)
    args = parser.parse_args()
    root = args.resources
    rewrite(root / "blazzy-grid-menu-1.21.4.jar", root / "blazzy-grid-menu-1.21.8.jar",
            ">=1.21.6 <=1.21.8", "1.21.6–1.21.8")
    rewrite(root / "blazzy-grid-menu-1.21.11.jar", root / "blazzy-grid-menu-1.21.10.jar",
            ">=1.21.9 <=1.21.10", "1.21.9–1.21.10")


if __name__ == "__main__":
    main()
