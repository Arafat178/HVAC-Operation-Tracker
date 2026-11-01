import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7Udcwqn6OYfBVnoylKi3w9BIPeMZuySU",
  authDomain: "hvac-e6c58.firebaseapp.com",
  projectId: "hvac-e6c58",
  storageBucket: "hvac-e6c58.firebasestorage.app",
  messagingSenderId: "400744939926",
  appId: "1:400744939926:web:1bfd2b42575407b417ddb7",
  measurementId: "G-W7ZHREXW77"
};

let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (e) {
    console.warn("Firebase not fully configured yet. UI will load but data won't sync.");
}

const state = {
    user: null, role: 'public', equipment: [], history: [],
    unsubEquipment: null, liveTimerInterval: null, selectedEqId: null
};

const DOM = {
    get: id => document.getElementById(id),
    show: id => { const el = document.getElementById(id); if(el) el.classList.remove('hidden'); },
    hide: id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); },
    val: id => document.getElementById(id).value.trim(),
};

function formatTimeDH(timestamp) {
    if (!timestamp) return '-';
    const dateObj = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(dateObj);
}

function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0h 0m 0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

function showToast(message, type = 'info') {
    const toast = DOM.get('toast');
    toast.textContent = message;
    toast.style.backgroundColor = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--cyan)';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

let modalResolver = null;
function showConfirm(title, message) {
    DOM.get('modalTitle').textContent = title;
    DOM.get('modalMessage').textContent = message;
    DOM.show('customModal');
    return new Promise(resolve => { modalResolver = resolve; });
}

DOM.get('modalCancel').addEventListener('click', () => { DOM.hide('customModal'); if(modalResolver) modalResolver(false); });
DOM.get('modalConfirm').addEventListener('click', () => { DOM.hide('customModal'); if(modalResolver) modalResolver(true); });
document.querySelector('.close-modal').addEventListener('click', () => { DOM.hide('customModal'); if(modalResolver) modalResolver(false); });

function switchView(targetId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(btn => {
        if(btn.dataset.target === targetId) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    DOM.get(targetId).classList.add('active');
    
    if(targetId === 'view-equipment') renderEquipmentList();
    if(targetId === 'view-history' && state.history.length === 0) loadHistory();
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.target;
        switchView(target);
    });
});

if(auth) {
    onAuthStateChanged(auth, async (user) => {
        state.user = user;
        if (user) {
            try {
                const docSnap = await getDoc(doc(db, "users", user.uid));
                if (docSnap.exists()) state.role = docSnap.data().role || 'public';
                else state.role = 'public'; 
            } catch(e) {
                console.error("Error fetching role", e);
                state.role = 'public';
            }
            updateUIForRole();
            switchView('view-dashboard');
        } else {
            state.role = 'public';
            updateUIForRole();
        }
    });
}

function updateUIForRole() {
    const isAuth = state.role === 'admin' || state.role === 'operator';
    const isAdmin = state.role === 'admin';

    // Desktop Auth Button
    const authBtn = DOM.get('authButton');
    if (isAuth) {
        authBtn.textContent = 'Logout';
        authBtn.classList.replace('btn-primary', 'btn-outline');
        DOM.get('userInfoDisplay').innerHTML = `
            <span class="user-name">${state.user.email.split('@')[0]}</span>
            <span class="user-role badge-role">${state.role.toUpperCase()}</span>
        `;
    } else {
        authBtn.textContent = 'Login';
        authBtn.classList.replace('btn-outline', 'btn-primary');
        DOM.get('userInfoDisplay').innerHTML = `
            <span class="user-name">Public Viewer</span>
            <span class="user-role badge-role">READ-ONLY</span>
        `;
    }

    // Mobile Auth Icon behavior
    const mobileAuthIcon = document.getElementById('mobileAuthIcon');
    if (mobileAuthIcon) {
        if (isAuth) {
            mobileAuthIcon.textContent = 'logout';
            mobileAuthIcon.style.color = 'var(--red)';
            mobileAuthIcon.style.textShadow = '0 0 10px rgba(255, 51, 102, 0.5)';
        } else {
            mobileAuthIcon.textContent = 'account_circle';
            mobileAuthIcon.style.color = 'var(--cyan)';
            mobileAuthIcon.style.textShadow = 'var(--cyan-glow)';
        }
    }

    document.querySelectorAll('.admin-only').forEach(el => {
        if(isAdmin) el.classList.remove('hidden'); else el.classList.add('hidden');
    });

    const detActions = DOM.get('det-actions');
    if (isAuth) detActions.classList.remove('hidden'); else detActions.classList.add('hidden');
    
    if(document.getElementById('view-equipment').classList.contains('active')) renderEquipmentList();
    if(state.selectedEqId) renderDetails(state.selectedEqId);
}

