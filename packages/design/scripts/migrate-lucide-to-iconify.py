"""Replace lucide-react JSX icons with @iconify/react/offline (lucide:*)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(r"D:/Documents/monorepo/cogito/master")
SKIP = {"node_modules", "dist", "out", ".git", "coverage"}

IMPORT_RE = re.compile(
    r"import\s*\{([^}]+)\}\s*from\s*['\"]lucide-react['\"]\s*;?\s*\n?"
)
ICONIFY_IMPORT_RE = re.compile(
    r"import\s*\{([^}]*)\}\s*from\s*['\"]@iconify/react/offline['\"]"
)


def to_iconify(name: str) -> str:
    base = name[:-4] if name.endswith("Icon") else name
    stepped = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", base)
    stepped = re.sub(r"([A-Z])([A-Z][a-z])", r"\1-\2", stepped)
    return f"lucide:{stepped.lower()}"


def ensure_iconify_import(text: str) -> str:
    match = ICONIFY_IMPORT_RE.search(text)
    if match:
        names = {n.strip() for n in match.group(1).split(",") if n.strip()}
        if "Icon" in names:
            return text
        names.add("Icon")
        rebuilt = ", ".join(sorted(names, key=lambda n: (n != "Icon", n)))
        return text[: match.start(1)] + rebuilt + text[match.end(1) :]

    # Prefer placing after the first import block start
    insert = "import { Icon } from '@iconify/react/offline'\n"
    first = re.search(r"^import\s", text, re.M)
    if not first:
        return insert + text
    return text[: first.start()] + insert + text[first.start() :]


def replace_usages(text: str, icons: list[str]) -> str:
    for name in sorted(icons, key=len, reverse=True):
        icon = to_iconify(name)
        # <Name ...props />
        pattern = re.compile(rf"<{name}(\s[^>]*)?/?>")

        def repl(match: re.Match[str]) -> str:
            attrs = match.group(1) or ""
            attrs = attrs.rstrip()
            if attrs.endswith("/"):
                attrs = attrs[:-1].rstrip()
            if attrs:
                return f'<Icon icon="{icon}"{attrs} />'
            return f'<Icon icon="{icon}" />'

        text = pattern.sub(repl, text)
    return text


def process(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    match = IMPORT_RE.search(original)
    if not match:
        return False

    icons = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", match.group(1))
    text = IMPORT_RE.sub("", original)
    text = ensure_iconify_import(text)
    text = replace_usages(text, icons)

    # leftover bare references (rare: icons.foo = CheckIcon)
    leftovers = [name for name in icons if re.search(rf"\b{name}\b", text)]
    if leftovers:
        print(f"WARN leftovers in {path}: {leftovers}")

    if text != original:
        path.write_text(text, encoding="utf-8", newline="\n")
        return True
    return False


def main() -> None:
    changed = 0
    for path in ROOT.rglob("*.tsx"):
        if any(part in SKIP for part in path.parts):
            continue
        if process(path):
            changed += 1
            print(f"updated {path.relative_to(ROOT)}")
    print(f"done: {changed} files")


if __name__ == "__main__":
    main()
