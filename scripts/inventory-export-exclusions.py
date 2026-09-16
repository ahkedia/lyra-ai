#!/usr/bin/env python3
"""Generate shared rsync exclusions and inventory every source path they skip."""

from __future__ import annotations

import argparse
import fnmatch
import json
from datetime import datetime, timezone
from pathlib import Path

RSYNC_PATTERNS = (
    ".git/",
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "credentials*",
    "*token*",
    "*secret*",
)

SECRET_NAME_PATTERNS = RSYNC_PATTERNS[1:]


def exclusion_reason(relative: Path) -> str | None:
    if ".git" in relative.parts:
        return ".git/ (repository metadata)"
    name = relative.name
    for pattern in SECRET_NAME_PATTERNS:
        if fnmatch.fnmatch(name.lower(), pattern.lower()):
            return f"secret-name pattern: {pattern}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--rsync-excludes", required=True, type=Path)
    args = parser.parse_args()

    if not args.source.is_dir():
        raise SystemExit(f"INCOMPLETE: exclusion inventory source is missing: {args.source}")

    skipped = []
    source_file_count = 0
    for path in sorted(args.source.rglob("*")):
        if not path.is_file() and not path.is_symlink():
            continue
        source_file_count += 1
        relative = path.relative_to(args.source)
        reason = exclusion_reason(relative)
        if reason:
            skipped.append(
                {
                    "path": relative.as_posix(),
                    "size_bytes": path.lstat().st_size,
                    "reason": reason,
                }
            )

    args.inventory.parent.mkdir(parents=True, exist_ok=True)
    args.inventory.write_text(
        json.dumps(
            {
                "status": "COMPLETE",
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": str(args.source),
                "source_file_count": source_file_count,
                "skipped_file_count": len(skipped),
                "skipped_bytes": sum(item["size_bytes"] for item in skipped),
                "files": skipped,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    args.rsync_excludes.write_text("\n".join(RSYNC_PATTERNS) + "\n", encoding="utf-8")
    print(
        f"Exclusion inventory COMPLETE: {len(skipped)} files, "
        f"{sum(item['size_bytes'] for item in skipped)} bytes skipped"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
