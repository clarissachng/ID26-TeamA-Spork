/* ================================================================
   Motion Recorder — Guided DTW Template Builder
   ================================================================
   Records RAW (unsmoothed) magnetometer data with a 3-phase protocol:
     Phase 1: 2 s  — HOLD STILL  (baseline)
     Phase 2: 5 s  — DO MOTION   (gesture)
     Phase 3: 1 s  — HOLD STILL  (tail)
   Total: 8 s per recording, ~200 samples at 25 Hz.
   Files auto-named: "pour 1.csv", "pour 2.csv", etc.
   ================================================================ */

// ── The 9 motions ────────────────────────────────────────
const MOTIONS = [
    { id: 'pour',           label: 'Pour',           icon: '🫗' },
    { id: 'whisk',          label: 'Whisk',          icon: '🥄' },
    { id: 'coffee_grinder', label: 'Coffee Grinder', icon: '⚙️' },
    { id: 'press_down',     label: 'Press Down',     icon: '⬇️' },
    { id: 'squeeze',        label: 'Squeeze',        icon: '🤏' },
    { id: 'tea_bag',        label: 'Tea Bag',        icon: '🍵' },
    { id: 'scoop',          label: 'Scoop',          icon: '🥣' },
    { id: 'stir',           label: 'Stir',           icon: '🔄' },
    { id: 'sieve',          label: 'Sieve',          icon: '🪣' },
];

const TARGET_RECORDINGS = 5;

// Phase durations (seconds)
const PHASE_BASELINE = 2;
const PHASE_MOTION   = 5;
const PHASE_TAIL     = 1;
const TOTAL_DURATION = PHASE_BASELINE + PHASE_MOTION + PHASE_TAIL; // 8s

// ── State ────────────────────────────────────────────────
let port, reader, chart;
let isConnected = false;
let currentMotion = null;   // e.g. 'pour'
let isRecording = false;
let recordPhase = null;     // 'baseline' | 'motion' | 'tail'
let recordedData = [];      // raw samples: {t, x, y, z}

// Session store: { 'pour': [ [samples], [samples], ... ], ... }
const session = {};
MOTIONS.forEach(m => { session[m.id] = []; });

// Timing
let recordStartTime = 0;
let recordTimer = null;
let timerRAF = null;

// Live data for chart (smoothed for display only)
const alpha = 0.3;
let sX = 0, sY = 0, sZ = 0;

// Sample rate tracking
let sampleTimestamps = [];

// ── DOM refs ─────────────────────────────────────────────
const btnConnect     = document.getElementById('btnConnect');
const connStatus     = document.getElementById('connStatus');
const sampleRateEl   = document.getElementById('sampleRate');
const motionGrid     = document.getElementById('motionGrid');
const recordPanel    = document.getElementById('recordPanel');
const currentMotionName = document.getElementById('currentMotionName');
const recordingCount = document.getElementById('recordingCount');
const btnRecord      = document.getElementById('btnRecord');
const btnBack        = document.getElementById('btnBack');
const overlay        = document.getElementById('overlay');
const overlayText    = document.getElementById('overlayText');
const overlaySubtext = document.getElementById('overlaySubtext');
const timerBar       = document.getElementById('timerBar');
const timerFill      = document.getElementById('timerFill');
const timerLabel     = document.getElementById('timerLabel');
const liveMag        = document.getElementById('liveMag');
const liveSamples    = document.getElementById('liveSamples');
const livePhase      = document.getElementById('livePhase');
const summaryGrid    = document.getElementById('summaryGrid');
const btnDownloadAll = document.getElementById('btnDownloadAll');
const btnReset       = document.getElementById('btnReset');

// Phase step elements
const phase1 = document.getElementById('phase1');
const phase2 = document.getElementById('phase2');
const phase3 = document.getElementById('phase3');

// ── Chart setup ──────────────────────────────────────────
function initChart() {
    const ctx = document.getElementById('magChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(100).fill(''),
            datasets: [
                { label: 'X (µT)', borderColor: '#ff6384', data: [], borderWidth: 2, pointRadius: 0 },
                { label: 'Y (µT)', borderColor: '#36a2eb', data: [], borderWidth: 2, pointRadius: 0 },
                { label: 'Z (µT)', borderColor: '#4caf50', data: [], borderWidth: 2, pointRadius: 0 },
                { label: 'Mag',    borderColor: '#ffeb3b', data: [], borderWidth: 2, pointRadius: 0, borderDash: [4,2] },
            ]
        },
        options: {
            animation: false,
            scales: {
                y: { min: -300, max: 300, ticks: { stepSize: 50 },
                     title: { display: true, text: 'µT', color: '#888' } }
            },
            plugins: { legend: { labels: { color: '#aaa' } } }
        }
    });
}

