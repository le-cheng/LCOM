use serde::{Deserialize, Serialize};
use serialport::{SerialPort, SerialPortType};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{
    mpsc::{self, Receiver},
    Arc, Mutex, OnceLock,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

type SharedSerialPort = Arc<Mutex<Box<dyn SerialPort + Send>>>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerialPortInfoResponse {
    pub port_name: String,
    pub port_type: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub serial_number: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerialConfig {
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenPortResult {
    pub success: bool,
    pub message: String,
}

#[derive(Default)]
struct SerialRuntime {
    port: Option<SharedSerialPort>,
    receiver: Option<Receiver<Vec<u8>>>,
    running: Option<Arc<AtomicBool>>,
    reader: Option<JoinHandle<()>>,
}

static SERIAL_RUNTIME: OnceLock<Mutex<SerialRuntime>> = OnceLock::new();

#[cfg(target_os = "windows")]
static APP_HANDLE: OnceLock<Mutex<Option<tauri::AppHandle>>> = OnceLock::new();

fn serial_runtime() -> &'static Mutex<SerialRuntime> {
    SERIAL_RUNTIME.get_or_init(|| Mutex::new(SerialRuntime::default()))
}

#[cfg(target_os = "windows")]
fn app_handle_slot() -> &'static Mutex<Option<tauri::AppHandle>> {
    APP_HANDLE.get_or_init(|| Mutex::new(None))
}

fn success(message: impl Into<String>) -> OpenPortResult {
    OpenPortResult {
        success: true,
        message: message.into(),
    }
}

fn failure(message: impl Into<String>) -> OpenPortResult {
    OpenPortResult {
        success: false,
        message: message.into(),
    }
}

fn close_port_internal() {
    let reader = {
        let mut runtime = serial_runtime()
            .lock()
            .expect("serial runtime mutex poisoned");

        if let Some(running) = runtime.running.take() {
            running.store(false, Ordering::SeqCst);
        }

        runtime.port = None;
        runtime.receiver = None;
        runtime.reader.take()
    };

    if let Some(reader) = reader {
        let _ = reader.join();
    }
}

fn current_port() -> Option<SharedSerialPort> {
    serial_runtime()
        .lock()
        .ok()
        .and_then(|runtime| runtime.port.clone())
}

fn write_bytes(bytes: &[u8]) -> OpenPortResult {
    let Some(port) = current_port() else {
        return failure("串口未打开");
    };

    let mut guard = match port.lock() {
        Ok(guard) => guard,
        Err(_) => return failure("串口状态异常"),
    };

    match guard.write_all(bytes).and_then(|_| guard.flush()) {
        Ok(()) => success("数据发送成功"),
        Err(error) => failure(format!("发送失败: {error}")),
    }
}

fn parse_hex_bytes(hex_data: &str) -> Result<Vec<u8>, String> {
    let compact: String = hex_data
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace())
        .collect();

    if compact.is_empty() || compact.len() % 2 != 0 {
        return Err("无效的十六进制数据".to_string());
    }

    if !compact.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("无效的十六进制数据".to_string());
    }

    let mut bytes = Vec::with_capacity(compact.len() / 2);
    for index in (0..compact.len()).step_by(2) {
        let part = &compact[index..index + 2];
        let value = u8::from_str_radix(part, 16).map_err(|_| "无效的十六进制数据".to_string())?;
        bytes.push(value);
    }

    Ok(bytes)
}

