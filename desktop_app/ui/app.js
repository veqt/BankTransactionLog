const state = {
    files: [],
    transactions: [],
    selectedFile: null,
    selectedFileContent: '',
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
    transactionPagination: {
        pageSize: 50,
        currentPage: 1,
    },
    modal: {
        resolver: null,
        activeInput: null,
        submitActionId: null,
    },
    rulesManager: {
        entries: [],
        nextId: 1,
        search: '',
        sortColumn: 'rule',
        sortDirection: 1,
        selectedIds: new Set(),
        hitIndex: [],
    },
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

function normalizeRuleValue(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildRuleHitIndex(files) {
    const records = [];
    files.forEach((file) => {
        (file.data || []).forEach((entry) => {
            const searchableParts = [
                entry.Text,
                entry['Debitor/Kreditor'],
                entry['Beguenstigter/Zahlungspflichtiger'],
                entry.Buchungstext,
                entry.Verwendungszweck,
            ];
            const searchableText = normalizeRuleValue(searchableParts.filter(Boolean).join(' '));
            if (searchableText) {
                records.push(searchableText);
            }
        });
    });
    return records;
}

function markEditorDirty(isDirty) {
    state.editorDirty = isDirty;
    document.getElementById('editorTitle').textContent = state.selectedFile
        ? `JSON-Inhalt - ${state.selectedFile}${isDirty ? ' *' : ''}`
        : 'JSON-Inhalt';
}

function markRulesDirty(isDirty) {
    state.rulesDirty = isDirty;
    const title = document.querySelector('#rulesView h2');
    if (title) {
        title.textContent = isDirty ? 'Regeln bearbeiten *' : 'Regeln bearbeiten';
    }
}

function getModalElements() {
    return {
        overlay: document.getElementById('appModalOverlay'),
        title: document.getElementById('appModalTitle'),
        message: document.getElementById('appModalMessage'),
        body: document.getElementById('appModalBody'),
        error: document.getElementById('appModalError'),
        actions: document.getElementById('appModalActions'),
    };
}

function closeModal(result = null) {
    const { overlay, title, message, body, error, actions } = getModalElements();
    overlay.classList.add('hidden');
    title.textContent = '';
    message.textContent = '';
    body.innerHTML = '';
    actions.innerHTML = '';
    error.textContent = '';
    error.classList.add('hidden');
    const resolver = state.modal.resolver;
    state.modal.resolver = null;
    state.modal.activeInput = null;
    state.modal.submitActionId = null;
    if (resolver) {
        resolver(result);
    }
}

function showModalError(message) {
    const { error } = getModalElements();
    error.textContent = message;
    error.classList.remove('hidden');
}

function openModal(options) {
    const {
        title,
        message = '',
        actions = [],
        input = null,
        dangerous = false,
    } = options;

    const { overlay, title: titleElement, message: messageElement, body, error, actions: actionsElement } = getModalElements();
    titleElement.textContent = title;
    messageElement.textContent = message;
    body.innerHTML = '';
    actionsElement.innerHTML = '';
    error.textContent = '';
    error.classList.add('hidden');

    if (input) {
        const wrapper = document.createElement('label');
        wrapper.className = 'field app-modal-field';
        const label = document.createElement('span');
        label.textContent = input.label || 'Wert';
        const inputElement = document.createElement('input');
        inputElement.type = input.type || 'text';
        inputElement.value = input.value || '';
        inputElement.placeholder = input.placeholder || '';
        wrapper.appendChild(label);
        wrapper.appendChild(inputElement);
        body.appendChild(wrapper);
        state.modal.activeInput = inputElement;
        state.modal.submitActionId = input.submitActionId || null;
    }

    actions.forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = action.className || (action.primary ? 'primary-button' : (dangerous || action.danger ? 'danger-button' : 'secondary-button'));
        button.textContent = action.label;
        button.addEventListener('click', () => {
            const value = state.modal.activeInput ? state.modal.activeInput.value : undefined;
            closeModal({ action: action.id, value });
        });
        actionsElement.appendChild(button);
    });

    overlay.classList.remove('hidden');
    return new Promise((resolve) => {
        state.modal.resolver = resolve;
        window.requestAnimationFrame(() => {
            if (state.modal.activeInput) {
                state.modal.activeInput.focus();
                state.modal.activeInput.select();
                return;
            }
            actionsElement.querySelector('button')?.focus();
        });
    });
}

async function showConfirmModal(title, message, confirmLabel, options = {}) {
    const result = await openModal({
        title,
        message,
        dangerous: options.dangerous,
        actions: [
            { id: 'cancel', label: options.cancelLabel || 'Abbrechen', className: 'secondary-button' },
            { id: 'confirm', label: confirmLabel, className: options.dangerous ? 'danger-button' : 'primary-button' },
        ],
    });
    return result?.action === 'confirm';
}

async function showPromptModal(title, message, inputOptions, confirmLabel) {
    let currentValue = inputOptions.value || '';
    let currentMessage = message;

    while (true) {
        const result = await openModal({
            title,
            message: currentMessage,
            input: {
                ...inputOptions,
                value: currentValue,
            },
            actions: [
                { id: 'cancel', label: 'Abbrechen', className: 'secondary-button' },
                { id: 'confirm', label: confirmLabel, className: 'primary-button' },
            ],
        });

        if (!result || result.action !== 'confirm') {
            return null;
        }

        const validator = inputOptions.validate || (() => null);
        const validationMessage = validator(result.value);
        if (!validationMessage) {
            return result.value;
        }

        currentValue = result.value;
        currentMessage = `${message} ${validationMessage}`;
    }
}

