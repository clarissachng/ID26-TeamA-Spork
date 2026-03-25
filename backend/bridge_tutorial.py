#!/usr/bin/env python3
"""
bridge_tutorial.py — While It Steeps: Tutorial Bridge
======================================================
Drives the interactive tutorial sequence for TutorialDetail.ts.

Fixed sequence of 3 steps:
  1. Coffee Grinder → grinding
  2. Tea Bag        → up_down
  3. Coffee Press   → press_down

Each step:
  1. Broadcast PROMPT (motion + tool)
  2. Wait for the correct NFC tag
     - Wrong tag → broadcast NFC_WRONG, keep waiting
  3. Broadcast COUNTDOWN 3…2…1  (calibrate during countdown)
  4. Open 8 s scoring window
  5. Score + broadcast RESULT
  6. If passed → move to next step
     If failed → retry (skip NFC scan, go straight to countdown)

After all 3 steps:
  Broadcast TUTORIAL_COMPLETE

Usage:
    python bridge_tutorial.py --mag-port COM6 --nfc-port COM8

WebSocket messages — same schema as bridge_play.py plus:
    {"type": "tutorial_complete"}
"""

import argparse
import asyncio
import json
import math
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import serial
import serial.tools.list_ports
import websockets

from classifier import (
    NFC_TAGS, TOOL_PROFILES, SAMPLE_RATE,
    low_pass_filter, score_motion,
)

# ── Configuration ──────────────────────────────────────────────────────────
WS_HOST   = "localhost"
WS_PORT   = 8765
BAUD_RATE = 115200

COUNTDOWN_SECONDS = 3
RECORDING_SECONDS = 8

PASS_THRESHOLD = 0.70

# Fixed tutorial sequence
TUTORIAL_STEPS = [
    {"motion": "grinding",   "tool": "Coffee Grinder"},
    {"motion": "up_down",    "tool": "Tea Bag"},
    {"motion": "press_down", "tool": "Coffee Press"},
]

# ── Shared state ───────────────────────────────────────────────────────────
connected_clients: set        = set()
_latest_sensor: dict | None   = None
_nfc_queue:  asyncio.Queue    = asyncio.Queue()
_knob_queue: asyncio.Queue    = asyncio.Queue()
_mag_baseline: tuple[float, float, float] = (0.0, 0.0, 0.0)


# ── WebSocket server ───────────────────────────────────────────────────────

async def ws_handler(websocket):
    connected_clients.add(websocket)
    print(f"  [WS] Client connected: {websocket.remote_address}")
    try:
        async for _ in websocket:
            pass   # tutorial bridge doesn't need incoming messages
    finally:
        connected_clients.discard(websocket)
        print("  [WS] Client disconnected")


async def broadcast(msg: dict) -> None:
    if not connected_clients:
        return
    data = json.dumps(msg)
    await asyncio.gather(
        *[c.send(data) for c in connected_clients],
        return_exceptions=True,
    )


async def wait_for_client() -> None:
    """Block tutorial flow until at least one frontend WS client is connected."""
    if connected_clients:
        return
    print("  [WS] Waiting for frontend client to connect...")
    while not connected_clients:
        await asyncio.sleep(0.1)
    print("  [WS] Frontend client connected — starting tutorial flow")


# ── Arduino B reader ───────────────────────────────────────────────────────

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
                event = {"type": "knob"}
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


# ── Arduino A reader ───────────────────────────────────────────────────────

async def arduino_a_reader(port: str) -> None:
    global _latest_sensor, _mag_baseline
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

    except Exception as e:
        print(f"  [MAG] Error: {e}")
    finally:
        ser.close()


# ── Sensor broadcaster ─────────────────────────────────────────────────────

async def sensor_broadcaster(state_ref: list[str]) -> None:
    while True:
        await asyncio.sleep(1.0 / SAMPLE_RATE)
        if _latest_sensor:
            await broadcast({
                "type":  "sensor",
                "x":     round(_latest_sensor["x"], 2),
                "y":     round(_latest_sensor["y"], 2),
                "z":     round(_latest_sensor["z"], 2),
                "mag":   round(_latest_sensor["mag"], 2),
                "state": state_ref[0],
            })


# ── Calibration ────────────────────────────────────────────────────────────

async def calibrate(duration_s: float = 2.0,
                    state_ref: list[str] | None = None) -> tuple[float, float, float]:
    global _mag_baseline
    if state_ref:
        state_ref[0] = "calibrating"
    print(f"  [CAL] Calibrating {duration_s:.0f}s — hold still…")
    samples: list[tuple] = []
    deadline = time.monotonic() + duration_s

    while time.monotonic() < deadline:
        await asyncio.sleep(1.0 / SAMPLE_RATE)
        if _latest_sensor:
            samples.append((_latest_sensor["x_raw"],
                             _latest_sensor["y_raw"],
                             _latest_sensor["z_raw"]))

    if samples:
        arr = np.array(samples)
        bx, by, bz = float(arr[:, 0].mean()), float(arr[:, 1].mean()), float(arr[:, 2].mean())
    else:
        bx = by = bz = 0.0

    _mag_baseline = (bx, by, bz)
    print(f"  [CAL] Baseline: x={bx:.1f} y={by:.1f} z={bz:.1f}")
    return bx, by, bz


# ── Countdown ─────────────────────────────────────────────────────────────

