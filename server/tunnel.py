"""
Clifton Down: Zero-Port Tunnel Manager
Automates Cloudflare Quick Tunnel for instantaneous zero-config public access.
"""

import io
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
from typing import Optional


def get_local_ip() -> str:
    """Detect the local machine's LAN IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Does not actually send data; determines outbound routing interface
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


class TunnelManager:
    """Manages the lifecycle of a Cloudflare Quick Tunnel."""

    def __init__(self, local_port: int = 8080, bin_dir: Optional[str] = None):
        self.local_port = local_port
        self.bin_dir = bin_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".bin")
        self.process: Optional[subprocess.Popen] = None
        self.public_url: Optional[str] = None

    def find_or_fetch_cloudflared(self) -> Optional[str]:
        """Finds cloudflared in PATH or downloads standalone binary if missing."""
        # 1. Check system PATH
        system_bin = shutil.which("cloudflared")
        if system_bin:
            return system_bin

        # 2. Check local bin directory
        os.makedirs(self.bin_dir, exist_ok=True)
        local_bin = os.path.join(self.bin_dir, "cloudflared")
        if os.path.exists(local_bin) and os.access(local_bin, os.X_OK):
            return local_bin

        # 3. Attempt download based on system architecture
        system = platform.system().lower()
        arch = platform.machine().lower()

        url_map = {
            ("darwin", "arm64"): "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
            ("darwin", "x86_64"): "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
            ("linux", "x86_64"): "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            ("linux", "aarch64"): "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
        }

        download_url = url_map.get((system, arch))
        if not download_url:
            return None

        try:
            print("⬇️  Downloading standalone Cloudflare Quick Tunnel helper binary...")
            req = urllib.request.Request(download_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()

            if download_url.endswith(".tgz"):
                with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                    tar.extract("cloudflared", path=self.bin_dir)
            else:
                with open(local_bin, "wb") as f:
                    f.write(data)

            os.chmod(local_bin, 0o755)
            print("✅ Cloudflare Quick Tunnel binary ready.")
            return local_bin
        except Exception as e:
            print(f"⚠️  Could not download cloudflared binary: {e}")
            if os.path.exists(local_bin):
                try:
                    os.remove(local_bin)
                except OSError:
                    pass
            return None

    def start_tunnel(self, timeout_sec: int = 25) -> Optional[str]:
        """Starts the tunnel subprocess and captures the generated trycloudflare.com URL."""
        bin_path = self.find_or_fetch_cloudflared()
        if not bin_path:
            return None

        cmd = [
            bin_path,
            "tunnel",
            "--url",
            f"http://127.0.0.1:{self.local_port}",
            "--metrics",
            "127.0.0.1:0"
        ]

        try:
            # cloudflared logs the tunnel URL to stderr
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )

            start_time = time.time()
            url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

            while time.time() - start_time < timeout_sec:
                if self.process.poll() is not None:
                    break

                line = self.process.stderr.readline()
                if line:
                    match = url_pattern.search(line)
                    if match:
                        self.public_url = match.group(0)
                        return self.public_url

                time.sleep(0.05)

        except Exception as e:
            print(f"⚠️  Error starting tunnel: {e}")

        return self.public_url

    def stop(self):
        """Stops the tunnel process cleanly."""
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
                self.process.wait(timeout=2.0)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
        self.process = None
