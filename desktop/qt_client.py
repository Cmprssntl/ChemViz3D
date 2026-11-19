"""Native ChemViz3D window backed by Qt WebEngine."""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

# QtWebEngine's sandboxed network service is unreliable inside onefile builds
# on Windows and can surface as random "Failed to fetch" from the embedded
# page. Disable the Chromium sandbox for the helper process; the page is a
# trusted localhost app, so this is safe and matches the packaged Ubuntu build.
if os.name == "nt" and not os.environ.get("QTWEBENGINE_DISABLE_SANDBOX"):
    os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"

from desktop.bridge_server import BridgeHTTPServer
from desktop.client import _start_server


_LOG_PATH: Path | None = None


def _setup_logging(config_dir: Path) -> None:
    global _LOG_PATH
    try:
        _LOG_PATH = config_dir / "qt_client.log"
    except Exception:
        _LOG_PATH = None


def _log(message: str) -> None:
    if _LOG_PATH is not None:
        try:
            with open(_LOG_PATH, "a", encoding="utf-8") as handle:
                handle.write(message + "\n")
        except Exception:
            pass
    try:
        sys.stderr.write(f"[qt_client] {message}\n")
        sys.stderr.flush()
    except Exception:
        pass


def run_window(root: Path, config_dir: Path, port: int) -> int:
    """Run the Qt event loop and stop the bridge when the window closes."""
    try:
        import json
        import secrets
        import urllib.parse

        from PySide6.QtCore import QObject, QUrl, Slot
        from PySide6.QtGui import QIcon
        from PySide6.QtWebChannel import QWebChannel
        from PySide6.QtWidgets import QApplication, QMainWindow, QMessageBox
        from PySide6.QtWebEngineCore import (
            QWebEnginePage,
            QWebEngineProfile,
            QWebEngineUrlRequestInterceptor,
        )
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except ImportError as exc:  # pragma: no cover - depends on the host runtime
        raise ImportError("PySide6 with QtWebEngineWidgets is required") from exc

    from desktop.bridge_server import (
        _chat_url,
        _merged_text_settings,
        _normalize_settings,
        _read_json_file,
    )

    # Same 1x1 transparent GIF the bridge serves for image-beacon saves.
    _PIXEL_GIF_DATA_URI = (
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    )

    class _SettingsBridge(QObject):
        """Settings read/write exposed to the page through QtWebChannel.

        QtWebChannel transports messages over Qt's internal IPC instead of
        QtWebEngine's network service, so it keeps working even when fetch()
        and <img> requests fail on broken Windows builds. The page enables the
        channel only when window.qt.webChannelTransport is present (packaged
        desktop builds); the plain web build keeps using the HTTP bridge.
        """

        def __init__(self, bridge, settings_path: Path, developer_settings_path: Path | None) -> None:
            super().__init__()
            self._bridge = bridge
            self._settings_path = settings_path
            self._developer_settings_path = developer_settings_path

        @Slot(result=str)
        def getSettings(self) -> str:
            try:
                return json.dumps(_read_json_file(self._settings_path), ensure_ascii=False)
            except Exception:
                return "{}"

        @Slot(str, result=str)
        def saveSettings(self, content: str) -> str:
            try:
                value = _normalize_settings(
                    json.loads(content),
                    _read_json_file(self._settings_path),
                )
                self._bridge.write_settings(value)
                _log("qtchannel save OK")
                return "ok"
            except (UnicodeDecodeError, ValueError, OSError) as exc:
                _log(f"qtchannel save failed: {exc}")
                return f"error:{exc}"

        @Slot(str, result=str)
        def chatCompletions(self, payload_json: str) -> str:
            """Forward a chat-completion request through the bridge.

            The response is returned as JSON text over Qt IPC, so the page
            receives it even when QtWebEngine's network service cannot
            deliver fetch() responses ("Failed to fetch").
            """
            try:
                payload = json.loads(payload_json)
                if not isinstance(payload, dict):
                    raise ValueError("payload must be an object")
                settings = _merged_text_settings(self._settings_path, self._developer_settings_path)
                api_key = settings.get("api", "")
                model = settings.get("model", "")
                endpoint = _chat_url(str(settings.get("requestUrl", "")))
                if not api_key or not model or not endpoint:
                    raise ValueError("text AI settings are incomplete")
                payload["model"] = model
                status, response_body, _content_type = self._bridge.forward_chat(
                    endpoint, api_key, payload,
                )
                return json.dumps({
                    "status": status,
                    "body": response_body.decode("utf-8", "replace"),
                })
            except Exception as exc:
                _log(f"qtchannel chat failed: {exc}")
                return json.dumps({"status": 0, "body": "", "error": str(exc)})

    class _SettingsSaveInterceptor(QWebEngineUrlRequestInterceptor):
        """Handle the image-beacon settings save in the Qt process itself.

        QtWebEngine's sandboxed network service is unreliable on some Windows
        onefile builds: fetch() and even <img> requests can fail ("Failed to
        fetch") while already-loaded assets keep working. Intercepting the
        beacon request here means saving never touches the network stack at
        all — the write happens in-process and the page gets a data-URI GIF,
        whose load event confirms the save.
        """

        def __init__(self, bridge, settings_path: Path, bridge_token: str) -> None:
            super().__init__()
            self._bridge = bridge
            self._settings_path = settings_path
            self._bridge_token = bridge_token

        def interceptRequest(self, info) -> None:  # noqa: N802
            url = info.requestUrl().toString()
            if "/__chemviz_bridge/settings" not in url or "action=save" not in url:
                return  # every other request (page, assets, API) is untouched
            try:
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
                token = query.get("token", [""])[0]
                if not secrets.compare_digest(token, self._bridge_token):
                    raise ValueError("invalid bridge token")
                data_values = query.get("data")
                if not data_values:
                    raise ValueError("missing data parameter")
                value = _normalize_settings(
                    json.loads(urllib.parse.unquote(data_values[0])),
                    _read_json_file(self._settings_path),
                )
                self._bridge.write_settings(value)
                _log("beacon save OK (qt interceptor)")
                info.redirect(QUrl(_PIXEL_GIF_DATA_URI))
            except (UnicodeDecodeError, ValueError, OSError) as exc:
                _log(f"beacon save rejected: {exc}")

    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    app.setApplicationName("ChemViz3D")
    app.setOrganizationName("ChemViz3D")
    _setup_logging(config_dir)
    _log("window starting")
    # The default QWebEngine profile is OffTheRecord unless it has a storage
    # name, which would make localStorage (AI settings, UI preferences)
    # memory-only and lose everything on restart. Use a named persistent
    # profile pinned to a writable directory next to the bridge state
    # (per-user config dir for installed builds, bundle dir for portable).
    webengine_root = config_dir / "webengine"
    profile = QWebEngineProfile("ChemViz3D")
    profile.setPersistentStoragePath(str(webengine_root / "storage"))
    profile.setCachePath(str(webengine_root / "cache"))
    icon_path = root / "ICO.png"
    if icon_path.is_file():
        app.setWindowIcon(QIcon(str(icon_path)))
    server, thread, url = _start_server(root, config_dir, port)

    # Attach the interceptor before any page loads (the profile is still
    # unused at this point) so beacon saves bypass the network service.
    try:
        interceptor = _SettingsSaveInterceptor(server, server.settings_path, server.bridge_token)
        profile.setUrlRequestInterceptor(interceptor)
    except Exception as exc:  # pragma: no cover - best-effort safety net
        _log(f"interceptor setup failed: {exc}")

    # QtWebChannel: native settings read/write that never touches the network
    # service. The page sees qt.webChannelTransport and calls chemviz.saveSettings.
    web_channel = QWebChannel()
    settings_bridge = _SettingsBridge(
        server,
        server.settings_path,
        getattr(server, "developer_settings_path", None),
    )
    web_channel.registerObject("chemviz", settings_bridge)

    class ChemVizWindow(QMainWindow):
        def __init__(self) -> None:
            super().__init__()
            self._bridge: BridgeHTTPServer | None = server
            self._bridge_thread: threading.Thread | None = thread
            # Keep a reference so the C++ profile outlives the page.
            self._web_profile = profile
            # Keep the channel and its object alive for the window's lifetime.
            self._web_channel = web_channel
            self._view = QWebEngineView()
            self._view.setPage(QWebEnginePage(profile, self._view))
            try:
                self._view.page().setWebChannel(self._web_channel)
            except AttributeError:
                pass
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
            # Forward page console output (JS errors such as "Failed to fetch")
            # to stderr so packaging issues can be diagnosed from logs.
            try:
                self._view.page().consoleMessage.connect(self._on_console_message)
            except AttributeError:
                pass
            self._view.loadFinished.connect(self._on_load_finished)
            self._view.setUrl(QUrl(url))

        def _on_console_message(self, level, message: str, line: int, source: str) -> None:
            _log(f"console[{level}] {source}:{line}: {message}")

        def _grant_page_permission(self, origin: QUrl, feature: QWebEnginePage.Feature) -> None:
            if feature == QWebEnginePage.Feature.ClipboardReadWrite:
                self._view.page().setFeaturePermission(
                    origin,
                    feature,
                    QWebEnginePage.PermissionPolicy.PermissionGrantedByUser,
                )

        def _on_load_finished(self, ok: bool) -> None:
            if not ok:
                _log("page load failed")
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
