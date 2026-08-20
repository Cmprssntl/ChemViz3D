"""Native ChemViz3D window backed by Qt WebEngine."""

from __future__ import annotations

import threading
from pathlib import Path

from desktop.bridge_server import BridgeHTTPServer
from desktop.client import _start_server


def run_window(root: Path, config_dir: Path, port: int) -> int:
    """Run the Qt event loop and stop the bridge when the window closes."""
    try:
        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QIcon
        from PySide6.QtWidgets import QApplication, QMainWindow, QMessageBox
        from PySide6.QtWebEngineCore import QWebEnginePage
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except ImportError as exc:  # pragma: no cover - depends on the host runtime
        raise ImportError("PySide6 with QtWebEngineWidgets is required") from exc

    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    app.setApplicationName("ChemViz3D")
    app.setOrganizationName("ChemViz3D")
    icon_path = root / "ChatGPT Image 2026年8月19日 21_56_31.png"
    if icon_path.is_file():
        app.setWindowIcon(QIcon(str(icon_path)))
    server, thread, url = _start_server(root, config_dir, port)

    class ChemVizWindow(QMainWindow):
        def __init__(self) -> None:
            super().__init__()
            self._bridge: BridgeHTTPServer | None = server
            self._bridge_thread: threading.Thread | None = thread
            self._view = QWebEngineView(self)
            self.setWindowTitle("ChemViz3D")
            if icon_path.is_file():
                self.setWindowIcon(QIcon(str(icon_path)))
            self.resize(1360, 900)
            self.setCentralWidget(self._view)
            # Allow the embedded localhost page to write PNG screenshots to
            # the native clipboard through navigator.clipboard.
            try:
                self._view.page().featurePermissionRequested.connect(self._grant_page_permission)
            except AttributeError:
                pass
            self._view.loadFinished.connect(self._on_load_finished)
            self._view.setUrl(QUrl(url))

        def _grant_page_permission(self, origin: QUrl, feature: QWebEnginePage.Feature) -> None:
            if feature == QWebEnginePage.Feature.ClipboardReadWrite:
                self._view.page().setFeaturePermission(
                    origin,
                    feature,
                    QWebEnginePage.PermissionPolicy.PermissionGrantedByUser,
                )

        def _on_load_finished(self, ok: bool) -> None:
            if not ok:
                QMessageBox.critical(
                    self,
                    "ChemViz3D",
                    "无法加载内置界面，请检查程序文件是否完整。",
                )

        def closeEvent(self, event) -> None:  # noqa: N802
            bridge, bridge_thread = self._bridge, self._bridge_thread
            self._bridge = None
            self._bridge_thread = None
            if bridge is not None:
                bridge.shutdown()
                bridge.server_close()
            if bridge_thread is not None:
                bridge_thread.join(timeout=2)
            event.accept()

    window = ChemVizWindow()
    window.show()
    exit_code = app.exec()
    # QApplication can exit without a close event (for example, a platform
    # session shutdown), so make bridge cleanup idempotent here as well.
    if window._bridge is not None:
        window._bridge.shutdown()
        window._bridge.server_close()
        if window._bridge_thread is not None:
            window._bridge_thread.join(timeout=2)
    return int(exit_code)


if __name__ == "__main__":
    # PyInstaller uses this module as its entry script. Reuse the shared
    # argument parser so source and packaged launches behave identically.
    from desktop.client import main

    main()
