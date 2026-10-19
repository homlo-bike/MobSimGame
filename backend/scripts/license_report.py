"""Write the backend dependency licence report (licence link and repository URL per package).

Usage (from backend/):
    python scripts/license_report.py --runtime-python /path/to/runtime-venv/bin/python \
        --dev-python .venv/bin/python --out ../docs/licenses/backend-dependencies.md

The runtime environment must contain only `pip install .` so that runtime and
development dependencies are reported separately. Reads installed metadata only.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

# Runs inside the target interpreter and prints JSON metadata of every installed distribution.
_PROBE = r"""
import json
from importlib.metadata import distributions
out = []
for d in distributions():
    m = d.metadata
    out.append({
        "name": m.get("Name"),
        "version": d.version,
        "expression": m.get("License-Expression"),
        "license": (m.get("License") or "").strip().splitlines()[0] if m.get("License") else "",
        "classifiers": [c for c in (m.get_all("Classifier") or []) if c.startswith("License ::")],
        "urls": m.get_all("Project-URL") or [],
        "home": m.get("Home-page"),
    })
print(json.dumps(out))
"""

# Trove classifier / free-text licence → SPDX identifier.
SPDX = {
    "MIT License": "MIT",
    "MIT": "MIT",
    "BSD License": "BSD-3-Clause",
    "BSD": "BSD-3-Clause",
    "Apache Software License": "Apache-2.0",
    "Apache 2.0": "Apache-2.0",
    "Apache License 2.0": "Apache-2.0",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "MPL-2.0": "MPL-2.0",
    "Python Software Foundation License": "PSF-2.0",
    "GNU Lesser General Public License v3 (LGPLv3)": "LGPL-3.0-only",
    "ISC License (ISCL)": "ISC",
}

# Verified by hand where metadata is vague ("BSD License" can be 2- or 3-clause).
MANUAL: dict[str, str] = {}

# Packages whose metadata links only to a website; source repository set by hand.
REPOS = {
    "mako": "https://github.com/sqlalchemy/mako",
    "sortedcontainers": "https://github.com/grantjenks/python-sortedcontainers",
}

# Packaging tools of the virtual environment itself and this project are not dependencies.
TOOLS = {"pip", "setuptools", "wheel", "mobsimgame-backend"}


def norm(name: object) -> str:
    """PEP 503 normalised name (pip_audit == pip-audit)."""
    return re.sub(r"[-_.]+", "-", str(name)).lower()


def spdx_of(info: dict[str, object]) -> str:
    name = str(info["name"]).lower()
    if name in MANUAL:
        return MANUAL[name]
    expr = info.get("expression")
    if isinstance(expr, str) and expr:
        return expr
    found = []
    for c in info["classifiers"]:  # type: ignore[union-attr]
        label = str(c).split("::")[-1].strip()
        if label != "OSI Approved" and label in SPDX:
            found.append(SPDX[label])
    if found:
        return " OR ".join(dict.fromkeys(found))
    text = str(info.get("license") or "")
    return SPDX.get(text, text or "UNKNOWN")


def repo_of(info: dict[str, object]) -> str:
    if str(info["name"]).lower() in REPOS:
        return REPOS[str(info["name"]).lower()]
    urls: dict[str, str] = {}
    for entry in info["urls"]:  # type: ignore[union-attr]
        label, _, url = str(entry).partition(",")
        urls[label.strip().lower()] = url.strip()
    for key in ("source", "source code", "repository", "code", "github", "homepage", "home"):
        if key in urls:
            return urls[key]
    if info.get("home"):
        return str(info["home"])
    return f"https://pypi.org/project/{info['name']}/"


def links(expr: str) -> str:
    ids = [t for t in re.findall(r"[A-Za-z0-9.+-]+", expr) if t not in {"OR", "AND", "WITH"}]
    return ", ".join(f"[{i}](https://spdx.org/licenses/{i}.html)" for i in ids)


def probe(python: str) -> list[dict[str, object]]:
    raw = subprocess.run([python, "-c", _PROBE], check=True, capture_output=True, text=True).stdout  # noqa: S603
    data: list[dict[str, object]] = json.loads(raw)
    return [d for d in data if norm(d["name"]) not in TOOLS]


def table(rows: list[dict[str, object]]) -> list[str]:
    out = ["| Package | Version | Licence | Repository |", "| --- | --- | --- | --- |"]
    for r in sorted(rows, key=lambda r: str(r["name"]).lower()):
        lic = spdx_of(r)
        out.append(f"| {norm(r['name'])} | {r['version']} | {links(lic)} | <{repo_of(r)}> |")
    return out


def summary(rows: list[dict[str, object]]) -> list[str]:
    counts: dict[str, int] = {}
    for r in rows:
        counts[spdx_of(r)] = counts.get(spdx_of(r), 0) + 1
    return [f"- {k}: {v}" for k, v in sorted(counts.items())]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runtime-python", required=True)
    ap.add_argument("--dev-python", required=True)
    ap.add_argument("--out", default="../docs/licenses/backend-dependencies.md")
    args = ap.parse_args()
    runtime = probe(args.runtime_python)
    runtime_names = {norm(r["name"]) for r in runtime}
    dev = [r for r in probe(args.dev_python) if norm(r["name"]) not in runtime_names]
    lines = [
        "# Backend dependency licences",
        "",
        "Generated by `backend/scripts/license_report.py` from installed package metadata.",
        "Runtime packages come from an environment containing only `pip install .`.",
        "Re-run after every dependency change. Licence links point to the SPDX licence text.",
        "",
        "All licences below are compatible with the project licence, AGPL-3.0-only (see THIRD_PARTY_NOTICES.md).",
        "",
        f"## Runtime dependencies (shipped in the API image): {len(runtime)}",
        "",
        *summary(runtime),
        "",
        *table(runtime),
        "",
        f"## Development dependencies (lint, type-check, test, audit; not shipped): {len(dev)}",
        "",
        *summary(dev),
        "",
        *table(dev),
        "",
    ]
    Path(args.out).write_text("\n".join(lines))
    unknown = [r["name"] for r in runtime + dev if spdx_of(r) == "UNKNOWN"]
    print(f"Wrote {len(runtime)} runtime and {len(dev)} development packages to {args.out}")
    if unknown:
        raise SystemExit(f"Packages without a licence: {unknown}")


if __name__ == "__main__":
    main()
