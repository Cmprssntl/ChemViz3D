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

    # Source runs use the project/working directory. Frozen builds use the
    # current working directory as the portable data directory whenever it is
    # writable, so settings, presets, and AI cache stay together.
    if not getattr(sys, "frozen", False):
        return root
    working_dir = Path.cwd()
    if os.access(working_dir, os.W_OK):
        return working_dir
    executable_dir = Path(sys.executable).resolve().parent
    packaged_settings = executable_dir / "settings.int"
    if packaged_settings.is_file() and os.access(executable_dir, os.W_OK):
        return executable_dir

    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "ChemViz3D"


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
