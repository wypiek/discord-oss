use crate::model::{Channel, Guild};

pub const ADMINISTRATOR: u128 = 1 << 3;
pub const VIEW_CHANNEL: u128 = 1 << 10;
pub const SEND_MESSAGES: u128 = 1 << 11;
const ALL: u128 = u128::MAX;

pub fn base(guild: &Guild, user_id: &str, member_roles: &[String]) -> u128 {
    if guild.owner_id == user_id {
        return ALL;
    }
    let mut permissions = guild.roles.iter().find(|role| role.id == guild.id).map(|role| role.permissions).unwrap_or(0);
    for role in &guild.roles {
        if member_roles.contains(&role.id) {
            permissions |= role.permissions;
        }
    }
    if permissions & ADMINISTRATOR != 0 {
        ALL
    } else {
        permissions
    }
}

pub fn in_channel(guild: &Guild, user_id: &str, member_roles: &[String], channel: &Channel) -> u128 {
    let mut permissions = base(guild, user_id, member_roles);
    if permissions == ALL {
        return ALL;
    }
    if let Some(everyone) = channel.permission_overwrites.iter().find(|overwrite| !overwrite.is_member && overwrite.id == guild.id) {
        permissions &= !everyone.deny;
        permissions |= everyone.allow;
    }
    let (mut allow, mut deny) = (0, 0);
    for overwrite in channel
        .permission_overwrites
        .iter()
        .filter(|overwrite| !overwrite.is_member && member_roles.contains(&overwrite.id))
    {
        allow |= overwrite.allow;
        deny |= overwrite.deny;
    }
    permissions &= !deny;
    permissions |= allow;
    if let Some(member) = channel.permission_overwrites.iter().find(|overwrite| overwrite.is_member && overwrite.id == user_id) {
        permissions &= !member.deny;
        permissions |= member.allow;
    }
    permissions
}

pub fn can(permissions: u128, flag: u128) -> bool {
    permissions & flag == flag
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Overwrite, Role};

    fn guild() -> Guild {
        Guild {
            id: "g".into(),
            owner_id: "owner".into(),
            roles: vec![
                Role {
                    id: "g".into(),
                    permissions: VIEW_CHANNEL | SEND_MESSAGES,
                    ..Default::default()
                },
                Role {
                    id: "mods".into(),
                    permissions: 0,
                    ..Default::default()
                },
                Role {
                    id: "admins".into(),
                    permissions: ADMINISTRATOR,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    fn channel(overwrites: Vec<Overwrite>) -> Channel {
        Channel {
            id: "c".into(),
            permission_overwrites: overwrites,
            ..Default::default()
        }
    }

    fn overwrite(id: &str, is_member: bool, allow: u128, deny: u128) -> Overwrite {
        Overwrite {
            id: id.into(),
            is_member,
            allow,
            deny,
        }
    }

    #[test]
    fn everyone_can_read_and_send_by_default() {
        let permissions = in_channel(&guild(), "user", &[], &channel(vec![]));
        assert!(can(permissions, VIEW_CHANNEL | SEND_MESSAGES));
    }

    #[test]
    fn a_private_channel_opens_only_for_its_role() {
        let private = channel(vec![overwrite("g", false, 0, VIEW_CHANNEL), overwrite("mods", false, VIEW_CHANNEL, 0)]);
        assert!(!can(in_channel(&guild(), "user", &[], &private), VIEW_CHANNEL));
        assert!(can(in_channel(&guild(), "user", &["mods".into()], &private), VIEW_CHANNEL));
    }

    #[test]
    fn a_member_overwrite_beats_role_overwrites() {
        let muted = channel(vec![overwrite("mods", false, SEND_MESSAGES, 0), overwrite("user", true, 0, SEND_MESSAGES)]);
        assert!(!can(in_channel(&guild(), "user", &["mods".into()], &muted), SEND_MESSAGES));
    }

    #[test]
    fn owners_and_administrators_see_everything() {
        let hidden = channel(vec![overwrite("g", false, 0, VIEW_CHANNEL)]);
        assert!(can(in_channel(&guild(), "owner", &[], &hidden), VIEW_CHANNEL));
        assert!(can(in_channel(&guild(), "user", &["admins".into()], &hidden), VIEW_CHANNEL));
    }
}
