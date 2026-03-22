const { invoke } = window.__TAURI__.core;

class SerialCom {
    constructor() {
        this.serialPort = null;
        this.isConnected = false;
        this.readInterval = null;
        this.initElements();
        this.bindEvents();
        this.refreshPorts();
    }

    initElements() {
        this.portSelect = document.getElementById('port-select');
        this.baudRate = document.getElementById('baud-rate');
        this.dataBits = document.getElementById('data-bits');
        this.stopBits = document.getElementById('stop-bits');
        this.parity = document.getElementById('parity');
        this.connectBtn = document.getElementById('connect-btn');
        this.refreshBtn = document.getElementById('refresh-ports');
        this.receiveData = document.getElementById('receive-data');
        this.hexReceive = document.getElementById('hex-receive');
        this.hexSend = document.getElementById('hex-send');
        this.sendData = document.getElementById('send-data');
        this.sendBtn = document.getElementById('send-btn');
        this.clearReceive = document.getElementById('clear-receive');
        this.byteCount = document.getElementById('byte-count');
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
    }

    bindEvents() {
        this.refreshBtn.addEventListener('click', () => this.refreshPorts());
        this.connectBtn.addEventListener('click', () => this.toggleConnection());
        this.sendBtn.addEventListener('click', () => this.sendDataButton());
        this.clearReceive.addEventListener('click', () => this.clearReceiveData());
        this.sendData.addEventListener('input', () => this.updateByteCount());
        this.sendData.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                this.sendDataButton();
            }
        });
    }

    async refreshPorts() {
        try {
            this.portSelect.innerHTML = '<option value="">扫描中...</option>';
            
            // 使用 invoke 调用后端命令
            const ports = await invoke('list_ports');
            this.updatePortList(ports);
        } catch (error) {
            console.error('刷新串口列表失败:', error);
            this.portSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '获取串口列表失败';
            this.portSelect.appendChild(option);
            this.showError('刷新串口列表失败: ' + (error.message || error));
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

                // 下拉选项显示端口名 + 厂商 + 产品
                let optionText = port.port_name;
                const details = [];
                if (port.manufacturer) {
                    details.push(port.manufacturer);
                }
                if (port.product) {
                    details.push(port.product);
                }
                if (details.length > 0) {
                    optionText += ' - ' + details.join(' ');
                }
                option.textContent = optionText;

                // 存储完整信息到 title 属性，鼠标悬停时显示
                const fullDetails = [];
                if (port.manufacturer) fullDetails.push(`厂商: ${port.manufacturer}`);
                if (port.product) fullDetails.push(`产品: ${port.product}`);
                if (port.vid != null && port.pid != null) {
                    fullDetails.push(`VID: ${port.vid.toString(16).toUpperCase().padStart(4, '0')}`);
                    fullDetails.push(`PID: ${port.pid.toString(16).toUpperCase().padStart(4, '0')}`);
                }
                if (port.serial_number) fullDetails.push(`序列号: ${port.serial_number}`);

                if (fullDetails.length > 0) {
                    option.title = fullDetails.join('\n');
                }

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
            this.showError('请选择串口');
            return;
        }

        const config = {
            baud_rate: parseInt(this.baudRate.value),
            data_bits: parseInt(this.dataBits.value),
            stop_bits: parseInt(this.stopBits.value),
            parity: this.parity.value === 'None' ? 0 : (this.parity.value === 'Odd' ? 1 : 2)
        };

        try {
            const result = await invoke('open_port', { 
                portName: portName, 
                config: config 
            });
            
            if (result.success) {
                this.isConnected = true;
                this.updateConnectionStatus();
                this.startReading();
                
                this.refreshBtn.disabled = true;
                this.portSelect.disabled = true;
                this.baudRate.disabled = true;
                this.dataBits.disabled = true;
                this.stopBits.disabled = true;
                this.parity.disabled = true;
                this.connectBtn.classList.add('connected');
                this.connectBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                        <line x1="12" y1="2" x2="12" y2="12"/>
                    </svg>
                    关闭串口
                `;
            } else {
                this.showError(result.message);
            }

        } catch (error) {
            console.error('打开串口失败:', error);
            this.showError('打开串口失败: ' + (error.message || error));
        }
    }

    async disconnect() {
        try {
            if (this.readInterval) {
                clearInterval(this.readInterval);
                this.readInterval = null;
            }

            const result = await invoke('close_port');
            
            if (result.success) {
                this.isConnected = false;
                this.updateConnectionStatus();
                
                this.refreshBtn.disabled = false;
                this.portSelect.disabled = false;
                this.baudRate.disabled = false;
                this.dataBits.disabled = false;
                this.stopBits.disabled = false;
                this.parity.disabled = false;
                this.connectBtn.classList.remove('connected');
                this.connectBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                    打开串口
                `;
            }

        } catch (error) {
            console.error('关闭串口失败:', error);
            this.showError('关闭串口失败: ' + (error.message || error));
        }
    }

    updateConnectionStatus() {
        if (this.isConnected) {
            this.statusIndicator.classList.add('connected');
            this.statusText.textContent = '已连接';
        } else {
            this.statusIndicator.classList.remove('connected');
            this.statusText.textContent = '未连接';
        }
    }

    startReading() {
        if (!this.isConnected) return;

        this.readInterval = setInterval(async () => {
            try {
                const data = await invoke('read_port');
                if (data) {
                    this.appendReceiveData(data);
                }
            } catch (error) {
                // 忽略读取时的暂时性错误
                console.error('读取数据错误:', error);
            }
        }, 50);
    }

    appendReceiveData(data) {
        if (!data) return;
        
        const hexMode = this.hexReceive.checked;
        let displayData = data;
        
        if (hexMode) {
            displayData = Array.from(data)
                .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
                .join(' ');
        }
        
        this.receiveData.textContent += displayData + (hexMode ? ' ' : '');
        this.receiveData.scrollTop = this.receiveData.scrollHeight;
    }

    clearReceiveData() {
        this.receiveData.textContent = '';
    }

    async sendDataButton() {
        if (!this.isConnected) {
            this.showError('请先打开串口');
            return;
        }

        const data = this.sendData.value.trim();
        if (!data) {
            this.showError('请输入要发送的数据');
            return;
        }

        const hexMode = this.hexSend.checked;
        
        try {
            let result;
            if (hexMode) {
                result = await invoke('write_port_hex', { hexData: data });
            } else {
                result = await invoke('write_port', { data: data });
            }
            
            if (result.success) {
                this.sendData.value = '';
                this.updateByteCount();
            } else {
                this.showError(result.message);
            }
        } catch (error) {
            console.error('发送数据失败:', error);
            this.showError('发送数据失败: ' + (error.message || error));
        }
    }

    updateByteCount() {
        const data = this.sendData.value.trim();
        const hexMode = this.hexSend.checked;
        
        let byteCount = 0;
        
        if (hexMode) {
            byteCount = data.split(/\s+/).filter(h => h.length > 0).length;
        } else {
            byteCount = data.length;
        }
        
        this.byteCount.textContent = `${byteCount} 字节`;
    }

    showError(message) {
        const originalText = this.statusText.textContent;
        const originalClass = this.statusIndicator.classList.contains('connected');
        
        this.statusIndicator.classList.remove('connected');
        this.statusText.textContent = message;
        
        setTimeout(() => {
            if (originalClass) {
                this.statusIndicator.classList.add('connected');
            }
            this.statusText.textContent = this.isConnected ? '已连接' : '未连接';
        }, 3000);
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.serialCom = new SerialCom();
});
