"""Loopback bridge for the desktop client.

The bridge serves the built WebUI and owns operations that a browser cannot
perform silently, most importantly settings persistence and AI requests.
It intentionally uses only the Python standard library for the first MVP.
"""

from __future__ import annotations

import json
import base64
import mimetypes
import os
import secrets
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import re
import shutil
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


BRIDGE_PREFIX = "/__chemviz_bridge"
BRIDGE_TOKEN_HEADER = "X-ChemViz-Bridge-Token"
MAX_BODY_BYTES = 16 * 1024 * 1024
DEFAULT_UI_SETTINGS = {
    "locale": "zh-CN",
    "displayMode": "ball-and-stick",
    "labelDisplayMode": "always",
    "conformerSearchQuality": "balanced",
}
UI_SETTING_VALUES = {
    "locale": {"zh-CN", "zh-TW", "en-US"},
    "displayMode": {"ball-and-stick", "space-filling"},
    "labelDisplayMode": {"always", "hover", "never"},
    "conformerSearchQuality": {"fast", "balanced", "precise"},
}


def _read_json_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"Invalid {path.name}: {exc}") from exc
    return value if isinstance(value, dict) else {}


def _non_empty(value: Any, fallback: Any = "") -> Any:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _merged_text_settings(settings_path: Path, developer_settings_path: Path) -> dict[str, Any]:
    public = _read_json_file(settings_path)
    developer = _read_json_file(developer_settings_path)
    result: dict[str, Any] = {}
    for source in (public.get("text"), developer.get("text")):
        if not isinstance(source, dict):
            continue
        for key in ("api", "model", "requestUrl", "systemPrompt"):
            value = _non_empty(source.get(key))
            if value:
                result[key] = value
        retries = source.get("maxRetries")
        if isinstance(retries, int) and not isinstance(retries, bool):
            result["maxRetries"] = min(10, max(0, retries))
    legacy_prompt = _non_empty(developer.get("systemPrompt"), _non_empty(public.get("systemPrompt")))
    if legacy_prompt and "systemPrompt" not in result:
        result["systemPrompt"] = legacy_prompt
    return result


def _normalize_ui_settings(value: Any, fallback: dict[str, Any] | None = None) -> dict[str, str]:
    base = dict(DEFAULT_UI_SETTINGS)
    if isinstance(fallback, dict):
        for key, allowed in UI_SETTING_VALUES.items():
            candidate = fallback.get(key)
            if isinstance(candidate, str) and candidate in allowed:
                base[key] = candidate
    raw = value if isinstance(value, dict) else {}
    normalized: dict[str, str] = {}
    for key, allowed in UI_SETTING_VALUES.items():
        candidate = raw.get(key)
        normalized[key] = candidate if isinstance(candidate, str) and candidate in allowed else base[key]
    return normalized


