#!/usr/bin/env python3
"""
bridge_play.py — While It Steeps: Play Bridge
==============================================
Drives the main gameplay loop for Play.ts.

Round structure:
  Round 1 → 3 actions
  Round 2 → 5 actions
  Round 3 → 7 actions

Each action:
  1. Pick a random motion + random tool
  2. Broadcast PROMPT to frontend
  3. Wait for the correct NFC tag to be scanned
     - Wrong tag → broadcast NFC_WRONG, keep waiting
  4. Broadcast COUNTDOWN 3…2…1
  5. Calibrate sensor during countdown (uses first 2 s of countdown window)
  6. Open 8 s scoring window — collect samples
  7. Score the recording
  8. If passed → broadcast RESULT(passed) → move to next action
     If failed → broadcast RESULT(failed) → retry same action (skip NFC scan)

After all actions in a round:
  Broadcast ROUND_COMPLETE with total score
  Wait for {"ready": true} from frontend to start next round

Usage:
    python bridge_play.py --mag-port COM6 --nfc-port COM8
    python bridge_play.py --mag-port COM6 --nfc-port COM8 --start-round 2
    python bridge_play.py --help

WebSocket messages sent to frontend:
    {"type": "prompt",         "motion": "grinding", "tool": "Kettle", "action": 1, "total_actions": 3}
    {"type": "nfc_wrong",      "scanned": "Tongs",   "expected": "Kettle"}
    {"type": "countdown",      "seconds": 3}
    {"type": "countdown",      "seconds": 2}
    {"type": "countdown",      "seconds": 1}
    {"type": "recording",      "seconds_remaining": 7}
    {"type": "result",         "motion": "grinding", "tool": "Kettle", "score": 0.85, "passed": true}
    {"type": "round_complete", "round": 1, "score": 0.78, "passed": true, "actions": 3}
    {"type": "sensor",         "x": 1.2, "y": -3.4, "z": 8.1, "mag": 9.0, "state": "recording"}
    {"type": "knob",           "delta": 1}
    {"type": "knob",           "click": true}
    {"type": "nfc",            "uid": "...", "tool": "Kettle", "valid": true}

WebSocket messages received from frontend:
    {"ready": true}   — advance to next round
"""

import argparse
import asyncio
import json
import math
import random
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

COUNTDOWN_SECONDS  = 3
RECORDING_SECONDS  = 8
CALIBRATION_SAMPLES = 50   # first 2 s at 25 Hz used as baseline

PASS_THRESHOLD = 0.60

ROUND_ACTIONS = {1: 3, 2: 5, 3: 7}
ALL_MOTIONS   = ["grinding", "up_down", "press_down"]

# ── Shared state ───────────────────────────────────────────────────────────
connected_clients: set           = set()
_latest_sensor: dict | None      = None   # most recent x/y/z/mag reading
_nfc_queue:     asyncio.Queue    = asyncio.Queue()   # validated NFC UIDs
_knob_queue:    asyncio.Queue    = asyncio.Queue()   # knob events
_ready_event:   asyncio.Event    = asyncio.Event()   # frontend said "ready"


# ── WebSocket server ───────────────────────────────────────────────────────

async def ws_handler(websocket):
    connected_clients.add(websocket)
    print(f"  [WS] Client connected: {websocket.remote_address}")
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
                if msg.get("ready"):
                    _ready_event.set()
            except Exception:
                pass
    finally:
        connected_clients.discard(websocket)
        print(f"  [WS] Client disconnected")


async def broadcast(msg: dict) -> None:
    if not connected_clients:
        return
    data = json.dumps(msg)
    await asyncio.gather(
        *[c.send(data) for c in connected_clients],
        return_exceptions=True,
    )


async def wait_for_client() -> None:
    """Block game flow until at least one frontend WS client is connected."""
    if connected_clients:
        return
    print("  [WS] Waiting for frontend client to connect...")
    while not connected_clients:
        await asyncio.sleep(0.1)
    print("  [WS] Frontend client connected — starting play flow")


# ── Arduino B reader (NFC + Knob) ──────────────────────────────────────────

async def arduino_b_reader(port: str) -> None:
    """Read NFC scans and knob events from Arduino B."""
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
                valid = tool is not None
                await broadcast({"type": "nfc", "uid": uid,
                                  "tool": tool, "valid": valid})
                if valid:
                    await _nfc_queue.put(uid)
                else:
                    print(f"  [NFC] Unknown tag: {uid}")

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
        print(f"  [NFC] Reader error: {e}")
    finally:
        ser.close()


# ── Arduino A reader (magnetometer) ───────────────────────────────────────

