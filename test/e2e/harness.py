"""Shared Playwright harness for Virtual Dog Walker E2E tests.

Serves the game directory over a local HTTP server and drives the game via
the ``window.__vdwDebug`` hook exposed when the page is loaded with
``?debug=1``.
"""

from __future__ import annotations

import atexit
import functools
import http.server
import os
import threading
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Static file server
# ---------------------------------------------------------------------------

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if os.path.isfile(os.path.join(_REPO_ROOT, "index.html")):
    _DEFAULT_SERVE_DIR = _REPO_ROOT
else:
    _DEFAULT_SERVE_DIR = os.path.join(_REPO_ROOT, "virtual_dog_walker")


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with silenced logging and JS/WASM MIME types."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".wasm": "application/wasm",
    }

    def log_message(self, *args, **kwargs):  # noqa: D401 - silence spam
        return


def _start_server(serve_dir: str):
    handler = functools.partial(_QuietHandler, directory=serve_dir)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread


# ---------------------------------------------------------------------------
# Shared Playwright browser singleton
# ---------------------------------------------------------------------------

_playwright = None
_browser = None
_browser_lock = threading.Lock()


def _get_browser():
    global _playwright, _browser
    with _browser_lock:
        if _browser is None:
            from playwright.sync_api import sync_playwright

            _playwright = sync_playwright().start()
            _browser = _playwright.chromium.launch(headless=True)
        return _browser


def _shutdown_browser():
    global _playwright, _browser
    with _browser_lock:
        try:
            if _browser is not None:
                _browser.close()
        except Exception:
            pass
        _browser = None
        try:
            if _playwright is not None:
                _playwright.stop()
        except Exception:
            pass
        _playwright = None


atexit.register(_shutdown_browser)


# ---------------------------------------------------------------------------
# Error filtering
# ---------------------------------------------------------------------------

_IGNORED_ERROR_SUBSTRINGS = (
    "WebSocket",
    "ERR_CONNECTION_REFUSED",
    "ERR_NAME_NOT_RESOLVED",
    "Failed to fetch",
    "open-meteo",
    "workers.dev",
    "net::ERR_",
    "ERR_BLOCKED_BY_CLIENT",
    "status of 503",
)

# Errors mentioning these tokens are NEVER ignored (WASM init failures must
# surface as test failures).
_NEVER_IGNORED_SUBSTRINGS = (
    "wasm",
    "dog_walker_core",
    "WasmSimBridge",
)


def _is_ignored_error(message: str) -> bool:
    if any(token in message for token in _NEVER_IGNORED_SUBSTRINGS):
        return False
    return any(token in message for token in _IGNORED_ERROR_SUBSTRINGS)


# ---------------------------------------------------------------------------
# GameSession
# ---------------------------------------------------------------------------


