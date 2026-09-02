const _today = new Date();
let currentYear = _today.getFullYear(), currentMonth = _today.getMonth() + 1, selectedDay = _today.getDate();
let activeFilter = 'all', timelineMode = 'selected';
let selectedMood = '😊 행복', selectedType = 'exp';
let currentTags = [];
let userEntries = JSON.parse(localStorage.getItem('userEntries')) || {};
let userBudgets = JSON.parse(localStorage.getItem('userBudgets')) || {};
let userRecurring = JSON.parse(localStorage.getItem('userRecurring')) || [];
let repeatOn = false;
let editMode = null; // { type: 'ledger'|'diary', year, month, day, idx? }
let holidayCache = JSON.parse(localStorage.getItem('holidayCache')) || {};
let holidayLoading = {};

const KASI_SERVICE_KEY = 'guZ+sfkrHqPkiPRFuTkzcobprODG79MslBF52S+NzW0HzdD1XAZnwIw/Tt+UkRzoUjvc+bx+mcEZQk+3DXhmIA==';

const CAT_ICONS = { '식비': '🍚', '교통': '🚇', '문화/여가': '🎭', '문화': '🎭', '쇼핑': '🛒', '생활비': '🏠', '생활': '🏠', '의료': '➕', '핸드폰요금': '📱', '보험료': '🛡️', '월세': '🏢', '관리비': '🔑', '저축': '🐖', '적금': '🐖', '저축/적금': '🐖', '주식': '📊', '월급': '💰', '성과금/보너스': '🏆', '금융소득': '💹', '수입': '💸', '기타': '📌' };

const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
function getWeekdayName(y, m, d) { return dayNames[new Date(y, m - 1, d).getDay()]; }
function moodEmoji(mood) { return (mood || '').split(' ')[0] || '📖'; }

/* ===== 매월 반복 (recurring) ===== */
function saveRecurringStore() { localStorage.setItem('userRecurring', JSON.stringify(userRecurring)); }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function monthKey(y, m) { return `${y}-${m}`; }
function monthIndex(y, m) { return y * 12 + (m - 1); }
function amountToVal(amount, type) { return `${type === 'inc' ? '+' : '-'}${Number(amount).toLocaleString()}원`; }
function itemAmount(i) { return i.amount != null ? Number(i.amount) : (parseInt(String(i.val).replace(/[^0-9]/g, '')) || 0); }

// 해당 월에 이 반복 규칙이 실제로 찍히는 날짜 (말일 보정 + 이번 달만 날짜 변경 지원)
function occurrenceDay(rule, y, m) {
    const ov = rule.overrides && rule.overrides[monthKey(y, m)];
    const day = (ov && ov.day) ? ov.day : rule.day;
    return Math.min(day, daysInMonth(y, m));
}

function ruleActiveIn(rule, y, m) {
    const idx = monthIndex(y, m);
    if (idx < monthIndex(rule.startY, rule.startM)) return false;
    if (rule.endY && idx > monthIndex(rule.endY, rule.endM)) return false;
    if (rule.skips && rule.skips[monthKey(y, m)]) return false;
    return true;
}

// 반복 규칙 -> 해당 날짜의 가상 내역 목록
function getRecurringItems(y, m, d) {
    const out = [];
    userRecurring.forEach(rule => {
        if (!ruleActiveIn(rule, y, m)) return;
        if (occurrenceDay(rule, y, m) !== d) return;
        const ov = (rule.overrides && rule.overrides[monthKey(y, m)]) || {};
        const type = ov.type || rule.type;
        const cate = ov.cate || rule.cate;
        const amount = ov.amount != null ? ov.amount : rule.amount;
        const name = ov.name != null ? ov.name : rule.name;
        out.push({
            icon: CAT_ICONS[cate] || '📌', name, cate, amount, type,
            val: amountToVal(amount, type),
            recurringId: rule.id,
            edited: ov.amount != null || ov.name != null || ov.type != null
        });
    });
    return out;
}

// 직접 입력 내역 + 반복 내역을 합쳐서 반환
function getLedgerItems(y, m, d) {
    const key = `${y}-${m}-${d}`;
    const manual = (userEntries[key] && userEntries[key].ledger)
        ? userEntries[key].ledger.map((it, idx) => ({ ...it, _idx: idx }))
        : [];
    return manual.concat(getRecurringItems(y, m, d));
}

function getMockData(y, m, d) {
    const key = `${y}-${m}-${d}`;
    const items = getLedgerItems(y, m, d);
    const diary = userEntries[key] && userEntries[key].diary;
    if (!items.length && !diary) return null;
    let base = { items };
    if (diary) base.diary = diary;

    let exp = 0; let inc = 0;
    base.items.forEach(i => {
        const num = itemAmount(i);
        if (i.type === 'exp') exp += num; else inc += num;
    });
    if (exp > 0) base.exp = `-${Math.round(exp / 1000) / 10}만`;
    if (inc > 0) base.inc = `+${Math.round(inc / 1000) / 10}만`;

    return base;
}

function prevMonth() { currentMonth--; if (currentMonth < 1) { currentMonth = 12; currentYear--; } selectedDay = 1; renderAll(); }
function nextMonth() { currentMonth++; if (currentMonth > 12) { currentMonth = 1; currentYear++; } selectedDay = 1; renderAll(); }
function goToToday() { const t = new Date(); currentYear = t.getFullYear(); currentMonth = t.getMonth() + 1; selectedDay = t.getDate(); renderAll(); }

