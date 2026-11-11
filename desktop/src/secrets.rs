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
