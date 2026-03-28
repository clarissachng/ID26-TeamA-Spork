#!/usr/bin/env python3
"""
bridge_choreo.py — While It Steeps: Choreograph Bridge Controller
=================================================================
Drives the free-form recording sequence for Choreograph.ts.
Allows scanning any tool and performing any motion.
"""

import asyncio
import time
import bridge_common
from classifier import (
    NFC_TAGS, SAMPLE_RATE,
    score_motion, ALL_MOTIONS
)

# ── Configuration ──────────────────────────────────────────────────────────
COUNTDOWN_SECONDS = 3
RECORDING_SECONDS = 8

# ── State ───────────────────────────────────────────────────────────
_choreo_task: asyncio.Task | None = None

def get_state() -> str:
    return bridge_common._state_ref[0]

async def handle_ui_state(msg: dict) -> None:
    """Route incoming ui_state messages to the correct backend action."""
    page = msg.get("page", "")
    if page == "choreograph":
        await _launch_choreo()
    else:
        await cancel_session()
        await bridge_common.broadcast({"type": "state", "state": "idle"})

async def cancel_session() -> None:
    """Cancel any currently running choreo task and reset state to idle."""
    global _choreo_task
    if _choreo_task and not _choreo_task.done():
        _choreo_task.cancel()
        try:
            await _choreo_task
        except asyncio.CancelledError:
            pass
    _choreo_task = None
    bridge_common._state_ref[0] = "idle"

async def _launch_choreo() -> None:
    """Cancel any existing session and start a fresh choreo loop."""
    global _choreo_task
    await cancel_session()
    print("  [CHOREO] Launching choreograph recording loop")
    _choreo_task = asyncio.create_task(_choreo_session())

async def _choreo_session() -> None:
    try:
        print("\n  ── Initial calibration ──")
        await bridge_common.calibrate(1.0)

        step_idx = 0
        # Free-form loop: Wait for scan -> Countdown -> Record -> Result -> Repeat
        while True:
            step_idx += 1
            # 1. Prompt for scan
            await bridge_common.broadcast({
                "type": "prompt",
                "mode": "free-form",
                "instruction": "Scan any tool to begin the next step"
            })
            
            print(f"\n  [CHOREO] Step {step_idx}: Waiting for any tool scan...")
            bridge_common._state_ref[0] = "waiting_nfc"
            tool = await _wait_for_any_nfc()
            
            # 2. Countdown & Calibrate
            cal_task   = asyncio.create_task(bridge_common.calibrate(1.0))
            count_task = asyncio.create_task(_run_countdown())
            baseline, _ = await asyncio.gather(cal_task, count_task)

            # 3. Record
            samples = await _record_motion(RECORDING_SECONDS)

            # 4. Score against ALL motions to find the best match
            bridge_common._state_ref[0] = "scoring"
            
            # Define motions to check
            motions_to_check = ALL_MOTIONS
            results = []
            
            for m in motions_to_check:
                res = score_motion(samples, m, tool, baseline)
                results.append((res["score"], m))

            # Pick the best one
            results.sort(key=lambda x: x[0], reverse=True)
            best_score, best_motion = results[0]

            passed = best_score >= 0.3
            print(f"  [CHOREO] Scored {best_motion} with {tool}: {best_score:.0%} ({'PASSED' if passed else 'FAILED'})")

            await bridge_common.broadcast({
                "type":   "result",
                "motion": best_motion,
                "tool":   tool,
                "score":  best_score,
                "passed": passed,
            })

            bridge_common._state_ref[0] = "cooldown"
            await asyncio.sleep(2.0)

    except asyncio.CancelledError:
        print("\n  ═══ Choreograph session complete ═══\n")
        bridge_common._state_ref[0] = "idle"
        raise

# Remove _run_free_step as it's merged into _choreo_session for better flow control

async def _wait_for_any_nfc() -> str:
    """Wait for any valid NFC tag and return the tool name."""
    while not bridge_common._nfc_queue.empty():
        bridge_common._nfc_queue.get_nowait()
    
    while True:
        uid  = await bridge_common._nfc_queue.get()
        tool = NFC_TAGS.get(uid)
        if tool:
            print(f"  [CHOREO] Scanned tag: {tool}")
            return tool
        print(f"  [CHOREO] Scanned unknown tag: {uid}")

async def _run_countdown() -> None:
    bridge_common._state_ref[0] = "countdown"
    for i in range(COUNTDOWN_SECONDS, 0, -1):
        await bridge_common.broadcast({"type": "countdown", "seconds": i})
        await asyncio.sleep(1.0)

async def _record_motion(duration_s: float) -> list[tuple[float, float, float]]:
    bridge_common._state_ref[0] = "recording"
    samples: list[tuple[float, float, float]] = []
    start = time.monotonic()
    last_tick = -1

    print(f"  [CHOREO] Recording motion for {duration_s}s...")
    while True:
        elapsed = time.monotonic() - start
        remaining = int(duration_s - elapsed)
        if remaining != last_tick and remaining >= 0:
            last_tick = remaining
            await bridge_common.broadcast({"type": "recording", "seconds_remaining": remaining})
        if elapsed >= duration_s:
            break
        await asyncio.sleep(1.0 / SAMPLE_RATE)
        if bridge_common._latest_sensor:
            samples.append((bridge_common._latest_sensor["x_raw"], bridge_common._latest_sensor["y_raw"], bridge_common._latest_sensor["z_raw"]))
    
    print(f"  [CHOREO] Recorded {len(samples)} samples")
    return samples