#[tauri::command]
fn list_ports() -> Vec<SerialPortInfoResponse> {
    match serialport::available_ports() {
        Ok(ports) => ports
            .iter()
            .map(|port| {
                let (port_type, manufacturer, product, vid, pid, serial_number) = match &port
                    .port_type
                {
                    SerialPortType::UsbPort(info) => (
                        "USB".to_string(),
                        info.manufacturer.clone(),
                        info.product.clone(),
                        Some(info.vid),
                        Some(info.pid),
                        info.serial_number.clone(),
                    ),
                    SerialPortType::PciPort => ("PCI".to_string(), None, None, None, None, None),
                    SerialPortType::BluetoothPort => {
                        ("Bluetooth".to_string(), None, None, None, None, None)
                    }
                    SerialPortType::Unknown => {
                        ("Unknown".to_string(), None, None, None, None, None)
                    }
                };

                SerialPortInfoResponse {
                    port_name: port.port_name.clone(),
                    port_type,
                    manufacturer,
                    product,
                    vid,
                    pid,
                    serial_number,
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
fn open_port(port_name: String, config: SerialConfig) -> OpenPortResult {
    close_port_internal();

    let stop_bits = match config.stop_bits {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };

    let parity = match config.parity {
        1 => serialport::Parity::Odd,
        2 => serialport::Parity::Even,
        _ => serialport::Parity::None,
    };

    let data_bits = match config.data_bits {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };

    let builder = serialport::new(&port_name, config.baud_rate)
        .timeout(Duration::from_millis(100))
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .flow_control(serialport::FlowControl::None);

    match builder.open() {
        Ok(port) => {
            let (tx, rx) = mpsc::channel();
            let port: SharedSerialPort = Arc::new(Mutex::new(port));
            let port_reader = Arc::clone(&port);
            let running = Arc::new(AtomicBool::new(true));
            let running_reader = Arc::clone(&running);

            let reader = thread::spawn(move || {
                let mut buffer = vec![0_u8; 4096];

                while running_reader.load(Ordering::SeqCst) {
                    let read_result = {
                        let mut serial = match port_reader.lock() {
                            Ok(serial) => serial,
                            Err(_) => break,
                        };

                        serial.read(&mut buffer)
                    };

                    match read_result {
                        Ok(size) if size > 0 => {
                            if tx.send(buffer[..size].to_vec()).is_err() {
                                break;
                            }
                        }
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
                        Err(_) => thread::sleep(Duration::from_millis(10)),
                    }
                }
            });

            let mut runtime = serial_runtime()
                .lock()
                .expect("serial runtime mutex poisoned");
            runtime.port = Some(port);
            runtime.receiver = Some(rx);
            runtime.running = Some(running);
            runtime.reader = Some(reader);

            success(format!("成功打开串口: {port_name}"))
        }
        Err(error) => failure(format!("打开串口失败: {error}")),
    }
}

#[tauri::command]
fn close_port() -> OpenPortResult {
    close_port_internal();
    success("串口已关闭")
}

#[tauri::command]
fn write_port(data: String) -> OpenPortResult {
    write_bytes(data.as_bytes())
}

#[tauri::command]
fn write_port_hex(hex_data: String) -> OpenPortResult {
    match parse_hex_bytes(&hex_data) {
        Ok(bytes) => write_bytes(&bytes),
        Err(message) => failure(message),
    }
}

#[tauri::command]
fn read_port() -> Option<Vec<u8>> {
    let runtime = serial_runtime().lock().ok()?;
    let receiver = runtime.receiver.as_ref()?;

    let mut buffer = receiver.try_recv().ok()?;
    while let Ok(mut chunk) = receiver.try_recv() {
        buffer.append(&mut chunk);
    }

    Some(buffer)
}

// ========== Windows 设备变动监听 ==========

#[cfg(target_os = "windows")]
#[allow(non_snake_case)]
mod win32 {
    use std::ffi::c_void;

    pub type HWND = *mut c_void;
    pub type HINSTANCE = *mut c_void;
    pub type WPARAM = usize;
    pub type LPARAM = isize;
    pub type LRESULT = isize;

    #[repr(C)]
    pub struct WNDCLASSW {
        pub style: u32,
        pub lpfnWndProc: Option<unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT>,
        pub cbClsExtra: i32,
        pub cbWndExtra: i32,
        pub hInstance: HINSTANCE,
        pub hIcon: *mut c_void,
        pub hCursor: *mut c_void,
        pub hbrBackground: *mut c_void,
        pub lpszMenuName: *const u16,
        pub lpszClassName: *const u16,
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct POINT {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    pub struct MSG {
        pub hwnd: HWND,
        pub message: u32,
        pub wParam: WPARAM,
        pub lParam: LPARAM,
        pub time: u32,
        pub pt: POINT,
        pub lPrivate: u32,
    }

    unsafe extern "system" {
        pub fn GetModuleHandleW(lpModuleName: *const u16) -> HINSTANCE;
        pub fn RegisterClassW(lpWndClass: *const WNDCLASSW) -> u16;
        pub fn CreateWindowExW(
            dwExStyle: u32,
            lpClassName: *const u16,
            lpWindowName: *const u16,
            dwStyle: u32,
            x: i32,
            y: i32,
            nWidth: i32,
            nHeight: i32,
            hWndParent: HWND,
            hMenu: *mut c_void,
            hInstance: HINSTANCE,
            lpParam: *mut c_void,
        ) -> HWND;
        pub fn GetMessageW(
            lpMsg: *mut MSG,
            hWnd: HWND,
            wMsgFilterMin: u32,
            wMsgFilterMax: u32,
        ) -> i32;
        pub fn TranslateMessage(lpMsg: *const MSG) -> i32;
        pub fn DispatchMessageW(lpMsg: *const MSG) -> LRESULT;
        pub fn DefWindowProcW(hWnd: HWND, msg: u32, wParam: WPARAM, lParam: LPARAM) -> LRESULT;
        pub fn PostQuitMessage(nExitCode: i32);
        pub fn SetTimer(
            hWnd: HWND,
            nIDEvent: usize,
            uElapse: u32,
            lpTimerFunc: *mut c_void,
        ) -> usize;
        pub fn KillTimer(hWnd: HWND, uIDEvent: usize) -> i32;
    }

    pub fn to_wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(target_os = "windows")]
fn start_device_monitor(app: tauri::AppHandle) {
    if let Ok(mut slot) = app_handle_slot().lock() {
        *slot = Some(app);
    }

    thread::spawn(move || unsafe {
        let class_name = win32::to_wide("LComDeviceMonitor");
        let window_name = win32::to_wide("LCom Device Monitor");

        let mut window_class: win32::WNDCLASSW = std::mem::zeroed();
        window_class.lpfnWndProc = Some(device_wnd_proc);
        window_class.hInstance = win32::GetModuleHandleW(std::ptr::null());
        window_class.lpszClassName = class_name.as_ptr();

        win32::RegisterClassW(&window_class);

        win32::CreateWindowExW(
            0,
            class_name.as_ptr(),
            window_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            window_class.hInstance,
            std::ptr::null_mut(),
        );

        let mut message: win32::MSG = std::mem::zeroed();
        while win32::GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            win32::TranslateMessage(&message);
            win32::DispatchMessageW(&message);
        }
    });
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn device_wnd_proc(
    hwnd: win32::HWND,
    msg: u32,
    wparam: win32::WPARAM,
    lparam: win32::LPARAM,
) -> win32::LRESULT {
    const WM_DESTROY: u32 = 0x0002;
    const WM_DEVICECHANGE: u32 = 0x0219;
    const DBT_DEVNODES_CHANGED: usize = 0x0007;
    const WM_TIMER: u32 = 0x0113;
    const IDT_CHECK_PORTS: usize = 1;
    const IDT_CHECK_DELAYED: usize = 2;

    match msg {
        WM_DEVICECHANGE if wparam == DBT_DEVNODES_CHANGED => {
            win32::SetTimer(hwnd, IDT_CHECK_PORTS, 500, std::ptr::null_mut());
            win32::SetTimer(hwnd, IDT_CHECK_DELAYED, 2000, std::ptr::null_mut());
            0
        }
        WM_TIMER if wparam == IDT_CHECK_PORTS => {
            win32::KillTimer(hwnd, IDT_CHECK_PORTS);
            check_port_changes();
            0
        }
        WM_TIMER if wparam == IDT_CHECK_DELAYED => {
            win32::KillTimer(hwnd, IDT_CHECK_DELAYED);
            check_port_changes();
            0
        }
        WM_DESTROY => {
            win32::PostQuitMessage(0);
            0
        }
        _ => win32::DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(target_os = "windows")]
fn check_port_changes() {
    use tauri::Emitter;

    let app = app_handle_slot()
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().cloned());

    let Some(app) = app else {
        eprintln!("[LCom] check_port_changes: app handle unavailable");
        return;
    };

    let ports = list_ports();
    if let Err(error) = app.emit("port-changed", serde_json::json!({ "ports": ports })) {
        eprintln!("[LCom] emit failed: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            start_device_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_ports,
            open_port,
            close_port,
            write_port,
            read_port,
            write_port_hex
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
