use std::path::PathBuf;
use std::sync::OnceLock;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_data_dir(path: PathBuf) {
    let _ = DATA_DIR.set(path);
}

#[cfg(not(target_os = "android"))]
mod store {
    const SERVICE: &str = "io.github.wypiek.osschat";

    fn entry(instance_id: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, instance_id).map_err(|error| error.to_string())
    }

    pub fn load(instance_id: &str) -> Option<String> {
        entry(instance_id).ok()?.get_password().ok().filter(|token| !token.is_empty())
    }

    pub fn save(instance_id: &str, token: &str) -> Result<(), String> {
        entry(instance_id)?.set_password(token).map_err(|error| error.to_string())
    }

    pub fn forget(instance_id: &str) {
        if let Ok(entry) = entry(instance_id) {
            let _ = entry.delete_credential();
        }
    }
}

#[cfg(target_os = "android")]
mod store {
    use super::DATA_DIR;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn path() -> Option<PathBuf> {
        DATA_DIR.get().map(|dir| dir.join("sessions.json"))
    }

    fn read() -> HashMap<String, String> {
        path()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn write(tokens: &HashMap<String, String>) -> Result<(), String> {
        let path = path().ok_or("the app has no data folder")?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(&path, serde_json::to_vec(tokens).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
    }

    pub fn load(instance_id: &str) -> Option<String> {
        read().remove(instance_id).filter(|token| !token.is_empty())
    }

    pub fn save(instance_id: &str, token: &str) -> Result<(), String> {
        let mut tokens = read();
        tokens.insert(instance_id.to_string(), token.to_string());
        write(&tokens)
    }

    pub fn forget(instance_id: &str) {
        let mut tokens = read();
        if tokens.remove(instance_id).is_some() {
            let _ = write(&tokens);
        }
    }
}

pub use store::{forget, load, save};