// Click Listeners for Login/Logout (Desktop & Mobile)
const handleAuthAction = () => {
    if (state.user) {
        signOut(auth).then(() => showToast('Logged out successfully', 'success'));
    } else {
        switchView('view-login');
    }
};

DOM.get('authButton').addEventListener('click', handleAuthAction);
const mobileAuthBtn = document.getElementById('mobileAuthBtn');
if (mobileAuthBtn) mobileAuthBtn.addEventListener('click', handleAuthAction);

DOM.get('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = DOM.get('loginSubmitBtn');
    btn.disabled = true; btn.textContent = 'Authenticating...';
    
    signInWithEmailAndPassword(auth, DOM.val('loginEmail'), DOM.val('loginPassword'))
        .then(() => { showToast('Login successful', 'success'); DOM.get('loginForm').reset(); })
        .catch(error => {
            const err = DOM.get('loginError');
            err.textContent = 'Invalid credentials. Contact Administrator.';
            err.style.display = 'block';
        })
        .finally(() => { btn.disabled = false; btn.textContent = 'Log In'; });
});

function startEquipmentListener() {
    if (!db) return;
    const q = query(collection(db, "equipment"), where("active", "==", true));
    
    state.unsubEquipment = onSnapshot(q, (snapshot) => {
        state.equipment = [];
        snapshot.forEach(doc => state.equipment.push({ id: doc.id, ...doc.data() }));
        
        updateDashboard();
        
        if(document.getElementById('view-equipment').classList.contains('active')) renderEquipmentList();
        if(state.selectedEqId && document.getElementById('view-details').classList.contains('active')) renderDetails(state.selectedEqId);
        
        const lastUpd = DOM.get('lastUpdated');
        if(lastUpd) lastUpd.textContent = `Last updated: ${new Date().toLocaleTimeString('en-US', {timeZone: 'Asia/Dhaka'})}`;
    }, (error) => {
        console.error("Listener error:", error);
        showToast("Connection lost. Operating offline.", "error");
    });
}

function updateDashboard() {
    let running = 0, stopped = 0, total = state.equipment.length;
    let bldgs = {};

    state.equipment.forEach(eq => {
        if(eq.status === 'RUNNING') running++;
        else stopped++;

        if(!bldgs[eq.building]) bldgs[eq.building] = { total: 0, running: 0 };
        bldgs[eq.building].total++;
        if(eq.status === 'RUNNING') bldgs[eq.building].running++;
    });

    DOM.get('dash-total').textContent = total;
    DOM.get('dash-running').textContent = running;
    DOM.get('dash-stopped').textContent = stopped;
    DOM.get('dash-inactive').textContent = '0';

    const bldgList = DOM.get('buildingSummaryList');
    bldgList.innerHTML = Object.keys(bldgs).length ? '' : '<div class="empty-state text-muted">No equipment mapped</div>';
    
    for (const [name, stats] of Object.entries(bldgs)) {
        bldgList.innerHTML += `
            <div class="building-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--card-border);">
                <div class="b-info">
                    <h4 style="font-size: 0.95rem; margin-bottom: 2px;">${name}</h4>
                    <p style="font-size: 0.75rem; color: var(--text-muted);">${stats.running} running / ${stats.total} total</p>
                </div>
                <div class="b-stats">
                    <span class="badge status-running">${Math.round((stats.running/stats.total)*100)}% ON</span>
                </div>
            </div>`;
    }
}

