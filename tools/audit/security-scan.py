#!/usr/bin/env python3
"""Read-only heuristic scanner. Never prints matching values. Not a substitute for secret rotation/history tooling."""
from pathlib import Path
import argparse
import json
import re
import sys

PATTERNS = {
    "github_token": r"\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{30,})\b",
    "aws_access_key": r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "private_key": r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----",
    "provider_secret_key": r"\bsk-[A-Za-z0-9_-]{30,}\b",
    "jwt": r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b",
}
EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", ".runner-state", ".audit-artifacts"}
EXCLUDE_EXTS = {".png", ".mp3", ".apkg", ".zip", ".pyc"}


def scan(root):
    findings, scanned = [], 0
    for file in sorted(root.rglob("*")):
        if not file.is_file() or file.is_symlink() or any(part in EXCLUDE_DIRS for part in file.relative_to(root).parts) or file.suffix.lower() in EXCLUDE_EXTS:
            continue
        try:
            source = file.read_text(encoding="utf-8")
        except (UnicodeError, OSError):
            continue
        scanned += 1
        for kind, pattern in PATTERNS.items():
            for match in re.finditer(pattern, source):
                findings.append({"path": str(file.relative_to(root)), "line": source.count("\n", 0, match.start()) + 1, "kind": kind})
    return {"files_scanned": scanned, "candidate_locations_only": findings}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args()
    report = scan(Path(args.root).resolve())
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(1 if report["candidate_locations_only"] else 0)
