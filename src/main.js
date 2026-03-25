const { invoke } = window.__TAURI__.core;

// 默认快捷发送列表
const DEFAULT_QUICK_SEND_LIST = [
    {
        name: 'AT指令',
        list: [
            { name: '测试', content: 'AT', hex: false },
            { name: '重启', content: 'AT+RST', hex: false },
            { name: '版本', content: 'AT+GMR', hex: false },
        ]
    }
];

class SerialCom {
    constructor() {
        this.serialPort = null;
        this.isConnected = false;
        this.readInterval = null;
        this.loopSendTimer = null;

        // 数据包合并相关
        this.serialData = [];
        this.packetTimer = null;

        // 工具选项
        this.toolOptions = this.loadToolOptions();

        // 快捷发送列表
        this.quickSendList = this.loadQuickSendList();
        this.currentQuickGroup = 0;

        // 重命名回调
        this.renameCallback = null;

        // 选择回调
        this.choiceCallback = null;

        this.initElements();
        this.bindEvents();
        this.applyToolOptions();
        this.refreshPorts();
        this.initQuickSend();
    }

    initElements() {
        // 串口配置
        this.portSelect = document.getElementById('port-select');
        this.baudRate = document.getElementById('baud-rate');
        this.dataBits = document.getElementById('data-bits');
        this.stopBits = document.getElementById('stop-bits');
        this.parity = document.getElementById('parity');
        this.connectBtn = document.getElementById('connect-btn');
        this.refreshBtn = document.getElementById('refresh-ports');

        // 日志显示
        this.receiveData = document.getElementById('serial-logs');
        this.packetTimeout = document.getElementById('packet-timeout');
        this.logType = document.getElementById('log-type');
        this.autoScrollBtn = document.getElementById('auto-scroll');
        this.clearReceive = document.getElementById('clear-receive');
        this.copyLog = document.getElementById('copy-log');
        this.saveLog = document.getElementById('save-log');

        // 发送相关
        this.addData = document.getElementById('add-crlf');
        this.hexSend = document.getElementById('hex-send');
        this.loopSend = document.getElementById('loop-send');
        this.loopInterval = document.getElementById('loop-interval');
        this.sendData = document.getElementById('send-data');
        this.sendBtn = document.getElementById('send-btn');

        // 状态显示
        this.statusDisplay = document.getElementById('serial-status');

        // 快捷发送
        this.quickSendGroup = document.getElementById('quick-send-group');
        this.quickSendListEl = document.getElementById('quick-send-list');
        this.addGroup = document.getElementById('add-group');
        this.renameGroup = document.getElementById('rename-group');
        this.removeGroup = document.getElementById('remove-group');
        this.addQuickItemBtn = document.getElementById('add-quick-item');
        this.importQuick = document.getElementById('import-quick');
        this.exportQuick = document.getElementById('export-quick');
        this.importFile = document.getElementById('import-file');

        // 设置
        this.resetSettings = document.getElementById('reset-settings');
        this.exportSettings = document.getElementById('export-settings');
        this.importSettings = document.getElementById('import-settings');
        this.settingsFile = document.getElementById('settings-file');

        // 侧边栏切换
        this.leftSidebar = document.getElementById('serial-options');
        this.rightSidebar = document.getElementById('serial-tools');
        this.toggleLeftBtn = document.getElementById('toggle-left-sidebar');
        this.toggleRightBtn = document.getElementById('toggle-right-sidebar');

        // 标签页
        this.navTabs = document.querySelectorAll('.nav-tab');
        this.tabPanes = document.querySelectorAll('.tab-pane');

        // 模态框
        this.renameModal = document.getElementById('rename-modal');
        this.alertModal = document.getElementById('alert-modal');
        this.choiceModal = document.getElementById('choice-modal');
        this.renameInput = document.getElementById('rename-input');
        this.alertMessage = document.getElementById('alert-message');
        this.choiceMessage = document.getElementById('choice-message');
        this.choiceTitle = document.getElementById('choice-title');

        // 搜索相关
        this.searchBar = document.getElementById('log-search-bar');
        this.searchInput = document.getElementById('search-input');
        this.searchCount = document.getElementById('search-count');
        this.searchPrev = document.getElementById('search-prev');
        this.searchNext = document.getElementById('search-next');
        this.searchCase = document.getElementById('search-case');
        this.searchClose = document.getElementById('search-close');

        // 过滤相关
        this.filterToggle = document.getElementById('filter-toggle');
        this.filterInput = document.getElementById('filter-input');

        // 搜索状态
        this.searchResults = [];
        this.currentSearchIndex = -1;
        this.searchCaseSensitive = false;
        this.originalLogContent = null;

        // 过滤状态
        this.isFilterActive = false;
    }