/* ===== 공휴일 (data.go.kr 특일 정보 API) ===== */
async function fetchHolidays(year) {
    const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${year}&ServiceKey=${encodeURIComponent(KASI_SERVICE_KEY)}&_type=json&numOfRows=50`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data?.response?.body?.items?.item;
    const list = items ? (Array.isArray(items) ? items : [items]) : [];
    const map = {};
    list.forEach(i => { if (i.isHoliday === 'Y') map[String(i.locdate)] = i.dateName.replace(/\(.*?\)/g, '').trim(); });
    return map;
}

function ensureHolidaysLoaded(year) {
    if (holidayCache[year] || holidayLoading[year]) return;
    holidayLoading[year] = true;
    fetchHolidays(year).then(map => {
        holidayCache[year] = map;
        localStorage.setItem('holidayCache', JSON.stringify(holidayCache));
        holidayLoading[year] = false;
        renderCalendar();
    }).catch(err => {
        console.error('공휴일 정보를 가져오지 못했습니다.', err);
        holidayLoading[year] = false;
    });
}

function renderCalendar() {
    ensureHolidaysLoaded(currentYear);
    const yearHolidays = holidayCache[currentYear] || {};
    const grid = document.getElementById('calendarGrid'); grid.innerHTML = '';
    const totalDays = new Date(currentYear, currentMonth, 0).getDate();
    const firstDow = new Date(currentYear, currentMonth - 1, 1).getDay();
    const prevTotal = new Date(currentYear, currentMonth - 1, 0).getDate();
    for (let i = firstDow - 1; i >= 0; i--) { const c = document.createElement('div'); c.className = 'cal-cell other-month'; c.innerHTML = `<span class="cal-date">${prevTotal - i}</span>`; grid.appendChild(c); }
    for (let d = 1; d <= totalDays; d++) {
        const cell = document.createElement('div');
        const dow = new Date(currentYear, currentMonth - 1, d).getDay();
        cell.className = `cal-cell ${d === selectedDay ? 'selected' : ''}`;
        cell.setAttribute('onclick', `selectDate(${d})`);
        const data = getMockData(currentYear, currentMonth, d);
        const dateKey = `${currentYear}${String(currentMonth).padStart(2, '0')}${String(d).padStart(2, '0')}`;
        const rawHolidayName = yearHolidays[dateKey];
        const holidayName = rawHolidayName ? rawHolidayName.replace(/\(.*?\)/g, '').trim() : rawHolidayName;
        let infoHtml = '';
        if (holidayName) infoHtml += `<span class="tag-holiday">${holidayName}</span>`;
        if (data) {
            if (data.exp) infoHtml += `<span class="tag-exp">${data.exp}</span>`;
            if (data.inc) infoHtml += `<span class="tag-inc">${data.inc}</span>`;
            if (data.diary) infoHtml += `<span class="tag-diary">${moodEmoji(data.diary.mood)}</span>`;
        }
        let ds = '';
        if (dow === 0 || holidayName) ds = 'color:var(--coral-500);';
        if (dow === 6) ds = 'color:var(--indigo-600);';
        const writeBtn = d === selectedDay
            ? `<button class="cal-write-btn" onclick="event.stopPropagation(); openModal()" title="기록 추가">✏️</button>`
            : '';
        cell.innerHTML = `<span class="cal-date" style="${ds}">${d}</span><div class="cal-info">${infoHtml}</div>${writeBtn}`;
        grid.appendChild(cell);
    }
    const rem = (firstDow + totalDays) % 7;
    for (let d = 1; d <= (rem === 0 ? 0 : 7 - rem); d++) { const c = document.createElement('div'); c.className = 'cal-cell other-month'; c.innerHTML = `<span class="cal-date">${d}</span>`; grid.appendChild(c); }
}

function selectDate(d) { selectedDay = Number(d); timelineMode = 'selected'; document.getElementById('modeSelected').classList.add('active'); document.getElementById('modeAll').classList.remove('active'); renderAll(); }
function switchTimelineMode(m) { timelineMode = m; document.getElementById('modeSelected').classList.toggle('active', m === 'selected'); document.getElementById('modeAll').classList.toggle('active', m === 'all'); renderTimeline(); }
function switchFilter(f) { activeFilter = f;['all', 'ledger', 'diary'].forEach(x => document.getElementById('tab' + x[0].toUpperCase() + x.slice(1)).classList.toggle('active', x === f)); renderTimeline(); }

/* ===== 햄버거 메뉴 (593px 이하) ===== */
function toggleTabMenu() {
    document.getElementById('tabMenuDrawer').classList.toggle('open');
    document.getElementById('tabMenuOverlay').classList.toggle('open');
}
function closeTabMenu() {
    document.getElementById('tabMenuDrawer').classList.remove('open');
    document.getElementById('tabMenuOverlay').classList.remove('open');
}

function renderTimeline() {
    const container = document.getElementById('timelineContainer');
    const titleEl = document.getElementById('detailTitleText');
    const totalDays = new Date(currentYear, currentMonth, 0).getDate();
    if (timelineMode === 'selected') {
        titleEl.innerText = `📍 ${currentMonth}월 ${selectedDay}일 (${getWeekdayName(currentYear, currentMonth, selectedDay)})`;
        container.innerHTML = renderDayHtml(selectedDay);
    } else {
        titleEl.innerText = `📜 ${currentYear}년 ${currentMonth}월 타임라인`;
        let html = '';
        for (let d = 1; d <= totalDays; d++) {
            const data = getMockData(currentYear, currentMonth, d);
            if (data) {
                let badge = '';
                if (data.exp) badge += `<span style="color:var(--coral-500);margin-right:6px;">${data.exp}</span>`;
                if (data.inc) badge += `<span style="color:var(--emerald-500);">${data.inc}</span>`;
                html += `<div class="date-group-card" onclick="selectDate(${d})" style="cursor:pointer;"><div class="date-group-header"><span>📘 ${currentMonth}월 ${d}일 (${getWeekdayName(currentYear, currentMonth, d)})</span><span style="font-size:11px;font-weight:700;">${badge}</span></div>${renderDayHtml(d)}</div>`;
            }
        }
        if (!html) html = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px;">이번 달 기록이 없습니다.</div>`;
        container.innerHTML = html;
    }
}