// ── Build motion grid ────────────────────────────────────
function buildMotionGrid() {
    motionGrid.innerHTML = '';
    for (const m of MOTIONS) {
        const count = session[m.id].length;
        const done = count >= TARGET_RECORDINGS;
        const card = document.createElement('div');
        card.className = 'motion-card' + (done ? ' done' : '');
        card.innerHTML = `
            <div class="motion-icon">${m.icon}</div>
            <div class="motion-name">${m.label}</div>
            <div class="motion-count">${count} / ${TARGET_RECORDINGS}</div>
            <div class="motion-bar"><div class="motion-bar-fill" style="width:${(count/TARGET_RECORDINGS)*100}%"></div></div>
        `;
        card.addEventListener('click', () => selectMotion(m.id));
        motionGrid.appendChild(card);
    }
}

// ── Build session summary ────────────────────────────────
function buildSummary() {
    summaryGrid.innerHTML = '';
    let totalRecordings = 0;
    for (const m of MOTIONS) {
        const count = session[m.id].length;
        totalRecordings += count;
        const el = document.createElement('div');
        el.className = 'summary-item' + (count >= TARGET_RECORDINGS ? ' complete' : '');
        el.innerHTML = `<span>${m.icon} ${m.label}</span><span class="summary-count">${count}</span>`;
        summaryGrid.appendChild(el);
    }
    btnDownloadAll.disabled = totalRecordings === 0;
}

// ── Select a motion to record ────────────────────────────
function selectMotion(motionId) {
    currentMotion = motionId;
    const m = MOTIONS.find(x => x.id === motionId);
    currentMotionName.innerText = m.icon + ' ' + m.label;
    updateRecordingCount();

    document.getElementById('motionGridHeader').classList.add('hidden');
    motionGrid.classList.add('hidden');
    recordPanel.classList.remove('hidden');

    btnRecord.disabled = !isConnected;
    btnRecord.innerText = 'Start Recording';
    btnRecord.classList.remove('recording');

    resetPhaseIndicator();
}

function updateRecordingCount() {
    const count = session[currentMotion].length;
    recordingCount.innerText = `${count} / ${TARGET_RECORDINGS} recorded`;
    recordingCount.className = 'recording-count' + (count >= TARGET_RECORDINGS ? ' complete' : '');
}

function goBackToGrid() {
    if (isRecording) return; // don't allow leaving mid-recording
    recordPanel.classList.add('hidden');
    motionGrid.classList.remove('hidden');
    document.getElementById('motionGridHeader').classList.remove('hidden');
    currentMotion = null;
    buildMotionGrid();
    buildSummary();
}

// ── Phase indicator ──────────────────────────────────────
function resetPhaseIndicator() {
    phase1.classList.remove('active', 'done');
    phase2.classList.remove('active', 'done');
    phase3.classList.remove('active', 'done');
    livePhase.innerText = '--';
}

function setActivePhase(num) {
    resetPhaseIndicator();
    if (num >= 1) phase1.classList.add(num === 1 ? 'active' : 'done');
    if (num >= 2) phase2.classList.add(num === 2 ? 'active' : 'done');
    if (num >= 3) phase3.classList.add(num === 3 ? 'active' : 'done');
    const labels = { 1: 'HOLD STILL', 2: 'DO MOTION', 3: 'HOLD STILL' };
    livePhase.innerText = labels[num] || '--';
}

// ── Overlay ──────────────────────────────────────────────
function showOverlay(text, subtext) {
    overlayText.innerText = text;
    overlaySubtext.innerText = subtext || '';
    overlay.classList.remove('hidden');
    overlayText.style.animation = 'none';
    overlayText.offsetHeight;
    overlayText.style.animation = '';
}
function hideOverlay() {
    overlay.classList.add('hidden');
}

