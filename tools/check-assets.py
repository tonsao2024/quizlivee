#!/usr/bin/env python3
"""ตรวจว่าไฟล์ที่หน้าเว็บอ้างถึงมีอยู่จริง ก่อน deploy ขึ้น GitHub Pages

ใช้ได้ทั้งในเครื่องและใน CI:
    python3 tools/check-assets.py           # ตรวจทั้งโฟลเดอร์ docs/
    python3 tools/check-assets.py --quiet   # เงียบเมื่อผ่าน

ตรวจ 3 อย่าง
  1. ไฟล์หน้าที่ต้องมี (index/play/host/admin)
  2. <script src>, <link href>, <img src>, <source srcset> ใน HTML ทุกหน้า
  3. url(...) ใน CSS ทุกไฟล์
ข้ามลิงก์ภายนอก (http://, https://, //), data:, mailto:, #, javascript:
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

REQUIRED = [
    "index.html",
    "play.html",
    "host.html",
    "admin.html",
    "assets/css/app.css",
    "assets/js/api.js",
    "assets/js/util.js",
    "assets/js/config.js",
    "assets/js/sound.js",
    "assets/js/avatars.js",
    "assets/js/fx.js",
    "assets/js/podium.js",
    "samples/quiz-template.xlsx",
]

SKIP_PREFIX = ("http://", "https://", "//", "data:", "mailto:", "tel:", "javascript:", "#", "blob:")

ATTR_RE = re.compile(
    r"""<(?P<tag>script|link|img|source|video|audio)\b[^>]*?\b(?P<attr>src|href|srcset)\s*=\s*["'](?P<url>[^"']+)["']""",
    re.IGNORECASE,
)
CSS_URL_RE = re.compile(r"""url\(\s*["']?(?P<url>[^"')]+)["']?\s*\)""", re.IGNORECASE)


def local_refs(html: str) -> list[str]:
    refs: list[str] = []
    for m in ATTR_RE.finditer(html):
        value = m.group("url").strip()
        if m.group("attr").lower() == "srcset":
            # "a.png 1x, b.png 2x" -> เอาเฉพาะ path
            for part in value.split(","):
                piece = part.strip().split(" ")[0]
                if piece:
                    refs.append(piece)
        else:
            refs.append(value)
    return refs


def is_external(url: str) -> bool:
    return url.lower().startswith(SKIP_PREFIX)


def clean(url: str) -> str:
    return unquote(url.split("#", 1)[0].split("?", 1)[0])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true", help="ไม่พิมพ์อะไรเมื่อตรวจผ่าน")
    args = ap.parse_args()

    problems: list[str] = []

    if not DOCS.is_dir():
        print(f"ไม่พบโฟลเดอร์ {DOCS}", file=sys.stderr)
        return 1

    for rel in REQUIRED:
        if not (DOCS / rel).is_file():
            problems.append(f"ไม่มีไฟล์ที่จำเป็น: docs/{rel}")

    checked = 0

    for page in sorted(DOCS.rglob("*.html")):
        html = page.read_text(encoding="utf-8", errors="replace")
        for url in local_refs(html):
            if not url or is_external(url):
                continue
            target = (page.parent / clean(url)).resolve()
            checked += 1
            if not target.is_file():
                problems.append(f"{page.relative_to(ROOT)} อ้างถึง {url} แต่ไม่พบไฟล์")

    for sheet in sorted(DOCS.rglob("*.css")):
        css = sheet.read_text(encoding="utf-8", errors="replace")
        for m in CSS_URL_RE.finditer(css):
            url = m.group("url").strip()
            if not url or is_external(url):
                continue
            target = (sheet.parent / clean(url)).resolve()
            checked += 1
            if not target.is_file():
                problems.append(f"{sheet.relative_to(ROOT)} อ้างถึง {url} แต่ไม่พบไฟล์")

    if problems:
        print("พบปัญหา — ยกเลิกการ deploy:", file=sys.stderr)
        for p in problems:
            print(f"  • {p}", file=sys.stderr)
            # ทำให้ GitHub ขึ้น annotation ในหน้า Actions
            print(f"::error::{p}")
        return 1

    if not args.quiet:
        print(f"ผ่าน — ตรวจ {checked} ลิงก์/ไฟล์ภายใน ไม่พบของหาย")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