function renderDayHtml(day) {
    const data = getMockData(currentYear, currentMonth, day);
    if (!data) return `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px;">기록이 없습니다.</div>`;
    let html = '';
    if ((activeFilter === 'all' || activeFilter === 'ledger') && data.items?.length > 0) {
        html += `<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:6px;">가계부 내역</div>`;
        html += data.items.map(i => {
            const badge = i.recurringId ? `<span class="badge-repeat">🔁 매월${i.edited ? '·수정됨' : ''}</span>` : '';
            const actions = i.recurringId
                ? `<button class="icon-btn" onclick="event.stopPropagation(); openRecurringModal('${i.recurringId}', ${day})" title="반복 항목 수정">✏️</button>`
                : `<button class="icon-btn" onclick="event.stopPropagation(); openEditLedger(${day}, ${i._idx})" title="수정">✏️</button><button class="icon-btn" onclick="event.stopPropagation(); deleteLedger(${day}, ${i._idx})" title="삭제">🗑️</button>`;
            return `<div class="entry-item"><div class="entry-left"><span class="entry-icon">${i.icon}</span><div><div class="entry-name">${i.name}${badge}</div><div class="entry-cate">${i.cate}</div></div></div><div style="display:flex;align-items:center;gap:12px;"><span class="entry-val" style="color:${i.type === 'inc' ? 'var(--emerald-500)' : 'var(--coral-500)'};">${i.val}</span>${actions}</div></div>`;
        }).join('');
    }
    if ((activeFilter === 'all' || activeFilter === 'diary') && data.diary) {
        html += `<div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-top:8px;margin-bottom:6px;">일기 내역</div><div class="diary-box"><div class="diary-box-header"><span class="diary-box-title">📝 ${currentMonth}월 ${day}일 일기</span><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:11px;background:#FFF;padding:2px 8px;border-radius:8px;">${data.diary.mood}</span><button onclick="event.stopPropagation(); openEditDiary(${day})" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-muted);" title="수정">✏️</button><button onclick="event.stopPropagation(); deleteDiary(${day})" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-muted);" title="삭제">🗑️</button></div></div><div class="diary-box-content">"${data.diary.content || data.diary.text}"</div></div>`;
    }
    return html || `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px;">기록이 없습니다.</div>`;
}

function deleteLedger(d, idx) {
    if (confirm('이 내역을 삭제하시겠습니까?')) {
        const key = `${currentYear}-${currentMonth}-${d}`;
        if (userEntries[key] && userEntries[key].ledger) {
            userEntries[key].ledger.splice(idx, 1);
            if (userEntries[key].ledger.length === 0) delete userEntries[key].ledger;
            if (Object.keys(userEntries[key]).length === 0) delete userEntries[key];
            localStorage.setItem('userEntries', JSON.stringify(userEntries));
            renderAll();
        }
    }
}

function deleteDiary(d) {
    if (confirm('이 일기를 삭제하시겠습니까?')) {
        const key = `${currentYear}-${currentMonth}-${d}`;
        if (userEntries[key] && userEntries[key].diary) {
            delete userEntries[key].diary;
            if (Object.keys(userEntries[key]).length === 0) delete userEntries[key];
            localStorage.setItem('userEntries', JSON.stringify(userEntries));
            renderAll();
        }
    }
}

/* ===== 수정 모달 열기 ===== */
function openEditLedger(day, idx) {
    const key = `${currentYear}-${currentMonth}-${day}`;
    const entry = userEntries[key] && userEntries[key].ledger && userEntries[key].ledger[idx];
    if (!entry) return;

    editMode = { type: 'ledger', year: currentYear, month: currentMonth, day, idx };

    // 날짜 설정
    const ds = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    document.getElementById('ledgerDate').value = ds;
    document.getElementById('diaryDate').value = ds;
    document.getElementById('modalDateHint').innerText = `${currentMonth}월 ${day}일 가계부 수정`;
    document.querySelector('#writeModal .modal-title').innerText = '✏️ 가계부 수정';

    // 가계부 폼 채우기
    document.getElementById('ledgerAmount').value = entry.amount || '';
    document.getElementById('ledgerTitle').value = entry.name || '';
    document.getElementById('ledgerMemo').value = entry.memo || '';

    // 결제수단 설정
    const paymentEl = document.getElementById('ledgerPayment');
    const payOpts = Array.from(paymentEl.options);
    const payIdx = payOpts.findIndex(o => o.text === (entry.payment || ''));
    paymentEl.selectedIndex = payIdx >= 0 ? payIdx : 0;

    // 수입/지출 및 카테고리 설정
    setType(entry.type || 'exp');
    const cat = entry.cate || '';
    if (cat) {
        document.getElementById('ledgerCategory').value = cat;
        const catList = CATEGORIES[entry.type || 'exp'];
        const catItem = catList.find(c => c.value === cat);
        if (catItem) {
            document.getElementById('categoryTriggerText').textContent = catItem.label;
            document.querySelectorAll('#categoryDropdown .custom-select-option').forEach(o => {
                o.classList.toggle('selected', o.dataset.value === cat);
            });
        }
    }

    // 반복 초기화
    repeatOn = false;
    document.getElementById('repeatDuration').value = '0';
    applyRepeatUI();

    // 일기 폼 초기화
    document.getElementById('diaryTitle').value = '';
    document.getElementById('diaryContent').value = '';
    document.getElementById('tagInput').value = '';
    currentTags = [];
    renderTags();
    selectedMood = '😊 행복';
    document.querySelectorAll('.mood-btn').forEach((b, i) => b.classList.toggle('active', i === 0));

    switchModalTab('ledger');
    document.getElementById('writeModal').classList.add('open');
}