// ── Serial connection ────────────────────────────────────
async function connect() {
    if (!('serial' in navigator)) {
        alert('Web Serial API not supported!\n\nYou must open this page in Chrome or Edge (not Firefox, not VS Code Simple Browser).\n\nURL: http://localhost:8080');
        return;
    }
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        isConnected = true;
        btnConnect.disabled = true;
        btnConnect.innerText = 'Connected';
        connStatus.innerText = 'Connected';
        connStatus.classList.add('connected');
        if (currentMotion) btnRecord.disabled = false;
        console.log('Serial port opened successfully');

        const decoder = new TextDecoderStream();
        port.readable.pipeTo(decoder.writable);
        reader = decoder.readable.getReader();
        readLoop();
    } catch (e) {
        console.error('Connection error:', e);
        alert('Connection failed: ' + e.message + '\n\nMake sure Serial Monitor is closed and bridge.py is not running!');
    }
}

async function readLoop() {
    let buffer = '';
    let parseCount = 0;
    console.log('readLoop started — waiting for data...');
    while (true) {
        const { value, done } = await reader.read();
        if (done) { console.log('Reader done'); break; }
        buffer += value;
        let lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const data = JSON.parse(trimmed);
                parseCount++;
                if (parseCount <= 3) console.log('Parsed sample #' + parseCount + ':', data);
                onSensorData(data);
            } catch (e) {
                if (parseCount === 0) console.warn('Failed to parse line:', trimmed, e);
            }
        }
    }
}

// ── Process each raw sample ──────────────────────────────
function onSensorData(data) {
    const rawX = data.x;
    const rawY = data.y;
    const rawZ = data.z;
    const mag = Math.sqrt(rawX * rawX + rawY * rawY + rawZ * rawZ);

    // Track sample rate
    const now = Date.now();
    sampleTimestamps.push(now);
    sampleTimestamps = sampleTimestamps.filter(t => t > now - 2000);
    const hz = sampleTimestamps.length / 2;
    sampleRateEl.innerText = `${hz.toFixed(0)} Hz`;

    // Smoothed values for chart display only
    sX = alpha * rawX + (1 - alpha) * sX;
    sY = alpha * rawY + (1 - alpha) * sY;
    sZ = alpha * rawZ + (1 - alpha) * sZ;
    const sMag = Math.sqrt(sX * sX + sY * sY + sZ * sZ);

    // Update chart
    if (chart) {
        chart.data.datasets[0].data.push(sX);
        chart.data.datasets[1].data.push(sY);
        chart.data.datasets[2].data.push(sZ);
        chart.data.datasets[3].data.push(sMag);
        if (chart.data.datasets[0].data.length > 100) {
            chart.data.datasets.forEach(d => d.data.shift());
        }
        chart.update();
    }

    // Live stats
    liveMag.innerText = mag.toFixed(0) + ' µT';
    if (isRecording) {
        liveSamples.innerText = recordedData.length;
    }

    // Record RAW data (no smoothing, no offset subtraction)
    if (isRecording) {
        recordedData.push({
            t: now,
            x: rawX,
            y: rawY,
            z: rawZ,
        });

        // Update phase based on elapsed time
        const elapsed = (now - recordStartTime) / 1000;
        if (elapsed < PHASE_BASELINE) {
            setActivePhase(1);
        } else if (elapsed < PHASE_BASELINE + PHASE_MOTION) {
            setActivePhase(2);
        } else {
            setActivePhase(3);
        }
    }
}

// ── Recording flow ───────────────────────────────────────
function startRecordingFlow() {
    if (isRecording) return;

    btnRecord.disabled = true;
    btnBack.disabled = true;

    // Countdown: 3 → 2 → 1 → GO
    let count = 3;
    showOverlay(count, 'Get ready — hold sensor still');
    const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
            showOverlay(count, 'Hold sensor still...');
        } else {
            clearInterval(countInterval);
            showOverlay('GO', 'Hold still for baseline...');
            setTimeout(() => {
                hideOverlay();
                beginRecording();
            }, 400);
        }
    }, 1000);
}

