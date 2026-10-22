#!/usr/bin/env python3
"""Apply Blazzy-only menu policy to the licensed HUD artifact."""
import io, struct, sys, zipfile

TRANSPARENT_PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082')
REPLACEMENTS = {
    'https://discord.gg/RGzATq3v7J': 'https://github.com/hashimpope109-droid/Blazzy-Client',
    'Use Minecraft UI': 'Blazzy HUD Active',
    'Use Blazzy Client UI': 'Blazzy HUD Active',
    'Blazzy Client Store': 'Blazzy Store — Soon',
    'Cosmetic Store': 'Cosmetics — Soon',
}

def patch_utf8(data):
    out = bytearray(data[:10]); pos = 10
    count = struct.unpack('>H', data[8:10])[0]; index = 1
    while index < count:
        tag = data[pos]; out.append(tag); pos += 1
        if tag == 1:
            size = struct.unpack('>H', data[pos:pos+2])[0]; raw = data[pos+2:pos+2+size]
            text = raw.decode('utf-8', 'replace'); raw = REPLACEMENTS.get(text, text).encode('utf-8')
            out += struct.pack('>H', len(raw)) + raw; pos += 2 + size
        else:
            sizes = {3:4,4:4,5:8,6:8,7:2,8:2,9:4,10:4,11:4,12:4,15:3,16:2,17:4,18:4,19:2,20:2}
            size = sizes[tag]; out += data[pos:pos+size]; pos += size
            if tag in (5,6): index += 1
        index += 1
    out += data[pos:]
    return bytes(out)

def main(source, target):
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename.endswith('.class'): data = patch_utf8(data)
            if 'textures/gui/title/joindiscord1' in info.filename and info.filename.endswith('.png'): data = TRANSPARENT_PNG
            zout.writestr(info, data)

if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