function openEditDiary(day) {
    const key = `${currentYear}-${currentMonth}-${day}`;
    const diary = userEntries[key] && userEntries[key].diary;
    if (!diary) return;

    editMode = { type: 'diary', year: currentYear, month: currentMonth, day };

    // 날짜 설정
    const ds = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    document.getElementById('ledgerDate').value = ds;
    document.getElementById('diaryDate').value = ds;
    document.getElementById('modalDateHint').innerText = `${currentMonth}월 ${day}일 일기 수정`;
    document.querySelector('#writeModal .modal-title').innerText = '✏️ 일기 수정';

    // 가계부 폼 초기화
    document.getElementById('ledgerAmount').value = '';
    document.getElementById('ledgerTitle').value = '';
    document.getElementById('ledgerMemo').value = '';
    document.getElementById('ledgerPayment').selectedIndex = 0;
    setType('exp');
    repeatOn = false;
    document.getElementById('repeatDuration').value = '0';
    applyRepeatUI();

    // 일기 폼 채우기
    document.getElementById('diaryTitle').value = diary.title || '';
    document.getElementById('diaryContent').value = diary.content || diary.text || '';
    document.getElementById('tagInput').value = '';
    currentTags = diary.tags ? [...diary.tags] : [];
    renderTags();

    // 기분 설정
    selectedMood = diary.mood || '😊 행복';
    document.querySelectorAll('.mood-btn').forEach(b => {
        b.classList.toggle('active', b.textContent.trim() === selectedMood);
    });

    switchModalTab('diary');
    document.getElementById('writeModal').classList.add('open');
}


function renderMetrics() {
    let totalExp = 0; let totalInc = 0;
    let catExp = {};
    const totalDays = new Date(currentYear, currentMonth, 0).getDate();
    for (let d = 1; d <= totalDays; d++) {
        getLedgerItems(currentYear, currentMonth, d).forEach(i => {
            const num = itemAmount(i);
            if (i.type === 'exp') {
                totalExp += num;
                const catKey = `${i.icon} ${i.cate}`;
                catExp[catKey] = (catExp[catKey] || 0) + num;
            } else {
                totalInc += num;
            }
        });
    }

    document.getElementById('metricValBalance').innerHTML = `<span style="color:var(--emerald-500);">+${totalInc.toLocaleString()}원</span> / <span style="color:var(--coral-500);">${totalExp > 0 ? '-' : ''}${totalExp.toLocaleString()}원</span>`;

    const ieCircumference = 163.36; // 2 * PI * r(26)
    const ieTotal = totalInc + totalExp;
    const ieGap = 3; // 두 구간 사이 시각적 여백(arc 단위)
    let incLen = 0, expLen = 0, expOffset = 0;
    if (ieTotal > 0) {
        const rawInc = (totalInc / ieTotal) * ieCircumference;
        const rawExp = (totalExp / ieTotal) * ieCircumference;
        const bothPresent = totalInc > 0 && totalExp > 0;
        const g = bothPresent ? ieGap : 0;
        incLen = Math.max(0, rawInc - g);
        expLen = Math.max(0, rawExp - g);
        expOffset = -rawInc;
    }
    const ieIncEl = document.getElementById('ieMeterInc');
    const ieExpEl = document.getElementById('ieMeterExp');
    ieIncEl.style.strokeDasharray = `${incLen} ${ieCircumference}`;
    ieIncEl.style.strokeDashoffset = '0';
    ieExpEl.style.strokeDasharray = `${expLen} ${ieCircumference}`;
    ieExpEl.style.strokeDashoffset = `${expOffset}`;

    const budgetKey = `${currentYear}-${currentMonth}`;
    const budget = userBudgets[budgetKey] || 1000000;

    const budgetText = (budget % 10000 === 0) ? (budget / 10000) + '만' : budget.toLocaleString();

    const pct = Math.round((totalExp / budget) * 100);
    document.getElementById('metricLabelBudget').innerText = `${currentMonth}월 예산(${budgetText}) 사용률`;
    document.getElementById('metricValBudget').innerText = `${pct}% ${pct > 80 ? '(위험)' : '(안전)'}`;
    document.getElementById('metricValBudget').style.color = pct > 80 ? 'var(--coral-500)' : 'var(--indigo-600)';

    const meterCircumference = 163.36; // 2 * PI * r(26)
    const meterRatio = Math.max(0, Math.min(1, budget > 0 ? totalExp / budget : 0));
    document.getElementById('budgetMeterFill').style.strokeDashoffset = `${meterCircumference * (1 - meterRatio)}`;
    document.getElementById('budgetMeterText').textContent = `${pct}%`;
    document.getElementById('budgetMeter').classList.toggle('risk', pct > 80);

    const catContainer = document.getElementById('categorySummaryContainer');
    if (totalExp === 0) {
        catContainer.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px;">지출 내역이 없습니다.</div>`;
    } else {
        let catHtml = '';
        const colors = ['var(--indigo-600)', 'var(--amber-500)', 'var(--coral-500)', 'var(--emerald-500)'];
        let cIdx = 0;
        Object.entries(catExp).sort((a, b) => b[1] - a[1]).forEach(([name, val]) => {
            const perc = Math.round((val / totalExp) * 100);
            catHtml += `<div class="cat-bar-item"><div class="cat-bar-header"><span>${name}</span><span>${val.toLocaleString()}원 (${perc}%)</span></div><div class="cat-progress"><div class="cat-fill" style="width:${perc}%;background:${colors[cIdx % colors.length]};"></div></div></div>`;
            cIdx++;
        });
        catContainer.innerHTML = catHtml;
    }
}

