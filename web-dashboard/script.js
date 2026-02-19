let port, reader, chart;
let recordedData = [];
let isRecording = false;

// 1. Smoothing & Offset Variables
const alpha = 0.4; // [cite: 5]
let sX = 0, sY = 0, sZ = 0;
let sX2 = 0, sY2 = 0;
let offsetX = 0, offsetY = 0, offsetZ = 0; 

// 2. Initialize Chart.js with FIXED Y-Axis Height
const ctx = document.getElementById('magChart').getContext('2d');
chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: Array(50).fill(""),
        datasets: [
            { label: 'X (µT)', borderColor: '#ff6384', data: [], borderWidth: 2, pointRadius: 0 },
            { label: 'Y (µT)', borderColor: '#36a2eb', data: [], borderWidth: 2, pointRadius: 0 },
            { label: 'Z (µT)', borderColor: '#4caf50', data: [], borderWidth: 2, pointRadius: 0 }
        ]
    },
    options: { 
        animation: false, 
        scales: { 
            y: { 
                // FIXED HEIGHT SETTINGS
                min: -500, // Lock the bottom at -500 µT
                max: 500,  // Lock the top at 500 µT
                ticks: { stepSize: 50 },
                title: {
                    display: true,
                    text: 'Magnetic Flux Density (µT)',
                    color: '#888'
                }
            } 
        } 
    }
});

// 3. Setup Trace Canvas
const circleContainer = document.querySelector('.compass-circle');
const traceCanvas = document.createElement('canvas');
traceCanvas.width = 220; 
traceCanvas.height = 220;
traceCanvas.style.position = "absolute";
traceCanvas.style.top = "0";
traceCanvas.style.left = "0";
traceCanvas.style.pointerEvents = "none";
circleContainer.appendChild(traceCanvas);
const tctx = traceCanvas.getContext('2d');

// 4. Sensitivity Slider Logic
let currentScale = 2.5;
const rangeInput = document.getElementById('rangeScale');
const scaleDisplay = document.getElementById('scaleDisplay');

if(rangeInput) {
    rangeInput.addEventListener('input', (e) => {
        currentScale = parseFloat(e.target.value);
        scaleDisplay.innerText = currentScale.toFixed(1) + "x";
    });
}

// 5. Zero / Tare Button Logic [cite: 17]
const btnTare = document.getElementById('btnTare');
if(btnTare) {
    btnTare.addEventListener('click', () => {
        offsetX = sX;
        offsetY = sY;
        offsetZ = sZ;
        tctx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
    });
}

// 6. Serial Connection [cite: 10]
async function connect() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        document.getElementById('btnConnect').disabled = true;
        document.getElementById('btnRecord').disabled = false;
        
        const decoder = new TextDecoderStream();
        port.readable.pipeTo(decoder.writable);
        reader = decoder.readable.getReader();
        readLoop();
    } catch (e) {
        alert("Connection failed. Make sure Serial Monitor is closed!");
    }
}

async function readLoop() {
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let lines = buffer.split("\n");
        buffer = lines.pop();
        for (let line of lines) {
            try {
                const data = JSON.parse(line);
                updateUI(data);
                if (isRecording) {
                    recordedData.push({ 
                        t: Date.now(), 
                        x: (sX - offsetX).toFixed(2), 
                        y: (sY - offsetY).toFixed(2), 
                        z: (sZ - offsetZ).toFixed(2) 
                    });
                }
            } catch (e) {}
        }
    }
}

function updateUI(data) {
    // Apply Smoothing [cite: 5]
    sX = (alpha * data.x) + ((1 - alpha) * sX);
    sY = (alpha * data.y) + ((1 - alpha) * sY);
    sZ = (alpha * data.z) + ((1 - alpha) * sZ);

    const finalX = sX - offsetX;
    const finalY = sY - offsetY;
    const finalZ = sZ - offsetZ;

    // Update Graph [cite: 24]
    chart.data.datasets[0].data.push(finalX);
    chart.data.datasets[1].data.push(finalY);
    chart.data.datasets[2].data.push(finalZ);
    if (chart.data.datasets[0].data.length > 50) {
        chart.data.datasets.forEach(d => d.data.shift());
    }
    chart.update();

    // Visualiser Clamping Logic [cite: 22, 23]
    const p1 = document.getElementById('magnetPointer1');
    const p2 = document.getElementById('magnetPointer2');
    const maxRadius = 100;

    function getClampedPos(valX, valY) {
        let xPos = valX * currentScale;
        let yPos = valY * currentScale;
        const dist = Math.sqrt(xPos * xPos + yPos * yPos);
        if (dist > maxRadius) {
            const ratio = maxRadius / dist;
            xPos *= ratio;
            yPos *= ratio;
        }
        return { x: xPos, y: yPos };
    }

    const pos1 = getClampedPos(finalX, finalY);
    p1.style.transform = `translate(calc(-50% + ${pos1.x}px), calc(-50% - ${pos1.y}px))`;
    drawTrace(pos1.x, pos1.y, '#36a2eb'); 

    if (data.x2 !== undefined) {
        sX2 = (alpha * data.x2) + ((1 - alpha) * sX2);
        sY2 = (alpha * data.y2) + ((1 - alpha) * sY2);
        const pos2 = getClampedPos(sX2 - offsetX, sY2 - offsetY);
        p2.style.display = "block";
        p2.style.transform = `translate(calc(-50% + ${pos2.x}px), calc(-50% - ${pos2.y}px))`;
        drawTrace(pos2.x, pos2.y, '#ff6384');
    } else {
        p1.className = "pointer blue-dot";
        p2.style.display = "none";
    }

    let angle = Math.atan2(finalY, finalX) * (180 / Math.PI); // [cite: 22]
    document.getElementById('headingVal').innerText = Math.round(angle < 0 ? angle + 360 : angle) + "°";
}

function drawTrace(x, y, color) {
    tctx.fillStyle = "rgba(18, 18, 18, 0.05)"; 
    tctx.fillRect(0, 0, traceCanvas.width, traceCanvas.height);
    tctx.beginPath();
    tctx.arc(110 + x, 110 - y, 2, 0, Math.PI * 2);
    tctx.fillStyle = color;
    tctx.fill();
}

// 7. Individual Recording Logic
const btnRecord = document.getElementById('btnRecord');
const btnNewSession = document.getElementById('btnNewSession');

document.getElementById('btnConnect').addEventListener('click', connect);

btnRecord.addEventListener('click', (e) => {
    isRecording = !isRecording;
    if (isRecording) {
        recordedData = []; 
        e.target.innerText = "⏹ Stop & Save";
        e.target.classList.add('recording');
    } else {
        e.target.innerText = "🔴 Start Recording";
        e.target.classList.remove('recording');
        if (recordedData.length > 0) saveIndividualRecording();
    }
});

function saveIndividualRecording() {
    let name = window.prompt("Name this recording:", "motion_capture_uT");
    if (!name) return;

    let csv = "timestamp,x_uT,y_uT,z_uT\n" + recordedData.map(r => `${r.t},${r.x},${r.y},${r.z}`).join("\n");
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + ".csv";
    a.click();
    recordedData = []; 
}

btnNewSession.addEventListener('click', () => {
    if (confirm("Reset current session?")) {
        recordedData = [];
        tctx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
    }
});