async def run_countdown(state_ref: list[str]) -> None:
    state_ref[0] = "countdown"
    for i in range(COUNTDOWN_SECONDS, 0, -1):
        await broadcast({"type": "countdown", "seconds": i})
        print(f"    {i}…")
        await asyncio.sleep(1.0)


# ── NFC wait ──────────────────────────────────────────────────────────────

async def wait_for_nfc(expected_tool: str) -> None:
    while not _nfc_queue.empty():
        _nfc_queue.get_nowait()

    print(f"  [NFC] Waiting for: {expected_tool}")
    while True:
        uid  = await _nfc_queue.get()
        tool = NFC_TAGS.get(uid)
        if tool == expected_tool:
            print(f"  [NFC] ✓ Correct: {tool}")
            return
        print(f"  [NFC] ✗ Wrong: {tool} — expected {expected_tool}")
        await broadcast({"type": "nfc_wrong",
                          "scanned":  tool or uid,
                          "expected": expected_tool})


# ── Recording ─────────────────────────────────────────────────────────────

async def record_motion(duration_s: float,
                        state_ref: list[str]) -> list[tuple]:
    state_ref[0] = "recording"
    samples: list[tuple] = []
    start     = time.monotonic()
    last_tick = -1

    while True:
        elapsed   = time.monotonic() - start
        remaining = int(duration_s - elapsed)

        if remaining != last_tick and remaining >= 0:
            last_tick = remaining
            await broadcast({"type": "recording", "seconds_remaining": remaining})
            print(f"    {remaining + 1}s remaining…")

        if elapsed >= duration_s:
            break

        await asyncio.sleep(1.0 / SAMPLE_RATE)
        if _latest_sensor:
            samples.append((_latest_sensor["x_raw"],
                             _latest_sensor["y_raw"],
                             _latest_sensor["z_raw"]))

    return samples


# ── Single tutorial step ───────────────────────────────────────────────────

async def run_step(step_idx: int, motion: str, tool: str,
                   skip_nfc: bool, state_ref: list[str]) -> bool:
    """Returns True if passed."""
    total = len(TUTORIAL_STEPS)
    await broadcast({
        "type":       "prompt",
        "motion":     motion,
        "tool":       tool,
        "action":     step_idx + 1,
        "total_actions": total,
    })
    print(f"\n  ── Tutorial step {step_idx + 1}/{total}: {motion} with {tool} ──")

    if not skip_nfc:
        state_ref[0] = "waiting_nfc"
        await wait_for_nfc(tool)

    # Calibrate during countdown
    cal_task   = asyncio.create_task(calibrate(2.0, state_ref))
    count_task = asyncio.create_task(run_countdown(state_ref))
    baseline, _ = await asyncio.gather(cal_task, count_task)

    samples = await record_motion(RECORDING_SECONDS, state_ref)

    state_ref[0] = "scoring"
    result  = score_motion(samples, motion, tool, baseline)
    passed  = result["passed"]

    print(f"  [SCORE] {motion} / {tool}: {result['score']:.0%}  "
          f"{'PASSED ✓' if passed else 'FAILED ✗'}")

    await broadcast({
        "type":   "result",
        "motion": motion,
        "tool":   tool,
        "score":  result["score"],
        "passed": passed,
        "detail": result.get("detail", {}),
    })

    state_ref[0] = "cooldown"
    await asyncio.sleep(1.5)
    return passed


# ── Tutorial loop ──────────────────────────────────────────────────────────

async def tutorial_loop(state_ref: list[str]) -> None:
    await wait_for_client()

    # Initial calibration
    print("\n  ── Initial calibration ──")
    await calibrate(2.0, state_ref)

    for i, step in enumerate(TUTORIAL_STEPS):
        motion = step["motion"]
        tool   = step["tool"]
        skip   = False

        while True:
            passed = await run_step(i, motion, tool, skip, state_ref)
            if passed:
                break
            skip = True   # retry without NFC

    await broadcast({"type": "tutorial_complete"})
    print("\n  ═══ Tutorial complete ═══\n")
    state_ref[0] = "idle"


# ── Entry point ────────────────────────────────────────────────────────────

async def main() -> None:
    parser = argparse.ArgumentParser(
        description="While It Steeps — Tutorial Bridge"
    )
    parser.add_argument("--mag-port", "-m", required=True,
                        help="Magnetometer Arduino serial port")
    parser.add_argument("--nfc-port", "-n", required=True,
                        help="NFC + Knob Arduino serial port")
    parser.add_argument("--baud", "-b", type=int, default=BAUD_RATE)
    args = parser.parse_args()

    state_ref = ["idle"]

    print()
    print("  ═══════════════════════════════════════")
    print("    While It Steeps — Tutorial Bridge")
    print("  ═══════════════════════════════════════")
    print(f"  Mag port : {args.mag_port}")
    print(f"  NFC port : {args.nfc_port}")
    print(f"  WS       : ws://{WS_HOST}:{WS_PORT}")
    print()
    print("  Sequence:")
    for i, s in enumerate(TUTORIAL_STEPS):
        print(f"    {i+1}. {s['motion']:<12} — {s['tool']}")
    print()

    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        print(f"  [OK] WebSocket on ws://{WS_HOST}:{WS_PORT}\n")
        await asyncio.gather(
            arduino_a_reader(args.mag_port),
            arduino_b_reader(args.nfc_port),
            sensor_broadcaster(state_ref),
            tutorial_loop(state_ref),
        )


if __name__ == "__main__":
    asyncio.run(main())