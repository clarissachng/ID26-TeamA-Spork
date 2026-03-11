#!/usr/bin/env python3
"""
Serial -> WebSocket Bridge for Game (v2)
=========================================
Reads magnetometer JSON from Arduino over serial, runs real-time
motion detection via the Detector class, and broadcasts results
to the webapp via WebSocket (ws://localhost:8765).

Usage:
    python bridge_v2.py                  # auto-detect port, guided detection
    python bridge_v2.py --raw            # just print raw data (hardware test)
    python bridge_v2.py --port COM3      # specify serial port

Requirements:
    pip install pyserial websockets numpy
"""

import argparse
import asyncio
import json
import math
import sys
import time

# Fix Windows terminal encoding for special characters
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import serial
import serial.tools.list_ports
import websockets

from detector import Detector


# -- Configuration -----------------------------------------
WS_HOST = "localhost"
WS_PORT = 8765
BAUD_RATE = 115200
SAMPLE_RATE = 25           # Hz  (Arduino sends every 40ms)

# Guided detection timing
CALIBRATION_SECONDS = 2.0  # hold-still baseline collection
COUNTDOWN_SECONDS = 3.0    # "get ready" phase before recording
RECORDING_SECONDS = 8.0    # motion capture window
COOLDOWN_SECONDS = 3.0     # pause between rounds (shows result)
MIN_MOTION_SAMPLES = 8     # minimum samples in extracted motion portion


# -- Auto-detect Arduino serial port ----------------------
def find_serial_port() -> str | None:
    """Find the first likely Arduino/USB serial port."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        mfr = (p.manufacturer or "").lower()
        if any(kw in desc for kw in ["arduino", "ch340", "cp210", "ftdi", "usbmodem", "usbserial", "usb serial", "esp32", "esp"]):
            return p.device
        if any(kw in mfr for kw in ["arduino", "wch", "silicon labs", "ftdi", "espressif"]):
            return p.device
    # Fallback: any non-Bluetooth serial port
    for p in ports:
        desc = (p.description or "").lower()
        if "bluetooth" not in desc:
            return p.device
    return None


# -- WebSocket server --------------------------------------
start_event = asyncio.Event()
connected_clients: set = set()


async def ws_handler(websocket):
    """Handle a new WebSocket client connection."""
    connected_clients.add(websocket)
    remote = websocket.remote_address
    print(f"  [WS] Client connected: {remote}")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                cmd = data.get("command", "")
                if cmd == "start":
                    start_event.set()
                    print("  [WS] Received 'start' command")
            except (json.JSONDecodeError, AttributeError):
                pass
    finally:
        connected_clients.discard(websocket)
        print(f"  [WS] Client disconnected: {remote}")


async def broadcast(message: dict):
    """Send a JSON message to all connected WebSocket clients."""
    if not connected_clients:
        return
    data = json.dumps(message)
    await asyncio.gather(
        *[client.send(data) for client in connected_clients],
        return_exceptions=True,
    )


# -- Serial reader ----------------------------------------
async def serial_reader(port: str, raw_mode: bool = False, baud_rate: int = BAUD_RATE):
    """
    Read JSON lines from Arduino serial, run guided detection,
    and broadcast results over WebSocket.
    """
    detector = Detector()
    sample_count = 0

    print(f"\n  [SER] Opening serial port: {port} @ {baud_rate} baud")

    try:
        ser = serial.Serial(port, baud_rate, timeout=1)
    except serial.SerialException as e:
        print(f"  [X] Could not open {port}: {e}")
        print("    Available ports:")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        return

    # Flush stale data
    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  [OK] Serial connected -- reading data...\n")

    try:
        while True:
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

            sample_count += 1

            if raw_mode:
                mag_d = math.sqrt(x_raw * x_raw + y_raw * y_raw + z_raw * z_raw)
                print(
                    f"  #{sample_count:>5}  "
                    f"x={x_raw:>8.1f}  y={y_raw:>8.1f}  z={z_raw:>8.1f}  "
                    f"|mag|={mag_d:>7.1f}"
                )
                await broadcast({
                    "raw": True,
                    "x": round(x_raw, 2),
                    "y": round(y_raw, 2),
                    "z": round(z_raw, 2),
                    "mag": round(mag_d, 2),
                })
                continue

            # Guided detection mode
            events = detector.add_sample(x_raw, y_raw, z_raw)

            # Broadcast state on every sample
            await broadcast({
                "sensor": True,
                "x": round(x_raw - detector._baseline_x, 2),
                "y": round(y_raw - detector._baseline_y, 2),
                "z": round(z_raw - detector._baseline_z, 2),
                "mag": round(detector.last_mag, 2),
                "state": detector.state,
                "phase_remaining": round(detector.phase_remaining, 1),
                "noise_floor": round(detector._noise_floor, 1),
                "recording_samples": len(detector._rec_buffer),
            })

            for event in events:
                print(
                    f"\n  [>>] DETECTED: {event['motion'].upper()}  "
                    f"confidence={event['confidence']:.0%}"
                )
                await broadcast(event)

    except KeyboardInterrupt:
        pass
    finally:
        ser.close()
        print("\n  Serial port closed.")


# -- Main --------------------------------------------------
async def main():
    parser = argparse.ArgumentParser(description="While It Steeps: Arduino -> WebSocket bridge")
    parser.add_argument("--port", "-p", help="Serial port. Auto-detects if omitted.")
    parser.add_argument("--raw", "-r", action="store_true", help="Raw mode -- just print sensor values.")
    parser.add_argument("--baud", "-b", type=int, default=BAUD_RATE, help=f"Baud rate (default: {BAUD_RATE})")
    args = parser.parse_args()

    port = args.port or find_serial_port()
    if not port:
        print("  [X] No Arduino serial port found.")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        sys.exit(1)

    mode = "RAW (hardware test)" if args.raw else "GUIDED DETECTION"
    print()
    print("  ===========================================")
    print("    While It Steeps -- Arduino Bridge")
    print("  ===========================================")
    print()
    print(f"  Mode : {mode}")
    print(f"  Port : {port}")
    print(f"  Baud : {args.baud}")
    print(f"  WS   : ws://{WS_HOST}:{WS_PORT}")
    print()
    print(f"  Detection cycle:")
    print(f"    1. CALIBRATE   {CALIBRATION_SECONDS:.0f}s  (hold still)")
    print(f"    2. COUNTDOWN   {COUNTDOWN_SECONDS:.0f}s  (get ready)")
    print(f"    3. RECORDING   {RECORDING_SECONDS:.0f}s  (perform motion)")
    print(f"    4. CLASSIFY    (instant)")
    print(f"    5. COOLDOWN    {COOLDOWN_SECONDS:.0f}s  (shows result)")
    print(f"    -> repeat from step 1")
    print()

    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        print(f"  [OK] WebSocket server on ws://{WS_HOST}:{WS_PORT}")
        print(f"  [OK] Starting serial reader...\n")
        await serial_reader(port, raw_mode=args.raw, baud_rate=args.baud)


if __name__ == "__main__":
    asyncio.run(main())
