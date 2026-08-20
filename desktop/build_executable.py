"""Build the current platform's ChemViz3D executable with PyInstaller."""

from __future__ import annotations

import os
import subprocess
import sys
import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the ChemViz3D desktop executable")
    parser.add_argument(
        "--console",
        action="store_true",
        help="keep a console for diagnosing startup failures (default builds a windowed app)",
    )
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[1]
    if not (project_root / "dist" / "index.html").is_file():
        raise SystemExit("dist/index.html not found; run npm run build first")
    add_data_separator = ";" if os.name == "nt" else ":"
    release_dir = project_root / "release" / "desktop"
    work_dir = project_root / "release" / ".desktop-build"
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        *([] if args.console else ["--windowed"]),
        "--name",
        "ChemViz3D",
        "--paths",
        str(project_root),
        "--distpath",
        str(release_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(work_dir),
        "--add-data",
        f"{project_root / 'dist'}{add_data_separator}dist",
        "--add-data",
        f"{project_root / 'README.txt'}{add_data_separator}.",
        "--add-data",
        f"{project_root / 'LICENSE'}{add_data_separator}.",
        "--add-data",
        f"{project_root / 'ChatGPT Image 2026年8月19日 21_56_31.png'}{add_data_separator}.",
        "--hidden-import",
        "PySide6.QtWebEngineWidgets",
        "--hidden-import",
        "PySide6.QtWebEngineCore",
        str(project_root / "desktop" / "qt_client.py"),
    ]
    subprocess.run(command, cwd=project_root, check=True)
    print(f"Executable written to {release_dir}")


if __name__ == "__main__":
    main()