async def arduino_a_reader(port: str) -> None:
    """Read magnetometer samples. Populates _latest_sensor continuously."""
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
    baseline = (0.0, 0.0, 0.0)

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

            bx, by, bz = baseline
            cx = x - bx
            cy = y - by
            cz = z - bz
            mag = math.sqrt(cx*cx + cy*cy + cz*cz)

            _latest_sensor = {"x": cx, "y": cy, "z": cz, "mag": mag,
                               "x_raw": x, "y_raw": y, "z_raw": z}

    except Exception as e:
        print(f"  [MAG] Reader error: {e}")
    finally:
        ser.close()


def set_baseline(bx: float, by: float, bz: float) -> None:
    """Update the baseline used by arduino_a_reader for offset correction."""
    # We patch this by writing directly to _latest_sensor's correction.
    # The reader coroutine reads _mag_baseline which we update here.
    global _mag_baseline
    _mag_baseline = (bx, by, bz)

_mag_baseline: tuple[float, float, float] = (0.0, 0.0, 0.0)


# ── Sensor broadcaster ─────────────────────────────────────────────────────

async def sensor_broadcaster(state_ref: list[str]) -> None:
    """Continuously broadcast sensor heartbeat at 25 Hz."""
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
    """
    Collect `duration_s` seconds of raw samples to compute baseline offsets.
    Returns (bx, by, bz).
    """
    if state_ref:
        state_ref[0] = "calibrating"
    print(f"  [CAL] Calibrating for {duration_s:.0f}s — hold still…")
    samples: list[tuple[float, float, float]] = []
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

    global _mag_baseline
    _mag_baseline = (bx, by, bz)
    print(f"  [CAL] Baseline: x={bx:.1f} y={by:.1f} z={bz:.1f}")
    return bx, by, bz


# ── Recording window ───────────────────────────────────────────────────────

async def record_motion(duration_s: float,
                        baseline: tuple[float, float, float],
                        state_ref: list[str]) -> list[tuple[float, float, float]]:
    """
    Collect `duration_s` seconds of raw samples.
    Broadcasts 'recording' tick every second.
    Returns list of (x_raw, y_raw, z_raw).
    """
    state_ref[0] = "recording"
    samples: list[tuple[float, float, float]] = []
    start   = time.monotonic()
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


# ── Countdown ─────────────────────────────────────────────────────────────

async def run_countdown(state_ref: list[str]) -> None:
    state_ref[0] = "countdown"
    for i in range(COUNTDOWN_SECONDS, 0, -1):
        await broadcast({"type": "countdown", "seconds": i})
        print(f"    {i}…")
        await asyncio.sleep(1.0)


# ── NFC wait ──────────────────────────────────────────────────────────────

async def wait_for_nfc(expected_tool: str) -> None:
    """Wait until the correct NFC tag is scanned. Broadcasts nfc_wrong on bad scans."""
    # Drain any stale scans
    while not _nfc_queue.empty():
        _nfc_queue.get_nowait()

    print(f"  [NFC] Waiting for: {expected_tool}")
    while True:
        uid  = await _nfc_queue.get()
        tool = NFC_TAGS.get(uid)
        if tool == expected_tool:
            print(f"  [NFC] ✓ Correct: {tool}")
            return
        else:
            print(f"  [NFC] ✗ Wrong: {tool} — expected {expected_tool}")
            await broadcast({"type": "nfc_wrong",
                              "scanned":  tool or uid,
                              "expected": expected_tool})


# ── Single action ─────────────────────────────────────────────────────────

async def run_action(motion: str, tool: str,
                     action_num: int, total_actions: int,
                     skip_nfc: bool,
                     state_ref: list[str]) -> float:
    """
    Run one action (prompt → scan → countdown → record → score).
    Returns the score 0–1.
    """
    # 1. Broadcast prompt
    await broadcast({
        "type":          "prompt",
        "motion":        motion,
        "tool":          tool,
        "action":        action_num,
        "total_actions": total_actions,
    })
    print(f"\n  ── Action {action_num}/{total_actions}: {motion} with {tool} ──")

    # 2. NFC scan (skip on retry)
    if not skip_nfc:
        state_ref[0] = "waiting_nfc"
        await wait_for_nfc(tool)
    else:
        print("  [→] Retry — skipping NFC scan")

    # 3. Countdown (also calibrates during this window)
    cal_task  = asyncio.create_task(calibrate(2.0, state_ref))
    count_task = asyncio.create_task(run_countdown(state_ref))
    baseline, _ = await asyncio.gather(cal_task, count_task)

    # 4. Record
    samples = await record_motion(RECORDING_SECONDS, baseline, state_ref)

    # 5. Score
    state_ref[0] = "scoring"
    result = score_motion(samples, motion, tool, baseline)
    passed = result["passed"]

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
    await asyncio.sleep(1.5)   # brief pause before next action / retry

    return result["score"] if passed else 0.0


# ── Round runner ───────────────────────────────────────────────────────────


