#!/usr/bin/env python3
"""Fail closed when an export contains credential files or secret-shaped text."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

FORBIDDEN_NAMES = (
    re.compile(r"(^|/)\.env($|\.)", re.IGNORECASE),
    re.compile(r"(^|/)(id_rsa|id_ed25519|credentials(?:\.json)?|cookies?\.txt)$", re.IGNORECASE),
    re.compile(r"\.(pem|p12|pfx|jks|keystore)$", re.IGNORECASE),
)

SECRET_PATTERNS = {
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    "credentialed-db-url": re.compile(
        r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^/\s:@]+:[^@\s/]+@",
        re.IGNORECASE,
    ),
    "notion-token": re.compile(r"\b(?:ntn_|secret_)[A-Za-z0-9_-]{20,}\b"),
    "openai-or-anthropic-token": re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b"),
    "github-token": re.compile(r"\bgh[opsu]_[A-Za-z0-9]{20,}\b"),
    "slack-token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "aws-access-key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "google-api-key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "generic-secret-assignment": re.compile(
        r"(?im)^\s*(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)"
        r"\s*[:=]\s*[\"']?(?!REDACTED|REMOVED|CHANGEME|EXAMPLE|\$\{)[^\s\"']{12,}"
    ),
}


def likely_binary(sample: bytes) -> bool:
    return b"\0" in sample or (
        sample and sum(byte < 9 or 13 < byte < 32 for byte in sample) / len(sample) > 0.10
    )


def scan(root: Path) -> list[dict[str, str | int]]:
    findings: list[dict[str, str | int]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        for pattern in FORBIDDEN_NAMES:
            if pattern.search(f"/{relative}"):
                findings.append({"path": relative, "line": 0, "rule": "forbidden-filename"})
        try:
            data = path.read_bytes()
        except OSError:
            findings.append({"path": relative, "line": 0, "rule": "unreadable-file"})
            continue
        if likely_binary(data[:8192]):
            continue
        text = data.decode("utf-8", errors="replace")
        for name, pattern in SECRET_PATTERNS.items():
            for match in pattern.finditer(text):
                findings.append(
                    {
                        "path": relative,
                        "line": text.count("\n", 0, match.start()) + 1,
                        "rule": name,
                    }
                )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    if not args.root.is_dir():
        print(f"INCOMPLETE: export directory does not exist: {args.root}", file=sys.stderr)
        return 1
    findings = scan(args.root)
    if findings:
        print(f"INCOMPLETE: built-in secret scan found {len(findings)} finding(s)", file=sys.stderr)
        for finding in findings[:20]:
            print(
                f"  {finding['path']}:{finding['line']} [{finding['rule']}]",
                file=sys.stderr,
            )
        return 1
    print("Built-in secret scan COMPLETE: no forbidden files or secret patterns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
