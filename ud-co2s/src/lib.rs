use serialport::SerialPort;
use std::ffi::CStr;
use std::io::{BufRead, BufReader};
use std::os::raw::c_char;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

type Callback = extern "C" fn(*const u8, len: usize);

// シリアルポートのハンドルを保持用。
static SERIAL_PORT: OnceLock<Mutex<Option<Box<dyn SerialPort>>>> = OnceLock::new();

// グローバルなコールバック登録用。
static CALLBACK: OnceLock<Mutex<Option<Callback>>> = OnceLock::new();

// シリアルポート読取スレッドの管理用。
static INIT: OnceLock<()> = OnceLock::new();

#[no_mangle]
pub extern "C" fn register_callback(callback: Callback) {
    let mutex = CALLBACK.get_or_init(|| Mutex::new(None));
    let mut cb = mutex.lock().unwrap();
    *cb = Some(callback);
}

#[no_mangle]
pub extern "C" fn open(port_name: *const c_char) {
    let c_str = unsafe { CStr::from_ptr(port_name) };
    let port_name_str = c_str.to_str().expect("Failed to get port name.");

    let mut port = serialport::new(port_name_str, 9600)
        .timeout(Duration::from_millis(5000))
        .open()
        .expect("Failed to open.");

    port.write("STA\r\n".as_bytes()).expect("Failed to write.");

    // SERIAL_PORTを初期化し、シリアルポートをセット。
    let serial_mutex = SERIAL_PORT.get_or_init(|| Mutex::new(None));
    let mut serial = serial_mutex.lock().unwrap();
    *serial = Some(port);

    // 初期化がまだの場合のみスレッドを開始。
    INIT.get_or_init(|| {
        thread::spawn(move || {
            if let Some(serial_mutex) = SERIAL_PORT.get() {
                let mut serial = serial_mutex.lock().unwrap();
                let port = serial.as_mut().expect("Serial port should be initialized.");

                let reader = BufReader::new(port);
                for line_result in reader.lines() {
                    match line_result {
                        Ok(line) => {
                            if let Some(cb_mutex) = CALLBACK.get() {
                                let cb_guard = cb_mutex.lock().unwrap();
                                if let Some(callback) = *cb_guard {
                                    callback(line.as_ptr(), line.len());
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error reading line: {}", e);
                            break;
                        }
                    }
                }
            }
        });
    });
}

#[no_mangle]
pub extern "C" fn close() {
    if let Some(serial_mutex) = SERIAL_PORT.get() {
        let mut serial = serial_mutex.lock().unwrap();
        *serial = None;
    }

    if let Some(cb_mutex) = CALLBACK.get() {
        let mut cb = cb_mutex.lock().unwrap();
        *cb = None;
    }
}