def generate_action_sequence(n_actions, all_motions, all_tools):
    import random
    tool_counts = {t: 0 for t in all_tools}
    last_tool = None
    last_motion = None
    actions = []
    for _ in range(n_actions):
        available_tools = [t for t in all_tools if t != last_tool and tool_counts[t] < 2]
        available_motions = [m for m in all_motions if m != last_motion]
        tool = random.choice(available_tools) if available_tools else random.choice([t for t in all_tools if t != last_tool])
        motion = random.choice(available_motions) if available_motions else random.choice([m for m in all_motions if m != last_motion])
        actions.append((motion, tool))
        tool_counts[tool] += 1
        last_tool = tool
        last_motion = motion
    return actions

async def run_round(round_num: int, state_ref: list[str]) -> float:
    n_actions = ROUND_ACTIONS.get(round_num, 3)
    scores: list[float] = []
    all_tools = list(NFC_TAGS.values())
    actions = generate_action_sequence(n_actions, ALL_MOTIONS, all_tools)

    for action_idx, (motion, tool) in enumerate(actions):
        skip_nfc  = False
        action_score = 0.0

        while True:
            action_score = await run_action(
                motion, tool, action_idx + 1, n_actions,
                skip_nfc, state_ref,
            )
            if action_score > 0.0:   # passed
                break
            skip_nfc = True           # retry without NFC

        scores.append(action_score)

    total_score = sum(scores) / len(scores) if scores else 0.0
    passed      = bool(total_score >= PASS_THRESHOLD)

    await broadcast({
        "type":    "round_complete",
        "round":   round_num,
        "score":   float(round(total_score, 3)),
        "passed":  passed,
        "actions": n_actions,
    })
    print(f"\n  ══ Round {round_num} complete  score={total_score:.0%} "
          f"{'PASSED' if passed else 'FAILED'} ══\n")

    return total_score


# ── Main game loop ─────────────────────────────────────────────────────────

async def game_loop(start_round: int, state_ref: list[str]) -> None:
    """Run rounds 1–3, waiting for frontend 'ready' between rounds."""
    await wait_for_client()

    # Wait for frontend to be ready before starting
    print("  Waiting for frontend 'ready'… (or press Enter to start)")
    _ready_event.clear()
    state_ref[0] = "waiting_ready"
    
    loop = asyncio.get_event_loop()
    enter_task = loop.run_in_executor(None, input)
    ready_task = asyncio.ensure_future(_ready_event.wait())
    
    done, pending = await asyncio.wait(
        [asyncio.ensure_future(enter_task), ready_task],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
    
    # Initial calibration before any round
    print("\n  ── Initial calibration ──")
    await calibrate(2.0, state_ref)

    for round_num in range(start_round, 4):
        await run_round(round_num, state_ref)

        if round_num < 3:
            _ready_event.clear()
            print("  Waiting for frontend 'ready'… (or press Enter to continue)")
            state_ref[0] = "waiting_ready"

            # Wait for either frontend message or Enter keypress
            loop = asyncio.get_event_loop()
            enter_task = loop.run_in_executor(None, input)
            ready_task  = asyncio.ensure_future(_ready_event.wait())

            done, pending = await asyncio.wait(
                [asyncio.ensure_future(enter_task), ready_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    print("\n  ═══ All rounds complete ═══\n")
    state_ref[0] = "idle"


# ── Entry point ────────────────────────────────────────────────────────────

async def main() -> None:
    parser = argparse.ArgumentParser(
        description="While It Steeps — Play Bridge"
    )
    parser.add_argument("--mag-port",  "-m", required=True,
                        help="Magnetometer Arduino serial port (e.g. COM6)")
    parser.add_argument("--nfc-port",  "-n", required=True,
                        help="NFC + Knob Arduino serial port (e.g. COM8)")
    parser.add_argument("--baud",      "-b", type=int, default=BAUD_RATE)
    parser.add_argument("--start-round", type=int, default=1, choices=[1, 2, 3])
    args = parser.parse_args()

    state_ref = ["idle"]   # mutable reference so coroutines share state

    print()
    print("  ═══════════════════════════════════════")
    print("    While It Steeps — Play Bridge")
    print("  ═══════════════════════════════════════")
    print(f"  Mag port  : {args.mag_port}")
    print(f"  NFC port  : {args.nfc_port}")
    print(f"  WS        : ws://{WS_HOST}:{WS_PORT}")
    print(f"  Rounds    : {args.start_round}–3")
    print(f"  Tools     : {', '.join(NFC_TAGS.values())}")
    print()

    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        print(f"  [OK] WebSocket on ws://{WS_HOST}:{WS_PORT}\n")
        await asyncio.gather(
            arduino_a_reader(args.mag_port),
            arduino_b_reader(args.nfc_port),
            sensor_broadcaster(state_ref),
            game_loop(args.start_round, state_ref),
        )


if __name__ == "__main__":
    asyncio.run(main())