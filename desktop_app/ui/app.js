const state = {
    files: [],
    transactions: [],
    selectedFile: null,
    editorDirty: false,
    rulesDirty: false,
    currentView: 'dashboard',
    hiddenCategories: {
        expenses: new Set(),
        income: new Set(),
    },
    sortColumn: 'Buchungstag',
    sortDirection: -1,
    uploadSessionId: null,
    uploadSourceName: '',
    uploadStep: null,
    dashboardNeedsRender: false,
    storageInfo: null,
    customSelects: {},
    datePickers: {},
};

const chartIds = {
    expenses: 'expensesChart',
    income: 'incomeChart',
};

const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const monthLabels = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function backendCall(method, ...args) {
    return new Promise((resolve, reject) => {
        if (!window.backend || typeof window.backend[method] !== 'function') {
            reject(new Error(`Backend-Methode ${method} ist nicht verfügbar.`));
            return;
        }

        window.backend[method](...args, (response) => {
            try {
                resolve(JSON.parse(response));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function formatCurrency(value) {
    return `${Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function parseAmount(value) {
    if (typeof value === 'number') {
        return value;
    }

    const cleaned = String(value || '').replace(/€/g, '').replace(/\s/g, '');
    if (!cleaned) {
        return 0;
    }

    if (cleaned.includes(',') && cleaned.includes('.')) {
        return Number(cleaned.replace(/\./g, '').replace(',', '.'));
    }

    return Number(cleaned.replace(',', '.'));
}

function parseDate(value) {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed;
    }

    const match = String(value).match(/^(\d{2})\.(\d{2})\.(\d{2,4})$/);
    if (!match) {
        return null;
    }

    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return new Date(`${year}-${match[2]}-${match[1]}T00:00:00`);
}

function parseAmountFilter(value) {
    const cleaned = String(value || '').trim().replace(',', '.');
    if (!cleaned) {
        return null;
    }

    if (cleaned.startsWith('>') || cleaned.startsWith('<')) {
        const parsed = Number(cleaned.slice(1).trim());
        return Number.isFinite(parsed) ? { operator: cleaned[0], value: parsed } : null;
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? { operator: '=', value: parsed } : null;
}

function normalizeTransactions(files) {
    const transactions = [];
    files.forEach((file) => {
        (file.data || []).forEach((entry) => {
            const bookingDate = parseDate(entry.Buchungstag);
            const amount = parseAmount(entry.Betrag);
            if (!bookingDate || Number.isNaN(amount)) {
                return;
            }

            transactions.push({
                Buchungstag: bookingDate,
                Betrag: amount,
                Kategorie: entry.Kategorie || 'Unkategorisiert',
                'Debitor/Kreditor': entry['Debitor/Kreditor'] || entry['Beguenstigter/Zahlungspflichtiger'] || '',
                Text: entry.Text || '',
            });
        });
    });
    return transactions;
}

function generateColors(count) {
    const colors = [];
    for (let index = 0; index < count; index += 1) {
        const hue = Math.round((index * 137.5) % 360);
        colors.push(`hsl(${hue}, 70%, 52%)`);
    }
    return colors;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createCustomSelect(id) {
    const root = document.getElementById(id);
    if (!root || state.customSelects[id]) {
        return state.customSelects[id];
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const value = document.createElement('span');
    value.className = 'custom-select-value is-placeholder';
    trigger.appendChild(value);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');

    root.innerHTML = '';
    root.appendChild(trigger);
    root.appendChild(menu);

    const instance = {
        root,
        trigger,
        value,
        menu,
        placeholder: root.dataset.placeholder || 'Auswählen',
        options: [],
        selectedValue: '',
    };

    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        if (root.classList.contains('is-disabled')) {
            return;
        }
        const shouldOpen = menu.hidden;
        closeAllPopovers();
        if (shouldOpen) {
            root.classList.add('is-open');
            menu.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        }
    });

    state.customSelects[id] = instance;
    updateCustomSelectDisplay(id);
    return instance;
}

function closeAllCustomSelects() {
    Object.values(state.customSelects).forEach((instance) => {
        instance.root.classList.remove('is-open');
        instance.menu.hidden = true;
        instance.trigger.setAttribute('aria-expanded', 'false');
    });
}

function closeAllDatePickers() {
    Object.values(state.datePickers).forEach((instance) => {
        instance.root.classList.remove('is-open');
        instance.popover.hidden = true;
    });
}

function closeAllPopovers() {
    closeAllCustomSelects();
    closeAllDatePickers();
}

function updateCustomSelectDisplay(id) {
    const instance = state.customSelects[id];
    if (!instance) {
        return;
    }

    const selectedOption = instance.options.find((option) => option.value === instance.selectedValue);
    const label = selectedOption ? selectedOption.label : instance.placeholder;
    instance.value.textContent = label;
    instance.value.classList.toggle('is-placeholder', !selectedOption || !instance.selectedValue);
    instance.root.dataset.value = instance.selectedValue;
}

function renderCustomSelectOptions(id) {
    const instance = state.customSelects[id];
    if (!instance) {
        return;
    }

    instance.menu.innerHTML = '';
    instance.root.classList.toggle('is-disabled', instance.options.length === 0);
    instance.trigger.disabled = instance.options.length === 0;

    instance.options.forEach((optionData) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `custom-select-option ${optionData.value === instance.selectedValue ? 'is-selected' : ''}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', optionData.value === instance.selectedValue ? 'true' : 'false');
        option.textContent = optionData.label;
        option.addEventListener('click', (event) => {
            event.stopPropagation();
            setCustomSelectValue(id, optionData.value, true);
            closeAllCustomSelects();
            instance.trigger.focus();
        });
        instance.menu.appendChild(option);
    });
}

function setCustomSelectOptions(id, options, preferredValue = null) {
    const instance = createCustomSelect(id);
    instance.options = options.map((option) => ({
        value: String(option.value ?? ''),
        label: String(option.label ?? option.value ?? ''),
    }));

    const fallbackValue = instance.options.some((option) => option.value === instance.selectedValue)
        ? instance.selectedValue
        : (instance.options[0]?.value || '');
    const nextValue = preferredValue !== null && preferredValue !== undefined
        ? String(preferredValue)
        : fallbackValue;

    instance.selectedValue = instance.options.some((option) => option.value === nextValue) ? nextValue : (instance.options[0]?.value || '');
    renderCustomSelectOptions(id);
    updateCustomSelectDisplay(id);
}

function getCustomSelectValue(id) {
    return state.customSelects[id]?.selectedValue || '';
}

function setCustomSelectValue(id, value, emitChange = false) {
    const instance = createCustomSelect(id);
    const nextValue = String(value ?? '');
    instance.selectedValue = instance.options.some((option) => option.value === nextValue) ? nextValue : '';
    renderCustomSelectOptions(id);
    updateCustomSelectDisplay(id);
    if (emitChange) {
        instance.root.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

function initializeCustomSelects() {
    ['categoryFilter', 'uploadCategorySelect', 'uploadRulesetSelect'].forEach((id) => {
        createCustomSelect(id);
    });

    document.addEventListener('click', () => {
        closeAllPopovers();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAllPopovers();
        }
    });
}

function parseDateFieldValue(value, endOfDay = false) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return null;
    }

    let date = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        date = new Date(`${trimmed}T00:00:00`);
    } else {
        const match = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!match) {
            return null;
        }
        date = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`);
    }

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    }
    return date;
}

function formatDateFieldValue(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${day}.${month}.${year}`;
}

function formatDatePickerDataValue(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${year}-${month}-${day}`;
}

function monthStartOf(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function createDatePicker(id) {
    const input = document.getElementById(id);
    const button = document.getElementById(`${id}Button`);
    const popover = document.getElementById(`${id}Calendar`);
    const root = input?.closest('.date-field');
    if (!input || !button || !popover || !root || state.datePickers[id]) {
        return state.datePickers[id];
    }

    const selectedDate = parseDateFieldValue(input.value) || new Date();
    const instance = {
        root,
        input,
        button,
        popover,
        visibleMonth: monthStartOf(selectedDate),
    };

    button.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = popover.hidden;
        closeAllPopovers();
        if (!shouldOpen) {
            return;
        }
        instance.visibleMonth = monthStartOf(parseDateFieldValue(input.value) || new Date());
        root.classList.add('is-open');
        renderDatePicker(id);
        popover.hidden = false;
    });

    input.addEventListener('blur', () => {
        const parsed = parseDateFieldValue(input.value);
        if (parsed) {
            input.value = formatDateFieldValue(parsed);
        }
    });

    state.datePickers[id] = instance;
    return instance;
}

function shiftDatePickerMonth(id, delta) {
    const instance = state.datePickers[id];
    if (!instance) {
        return;
    }
    instance.visibleMonth = new Date(instance.visibleMonth.getFullYear(), instance.visibleMonth.getMonth() + delta, 1);
    renderDatePicker(id);
}

function selectDatePickerDate(id, dataValue) {
    const instance = state.datePickers[id];
    if (!instance) {
        return;
    }

    const date = parseDateFieldValue(dataValue);
    if (!date) {
        return;
    }

    instance.input.value = formatDateFieldValue(date);
    instance.input.dispatchEvent(new Event('input', { bubbles: true }));
    instance.input.dispatchEvent(new Event('change', { bubbles: true }));
    closeAllDatePickers();
}

function clearDatePickerDate(id) {
    const instance = state.datePickers[id];
    if (!instance) {
        return;
    }

    instance.input.value = '';
    instance.input.dispatchEvent(new Event('input', { bubbles: true }));
    instance.input.dispatchEvent(new Event('change', { bubbles: true }));
    closeAllDatePickers();
}

function buildDatePickerDays(id) {
    const instance = state.datePickers[id];
    const selected = parseDateFieldValue(instance.input.value);
    const monthStart = instance.visibleMonth;
    const gridStart = new Date(monthStart);
    const weekday = (monthStart.getDay() + 6) % 7;
    gridStart.setDate(monthStart.getDate() - weekday);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buttons = [];

    for (let index = 0; index < 42; index += 1) {
        const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
        const isOutside = date.getMonth() !== monthStart.getMonth();
        const isToday = date.getTime() === today.getTime();
        const isSelected = selected
            && date.getFullYear() === selected.getFullYear()
            && date.getMonth() === selected.getMonth()
            && date.getDate() === selected.getDate();

        buttons.push(`
            <button
                type="button"
                class="date-picker-day ${isOutside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}"
                data-date="${formatDatePickerDataValue(date)}"
            >${date.getDate()}</button>
        `);
    }

    return buttons.join('');
}

function renderDatePicker(id) {
    const instance = state.datePickers[id];
    if (!instance) {
        return;
    }

    instance.popover.innerHTML = `
        <div class="date-picker-header">
            <button type="button" class="date-picker-nav" data-picker-nav="prev">◀</button>
            <div class="date-picker-title">${monthLabels[instance.visibleMonth.getMonth()]} ${instance.visibleMonth.getFullYear()}</div>
            <button type="button" class="date-picker-nav" data-picker-nav="next">▶</button>
        </div>
        <div class="date-picker-weekdays">${weekdayLabels.map((label) => `<span>${label}</span>`).join('')}</div>
        <div class="date-picker-grid">${buildDatePickerDays(id)}</div>
        <div class="date-picker-footer">
            <button type="button" data-picker-action="clear">Leeren</button>
            <button type="button" data-picker-action="today">Heute</button>
        </div>
    `;

    instance.popover.querySelectorAll('[data-picker-nav]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            shiftDatePickerMonth(id, button.dataset.pickerNav === 'prev' ? -1 : 1);
        });
    });

    instance.popover.querySelectorAll('.date-picker-day').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            selectDatePickerDate(id, button.dataset.date);
        });
    });

    instance.popover.querySelector('[data-picker-action="clear"]').addEventListener('click', (event) => {
        event.stopPropagation();
        clearDatePickerDate(id);
    });

    instance.popover.querySelector('[data-picker-action="today"]').addEventListener('click', (event) => {
        event.stopPropagation();
        selectDatePickerDate(id, formatDatePickerDataValue(new Date()));
    });
}

function initializeDatePickers() {
    ['dateStartFilter', 'dateEndFilter'].forEach((id) => {
        createDatePicker(id);
    });
}

function setStatus(elementId, text, kind = 'info') {
    const element = document.getElementById(elementId);
    if (!element) {
        return;
    }
    element.textContent = text || '';
    element.className = `status-strip ${kind}`;
}

function formatPathLabel(path) {
    return String(path || '');
}

async function loadStorageInfo() {
    const response = await backendCall('getStorageInfo');
    if (!response.success) {
        return;
    }

    state.storageInfo = response;
    const modeLabel = response.mode === 'portable' ? 'Portable-Modus' : 'Installierter Modus';
    const filesHint = `Uploads: ${formatPathLabel(response.uploadsDir)} | Datenordner: ${formatPathLabel(response.dataRoot)} | ${modeLabel}`;
    const rulesHint = `learned_rules.json: ${formatPathLabel(response.rulesFile)} | ${modeLabel}`;

    document.getElementById('filesLocationHint').textContent = filesHint;
    document.getElementById('rulesLocationHint').textContent = rulesHint;
}

async function openStorageFolder(method, statusElementId, successMessage) {
    const response = await backendCall(method);
    if (!response.success) {
        setStatus(statusElementId, response.error || 'Ordner konnte nicht geöffnet werden.', 'error');
        return;
    }
    setStatus(statusElementId, `${successMessage}: ${response.path}`, 'info');
}

function setActiveView(viewName) {
    state.currentView = viewName;
    document.getElementById('dashboardView').classList.toggle('active', viewName === 'dashboard');
    document.getElementById('categorizerView').classList.toggle('active', viewName === 'categorizer');
    document.getElementById('rulesView').classList.toggle('active', viewName === 'rules');
    document.getElementById('filesView').classList.toggle('active', viewName === 'files');
    document.getElementById('dashboardTabButton').classList.toggle('active', viewName === 'dashboard');
    document.getElementById('categorizerTabButton').classList.toggle('active', viewName === 'categorizer');
    document.getElementById('rulesTabButton').classList.toggle('active', viewName === 'rules');
    document.getElementById('filesTabButton').classList.toggle('active', viewName === 'files');

    if (viewName === 'dashboard') {
        scheduleDashboardRefresh(state.dashboardNeedsRender);
    }
}

function isDashboardVisible() {
    const dashboardView = document.getElementById('dashboardView');
    return state.currentView === 'dashboard' && dashboardView && dashboardView.classList.contains('active');
}

function resizeDashboardCharts() {
    Object.values(chartIds).forEach((chartId) => {
        const chartElement = document.getElementById(chartId);
        if (!chartElement || !chartElement.children.length) {
            return;
        }
        Plotly.Plots.resize(chartElement);
    });
}

function scheduleDashboardRefresh(shouldRender = true) {
    if (!isDashboardVisible()) {
        state.dashboardNeedsRender = true;
        return;
    }

    window.requestAnimationFrame(() => {
        if (shouldRender || state.dashboardNeedsRender) {
            state.dashboardNeedsRender = false;
            refreshDashboard();
            return;
        }

        resizeDashboardCharts();
    });
}

function updateMetrics() {
    return undefined;
}

function populateCategoryFilter() {
    const selectedValue = getCustomSelectValue('categoryFilter');
    const categories = [...new Set(state.transactions.map((item) => item.Kategorie))].sort((left, right) => left.localeCompare(right, 'de'));
    const options = [{ value: '', label: 'Alle Kategorien' }, ...categories.map((category) => ({ value: category, label: category }))];
    setCustomSelectOptions('categoryFilter', options, categories.includes(selectedValue) ? selectedValue : '');
}

function getDateFilterValue(id, endOfDay = false) {
    return parseDateFieldValue(document.getElementById(id).value, endOfDay);
}

function getUserFilteredTransactions() {
    const textFilter = document.getElementById('filterInput').value.trim().toLowerCase();
    const amountFilter = parseAmountFilter(document.getElementById('amountFilter').value);
    const selectedCategory = getCustomSelectValue('categoryFilter');
    const dateStart = getDateFilterValue('dateStartFilter');
    const dateEnd = getDateFilterValue('dateEndFilter', true);

    return state.transactions.filter((transaction) => {
        if (textFilter && !transaction.Text.toLowerCase().includes(textFilter)) {
            return false;
        }
        if (selectedCategory && transaction.Kategorie !== selectedCategory) {
            return false;
        }
        if (amountFilter) {
            if (amountFilter.operator === '>' && !(transaction.Betrag > amountFilter.value)) {
                return false;
            }
            if (amountFilter.operator === '<' && !(transaction.Betrag < amountFilter.value)) {
                return false;
            }
            if (amountFilter.operator === '=' && transaction.Betrag !== amountFilter.value) {
                return false;
            }
        }
        if (dateStart && transaction.Buchungstag < dateStart) {
            return false;
        }
        if (dateEnd && transaction.Buchungstag > dateEnd) {
            return false;
        }
        return true;
    });
}

function getFilteredTransactions() {
    return getUserFilteredTransactions().filter((transaction) => {
        const bucket = transaction.Betrag < 0 ? 'expenses' : 'income';
        return !state.hiddenCategories[bucket].has(transaction.Kategorie);
    });
}

function getMonthDivisor() {
    const uniqueMonths = [...new Set(state.transactions.map((item) => `${item.Buchungstag.getFullYear()}-${item.Buchungstag.getMonth()}`))]
        .map((entry) => entry.split('-').map(Number))
        .sort((left, right) => (left[0] - right[0]) || (left[1] - right[1]));

    if (!uniqueMonths.length) {
        return 1;
    }

    const start = getDateFilterValue('dateStartFilter');
    const end = getDateFilterValue('dateEndFilter');
    if (!start && !end) {
        return uniqueMonths.length;
    }

    const left = start ? new Date(start.getFullYear(), start.getMonth(), 1) : new Date(uniqueMonths[0][0], uniqueMonths[0][1], 1);
    const right = end ? new Date(end.getFullYear(), end.getMonth(), 1) : new Date(uniqueMonths[uniqueMonths.length - 1][0], uniqueMonths[uniqueMonths.length - 1][1], 1);
    const from = left <= right ? left : right;
    const to = left <= right ? right : left;
    return ((to.getFullYear() - from.getFullYear()) * 12) + (to.getMonth() - from.getMonth()) + 1;
}

function aggregateTransactions(transactions, bucket) {
    const totals = {};
    transactions.forEach((transaction) => {
        const matches = bucket === 'expenses' ? transaction.Betrag < 0 : transaction.Betrag >= 0;
        if (!matches) {
            return;
        }

        const amount = bucket === 'expenses' ? Math.abs(transaction.Betrag) : transaction.Betrag;
        totals[transaction.Kategorie] = (totals[transaction.Kategorie] || 0) + amount;
    });

    return Object.fromEntries(Object.entries(totals).sort((left, right) => left[0].localeCompare(right[0], 'de')));
}

function renderLegend(containerId, values, bucket) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const entries = Object.entries(values);
    if (!entries.length) {
        container.innerHTML = '<div class="legend-item"><div class="legend-label"><strong>Keine Kategorien</strong><span>Keine Daten im aktuellen Filter</span></div></div>';
        return;
    }

    const colors = generateColors(entries.length);
    entries.forEach(([category, value], index) => {
        const row = document.createElement('label');
        row.className = 'legend-item';
        row.innerHTML = `
            <span class="legend-color" style="background:${colors[index]}"></span>
            <input type="checkbox" ${state.hiddenCategories[bucket].has(category) ? '' : 'checked'}>
            <span class="legend-label">
                <strong>${escapeHtml(category)}</strong>
                <span>${escapeHtml(formatCurrency(value))}</span>
            </span>
        `;
        row.querySelector('input').addEventListener('change', (event) => {
            if (event.target.checked) {
                state.hiddenCategories[bucket].delete(category);
            } else {
                state.hiddenCategories[bucket].add(category);
            }
            refreshDashboard();
        });
        container.appendChild(row);
    });
}

function renderChart(values, bucket, title) {
    const chartElement = document.getElementById(chartIds[bucket]);
    const labels = Object.keys(values).filter((category) => !state.hiddenCategories[bucket].has(category));
    const visibleValues = labels.map((label) => values[label]);
    const colors = generateColors(labels.length);

    Plotly.purge(chartElement);

    if (!labels.length) {
        Plotly.react(chartElement, [], {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            xaxis: { visible: false },
            yaxis: { visible: false },
            annotations: [{ text: 'Keine Daten', showarrow: false, font: { color: '#64748b', size: 18 } }],
            margin: { t: 10, r: 10, b: 10, l: 10 },
        }, { displayModeBar: false, responsive: true });
        return;
    }

    Plotly.react(chartElement, [{
        type: 'pie',
        labels,
        values: visibleValues,
        hole: 0.58,
        sort: false,
        textinfo: 'none',
        marker: {
            colors,
            line: { color: '#ffffff', width: 2 },
        },
        hovertemplate: '<b>%{label}</b><br>%{value:,.2f} €<br>%{percent}<extra></extra>',
    }], {
        margin: { t: 8, r: 8, b: 8, l: 8 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        showlegend: false,
        annotations: [{
            text: `<span style="font-size:12px;color:#64748b;">${title}</span><br><span style="font-size:16px;font-weight:700;color:#10233a;">${formatCurrency(visibleValues.reduce((sum, value) => sum + value, 0))}</span>`,
            showarrow: false,
            x: 0.5,
            y: 0.5,
        }],
    }, { displayModeBar: false, responsive: true });
}

function getSortValue(transaction, column) {
    if (column === 'Betrag') {
        return transaction.Betrag;
    }
    if (column === 'Buchungstag') {
        return transaction.Buchungstag.getTime();
    }
    return String(transaction[column] || '').toLowerCase();
}

function renderTransactionsTable(transactions) {
    const body = document.getElementById('transactionsTableBody');
    body.innerHTML = '';

    const sorted = [...transactions].sort((left, right) => {
        const leftValue = getSortValue(left, state.sortColumn);
        const rightValue = getSortValue(right, state.sortColumn);
        if (leftValue > rightValue) {
            return state.sortDirection;
        }
        if (leftValue < rightValue) {
            return -state.sortDirection;
        }
        return 0;
    });

    sorted.forEach((transaction) => {
        const row = document.createElement('tr');
        const amountClass = transaction.Betrag >= 0 ? 'amount-positive' : 'amount-negative';
        row.innerHTML = `
            <td>${transaction.Buchungstag.toLocaleDateString('de-DE')}</td>
            <td class="${amountClass}">${escapeHtml(formatCurrency(transaction.Betrag))}</td>
            <td>${escapeHtml(transaction.Kategorie)}</td>
            <td>${escapeHtml(transaction['Debitor/Kreditor'])}</td>
            <td>${escapeHtml(transaction.Text)}</td>
        `;
        body.appendChild(row);
    });
}

function refreshDashboard() {
    if (!isDashboardVisible()) {
        state.dashboardNeedsRender = true;
        return;
    }

    const baseTransactions = getUserFilteredTransactions();
    const visibleTransactions = getFilteredTransactions();

    const expenses = aggregateTransactions(baseTransactions, 'expenses');
    const income = aggregateTransactions(baseTransactions, 'income');

    renderChart(expenses, 'expenses', 'Ausgaben');
    renderChart(income, 'income', 'Einnahmen');
    renderLegend('expensesLegend', expenses, 'expenses');
    renderLegend('incomeLegend', income, 'income');

    const expenseSum = visibleTransactions.filter((item) => item.Betrag < 0).reduce((sum, item) => sum + item.Betrag, 0);
    const incomeSum = visibleTransactions.filter((item) => item.Betrag >= 0).reduce((sum, item) => sum + item.Betrag, 0);
    const divisor = getMonthDivisor();

    document.getElementById('expensesSum').textContent = `Summe: ${formatCurrency(expenseSum)}`;
    document.getElementById('incomeSum').textContent = `Summe: ${formatCurrency(incomeSum)}`;
    document.getElementById('expensesAverage').textContent = `Durchschnitt/Monat: ${formatCurrency(expenseSum / divisor)}`;
    document.getElementById('incomeAverage').textContent = `Durchschnitt/Monat: ${formatCurrency(incomeSum / divisor)}`;

    setStatus(
        'dashboardStatus',
        `${visibleTransactions.length} sichtbare Transaktionen, ${baseTransactions.length} nach Benutzerfiltern`,
        'success',
    );

    renderTransactionsTable(visibleTransactions);
    state.dashboardNeedsRender = false;
    window.requestAnimationFrame(() => {
        resizeDashboardCharts();
    });
}

function renderFileList() {
    const container = document.getElementById('fileList');
    container.innerHTML = '';

    if (!state.files.length) {
        container.innerHTML = '<div class="file-item"><strong>Keine Dateien</strong><span>Der uploads-Ordner ist leer.</span></div>';
        return;
    }

    state.files.forEach((file) => {
        const button = document.createElement('button');
        button.className = `file-item ${state.selectedFile === file.filename ? 'active' : ''}`;
        button.innerHTML = `
            <strong>${escapeHtml(file.filename)}</strong>
            <span>${file.count} Einträge</span>
        `;
        button.addEventListener('click', () => selectFile(file.filename));
        container.appendChild(button);
    });
}

async function selectFile(filename) {
    if (state.selectedFile === filename) {
        return;
    }

    if (state.editorDirty) {
        const shouldSave = window.confirm('Es gibt ungespeicherte Änderungen. Jetzt speichern?');
        if (shouldSave) {
            const saved = await saveCurrentFile();
            if (!saved) {
                return;
            }
        }
    }

    const response = await backendCall('getFileContent', filename);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return;
    }

    state.selectedFile = filename;
    state.editorDirty = false;
    document.getElementById('fileEditor').value = response.content;
    document.getElementById('editorTitle').textContent = `JSON-Inhalt - ${filename}`;
    setStatus('fileStatus', `${filename} geladen.`, 'info');
    renderFileList();
}

async function saveCurrentFile() {
    if (!state.selectedFile) {
        setStatus('fileStatus', 'Bitte zuerst eine Datei auswählen.', 'error');
        return false;
    }

    const content = document.getElementById('fileEditor').value;
    const response = await backendCall('saveFileContent', state.selectedFile, content);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return false;
    }

    state.editorDirty = false;
    setStatus('fileStatus', response.message, 'info');
    await refreshAllData(state.selectedFile);
    return true;
}

async function renameSelectedFile() {
    if (!state.selectedFile) {
        setStatus('fileStatus', 'Bitte zuerst eine Datei auswählen.', 'error');
        return;
    }

    const newName = window.prompt('Neuer Dateiname:', state.selectedFile);
    if (!newName) {
        return;
    }

    const response = await backendCall('renameFile', state.selectedFile, newName);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return;
    }

    state.selectedFile = response.filename;
    state.editorDirty = false;
    setStatus('fileStatus', response.message, 'info');
    await refreshAllData(response.filename);
}

async function deleteSelectedFile() {
    if (!state.selectedFile) {
        setStatus('fileStatus', 'Bitte zuerst eine Datei auswählen.', 'error');
        return;
    }

    if (!window.confirm(`Soll ${state.selectedFile} wirklich gelöscht werden?`)) {
        return;
    }

    const response = await backendCall('deleteFile', state.selectedFile);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return;
    }

    state.selectedFile = null;
    state.editorDirty = false;
    document.getElementById('fileEditor').value = '';
    document.getElementById('editorTitle').textContent = 'JSON-Inhalt';
    setStatus('fileStatus', response.message, 'info');
    await refreshAllData(null);
}

async function uploadFile() {
    const selected = await backendCall('chooseUploadFile');
    if (!selected.success) {
        if (!selected.cancelled) {
            setStatus('fileStatus', selected.error || 'Datei konnte nicht gewählt werden.', 'error');
        }
        return;
    }

    let overwrite = false;
    if (selected.exists) {
        overwrite = window.confirm(`${selected.name} existiert bereits. Soll die Datei überschrieben werden?`);
        if (!overwrite) {
            return;
        }
    }

    const response = await backendCall('uploadFile', selected.path, overwrite);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return;
    }

    setStatus('fileStatus', response.message, 'info');
    await refreshAllData(response.filename);
}

async function loadRulesEditor() {
    const response = await backendCall('getRulesContent');
    if (!response.success) {
        setStatus('rulesStatus', response.error, 'error');
        return false;
    }

    document.getElementById('rulesEditor').value = response.content;
    state.rulesDirty = false;
    setStatus('rulesStatus', 'Regeln geladen.', 'info');
    return true;
}

async function saveRulesEditor() {
    const content = document.getElementById('rulesEditor').value;
    const response = await backendCall('saveRulesContent', content);
    if (!response.success) {
        setStatus('rulesStatus', response.error, 'error');
        return false;
    }

    state.rulesDirty = false;
    setStatus('rulesStatus', response.message, 'success');
    return true;
}

function resetUploadWorkflowState() {
    state.uploadSessionId = null;
    state.uploadSourceName = '';
    state.uploadStep = null;
    document.getElementById('uploadSourceName').textContent = 'Noch keine Datei gewählt';
    document.getElementById('uploadProgressPill').textContent = 'Bereit';
    document.getElementById('uploadEmptyState').classList.remove('hidden');
    document.getElementById('uploadWorkflowCard').classList.add('hidden');
    document.getElementById('uploadWorkflowSummary').textContent = '';
    setCustomSelectOptions('uploadCategorySelect', [{ value: '', label: 'Bestehende Kategorie auswählen' }], '');
    document.getElementById('uploadCategoryInput').value = '';
    setCustomSelectOptions('uploadRulesetSelect', [], '');
}

function renderUploadStep(step) {
    state.uploadSessionId = step.sessionId;
    state.uploadSourceName = step.sourceName;
    state.uploadStep = step;

    document.getElementById('uploadSourceName').textContent = step.sourceName;
    document.getElementById('uploadProgressPill').textContent = `${step.progress.remaining} offen`;
    document.getElementById('uploadWorkflowSummary').textContent = `${step.progress.autoResolved} Transaktionen wurden automatisch zugeordnet, ${step.progress.reviewed} manuell bearbeitet, ${step.progress.remaining} Fälle sind aktuell noch offen.`;

    document.getElementById('reviewBookingDate').textContent = step.transaction.buchungstag || '–';
    document.getElementById('reviewAmount').textContent = formatCurrency(step.transaction.betrag || 0);
    document.getElementById('reviewSuggestedCategory').textContent = step.defaultCategory || 'Sonstiges';
    document.getElementById('reviewDebitor').textContent = step.transaction.debitor || 'Kein Debitor/Kreditor vorhanden';
    document.getElementById('reviewBookingText').textContent = step.transaction.buchungstext || '–';
    document.getElementById('reviewPurpose').textContent = step.transaction.verwendungszweck || '–';
    document.getElementById('reviewText').textContent = step.transaction.text || '–';

    setCustomSelectOptions(
        'uploadCategorySelect',
        [{ value: '', label: 'Bestehende Kategorie auswählen' }, ...(step.categoryOptions || []).map((category) => ({ value: category, label: category }))],
        '',
    );

    const categoryInput = document.getElementById('uploadCategoryInput');
    categoryInput.value = '';

    setCustomSelectOptions('uploadRulesetSelect', step.ruleOptions || [], step.selectedRule || '');

    document.getElementById('uploadEmptyState').classList.add('hidden');
    document.getElementById('uploadWorkflowCard').classList.remove('hidden');
}

async function handleUploadWorkflowResponse(response) {
    if (!response.success) {
        setStatus('uploadStatus', response.error || 'Die Verarbeitung konnte nicht gestartet werden.', 'error');
        return;
    }

    if (response.completed) {
        resetUploadWorkflowState();
        document.getElementById('uploadSourceName').textContent = response.sourceName || 'Verarbeitung abgeschlossen';
        document.getElementById('uploadProgressPill').textContent = 'Abgeschlossen';
        setStatus('uploadStatus', response.message, 'success');
        await refreshAllData(response.filename || null);
        return;
    }

    renderUploadStep(response);
    setStatus('uploadStatus', `Noch ${response.progress.remaining} manuell zu prüfende Transaktionen. Änderungen an Regeln wurden bereits neu auf offene Fälle angewendet.`, 'info');
}

async function startCategorizerUpload() {
    const selected = await backendCall('chooseCategorizerFile');
    if (!selected.success) {
        if (!selected.cancelled) {
            setStatus('uploadStatus', selected.error || 'CSV-Datei konnte nicht gewählt werden.', 'error');
        }
        return;
    }

    setActiveView('categorizer');
    document.getElementById('uploadSourceName').textContent = selected.name;
    document.getElementById('uploadProgressPill').textContent = 'Lädt';
    setStatus('uploadStatus', `${selected.name} wird analysiert.`, 'info');

    const response = await backendCall('startCategorizerUpload', selected.path);
    await handleUploadWorkflowResponse(response);
}

async function submitUploadDecision() {
    if (!state.uploadSessionId) {
        setStatus('uploadStatus', 'Es gibt aktuell keinen aktiven Verarbeitungsvorgang.', 'error');
        return;
    }

    const customCategoryValue = document.getElementById('uploadCategoryInput').value.trim();
    const selectedCategoryValue = getCustomSelectValue('uploadCategorySelect');
    const categoryValue = customCategoryValue || selectedCategoryValue;
    const rulesetValue = getCustomSelectValue('uploadRulesetSelect');
    const response = await backendCall('submitCategorizerDecision', state.uploadSessionId, categoryValue, rulesetValue);
    await handleUploadWorkflowResponse(response);
}

async function cancelUploadWorkflow() {
    if (!state.uploadSessionId) {
        resetUploadWorkflowState();
        return;
    }

    const response = await backendCall('cancelCategorizerUpload', state.uploadSessionId);
    resetUploadWorkflowState();
    setStatus('uploadStatus', response.message || 'Der Upload-Vorgang wurde abgebrochen.', 'info');
}

async function refreshAllData(preferredFile = state.selectedFile) {
    state.files = await backendCall('listFiles');
    state.transactions = normalizeTransactions(state.files);
    updateMetrics();
    populateCategoryFilter();
    renderFileList();
    scheduleDashboardRefresh();

    if (preferredFile) {
        const exists = state.files.some((file) => file.filename === preferredFile);
        if (exists) {
            await selectFile(preferredFile);
            return;
        }
    }

    if (!state.selectedFile) {
        document.getElementById('fileEditor').value = '';
        document.getElementById('editorTitle').textContent = 'JSON-Inhalt';
    }
}

function resetFilters() {
    document.getElementById('filterInput').value = '';
    document.getElementById('amountFilter').value = '';
    setCustomSelectValue('categoryFilter', '');
    document.getElementById('dateStartFilter').value = '';
    document.getElementById('dateEndFilter').value = '';
    state.hiddenCategories.expenses.clear();
    state.hiddenCategories.income.clear();
    refreshDashboard();
}

function bindEvents() {
    document.querySelectorAll('.view-nav-button').forEach((button) => {
        button.addEventListener('click', () => setActiveView(button.dataset.view));
    });

    ['filterInput', 'amountFilter', 'dateStartFilter', 'dateEndFilter'].forEach((id) => {
        const element = document.getElementById(id);
        element.addEventListener('input', refreshDashboard);
        element.addEventListener('change', refreshDashboard);
    });
    document.getElementById('categoryFilter').addEventListener('change', refreshDashboard);

    document.getElementById('resetFiltersButton').addEventListener('click', resetFilters);

    document.querySelectorAll('th[data-sort-column]').forEach((header) => {
        header.addEventListener('click', () => {
            const column = header.dataset.sortColumn;
            if (state.sortColumn === column) {
                state.sortDirection *= -1;
            } else {
                state.sortColumn = column;
                state.sortDirection = column === 'Buchungstag' ? -1 : 1;
            }
            refreshDashboard();
        });
    });

    document.getElementById('startCategorizerUploadButton').addEventListener('click', startCategorizerUpload);
    document.getElementById('submitUploadDecisionButton').addEventListener('click', submitUploadDecision);
    document.getElementById('cancelUploadWorkflowButton').addEventListener('click', cancelUploadWorkflow);
    document.getElementById('reloadRulesButton').addEventListener('click', loadRulesEditor);
    document.getElementById('saveRulesButton').addEventListener('click', saveRulesEditor);
    document.getElementById('openRulesFolderButton').addEventListener('click', () => openStorageFolder('openRulesFolder', 'rulesStatus', 'Regelordner geöffnet'));
    document.getElementById('openDataFolderFromRulesButton').addEventListener('click', () => openStorageFolder('openDataFolder', 'rulesStatus', 'Datenordner geöffnet'));
    document.getElementById('rulesEditor').addEventListener('input', () => {
        state.rulesDirty = true;
    });

    document.getElementById('uploadFileButton').addEventListener('click', uploadFile);
    document.getElementById('renameFileButton').addEventListener('click', renameSelectedFile);
    document.getElementById('deleteFileButton').addEventListener('click', deleteSelectedFile);
    document.getElementById('openUploadsFolderButton').addEventListener('click', () => openStorageFolder('openUploadsFolder', 'fileStatus', 'Uploads-Ordner geöffnet'));
    document.getElementById('openDataFolderFromFilesButton').addEventListener('click', () => openStorageFolder('openDataFolder', 'fileStatus', 'Datenordner geöffnet'));
    document.getElementById('saveFileButton').addEventListener('click', saveCurrentFile);
    document.getElementById('fileEditor').addEventListener('input', () => {
        state.editorDirty = true;
    });

    window.addEventListener('resize', () => {
        scheduleDashboardRefresh(false);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    new QWebChannel(qt.webChannelTransport, async (channel) => {
        window.backend = channel.objects.backend;
        initializeCustomSelects();
        initializeDatePickers();
        bindEvents();
        resetUploadWorkflowState();
        setActiveView('dashboard');
        await loadStorageInfo();
        await refreshAllData();
        await loadRulesEditor();
        setStatus('fileStatus', 'Dateien können lokal hochgeladen, bearbeitet und gespeichert werden.', 'info');
        setStatus('uploadStatus', 'CSV-Dateien können hier analysiert und als JSON in uploads gespeichert werden.', 'info');
    });
});
