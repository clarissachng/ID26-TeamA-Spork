#!/usr/bin/env python3
"""
Serial → WebSocket Bridge for Spork
====================================
Reads magnetometer JSON from Arduino over serial, runs real-time
motion detection using saved profiles, and broadcasts results to
the webapp via WebSocket (ws://localhost:8765).

Usage:
    python bridge.py                        # auto-detect serial port
    python bridge.py --port /dev/cu.usbmodem14201
    python bridge.py --raw                  # just print raw data (hardware test)

Requirements:
    pip install pyserial websockets numpy
"""

import argparse
import asyncio
import json
import math
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np
import serial
import serial.tools.list_ports
import websockets


# ── Configuration ─────────────────────────────────────────
WS_HOST = "localhost"
WS_PORT = 8765
BAUD_RATE = 115200
SAMPLE_RATE = 25          # Hz  (Arduino sends every 40ms)
BUFFER_SIZE = 50           # ~2 seconds of data
DETECTION_COOLDOWN = 1.0   # seconds between same-motion detections

# ── Load motion profiles ─────────────────────────────────
PROFILES_PATH = Path(__file__).parent.parent / "plots" / "motion_profiles.json"
WEBAPP_PROFILES_PATH = Path(__file__).parent.parent / "webapp" / "public" / "motion_profiles.json"


def load_profiles() -> dict:
    """Try to load motion_profiles.json from either location."""
    for path in [PROFILES_PATH, WEBAPP_PROFILES_PATH]:
        if path.exists():
            with open(path) as f:
                data = json.load(f)
            print(f"  ✓ Loaded profiles from {path}")
            return data
    print("  ⚠ No motion_profiles.json found — using defaults")
    return {}


profiles = load_profiles()
baseline = profiles.get("baseline_offsets", {"x": 0, "y": 0, "z": 0})
motions = profiles.get("motions", {})


