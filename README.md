# LCom - 串口调试工具

基于 Tauri 2 + Vanilla JS 的轻量级串口调试工具，支持串口设备热插拔自动检测。

## 功能

- 串口通信（支持自定义波特率、数据位、停止位、校验位）
- HEX / 文本 双模式收发
- 数据包分包合并
- 快捷发送（分组管理、导入导出）
- 循环发送
- 日志搜索与过滤
- 设备热插拔自动检测（Windows）
- 日志导出、设置导入导出

## 开发

### 前置要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)（stable）
- Visual Studio Build Tools（C++ 工具链）

### 开发模式

```bash
npm install
npm run tauri dev
```

### 构建 Release

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/`：

- `lcom.exe` — 可直接运行的便携版
- `bundle/` — 安装包（msi、nsis）

如只生成便携 exe，不生成安装包：

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml
```

产物：`src-tauri/target/release/lcom.exe`

## 技术栈

- **前端**：HTML / CSS / Vanilla JavaScript
- **后端**：Rust + Tauri 2
- **串口**：[serialport](https://crates.io/crates/serialport) crate
- **设备检测**：Windows WM_DEVICECHANGE 系统事件

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
