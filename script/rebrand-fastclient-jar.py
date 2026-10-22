#!/usr/bin/env python3
"""Rebrand user-authorized FastClient HUD binaries without changing internals."""

import argparse
import json
import shutil
import struct
import tempfile
import zipfile
from pathlib import Path
from PIL import Image


def visible_brand_string(value: str) -> bool:
    lowered = value.lower()
    if "fastclient" not in lowered and "fast client" not in lowered:
        return False
    if value in {"FastClient", "FastClient HUD", "FastClientHUD"}:
        return True
    return any(character.isspace() for character in value) and not value.startswith(("(L", "Lnet/", "[Lnet/"))


def rebrand(value: str) -> str:
    return (value
            .replace("FastClient HUD", "Blazzy Client")
            .replace("FastClientHUD", "Blazzy Client")
            .replace("Fastclient", "Blazzy Client")
            .replace("FastClient", "Blazzy Client")
            .replace("fast client", "Blazzy Client"))


def save_contained(source: Path, destination: Path, size: tuple[int, int], *, white=False) -> None:
    image = Image.open(source).convert("RGBA")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    if white:
        alpha = canvas.getchannel("A")
        canvas = Image.new("RGBA", size, (255, 255, 255, 0))
        canvas.putalpha(alpha)
    canvas.save(destination, optimize=True)


def patch_class(data: bytes) -> tuple[bytes, int]:
    if data[:4] != b"\xca\xfe\xba\xbe":
        raise ValueError("invalid Java class header")
    count = struct.unpack_from(">H", data, 8)[0]
    cursor = 10
    index = 1
    output = bytearray(data[:10])
    replacements = 0
    while index < count:
        tag = data[cursor]
        output.append(tag)
        cursor += 1
        if tag == 1:
            length = struct.unpack_from(">H", data, cursor)[0]
            cursor += 2
            raw = data[cursor:cursor + length]
            cursor += length
            # Java class files use modified UTF-8. Latin-1 gives a lossless
            # byte mapping while the brand tokens themselves are ASCII.
            value = raw.decode("latin-1")
            if visible_brand_string(value):
                branded = rebrand(value).encode("latin-1")
                output.extend(struct.pack(">H", len(branded)))
                output.extend(branded)
                replacements += branded != raw
            else:
                output.extend(struct.pack(">H", length))
                output.extend(raw)
        else:
            sizes = {3: 4, 4: 4, 5: 8, 6: 8, 7: 2, 8: 2, 9: 4, 10: 4,
                     11: 4, 12: 4, 15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2}
            if tag not in sizes:
                raise ValueError(f"unsupported constant-pool tag {tag}")
            size = sizes[tag]
            output.extend(data[cursor:cursor + size])
            cursor += size
            if tag in (5, 6):
                index += 1
        index += 1
    output.extend(data[cursor:])
    return bytes(output), replacements


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--title-logo", type=Path, required=True)
    parser.add_argument("--icon", type=Path, required=True)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="blazzy-rebrand-") as folder:
        root = Path(folder)
        with zipfile.ZipFile(args.input) as archive:
            archive.extractall(root)

        metadata_path = root / "fabric.mod.json"
        metadata = json.loads(metadata_path.read_text("utf-8"))
        metadata["name"] = "Blazzy Client HUD"
        metadata["authors"] = ["Blazzy Client Team"]
        metadata["description"] = "Blazzy Client HUD modules, visual enhancements, cosmetics, and launcher UI."
        metadata["contact"] = {"homepage": "https://github.com/hashimpope109-droid/Blazzy-Client"}
        metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", "utf-8")

        changed = 0
        for class_file in root.rglob("*.class"):
            patched, count = patch_class(class_file.read_bytes())
            class_file.write_bytes(patched)
            changed += count

        gui = root / "assets/fastclient-hud/textures/gui"
        save_contained(args.title_logo, gui / "title-fastclient-logo.png", (648, 205))
        save_contained(args.title_logo, gui / "title-fastclient-logo_1x.png", (324, 103))
        save_contained(args.icon, root / "assets/fastclient-hud/icon.png", (128, 128))
        save_contained(args.icon, gui / "logo.png", (150, 150))
        save_contained(args.icon, gui / "logo_1x.png", (75, 75))
        save_contained(args.icon, gui / "fasticon_white.png", (96, 96), white=True)
        save_contained(args.icon, gui / "fasticon_white_1x.png", (48, 48), white=True)

        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for item in sorted(root.rglob("*")):
                if item.is_file():
                    archive.write(item, item.relative_to(root).as_posix())
        print(f"Rebranded {changed} visible Java string constants")


if __name__ == "__main__":
    main()