async function confirmUnsavedChanges(kind) {
    const isRules = kind === 'rules';
    const title = isRules ? 'Ungespeicherte Regeln' : 'Ungespeicherte Dateiänderungen';
    const message = isRules
        ? 'Die Regeln wurden geändert. Möchtest du sie speichern, verwerfen oder den Vorgang abbrechen?'
        : 'Die ausgewählte Datei wurde geändert. Möchtest du sie speichern, verwerfen oder den Vorgang abbrechen?';

    const result = await openModal({
        title,
        message,
        actions: [
            { id: 'cancel', label: 'Abbrechen', className: 'secondary-button' },
            { id: 'discard', label: 'Verwerfen', className: 'danger-button' },
            { id: 'save', label: 'Speichern', className: 'primary-button' },
        ],
    });

    return result?.action || 'cancel';
}

function initializeModal() {
    const { overlay } = getModalElements();
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeModal({ action: 'cancel' });
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.modal.resolver) {
            event.preventDefault();
            closeModal({ action: 'cancel' });
        }
        if (event.key === 'Enter' && state.modal.resolver && state.modal.activeInput && document.activeElement === state.modal.activeInput) {
            event.preventDefault();
            closeModal({ action: state.modal.submitActionId || 'confirm', value: state.modal.activeInput.value });
        }
    });
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

