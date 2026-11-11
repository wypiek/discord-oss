mod api;
mod app;
mod discovery;
mod gateway;
mod images;
mod model;
mod permissions;
mod secrets;
mod store;
mod text;

#[cfg(test)]
mod live_tests;

use std::path::PathBuf;

slint::include_modules!();

pub fn default_data_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("oss-chat")
}

pub fn run(data_dir: PathBuf) -> Result<(), slint::PlatformError> {
    secrets::set_data_dir(data_dir.clone());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("the async runtime starts");
    let ui = AppWindow::new()?;
    let _app = app::App::start(&ui, runtime.handle().clone(), data_dir);
    ui.run()
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
fn android_main(app: slint::android::AndroidApp) {
    let data_dir = app.internal_data_path().unwrap_or_else(std::env::temp_dir);
    slint::android::init(app).expect("the Android backend starts");
    if let Err(error) = run(data_dir) {
        eprintln!("the app stopped: {error}");
    }
}
