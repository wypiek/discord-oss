#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

slint::include_modules!();

fn main() -> Result<(), slint::PlatformError> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("the async runtime starts");
    let ui = AppWindow::new()?;
    let _app = app::App::start(&ui, runtime.handle().clone());
    ui.run()
}