DOM.get('searchEq').addEventListener('input', renderEquipmentList);
DOM.get('filterType').addEventListener('change', renderEquipmentList);
DOM.get('filterStatus').addEventListener('change', renderEquipmentList);

let isListView = false;
DOM.get('toggleViewBtn').addEventListener('click', () => {
    isListView = !isListView;
    const container = DOM.get('equipmentContainer');
    container.classList.toggle('card-view', !isListView);
    container.classList.toggle('list-view', isListView);
    DOM.get('toggleViewBtn').innerHTML = isListView ? '<span class="material-symbols-outlined">grid_view</span>' : '<span class="material-symbols-outlined">view_list</span>';
});

function renderEquipmentList() {
    const container = DOM.get('equipmentContainer');
    const search = DOM.val('searchEq').toLowerCase();
    const type = DOM.val('filterType');
    const status = DOM.val('filterStatus');

    const filtered = state.equipment.filter(eq => {
        const matchSearch = eq.equipmentId.toLowerCase().includes(search) || (eq.servedRooms && eq.servedRooms.some(r => r.toLowerCase().includes(search)));
        const matchType = type ? eq.equipmentType === type : true;
        const matchStatus = status ? eq.status === status : true;
        return matchSearch && matchType && matchStatus;
    });

    container.innerHTML = filtered.length ? '' : '<div style="grid-column: 1/-1" class="text-center mt-2 text-muted">No equipment found matching criteria.</div>';

    filtered.forEach(eq => {
        const badgeCls = eq.status === 'RUNNING' ? 'status-running' : 'status-stopped';
        const card = document.createElement('div');
        card.className = 'eq-card';
        card.onclick = () => openDetails(eq.id);
        card.innerHTML = `
            <div class="eq-header">
                <span class="eq-title">${eq.equipmentId}</span>
                <span class="badge ${badgeCls}">${eq.status}</span>
            </div>
            <div class="eq-meta">
                <p><span class="material-symbols-outlined">domain</span> ${eq.building} - ${eq.floor}</p>
                <p><span class="material-symbols-outlined">category</span> Type: ${eq.equipmentType}</p>
                <p><span class="material-symbols-outlined">meeting_room</span> Rooms: ${eq.servedRooms ? eq.servedRooms.length : 0}</p>
            </div>
            ${(state.role === 'admin' || state.role === 'operator') ? 
                `<div class="mt-1" style="display:flex; gap:10px;">
                    ${eq.status === 'STOPPED' ? 
                        `<button class="btn btn-success w-100" onclick="event.stopPropagation(); executeOp('${eq.id}', 'START')">START</button>` : 
                        `<button class="btn btn-danger w-100" onclick="event.stopPropagation(); executeOp('${eq.id}', 'STOP')">STOP</button>`}
                </div>` : ''}
            
            ${(state.role === 'admin') ? 
                `<div class="mt-1" style="border-top: 1px solid var(--card-border); padding-top: 10px;">
                    <button class="btn btn-outline w-100 text-danger" style="border-color: var(--red);" onclick="event.stopPropagation(); deleteEquipment('${eq.id}', '${eq.equipmentId}')">
                        <span class="material-symbols-outlined" style="font-size:16px;">delete</span> Delete
                    </button>
                </div>` : ''}
        `;
        container.appendChild(card);
    });
}

function openDetails(eqId) {
    state.selectedEqId = eqId;
    renderDetails(eqId);
    switchView('view-details');
}

DOM.get('backToEqBtn').addEventListener('click', () => {
    state.selectedEqId = null;
    clearInterval(state.liveTimerInterval);
    switchView('view-equipment');
});

