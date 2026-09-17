from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path

import flatlatex

from constants import SOFTCAP_ATTRIBUTES

_flatlatex_converter = flatlatex.converter(allow_zw=False)


def purify(s: str) -> str:
    """Trim whitespace and strip carriage returns and newlines."""
    return s.replace("\n", "").replace("\r", "").strip()


def find_pandoc_executable(custom_path: str | None = None) -> str:
    """Find the pandoc executable location."""
    if custom_path and Path(custom_path).is_file():
        return str(Path(custom_path).resolve())

    env_path = os.environ.get("PANDOC_PATH")
    if env_path and Path(env_path).is_file():
        return str(Path(env_path).resolve())

    candidates = [
        Path.cwd() / "pandoc.exe",
        Path.cwd() / "pandoc",
        Path(__file__).resolve().parent / "pandoc.exe",
        Path(__file__).resolve().parent / "pandoc",
        Path(__file__).resolve().parent.parent / "pandoc.exe",
        Path(__file__).resolve().parent.parent / "pandoc",
        shutil.which("pandoc.exe"),
        shutil.which("pandoc"),
    ]

    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate).resolve())

    return "pandoc"


async def mathml_to_latex(mjx: str, pandoc_path: str | None = None) -> str:
    """Convert HTML MathML element string to LaTeX using pandoc asynchronously."""
    executable = find_pandoc_executable(pandoc_path)
    proc = await asyncio.create_subprocess_exec(
        executable,
        "-f",
        "html",
        "-t",
        "latex",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(input=mjx.encode("utf-8"))
    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"Pandoc failed (code {proc.returncode}): {err_msg}")

    return stdout.decode("utf-8", errors="ignore").strip()


def latex_to_string(latex: str) -> str:
    """Convert LaTeX formula to plain string representation via flatlatex."""
    first_line = latex.splitlines()[0] if latex else ""
    if not first_line:
        return ""
    result = _flatlatex_converter.convert(first_line)
    cleaned = result.replace("\\", "").replace("[q]", "")
    if len(cleaned) >= 2:
        return cleaned[1:-1]
    return cleaned


def softcaps_from_string(s: str) -> list[str]:
    """Find all softcap attributes present in the parsed formula string."""
    matches: list[str] = []
    for stat in SOFTCAP_ATTRIBUTES:
        if re.search(re.escape(stat), s):
            matches.append(stat)
    if not matches:
        raise ValueError(f"softcap signatures not found in {s}")
    return matches


def formula_from_string(str1: str) -> tuple[str, list[str]]:
    """Extract formula and parameters from the parsed formula string."""
    re1 = re.compile(r"^[A-Za-z0-9_]+=\(")
    re2 = re.compile(r"\b[a-zA-Z']+\b")

    str2 = re1.sub("(", str1)
    matches = re2.findall(str2)
    if not matches or "√" in str2:
        raise ValueError(f"formula signatures not found in {str2}")

    if str1 != str2:
        matches = matches[1:]

    return purify(str2), matches
