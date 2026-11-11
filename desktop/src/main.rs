#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> Result<(), slint::PlatformError> {
    oss_chat::run(oss_chat::default_data_dir())
}
