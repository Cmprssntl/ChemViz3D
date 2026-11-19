"""ChemViz3D desktop launcher.

The normal entry point is a native PySide6 window hosting the bundled WebUI.
The bridge itself remains standard-library-only so it can also be run in a
headless environment for diagnostics and automation.
"""

from __future__ import annotations

import argparse
import ctypes.util
import os
import sys
import threading
import time
from pathlib import Path

from desktop.bridge_server import BridgeHTTPServer


def _default_root() -> Path:
    bundled_root = getattr(sys, "_MEIPASS", None)
    if bundled_root:
        return Path(bundled_root)
    return Path(__file__).resolve().parents[1]


def _default_config_dir(root: Path) -> Path:
    explicit = os.environ.get("CHEMVIZ_CONFIG_DIR", "").strip()
    if explicit:
        explicit_path = Path(explicit).expanduser()
        if explicit_path.is_dir() and os.access(explicit_path, os.W_OK):
            return explicit_path
        if not explicit_path.exists() and os.access(explicit_path.parent, os.W_OK):
            return explicit_path

    # Source runs use the project directory. Portable frozen builds keep all
    # mutable files beside the executable; installed Debian builds set
    # CHEMVIZ_CONFIG_DIR from /usr/bin/chemviz3d to use ~/.config/ChemViz3D.
    if not getattr(sys, "frozen", False):
        return root
    executable_dir = Path(sys.executable).resolve().parent
    # A portable bundle is intentionally self-contained. The caller should
    # place it in a writable directory; never silently redirect its state.
    # Detect installed layouts by the protected Program Files location; plain
    # os.access is unreliable because the current process may be elevated.
    protected = any(
        part.lower() in {"program files", "program files (x86)"} for part in executable_dir.parts
    )
    if not protected and os.access(executable_dir, os.W_OK):
        return executable_dir
    # Installed builds (e.g. C:\Program Files\ChemViz3D) are not writable by
    # regular users; fall back to a per-user config directory so the bridge
    # can still persist settings, presets and caches.
    config_home = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    return Path(config_home) / "ChemViz3D"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the ChemViz3D desktop client")
    default_root = _default_root()
    parser.add_argument("--root", type=Path, default=default_root, help="ChemViz3D project/package root")
    parser.add_argument(
        "--config-dir",
        type=Path,
        default=None,
        help="Writable settings directory (defaults to the project root in source mode)",
    )
    parser.add_argument("--port", type=int, default=0, help="HTTP port (0 chooses a free local port)")
    parser.add_argument(
        "--headless",
        "--no-window",
        dest="headless",
        action="store_true",
        help="Run only the local bridge without opening a desktop window",
    )
    return parser


def _start_server(root: Path, config_dir: Path, port: int) -> tuple[BridgeHTTPServer, threading.Thread, str]:
    server = BridgeHTTPServer(("127.0.0.1", port), root, config_dir=config_dir)
    thread = threading.Thread(target=server.serve_forever, name="chemviz-bridge", daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    return server, thread, url


def _check_linux_graphics() -> None:
    """Explain the common Ubuntu xcb dependency before Qt emits a long crash."""
    if not sys.platform.startswith("linux") or os.environ.get("QT_QPA_PLATFORM"):
        return
    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        return
    if os.environ.get("WAYLAND_DISPLAY"):
        return
    if ctypes.util.find_library("xcb-cursor"):
        return
    raise SystemExit(
        "Qt cannot load the Linux xcb platform because libxcb-cursor is missing. "
        "On Ubuntu/Debian run: sudo apt install libxcb-cursor0. "
        "On Fedora run: sudo dnf install xcb-util-cursor. "
        "Then start ChemViz3D again."
    )


def _run_headless(root: Path, config_dir: Path, port: int) -> None:
    server, thread, url = _start_server(root, config_dir, port)
    print(f"ChemViz3D desktop bridge: {url}")
    print(f"Settings: {server.settings_path}")
    print("Press Ctrl+C to stop.")
    try:
        while thread.is_alive():
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("Stopping ChemViz3D...")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main(argv: list[str] | None = None) -> None:
    parser = _parser()
    args = parser.parse_args(argv)

    root = args.root.resolve()
    if not (root / "dist" / "index.html").is_file():
        parser.error(f"built WebUI not found: {root / 'dist' / 'index.html'}")
    config_dir = (args.config_dir or _default_config_dir(root)).resolve()
    if args.headless:
        _run_headless(root, config_dir, args.port)
        return

    _check_linux_graphics()
    try:
        from desktop.qt_client import run_window

        run_window(root, config_dir, args.port)
    except ImportError as exc:
        raise SystemExit(
            "PySide6 is required for the desktop window. "
            "Install desktop/requirements.txt or run with --headless."
        ) from exc


if __name__ == "__main__":
    main()
