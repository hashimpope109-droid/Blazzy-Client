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

DISABLED_METHODS = {
    'net/fastclient/hud/launcher/LauncherRenderer.class': {
        'renderDiscordPanel': 'void',
        'renderSkinToggle': 'void',
        'isDiscordClicked': 'false',
        'isSkinToggleClicked': 'false',
    },
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

def patch_methods(data, methods):
    data = bytearray(data); count = struct.unpack('>H', data[8:10])[0]; pos = 10; cp = [None] * count; index = 1
    sizes = {3:4,4:4,5:8,6:8,7:2,8:2,9:4,10:4,11:4,12:4,15:3,16:2,17:4,18:4,19:2,20:2}
    while index < count:
        tag = data[pos]; pos += 1
        if tag == 1:
            size = struct.unpack('>H', data[pos:pos+2])[0]; cp[index] = bytes(data[pos+2:pos+2+size]).decode('utf-8', 'replace'); pos += 2 + size
        else:
            pos += sizes[tag]
            if tag in (5,6): index += 1
        index += 1
    pos += 6
    interfaces = struct.unpack('>H', data[pos:pos+2])[0]; pos += 2 + interfaces * 2
    def skip_members(at):
        total = struct.unpack('>H', data[at:at+2])[0]; at += 2
        for _ in range(total):
            attrs = struct.unpack('>H', data[at+6:at+8])[0]; at += 8
            for _ in range(attrs):
                length = struct.unpack('>I', data[at+2:at+6])[0]; at += 6 + length
        return at
    pos = skip_members(pos)
    total = struct.unpack('>H', data[pos:pos+2])[0]; pos += 2
    for _ in range(total):
        name_index = struct.unpack('>H', data[pos+2:pos+4])[0]; name = cp[name_index]; attrs = struct.unpack('>H', data[pos+6:pos+8])[0]; pos += 8
        for _ in range(attrs):
            attr_name = cp[struct.unpack('>H', data[pos:pos+2])[0]]; length = struct.unpack('>I', data[pos+2:pos+6])[0]; body = pos + 6
            if name in methods and attr_name == 'Code':
                code_len = struct.unpack('>I', data[body+4:body+8])[0]; start = body + 8
                replacement = b'\x03\xac' if methods[name] == 'false' else b'\xb1'
                data[start:start+code_len] = replacement + b'\x00' * (code_len - len(replacement))
                data[body:body+2] = struct.pack('>H', max(1, struct.unpack('>H', data[body:body+2])[0]))
            pos += 6 + length
    return bytes(data)

def main(source, target):
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename.endswith('.class'):
                data = patch_utf8(data)
                if info.filename in DISABLED_METHODS: data = patch_methods(data, DISABLED_METHODS[info.filename])
            if 'textures/gui/title/joindiscord1' in info.filename and info.filename.endswith('.png'): data = TRANSPARENT_PNG
            zout.writestr(info, data)

if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