function renderDetails(eqId) {
    const eq = state.equipment.find(e => e.id === eqId);
    if(!eq) return;

    clearInterval(state.liveTimerInterval);

    const badgeCls = eq.status === 'RUNNING' ? 'status-running' : 'status-stopped';
    DOM.get('det-header').innerHTML = `
        <div>
            <h2>${eq.equipmentId}</h2>
            <p class="subtitle">${eq.equipmentType} | ${eq.building} - ${eq.floor}</p>
        </div>
        <span class="badge ${badgeCls}">${eq.status}</span>
    `;

    DOM.get('det-location').textContent = eq.location || 'N/A';
    DOM.get('det-rooms').innerHTML = eq.servedRooms ? eq.servedRooms.join('<br>') : 'None';
    
    DOM.get('det-on-time').textContent = formatTimeDH(eq.lastOnTime);
    DOM.get('det-off-time').textContent = formatTimeDH(eq.lastOffTime);

    const actDiv = DOM.get('det-actions');
    actDiv.innerHTML = '';
    
    if (state.role === 'admin' || state.role === 'operator') {
        if (eq.status === 'STOPPED') {
            actDiv.innerHTML = `<button class="btn btn-success w-100" onclick="executeOp('${eq.id}', 'START')"><span class="material-symbols-outlined">power_settings_new</span> START EQUIPMENT</button>`;
            DOM.get('det-duration').textContent = 'Not Running';
            DOM.get('det-duration').style.color = 'var(--text-muted)';
            DOM.get('det-duration').style.textShadow = 'none';
        } else {
            actDiv.innerHTML = `<button class="btn btn-danger w-100" onclick="executeOp('${eq.id}', 'STOP')"><span class="material-symbols-outlined">stop_circle</span> STOP EQUIPMENT</button>`;
            DOM.get('det-duration').style.color = 'var(--cyan)';
            DOM.get('det-duration').style.textShadow = 'var(--cyan-glow)';
            
            if(eq.lastOnTime) {
                const startTime = eq.lastOnTime.toDate ? eq.lastOnTime.toDate().getTime() : new Date(eq.lastOnTime).getTime();
                const updateLive = () => {
                    const diff = Math.floor((Date.now() - startTime) / 1000);
                    DOM.get('det-duration').textContent = formatDuration(diff);
                };
                updateLive();
                state.liveTimerInterval = setInterval(updateLive, 1000);
            }
        }
    } else {
        if(eq.status === 'RUNNING') DOM.get('det-duration').textContent = 'Currently Running';
        else DOM.get('det-duration').textContent = 'Stopped';
    }
}

window.executeOp = async function(eqId, action) {
    if (!state.user) return;
    const eqData = state.equipment.find(e => e.id === eqId);
    const readableId = eqData ? eqData.equipmentId : eqId;

    const confirm = await showConfirm(`${action} EQUIPMENT`, `Are you sure you want to ${action} equipment ${readableId}?`);
    if (!confirm) return;

    try {
        const eqRef = doc(db, 'equipment', eqId);
        await runTransaction(db, async (transaction) => {
            const eqDoc = await transaction.get(eqRef);
            if (!eqDoc.exists()) throw "Equipment not found";
            
            const data = eqDoc.data();
            
            if (action === 'START') {
                if (data.status === 'RUNNING') throw "Equipment is already running.";
                const logRef = doc(collection(db, 'operationLogs'));
                transaction.update(eqRef, { status: 'RUNNING', lastOnTime: serverTimestamp(), currentLogId: logRef.id });
                transaction.set(logRef, { equipmentId: data.equipmentId, equipmentType: data.equipmentType, building: data.building, floor: data.floor, startTime: serverTimestamp(), status: 'RUNNING', startedBy: state.user.uid, createdAt: serverTimestamp() });
            } else if (action === 'STOP') {
                if (data.status === 'STOPPED') throw "Equipment is already stopped.";
                if (!data.currentLogId) throw "No active run log found to stop.";

                const logRef = doc(db, 'operationLogs', data.currentLogId);
                const logDoc = await transaction.get(logRef);
                
                let durationSecs = 0;
                if(logDoc.exists() && logDoc.data().startTime) {
                    const startTs = logDoc.data().startTime.toDate().getTime();
                    durationSecs = Math.floor((Date.now() - startTs) / 1000);
                }

                transaction.update(eqRef, { status: 'STOPPED', lastOffTime: serverTimestamp(), currentLogId: null });
                transaction.update(logRef, { stopTime: serverTimestamp(), durationSeconds: durationSecs, status: 'STOPPED', stoppedBy: state.user.uid });
            }
        });
        showToast(`Equipment ${action} successful.`, 'success');
    } catch (err) {
        console.error("Transaction failed: ", err);
        showToast(err.message || err, 'error');
    }
}

