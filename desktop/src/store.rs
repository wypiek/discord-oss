use crate::discovery::Instance;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Store {
    #[serde(default)]
    pub instances: Vec<Instance>,
    #[serde(default)]
    pub last: Option<String>,
}

impl Store {
    pub fn load(path: &Path) -> Self {
        fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(self).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    }

    pub fn get(&self, id: &str) -> Option<&Instance> {
        self.instances.iter().find(|instance| instance.id == id)
    }

    pub fn last_instance(&self) -> Option<&Instance> {
        self.last.as_deref().and_then(|id| self.get(id))
    }

    pub fn upsert(&mut self, instance: Instance) {
        match self.instances.iter_mut().find(|existing| existing.id == instance.id) {
            Some(existing) => *existing = instance,
            None => self.instances.push(instance),
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.instances.retain(|instance| instance.id != id);
        if self.last.as_deref() == Some(id) {
            self.last = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance(id: &str, name: &str) -> Instance {
        Instance {
            id: id.into(),
            name: name.into(),
            url: format!("https://{id}.example.org"),
            ..Default::default()
        }
    }

    #[test]
    fn saving_the_same_instance_again_updates_it() {
        let mut store = Store::default();
        store.upsert(instance("1", "Old"));
        store.upsert(instance("1", "New"));
        store.upsert(instance("2", "Other"));
        assert_eq!(store.instances.len(), 2);
        assert_eq!(store.get("1").unwrap().name, "New");
    }

    #[test]
    fn removing_the_last_instance_forgets_it() {
        let mut store = Store::default();
        store.upsert(instance("1", "One"));
        store.last = Some("1".into());
        store.remove("1");
        assert!(store.last_instance().is_none());
    }

    #[test]
    fn the_store_survives_a_round_trip() {
        let dir = std::env::temp_dir().join(format!("oss-chat-test-{}", std::process::id()));
        let path = dir.join("instances.json");
        let mut store = Store::default();
        store.upsert(instance("1", "One"));
        store.last = Some("1".into());
        store.save(&path).unwrap();
        let loaded = Store::load(&path);
        assert_eq!(loaded.last_instance().unwrap().name, "One");
        fs::remove_dir_all(dir).unwrap();
    }
}
