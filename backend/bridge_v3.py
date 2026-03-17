#!/usr/bin/env python3
"""
Serial -> WebSocket Bridge for Game (v3)
=========================================
Reads magnetometer JSON from Arduino over serial, runs real-time
motion detection via the Detector class, and broadcasts results
to the webapp via WebSocket (ws://localhost:8765).

NFC Arduino (XIAO ESP32S3) triggers rounds and sends button events.
Each round, a random item is selected and the player must scan that
specific NFC tag to begin motion detection.

Usage:
    python bridge_v3.py --port COM6 --nfc-port COM8
    python bridge_v3.py --port COM6               # no NFC gating
    python bridge_v3.py --raw                     # hardware test

Requirements:
    pip install pyserial websockets numpy
"""

import argparse
import asyncio
import json
import math
import random
import sys

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
SAMPLE_RATE = 25

CALIBRATION_SECONDS = 2.0
COUNTDOWN_SECONDS = 3.0
RECORDING_SECONDS = 8.0
COOLDOWN_SECONDS = 3.0
MIN_MOTION_SAMPLES = 8

# -- NFC Tag Registry --------------------------------------
# Add or remove items here. Key = UID printed by serial monitor (uppercase).
NFC_TAGS = {
    "044F7730C72A81": "Tongs",
    "048C7630C72A81": "Kettle",
    "049AA730C72A81":  "Coffee Press",
    "044BA230C72A81":  "Coffee Grinder",
    "04728F30C72A81":  "Spork",
    "0481AD30C72A81":  "Sieve",
    "049CA830C72A81":  "Tea Bag",
    "04899130C72A81":  "Whisk",
}

VALID_UIDS = set(NFC_TAGS.keys())
current_required_uid: str | None = None   # set at start of each round


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
    for p in serial.tools.list_ports.comports():
        desc = (p.description or "").lower()
        if "bluetooth" not in desc:
            return p.device
    return None


# -- WebSocket server --------------------------------------
connected_clients: set = set()
nfc_trigger = asyncio.Event()


async def ws_handler(websocket):
    """Handle a new WebSocket client connection."""
    connected_clients.add(websocket)
    remote = websocket.remote_address
    print(f"  [WS] Client connected: {remote}")
    try:
        async for message in websocket:
            pass  # no commands expected from webapp currently
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


# -- NFC + Button reader -----------------------------------
async def nfc_reader(port: str, baud_rate: int = BAUD_RATE):
    """
    Read JSON lines from XIAO ESP32S3.
    - NFC scans: validate UID against required tag and set nfc_trigger
    - Button presses: broadcast directly to webapp
    """
    global current_required_uid

    print(f"\n  [NFC] Opening NFC port: {port} @ {baud_rate} baud")

    try:
        ser = serial.Serial(port, baud_rate, timeout=1)
    except serial.SerialException as e:
        print(f"  [X] Could not open NFC port {port}: {e}")
        print("    Available ports:")
        for p in serial.tools.list_ports.comports():
            print(f"      {p.device}  -- {p.description}")
        return

    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  [OK] NFC reader ready -- waiting for scans...\n")

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

            msg_type = data.get("type", "")

            if msg_type == "nfc":
                uid = data.get("uid", "").upper()

                if uid not in VALID_UIDS:
                    # Completely unknown tag
                    print(f"  [NFC] Unknown tag: {uid} — ignored")
                    await broadcast({"nfc": True, "uid": uid, "valid": False})

                elif current_required_uid and uid != current_required_uid:
                    # Known tag but wrong one for this round
                    wrong_item = NFC_TAGS.get(uid, uid)
                    required_item = NFC_TAGS.get(current_required_uid, current_required_uid)
                    print(f"  [NFC] Wrong tag: {wrong_item} — expected {required_item}")
                    await broadcast({
                        "nfc": True,
                        "uid": uid,
                        "valid": False,
                        "scanned_item": wrong_item,
                        "required_item": required_item,
                    })

                else:
                    # Correct tag
                    item_name = NFC_TAGS.get(uid, uid)
                    print(f"  [NFC] Correct tag: {item_name} — triggering round")
                    nfc_trigger.set()
                    await broadcast({
                        "nfc": True,
                        "uid": uid,
                        "valid": True,
                        "item": item_name,
                    })

            elif msg_type == "button":
                btn_id = data.get("id")
                print(f"  [NFC] Button {btn_id} pressed")
                await broadcast({"button": True, "id": btn_id})

    except KeyboardInterrupt:
        pass
    finally:
        ser.close()
        print("\n  NFC serial port closed.")


# -- Serial reader (magnetometer) -------------------------
async def serial_reader(port: str, raw_mode: bool = False, baud_rate: int = BAUD_RATE):
    """
    Read JSON lines from magnetometer Arduino, run guided detection,
    and broadcast results over WebSocket.
    """
    global current_required_uid

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

    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  [OK] Serial connected -- reading data...\n")

    try:
        while True:
            # Wait for NFC scan before each round (skipped in raw mode)
            if not raw_mode:
                # Pick a random required item for this round
                current_required_uid = random.choice(list(NFC_TAGS.keys()))
                item_name = NFC_TAGS[current_required_uid]

                print(f"  [SER] Waiting for NFC scan...")
                print(f"  [SER] Required item this round: {item_name}\n")

                await broadcast({
                    "state": "waiting_for_nfc",
                    "required_item": item_name,
                    "required_uid": current_required_uid,
                })

                await nfc_trigger.wait()
                nfc_trigger.clear()
                current_required_uid = None
                detector = Detector()
                print("  [SER] Starting detection round\n")

            # Run one full detection round
            round_complete = False
            while not round_complete:
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
                    mag_d = math.sqrt(x_raw**2 + y_raw**2 + z_raw**2)
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
                    continue  # raw mode loops forever, no round concept

                events = detector.add_sample(x_raw, y_raw, z_raw)

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

                    # Round ends when a result is classified and cooldown begins
                    if event.get("motion") and detector.state == "cooldown":
                        round_complete = True

    except KeyboardInterrupt:
        pass
    finally:
        ser.close()
        print("\n  Serial port closed.")


# -- Main --------------------------------------------------
async def main():
    parser = argparse.ArgumentParser(description="While It Steeps: Arduino -> WebSocket bridge")
    parser.add_argument("--port", "-p", help="Magnetometer serial port. Auto-detects if omitted.")
    parser.add_argument("--nfc-port", "-n", help="NFC Arduino serial port (XIAO ESP32S3).")
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
    print(f"  Mode     : {mode}")
    print(f"  Mag port : {port}")
    print(f"  NFC port : {args.nfc_port or 'not connected'}")
    print(f"  Baud     : {args.baud}")
    print(f"  WS       : ws://{WS_HOST}:{WS_PORT}")
    print()
    print(f"  Registered items ({len(NFC_TAGS)}):")
    for uid, name in NFC_TAGS.items():
        print(f"    {name:<20} {uid}")
    print()

    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        print(f"  [OK] WebSocket server on ws://{WS_HOST}:{WS_PORT}")

        tasks = [serial_reader(port, raw_mode=args.raw, baud_rate=args.baud)]

        if args.nfc_port:
            tasks.append(nfc_reader(args.nfc_port, baud_rate=args.baud))
        else:
            print("  [!] No --nfc-port specified. NFC gating disabled — rounds start immediately.\n")
            nfc_trigger.set()

        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
