use chrono::{DateTime, Local, TimeZone, Utc};

pub struct Names<'a> {
    pub user: &'a dyn Fn(&str) -> Option<String>,
    pub channel: &'a dyn Fn(&str) -> Option<String>,
    pub role: &'a dyn Fn(&str) -> Option<String>,
}

fn token_end(text: &str) -> Option<usize> {
    text.find('>').filter(|end| *end <= 80)
}

fn format_unix(seconds: i64, style: &str) -> Option<String> {
    let time = Local.timestamp_opt(seconds, 0).single()?;
    Some(match style {
        "t" => time.format("%H:%M").to_string(),
        "T" => time.format("%H:%M:%S").to_string(),
        "d" => time.format("%d/%m/%Y").to_string(),
        "D" => time.format("%-d %B %Y").to_string(),
        "F" => time.format("%A, %-d %B %Y %H:%M").to_string(),
        "R" => relative(time.with_timezone(&Utc), Utc::now()),
        _ => time.format("%-d %B %Y %H:%M").to_string(),
    })
}

fn relative(time: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let seconds = (now - time).num_seconds();
    let (amount, unit) = match seconds.abs() {
        s if s < 60 => (s, "second"),
        s if s < 3600 => (s / 60, "minute"),
        s if s < 86_400 => (s / 3600, "hour"),
        s if s < 2_592_000 => (s / 86_400, "day"),
        s if s < 31_536_000 => (s / 2_592_000, "month"),
        s => (s / 31_536_000, "year"),
    };
    let plural = if amount == 1 { "" } else { "s" };
    if seconds >= 0 {
        format!("{amount} {unit}{plural} ago")
    } else {
        format!("in {amount} {unit}{plural}")
    }
}

fn replace_token(token: &str, names: &Names) -> Option<String> {
    let inner = token.strip_prefix('<')?.strip_suffix('>')?;
    if let Some(id) = inner.strip_prefix("@&") {
        return Some(format!("@{}", (names.role)(id).unwrap_or_else(|| "deleted-role".into())));
    }
    if let Some(id) = inner.strip_prefix("@!").or_else(|| inner.strip_prefix('@')) {
        return id
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| format!("@{}", (names.user)(id).unwrap_or_else(|| "unknown-user".into())));
    }
    if let Some(id) = inner.strip_prefix('#') {
        return id
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| format!("#{}", (names.channel)(id).unwrap_or_else(|| "unknown-channel".into())));
    }
    if let Some(rest) = inner.strip_prefix("a:").or_else(|| inner.strip_prefix(':')) {
        let (name, id) = rest.split_once(':')?;
        return id.bytes().all(|b| b.is_ascii_digit()).then(|| format!(":{name}:"));
    }
    if let Some(rest) = inner.strip_prefix("t:") {
        let (seconds, style) = rest.split_once(':').unwrap_or((rest, "f"));
        return format_unix(seconds.parse().ok()?, style);
    }
    None
}

pub fn render(content: &str, names: &Names) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let candidate = &rest[start..];
        match token_end(candidate).and_then(|end| replace_token(&candidate[..=end], names).map(|text| (end, text))) {
            Some((end, text)) => {
                out.push_str(&text);
                rest = &candidate[end + 1..];
            }
            None => {
                out.push('<');
                rest = &candidate[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn parse_time(timestamp: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(timestamp).ok().map(|time| time.with_timezone(&Local))
}

pub fn message_time(timestamp: &str, now: DateTime<Local>) -> String {
    let Some(time) = parse_time(timestamp) else {
        return String::new();
    };
    let days = (now.date_naive() - time.date_naive()).num_days();
    match days {
        0 => format!("Today at {}", time.format("%H:%M")),
        1 => format!("Yesterday at {}", time.format("%H:%M")),
        _ => time.format("%d/%m/%Y %H:%M").to_string(),
    }
}

pub fn initials(name: &str) -> String {
    let initials: String = name.split_whitespace().filter_map(|word| word.chars().next()).take(3).collect();
    if initials.is_empty() {
        "?".into()
    } else {
        initials
    }
}

pub fn file_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(id: &str) -> Option<String> {
        (id == "1").then(|| "tester".to_string())
    }

    fn channel(id: &str) -> Option<String> {
        (id == "2").then(|| "general".to_string())
    }

    fn role(id: &str) -> Option<String> {
        (id == "3").then(|| "Mods".to_string())
    }

    #[test]
    fn mentions_channels_roles_and_emoji_become_text() {
        let names = Names {
            user: &user,
            channel: &channel,
            role: &role,
        };
        assert_eq!(
            render("hi <@1> and <@!1> in <#2>, <@&3> <:blob:123> <a:dance:456>", &names),
            "hi @tester and @tester in #general, @Mods :blob: :dance:"
        );
        assert_eq!(render("<@9> a < b <notatoken>", &names), "@unknown-user a < b <notatoken>");
    }

    #[test]
    fn relative_times_read_naturally() {
        let now = Utc.timestamp_opt(1_000_000, 0).unwrap();
        assert_eq!(relative(Utc.timestamp_opt(1_000_000 - 7200, 0).unwrap(), now), "2 hours ago");
        assert_eq!(relative(Utc.timestamp_opt(1_000_000 + 60, 0).unwrap(), now), "in 1 minute");
    }

    #[test]
    fn helpers_format_names_and_sizes() {
        assert_eq!(initials("Test Guild"), "TG");
        assert_eq!(initials(""), "?");
        assert_eq!(file_size(512), "512 B");
        assert_eq!(file_size(1536), "1.5 KB");
    }
}