function setBudget() {
    const key = `${currentYear}-${currentMonth}`;
    const currentBudget = userBudgets[key] || 1000000;
    document.getElementById('budgetInputAmount').value = currentBudget;
    document.getElementById('budgetModalHint').innerText = `${currentMonth}월의 목표 예산을 설정합니다`;
    document.getElementById('budgetModal').classList.add('open');
}

function closeBudgetModal() {
    document.getElementById('budgetModal').classList.remove('open');
}

document.getElementById('budgetModal').addEventListener('click', function (e) { if (e.target === this) closeBudgetModal(); });

function saveBudget() {
    const key = `${currentYear}-${currentMonth}`;
    const amount = document.getElementById('budgetInputAmount').value;
    if (!amount) { alert('금액을 입력해주세요.'); return; }
    const num = parseInt(amount);
    if (!isNaN(num) && num > 0) {
        userBudgets[key] = num;
        localStorage.setItem('userBudgets', JSON.stringify(userBudgets));
        closeBudgetModal();
        renderAll();
        alert(`✅ ${currentMonth}월 목표 예산이 설정되었습니다!`);
    } else {
        alert('올바른 금액을 숫자로 입력해주세요.');
    }
}

function renderAll() {
    document.getElementById('currentYearMonthText').innerText = `${currentYear}년 ${currentMonth}월`;
    document.getElementById('metricLabelBalance').innerText = `${currentMonth}월 수입 / 지출`;
    document.getElementById('catMonthLabel').innerText = `${currentMonth}월 기준`;
    renderCalendar(); renderTimeline(); renderMetrics();
}

/* Modal */
function openModal() {
    document.getElementById('writeModal').classList.add('open');
    const ds = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    document.getElementById('ledgerDate').value = ds;
    document.getElementById('diaryDate').value = ds;
    document.getElementById('modalDateHint').innerText = `${currentMonth}월 ${selectedDay}일 (${getWeekdayName(currentYear, currentMonth, selectedDay)}) 기록 추가`;
    document.querySelector('#writeModal .modal-title').innerText = '✏️ 새 기록 작성';

    // ── 가계부 폼 초기화 ──
    document.getElementById('ledgerAmount').value = '';
    document.getElementById('ledgerTitle').value = '';
    document.getElementById('ledgerMemo').value = '';
    document.getElementById('ledgerPayment').selectedIndex = 0;

    // 지출로 초기화 (카테고리 목록 렌더)
    setType('exp');

    // 반복 설정 초기화
    repeatOn = false;
    document.getElementById('repeatDuration').value = '0';
    applyRepeatUI();

    // ── 일기 폼 초기화 ──
    document.getElementById('diaryTitle').value = '';
    document.getElementById('diaryContent').value = '';
    document.getElementById('tagInput').value = '';
    currentTags = [];
    renderTags();

    // 기분 초기값(😊 행복)으로 복원
    selectedMood = '😊 행복';
    document.querySelectorAll('.mood-btn').forEach((b, idx) => {
        b.classList.toggle('active', idx === 0);
    });

    // 가계부 탭으로 초기화
    switchModalTab('ledger');
}

/* ===== 매월 반복 입력 UI ===== */
function toggleRepeat() { repeatOn = !repeatOn; applyRepeatUI(); }

function applyRepeatUI() {
    document.getElementById('repeatToggle').classList.toggle('active', repeatOn);
    document.getElementById('repeatCheckIcon').textContent = repeatOn ? '✅' : '⬜';
    document.getElementById('repeatDetail').classList.toggle('open', repeatOn);
    updateRepeatInfo();
}

function updateRepeatInfo() {
    const info = document.getElementById('repeatInfo');
    if (!repeatOn) { info.innerText = '반복 없음 · 선택한 날짜에만 기록됩니다'; return; }
    const ds = document.getElementById('ledgerDate').value;
    const day = ds ? parseInt(ds.split('-')[2]) : selectedDay;
    const months = parseInt(document.getElementById('repeatDuration').value) || 0;
    const period = months === 0 ? '무기한' : `${months}개월간`;
    const tail = day > 28 ? ' (해당 월에 없으면 말일에 기록)' : '';
    info.innerText = `매월 ${day}일에 같은 내역으로 ${period} 자동 기록${tail}`;
}

