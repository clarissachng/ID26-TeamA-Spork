#!/usr/bin/env python3
"""
bridge_play.py — While It Steeps: Play Bridge Controller
========================================================
Drives the main gameplay loop for Play.ts.
Refactored to be a modular controller used by launcher.py.
"""

import asyncio
import random
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
ROUND_ACTIONS = {1: 3, 2: 5, 3: 7}
ALL_MOTIONS   = ["grinding", "up_down", "press_down"]

# ── State ───────────────────────────────────────────────────────────
_round_task:    asyncio.Task | None = None
_current_round: int | None          = None
_ready_event:   asyncio.Event       = asyncio.Event()

def get_state() -> str:
    return bridge_common._state_ref[0]

def set_ready():
    _ready_event.set()

async def handle_ui_state(msg: dict) -> None:
    """Route incoming ui_state messages to the correct backend action."""
    page = msg.get("page", "")
    if page == "play":
        level_id  = int(msg.get("levelId", 1))
        round_num = max(1, min(3, level_id))
        await _launch_round(round_num)
    else:
        await cancel_session()
        await bridge_common.broadcast({"type": "state", "state": "idle"})

async def cancel_session() -> None:
    """Cancel any currently running round task and reset state to idle."""
    global _round_task, _current_round
    if _round_task and not _round_task.done():
        _round_task.cancel()
        try:
            await _round_task
        except asyncio.CancelledError:
            pass
    _round_task    = None
    _current_round = None
    bridge_common._state_ref[0] = "idle"

async def _launch_round(round_num: int) -> None:
    """Cancel any existing session and start a fresh one at round_num."""
    global _round_task, _current_round
    await cancel_session()
    _ready_event.clear()
    _current_round = round_num
    print(f"  [PLAY] Launching round {round_num}")
    _round_task = asyncio.create_task(_round_session(round_num))

async def _round_session(start_round: int) -> None:
    global _current_round
    try:
        print("\n  ── Initial calibration ──")
        await bridge_common.calibrate(1.0)

        current = start_round
        while current <= 3:
            _current_round = current
            await _run_round(current)

            if current >= 3:
                break

            bridge_common._state_ref[0] = "waiting_ready"
            print(f"  [PLAY] Round {current} complete — waiting for ready…")
            _ready_event.clear()
            await _ready_event.wait()
            _ready_event.clear()
            current += 1

        print("\n  ═══ Session complete ═══\n")
        bridge_common._state_ref[0] = "idle"
        _current_round = None

    except asyncio.CancelledError:
        print(f"  [PLAY] Session cancelled (was in state: {bridge_common._state_ref[0]})")
        bridge_common._state_ref[0] = "idle"
        _current_round = None
        raise

async def _run_round(round_num: int) -> float:
    n_actions = ROUND_ACTIONS.get(round_num, 3)
    actions   = _generate_action_sequence(n_actions)
    scores: list[float] = []

    for action_idx, (motion, tool) in enumerate(actions):
        skip_nfc     = False
        action_score = 0.0

        while True:
            action_score = await _run_action(
                motion, tool, action_idx + 1, n_actions, skip_nfc,
            )
            if action_score > 0.0:
                break
            skip_nfc = True

        scores.append(action_score)

    total_score = sum(scores) / len(scores) if scores else 0.0
    passed      = bool(total_score >= PASS_THRESHOLD)

    await bridge_common.broadcast({
        "type":    "round_complete",
        "round":   round_num,
        "score":   float(round(total_score, 3)),
        "passed":  passed,
        "actions": n_actions,
    })
    return total_score

def _generate_action_sequence(n_actions: int) -> list[tuple[str, str]]:
    all_tools   = list(NFC_TAGS.values())
    tool_counts = {t: 0 for t in all_tools}
    last_tool:   str | None = None
    last_motion: str | None = None
    actions: list[tuple[str, str]] = []

    for _ in range(n_actions):
        available_tools   = [t for t in all_tools   if t != last_tool   and tool_counts[t] < 2]
        available_motions = [m for m in ALL_MOTIONS if m != last_motion]
        tool   = random.choice(available_tools   if available_tools   else [t for t in all_tools   if t != last_tool])
        motion = random.choice(available_motions if available_motions else [m for m in ALL_MOTIONS if m != last_motion])
        actions.append((motion, tool))
        tool_counts[tool] += 1
        last_tool   = tool
        last_motion = motion
    return actions

async def _run_action(motion: str, tool: str, action_num: int, total_actions: int, skip_nfc: bool) -> float:
    await bridge_common.broadcast({
        "type":          "prompt",
        "motion":        motion,
        "tool":          tool,
        "action":        action_num,
        "total_actions": total_actions,
    })
    print(f"\n  [PLAY] Action {action_num}/{total_actions}: {motion} with {tool}")

    if not skip_nfc:
        bridge_common._state_ref[0] = "waiting_nfc"
        await _wait_for_nfc(tool)

    cal_task   = asyncio.create_task(bridge_common.calibrate(1.0))
    count_task = asyncio.create_task(_run_countdown())
    baseline, _ = await asyncio.gather(cal_task, count_task)

    samples = await _record_motion(RECORDING_SECONDS, baseline)

    bridge_common._state_ref[0] = "scoring"
    result = score_motion(samples, motion, tool, baseline)
    passed = result["passed"]
    print(f"  [PLAY] Scored {motion} with {tool}: {result['score']:.0%} ({'PASSED' if passed else 'FAILED'})")

    await bridge_common.broadcast({
        "type":   "result",
        "motion": motion,
        "tool":   tool,
        "score":  result["score"],
        "passed": passed,
    })

    bridge_common._state_ref[0] = "cooldown"
    await asyncio.sleep(1.5)
    return result["score"] if passed else 0.0

async def _wait_for_nfc(expected_tool: str) -> None:
    print(f"  [PLAY] Waiting for NFC tag: {expected_tool}")
    while not bridge_common._nfc_queue.empty():
        bridge_common._nfc_queue.get_nowait()
    while True:
        uid  = await bridge_common._nfc_queue.get()
        tool = NFC_TAGS.get(uid)
        print(f"  [PLAY] Scanned tag: {tool or uid}")
        if tool == expected_tool:
            return
        await bridge_common.broadcast({"type": "nfc_wrong", "scanned": tool or uid, "expected": expected_tool})

async def _run_countdown() -> None:
    bridge_common._state_ref[0] = "countdown"
    for i in range(COUNTDOWN_SECONDS, -1, -1):
        await bridge_common.broadcast({"type": "countdown", "seconds": i})
        await asyncio.sleep(1.0)

async def _record_motion(duration_s: float, baseline: tuple[float, float, float]) -> list[tuple[float, float, float]]:
    bridge_common._state_ref[0] = "recording"
    samples: list[tuple[float, float, float]] = []
    start = time.monotonic()
    last_tick = -1

    print(f"  [PLAY] Recording motion for {duration_s}s...")
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
    
    print(f"  [PLAY] Recorded {len(samples)} samples")
    return samples
