#!/usr/bin/env python3
"""
bridge_tutorial.py — While It Steeps: Tutorial Bridge Controller
================================================================
Drives the interactive tutorial sequence for TutorialDetail.ts.
Refactored to be a modular controller used by launcher.py.
"""

import asyncio
import time
import bridge_common
from classifier import (
    NFC_TAGS, SAMPLE_RATE,
    score_motion,
)

# ── Configuration ──────────────────────────────────────────────────────────
COUNTDOWN_SECONDS = 3
RECORDING_SECONDS = 8
PASS_THRESHOLD = 0.60

TUTORIAL_STEPS = [
    {"motion": "grinding",   "tool": "Coffee Grinder"},
    {"motion": "up_down",    "tool": "Tea Bag"},
    {"motion": "press_down", "tool": "Coffee Press"},
]

# ── State ───────────────────────────────────────────────────────────
_tutorial_task: asyncio.Task | None = None

def get_state() -> str:
    return bridge_common._state_ref[0]

async def handle_ui_state(msg: dict) -> None:
    """Route incoming ui_state messages to the correct backend action."""
    page = msg.get("page", "")
    if page == "tutorial":
        motion = msg.get("motion")
        await _launch_tutorial(motion)
    else:
        await cancel_session()
        await bridge_common.broadcast({"type": "state", "state": "idle"})

async def cancel_session() -> None:
    """Cancel any currently running tutorial task and reset state to idle."""
    global _tutorial_task
    if _tutorial_task and not _tutorial_task.done():
        _tutorial_task.cancel()
        try:
            await _tutorial_task
        except asyncio.CancelledError:
            pass
    _tutorial_task = None
    bridge_common._state_ref[0] = "idle"

async def _launch_tutorial(motion: str | None = None) -> None:
    """Cancel any existing session and start a fresh tutorial sequence or specific step."""
    global _tutorial_task
    await cancel_session()
    print(f"  [TUTORIAL] Launching tutorial (motion: {motion or 'full sequence'})")
    _tutorial_task = asyncio.create_task(_tutorial_session(motion))

async def _tutorial_session(target_motion: str | None = None) -> None:
    try:
        print("\n  ── Initial calibration ──")
        await bridge_common.calibrate(1.0)

        # Filter steps if a specific motion was requested
        steps = TUTORIAL_STEPS
        if target_motion:
            steps = [s for s in TUTORIAL_STEPS if s["motion"] == target_motion]
            if not steps:
                print(f"  [TUTORIAL] Unknown motion requested: {target_motion}")
                return

        for i, step in enumerate(steps):
            motion = step["motion"]
            tool   = step["tool"]
            skip   = False

            # If we're doing a specific motion, step_idx should reflect its actual position in the sequence if needed,
            # but for display purposes we'll just use the loop index relative to the sequence we're running.
            display_idx = i if not target_motion else TUTORIAL_STEPS.index(step)

            while True:
                passed = await _run_step(display_idx, motion, tool, skip, len(TUTORIAL_STEPS))
                if passed:
                    break
                skip = True

        if not target_motion:
            await bridge_common.broadcast({"type": "tutorial_complete"})
            print("\n  ═══ Tutorial complete ═══\n")
        
        bridge_common._state_ref[0] = "idle"

    except asyncio.CancelledError:
        print(f"  [TUTORIAL] Session cancelled (was in state: {bridge_common._state_ref[0]})")
        bridge_common._state_ref[0] = "idle"
        raise

async def _run_step(step_idx: int, motion: str, tool: str, skip_nfc: bool, total_steps: int) -> bool:
    await bridge_common.broadcast({
        "type":       "prompt",
        "motion":     motion,
        "tool":       tool,
        "action":     step_idx + 1,
        "total_actions": total_steps,
    })
    print(f"\n  [TUTORIAL] Step {step_idx + 1}/{total_steps}: {motion} with {tool}")

    if not skip_nfc:
        bridge_common._state_ref[0] = "waiting_nfc"
        await _wait_for_nfc(tool)

    cal_task   = asyncio.create_task(bridge_common.calibrate(1.0))
    count_task = asyncio.create_task(_run_countdown())
    baseline, _ = await asyncio.gather(cal_task, count_task)

    samples = await _record_motion(RECORDING_SECONDS)

    bridge_common._state_ref[0] = "scoring"
    result  = score_motion(samples, motion, tool, baseline)
    passed  = result["passed"]

    await bridge_common.broadcast({
        "type":   "result",
        "motion": motion,
        "tool":   tool,
        "score":  result["score"],
        "passed": passed,
    })

    bridge_common._state_ref[0] = "cooldown"
    await asyncio.sleep(1.5)
    return passed

async def _wait_for_nfc(expected_tool: str) -> None:
    print(f"  [TUTORIAL] Waiting for NFC tag: {expected_tool}")
    while not bridge_common._nfc_queue.empty():
        bridge_common._nfc_queue.get_nowait()
    while True:
        uid  = await bridge_common._nfc_queue.get()
        tool = NFC_TAGS.get(uid)
        print(f"  [TUTORIAL] Scanned tag: {tool or uid}")
        if tool == expected_tool:
            return
        await bridge_common.broadcast({"type": "nfc_wrong", "scanned": tool or uid, "expected": expected_tool})

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

    print(f"  [TUTORIAL] Recording motion for {duration_s}s...")
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
    
    print(f"  [TUTORIAL] Recorded {len(samples)} samples")
    return samples