document.getElementById('ledgerDate').addEventListener('change', updateRepeatInfo);
function closeModal() { document.getElementById('writeModal').classList.remove('open'); closeCategoryDropdown(); editMode = null; }
document.getElementById('writeModal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

/* 커스텀 카테고리 드롭다운 */
function toggleCategoryDropdown() {
    const trigger = document.getElementById('categoryTrigger');
    const dropdown = document.getElementById('categoryDropdown');
    const isOpen = dropdown.classList.contains('open');
    if (isOpen) {
        closeCategoryDropdown();
    } else {
        trigger.classList.add('open');
        dropdown.classList.add('open');
    }
}
function closeCategoryDropdown() {
    document.getElementById('categoryTrigger').classList.remove('open');
    document.getElementById('categoryDropdown').classList.remove('open');
}
function selectCategory(el) {
    document.querySelectorAll('#categoryDropdown .custom-select-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    const val = el.dataset.value;
    document.getElementById('ledgerCategory').value = val;
    document.getElementById('categoryTriggerText').textContent = el.textContent;
    closeCategoryDropdown();
}
document.addEventListener('click', function (e) {
    const wrapper = document.getElementById('categorySelectWrapper');
    if (wrapper && !wrapper.contains(e.target)) closeCategoryDropdown();
});

function switchModalTab(tab) {
    document.getElementById('mtabLedger').classList.toggle('active', tab === 'ledger');
    document.getElementById('mtabDiary').classList.toggle('active', tab === 'diary');
    document.getElementById('formLedger').classList.toggle('active', tab === 'ledger');
    document.getElementById('formDiary').classList.toggle('active', tab === 'diary');
}
const CATEGORIES = {
    exp: [
        { value: '교통',     label: '🚇 교통' },
        { value: '문화/여가', label: '🎭 문화/여가' },
        { value: '쇼핑',     label: '🛒 쇼핑' },
        { value: '생활비',   label: '🏠 생활비' },
        { value: '의료',     label: '➕ 의료' },
        { value: '핸드폰요금', label: '📱 핸드폰요금' },
        { value: '보험료',   label: '🛡️ 보험료' },
        { value: '월세',     label: '🏢 월세' },
        { value: '관리비',   label: '🔑 관리비' },
        { value: '저축/적금', label: '🐖 저축/적금' },
        { value: '주식',     label: '📊 주식' },
        { value: '기타',     label: '📌 기타' },
    ],
    inc: [
        { value: '월급',  label: '💰 월급' },
        { value: '성과금/보너스',  label: '🏆 성과금/보너스' },
        { value: '금융소득',  label: '💹 금융소득' },
        { value: '수입',  label: '💸 수입' },
        { value: '기타',  label: '📌 기타' },
    ]
};
function updateCategoryOptions(type) {
    const dropdown = document.getElementById('categoryDropdown');
    const list = CATEGORIES[type] || CATEGORIES.exp;
    dropdown.innerHTML = list.map((c, i) =>
        `<div class="custom-select-option${i === 0 ? ' selected' : ''}" data-value="${c.value}" onclick="selectCategory(this)">${c.label}</div>`
    ).join('');
    const first = list[0];
    document.getElementById('ledgerCategory').value = first.value;
    document.getElementById('categoryTriggerText').textContent = first.label;
}
function setType(type) {
    selectedType = type;
    document.getElementById('typeExp').classList.toggle('active', type === 'exp');
    document.getElementById('typeInc').classList.toggle('active', type === 'inc');
    updateCategoryOptions(type);
}
function setMood(btn, mood) { selectedMood = mood; document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
function addTag(e) {
    if (e.key === 'Enter') { e.preventDefault(); const input = document.getElementById('tagInput'); let val = input.value.trim(); if (!val) return; if (!val.startsWith('#')) val = '#' + val; currentTags.push(val); renderTags(); input.value = ''; }
}
function renderTags() { document.getElementById('tagList').innerHTML = currentTags.map((t, i) => `<span class="tag-chip">${t} <button onclick="removeTag(${i})">×</button></span>`).join(''); }
function removeTag(i) { currentTags.splice(i, 1); renderTags(); }

function saveEntry() {
    const isLedger = document.getElementById('formLedger').classList.contains('active');
    const dateStr = document.getElementById(isLedger ? 'ledgerDate' : 'diaryDate').value;
    if (!dateStr) { alert('날짜를 선택해주세요.'); return; }
    const parts = dateStr.split('-'); const y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
    const key = `${y}-${m}-${d}`;
    if (!userEntries[key]) userEntries[key] = {};
    if (isLedger) {
        const amount = document.getElementById('ledgerAmount').value;
        const title = document.getElementById('ledgerTitle').value;
        if (!amount || !title) { alert('금액과 내용을 입력해주세요.'); return; }
        const cat = document.getElementById('ledgerCategory').value;
        const isInc = selectedType === 'inc';
        const type = isInc ? 'inc' : 'exp';
        const num = parseInt(amount);
        if (repeatOn) {
            // 매월 반복: 규칙으로 저장 (각 달의 금액은 나중에 개별 수정 가능)
            const months = parseInt(document.getElementById('repeatDuration').value) || 0;
            let endY = null, endM = null;
            if (months > 0) {
                const endIdx = monthIndex(y, m) + months - 1;
                endY = Math.floor(endIdx / 12); endM = (endIdx % 12) + 1;
            }
            userRecurring.push({
                id: 'r' + Date.now() + Math.floor(Math.random() * 1000),
                day: d, startY: y, startM: m, endY, endM,
                type, cate: cat, name: title, amount: num,
                payment: document.getElementById('ledgerPayment').value,
                memo: document.getElementById('ledgerMemo').value,
                overrides: {}, skips: {}
            });
            saveRecurringStore();
            if (Object.keys(userEntries[key]).length === 0) delete userEntries[key];
            alert(`✅ 매월 ${d}일 반복 기록이 등록되었습니다!\n(각 달의 금액은 항목의 ✏️ 버튼으로 수정할 수 있어요)`);
        } else {
            const newItem = { icon: CAT_ICONS[cat] || '📌', name: title, cate: cat, val: amountToVal(num, type), amount: num, type,
                payment: document.getElementById('ledgerPayment').value,
                memo: document.getElementById('ledgerMemo').value };
            if (editMode && editMode.type === 'ledger') {
                // 수정 모드: 원본 항목 제거 후 새 항목 추가
                const origKey = `${editMode.year}-${editMode.month}-${editMode.day}`;
                if (userEntries[origKey] && userEntries[origKey].ledger) {
                    userEntries[origKey].ledger.splice(editMode.idx, 1);
                    if (userEntries[origKey].ledger.length === 0) delete userEntries[origKey].ledger;
                    if (Object.keys(userEntries[origKey]).length === 0) delete userEntries[origKey];
                }
                if (!userEntries[key]) userEntries[key] = {};
                if (!userEntries[key].ledger) userEntries[key].ledger = [];
                userEntries[key].ledger.push(newItem);
                alert(`✅ ${m}월 ${d}일 가계부가 수정되었습니다!`);
            } else {
                if (!userEntries[key].ledger) userEntries[key].ledger = [];
                userEntries[key].ledger.push(newItem);
                alert(`✅ ${m}월 ${d}일 가계부가 저장되었습니다!`);
            }
        }
    } else {
        const content = document.getElementById('diaryContent').value;
        if (!content) { alert('일기 내용을 입력해주세요.'); return; }
        const diaryTitleVal = document.getElementById('diaryTitle').value;
        const newDiary = { mood: selectedMood, title: diaryTitleVal, content, text: content, tags: [...currentTags] };
        if (editMode && editMode.type === 'diary') {
            // 수정 모드: 원본 일기 제거 후 새 일기 저장
            const origKey = `${editMode.year}-${editMode.month}-${editMode.day}`;
            if (userEntries[origKey] && userEntries[origKey].diary) {
                delete userEntries[origKey].diary;
                if (Object.keys(userEntries[origKey]).length === 0) delete userEntries[origKey];
            }
            if (!userEntries[key]) userEntries[key] = {};
            userEntries[key].diary = newDiary;
            currentTags = []; renderTags();
            alert(`✅ ${m}월 ${d}일 일기가 수정되었습니다!`);
        } else {
            userEntries[key].diary = newDiary;
            currentTags = []; renderTags();
            alert(`✅ ${m}월 ${d}일 일기가 저장되었습니다!`);
        }
    }
    localStorage.setItem('userEntries', JSON.stringify(userEntries));
    closeModal(); currentYear = y; currentMonth = m; selectedDay = d; timelineMode = 'selected';
    document.getElementById('modeSelected').classList.add('active'); document.getElementById('modeAll').classList.remove('active');
    renderAll();
}

/* ===== 반복 항목 수정 / 삭제 ===== */
let recEdit = { id: null, y: null, m: null, day: null, scope: 'one', type: 'exp' };

function findRule(id) { return userRecurring.find(r => r.id === id); }

function openRecurringModal(id, day) {
    const rule = findRule(id);
    if (!rule) return;
    const y = currentYear, m = currentMonth;
    const ov = (rule.overrides && rule.overrides[monthKey(y, m)]) || {};
    recEdit = { id, y, m, day, scope: 'one', type: ov.type || rule.type };

    document.getElementById('recurringHint').innerText =
        `${y}년 ${m}월 ${day}일 · 매월 ${rule.day}일 반복 항목`;
    document.getElementById('recurringAmount').value = ov.amount != null ? ov.amount : rule.amount;
    document.getElementById('recurringTitle').value = ov.name != null ? ov.name : rule.name;

    const daySel = document.getElementById('recurringDay');
    daySel.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}일</option>`).join('');
    daySel.value = (ov.day || rule.day);

    setRecType(recEdit.type);
    setRecScope('one');
    document.getElementById('recurringModal').classList.add('open');
}

function closeRecurringModal() { document.getElementById('recurringModal').classList.remove('open'); }
document.getElementById('recurringModal').addEventListener('click', function (e) { if (e.target === this) closeRecurringModal(); });

function setRecType(type) {
    recEdit.type = type;
    document.getElementById('recTypeExp').classList.toggle('active', type === 'exp');
    document.getElementById('recTypeInc').classList.toggle('active', type === 'inc');
}

function setRecScope(scope) {
    recEdit.scope = scope;
    document.getElementById('scopeOne').classList.toggle('active', scope === 'one');
    document.getElementById('scopeAll').classList.toggle('active', scope === 'all');
    document.getElementById('recScopeHint').innerText = scope === 'one'
        ? `${recEdit.m}월 기록만 변경/삭제됩니다.`
        : `${recEdit.m}월부터 이후 모든 달에 적용됩니다.`;
}

// 지정한 달 이후의 개별 수정값 제거 (전체 적용 시)
function clearOverridesFrom(rule, y, m) {
    const from = monthIndex(y, m);
    Object.keys(rule.overrides || {}).forEach(k => {
        const [ky, km] = k.split('-').map(Number);
        if (monthIndex(ky, km) >= from) delete rule.overrides[k];
    });
}

function saveRecurringEdit() {
    const rule = findRule(recEdit.id);
    if (!rule) { closeRecurringModal(); return; }
    const amount = parseInt(document.getElementById('recurringAmount').value);
    const name = document.getElementById('recurringTitle').value.trim();
    const day = parseInt(document.getElementById('recurringDay').value);
    if (!amount || amount <= 0) { alert('올바른 금액을 입력해주세요.'); return; }
    if (!name) { alert('내용을 입력해주세요.'); return; }

    const mk = monthKey(recEdit.y, recEdit.m);
    if (recEdit.scope === 'one') {
        if (!rule.overrides) rule.overrides = {};
        rule.overrides[mk] = { amount, name, type: recEdit.type, day };
        alert(`✅ ${recEdit.m}월 반복 기록이 수정되었습니다!`);
    } else {
        rule.amount = amount; rule.name = name; rule.type = recEdit.type; rule.day = day;
        clearOverridesFrom(rule, recEdit.y, recEdit.m);
        alert(`✅ ${recEdit.m}월부터 반복 기록이 수정되었습니다!`);
    }
    saveRecurringStore();
    closeRecurringModal();
    renderAll();
}

function deleteRecurring() {
    const rule = findRule(recEdit.id);
    if (!rule) { closeRecurringModal(); return; }
    const mk = monthKey(recEdit.y, recEdit.m);
    if (recEdit.scope === 'one') {
        if (!confirm(`${recEdit.m}월 반복 기록만 삭제할까요?\n(다음 달부터는 계속 반복됩니다)`)) return;
        if (!rule.skips) rule.skips = {};
        rule.skips[mk] = true;
    } else {
        if (!confirm(`${recEdit.m}월부터 이후 반복을 모두 중지할까요?`)) return;
        if (monthIndex(recEdit.y, recEdit.m) <= monthIndex(rule.startY, rule.startM)) {
            userRecurring = userRecurring.filter(r => r.id !== rule.id);
        } else {
            const prev = monthIndex(recEdit.y, recEdit.m) - 1;
            rule.endY = Math.floor(prev / 12); rule.endM = (prev % 12) + 1;
        }
    }
    saveRecurringStore();
    closeRecurringModal();
    renderAll();
}

function clearAll() {
    if (confirm('정말 모든 기록을 초기화하시겠습니까?\n(매월 반복 설정도 함께 삭제됩니다)')) {
        userEntries = {};
        userRecurring = [];
        localStorage.removeItem('userRecurring');
        localStorage.removeItem('userEntries');
        renderAll();
        alert('모든 기록이 초기화되었습니다.');
    }
}

/* ===== 백업 / 복원 ===== */
function backupData() {
    const payload = {
        app: 'cashNote-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        userEntries, userBudgets, userRecurring
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const pad = n => String(n).padStart(2, '0');
    const t = new Date();
    const a = document.createElement('a');
    a.href = url;
    a.download = `가계부일기_백업_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function restoreData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        e.target.value = '';
        let data;
        try {
            data = JSON.parse(ev.target.result);
        } catch (err) {
            alert('올바른 백업 파일이 아닙니다.');
            return;
        }
        if (!data || typeof data !== 'object' || data.app !== 'cashNote-backup') {
            alert('올바른 백업 파일이 아닙니다.');
            return;
        }
        if (!confirm('백업 파일을 불러오면 이 기기의 현재 기록이 백업 파일 내용으로 모두 대체됩니다. 계속할까요?')) return;
        userEntries = data.userEntries || {};
        userBudgets = data.userBudgets || {};
        userRecurring = data.userRecurring || [];
        localStorage.setItem('userEntries', JSON.stringify(userEntries));
        localStorage.setItem('userBudgets', JSON.stringify(userBudgets));
        localStorage.setItem('userRecurring', JSON.stringify(userRecurring));
        renderAll();
        alert('✅ 백업 파일을 불러왔습니다!');
    };
    reader.readAsText(file);
}

/* ===== 후원(Google Play Billing) ===== */
const DONATE_PRODUCT_ID = 'support_coffee'; // Play Console 관리형 제품(소모성) ID와 반드시 일치해야 함

async function donateSupport() {
    if (!('getDigitalGoodsService' in window)) {
        alert('후원 결제는 안드로이드 앱(플레이스토어 설치 버전)에서만 이용할 수 있어요.\n항상 응원해주셔서 감사합니다 🙏');
        return;
    }
    try {
        const service = await window.getDigitalGoodsService('https://play.google.com/billing');
        const details = await service.getDetails([DONATE_PRODUCT_ID]);
        if (!details.length) {
            alert('후원 상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
            return;
        }
        const request = new PaymentRequest(
            [{ supportedMethods: 'https://play.google.com/billing', data: { sku: DONATE_PRODUCT_ID } }]
        );
        const response = await request.show();
        await response.complete('success');
        await service.consume(response.details.purchaseToken);
        alert('☕ 후원해주셔서 진심으로 감사합니다!');
    } catch (err) {
        if (err && err.name === 'AbortError') return; // 사용자가 결제창을 취소함
        console.error(err);
        alert('결제 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
}

renderAll();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}
