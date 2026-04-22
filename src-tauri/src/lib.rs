use serde::{Deserialize, Serialize};
use serialport::{SerialPort, SerialPortType};
use std::sync::{mpsc::{self, Receiver, Sender}, Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

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

static mut GLOBAL_PORT: Option<Arc<Mutex<Box<dyn SerialPort + Send>>>> = None;
static mut CHANNEL_SENDER: Option<Sender<String>> = None;
static mut CHANNEL_RECEIVER: Option<Receiver<String>> = None;
static mut RUNNING_FLAG: Option<Arc<AtomicBool>> = None;

#[tauri::command]
fn list_ports() -> Vec<SerialPortInfoResponse> {
    match serialport::available_ports() {
        Ok(ports) => ports
            .iter()
            .map(|p| {
                let (port_type, manufacturer, product, vid, pid, serial_number) = match &p.port_type {
                    SerialPortType::UsbPort(info) => (
                        "USB".to_string(),
                        info.manufacturer.clone(),
                        info.product.clone(),
                        Some(info.vid),
                        Some(info.pid),
                        info.serial_number.clone(),
                    ),
                    SerialPortType::PciPort => ("PCI".to_string(), None, None, None, None, None),
                    SerialPortType::BluetoothPort => ("Bluetooth".to_string(), None, None, None, None, None),
                    SerialPortType::Unknown => ("Unknown".to_string(), None, None, None, None, None),
                };

                SerialPortInfoResponse {
                    port_name: p.port_name.clone(),
                    port_type,
                    manufacturer,
                    product,
                    vid,
                    pid,
                    serial_number,
                }
            })
            .collect(),
        Err(_) => vec![],
    }
}

#[tauri::command]
fn open_port(port_name: String, config: SerialConfig) -> OpenPortResult {
    let stop_bits = match config.stop_bits {
        1 => serialport::StopBits::One,
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
        8 => serialport::DataBits::Eight,
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
            let port: Box<dyn SerialPort + Send> = port;
            let port = Arc::new(Mutex::new(port));
            let port_clone = port.clone();
            let tx_clone = tx.clone();
            let running = Arc::new(AtomicBool::new(true));
            let running_clone = running.clone();

            thread::spawn(move || {
                let mut buf: Vec<u8> = vec![0; 1024];
                while running_clone.load(Ordering::SeqCst) {
                    let mut p = port_clone.lock().unwrap();
                    match p.read(&mut buf) {
                        Ok(size) => {
                            if size > 0 {
                                let data = String::from_utf8_lossy(&buf[..size]).to_string();
                                let _ = tx_clone.send(data);
                            }
                        }
                        Err(_) => {
                            drop(p);
                            thread::sleep(Duration::from_millis(10));
                        }
                    }
                }
            });

            unsafe {
                GLOBAL_PORT = Some(port);
                CHANNEL_SENDER = Some(tx);
                CHANNEL_RECEIVER = Some(rx);
                RUNNING_FLAG = Some(running);
            }

            OpenPortResult {
                success: true,
                message: format!("成功打开串口: {}", port_name),
            }
        }
        Err(e) => OpenPortResult {
            success: false,
            message: format!("打开串口失败: {}", e),
        },
    }
}

#[tauri::command]
fn close_port() -> OpenPortResult {
    unsafe {
        // 先设置标志为 false，让线程停止
        if let Some(ref flag) = RUNNING_FLAG {
            flag.store(false, Ordering::SeqCst);
        }
        // 等待一小段时间让线程退出
        thread::sleep(Duration::from_millis(50));
        // 然后清除资源
        GLOBAL_PORT = None;
        CHANNEL_SENDER = None;
        CHANNEL_RECEIVER = None;
        RUNNING_FLAG = None;
    }

    OpenPortResult {
        success: true,
        message: "串口已关闭".to_string(),
    }
}

#[tauri::command]
fn write_port(data: String) -> OpenPortResult {
    unsafe {
        if let Some(ref port) = GLOBAL_PORT {
            match port.lock().unwrap().write(data.as_bytes()) {
                Ok(_) => OpenPortResult {
                    success: true,
                    message: "数据发送成功".to_string(),
                },
                Err(e) => OpenPortResult {
                    success: false,
                    message: format!("发送失败: {}", e),
                },
            }
        } else {
            OpenPortResult {
                success: false,
                message: "串口未打开".to_string(),
            }
        }
    }
}

#[tauri::command]
fn write_port_hex(hex_data: String) -> OpenPortResult {
    let bytes: Vec<u8> = hex_data
        .split_whitespace()
        .filter_map(|s| u8::from_str_radix(s, 16).ok())
        .collect();

    if bytes.is_empty() {
        return OpenPortResult {
            success: false,
            message: "无效的十六进制数据".to_string(),
        };
    }

    unsafe {
        if let Some(ref port) = GLOBAL_PORT {
            match port.lock().unwrap().write(&bytes) {
                Ok(_) => OpenPortResult {
                    success: true,
                    message: "数据发送成功".to_string(),
                },
                Err(e) => OpenPortResult {
                    success: false,
                    message: format!("发送失败: {}", e),
                },
            }
        } else {
            OpenPortResult {
                success: false,
                message: "串口未打开".to_string(),
            }
        }
    }
}

#[tauri::command]
fn read_port() -> Option<String> {
    unsafe {
        if let Some(ref rx) = CHANNEL_RECEIVER {
            match rx.try_recv() {
                Ok(data) => Some(data),
                Err(_) => None,
            }
        } else {
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
