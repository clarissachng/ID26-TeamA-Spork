#!/usr/bin/env python3
"""
bridge_common.py — While It Steeps: Shared Bridge Utilities
============================================================
Shared serial readers, WebSocket broadcaster, and sensor state.
Used by launcher.py, bridge_play.py, and bridge_tutorial.py.
"""

import asyncio
import json
import math
import sys
import time
import serial
import serial.tools.list_ports
from classifier import NFC_TAGS

from typing import Any, Dict, Set, Tuple

# ── Configuration ──────────────────────────────────────────────────────────
WS_HOST   = "localhost"
WS_PORT   = 8765
BAUD_RATE = 115200

# ── Shared state ───────────────────────────────────────────────────────────
connected_clients: Set          = set()
_latest_sensor:    Dict[str, Any] | None  = None
_nfc_queue:        asyncio.Queue = asyncio.Queue()
_knob_queue:       asyncio.Queue = asyncio.Queue()
_mag_baseline:     Tuple[float, float, float] = (0.0, 0.0, 0.0)
_state_ref:        list[str] = ["idle"]

async def broadcast(msg: dict) -> None:
    if not connected_clients:
        print(f"  [WS] Warning: No clients connected to broadcast message: {msg.get('type')}")
        return
    # print(f"  [WS] Broadcasting: {msg.get('type')}")
    data = json.dumps(msg)
    await asyncio.gather(
        *[c.send(data) for c in connected_clients],
        return_exceptions=True,
    )

# ── Arduino B reader (NFC + Knob) ──────────────────────────────────────────

async def arduino_b_reader(port: str) -> None:
    print(f"  [NFC] Opening Arduino B on {port}")
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=1)
    except serial.SerialException as e:
        print(f"  [!] Cannot open Arduino B port {port}: {e}")
        return

    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  [NFC] Arduino B ready\n")

    loop = asyncio.get_event_loop()
    try:
        while True:
            line = await loop.run_in_executor(None, ser.readline)
            if not line:
                continue
            try:
                data = json.loads(line.decode("utf-8", errors="ignore").strip())
            except Exception:
                continue

            msg_type = data.get("type", "")

            if msg_type == "nfc":
                uid  = data.get("uid", "").upper().replace(" ", "")
                tool = NFC_TAGS.get(uid)
                await broadcast({"type": "nfc", "uid": uid,
                                  "tool": tool, "valid": tool is not None})
                if tool:
                    await _nfc_queue.put(uid)

            elif msg_type == "knob":
                delta = data.get("delta", 0)
                click = data.get("click", False)
                event: Dict[str, Any] = {"type": "knob"}
                if click:
                    event["click"] = True
                else:
                    event["delta"] = delta
                await broadcast(event)
                await _knob_queue.put(event)

    except Exception as e:
        print(f"  [NFC] Error: {e}")
    finally:
        ser.close()

# ── Arduino A reader (Magnetometer) ────────────────────────────────────────

async def arduino_a_reader(port: str) -> None:
    global _latest_sensor
    print(f"  [MAG] Opening Arduino A on {port}")
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=1)
    except serial.SerialException as e:
        print(f"  [!] Cannot open Arduino A port {port}: {e}")
        return

    await asyncio.sleep(0.5)
    ser.reset_input_buffer()
    print("  [MAG] Arduino A ready\n")

    loop = asyncio.get_event_loop()
    try:
        while True:
            line = await loop.run_in_executor(None, ser.readline)
            if not line:
                continue
            try:
                data = json.loads(line.decode("utf-8", errors="ignore").strip())
            except Exception:
                continue

            x = float(data.get("x", 0))
            y = float(data.get("y", 0))
            z = float(data.get("z", 0))

            bx, by, bz = _mag_baseline
            cx, cy, cz = x - bx, y - by, z - bz
            mag = math.sqrt(cx*cx + cy*cy + cz*cz)

            _latest_sensor = {"x": cx, "y": cy, "z": cz, "mag": mag,
                               "x_raw": x, "y_raw": y, "z_raw": z}
            # if int(time.time() * 10) % 20 == 0:
            #     print(f"  [MAG] Sample: {x:.1f}, {y:.1f}, {z:.1f} (mag={mag:.1f})")

    except Exception as e:
        print(f"  [MAG] Error: {e}")
    finally:
        ser.close()

# ── Sensor Broadcaster ─────────────────────────────────────────────────────

async def sensor_broadcaster() -> None:
    """Send latest sensor values to frontend 20 times per second."""
    while True:
        if _latest_sensor:
            # We don't use broadcast() here to avoid await overhead 20x/sec per client
            msg = json.dumps({
                "type": "sensor",
                "x": round(_latest_sensor["x"], 2),
                "y": round(_latest_sensor["y"], 2),
                "z": round(_latest_sensor["z"], 2),
                "mag": round(_latest_sensor["mag"], 2),
                "state": _state_ref[0],
            })
            for c in connected_clients:
                try:
                    asyncio.create_task(c.send(msg))
                except Exception:
                    pass
        await asyncio.sleep(0.05)

# ── Calibration ────────────────────────────────────────────────────────────

async def calibrate(duration: float = 1.0) -> tuple[float, float, float]:
    """Collect samples for `duration` and set `_mag_baseline`."""
    global _mag_baseline
    _state_ref[0] = "calibrating"
    print(f"  [MAG] Calibrating for {duration}s...")
    start_time = time.time()
    samples = []

    while time.time() - start_time < duration:
        if _latest_sensor:
            samples.append((_latest_sensor["x_raw"],
                            _latest_sensor["y_raw"],
                            _latest_sensor["z_raw"]))
        await asyncio.sleep(0.02)

    if not samples:
        print("  [MAG] Calibration failed — no samples!")
        return _mag_baseline

    avg_x = sum(s[0] for s in samples) / len(samples)
    avg_y = sum(s[1] for s in samples) / len(samples)
    avg_z = sum(s[2] for s in samples) / len(samples)

    _mag_baseline = (avg_x, avg_y, avg_z)
    print(f"  [MAG] Baseline: {avg_x:.1f}, {avg_y:.1f}, {avg_z:.1f}")
    return _mag_baseline
