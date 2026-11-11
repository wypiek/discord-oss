use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as Frame;

const AUTHENTICATION_FAILED: u16 = 4004;
const MAX_BACKOFF_SECONDS: u64 = 30;

#[derive(Debug, Clone)]
pub enum GatewayEvent {
    Dispatch(String, Value),
    Connecting,
    Reconnecting(u64),
    AuthFailed,
}

enum End {
    Reconnect { was_ready: bool },
    AuthFailed,
    Stopped,
}

pub fn operating_system() -> &'static str {
    match std::env::consts::OS {
        "macos" => "Mac OS X",
        "windows" => "Windows",
        _ => "Linux",
    }
}

pub fn identify(token: &str, app_name: &str) -> Value {
    json!({
        "op": 2,
        "d": {
            "token": token,
            "capabilities": 0,
            "compress": false,
            "properties": {
                "os": operating_system(),
                "browser": app_name,
                "device": "",
                "system_locale": "en-US",
                "client_version": env!("CARGO_PKG_VERSION"),
            },
            "presence": { "status": "online", "since": 0, "activities": [], "afk": false },
        }
    })
}

pub fn spawn(runtime: &tokio::runtime::Handle, url: String, token: String, app_name: String, events: UnboundedSender<GatewayEvent>) -> JoinHandle<()> {
    runtime.spawn(async move {
        let mut backoff = 1;
        loop {
            if events.send(GatewayEvent::Connecting).is_err() {
                return;
            }
            match session(&url, &token, &app_name, &events).await {
                End::AuthFailed => {
                    let _ = events.send(GatewayEvent::AuthFailed);
                    return;
                }
                End::Stopped => return,
                End::Reconnect { was_ready } => {
                    if was_ready {
                        backoff = 1;
                    }
                }
            }
            if events.send(GatewayEvent::Reconnecting(backoff)).is_err() {
                return;
            }
            tokio::time::sleep(Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(MAX_BACKOFF_SECONDS);
        }
    })
}

fn heartbeat(sequence: Option<u64>) -> Frame {
    Frame::Text(json!({ "op": 1, "d": sequence }).to_string().into())
}

async fn session(url: &str, token: &str, app_name: &str, events: &UnboundedSender<GatewayEvent>) -> End {
    let address = format!("{}/?v=9&encoding=json", url.trim_end_matches('/'));
    let Ok((socket, _)) = tokio_tungstenite::connect_async(address).await else {
        return End::Reconnect { was_ready: false };
    };
    let (mut write, mut read) = socket.split();

    let interval = loop {
        match read.next().await {
            Some(Ok(Frame::Text(text))) => {
                let payload: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                if payload["op"] == 10 {
                    break payload["d"]["heartbeat_interval"].as_u64().unwrap_or(41_250).max(1_000);
                }
            }
            Some(Ok(_)) => continue,
            _ => return End::Reconnect { was_ready: false },
        }
    };
    if write.send(Frame::Text(identify(token, app_name).to_string().into())).await.is_err() {
        return End::Reconnect { was_ready: false };
    }

    let mut sequence: Option<u64> = None;
    let mut acknowledged = true;
    let mut was_ready = false;
    let mut ticker = tokio::time::interval(Duration::from_millis(interval));
    ticker.tick().await;

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if !acknowledged {
                    return End::Reconnect { was_ready };
                }
                acknowledged = false;
                if write.send(heartbeat(sequence)).await.is_err() {
                    return End::Reconnect { was_ready };
                }
            }
            frame = read.next() => match frame {
                Some(Ok(Frame::Text(text))) => {
                    let payload: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                    if let Some(s) = payload["s"].as_u64() {
                        sequence = Some(s);
                    }
                    match payload["op"].as_u64() {
                        Some(0) => {
                            let name = payload["t"].as_str().unwrap_or_default().to_string();
                            if name == "READY" {
                                was_ready = true;
                            }
                            let data = payload.get("d").cloned().unwrap_or(Value::Null);
                            if events.send(GatewayEvent::Dispatch(name, data)).is_err() {
                                return End::Stopped;
                            }
                        }
                        Some(1)
                            if write.send(heartbeat(sequence)).await.is_err() => {
                                return End::Reconnect { was_ready };
                            }
                        Some(7) | Some(9) => return End::Reconnect { was_ready },
                        Some(11) => acknowledged = true,
                        _ => {}
                    }
                }
                Some(Ok(Frame::Close(frame))) => {
                    if frame.is_some_and(|frame| u16::from(frame.code) == AUTHENTICATION_FAILED) {
                        return End::AuthFailed;
                    }
                    return End::Reconnect { was_ready };
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => return End::Reconnect { was_ready },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identify_sends_the_token_without_compression() {
        let payload = identify("secret", "OSS Chat");
        assert_eq!(payload["op"], 2);
        assert_eq!(payload["d"]["token"], "secret");
        assert_eq!(payload["d"]["compress"], false);
        assert_eq!(payload["d"]["properties"]["browser"], "OSS Chat");
    }
}