    bindEvents() {
        // 串口控制
        this.refreshBtn.addEventListener('click', () => this.refreshPorts());
        this.connectBtn.addEventListener('click', () => this.toggleConnection());

        // 日志选项
        this.packetTimeout.addEventListener('change', () => this.saveToolOptions());
        this.logType.addEventListener('change', () => {
            this.toolOptions.logType = this.logType.value;
            this.saveToolOptions();
        });
        this.autoScrollBtn.addEventListener('click', () => this.toggleAutoScroll());
        this.clearReceive.addEventListener('click', () => this.clearReceiveData());
        this.copyLog.addEventListener('click', () => this.copyLogToClipboard());
        this.saveLog.addEventListener('click', () => this.saveLogToFile());

        // 发送选项
        this.addData.addEventListener('change', () => this.saveToolOptions());
        this.hexSend.addEventListener('change', () => {
            this.saveToolOptions();
        });
        this.loopSend.addEventListener('change', () => {
            this.saveToolOptions();
            this.resetLoopSend();
        });
        this.loopInterval.addEventListener('change', () => {
            this.saveToolOptions();
            this.resetLoopSend();
        });
        this.sendBtn.addEventListener('click', () => this.sendDataButton());
        this.sendData.addEventListener('input', () => {
            this.saveToolOptions();
        });
        this.sendData.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                this.sendDataButton();
            }
        });

        // 快捷发送
        this.addGroup.addEventListener('click', () => this.addQuickGroup());
        this.renameGroup.addEventListener('click', () => this.renameQuickGroup());
        this.removeGroup.addEventListener('click', () => this.removeQuickGroup());
        this.addQuickItemBtn.addEventListener('click', () => this.addQuickItem());
        this.importQuick.addEventListener('click', () => this.importFile.click());
        this.exportQuick.addEventListener('click', () => this.exportQuickList());
        this.importFile.addEventListener('change', (e) => this.importQuickList(e));
        this.quickSendGroup.addEventListener('change', () => this.switchQuickGroup());

        // 设置
        this.resetSettings.addEventListener('click', () => this.resetAllSettings());
        this.exportSettings.addEventListener('click', () => this.exportAllSettings());
        this.importSettings.addEventListener('click', () => this.settingsFile.click());
        this.settingsFile.addEventListener('change', (e) => this.importAllSettings(e));

        // 侧边栏切换
        this.toggleLeftBtn.addEventListener('click', () => this.toggleSidebar(this.leftSidebar));
        this.toggleRightBtn.addEventListener('click', () => this.toggleSidebar(this.rightSidebar));

        // 标签页切换
        this.navTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // 模态框
        document.getElementById('close-rename-modal').addEventListener('click', () => this.closeRenameModal());
        document.getElementById('cancel-rename').addEventListener('click', () => this.closeRenameModal());
        document.getElementById('confirm-rename').addEventListener('click', () => this.confirmRename());
        document.getElementById('close-alert-modal').addEventListener('click', () => this.closeAlertModal());
        document.getElementById('confirm-alert').addEventListener('click', () => this.closeAlertModal());
        document.getElementById('close-choice-modal').addEventListener('click', () => this.closeChoiceModal());
        document.getElementById('choice-cancel').addEventListener('click', () => this.closeChoiceModal());
        document.getElementById('choice-option1').addEventListener('click', () => this.confirmChoice(1));
        document.getElementById('choice-option2').addEventListener('click', () => this.confirmChoice(2));

        // 搜索功能
        this.searchInput.addEventListener('input', () => this.performSearch());
        this.searchPrev.addEventListener('click', () => this.navigateSearch(-1));
        this.searchNext.addEventListener('click', () => this.navigateSearch(1));
        this.searchCase.addEventListener('click', () => this.toggleCaseSensitive());
        this.searchClose.addEventListener('click', () => this.closeSearch());
        this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));

        // 过滤功能
        this.filterToggle.addEventListener('click', () => this.toggleFilter());
        this.filterInput.addEventListener('input', () => {
            this.applyFilter();
            this.autoResizeInput(this.filterInput);
        });
        // 初始化输入框宽度
        this.autoResizeInput(this.filterInput);
    }

    autoResizeInput(input) {
        if (!input.value) {
            input.style.width = '60px';
            return;
        }
        // 创建临时span计算文本宽度
        const span = document.createElement('span');
        span.style.cssText = `
            position: absolute;
            visibility: hidden;
            white-space: pre;
            font-family: ${getComputedStyle(input).fontFamily};
            font-size: ${getComputedStyle(input).fontSize};
            padding: 0 4px;
        `;
        span.textContent = input.value;
        document.body.appendChild(span);
        const width = span.offsetWidth;
        document.body.removeChild(span);
        // 设置宽度（加一些padding）
        input.style.width = Math.min(Math.max(width + 16, 60), 200) + 'px';
    }

    // ========== 侧边栏切换 ==========
    toggleSidebar(sidebar) {
        sidebar.classList.toggle('collapsed');
    }

    // ========== 配置持久化 ==========
    loadToolOptions() {
        const saved = localStorage.getItem('toolOptions');
        return saved ? JSON.parse(saved) : {
            packetTimeout: 50,
            logType: 'hex&text',
            autoScroll: true,
            addCRLF: false,
            hexSend: false,
            loopSend: false,
            loopInterval: 1000,
            sendContent: '',
            quickSendIndex: 0
        };
    }

    saveToolOptions() {
        this.toolOptions.packetTimeout = parseInt(this.packetTimeout.value) || 0;
        this.toolOptions.logType = this.logType.value;
        this.toolOptions.addCRLF = this.addData.checked;
        this.toolOptions.hexSend = this.hexSend.checked;
        this.toolOptions.loopSend = this.loopSend.checked;
        this.toolOptions.loopInterval = parseInt(this.loopInterval.value) || 1000;
        this.toolOptions.sendContent = this.sendData.value;
        this.toolOptions.quickSendIndex = this.currentQuickGroup;
        localStorage.setItem('toolOptions', JSON.stringify(this.toolOptions));
    }

    applyToolOptions() {
        this.packetTimeout.value = this.toolOptions.packetTimeout || 50;
        this.logType.value = this.toolOptions.logType || 'hex&text';
        this.addData.checked = this.toolOptions.addCRLF || false;
        this.hexSend.checked = this.toolOptions.hexSend || false;
        this.loopSend.checked = this.toolOptions.loopSend || false;
        this.loopInterval.value = this.toolOptions.loopInterval || 1000;
        this.sendData.value = this.toolOptions.sendContent || '';
        this.currentQuickGroup = this.toolOptions.quickSendIndex || 0;
        this.updateAutoScrollBtn();
    }

    loadSerialOptions() {
        const saved = localStorage.getItem('serialOptions');
        if (saved) {
            const opts = JSON.parse(saved);
            this.baudRate.value = opts.baudRate || 115200;
            this.dataBits.value = opts.dataBits || 8;
            this.stopBits.value = opts.stopBits || 1;
            this.parity.value = opts.parity || 'None';
        }
    }

    saveSerialOptions() {
        const opts = {
            baudRate: parseInt(this.baudRate.value),
            dataBits: parseInt(this.dataBits.value),
            stopBits: parseInt(this.stopBits.value),
            parity: this.parity.value
        };
        localStorage.setItem('serialOptions', JSON.stringify(opts));
    }

    loadQuickSendList() {
        const saved = localStorage.getItem('quickSendList');
        return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_QUICK_SEND_LIST));
    }

    saveQuickSendList() {
        localStorage.setItem('quickSendList', JSON.stringify(this.quickSendList));
    }

    // ========== 串口控制 ==========
    async refreshPorts() {
        try {
            this.portSelect.innerHTML = '<option value="">扫描中...</option>';
            const ports = await invoke('list_ports');
            this.updatePortList(ports);
        } catch (error) {
            console.error('刷新串口列表失败:', error);
            this.portSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '获取串口列表失败';
            this.portSelect.appendChild(option);
            this.showAlert('刷新串口列表失败: ' + (error.message || error));
        }
    }

    updatePortList(ports) {
        const currentValue = this.portSelect.value;
        this.portSelect.innerHTML = '';

        if (!ports || ports.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '未检测到串口';
            this.portSelect.appendChild(option);
        } else {
            ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port.port_name || port;

                let optionText = port.port_name;
                const details = [];
                // if (port.manufacturer) details.push(port.manufacturer);
                if (port.product) details.push(port.product);
                if (details.length > 0) optionText += ' - ' + details.join(' ');
                option.textContent = optionText;

                const fullDetails = [];
                if (port.manufacturer) fullDetails.push(`厂商: ${port.manufacturer}`);
                if (port.product) fullDetails.push(`产品: ${port.product}`);
                if (port.vid != null && port.pid != null) {
                    fullDetails.push(`VID: ${port.vid.toString(16).toUpperCase().padStart(4, '0')}`);
                    fullDetails.push(`PID: ${port.pid.toString(16).toUpperCase().padStart(4, '0')}`);
                }
                if (port.serial_number) fullDetails.push(`序列号: ${port.serial_number}`);
                if (fullDetails.length > 0) option.title = fullDetails.join('\n');

                this.portSelect.appendChild(option);
            });

            if (currentValue && Array.from(this.portSelect.options).some(o => o.value === currentValue)) {
                this.portSelect.value = currentValue;
            }
        }
    }

    async toggleConnection() {
        if (this.isConnected) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    }

    async connect() {
        const portName = this.portSelect.value;
        if (!portName) {
            this.showAlert('请选择串口');
            return;
        }

        const config = {
            baud_rate: parseInt(this.baudRate.value),
            data_bits: parseInt(this.dataBits.value),
            stop_bits: parseInt(this.stopBits.value),
            parity: this.parity.value === 'None' ? 0 : (this.parity.value === 'Odd' ? 1 : 2)
        };

        try {
            const result = await invoke('open_port', { portName: portName, config: config });

            if (result.success) {
                this.isConnected = true;
                this.saveSerialOptions();
                this.updateConnectionStatus();
                this.startReading();

                this.portSelect.disabled = true;
                this.baudRate.disabled = true;
                this.dataBits.disabled = true;
                this.stopBits.disabled = true;
                this.parity.disabled = true;
                this.connectBtn.textContent = '关闭串口';
                this.connectBtn.classList.remove('btn-primary');
                this.connectBtn.classList.add('btn-danger');
            } else {
                this.showAlert(result.message);
            }
        } catch (error) {
            console.error('打开串口失败:', error);
            this.showAlert('打开串口失败: ' + (error.message || error));
        }
    }

    async disconnect() {
        try {
            if (this.readInterval) {
                clearInterval(this.readInterval);
                this.readInterval = null;
            }
            if (this.loopSendTimer) {
                clearInterval(this.loopSendTimer);
                this.loopSendTimer = null;
            }
            clearTimeout(this.packetTimer);
            this.serialData = [];

            const result = await invoke('close_port');

            if (result.success) {
                this.isConnected = false;
                this.updateConnectionStatus();

                this.portSelect.disabled = false;
                this.baudRate.disabled = false;
                this.dataBits.disabled = false;
                this.stopBits.disabled = false;
                this.parity.disabled = false;
                this.connectBtn.textContent = '打开串口';
                this.connectBtn.classList.remove('btn-danger');
                this.connectBtn.classList.add('btn-primary');
            }
        } catch (error) {
            console.error('关闭串口失败:', error);
            this.showAlert('关闭串口失败: ' + (error.message || error));
        }
    }

    updateConnectionStatus() {
        if (this.isConnected) {
            this.statusDisplay.innerHTML = '<div class="alert alert-success">设备已连接</div>';
        } else {
            this.statusDisplay.innerHTML = '<div class="alert alert-info">未选择串口</div>';
        }
    }

    // ========== 数据接收与分包 ==========
    startReading() {
        if (!this.isConnected) return;

        this.readInterval = setInterval(async () => {
            try {
                const data = await invoke('read_port');
                if (data) {
                    const bytes = Array.from(data).map(c => c.charCodeAt(0));
                    this.dataReceived(bytes);
                }
            } catch (error) {
                // 忽略读取时的暂时性错误
            }
        }, 50);
    }

    dataReceived(data) {
        this.serialData.push(...data);

        const timeout = parseInt(this.packetTimeout.value) || 0;

        if (timeout === 0) {
            // 不分包，立即显示
            this.addLogEntry(this.serialData, true);
            this.serialData = [];
            return;
        }

        // 分包合并
        clearTimeout(this.packetTimer);
        this.packetTimer = setTimeout(() => {
            this.addLogEntry(this.serialData, true);
            this.serialData = [];
        }, timeout);
    }

    addLogEntry(data, isReceive) {
        const time = this.formatTime(new Date());
        const logType = this.logType.value;
        const lineClass = isReceive ? 'log-line-receive' : 'log-line-send';

        let html = `<div class="log-line ${lineClass}">`;

        if (logType.includes('hex')) {
            const hex = data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
            html += `<span class="log-time">${time}</span> <span class="${isReceive ? 'log-receive' : 'log-send'}">${isReceive ? '←' : '→'}</span> <span class="log-hex">HEX: ${this.escapeHtml(hex)}</span>`;
        }

        if (logType.includes('text')) {
            const text = new TextDecoder().decode(new Uint8Array(data));
            if (logType.includes('hex')) {
                html += `\n<span class="log-text">TEXT: ${this.formatLogText(text, isReceive)}</span>`;
            } else {
                html += `<span class="log-time">${time}</span> <span class="${isReceive ? 'log-receive' : 'log-send'}">${isReceive ? '←' : '→'}</span> <span class="log-text">${this.formatLogText(text, isReceive)}</span>`;
            }
        }

        html += '</div>\n';

        this.receiveData.insertAdjacentHTML('beforeend', html);

        // 如果过滤器开启，检查新日志是否匹配
        if (this.isFilterActive) {
            const newLine = this.receiveData.lastElementChild;
            this.filterLogLine(newLine);
        }

        if (this.toolOptions.autoScroll) {
            this.receiveData.scrollTop = this.receiveData.scrollHeight;
        }
    }

    formatLogText(text, isReceive) {
        if (!isReceive) {
            // 发送数据保持原样
            return this.escapeHtml(text);
        }
        // 接收数据：区分数字和符号
        let result = '';
        for (const char of text) {
            const escaped = this.escapeHtml(char);
            if (/[0-9]/.test(char)) {
                // 数字
                result += `<span class="log-digit">${escaped}</span>`;
            } else if (/[+\-*/=<>.,:;!?@#$%^&*()\[\]{}|\\\/"'`~]/.test(char)) {
                // 符号
                result += `<span class="log-symbol">${escaped}</span>`;
            } else {
                // 其他字符（字母、空格、换行等）
                result += escaped;
            }
        }
        return result;
    }

    addErrorLog(message) {
        const time = this.formatTime(new Date());
        const html = `<div class="log-line log-line-error"><span class="log-time">${time}</span> <span class="log-error">系统消息</span> ${this.escapeHtml(message)}</div>\n`;
        this.receiveData.insertAdjacentHTML('beforeend', html);

        if (this.toolOptions.autoScroll) {
            this.receiveData.scrollTop = this.receiveData.scrollHeight;
        }
    }

    formatTime(date) {
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        const s = date.getSeconds().toString().padStart(2, '0');
        const ms = date.getMilliseconds().toString().padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== 发送数据 ==========
    async sendDataButton() {
        if (!this.isConnected) {
            this.showAlert('请先打开串口');
            return;
        }

        const data = this.sendData.value.trim();
        if (!data) {
            this.showAlert('请输入要发送的数据');
            return;
        }

        try {
            if (this.hexSend.checked) {
                await this.sendHex(data);
            } else {
                await this.sendText(data);
            }

            if (!this.loopSend.checked) {
                this.sendData.value = '';
            }
        } catch (error) {
            console.error('发送数据失败:', error);
            this.showAlert('发送数据失败: ' + (error.message || error));
        }
    }

    async sendText(text) {
        let data = text;
        if (this.addData.checked) {
            data += '\r\n';
        }

        const result = await invoke('write_port', { data: data });
        if (result.success) {
            const bytes = Array.from(new TextEncoder().encode(data));
            this.addLogEntry(bytes, false);
        } else {
            this.showAlert(result.message);
        }
    }

    async sendHex(hex) {
        const cleanHex = hex.replace(/\s+/g, '');
        if (!/^[0-9A-Fa-f]+$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
            this.showAlert('无效的十六进制数据');
            return;
        }

        const bytes = [];
        for (let i = 0; i < cleanHex.length; i += 2) {
            bytes.push(parseInt(cleanHex.substr(i, 2), 16));
        }

        if (this.addData.checked) {
            bytes.push(0x0D, 0x0A);
        }

        const result = await invoke('write_port_hex', { hexData: cleanHex });
        if (result.success) {
            this.addLogEntry(bytes, false);
        } else {
            this.showAlert(result.message);
        }
    }

    resetLoopSend() {
        if (this.loopSendTimer) {
            clearInterval(this.loopSendTimer);
            this.loopSendTimer = null;
        }

        if (this.loopSend.checked && this.isConnected) {
            const interval = parseInt(this.loopInterval.value) || 1000;
            this.loopSendTimer = setInterval(() => {
                this.sendDataButton();
            }, interval);
        }
    }

    // ========== 日志操作 ==========
    clearReceiveData() {
        this.receiveData.innerHTML = '';
    }

    toggleAutoScroll() {
        this.toolOptions.autoScroll = !this.toolOptions.autoScroll;
        this.saveToolOptions();
        this.updateAutoScrollBtn();
    }

    updateAutoScrollBtn() {
        if (this.toolOptions.autoScroll) {
            this.autoScrollBtn.classList.add('active');
        } else {
            this.autoScrollBtn.classList.remove('active');
        }
    }

    async copyLogToClipboard() {
        const text = this.receiveData.textContent;
        if (!text) {
            this.showAlert('没有可复制的内容');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            this.showAlert('已复制到剪贴板');
        } catch (error) {
            this.showAlert('复制失败: ' + error.message);
        }
    }

    async saveLogToFile() {
        const text = this.receiveData.textContent;
        if (!text) {
            this.showAlert('没有可导出的内容');
            return;
        }

        try {
            if (!window.__TAURI__?.dialog?.save) {
                this.showAlert('导出失败: Tauri dialog API 不可用');
                return;
            }
            if (!window.__TAURI__?.fs?.writeTextFile) {
                this.showAlert('导出失败: Tauri fs API 不可用');
                return;
            }

            const filePath = await window.__TAURI__.dialog.save({
                defaultPath: `serial_log_${Date.now()}.txt`,
                filters: [{ name: 'Text', extensions: ['txt'] }]
            });

            if (filePath) {
                await window.__TAURI__.fs.writeTextFile(filePath, text);
                this.showAlert('导出成功');
            }
        } catch (error) {
            this.showAlert('导出失败: ' + (error.message || error));
        }
    }

    // ========== 快捷发送 ==========
    initQuickSend() {
        this.updateGroupSelect();
        this.switchQuickGroup();
    }

    updateGroupSelect() {
        this.quickSendGroup.innerHTML = '';
        this.quickSendList.forEach((group, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = group.name;
            this.quickSendGroup.appendChild(option);
        });
        this.quickSendGroup.value = this.currentQuickGroup;
    }

    switchQuickGroup() {
        this.currentQuickGroup = parseInt(this.quickSendGroup.value);
        this.saveToolOptions();
        this.renderQuickSendItems();
    }

    renderQuickSendItems() {
        const list = this.quickSendList[this.currentQuickGroup].list;
        this.quickSendListEl.innerHTML = '';

        list.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'quick-send-item';
            div.innerHTML = `
                <button class="quick-send-remove" title="移除该项" data-index="${index}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
                <input type="text" class="quick-send-content" value="${this.escapeHtml(item.content)}" placeholder="要发送的内容,双击改名" data-index="${index}">
                <button class="quick-send-name" title="${this.escapeHtml(item.name)}" data-index="${index}">${this.escapeHtml(item.name)}</button>
                <input type="checkbox" class="quick-send-hex" ${item.hex ? 'checked' : ''} data-index="${index}">
            `;
            this.quickSendListEl.appendChild(div);
        });

        // 绑定事件
        this.quickSendListEl.querySelectorAll('.quick-send-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this.removeQuickItem(index);
            });
        });

        this.quickSendListEl.querySelectorAll('.quick-send-content').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.quickSendList[this.currentQuickGroup].list[index].content = e.target.value;
                this.saveQuickSendList();
            });
        });

        this.quickSendListEl.querySelectorAll('.quick-send-hex').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                this.quickSendList[this.currentQuickGroup].list[index].hex = e.target.checked;
                this.saveQuickSendList();
            });
        });

        this.quickSendListEl.querySelectorAll('.quick-send-name').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                // 使用延迟区分单击和双击
                if (this._clickTimer) {
                    clearTimeout(this._clickTimer);
                    this._clickTimer = null;
                    // 双击时重命名
                    this.renameQuickItem(index);
                } else {
                    this._clickTimer = setTimeout(() => {
                        this._clickTimer = null;
                        // 单击时发送
                        this.sendQuickItem(index);
                    }, 250);
                }
            });
        });
    }

    addQuickGroup() {
        this.showRenameDialog((name) => {
            this.quickSendList.push({ name: name, list: [] });
            this.saveQuickSendList();
            this.updateGroupSelect();
            this.quickSendGroup.value = this.quickSendList.length - 1;
            this.switchQuickGroup();
        }, '新分组');
    }

    renameQuickGroup() {
        if (this.quickSendList.length <= 1) {
            this.showAlert('至少保留一个分组');
            return;
        }
        const group = this.quickSendList[this.currentQuickGroup];
        this.showRenameDialog((name) => {
            group.name = name;
            this.saveQuickSendList();
            this.updateGroupSelect();
        }, group.name);
    }

    removeQuickGroup() {
        if (this.quickSendList.length <= 1) {
            this.showAlert('至少保留一个分组');
            return;
        }
        this.showConfirmDialog((confirmed) => {
            if (confirmed) {
                this.quickSendList.splice(this.currentQuickGroup, 1);
                this.saveQuickSendList();
                this.currentQuickGroup = 0;
                this.updateGroupSelect();
                this.switchQuickGroup();
            }
        }, '是否删除该分组?', '删除分组', '删除');
    }

    addQuickItem() {
        const item = { name: '发送', content: '', hex: false };
        this.quickSendList[this.currentQuickGroup].list.push(item);
        this.saveQuickSendList();
        this.renderQuickSendItems();
    }

    removeQuickItem(index) {
        this.quickSendList[this.currentQuickGroup].list.splice(index, 1);
        this.saveQuickSendList();
        this.renderQuickSendItems();
    }

    renameQuickItem(index) {
        const item = this.quickSendList[this.currentQuickGroup].list[index];
        this.showRenameDialog((name) => {
            item.name = name;
            this.saveQuickSendList();
            this.renderQuickSendItems();
        }, item.name);
    }

    async sendQuickItem(index) {
        if (!this.isConnected) {
            this.showAlert('请先打开串口');
            return;
        }

        const item = this.quickSendList[this.currentQuickGroup].list[index];
        if (!item.content) {
            this.showAlert('发送内容为空');
            return;
        }

        try {
            if (item.hex) {
                await this.sendHex(item.content);
            } else {
                await this.sendText(item.content);
            }
        } catch (error) {
            this.showAlert('发送失败: ' + error.message);
        }
    }

    async exportQuickList() {
        try {
            // 检查 Tauri API 是否可用
            if (!window.__TAURI__?.dialog?.save) {
                this.showAlert('导出失败: Tauri dialog API 不可用');
                return;
            }
            if (!window.__TAURI__?.fs?.writeTextFile) {
                this.showAlert('导出失败: Tauri fs API 不可用');
                return;
            }

            // 导出所有分组
            const data = JSON.stringify(this.quickSendList, null, 2);

            const filePath = await window.__TAURI__.dialog.save({
                defaultPath: `quick_send_all.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (filePath) {
                await window.__TAURI__.fs.writeTextFile(filePath, data);
                this.showAlert('导出成功');
            }
        } catch (error) {
            this.showAlert('导出失败: ' + (error.message || error));
        }
    }

    importQuickList(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);

                // 检查是否是完整的分组列表（数组且第一项有name和list属性）
                const isFullList = Array.isArray(imported) && imported.length > 0 && imported[0].name && imported[0].list;

                if (isFullList) {
                    // 完整分组列表，询问覆盖或合并
                    this.showChoiceDialog((choice) => {
                        if (choice === 1) {
                            // 覆盖
                            this.quickSendList = imported;
                        } else if (choice === 2) {
                            // 合并
                            this.quickSendList.push(...imported);
                        }
                        this.saveQuickSendList();
                        this.currentQuickGroup = 0;
                        this.updateGroupSelect();
                        this.switchQuickGroup();
                        this.showAlert('导入成功');
                    }, '检测到完整分组数据，请选择导入方式：', '导入选项', '覆盖', '合并');
                } else if (Array.isArray(imported)) {
                    // 旧格式：单个分组的列表，合并到当前分组
                    this.quickSendList[this.currentQuickGroup].list.push(...imported);
                    this.saveQuickSendList();
                    this.renderQuickSendItems();
                    this.showAlert('导入成功（合并到当前分组）');
                } else {
                    this.showAlert('导入失败: 无效的数据格式');
                }
            } catch (error) {
                this.showAlert('导入失败: ' + error.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // ========== 设置管理 ==========
    resetAllSettings() {
        this.showConfirmDialog((confirmed) => {
            if (confirmed) {
                localStorage.removeItem('serialOptions');
                localStorage.removeItem('toolOptions');
                localStorage.removeItem('quickSendList');
                location.reload();
            }
        }, '是否重置所有参数?', '重置参数', '重置');
    }

    async exportAllSettings() {
        const data = {
            serialOptions: localStorage.getItem('serialOptions'),
            toolOptions: localStorage.getItem('toolOptions'),
            quickSendList: localStorage.getItem('quickSendList')
        };

        try {
            if (!window.__TAURI__?.dialog?.save) {
                this.showAlert('导出失败: Tauri dialog API 不可用');
                return;
            }
            if (!window.__TAURI__?.fs?.writeTextFile) {
                this.showAlert('导出失败: Tauri fs API 不可用');
                return;
            }

            const filePath = await window.__TAURI__.dialog.save({
                defaultPath: 'lcom_settings.json',
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (filePath) {
                await window.__TAURI__.fs.writeTextFile(filePath, JSON.stringify(data, null, 2));
                this.showAlert('导出成功');
            }
        } catch (error) {
            this.showAlert('导出失败: ' + (error.message || error));
        }
    }

    importAllSettings(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.serialOptions) localStorage.setItem('serialOptions', data.serialOptions);
                if (data.toolOptions) localStorage.setItem('toolOptions', data.toolOptions);
                if (data.quickSendList) localStorage.setItem('quickSendList', data.quickSendList);
                this.showAlert('导入成功，即将刷新页面');
                setTimeout(() => location.reload(), 500);
            } catch (error) {
                this.showAlert('导入失败: ' + error.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // ========== 标签页切换 ==========
    switchTab(tabName) {
        this.navTabs.forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        this.tabPanes.forEach(pane => {
            if (pane.id === tabName) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });
    }

    // ========== 模态框 ==========
    showRenameDialog(callback, defaultValue = '') {
        this.renameCallback = callback;
        this.renameInput.value = defaultValue;
        this.renameModal.style.display = 'flex';
        this.renameInput.focus();
        this.renameInput.select();
    }

    closeRenameModal() {
        this.renameModal.style.display = 'none';
        this.renameCallback = null;
    }

    confirmRename() {
        const name = this.renameInput.value.trim();
        if (name && this.renameCallback) {
            this.renameCallback(name);
        }
        this.closeRenameModal();
    }

    showAlert(message) {
        this.alertMessage.textContent = message;
        this.alertModal.style.display = 'flex';
    }

    closeAlertModal() {
        this.alertModal.style.display = 'none';
    }

    showChoiceDialog(callback, message, title = '选择', option1Text = '确定', option2Text = '取消') {
        this.choiceCallback = callback;
        this.choiceTitle.textContent = title;
        this.choiceMessage.textContent = message;
        document.getElementById('choice-option1').textContent = option1Text;
        document.getElementById('choice-option2').textContent = option2Text;
        document.getElementById('choice-option2').style.display = 'inline-block';
        document.getElementById('choice-cancel').style.display = 'none';
        this.choiceModal.style.display = 'flex';
    }

    showConfirmDialog(callback, message, title = '确认', confirmText = '确定') {
        this.choiceCallback = callback;
        this.choiceTitle.textContent = title;
        this.choiceMessage.textContent = message;
        document.getElementById('choice-option1').textContent = confirmText;
        document.getElementById('choice-option2').style.display = 'none';
        document.getElementById('choice-cancel').style.display = 'inline-block';
        this.choiceModal.style.display = 'flex';
    }

    closeChoiceModal() {
        this.choiceModal.style.display = 'none';
        this.choiceCallback = null;
    }

    confirmChoice(option) {
        if (this.choiceCallback) {
            this.choiceCallback(option);
        }
        this.closeChoiceModal();
    }

    initKeyboardShortcuts() {
        this.renameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirmRename();
            } else if (e.key === 'Escape') {
                this.closeRenameModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.alertModal.style.display === 'flex') {
                this.closeAlertModal();
            }
            // Ctrl+F 打开搜索
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                this.openSearch();
            }
            // ESC 关闭搜索
            if (e.key === 'Escape' && this.searchBar.style.display === 'flex') {
                this.closeSearch();
            }
        });
    }

    // ========== 搜索功能 ==========
    openSearch() {
        this.searchBar.style.display = 'flex';
        this.searchInput.focus();
        this.searchInput.select();
    }

    closeSearch() {
        this.searchBar.style.display = 'none';
        this.clearSearchHighlight();
        this.searchInput.value = '';
        this.searchResults = [];
        this.currentSearchIndex = -1;
        this.updateSearchCount();
    }

    toggleCaseSensitive() {
        this.searchCaseSensitive = !this.searchCaseSensitive;
        this.searchCase.classList.toggle('active', this.searchCaseSensitive);
        this.performSearch();
    }

    // ========== 过滤功能 ==========
    toggleFilter() {
        this.isFilterActive = !this.isFilterActive;
        this.filterToggle.classList.toggle('active', this.isFilterActive);

        if (this.isFilterActive) {
            this.applyFilter();
        } else {
            this.clearFilter();
        }
    }

    applyFilter() {
        const keyword = this.filterInput.value.trim();
        const logLines = this.receiveData.querySelectorAll('.log-line');

        if (!keyword) {
            // 没有关键词时显示所有
            logLines.forEach(line => {
                line.classList.remove('log-line-hidden');
            });
            return;
        }

        try {
            const regex = new RegExp(this.escapeRegex(keyword), 'i');

            logLines.forEach(line => {
                const text = line.textContent;
                if (regex.test(text)) {
                    line.classList.remove('log-line-hidden');
                } else {
                    line.classList.add('log-line-hidden');
                }
            });
        } catch (e) {
            // 无效的正则表达式，显示所有
            logLines.forEach(line => {
                line.classList.remove('log-line-hidden');
            });
        }
    }

    filterLogLine(line) {
        const keyword = this.filterInput.value.trim();
        if (!keyword) {
            line.classList.remove('log-line-hidden');
            return;
        }

        try {
            const regex = new RegExp(this.escapeRegex(keyword), 'i');
            const text = line.textContent;
            if (regex.test(text)) {
                line.classList.remove('log-line-hidden');
            } else {
                line.classList.add('log-line-hidden');
            }
        } catch (e) {
            line.classList.remove('log-line-hidden');
        }
    }

    clearFilter() {
        const logLines = this.receiveData.querySelectorAll('.log-line');
        logLines.forEach(line => {
            line.classList.remove('log-line-hidden');
        });
    }

    handleSearchKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
                this.navigateSearch(-1);
            } else {
                this.navigateSearch(1);
            }
        } else if (e.key === 'Escape') {
            this.closeSearch();
        }
    }

    performSearch() {
        const keyword = this.searchInput.value;
        this.clearSearchHighlight();

        if (!keyword) {
            this.searchResults = [];
            this.currentSearchIndex = -1;
            this.updateSearchCount();
            return;
        }

        // 保存原始内容（用于恢复）
        this.originalLogContent = this.receiveData.innerHTML;

        // 执行搜索和高亮（只在可见日志中搜索）
        this.searchResults = [];
        this.highlightSearchResults(keyword);
        this.updateSearchCount();

        // 跳转到第一个匹配
        if (this.searchResults.length > 0) {
            this.currentSearchIndex = 0;
            this.highlightCurrentMatch();
            this.scrollToCurrentMatch();
        }
    }

    highlightSearchResults(keyword) {
        // 只在可见的日志行中搜索
        const logLines = this.receiveData.querySelectorAll('.log-line:not(.log-line-hidden)');
        const flags = this.searchCaseSensitive ? 'g' : 'gi';

        try {
            const regex = new RegExp(this.escapeRegex(keyword), flags);

            logLines.forEach((line, lineIndex) => {
                this.highlightInElement(line, regex, lineIndex);
            });
        } catch (e) {
            // 无效的正则表达式，忽略
        }
    }

    highlightInElement(element, regex, lineIndex) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];

        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const parent = textNode.parentNode;

            // 跳过已经高亮的节点
            if (parent.classList && (
                parent.classList.contains('search-highlight') ||
                parent.classList.contains('search-highlight-current')
            )) {
                return;
            }

            let match;
            const fragments = [];
            let lastIndex = 0;

            regex.lastIndex = 0;
            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                const highlight = document.createElement('span');
                highlight.className = 'search-highlight';
                highlight.textContent = match[0];
                highlight.dataset.searchIndex = this.searchResults.length;
                fragments.push(highlight);

                this.searchResults.push({
                    element: highlight,
                    lineIndex: lineIndex
                });

                lastIndex = regex.lastIndex;

                // 防止零宽度匹配导致的无限循环
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }

            if (fragments.length > 0) {
                if (lastIndex < text.length) {
                    fragments.push(document.createTextNode(text.slice(lastIndex)));
                }

                const container = document.createDocumentFragment();
                fragments.forEach(f => container.appendChild(f));
                parent.replaceChild(container, textNode);
            }
        });
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    clearSearchHighlight() {
        // 移除高亮 span，恢复原始文本
        const highlights = this.receiveData.querySelectorAll('.search-highlight, .search-highlight-current');
        highlights.forEach(span => {
            const text = document.createTextNode(span.textContent);
            span.parentNode.replaceChild(text, span);
        });

        // 规范化文本节点
        this.receiveData.normalize();
    }

    navigateSearch(direction) {
        if (this.searchResults.length === 0) return;

        // 移除当前高亮
        if (this.currentSearchIndex >= 0 && this.currentSearchIndex < this.searchResults.length) {
            const current = this.searchResults[this.currentSearchIndex];
            current.element.classList.remove('search-highlight-current');
            current.element.classList.add('search-highlight');
        }

        // 计算新索引
        this.currentSearchIndex += direction;
        if (this.currentSearchIndex >= this.searchResults.length) {
            this.currentSearchIndex = 0;
        } else if (this.currentSearchIndex < 0) {
            this.currentSearchIndex = this.searchResults.length - 1;
        }

        this.highlightCurrentMatch();
        this.scrollToCurrentMatch();
        this.updateSearchCount();
    }

    highlightCurrentMatch() {
        if (this.currentSearchIndex >= 0 && this.currentSearchIndex < this.searchResults.length) {
            const current = this.searchResults[this.currentSearchIndex];
            current.element.classList.remove('search-highlight');
            current.element.classList.add('search-highlight-current');
        }
    }

    scrollToCurrentMatch() {
        if (this.currentSearchIndex >= 0 && this.currentSearchIndex < this.searchResults.length) {
            const current = this.searchResults[this.currentSearchIndex];
            current.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    updateSearchCount() {
        const total = this.searchResults.length;
        const current = total > 0 ? this.currentSearchIndex + 1 : 0;
        this.searchCount.textContent = `${current}/${total}`;
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.serialCom = new SerialCom();
    window.serialCom.initKeyboardShortcuts();
});
