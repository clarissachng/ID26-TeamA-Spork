#!/usr/bin/env python3
"""
launcher.py — While It Steeps: Unified Bridge Launcher
=======================================================
Auto-detects serial ports and manages both Play and Tutorial modes.
The frontend signals which mode to run via "ui_state" WebSocket messages.

Usage:
    python launcher.py
    python launcher.py --mag-port COM6 --nfc-port COM8
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import websockets
import serial.tools.list_ports

import bridge_common
import bridge_play
import bridge_tutorial
import bridge_choreo

# ── Port detection ─────────────────────────────────────────────────────────

_ARDUINO_VIDS = {0x2341, 0x1A86, 0x0403, 0x10C4}
_ARDUINO_KEYWORDS = ("arduino", "ch340", "ftdi", "cp210", "usb serial", "usbmodem")

def find_arduino_ports() -> list[str]:
    matched: list[str] = []
    all_ports = list(serial.tools.list_ports.comports())
    for p in all_ports:
        is_arduino = (p.vid in _ARDUINO_VIDS) if p.vid else False
        if not is_arduino:
            desc = (p.description or "").lower()
            is_arduino = any(kw in desc for kw in _ARDUINO_KEYWORDS)
        if is_arduino:
            matched.append(p.device)
    return matched if matched else [p.device for p in all_ports]

def resolve_ports(mag_arg: str | None, nfc_arg: str | None) -> tuple[str, str]:
    if mag_arg and nfc_arg:
        return mag_arg, nfc_arg
    detected = find_arduino_ports()
    if len(detected) < 2 and not (mag_arg or nfc_arg):
        print(f"  [!] Need 2 serial ports but found {len(detected)}.")
        sys.exit(1)
    return mag_arg or detected[0], nfc_arg or (detected[1] if len(detected) > 1 else detected[0])

# ── WebSocket Handler ──────────────────────────────────────────────────────

async def ws_handler(websocket):
    bridge_common.connected_clients.add(websocket)
    print(f"  [WS] Client connected: {websocket.remote_address}")
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            
            if msg.get("ready"):
                bridge_play.set_ready()
            
            elif msg.get("type") == "ui_state":
                page = msg.get("page", "")
                print(f"  [WS] UI State: {page}")
                
                if page == "play":
                    await bridge_tutorial.cancel_session()
                    await bridge_choreo.cancel_session()
                    await bridge_play.handle_ui_state(msg)
                elif page == "tutorial":
                    await bridge_play.cancel_session()
                    await bridge_choreo.cancel_session()
                    await bridge_tutorial.handle_ui_state(msg)
                elif page == "choreograph":
                    await bridge_play.cancel_session()
                    await bridge_tutorial.cancel_session()
                    await bridge_choreo.handle_ui_state(msg)
                else:
                    await bridge_play.cancel_session()
                    await bridge_tutorial.cancel_session()
                    await bridge_choreo.cancel_session()
                    await bridge_common.broadcast({"type": "state", "state": "idle"})
    finally:
        bridge_common.connected_clients.discard(websocket)
        print(f"  [WS] Client disconnected: {websocket.remote_address}")

# ── Main Entry ─────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="While It Steeps — Unified Launcher")
    parser.add_argument("--mag-port", "-m", help="Magnetometer port")
    parser.add_argument("--nfc-port", "-n", help="NFC port")
    args = parser.parse_args()

    mag_port, nfc_port = resolve_ports(args.mag_port, args.nfc_port)

    print()
    print("  ═══════════════════════════════════════")
    print("    While It Steeps — Unified Launcher")
    print("  ═══════════════════════════════════════")
    print(f"  Mag port : {mag_port}")
    print(f"  NFC port : {nfc_port}")
    print(f"  WS       : ws://{bridge_common.WS_HOST}:{bridge_common.WS_PORT}")
    print()

    async with websockets.serve(ws_handler, bridge_common.WS_HOST, bridge_common.WS_PORT):
        print(f"  [OK] WebSocket server started\n")
        await asyncio.gather(
            bridge_common.arduino_a_reader(mag_port),
            bridge_common.arduino_b_reader(nfc_port),
            bridge_common.sensor_broadcaster(),
            return_exceptions=True,
        )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  [Launcher] Shutting down.")
