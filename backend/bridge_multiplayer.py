#!/usr/bin/env python3
"""
bridge_multiplayer.py: Multiplayer Bridge Controller
=====================================================
Scores motion for each player turn in the split-screen multiplayer game.
Follows the same pattern as bridge_play.py, but the frontend drives the
game flow — the backend only handles calibration, recording, and scoring.

Protocol (per player turn):
  Frontend → { type: 'player_ready', player: 1|2, step: int,
                motion: str, tool: str }
  Backend  → calibrate(0.5 s) → record(8 s) → score
           → { type: 'motion_result', player, step, motion, tool,
                confidence, passed }

Session lifecycle:
  Frontend → { type: 'ui_state', page: 'multiplayer-play',
                p1_name: str, p2_name: str }   — starts session
  Frontend → { type: 'ui_state', page: 'multiplayer-play-end' }  — ends session
"""

import asyncio
import time
import bridge_common
from classifier import SAMPLE_RATE, score_motion

# ── Configuration ──────────────────────────────────────────────────────────
# CALIBRATE_SECONDS = 0 reuses the existing baseline immediately so the
# backend finishes recording before the frontend's 8-second timer fires.
CALIBRATE_SECONDS  = 0.0
RECORDING_SECONDS  = 7       # backend finishes at ~7 s; frontend timer is 8 s

# Multiplayer pass threshold — slightly lower than the solo 0.60 because
# tools are randomly assigned and may not match the physical tool in hand.
MP_PASS_THRESHOLD  = 0.45

# ── State ───────────────────────────────────────────────────────────────────
_session_task:       asyncio.Task | None = None
_player_ready_queue: asyncio.Queue       = asyncio.Queue()


# ── Public API (called by launcher.py) ────────────────────────────────────

async def handle_start_game(msg: dict) -> None:
    """Called when the frontend sends { type: 'start_game', p1_name, p2_name }."""
    await _launch_session(
        msg.get("p1_name", "Player 1"),
        msg.get("p2_name", "Player 2"),
    )


async def handle_ui_state(msg: dict) -> None:
    """Route ui_state messages to the correct backend action."""
    page = msg.get("page", "")
    if page == "multiplayer-play":
        # Session was already started by handle_start_game; this is a no-op
        # unless names are embedded here (e.g., direct calls in tests).
        if not (_session_task and not _session_task.done()):
            await _launch_session(
                msg.get("p1_name", "Player 1"),
                msg.get("p2_name", "Player 2"),
            )
    else:
        await cancel_session()
        await bridge_common.broadcast({"type": "state", "state": "idle"})


async def handle_player_ready(msg: dict) -> None:
    """Called when the frontend signals a player has entered the motion phase."""
    await _player_ready_queue.put(msg)


async def cancel_session() -> None:
    """Cancel any running session task and drain the ready queue."""
    global _session_task
    if _session_task and not _session_task.done():
        _session_task.cancel()
        try:
            await _session_task
        except asyncio.CancelledError:
            pass
    _session_task = None
    bridge_common._state_ref[0] = "idle"
    while not _player_ready_queue.empty():
        _player_ready_queue.get_nowait()


# ── Internal helpers ───────────────────────────────────────────────────────

async def _launch_session(p1_name: str, p2_name: str) -> None:
    global _session_task
    await cancel_session()
    print(f"  [MP] Session started — {p1_name} vs {p2_name}")
    _session_task = asyncio.create_task(_session_loop())


async def _session_loop() -> None:
    """Sit idle and process player_ready events as they arrive."""
    try:
        bridge_common._state_ref[0] = "waiting_player"
        print("  [MP] Ready — waiting for player turns…")
        while True:
            msg    = await _player_ready_queue.get()
            player = int(msg.get("player", 1))
            step   = int(msg.get("step", 0))
            motion = str(msg.get("motion", ""))
            tool   = str(msg.get("tool", ""))
            print(f"  [MP] Player {player}  step {step}:  {motion}  ·  {tool}")
            await _score_turn(player, step, motion, tool)
    except asyncio.CancelledError:
        bridge_common._state_ref[0] = "idle"
        raise


async def _score_turn(player: int, step: int, motion: str, tool: str) -> None:
    """Calibrate, record, score, then broadcast the result."""
    baseline = await bridge_common.calibrate(CALIBRATE_SECONDS)
    samples  = await _record_motion(RECORDING_SECONDS)

    bridge_common._state_ref[0] = "scoring"
    result = score_motion(samples, motion, tool, baseline)
    # Use a slightly more lenient threshold than solo play to account for
    # randomly-assigned tools not matching the physical tool in hand.
    score  = float(result["score"])
    passed = score >= MP_PASS_THRESHOLD

    detail = result.get("detail", {})
    reason = result.get("reason", "")
    dbg    = (
        f"zc={detail.get('zc_mag','?')}  "
        f"xy_circ={detail.get('xy_circles', 0.0):.2f}  "
        f"mag_max={detail.get('mag_max', 0.0):.1f}"
        if detail else reason
    )
    print(
        f"  [MP] P{player} step {step}: {score:.0%} "
        f"({'PASS' if passed else 'FAIL'})  {dbg}"
    )

    await bridge_common.broadcast({
        "type":       "motion_result",
        "player":     player,
        "step":       step,
        "motion":     motion,
        "tool":       tool,
        "confidence": round(score, 3),
        "passed":     passed,
    })

    bridge_common._state_ref[0] = "waiting_player"


async def _record_motion(
    duration_s: float,
) -> list[tuple[float, float, float]]:
    """Record raw magnetometer samples for duration_s seconds."""
    bridge_common._state_ref[0] = "recording"
    samples:   list[tuple[float, float, float]] = []
    start      = time.monotonic()
    last_tick  = -1

    print(f"  [MP] Recording {duration_s} s…")
    while True:
        elapsed   = time.monotonic() - start
        remaining = int(duration_s - elapsed)

        if remaining != last_tick and remaining >= 0:
            last_tick = remaining
            await bridge_common.broadcast({
                "type":              "recording",
                "seconds_remaining": remaining,
            })

        if elapsed >= duration_s:
            break

        await asyncio.sleep(1.0 / SAMPLE_RATE)
        if bridge_common._latest_sensor:
            samples.append((
                bridge_common._latest_sensor["x_raw"],
                bridge_common._latest_sensor["y_raw"],
                bridge_common._latest_sensor["z_raw"],
            ))

    print(f"  [MP] Recorded {len(samples)} samples")
    return samples
