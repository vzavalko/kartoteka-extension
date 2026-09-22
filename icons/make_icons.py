"""Рисуем иконку расширения без сторонних библиотек: PIL на машине нет.
Сглаживание — рендер в четыре раза крупнее и усреднение."""
import zlib, struct

BG = (0xFA, 0x0C, 0xF7)   # маджента, как в Картотеке
FG = (0xFF, 0xFF, 0xFF)
S = 4                      # кратность супересемплинга

def rounded(x, y, w, h, r):
    def inside(px, py):
        if px < x or py < y or px > x + w or py > y + h: return False
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        dx, dy = px - cx, py - cy
        return dx * dx + dy * dy <= r * r + 1e-9
    return inside

def render(size):
    W = size * S
    fon = rounded(0, 0, W, W, W * 0.24)
    # папка: корпус и «язычок»
    body = rounded(W * 0.20, W * 0.36, W * 0.60, W * 0.40, W * 0.06)
    tab  = rounded(W * 0.20, W * 0.26, W * 0.30, W * 0.16, W * 0.05)
    big = []
    for py in range(W):
        row = []
        for px in range(W):
            if not fon(px + .5, py + .5):
                row.append(None)
            elif body(px + .5, py + .5) or tab(px + .5, py + .5):
                row.append(FG)
            else:
                row.append(BG)
        big.append(row)
    # усредняем блоки S×S, прозрачность берём из доли закрашенных точек
    out = []
    for y in range(size):
        line = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for dy in range(S):
                for dx in range(S):
                    p = big[y * S + dy][x * S + dx]
                    if p:
                        r += p[0]; g += p[1]; b += p[2]; a += 1
            n = S * S
            if a:
                line += bytes((r // a, g // a, b // a, (a * 255) // n))
            else:
                line += b'\x00\x00\x00\x00'
        out.append(bytes(line))
    return out

def png(rows, size, path):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    blob = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(blob)

for n in (16, 32, 48, 128):
    png(render(n), n, 'icon%d.png' % n)
    print('icon%d.png' % n)