async function loadHistory() {
    if(!db) return;
    const tbody = DOM.get('historyTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Loading history...</td></tr>';
    try {
        const q = query(collection(db, "operationLogs"), orderBy("createdAt", "desc"), limit(50));
        const snapshot = await getDocs(q);
        state.history = [];
        snapshot.forEach(doc => state.history.push({id: doc.id, ...doc.data()}));
        renderHistory();
    } catch(e) {
        console.error("Error loading history", e);
        tbody.innerHTML = '<tr><td colspan="8" class="text-danger text-center">Failed to load history</td></tr>';
    }
}

function renderHistory() {
    const tbody = DOM.get('historyTableBody');
    if(!state.history.length) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No records found</td></tr>'; return; }
    
    tbody.innerHTML = '';
    state.history.forEach(log => {
        const badgeCls = log.status === 'RUNNING' ? 'status-running' : 'status-stopped';
        const dateStr = log.startTime ? formatTimeDH(log.startTime).split(',')[0] : '-';
        tbody.innerHTML += `
            <tr>
                <td>${dateStr}</td>
                <td><strong style="color: var(--cyan);">${log.equipmentId}</strong></td>
                <td>${log.equipmentType}</td>
                <td>${formatTimeDH(log.startTime)}</td>
                <td>${formatTimeDH(log.stopTime)}</td>
                <td>${formatDuration(log.durationSeconds)}</td>
                <td>${log.startedBy ? 'User' : '-'}</td>
                <td><span class="badge ${badgeCls}">${log.status}</span></td>
            </tr>
        `;
    });
}

DOM.get('exportHistoryBtn').addEventListener('click', () => {
    if(!state.history.length) return showToast("No data to export", "error");
    let csvContent = "data:text/csv;charset=utf-8,Equipment ID,Type,Building,ON Time,OFF Time,Duration (s),Status\n";
    state.history.forEach(log => {
        const onT = formatTimeDH(log.startTime).replace(/,/g, '');
        const offT = formatTimeDH(log.stopTime).replace(/,/g, '');
        csvContent += `${log.equipmentId},${log.equipmentType},${log.building},${onT},${offT},${log.durationSeconds||0},${log.status}\n`;
    });
    const link = document.createElement("a");
    link.href = encodeURI(csvContent); link.download = `HVAC_History_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
});

DOM.get('generateReportBtn').addEventListener('click', async () => {
    const dateVal = DOM.val('reportDate');
    if(!dateVal) return showToast("Please select a date first", "error");

    const tbody = DOM.get('reportTableBody');
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Generating Report...</td></tr>';
    if(state.history.length === 0) await loadHistory();

    const reportData = {};
    const targetDate = new Date(dateVal).toDateString();

    state.history.forEach(log => {
        if(!log.startTime) return;
        const logDate = log.startTime.toDate ? log.startTime.toDate().toDateString() : new Date(log.startTime).toDateString();
        if(logDate === targetDate) {
            if(!reportData[log.equipmentId]) reportData[log.equipmentId] = { runs: 0, time: 0 };
            reportData[log.equipmentId].runs += 1;
            reportData[log.equipmentId].time += (log.durationSeconds || 0);
        }
    });

    if(Object.keys(reportData).length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">No operation data found for this date</td></tr>'; return;
    }

    tbody.innerHTML = '';
    for(const [eqId, data] of Object.entries(reportData)) {
        tbody.innerHTML += `<tr><td><strong style="color: var(--cyan);">${eqId}</strong></td><td>${formatDuration(data.time)}</td><td>${data.runs} times</td></tr>`;
    }
    showToast("Report generated successfully", "success");
});

DOM.get('addEqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(state.role !== 'admin') return showToast("Permission denied", "error");

    const btn = DOM.get('saveEqBtn'); btn.disabled = true;
    const eqIdStr = DOM.val('frmId');
    const roomsArr = DOM.val('frmRooms').split(',').map(r => r.trim()).filter(r => r);
    
    const payload = { equipmentId: eqIdStr, equipmentType: DOM.val('frmType'), building: DOM.val('frmBuilding'), floor: DOM.val('frmFloor'), location: DOM.val('frmLocation'), servedRooms: roomsArr, status: 'STOPPED', active: true, createdAt: serverTimestamp(), lastOnTime: null, lastOffTime: null, currentLogId: null };

    try {
        await setDoc(doc(collection(db, "equipment")), payload);
        showToast("Equipment added successfully", "success"); DOM.get('addEqForm').reset();
    } catch(err) { showToast("Error adding equipment", "error"); console.error(err);
    } finally { btn.disabled = false; }
});

window.deleteEquipment = async function(docId, readableId) {
    const confirm = await showConfirm("DELETE EQUIPMENT", `Are you sure you want to permanently delete ${readableId}?`);
    if(!confirm) return;
    try { await deleteDoc(doc(db, "equipment", docId)); showToast(`${readableId} deleted successfully`, "success");
    } catch(e) { console.error("Delete failed: ", e); showToast("Failed to delete equipment", "error"); }
};

DOM.get('importCsvBtn').addEventListener('click', async () => {
    if(state.role !== 'admin') return showToast("Permission denied", "error");
    const file = DOM.get('csvFileInput').files[0];
    if(!file) return showToast("Please select a .csv file first", "error");

    const btn = DOM.get('importCsvBtn'); const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Importing... Please wait';

    const reader = new FileReader();
    reader.onload = async function(e) {
        const rows = e.target.result.split('\n');
        let successCount = 0, errorCount = 0;
        for(let i = 1; i < rows.length; i++) {
            const row = rows[i].trim();
            if(!row) continue;
            const columns = row.split(',');
            if(columns.length < 4) { errorCount++; continue; }
            const [eqId, type, building, floor, location = '', rooms = ''] = columns;
            const roomsArray = rooms.split(/[|+]/).map(r => r.trim()).filter(r => r);

            const payload = { equipmentId: eqId.trim(), equipmentType: type.trim().toUpperCase(), building: building.trim(), floor: floor.trim(), location: location.trim(), servedRooms: roomsArray, status: 'STOPPED', active: true, createdAt: serverTimestamp(), lastOnTime: null, lastOffTime: null, currentLogId: null };
            try { await setDoc(doc(collection(db, "equipment")), payload); successCount++;
            } catch(err) { console.error("Failed to import row: ", eqId, err); errorCount++; }
        }
        DOM.get('csvFileInput').value = ''; btn.disabled = false; btn.innerHTML = originalText;
        if(successCount > 0) showToast(`Successfully imported ${successCount} equipments. ${errorCount ? `Failed: ${errorCount}` : ''}`, "success");
        else showToast("Failed to import. Check CSV format.", "error");
    };
    reader.onerror = function() { showToast("Error reading file", "error"); btn.disabled = false; btn.innerHTML = originalText; };
    reader.readAsText(file);
});

if (app) {
    document.addEventListener("DOMContentLoaded", () => {
        startEquipmentListener();
        showToast("System Ready. Online mode.", "info");
    });
}
