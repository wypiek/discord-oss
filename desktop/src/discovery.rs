use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::{Host, Url};

pub const SOFTWARE: &str = "discord-oss";
pub const PROTOCOL: u32 = 1;
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;
const MAX_NAME_CHARS: usize = 100;
const MAX_DESCRIPTION_CHARS: usize = 300;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub url: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub registration_open: bool,
    #[serde(default)]
    pub api_url: String,
    #[serde(default)]
    pub gateway_url: String,
    #[serde(default)]
    pub cdn_url: String,
}

impl Instance {
    pub fn host(&self) -> String {
        Url::parse(&self.url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_else(|| self.url.clone())
    }

    pub fn page(&self, path: &str) -> String {
        format!("{}{path}", self.url)
    }

    pub fn api(&self) -> String {
        format!("{}/v9", if self.api_url.is_empty() { format!("{}/api", self.url) } else { self.api_url.clone() })
    }

    pub fn gateway(&self) -> String {
        if self.gateway_url.is_empty() {
            self.url.replacen("http", "ws", 1)
        } else {
            self.gateway_url.clone()
        }
    }

    pub fn cdn(&self) -> String {
        if self.cdn_url.is_empty() {
            self.url.clone()
        } else {
            self.cdn_url.clone()
        }
    }
}

#[derive(Deserialize)]
struct Document {
    software: Software,
    protocol: u32,
    instance: InstanceDocument,
    registration: Option<Registration>,
    api: Option<Endpoint>,
    gateway: Option<Endpoint>,
    cdn: Option<Endpoint>,
}

#[derive(Deserialize)]
struct Software {
    name: String,
}

#[derive(Deserialize)]
struct InstanceDocument {
    id: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    url: String,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Deserialize)]
struct Registration {
    open: bool,
}

#[derive(Deserialize)]
struct Endpoint {
    url: String,
}

pub fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain == "localhost" || domain.ends_with(".localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

pub fn is_allowed_origin(url: &Url) -> bool {
    url.host().is_some() && (matches!(url.scheme(), "https" | "wss") || (matches!(url.scheme(), "http" | "ws") && is_loopback(url)))
}

pub fn origin_for(address: &str) -> Result<Url, String> {
    let address = address.trim();
    if address.is_empty() {
        return Err("Enter the address of an instance.".into());
    }
    let explicit_scheme = address.contains("://");
    let mut url = Url::parse(&if explicit_scheme { address.to_string() } else { format!("https://{address}") }).map_err(|_| "That doesn't look like a web address.".to_string())?;
    if !explicit_scheme && is_loopback(&url) {
        url.set_scheme("http").map_err(|_| "That doesn't look like a web address.".to_string())?;
    }
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("That doesn't look like a web address.".into());
    }
    if !is_allowed_origin(&url) {
        return Err("Use an https:// address. Plain http only works for an instance on this computer.".into());
    }
    Url::parse(&url.origin().ascii_serialization()).map_err(|_| "That doesn't look like a web address.".to_string())
}

