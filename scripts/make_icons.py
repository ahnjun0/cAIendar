#!/usr/bin/env python3
"""아이콘 PNG 생성 (의존성 없음). 디자인을 바꾸면 이 파일만 고치고 다시 실행한다.

    python3 scripts/make_icons.py

16px에서는 요소 수를 줄인다(점 3×2 → 2×2, 고리 생략). 논리 좌표 0..1 에 그린 뒤
4×4 초과표본화로 각 크기에 맞춰 렌더링한다.
"""
import pathlib
import struct
import zlib

BLUE = (0x34, 0x3F, 0xA6)     # 머리띠
ACCENT = (0x50, 0x6E, 0xE2)   # 강조된 날짜 한 칸
PALE = (0xC9, 0xD2, 0xF2)     # 나머지 날짜 칸
WHITE = (255, 255, 255)

OUT = pathlib.Path(__file__).resolve().parent.parent / 'icons'


def make(size):
    ss = 4
    cols, rows = (2, 2) if size <= 20 else (3, 2)
    ring = size > 20
    radius, band, pad = 0.16, 0.30, 0.13
    gapx = (1 - 2 * pad) / cols
    gapy = (1 - band - pad - 0.08) / rows
    dot = min(gapx, gapy) * (0.62 if size > 20 else 0.72)

    def sample(u, v):
        ox = radius - u if u < radius else (u - (1 - radius) if u > 1 - radius else 0.0)
        oy = radius - v if v < radius else (v - (1 - radius) if v > 1 - radius else 0.0)
        if ox > 0 and oy > 0 and ox * ox + oy * oy > radius * radius:
            return None  # 둥근 모서리 바깥
        if v < band:
            if ring:
                for cx in (0.34, 0.66):
                    if (u - cx) ** 2 + (v - 0.145) ** 2 < 0.055 ** 2:
                        return WHITE
            return BLUE
        for r in range(rows):
            for c in range(cols):
                cx = pad + gapx * (c + 0.5)
                cy = band + 0.06 + gapy * (r + 0.5)
                if max(abs(u - cx), abs(v - cy)) < dot / 2:
                    return ACCENT if (r == rows - 1 and c == cols - 1) else PALE
        return WHITE

    out = bytearray()
    for y in range(size):
        out.append(0)  # 필터 없음
        for x in range(size):
            r_ = g_ = b_ = a_ = 0
            for sy in range(ss):
                for sx in range(ss):
                    p = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)
                    if p is not None:
                        r_ += p[0]; g_ += p[1]; b_ += p[2]; a_ += 1
            if a_ == 0:
                out += bytes((0, 0, 0, 0))
            else:
                out += bytes((r_ // a_, g_ // a_, b_ // a_, a_ * 255 // (ss * ss)))
    return bytes(out)


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def main():
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        raw = make(size)
        png = (b'\x89PNG\r\n\x1a\n'
               + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
               + chunk(b'IDAT', zlib.compress(raw, 9))
               + chunk(b'IEND', b''))
        (OUT / f'icon{size}.png').write_bytes(png)
        print(f'icons/icon{size}.png  {len(png)}B')


if __name__ == '__main__':
    main()
