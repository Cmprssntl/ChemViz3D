#!/usr/bin/env python3
"""Build the ChemViz3D desktop installers for the current platform.

PyInstaller cannot cross-compile Qt binaries, so this script builds only what
the host can build: Debian packages on Linux, installers on Windows. CI runs it
once per platform; locally it is used for the Debian package.

    python3 desktop/build_release.py --target deb

The web bundle comes from ``node scripts/package.mjs`` (release/desktop); this
script never runs npm itself, so the same bytes ship on every platform.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "release" / "desktop"
RELEASE_ROOT = PROJECT_ROOT / "release"
WORK_ROOT = RELEASE_ROOT / ".desktop-build"
# Staging happens on the native filesystem: the project lives on an NTFS
# mount where chmod is a no-op, and both dpkg-deb and tar need real modes.
STAGE_ROOT = Path(tempfile.mkdtemp(prefix="chemviz3d-stage-"))
ICON_PNG = PROJECT_ROOT / "ICO.png"
ICON_ICO = PROJECT_ROOT / "ICO.ico"

VERSION = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))["version"]
TAG = f"v{VERSION}"

TARGETS = {
    "win": {"binary": "ChemViz3D.exe", "platform": "Windows-amd64", "portable": ".zip"},
    "deb": {"binary": "ChemViz3D", "platform": "Linux-amd64", "portable": ".tar.xz"},
}

DEBIAN_DEPENDS = (
    "libc6, libglib2.0-0, libx11-6, libx11-xcb1, libxcb1, libxcb-cursor0, "
    "libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libxkbcommon0, "
    "libnss3, libasound2 | libasound2t64"
)


def log(message: str) -> None:
    print(f"[desktop] {message}", flush=True)


def fail(message: str) -> None:
    raise SystemExit(f"[desktop] ERROR: {message}")


def run(command: list[str], cwd: Path = PROJECT_ROOT) -> None:
    log("$ " + " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def require_web_bundle() -> None:
    if not (WEB_ROOT / "index.html").is_file():
        fail("release/desktop is missing; run 'node scripts/package.mjs' first")
    if (WEB_ROOT / "assets" / "main.js").stat().st_size < 100_000:
        fail("release/desktop/assets/main.js looks truncated")


def pyinstaller_command() -> list[str]:
    try:
        import PyInstaller  # noqa: F401
        import PySide6  # noqa: F401
        return [sys.executable, "-m", "PyInstaller"]
    except ImportError:
        pass
    uv = shutil.which("uv")
    if not uv:
        fail("PyInstaller/PySide6 are unavailable; install desktop/requirements-build.txt or uv")
    os.environ.setdefault("UV_CACHE_DIR", str(WORK_ROOT / "uv-cache"))
    return [uv, "run", "--with", "PySide6>=6.7,<7", "--with", "pyinstaller>=6,<7", "python", "-m", "PyInstaller"]


def build_executable(target: str, reuse: Path | None) -> Path:
    if reuse is not None:
        if not reuse.is_file():
            fail(f"reusable executable not found: {reuse}")
        log(f"reusing executable {reuse}")
        return reuse.resolve()

    binary_dir = WORK_ROOT / target / "binary"
    for directory in (binary_dir, WORK_ROOT / target / "work", WORK_ROOT / target / "spec"):
        directory.mkdir(parents=True, exist_ok=True)
    separator = ";" if target == "win" else ":"
    command = [
        *pyinstaller_command(),
        "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "ChemViz3D",
        "--paths", str(PROJECT_ROOT),
        "--distpath", str(binary_dir),
        "--workpath", str(WORK_ROOT / target / "work"),
        "--specpath", str(WORK_ROOT / target / "spec"),
        "--add-data", f"{WEB_ROOT}{separator}dist",
        "--add-data", f"{PROJECT_ROOT / 'README.md'}{separator}.",
        "--add-data", f"{PROJECT_ROOT / 'LICENSE'}{separator}.",
        "--add-data", f"{PROJECT_ROOT / 'settings.int'}{separator}.",
        "--add-data", f"{PROJECT_ROOT / 'molecules'}{separator}molecules",
        "--hidden-import", "PySide6.QtWebEngineWidgets",
        "--hidden-import", "PySide6.QtWebEngineCore",
        str(PROJECT_ROOT / "desktop" / "qt_client.py"),
    ]
    if target == "win" and ICON_ICO.is_file():
        command.extend(["--icon", str(ICON_ICO)])
    run(command)
    executable = binary_dir / TARGETS[target]["binary"]
    if not executable.is_file():
        fail(f"PyInstaller did not produce {executable}")
    return executable


def copy_docs(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("README.md", "LICENSE", "settings.int"):
        source = PROJECT_ROOT / name
        if source.is_file():
            shutil.copy2(source, destination / name)
    presets = PROJECT_ROOT / "molecules" / "presets"
    if presets.is_dir():
        shutil.copytree(presets, destination / "molecules" / "presets", dirs_exist_ok=True)
    (destination / "molecules" / "cache").mkdir(parents=True, exist_ok=True)
    (destination / "molecules" / "cache" / ".gitkeep").touch()


def make_portable(target: str, executable: Path) -> Path:
    info = TARGETS[target]
    staging = STAGE_ROOT / "portable" / target
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    copy_docs(staging)
    binary = staging / info["binary"]
    shutil.copy2(executable, binary)
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    archive = RELEASE_ROOT / f"ChemViz3D-{TAG}-{info['platform']}-portable{info['portable']}"
    if archive.exists():
        archive.unlink()
    folder = f"ChemViz3D-{TAG}-{info['platform']}-portable"
    if info["portable"] == ".zip":
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as handle:
            for path in sorted(staging.rglob("*")):
                if path.is_file():
                    handle.write(path, Path(folder) / path.relative_to(staging))
    else:
        with tarfile.open(archive, "w:xz") as handle:
            handle.add(staging, arcname=folder)
    log(f"portable archive: {archive.name} ({archive.stat().st_size / 1e6:.0f} MB)")
    return archive


def make_debian_installer(executable: Path) -> Path:
    output = RELEASE_ROOT / f"ChemViz3D-{TAG}-Linux-amd64.deb"
    root = STAGE_ROOT / "deb-package"
    if root.exists():
        shutil.rmtree(root)
    app = root / "opt" / "chemviz3d"
    app.mkdir(parents=True)
    binary = app / "ChemViz3D"
    shutil.copy2(executable, binary)
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    copy_docs(app)
    if not ICON_PNG.is_file():
        fail("ICO.png is missing; the desktop entry needs an icon")
    shutil.copy2(ICON_PNG, app / "chemviz3d.png")

    launcher = root / "usr" / "bin" / "chemviz3d"
    launcher.parent.mkdir(parents=True)
    launcher.write_text(
        "#!/bin/sh\n"
        "CHEMVIZ_CONFIG_DIR=\"${XDG_CONFIG_HOME:-$HOME/.config}/ChemViz3D\"\n"
        "export CHEMVIZ_CONFIG_DIR\n"
        "exec /opt/chemviz3d/ChemViz3D \"$@\"\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)

    entry = root / "usr" / "share" / "applications" / "chemviz3d.desktop"
    entry.parent.mkdir(parents=True)
    entry.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=ChemViz3D\n"
        "Comment=Interactive 3D molecular visualization\n"
        "Exec=chemviz3d\n"
        "Icon=/opt/chemviz3d/chemviz3d.png\n"
        "Terminal=false\n"
        "Categories=Education;Science;Chemistry;\n",
        encoding="utf-8",
    )

    control = root / "DEBIAN" / "control"
    control.parent.mkdir(parents=True)
    control.write_text(
        "Package: chemviz3d\n"
        f"Version: {VERSION}\n"
        "Section: science\n"
        "Priority: optional\n"
        "Architecture: amd64\n"
        "Maintainer: ChemViz3D contributors\n"
        f"Depends: {DEBIAN_DEPENDS}\n"
        "Description: ChemViz3D interactive 3D molecular visualization tool\n"
        " ChemViz3D provides chemistry learning tools for viewing and inspecting\n"
        " molecular structures in an interactive 3D desktop application.\n",
        encoding="utf-8",
    )
    (root / "DEBIAN").chmod(0o755)
    control.chmod(0o644)
    if output.exists():
        output.unlink()
    run(["dpkg-deb", "--build", "--root-owner-group", str(root), str(output)])
    log(f"debian package: {output.name} ({output.stat().st_size / 1e6:.0f} MB)")
    return output


def make_windows_installer(executable: Path) -> Path:
    portable = make_portable("win", executable)
    staging = STAGE_ROOT / "portable" / "win"
    output_dir = WORK_ROOT / "inno"
    output_dir.mkdir(parents=True, exist_ok=True)
    script = output_dir / "ChemViz3D.iss"
    script.write_text(
        f"; ChemViz3D {TAG} installer\n"
        f"#define AppVersion \"{VERSION}\"\n"
        "[Setup]\n"
        "AppId={{7C5BD2B1-5B72-4E53-9B41-3E6B2DE6D3D1}\n"
        "AppName=ChemViz3D\n"
        "AppVersion={#AppVersion}\n"
        "DefaultDirName={autopf}\\ChemViz3D\n"
        "DefaultGroupName=ChemViz3D\n"
        "OutputDir=.\n"
        f"OutputBaseFilename=ChemViz3D-{TAG}-Windows-amd64-setup\n"
        "Compression=lzma2\n"
        "SolidCompression=yes\n"
        "ArchitecturesInstallIn64BitMode=x64compatible\n"
        "SetupIconFile=" + str(ICON_ICO) + "\n"
        "[Files]\n"
        f"Source: {staging / 'ChemViz3D.exe'}; DestDir: {{app}}; Flags: ignoreversion\n"
        f"Source: {staging / 'README.md'}; DestDir: {{app}}; Flags: ignoreversion\n"
        f"Source: {staging / 'LICENSE'}; DestDir: {{app}}; Flags: ignoreversion\n"
        f"Source: {staging / 'settings.int'}; DestDir: {{app}}; Flags: onlyifdoesntexist\n"
        f"Source: {staging / 'molecules' / 'presets'}\\*; DestDir: {{app}}\\molecules\\presets; "
        "Flags: ignoreversion recursesubdirs createallsubdirs\n"
        "[Icons]\n"
        "Name: {group}\\ChemViz3D; Filename: {app}\\ChemViz3D.exe\n"
        "Name: {commondesktop}\\ChemViz3D; Filename: {app}\\ChemViz3D.exe; Tasks: desktopicon\n"
        "[Tasks]\n"
        "Name: desktopicon; Description: Create a desktop shortcut; Flags: unchecked\n"
        "[Run]\n"
        "Filename: {app}\\ChemViz3D.exe; Description: Launch ChemViz3D; "
        "Flags: nowait postinstall skipifsilent\n",
        encoding="utf-8",
    )
    iscc = shutil.which("ISCC.exe") or shutil.which("ISCC")
    if not iscc:
        fail("Inno Setup (ISCC) is required for the Windows installer; the .iss file was prepared")
    run([iscc, str(script)], cwd=output_dir)
    produced = output_dir / f"ChemViz3D-{TAG}-Windows-amd64-setup.exe"
    if not produced.is_file():
        fail("Inno Setup did not produce the installer")
    installer = RELEASE_ROOT / produced.name
    shutil.copy2(produced, installer)
    log(f"windows installer: {installer.name} ({installer.stat().st_size / 1e6:.0f} MB)")
    return portable


def main() -> None:
    parser = argparse.ArgumentParser(description="Build ChemViz3D desktop installers")
    parser.add_argument("--target", choices=["deb", "win", "all"], default="deb")
    parser.add_argument("--reuse-executable", type=Path, default=None,
                        help="Wrap an existing binary instead of running PyInstaller")
    args = parser.parse_args()

    require_web_bundle()
    WORK_ROOT.mkdir(parents=True, exist_ok=True)

    targets = ["deb", "win"] if args.target == "all" else [args.target]
    if args.target == "all":
        if sys.platform.startswith("win"):
            targets = ["win"]
        elif sys.platform.startswith("linux"):
            targets = ["deb"]

    for target in targets:
        log(f"building {target} for {TAG}")
        executable = build_executable(target, args.reuse_executable)
        if target == "deb":
            make_portable("deb", executable)
            make_debian_installer(executable)
        else:
            make_windows_installer(executable)
    log("done")


if __name__ == "__main__":
    try:
        main()
    finally:
        shutil.rmtree(STAGE_ROOT, ignore_errors=True)