function beginRecording() {
    isRecording = true;
    recordedData = [];
    recordStartTime = Date.now();
    liveSamples.innerText = '0';

    btnRecord.innerText = 'Recording...';
    btnRecord.classList.add('recording');
    btnRecord.disabled = true; // can't stop early — enforce full protocol

    // Show timer bar
    timerBar.classList.remove('hidden');
    timerFill.style.width = '100%';

    setActivePhase(1);

    // Phase transition overlays
    const baselineEnd = PHASE_BASELINE * 1000;
    const motionEnd   = (PHASE_BASELINE + PHASE_MOTION) * 1000;

    // After baseline period → show "DO MOTION NOW"
    setTimeout(() => {
        if (!isRecording) return;
        showOverlay('DO THE MOTION!', currentMotionName.innerText);
        setTimeout(hideOverlay, 800);
    }, baselineEnd);

    // After motion period → show "HOLD STILL"
    setTimeout(() => {
        if (!isRecording) return;
        showOverlay('HOLD STILL', 'Finishing up...');
        setTimeout(hideOverlay, 600);
    }, motionEnd);

    // Animate timer bar
    function tickTimer() {
        if (!isRecording) return;
        const elapsed = (Date.now() - recordStartTime) / 1000;
        const remaining = Math.max(0, TOTAL_DURATION - elapsed);
        const pct = (remaining / TOTAL_DURATION) * 100;
        timerFill.style.width = pct + '%';
        timerLabel.innerText = remaining.toFixed(1) + 's';

        // Color the timer based on phase
        if (elapsed < PHASE_BASELINE) {
            timerFill.style.background = '#2196F3';
        } else if (elapsed < PHASE_BASELINE + PHASE_MOTION) {
            timerFill.style.background = 'linear-gradient(90deg, #f44336, #ff9800)';
        } else {
            timerFill.style.background = '#2196F3';
        }

        if (remaining > 0) {
            timerRAF = requestAnimationFrame(tickTimer);
        }
    }
    timerRAF = requestAnimationFrame(tickTimer);

    // Auto-stop after total duration
    recordTimer = setTimeout(() => finishRecording(), TOTAL_DURATION * 1000);
}

function finishRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
    if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }

    timerBar.classList.add('hidden');
    btnRecord.classList.remove('recording');
    resetPhaseIndicator();

    const n = recordedData.length;
    const dur = n > 0 ? ((recordedData[n-1].t - recordedData[0].t) / 1000).toFixed(1) : 0;

    if (n < 20) {
        showOverlay('Too few samples!', `Only got ${n}. Try again.`);
        setTimeout(hideOverlay, 1500);
        btnRecord.innerText = 'Start Recording';
        btnRecord.disabled = false;
        btnBack.disabled = false;
        return;
    }

    // Save to session
    session[currentMotion].push([...recordedData]);
    const recNum = session[currentMotion].length;

    showOverlay('Saved!', `${currentMotion} ${recNum} — ${n} samples (${dur}s)`);
    setTimeout(hideOverlay, 1200);

    // Auto-download CSV
    downloadRecording(currentMotion, recNum, recordedData);

    updateRecordingCount();
    buildSummary();

    // Reset for next recording
    recordedData = [];
    liveSamples.innerText = '0';
    livePhase.innerText = '--';

    btnRecord.innerText = 'Start Recording';
    btnRecord.disabled = false;
    btnBack.disabled = false;
}

// ── CSV download ─────────────────────────────────────────
function downloadRecording(motionId, num, samples) {
    const csv = 'timestamp,x_uT,y_uT,z_uT\n' +
        samples.map(s => `${s.t},${s.x},${s.y},${s.z}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${motionId} ${num}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function downloadAllCSVs() {
    for (const m of MOTIONS) {
        session[m.id].forEach((samples, i) => {
            downloadRecording(m.id, i + 1, samples);
        });
    }
}

function resetSession() {
    if (!confirm('Delete all recordings in this session?')) return;
    MOTIONS.forEach(m => { session[m.id] = []; });
    buildMotionGrid();
    buildSummary();
    if (currentMotion) updateRecordingCount();
}

// ── Event listeners ──────────────────────────────────────
btnConnect.addEventListener('click', connect);
btnRecord.addEventListener('click', startRecordingFlow);
btnBack.addEventListener('click', goBackToGrid);
btnDownloadAll.addEventListener('click', downloadAllCSVs);
btnReset.addEventListener('click', resetSession);

// ── Init ─────────────────────────────────────────────────
initChart();
buildMotionGrid();
buildSummary();