class GameSession:
    """Context manager that serves the game and drives it via ``__vdwDebug``."""

    def __init__(
        self,
        serve_dir: Optional[str] = None,
        unlock_home: bool = True,
        pause_loop: bool = True,
        clear_care: bool = True,
    ):
        self.serve_dir = serve_dir or os.environ.get("VDW_E2E_SERVE_DIR") or _DEFAULT_SERVE_DIR
        self.unlock_home = unlock_home
        self.pause_loop = pause_loop
        self.clear_care = clear_care
        self._httpd = None
        self._thread = None
        self._browser = None
        self._context = None
        self.page = None
        self.errors: List[str] = []

    def __enter__(self) -> "GameSession":
        self._httpd, self._thread = _start_server(self.serve_dir)
        port = self._httpd.server_address[1]
        self._browser = _get_browser()
        self._context = self._browser.new_context(viewport={"width": 1280, "height": 720})
        self.page = self._context.new_page()

        self.page.on("pageerror", self._on_page_error)
        self.page.on("console", self._on_console)

        # Offline isolation: only allow requests to the local static server
        # (plus data:/blob: URLs). Everything else is aborted so tests never
        # depend on external network availability.
        def _route_filter(route):
            req_url = route.request.url
            if (
                req_url.startswith(f"http://127.0.0.1:{port}")
                or req_url.startswith("data:")
                or req_url.startswith("blob:")
            ):
                route.continue_()
            else:
                route.abort("blockedbyclient")

        self.page.route("**/*", _route_filter)

        url = f"http://127.0.0.1:{port}/?debug=1"
        self.page.goto(url, wait_until="load")
        self.page.wait_for_function(
            "() => window.__vdwDebug && window.__vdwDebug.isReady()",
            timeout=30000,
        )

        if self.pause_loop:
            self.page.evaluate("() => window.__vdwDebug.pauseLoop()")
        else:
            self.page.evaluate("() => window.__vdwDebug.resumeLoop()")
        if self.unlock_home:
            self.page.evaluate("() => window.__vdwDebug.unlockHome()")
        if self.clear_care:
            self.clear_care_needs()

        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self._context is not None:
                self._context.close()
        except Exception:
            pass
        self._context = None
        self.page = None
        try:
            if self._httpd is not None:
                self._httpd.shutdown()
                self._httpd.server_close()
        except Exception:
            pass
        self._httpd = None
        self._thread = None

    # -- error capture -----------------------------------------------------

    def _on_page_error(self, error) -> None:
        message = str(error)
        if not _is_ignored_error(message):
            self.errors.append(f"pageerror: {message}")

    def _on_console(self, msg) -> None:
        try:
            if msg.type == "error":
                text = msg.text
                if not _is_ignored_error(text):
                    self.errors.append(f"console.error: {text}")
        except Exception:
            pass

    # -- debug hook wrappers ----------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        return self.page.evaluate("() => window.__vdwDebug.snapshot()")

    def step(self, dt: float = 1 / 60) -> Dict[str, Any]:
        return self.page.evaluate("(dt) => window.__vdwDebug.step(dt)", dt)

    def step_frames(self, n: int, dt: float = 1 / 60) -> Dict[str, Any]:
        return self.page.evaluate(
            "([n, dt]) => window.__vdwDebug.stepFrames(n, dt)", [n, dt]
        )

    def set_keys(self, **kwargs) -> None:
        self.page.evaluate("(keys) => window.__vdwDebug.setKeys(keys)", kwargs)

    def set_leash(self, is_leashed: bool) -> bool:
        return self.page.evaluate(
            "(v) => window.__vdwDebug.setLeash(v)", bool(is_leashed)
        )

    def set_gait(self, gait: str) -> None:
        self.page.evaluate("(g) => window.__vdwDebug.setGait(g)", gait)

    def set_heading(self, radians: float) -> None:
        self.page.evaluate("(r) => window.__vdwDebug.setHeading(r)", float(radians))

    def warp_to(self, zone_id: str, x: float, y: float) -> None:
        self.page.evaluate(
            "([z, x, y]) => window.__vdwDebug.warpTo(z, x, y)", [zone_id, x, y]
        )

    def get_warp_gates(self) -> List[Dict[str, Any]]:
        return self.page.evaluate("() => window.__vdwDebug.getWarpGates()")

    def get_obstacles(self) -> List[Dict[str, Any]]:
        return self.page.evaluate("() => window.__vdwDebug.getObstacles()")

    def trigger_zoomies(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.triggerZoomies()")

    def advance_care_clock(self, ms: int) -> None:
        self.page.evaluate("(ms) => window.__vdwDebug.advanceCareClock(ms)", ms)

    def clear_care_needs(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.clearCareNeeds()")

    def set_home_locked(self, locked: bool) -> None:
        self.page.evaluate(
            "(v) => window.__vdwDebug.setHomeLocked(v)", bool(locked)
        )

    def press_key(self, code: str) -> None:
        self.page.evaluate("(c) => window.__vdwDebug.pressKey(c)", code)

    def praise(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.praise()")

    def whistle(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.whistle()")

    def throw_ball(self, dx: float = 1.0, dy: float = 0.0) -> None:
        self.page.evaluate(
            "([dx, dy]) => window.__vdwDebug.throwBall(dx, dy)",
            [float(dx), float(dy)],
        )

    def trigger_zoomies(self, path_type: Optional[str] = None) -> None:
        self.page.evaluate(
            "(p) => window.__vdwDebug.triggerZoomies(p)", path_type
        )

    def trigger_poop(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.triggerPoop()")

    def pick_up_nearest_poop(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.pickUpNearestPoop()")

    def dispose_poop_at_nearest_bin(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.disposePoopAtNearestBin()")

    def set_dog_position(self, x: float, y: float) -> None:
        self.page.evaluate(
            "([x, y]) => window.__vdwDebug.setDogPosition(x, y)",
            [float(x), float(y)],
        )

    def spawn_remote_peer(
        self,
        peer_id: str = "peer-test-1",
        x: Optional[float] = None,
        y: Optional[float] = None,
    ) -> int:
        return self.page.evaluate(
            "([peerId, x, y]) => window.__vdwDebug.spawnRemotePeer(peerId, x, y)",
            [peer_id, x, y],
        )

    def clear_remote_peers(self) -> None:
        self.page.evaluate("() => window.__vdwDebug.clearRemotePeers()")

    def trigger_remote_bark(self, peer_id: str = "peer-test-1") -> None:
        self.page.evaluate(
            "(peerId) => window.__vdwDebug.triggerRemoteBark(peerId)", peer_id
        )

    def canvas_pixel_stats(self) -> Dict[str, Any]:
        return self.page.evaluate("() => window.__vdwDebug.canvasPixelStats()")

    def click_canvas(self, x: float, y: float) -> None:
        self.page.mouse.click(x, y)

    def click_selector(self, selector: str) -> None:
        self.page.locator(selector).click()

    def assert_no_errors(self) -> None:
        if self.errors:
            raise AssertionError(
                "Unexpected browser errors:\n" + "\n".join(self.errors)
            )