function isClickInsidePopoverControl(target) {
    if (!(target instanceof Element)) {
        return false;
    }
    return Boolean(target.closest('.custom-select') || target.closest('.date-field'));
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

function setCustomSelectDisabled(id, disabled) {
    const instance = createCustomSelect(id);
    instance.root.classList.toggle('is-disabled', disabled || instance.options.length === 0);
    instance.trigger.disabled = disabled || instance.options.length === 0;
    if (disabled) {
        instance.root.classList.remove('is-open');
        instance.menu.hidden = true;
        instance.trigger.setAttribute('aria-expanded', 'false');
    }
}

function initializeCustomSelects() {
    ['categoryFilter', 'uploadCategorySelect', 'uploadRulesetSelect'].forEach((id) => {
        createCustomSelect(id);
    });

    document.addEventListener('click', (event) => {
        if (isClickInsidePopoverControl(event.target)) {
            return;
        }
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

async function discardRulesChanges() {
    const response = await backendCall('getRulesContent');
    if (!response.success) {
        setStatus('rulesStatus', response.error, 'error');
        return false;
    }
    loadRulesManagerFromContent(response.content);
    setStatus('rulesStatus', 'Ungespeicherte Änderungen wurden verworfen.', 'info');
    return true;
}

async function discardFileChanges() {
    if (!state.selectedFile) {
        document.getElementById('fileEditor').value = '';
        markEditorDirty(false);
        return true;
    }

    const response = await backendCall('getFileContent', state.selectedFile);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return false;
    }

    state.selectedFileContent = response.content;
    document.getElementById('fileEditor').value = response.content;
    markEditorDirty(false);
    setStatus('fileStatus', 'Ungespeicherte Änderungen wurden verworfen.', 'info');
    return true;
}

async function resolvePendingChanges(scope) {
    if (scope === 'files' && !state.editorDirty) {
        return true;
    }
    if (scope === 'rules' && !state.rulesDirty) {
        return true;
    }

    const action = await confirmUnsavedChanges(scope === 'rules' ? 'rules' : 'file');
    if (action === 'cancel') {
        return false;
    }

    if (action === 'save') {
        return scope === 'rules' ? saveRulesEditor() : saveCurrentFile();
    }

    return scope === 'rules' ? discardRulesChanges() : discardFileChanges();
}

async function setActiveView(viewName) {
    if (viewName === state.currentView) {
        return;
    }

    if (state.currentView === 'files') {
        const allowed = await resolvePendingChanges('files');
        if (!allowed) {
            return;
        }
    }

    if (state.currentView === 'rules') {
        const allowed = await resolvePendingChanges('rules');
        if (!allowed) {
            return;
        }
    }

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

function getSortedTransactions(transactions) {
    return [...transactions].sort((left, right) => {
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
}

function getTransactionPagination(totalCount) {
    const pageSize = state.transactionPagination.pageSize;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const currentPage = Math.min(state.transactionPagination.currentPage, totalPages);
    state.transactionPagination.currentPage = currentPage;

    return {
        pageSize,
        totalCount,
        totalPages,
        currentPage,
        startIndex: totalCount ? (currentPage - 1) * pageSize : 0,
        endIndex: totalCount ? Math.min(currentPage * pageSize, totalCount) : 0,
    };
}

function buildPaginationModel(totalPages, currentPage) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages = new Set([1, totalPages, currentPage]);
    if (currentPage <= 3) {
        pages.add(2);
        pages.add(3);
        pages.add(4);
    } else if (currentPage >= totalPages - 2) {
        pages.add(totalPages - 1);
        pages.add(totalPages - 2);
        pages.add(totalPages - 3);
    } else {
        pages.add(currentPage - 1);
        pages.add(currentPage + 1);
    }

    const sortedPages = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((left, right) => left - right);
    const model = [];

    sortedPages.forEach((page, index) => {
        if (index > 0 && page - sortedPages[index - 1] > 1) {
            model.push('ellipsis');
        }
        model.push(page);
    });

    return model;
}

function goToTransactionPage(page) {
    const totalCount = getFilteredTransactions().length;
    const { totalPages, currentPage } = getTransactionPagination(totalCount);
    const nextPage = Math.max(1, Math.min(page, totalPages));
    if (nextPage === currentPage) {
        return;
    }
    state.transactionPagination.currentPage = nextPage;
    refreshDashboard();
}

function resetTransactionPagination() {
    state.transactionPagination.currentPage = 1;
}

function renderTransactionPagination(totalCount) {
    const summary = document.getElementById('transactionsPaginationSummary');
    const container = document.getElementById('transactionsPagination');
    const pagination = getTransactionPagination(totalCount);

    if (!summary || !container) {
        return pagination;
    }

    if (!totalCount) {
        summary.textContent = 'Keine Transaktionen im aktuellen Filter';
        container.innerHTML = '';
        return pagination;
    }

    summary.textContent = `${pagination.startIndex + 1}-${pagination.endIndex} von ${totalCount} Transaktionen`;
    container.innerHTML = '';

    const previousButton = document.createElement('button');
    previousButton.type = 'button';
    previousButton.className = 'table-pagination-button table-pagination-arrow';
    previousButton.textContent = '◀';
    previousButton.disabled = pagination.currentPage <= 1;
    previousButton.setAttribute('aria-label', 'Vorherige Seite');
    previousButton.addEventListener('click', () => goToTransactionPage(pagination.currentPage - 1));
    container.appendChild(previousButton);

    buildPaginationModel(pagination.totalPages, pagination.currentPage).forEach((entry) => {
        if (entry === 'ellipsis') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'table-pagination-ellipsis';
            ellipsis.textContent = '...';
            container.appendChild(ellipsis);
            return;
        }

        const pageButton = document.createElement('button');
        pageButton.type = 'button';
        pageButton.className = `table-pagination-button ${entry === pagination.currentPage ? 'is-active' : ''}`;
        pageButton.textContent = String(entry);
        pageButton.setAttribute('aria-label', `Seite ${entry}`);
        if (entry === pagination.currentPage) {
            pageButton.setAttribute('aria-current', 'page');
        }
        pageButton.addEventListener('click', () => goToTransactionPage(entry));
        container.appendChild(pageButton);
    });

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'table-pagination-button table-pagination-arrow';
    nextButton.textContent = '▶';
    nextButton.disabled = pagination.currentPage >= pagination.totalPages;
    nextButton.setAttribute('aria-label', 'Nächste Seite');
    nextButton.addEventListener('click', () => goToTransactionPage(pagination.currentPage + 1));
    container.appendChild(nextButton);

    return pagination;
}

function renderTransactionsTable(transactions) {
    const body = document.getElementById('transactionsTableBody');
    body.innerHTML = '';

    const sorted = getSortedTransactions(transactions);
    const pagination = renderTransactionPagination(sorted.length);
    const visibleRows = sorted.slice(pagination.startIndex, pagination.endIndex);

    visibleRows.forEach((transaction) => {
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
        const action = await confirmUnsavedChanges('file');
        if (action === 'cancel') {
            return;
        }
        if (action === 'save') {
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
    state.selectedFileContent = response.content;
    document.getElementById('fileEditor').value = response.content;
    markEditorDirty(false);
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

    state.selectedFileContent = content;
    markEditorDirty(false);
    setStatus('fileStatus', response.message, 'info');
    await refreshAllData(state.selectedFile);
    return true;
}

async function renameSelectedFile() {
    if (!state.selectedFile) {
        setStatus('fileStatus', 'Bitte zuerst eine Datei auswählen.', 'error');
        return;
    }

    const newName = await showPromptModal(
        'Datei umbenennen',
        `Gib einen neuen Namen für ${state.selectedFile} ein.`,
        {
            label: 'Dateiname',
            value: state.selectedFile,
            placeholder: 'Neuer Dateiname',
            submitActionId: 'confirm',
            validate: (value) => {
                const trimmed = String(value || '').trim();
                if (!trimmed) {
                    return 'Der Dateiname darf nicht leer sein.';
                }
                if (/[\\/]/.test(trimmed)) {
                    return 'Dateinamen dürfen keine Pfadtrenner enthalten.';
                }
                return null;
            },
        },
        'Umbenennen',
    );
    if (!newName) {
        return;
    }

    const response = await backendCall('renameFile', state.selectedFile, newName);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return;
    }

    state.selectedFile = response.filename;
    markEditorDirty(false);
    setStatus('fileStatus', response.message, 'info');
    await refreshAllData(response.filename);
}

async function deleteSelectedFile() {
    if (!state.selectedFile) {
        setStatus('fileStatus', 'Bitte zuerst eine Datei auswählen.', 'error');
        return;
    }

    const confirmed = await showConfirmModal(
        'Datei löschen',
        `Soll ${state.selectedFile} wirklich gelöscht werden? Diese Aktion kann nicht rückgängig gemacht werden.`,
        'Löschen',
        { dangerous: true },
    );
    if (!confirmed) {
        return;
    }

    const response = await backendCall('deleteFile', state.selectedFile);
    if (!response.success) {
        setStatus('fileStatus', response.error, 'error');
        return;
    }

    state.selectedFile = null;
    state.selectedFileContent = '';
    markEditorDirty(false);
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
        overwrite = await showConfirmModal(
            'Vorhandene Datei überschreiben',
            `${selected.name} existiert bereits im Uploads-Ordner. Soll die Datei überschrieben werden?`,
            'Überschreiben',
            { dangerous: true },
        );
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

function buildRulesEntriesMap() {
    const map = new Map();
    state.rulesManager.entries.forEach((entry) => {
        const normalized = normalizeRuleValue(entry.rule);
        if (!normalized) {
            return;
        }
        if (!map.has(normalized)) {
            map.set(normalized, []);
        }
        map.get(normalized).push(entry.id);
    });
    return map;
}

function getDuplicateRuleIds() {
    const duplicateIds = new Set();
    buildRulesEntriesMap().forEach((ids) => {
        if (ids.length > 1) {
            ids.forEach((id) => duplicateIds.add(id));
        }
    });
    return duplicateIds;
}

function getRuleHitCount(ruleName) {
    const normalizedRule = normalizeRuleValue(ruleName);
    if (!normalizedRule) {
        return 0;
    }
    return state.rulesManager.hitIndex.reduce((count, text) => count + (text.includes(normalizedRule) ? 1 : 0), 0);
}

function getRuleManagerCategories() {
    const categories = new Set(state.transactions.map((item) => item.Kategorie).filter(Boolean));
    state.rulesManager.entries.forEach((entry) => {
        if (entry.category) {
            categories.add(entry.category);
        }
    });
    return [...categories].sort((left, right) => left.localeCompare(right, 'de'));
}

function buildRulesCategoryOptions(selectedValue = '', includeEmpty = false) {
    const categories = getRuleManagerCategories();
    const selectedCategory = String(selectedValue || '');

    if (selectedCategory && !categories.includes(selectedCategory)) {
        categories.push(selectedCategory);
        categories.sort((left, right) => left.localeCompare(right, 'de'));
    }

    const options = [];
    if (includeEmpty) {
        options.push('<option value="">Kategorie wählen</option>');
    }

    categories.forEach((category) => {
        const isSelected = category === selectedCategory ? ' selected' : '';
        options.push(`<option value="${escapeHtml(category)}"${isSelected}>${escapeHtml(category)}</option>`);
    });

    return options.join('');
}

function updateRulesCategorySelects() {
    const bulkSelect = document.getElementById('rulesBulkCategorySelect');
    if (!bulkSelect) {
        return;
    }

    const previousValue = bulkSelect.value;
    bulkSelect.innerHTML = buildRulesCategoryOptions(previousValue, true);
}

function getFilteredRulesEntries() {
    const query = normalizeRuleValue(state.rulesManager.search);
    return state.rulesManager.entries.filter((entry) => {
        if (!query) {
            return true;
        }
        return normalizeRuleValue(entry.rule).includes(query) || normalizeRuleValue(entry.category).includes(query);
    });
}

function getSortedRulesEntries(entries) {
    const duplicateIds = getDuplicateRuleIds();
    return [...entries].sort((left, right) => {
        let leftValue;
        let rightValue;

        if (state.rulesManager.sortColumn === 'hits') {
            leftValue = getRuleHitCount(left.rule);
            rightValue = getRuleHitCount(right.rule);
        } else if (state.rulesManager.sortColumn === 'duplicate') {
            leftValue = duplicateIds.has(left.id) ? 1 : 0;
            rightValue = duplicateIds.has(right.id) ? 1 : 0;
        } else if (state.rulesManager.sortColumn === 'category') {
            leftValue = normalizeRuleValue(left.category);
            rightValue = normalizeRuleValue(right.category);
        } else {
            leftValue = normalizeRuleValue(left.rule);
            rightValue = normalizeRuleValue(right.rule);
        }

        if (leftValue > rightValue) {
            return state.rulesManager.sortDirection;
        }
        if (leftValue < rightValue) {
            return -state.rulesManager.sortDirection;
        }
        return left.id - right.id;
    });
}

function updateRulesSummary(visibleEntries) {
    const summary = document.getElementById('rulesTableSummary');
    const selection = document.getElementById('rulesSelectionCount');
    const duplicates = document.getElementById('rulesDuplicateSummary');
    const duplicateIds = getDuplicateRuleIds();
    const duplicateCount = duplicateIds.size;

    summary.textContent = `${visibleEntries.length} sichtbare Regeln, ${state.rulesManager.entries.length} insgesamt`;
    selection.textContent = `${state.rulesManager.selectedIds.size} Regeln ausgewählt`;
    duplicates.textContent = duplicateCount
        ? `${duplicateCount} Regeln mit normierten Dubletten erkannt`
        : 'Keine Dubletten erkannt';
}

function renderRulesTable() {
    const body = document.getElementById('rulesTableBody');
    const selectAllCheckbox = document.getElementById('rulesSelectAllCheckbox');
    const duplicateIds = getDuplicateRuleIds();
    const visibleEntries = getSortedRulesEntries(getFilteredRulesEntries());

    updateRulesSummary(visibleEntries);
    updateRulesCategorySelects();
    body.innerHTML = '';

    if (!visibleEntries.length) {
        body.innerHTML = '<tr><td colspan="6" class="rules-empty-state">Keine Regeln im aktuellen Filter.</td></tr>';
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    visibleEntries.forEach((entry) => {
        const row = document.createElement('tr');
        const hitCount = getRuleHitCount(entry.rule);
        const isDuplicate = duplicateIds.has(entry.id);
        row.className = isDuplicate ? 'rules-row-has-duplicate' : '';
        row.innerHTML = `
            <td class="rules-checkbox-column"><input type="checkbox" data-rule-select="${entry.id}" ${state.rulesManager.selectedIds.has(entry.id) ? 'checked' : ''}></td>
            <td><input type="text" data-rule-field="rule" data-rule-id="${entry.id}" value="${escapeHtml(entry.rule)}" placeholder="Regelname"></td>
            <td><select data-rule-field="category" data-rule-id="${entry.id}">${buildRulesCategoryOptions(entry.category, true)}</select></td>
            <td><span class="rules-hit-badge">${hitCount}</span></td>
            <td>${isDuplicate ? '<span class="rules-duplicate-badge">Normiert doppelt</span>' : '<span class="rules-duplicate-muted">-</span>'}</td>
            <td class="rules-actions-column"><button type="button" class="secondary-button rules-delete-button" data-rule-delete="${entry.id}">Entfernen</button></td>
        `;
        body.appendChild(row);
    });

    const visibleIds = visibleEntries.map((entry) => entry.id);
    const selectedVisibleCount = visibleIds.filter((id) => state.rulesManager.selectedIds.has(id)).length;
    selectAllCheckbox.checked = selectedVisibleCount > 0 && selectedVisibleCount === visibleIds.length;
    selectAllCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
}

function setRuleEntryValue(entryId, field, value, rerender = true) {
    const entry = state.rulesManager.entries.find((item) => item.id === entryId);
    if (!entry) {
        return;
    }
    entry[field] = value;
    markRulesDirty(true);
    if (rerender) {
        renderRulesTable();
    } else {
        updateRulesSummary(getSortedRulesEntries(getFilteredRulesEntries()));
    }
}

function addRuleEntry(rule = '', category = '') {
    const entry = {
        id: state.rulesManager.nextId,
        rule,
        category,
    };
    state.rulesManager.nextId += 1;
    state.rulesManager.entries.push(entry);
    markRulesDirty(true);
    renderRulesTable();
}

function deleteRuleEntry(entryId) {
    state.rulesManager.entries = state.rulesManager.entries.filter((entry) => entry.id !== entryId);
    state.rulesManager.selectedIds.delete(entryId);
    markRulesDirty(true);
    renderRulesTable();
}

function applyBulkRuleCategory() {
    const category = document.getElementById('rulesBulkCategorySelect').value.trim();
    if (!category) {
        setStatus('rulesStatus', 'Bitte zuerst eine Sammel-Kategorie angeben.', 'error');
        return;
    }

    if (!state.rulesManager.selectedIds.size) {
        setStatus('rulesStatus', 'Bitte zuerst mindestens eine Regel auswählen.', 'error');
        return;
    }

    state.rulesManager.entries.forEach((entry) => {
        if (state.rulesManager.selectedIds.has(entry.id)) {
            entry.category = category;
        }
    });

    markRulesDirty(true);
    setStatus('rulesStatus', `Kategorie ${category} wurde auf ${state.rulesManager.selectedIds.size} Regeln angewendet.`, 'success');
    renderRulesTable();
}

function serializeRulesManager() {
    const payload = {};
    const duplicateIds = getDuplicateRuleIds();
    if (duplicateIds.size) {
        throw new Error('Es gibt normierte Dubletten bei Regelnamen. Bitte bereinige diese vor dem Speichern.');
    }

    state.rulesManager.entries.forEach((entry) => {
        const rule = entry.rule.trim();
        const category = entry.category.trim();
        if (!rule || !category) {
            throw new Error('Jede Regel benötigt einen Regelnamen und eine Kategorie.');
        }
        payload[rule] = category;
    });

    return payload;
}

function loadRulesManagerFromContent(content) {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Die Rules-Datei muss ein JSON-Objekt enthalten.');
    }

    state.rulesManager.entries = Object.entries(parsed).map(([rule, category], index) => ({
        id: index + 1,
        rule,
        category: String(category ?? ''),
    }));
    state.rulesManager.nextId = state.rulesManager.entries.length + 1;
    state.rulesManager.selectedIds = new Set();
    markRulesDirty(false);
    renderRulesTable();
}

async function loadRulesEditor() {
    const response = await backendCall('getRulesContent');
    if (!response.success) {
        setStatus('rulesStatus', response.error, 'error');
        return false;
    }

    try {
        loadRulesManagerFromContent(response.content);
    } catch (error) {
        setStatus('rulesStatus', error.message || String(error), 'error');
        return false;
    }

    setStatus('rulesStatus', 'Regeln geladen.', 'info');
    return true;
}

async function saveRulesEditor() {
    let content;
    try {
        content = JSON.stringify(serializeRulesManager(), null, 4);
    } catch (error) {
        setStatus('rulesStatus', error.message || String(error), 'error');
        return false;
    }

    const response = await backendCall('saveRulesContent', content);
    if (!response.success) {
        setStatus('rulesStatus', response.error, 'error');
        return false;
    }

    markRulesDirty(false);
    setStatus('rulesStatus', response.message, 'success');
    return true;
}

function setUploadCategoryValidation(message = '') {
    const element = document.getElementById('uploadCategoryValidation');
    if (!element) {
        return;
    }
    element.textContent = message;
    element.classList.toggle('hidden', !message);
    document.getElementById('uploadCategoryInput').classList.toggle('input-error', Boolean(message));
    state.customSelects.uploadCategorySelect?.root.classList.toggle('has-error', Boolean(message));
}

function updateUploadProgressDisplay(progress = null) {
    const safeProgress = progress || { reviewed: 0, remaining: 0, autoResolved: 0, totalTransactions: 0 };
    const total = Math.max(safeProgress.totalTransactions || 0, 1);
    const completed = (safeProgress.reviewed || 0) + (safeProgress.autoResolved || 0);
    const percentage = Math.round((completed / total) * 100);

    document.getElementById('uploadReviewedCount').textContent = String(safeProgress.reviewed || 0);
    document.getElementById('uploadAutoResolvedCount').textContent = String(safeProgress.autoResolved || 0);
    document.getElementById('uploadRemainingCount').textContent = String(safeProgress.remaining || 0);
    document.getElementById('uploadProgressBar').style.width = `${percentage}%`;
}

function getUploadRuleLabel(value) {
    const options = state.customSelects.uploadRulesetSelect?.options || [];
    return options.find((option) => option.value === value)?.label || value || 'Keine Regel';
}

function updateUploadDecisionPreview() {
    const selectedCategory = getCustomSelectValue('uploadCategorySelect');
    const newCategory = document.getElementById('uploadCategoryInput').value.trim();
    const effectiveCategory = newCategory || selectedCategory || state.uploadStep?.defaultCategory || 'Noch keine Kategorie gewählt';
    const selectedRule = getCustomSelectValue('uploadRulesetSelect') || state.uploadStep?.selectedRule || '';
    const readableRule = getUploadRuleLabel(selectedRule);
    const effectText = selectedRule
        ? `Beim Speichern wird ${effectiveCategory} mit der Regel ${readableRule} für künftige ähnliche Buchungen verwendet.`
        : `Beim Speichern wird ${effectiveCategory} nur für diese Transaktion übernommen.`;

    document.getElementById('uploadDecisionPreviewCategory').textContent = effectiveCategory;
    document.getElementById('uploadDecisionPreviewText').textContent = effectText;
    document.getElementById('reviewRulePreview').textContent = readableRule;
}

function syncUploadCategoryMode() {
    const customCategoryValue = document.getElementById('uploadCategoryInput').value.trim();
    const hasCustomCategory = Boolean(customCategoryValue);
    setCustomSelectDisabled('uploadCategorySelect', hasCustomCategory);
    if (hasCustomCategory) {
        setCustomSelectValue('uploadCategorySelect', '');
    } else if (!getCustomSelectValue('uploadCategorySelect') && state.uploadStep?.defaultCategory) {
        setCustomSelectValue('uploadCategorySelect', state.uploadStep.defaultCategory);
    }
    setUploadCategoryValidation('');
    updateUploadDecisionPreview();
}

function validateUploadDecision() {
    const customCategoryValue = document.getElementById('uploadCategoryInput').value.trim();
    const selectedCategoryValue = getCustomSelectValue('uploadCategorySelect');
    const categoryValue = customCategoryValue || selectedCategoryValue;

    if (!categoryValue) {
        setUploadCategoryValidation('Bitte wähle eine bestehende Kategorie oder lege eine neue Kategorie an.');
        if (customCategoryValue) {
            document.getElementById('uploadCategoryInput').focus();
        } else {
            state.customSelects.uploadCategorySelect?.trigger.focus();
        }
        return null;
    }

    setUploadCategoryValidation('');
    return {
        categoryValue,
        rulesetValue: getCustomSelectValue('uploadRulesetSelect') || state.uploadStep?.selectedRule || '',
    };
}

function renderUploadCompletion(response) {
    document.getElementById('uploadCompletionCard').classList.remove('hidden');
    document.getElementById('uploadCompletionFilename').textContent = response.filename || '–';
    document.getElementById('uploadCompletionTransactions').textContent = String(response.transactionCount || 0);
    document.getElementById('uploadCompletionAutoResolved').textContent = String(response.progress?.autoResolved || 0);
    document.getElementById('uploadCompletionReviewed').textContent = String(response.progress?.reviewed || 0);
    document.getElementById('uploadCompletionSummary').textContent = `${response.transactionCount || 0} Transaktionen verarbeitet. Die Datei ${response.filename || ''} steht jetzt in uploads bereit.`.trim();
}

function resetUploadWorkflowState() {
    state.uploadSessionId = null;
    state.uploadSourceName = '';
    state.uploadStep = null;
    document.getElementById('uploadSourceName').textContent = 'Noch keine Datei gewählt';
    document.getElementById('uploadProgressPill').textContent = 'Bereit';
    updateUploadProgressDisplay();
    document.getElementById('uploadEmptyState').classList.remove('hidden');
    document.getElementById('uploadCompletionCard').classList.add('hidden');
    document.getElementById('uploadWorkflowCard').classList.add('hidden');
    document.getElementById('uploadWorkflowSummary').textContent = '';
    setCustomSelectOptions('uploadCategorySelect', [{ value: '', label: 'Bestehende Kategorie auswählen' }], '');
    document.getElementById('uploadCategoryInput').value = '';
    setCustomSelectOptions('uploadRulesetSelect', [{ value: '', label: 'Regelname auswählen' }], '');
    setCustomSelectDisabled('uploadCategorySelect', false);
    setUploadCategoryValidation('');
    document.getElementById('reviewSuggestedCategory').textContent = '–';
    document.getElementById('reviewSuggestionSource').textContent = '';
    document.getElementById('reviewSuggestionConfidence').textContent = '–';
    document.getElementById('reviewSuggestionDetail').textContent = '';
    document.getElementById('uploadDecisionPreviewCategory').textContent = 'Noch keine Kategorie gewählt';
    document.getElementById('uploadDecisionPreviewText').textContent = 'Wähle zuerst eine Kategorie und einen Regelvorschlag aus.';
    document.getElementById('reviewRulePreview').textContent = 'Keine Regel';
}

function renderUploadStep(step) {
    state.uploadSessionId = step.sessionId;
    state.uploadSourceName = step.sourceName;
    state.uploadStep = step;

    document.getElementById('uploadSourceName').textContent = step.sourceName;
    document.getElementById('uploadProgressPill').textContent = `${step.progress.remaining} offen`;
    updateUploadProgressDisplay(step.progress);
    document.getElementById('uploadWorkflowSummary').textContent = `${step.progressSummary?.completedSteps || 0} von ${step.progressSummary?.totalSteps || step.progress.totalTransactions} Transaktionen sind bereits erledigt. Prüfe jetzt den nächsten offenen Fall.`;

    document.getElementById('reviewBookingDate').textContent = step.transaction.buchungstag || '–';
    document.getElementById('reviewAmount').textContent = formatCurrency(step.transaction.betrag || 0);
    document.getElementById('reviewSuggestedCategory').textContent = step.defaultCategory || 'Sonstiges';
    document.getElementById('reviewSuggestionSource').textContent = step.suggestionSource || 'Vorschlag';
    document.getElementById('reviewSuggestionConfidence').textContent = `Sicherheit: ${step.suggestionConfidence || 'niedrig'}`;
    document.getElementById('reviewSuggestionDetail').textContent = step.suggestionDetail || '';
    document.getElementById('reviewDebitor').textContent = step.transaction.debitor || 'Kein Debitor/Kreditor vorhanden';
    document.getElementById('reviewBookingText').textContent = step.transaction.buchungstext || '–';
    document.getElementById('reviewPurpose').textContent = step.transaction.verwendungszweck || '–';
    document.getElementById('reviewText').textContent = step.transaction.text || '–';

    const categoryOptions = [...new Set([step.defaultCategory, ...(step.categoryOptions || [])].filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, 'de'));
    setCustomSelectOptions(
        'uploadCategorySelect',
        [{ value: '', label: 'Bestehende Kategorie auswählen' }, ...categoryOptions.map((category) => ({ value: category, label: category }))],
        step.defaultCategory || '',
    );

    const categoryInput = document.getElementById('uploadCategoryInput');
    categoryInput.value = '';

    setCustomSelectOptions('uploadRulesetSelect', step.ruleOptions || [{ value: '', label: 'Keine Regel speichern' }], step.selectedRule || '');
    setCustomSelectDisabled('uploadCategorySelect', false);
    setUploadCategoryValidation('');
    updateUploadDecisionPreview();

    document.getElementById('uploadEmptyState').classList.add('hidden');
    document.getElementById('uploadCompletionCard').classList.add('hidden');
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
        updateUploadProgressDisplay(response.progress);
        renderUploadCompletion(response);
        setStatus('uploadStatus', response.message, 'success');
        await refreshAllData(response.filename || null);
        return;
    }

    renderUploadStep(response);
    const autoResolvedMessage = response.newlyAutoResolvedCount
        ? ` Durch deine letzte Entscheidung wurden ${response.newlyAutoResolvedCount} weitere Transaktionen automatisch erkannt.`
        : '';
    setStatus('uploadStatus', `Noch ${response.progress.remaining} manuell zu prüfende Transaktionen.${autoResolvedMessage}`, 'info');
}

async function startCategorizerUpload() {
    const selected = await backendCall('chooseCategorizerFile');
    if (!selected.success) {
        if (!selected.cancelled) {
            setStatus('uploadStatus', selected.error || 'CSV-Datei konnte nicht gewählt werden.', 'error');
        }
        return;
    }

    await setActiveView('categorizer');
    if (state.currentView !== 'categorizer') {
        return;
    }
    resetUploadWorkflowState();
    document.getElementById('uploadSourceName').textContent = selected.name;
    document.getElementById('uploadProgressPill').textContent = 'Lädt';
    updateUploadProgressDisplay({ reviewed: 0, remaining: 0, autoResolved: 0, totalTransactions: 1 });
    setStatus('uploadStatus', `${selected.name} wird analysiert.`, 'info');

    const response = await backendCall('startCategorizerUpload', selected.path);
    await handleUploadWorkflowResponse(response);
}

async function submitUploadDecision() {
    if (!state.uploadSessionId) {
        setStatus('uploadStatus', 'Es gibt aktuell keinen aktiven Verarbeitungsvorgang.', 'error');
        return;
    }

    const validation = validateUploadDecision();
    if (!validation) {
        return;
    }

    const response = await backendCall('submitCategorizerDecision', state.uploadSessionId, validation.categoryValue, validation.rulesetValue);
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
    state.rulesManager.hitIndex = buildRuleHitIndex(state.files);
    updateMetrics();
    populateCategoryFilter();
    renderFileList();
    renderRulesTable();
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
        state.selectedFileContent = '';
        markEditorDirty(false);
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
    resetTransactionPagination();
    refreshDashboard();
}

function bindEvents() {
    document.querySelectorAll('.view-nav-button').forEach((button) => {
        button.addEventListener('click', async () => setActiveView(button.dataset.view));
    });

    ['filterInput', 'amountFilter', 'dateStartFilter', 'dateEndFilter'].forEach((id) => {
        const element = document.getElementById(id);
        element.addEventListener('input', () => {
            resetTransactionPagination();
            refreshDashboard();
        });
        element.addEventListener('change', () => {
            resetTransactionPagination();
            refreshDashboard();
        });
    });
    document.getElementById('categoryFilter').addEventListener('change', () => {
        resetTransactionPagination();
        refreshDashboard();
    });

    document.getElementById('transactionsPageSize').addEventListener('change', (event) => {
        const nextValue = Number(event.target.value);
        state.transactionPagination.pageSize = [50, 100, 200].includes(nextValue) ? nextValue : 50;
        resetTransactionPagination();
        refreshDashboard();
    });

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
    document.getElementById('goToDashboardButton').addEventListener('click', async () => setActiveView('dashboard'));
    document.getElementById('openUploadsFolderFromCompletionButton').addEventListener('click', () => openStorageFolder('openUploadsFolder', 'uploadStatus', 'Uploads-Ordner geöffnet'));
    document.getElementById('reloadRulesButton').addEventListener('click', async () => {
        if (state.rulesDirty) {
            const action = await confirmUnsavedChanges('rules');
            if (action === 'cancel') {
                return;
            }
            if (action === 'save') {
                const saved = await saveRulesEditor();
                if (!saved) {
                    return;
                }
            }
        }
        await loadRulesEditor();
    });
    document.getElementById('saveRulesButton').addEventListener('click', saveRulesEditor);
    document.getElementById('openRulesFolderButton').addEventListener('click', () => openStorageFolder('openRulesFolder', 'rulesStatus', 'Regelordner geöffnet'));
    document.getElementById('openDataFolderFromRulesButton').addEventListener('click', () => openStorageFolder('openDataFolder', 'rulesStatus', 'Datenordner geöffnet'));
    document.getElementById('rulesSearchInput').addEventListener('input', (event) => {
        state.rulesManager.search = event.target.value;
        renderRulesTable();
    });
    document.getElementById('applyBulkCategoryButton').addEventListener('click', applyBulkRuleCategory);
    document.getElementById('addRuleRowButton').addEventListener('click', () => addRuleEntry('', ''));
    document.getElementById('rulesSelectAllCheckbox').addEventListener('change', (event) => {
        const visibleIds = getFilteredRulesEntries().map((entry) => entry.id);
        if (event.target.checked) {
            visibleIds.forEach((id) => state.rulesManager.selectedIds.add(id));
        } else {
            visibleIds.forEach((id) => state.rulesManager.selectedIds.delete(id));
        }
        renderRulesTable();
    });
    document.querySelectorAll('th[data-rules-sort-column]').forEach((header) => {
        header.addEventListener('click', () => {
            const column = header.dataset.rulesSortColumn;
            if (state.rulesManager.sortColumn === column) {
                state.rulesManager.sortDirection *= -1;
            } else {
                state.rulesManager.sortColumn = column;
                state.rulesManager.sortDirection = column === 'hits' || column === 'duplicate' ? -1 : 1;
            }
            renderRulesTable();
        });
    });
    document.getElementById('rulesTableBody').addEventListener('input', (event) => {
        const field = event.target.dataset.ruleField;
        const entryId = Number(event.target.dataset.ruleId);
        if (!field || !entryId) {
            return;
        }
        setRuleEntryValue(entryId, field, event.target.value, false);
    });
    document.getElementById('rulesTableBody').addEventListener('change', (event) => {
        const field = event.target.dataset.ruleField;
        const entryId = Number(event.target.dataset.ruleId);
        if (field && entryId) {
            setRuleEntryValue(entryId, field, event.target.value, true);
            return;
        }
        if (event.target.dataset.ruleSelect) {
            const entryId = Number(event.target.dataset.ruleSelect);
            if (event.target.checked) {
                state.rulesManager.selectedIds.add(entryId);
            } else {
                state.rulesManager.selectedIds.delete(entryId);
            }
            renderRulesTable();
        }
    });
    document.getElementById('rulesTableBody').addEventListener('click', (event) => {
        const deleteId = Number(event.target.dataset.ruleDelete);
        if (!deleteId) {
            return;
        }
        deleteRuleEntry(deleteId);
    });

    document.getElementById('uploadFileButton').addEventListener('click', uploadFile);
    document.getElementById('renameFileButton').addEventListener('click', renameSelectedFile);
    document.getElementById('deleteFileButton').addEventListener('click', deleteSelectedFile);
    document.getElementById('openUploadsFolderButton').addEventListener('click', () => openStorageFolder('openUploadsFolder', 'fileStatus', 'Uploads-Ordner geöffnet'));
    document.getElementById('openDataFolderFromFilesButton').addEventListener('click', () => openStorageFolder('openDataFolder', 'fileStatus', 'Datenordner geöffnet'));
    document.getElementById('saveFileButton').addEventListener('click', saveCurrentFile);
    document.getElementById('fileEditor').addEventListener('input', () => {
        markEditorDirty(document.getElementById('fileEditor').value !== state.selectedFileContent);
    });
    document.getElementById('uploadCategoryInput').addEventListener('input', syncUploadCategoryMode);
    document.getElementById('uploadCategorySelect').addEventListener('change', () => {
        if (getCustomSelectValue('uploadCategorySelect')) {
            document.getElementById('uploadCategoryInput').value = '';
        }
        setUploadCategoryValidation('');
        updateUploadDecisionPreview();
    });
    document.getElementById('uploadRulesetSelect').addEventListener('change', updateUploadDecisionPreview);

    window.addEventListener('resize', () => {
        scheduleDashboardRefresh(false);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    new QWebChannel(qt.webChannelTransport, async (channel) => {
        window.backend = channel.objects.backend;
        initializeModal();
        initializeCustomSelects();
        initializeDatePickers();
        bindEvents();
        resetUploadWorkflowState();
        await setActiveView('dashboard');
        await loadStorageInfo();
        await refreshAllData();
        await loadRulesEditor();
        setStatus('fileStatus', 'Dateien können lokal hochgeladen, bearbeitet und gespeichert werden.', 'info');
        setStatus('uploadStatus', 'CSV-Dateien können hier analysiert und als JSON in uploads gespeichert werden.', 'info');
    });
});