fn truncate(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

fn endpoint(endpoint: Option<Endpoint>) -> Result<String, String> {
    match endpoint {
        None => Ok(String::new()),
        Some(endpoint) => {
            let url = Url::parse(&endpoint.url).map_err(|_| "The instance lists an invalid address.".to_string())?;
            if !is_allowed_origin(&url) {
                return Err("This instance doesn't use https, so the app won't connect to it.".into());
            }
            Ok(endpoint.url.trim_end_matches('/').to_string())
        }
    }
}

pub fn parse_document(body: &[u8]) -> Result<Instance, String> {
    let not_an_instance = || "That address isn't an instance this app can connect to.".to_string();
    let document: Document = serde_json::from_slice(body).map_err(|_| not_an_instance())?;
    if document.software.name != SOFTWARE {
        return Err(not_an_instance());
    }
    if document.protocol > PROTOCOL {
        return Err("This instance needs a newer version of the app.".into());
    }
    if document.protocol < PROTOCOL {
        return Err("This instance runs a version the app no longer supports.".into());
    }
    let instance = document.instance;
    if instance.id.is_empty() || !instance.id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(not_an_instance());
    }
    let url = Url::parse(&instance.url).map_err(|_| not_an_instance())?;
    if !is_allowed_origin(&url) || !matches!(url.scheme(), "http" | "https") {
        return Err("This instance doesn't use https, so the app won't connect to it.".into());
    }
    let name = truncate(&instance.name, MAX_NAME_CHARS);
    if name.is_empty() {
        return Err(not_an_instance());
    }
    let icon = instance
        .icon
        .and_then(|icon| Url::parse(&icon).ok())
        .filter(|icon| matches!(icon.scheme(), "http" | "https"))
        .map(|icon| icon.to_string())
        .unwrap_or_default();
    Ok(Instance {
        id: instance.id,
        name,
        description: truncate(instance.description.as_deref().unwrap_or_default(), MAX_DESCRIPTION_CHARS),
        url: url.origin().ascii_serialization(),
        icon,
        registration_open: document.registration.map(|registration| registration.open).unwrap_or(false),
        api_url: endpoint(document.api)?,
        gateway_url: endpoint(document.gateway)?,
        cdn_url: endpoint(document.cdn)?,
    })
}

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent(concat!("discord-oss-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
}

pub async fn discover(address: &str) -> Result<Instance, String> {
    let origin = origin_for(address)?;
    let host = origin.host_str().unwrap_or_default().to_string();
    let response = http_client()?
        .get(origin.join("/.well-known/discord-oss").map_err(|error| error.to_string())?)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!("{host} took too long to answer.")
            } else {
                format!("Couldn't reach {host}. Check the address and your connection.")
            }
        })?;
    if !is_allowed_origin(response.url()) {
        return Err("The instance redirected to an address without https, so the app won't follow it.".into());
    }
    if !response.status().is_success() {
        return Err(format!("{host} answered {}. It may not be an instance.", response.status().as_u16()));
    }
    if response.content_length().is_some_and(|length| length as usize > MAX_DOCUMENT_BYTES) {
        return Err("That address isn't an instance this app can connect to.".into());
    }
    let body = response.bytes().await.map_err(|_| format!("Couldn't read the answer from {host}."))?;
    if body.len() > MAX_DOCUMENT_BYTES {
        return Err("That address isn't an instance this app can connect to.".into());
    }
    parse_document(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(protocol: u32, url: &str) -> Vec<u8> {
        serde_json::json!({
            "software": { "name": "discord-oss", "version": "0.1.0" },
            "protocol": protocol,
            "instance": { "id": "1570103005980680252", "name": "  Example Chat ", "description": "Hi", "url": url, "icon": "https://chat.example.org/static/logo.png?v=1" },
            "api": { "url": "https://chat.example.org/api" },
            "gateway": { "url": "wss://chat.example.org" },
            "cdn": { "url": "https://cdn.example.org/" },
            "registration": { "open": true }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn addresses_become_origins() {
        assert_eq!(origin_for("chat.example.org").unwrap().as_str(), "https://chat.example.org/");
        assert_eq!(origin_for(" https://chat.example.org/channels/@me?x=1 ").unwrap().as_str(), "https://chat.example.org/");
        assert_eq!(origin_for("localhost:3001").unwrap().as_str(), "http://localhost:3001/");
        assert_eq!(origin_for("http://127.0.0.1:3001").unwrap().as_str(), "http://127.0.0.1:3001/");
    }

    #[test]
    fn plain_http_is_refused_off_this_computer() {
        assert!(origin_for("http://chat.example.org").is_err());
        assert!(origin_for("ftp://chat.example.org").is_err());
        assert!(origin_for("").is_err());
    }

    #[test]
    fn a_valid_document_describes_the_instance() {
        let instance = parse_document(&document(1, "https://chat.example.org")).unwrap();
        assert_eq!(instance.name, "Example Chat");
        assert_eq!(instance.url, "https://chat.example.org");
        assert!(instance.registration_open);
        assert_eq!(instance.api(), "https://chat.example.org/api/v9");
        assert_eq!(instance.gateway(), "wss://chat.example.org");
        assert_eq!(instance.cdn(), "https://cdn.example.org");
        assert_eq!(instance.page("/register"), "https://chat.example.org/register");
    }

    #[test]
    fn endpoints_fall_back_to_the_instance_address() {
        let mut instance = parse_document(&document(1, "http://localhost:3001")).unwrap();
        instance.api_url.clear();
        instance.gateway_url.clear();
        instance.cdn_url.clear();
        assert_eq!(instance.api(), "http://localhost:3001/api/v9");
        assert_eq!(instance.gateway(), "ws://localhost:3001");
        assert_eq!(instance.cdn(), "http://localhost:3001");
    }

    #[test]
    fn other_software_and_protocols_are_refused() {
        assert!(parse_document(&document(2, "https://chat.example.org")).unwrap_err().contains("newer version"));
        assert!(parse_document(&document(1, "http://chat.example.org")).is_err());
        assert!(parse_document(br#"{"software":{"name":"spacebar"},"protocol":1,"instance":{"id":"1","name":"x","url":"https://a.b"}}"#).is_err());
        assert!(parse_document(b"<html>").is_err());
    }
}