def _normalize_settings(value: Any, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("settings must be a JSON object")
    previous = existing if isinstance(existing, dict) else {}
    normalized: dict[str, Any] = {}
    for group in ("text", "image"):
        raw = value.get(group, previous.get(group, {}))
        if not isinstance(raw, dict):
            raise ValueError(f"{group} settings must be an object")
        endpoint: dict[str, Any] = {}
        for key in ("api", "model", "requestUrl", "systemPrompt"):
            item = raw.get(key, "")
            if not isinstance(item, str):
                raise ValueError(f"{group}.{key} must be a string")
            endpoint[key] = item
        retries = raw.get("maxRetries", 2)
        if not isinstance(retries, int) or isinstance(retries, bool):
            raise ValueError(f"{group}.maxRetries must be an integer")
        endpoint["maxRetries"] = min(10, max(0, retries))
        normalized[group] = endpoint
    normalized["ui"] = _normalize_ui_settings(value.get("ui", previous.get("ui", {})), previous.get("ui"))
    return normalized


def _chat_url(request_url: str) -> str:
    normalized = request_url.strip().rstrip("/")
    if not normalized:
        return ""
    try:
        parsed = urllib.parse.urlsplit(normalized)
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or any(char.isspace() for char in normalized):
        return ""
    return normalized if normalized.endswith("/chat/completions") else f"{normalized}/chat/completions"


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def _cache_key(value: str) -> bool:
    return bool(re.fullmatch(r"v1-[0-9a-f]{8}", value))


class BridgeHandler(BaseHTTPRequestHandler):
    server: "BridgeHTTPServer"

    def log_message(self, format: str, *args: Any) -> None:
        # Keep the desktop console readable; errors are returned to the client.
        if self.path.startswith(BRIDGE_PREFIX):
            super().log_message(format, *args)

    def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if self.path.startswith(BRIDGE_PREFIX) else "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, value: Any) -> None:
        self._send_bytes(status, _json_bytes(value), "application/json; charset=utf-8")

    def _authorized(self) -> bool:
        if secrets.compare_digest(self.headers.get(BRIDGE_TOKEN_HEADER, ""), self.server.bridge_token):
            return True
        self._send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid bridge token"})
        return False

    def _read_body(self) -> bytes:
        length = self.headers.get("Content-Length")
        try:
            size = int(length or "0")
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if size < 0 or size > MAX_BODY_BYTES:
            raise ValueError("request body is too large")
        return self.rfile.read(size)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == f"{BRIDGE_PREFIX}/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "bridge": 1})
            return
        if self.path == f"{BRIDGE_PREFIX}/settings":
            if self._authorized():
                try:
                    settings = _read_json_file(self.server.settings_path)
                    # Expose the effective text snapshot to the WebUI so its
                    # in-memory validation matches the bridge's request path.
                    public_text = settings.get("text")
                    merged_text = _merged_text_settings(
                        self.server.settings_path,
                        self.server.developer_settings_path,
                    )
                    if merged_text:
                        settings["text"] = {
                            **(public_text if isinstance(public_text, dict) else {}),
                            **merged_text,
                        }
                    self._send_json(HTTPStatus.OK, settings)
                except ValueError as exc:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        parsed = urllib.parse.urlsplit(self.path)
        prefix = f"{BRIDGE_PREFIX}/cache/"
        if parsed.path.startswith(prefix):
            if not self._authorized():
                return
            key = urllib.parse.unquote(parsed.path[len(prefix):])
            if not _cache_key(key):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid cache key"})
                return
            cache_path = self.server.cache_path(key)
            if not cache_path.is_file():
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "cache entry not found"})
                return
            try:
                self._send_json(HTTPStatus.OK, _read_json_file(cache_path))
            except ValueError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        self._serve_static()

    def do_PATCH(self) -> None:  # noqa: N802
        if self.path != f"{BRIDGE_PREFIX}/settings" or not self._authorized():
            if self.path != f"{BRIDGE_PREFIX}/settings":
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            patch = json.loads(self._read_body().decode("utf-8"))
            if not isinstance(patch, dict) or "ui" not in patch:
                raise ValueError("settings patch must contain ui")
            current = _read_json_file(self.server.settings_path)
            value = _normalize_settings({**current, "ui": patch["ui"]}, current)
            self.server.write_settings(value)
        except (UnicodeDecodeError, ValueError, OSError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == f"{BRIDGE_PREFIX}/screenshots":
            if not self._authorized():
                return
            try:
                payload = json.loads(self._read_body().decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("screenshot request must be an object")
                data_url = payload.get("dataUrl")
                filename = payload.get("filename", "screenshot.png")
                if not isinstance(data_url, str) or not data_url.startswith("data:image/png;base64,"):
                    raise ValueError("screenshot must be a PNG data URL")
                if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", filename):
                    filename = "screenshot.png"
                image = base64.b64decode(data_url.split(",", 1)[1], validate=True)
                if len(image) > MAX_BODY_BYTES:
                    raise ValueError("screenshot is too large")
                self.server.screenshot_root.mkdir(parents=True, exist_ok=True)
                target = self.server.screenshot_root / filename
                target.write_bytes(image)
                self._send_json(HTTPStatus.OK, {"ok": True, "path": str(target)})
            except (UnicodeDecodeError, ValueError, OSError) as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        if self.path != f"{BRIDGE_PREFIX}/chat/completions" or not self._authorized():
            if self.path != f"{BRIDGE_PREFIX}/chat/completions":
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            payload = json.loads(self._read_body().decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request must be a JSON object")
            settings = _merged_text_settings(self.server.settings_path, self.server.developer_settings_path)
            api_key = settings.get("api", "")
            model = settings.get("model", "")
            endpoint = _chat_url(str(settings.get("requestUrl", "")))
            if not api_key or not model or not endpoint:
                raise ValueError("text AI settings are incomplete")
            payload["model"] = model
            response_status, response_body, response_type = self.server.forward_chat(endpoint, api_key, payload)
        except (UnicodeDecodeError, ValueError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": {"message": str(exc)}})
            return
        self._send_bytes(response_status, response_body, response_type)

    def do_DELETE(self) -> None:  # noqa: N802
        if not self.path.startswith(f"{BRIDGE_PREFIX}/cache") or not self._authorized():
            if not self.path.startswith(f"{BRIDGE_PREFIX}/cache"):
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        parsed = urllib.parse.urlsplit(self.path)
        prefix = f"{BRIDGE_PREFIX}/cache/"
        try:
            if parsed.path == f"{BRIDGE_PREFIX}/cache":
                self.server.clear_cache()
            elif parsed.path.startswith(prefix):
                key = urllib.parse.unquote(parsed.path[len(prefix):])
                if not _cache_key(key):
                    raise ValueError("invalid cache key")
                self.server.delete_cache(key)
            else:
                raise ValueError("invalid cache path")
        except (ValueError, OSError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True})

    def do_PUT(self) -> None:  # noqa: N802
        prefix = f"{BRIDGE_PREFIX}/cache/"
        if self.path.startswith(prefix):
            if not self._authorized():
                return
            key = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path[len(prefix):])
            try:
                if not _cache_key(key):
                    raise ValueError("invalid cache key")
                value = json.loads(self._read_body().decode("utf-8"))
                if not isinstance(value, dict) or not isinstance(value.get("chemvz"), dict):
                    raise ValueError("cache entry must contain chemvz object")
                self.server.write_cache(key, value)
            except (UnicodeDecodeError, ValueError, OSError) as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True})
            return
        # Settings PUT is handled by the original route below.
        if self.path != f"{BRIDGE_PREFIX}/settings" or not self._authorized():
            if self.path != f"{BRIDGE_PREFIX}/settings":
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            value = _normalize_settings(
                json.loads(self._read_body().decode("utf-8")),
                _read_json_file(self.server.settings_path),
            )
            self.server.write_settings(value)
        except (UnicodeDecodeError, ValueError, OSError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True})

    def _serve_static(self) -> None:
        requested = self.path.split("?", 1)[0]
        relative = "index.html" if requested in ("", "/") else requested.lstrip("/")
        candidate = (self.server.dist_root / relative).resolve()
        try:
            candidate.relative_to(self.server.dist_root.resolve())
        except ValueError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not candidate.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            body = candidate.read_bytes()
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.name == "index.html":
            bridge = json.dumps(
                {
                    "token": self.server.bridge_token,
                    "version": 1,
                    "developerConfigured": self.server.developer_text_configured,
                },
                ensure_ascii=True,
                separators=(",", ":"),
            )
            marker = b"</head>"
            injection = f'<script>window.__CHEMVIZ_DESKTOP_BRIDGE__={bridge};</script>'.encode("utf-8")
            body = body.replace(marker, injection + marker, 1)
        self._send_bytes(HTTPStatus.OK, body, content_type)


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        app_root: Path,
        config_dir: Path | None = None,
        token: str | None = None,
    ):
        super().__init__(address, BridgeHandler)
        self.app_root = app_root.resolve()
        self.dist_root = (self.app_root / "dist").resolve()
        resolved_config = (config_dir or self.app_root).resolve()
        self.settings_path = resolved_config / "settings.int"
        if not self.settings_path.is_file():
            bundled_settings = self.app_root / "settings.int"
            if bundled_settings.is_file():
                self.settings_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(bundled_settings, self.settings_path)
        self.cache_root = resolved_config / "molecules" / "cache"
        self.developer_settings_path = self.app_root / "settings.developer.int"
        self.screenshot_root = Path.cwd() / "screenshots"
        self.bridge_token = token or secrets.token_urlsafe(32)
        effective_text = _merged_text_settings(self.settings_path, self.developer_settings_path)
        self.developer_text_configured = bool(
            self.developer_settings_path.is_file()
            and effective_text.get("api")
            and effective_text.get("model")
            and _chat_url(str(effective_text.get("requestUrl", "")))
        )

    def write_settings(self, value: dict[str, Any]) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".settings.int.", dir=self.settings_path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.settings_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def cache_path(self, key: str) -> Path:
        if not _cache_key(key):
            raise ValueError("invalid cache key")
        return self.cache_root / f"{key}.json"

    def write_cache(self, key: str, value: dict[str, Any]) -> None:
        path = self.cache_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{key}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def delete_cache(self, key: str) -> None:
        try:
            self.cache_path(key).unlink()
        except FileNotFoundError:
            pass

    def clear_cache(self) -> None:
        if not self.cache_root.is_dir():
            return
        for path in self.cache_root.glob("v1-*.json"):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    def _read_upstream_error(error: urllib.error.HTTPError) -> tuple[int, bytes, str]:
        body = error.read()
        content_type = error.headers.get_content_type() or "application/json"
        return error.code, body, content_type

    def forward_chat(self, endpoint: str, api_key: str, payload: dict[str, Any]) -> tuple[int, bytes, str]:
        request = urllib.request.Request(
            endpoint,
            data=_json_bytes(payload),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {api_key}",
                # Some OpenAI-compatible gateways reject Python's default
                # `Python-urllib/...` User-Agent as automated traffic.
                "User-Agent": "Mozilla/5.0 (ChemViz3D desktop client)",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                content_type = response.headers.get_content_type() or "application/json"
                return response.status, response.read(MAX_BODY_BYTES), content_type
        except urllib.error.HTTPError as error:
            return self._read_upstream_error(error)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return HTTPStatus.BAD_GATEWAY, _json_bytes({"error": {"message": f"AI API request failed: {error}"}}), "application/json"
