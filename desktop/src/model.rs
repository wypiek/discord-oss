use serde::{Deserialize, Deserializer};
use serde_json::Value;

pub mod channel_type {
    pub const GUILD_TEXT: u8 = 0;
    pub const DM: u8 = 1;
    pub const GUILD_VOICE: u8 = 2;
    pub const GROUP_DM: u8 = 3;
    pub const GUILD_CATEGORY: u8 = 4;
    pub const GUILD_ANNOUNCEMENT: u8 = 5;
    pub const GUILD_STAGE_VOICE: u8 = 13;
    pub const GUILD_FORUM: u8 = 15;
    pub const GUILD_MEDIA: u8 = 16;
}

fn bitfield<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u128, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) => text.parse().unwrap_or(0),
        Value::Number(number) => number.as_u64().map(u128::from).unwrap_or(0),
        _ => 0,
    })
}

fn overwrite_kind<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Number(number) => number.as_u64() == Some(1),
        Value::String(text) => text == "1" || text == "member",
        _ => false,
    })
}

fn null_as_default<'de, D: Deserializer<'de>, T: Default + Deserialize<'de>>(deserializer: D) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct User {
    pub id: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub username: String,
    #[serde(default)]
    pub global_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
}

impl User {
    pub fn display_name(&self) -> String {
        self.global_name.clone().filter(|name| !name.trim().is_empty()).unwrap_or_else(|| self.username.clone())
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Role {
    pub id: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub name: String,
    #[serde(default, deserialize_with = "bitfield")]
    pub permissions: u128,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Overwrite {
    pub id: String,
    #[serde(rename = "type", default, deserialize_with = "overwrite_kind")]
    pub is_member: bool,
    #[serde(default, deserialize_with = "bitfield")]
    pub allow: u128,
    #[serde(default, deserialize_with = "bitfield")]
    pub deny: u128,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Channel {
    pub id: String,
    #[serde(rename = "type", default, deserialize_with = "null_as_default")]
    pub kind: u8,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub guild_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub position: i64,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub permission_overwrites: Vec<Overwrite>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub recipients: Vec<User>,
    #[serde(default)]
    pub last_message_id: Option<String>,
}

impl Channel {
    pub fn is_private(&self) -> bool {
        matches!(self.kind, channel_type::DM | channel_type::GROUP_DM)
    }

    pub fn is_text(&self) -> bool {
        matches!(
            self.kind,
            channel_type::GUILD_TEXT | channel_type::GUILD_ANNOUNCEMENT | channel_type::DM | channel_type::GROUP_DM
        )
    }

    pub fn is_encrypted(&self) -> bool {
        self.is_private()
    }

    pub fn title(&self, me: &str) -> String {
        if let Some(name) = self.name.as_deref().filter(|name| !name.trim().is_empty()) {
            return name.to_string();
        }
        let others: Vec<String> = self.recipients.iter().filter(|user| user.id != me).map(User::display_name).collect();
        if others.is_empty() {
            "Notes to self".into()
        } else {
            others.join(", ")
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Guild {
    pub id: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub owner_id: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub roles: Vec<Role>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub channels: Vec<Channel>,
    #[serde(default)]
    pub unavailable: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Member {
    #[serde(default)]
    pub user: Option<User>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub roles: Vec<String>,
    #[serde(default)]
    pub guild_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Ready {
    pub user: User,
    #[serde(default, deserialize_with = "null_as_default")]
    pub guilds: Vec<Guild>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub private_channels: Vec<Channel>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub merged_members: Vec<Vec<Member>>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub users: Vec<User>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Attachment {
    #[serde(default, deserialize_with = "null_as_default")]
    pub filename: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub url: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub size: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct StickerItem {
    #[serde(default, deserialize_with = "null_as_default")]
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    #[serde(default)]
    pub author: User,
    #[serde(default, deserialize_with = "null_as_default")]
    pub content: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub timestamp: String,
    #[serde(default)]
    pub edited_timestamp: Option<String>,
    #[serde(rename = "type", default, deserialize_with = "null_as_default")]
    pub kind: u8,
    #[serde(default, deserialize_with = "null_as_default")]
    pub attachments: Vec<Attachment>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub sticker_items: Vec<StickerItem>,
    #[serde(default)]
    pub encrypted: Option<Value>,
}

impl Message {
    pub fn is_encrypted(&self) -> bool {
        self.encrypted.as_ref().is_some_and(|value| !value.is_null())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageDelete {
    pub id: String,
    pub channel_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GuildDelete {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoleEvent {
    pub guild_id: String,
    #[serde(default)]
    pub role: Option<Role>,
    #[serde(default)]
    pub role_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_from_the_server_parses() {
        let ready: Ready = serde_json::from_value(serde_json::json!({
            "user": { "id": "1", "username": "tester", "global_name": null },
            "guilds": [{
                "id": "10", "name": "Test Guild", "icon": null, "owner_id": "1",
                "roles": [{ "id": "10", "name": "@everyone", "permissions": "1071698660929", "position": 0 }],
                "channels": [
                    { "id": "11", "type": 4, "name": "Text Channels", "parent_id": null, "position": 0, "permission_overwrites": [] },
                    { "id": "12", "type": 0, "name": "general", "parent_id": "11", "position": 1, "permission_overwrites": [{ "id": "10", "type": 0, "allow": "0", "deny": "2048" }] }
                ]
            }],
            "private_channels": [{ "id": "20", "type": 1, "last_message_id": null, "recipients": [{ "id": "2", "username": "friend" }] }],
            "merged_members": [[{ "id": "1", "roles": [], "nick": null }]],
            "users": [{ "id": "2", "username": "friend" }]
        }))
        .unwrap();
        assert_eq!(ready.guilds[0].roles[0].permissions, 1071698660929);
        assert_eq!(ready.guilds[0].channels[1].permission_overwrites[0].deny, 2048);
        assert!(!ready.guilds[0].channels[1].permission_overwrites[0].is_member);
        assert_eq!(ready.private_channels[0].title("1"), "friend");
    }

    #[test]
    fn an_encrypted_message_is_recognised() {
        let message: Message = serde_json::from_value(serde_json::json!({
            "id": "5", "channel_id": "20", "author": { "id": "2", "username": "friend" },
            "content": "🔒 Encrypted message", "timestamp": "2026-11-11T16:27:13.668Z", "encrypted": { "v": 1 }
        }))
        .unwrap();
        assert!(message.is_encrypted());
    }
}