# ── Auto-detect Arduino serial port ──────────────────────
def find_serial_port() -> str | None:
    """Find the first likely Arduino/USB serial port."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        mfr = (p.manufacturer or "").lower()
        if any(kw in desc for kw in ["arduino", "ch340", "cp210", "ftdi", "usbmodem", "usbserial"]):
            return p.device
        if any(kw in mfr for kw in ["arduino", "wch", "silicon labs", "ftdi"]):
            return p.device
    # Fallback: return any /dev/cu.usb* or COM port
    for p in ports:
        if "usb" in p.device.lower():
            return p.device
    return None


# ── Simple real-time motion detector ─────────────────────
class RealtimeDetector:
    """
    Buffers recent readings and checks for each motion type
    based on magnitude thresholds and axis activity patterns.
    """

    def __init__(self):
        self.buffer: deque[dict] = deque(maxlen=BUFFER_SIZE)
        self.last_detection: dict[str, float] = {}

    def add_sample(self, x: float, y: float, z: float) -> list[dict]:
        """
        Add a calibrated (baseline-subtracted) sample.
        Returns a list of detection events (usually 0 or 1).
        """
        mag = math.sqrt(x * x + y * y + z * z)
        self.buffer.append({"x": x, "y": y, "z": z, "mag": mag, "t": time.time()})

        if len(self.buffer) < 10:
            return []

        detections = []
        now = time.time()

        for name, profile in motions.items():
            if name == "baseline":
                continue

            threshold = profile.get("detection_threshold_uT", 100)
            min_samples = profile.get("min_active_samples", 5)

            # Count recent samples above threshold
            recent = list(self.buffer)[-min_samples * 2:]
            above = sum(1 for s in recent if s["mag"] > threshold)

            if above >= min_samples:
                # Cooldown check
                last = self.last_detection.get(name, 0)
                if now - last < DETECTION_COOLDOWN:
                    continue

                # Compute a rough confidence (0.5 – 1.0)
                confidence = min(1.0, 0.5 + (above / len(recent)) * 0.5)

                # Extra axis-match bonus
                most_active = profile.get("most_active_axis", "x")
                vals = [abs(s[most_active]) for s in recent]
                if np.mean(vals) > threshold * 0.3:
                    confidence = min(1.0, confidence + 0.1)

                detections.append({
                    "motion": name,
                    "detected": True,
                    "confidence": round(confidence, 2),
                })
                self.last_detection[name] = now

        # If multiple detections, pick the highest confidence
        if len(detections) > 1:
            detections.sort(key=lambda d: d["confidence"], reverse=True)
            return [detections[0]]

        return detections


# ── WebSocket server ──────────────────────────────────────
connected_clients: set = set()


async def ws_handler(websocket):
    """Handle a new WebSocket client connection."""
    connected_clients.add(websocket)
    remote = websocket.remote_address
    print(f"  🌐 Client connected: {remote}")
    try:
        async for _ in websocket:
            pass  # We only send, but keep connection alive
    finally:
        connected_clients.discard(websocket)
        print(f"  🌐 Client disconnected: {remote}")


async def broadcast(message: dict):
    """Send a JSON message to all connected WebSocket clients."""
    if not connected_clients:
        return
    data = json.dumps(message)
    await asyncio.gather(
        *[client.send(data) for client in connected_clients],
        return_exceptions=True,
    )


# ── Serial reader ────────────────────────────────────────
async def serial_reader(port: str, raw_mode: bool = False, baud_rate: int = BAUD_RATE):
    """
    Read JSON lines from Arduino serial, run detection,
    and broadcast results over WebSocket.
    """
    detector = RealtimeDetector()
    sample_count = 0

    print(f"\n  📡 Opening serial port: {port} @ {baud_rate} baud")

    try:
        ser = serial.Serial(port, baud_rate, timeout=1)
    except serial.SerialException as e:
        print(f"  ✗ Could not open {port}: {e}")
        print("    Make sure Arduino is plugged in and the port is correct.")
        print("    Available ports:")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  — {p.description}")
        return

    # Flush stale data
    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  ✓ Serial connected — reading data...\n")

    try:
        while True:
            # Read in executor to avoid blocking the event loop
            line = await asyncio.get_event_loop().run_in_executor(
                None, ser.readline
            )

            if not line:
                continue

            try:
                text = line.decode("utf-8", errors="ignore").strip()
                if not text:
                    continue
                data = json.loads(text)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

            x_raw = data.get("x", 0)
            y_raw = data.get("y", 0)
            z_raw = data.get("z", 0)

            # Subtract baseline
            x = x_raw - baseline.get("x", 0)
            y = y_raw - baseline.get("y", 0)
            z = z_raw - baseline.get("z", 0)
            mag = math.sqrt(x * x + y * y + z * z)

            sample_count += 1

            if raw_mode:
                # Raw mode: just print values for hardware testing
                print(
                    f"  #{sample_count:>5}  "
                    f"x={x_raw:>8.1f}  y={y_raw:>8.1f}  z={z_raw:>8.1f}  "
                    f"(cal: x={x:>7.1f} y={y:>7.1f} z={z:>7.1f}  |mag|={mag:>7.1f})"
                )
                # Also broadcast raw data so the webapp can display it
                await broadcast({
                    "raw": True,
                    "x": round(x_raw, 2),
                    "y": round(y_raw, 2),
                    "z": round(z_raw, 2),
                    "mag": round(mag, 2),
                })
                continue

            # Detection mode
            events = detector.add_sample(x, y, z)

            # Print magnitude periodically so you can see the sensor is alive
            if sample_count % 25 == 0:
                print(
                    f"  📊 #{sample_count:>5}  |mag|={mag:>7.1f} µT  "
                    f"(x={x:>7.1f} y={y:>7.1f} z={z:>7.1f})"
                )

            for event in events:
                print(
                    f"  🎯 Detected: {event['motion']:>12}  "
                    f"confidence={event['confidence']:.0%}"
                )
                await broadcast(event)

            # Periodic heartbeat (every ~2s) so clients know we're alive
            if sample_count % 50 == 0:
                await broadcast({
                    "heartbeat": True,
                    "samples": sample_count,
                    "mag": round(mag, 2),
                })

    except KeyboardInterrupt:
        pass
    finally:
        ser.close()
        print("\n  Serial port closed.")


# ── Main ──────────────────────────────────────────────────
async def main():
    parser = argparse.ArgumentParser(description="Spork: Arduino → WebSocket bridge")
    parser.add_argument(
        "--port", "-p",
        help="Serial port (e.g. /dev/cu.usbmodem14201 or COM3). Auto-detects if omitted.",
    )
    parser.add_argument(
        "--raw", "-r",
        action="store_true",
        help="Raw mode — just print sensor values (for hardware testing).",
    )
    parser.add_argument(
        "--baud", "-b",
        type=int,
        default=BAUD_RATE,
        help=f"Baud rate (default: {BAUD_RATE})",
    )
    args = parser.parse_args()

    baud = args.baud

    # Find serial port
    port = args.port or find_serial_port()
    if not port:
        print("  ✗ No Arduino serial port found.")
        print("    Available ports:")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  — {p.description}")
        print("\n    Specify manually:  python bridge.py --port /dev/cu.usbmodem14201")
        sys.exit(1)

    print(r"""
    ╔═══════════════════════════════════════╗
    ║   ☕  Spork — Arduino Bridge          ║
    ╚═══════════════════════════════════════╝
    """)

    mode = "RAW (hardware test)" if args.raw else "DETECTION"
    print(f"  Mode : {mode}")
    print(f"  Port : {port}")
    print(f"  Baud : {baud}")
    print(f"  WS   : ws://{WS_HOST}:{WS_PORT}")

    # Start WebSocket server
    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        print(f"\n  ✓ WebSocket server running on ws://{WS_HOST}:{WS_PORT}")
        print("  ✓ Waiting for webapp to connect...\n")

        # Start serial reader
        await serial_reader(port, raw_mode=args.raw, baud_rate=baud)


if __name__ == "__main__":
    asyncio.run(main())
