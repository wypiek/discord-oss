use crate::discovery::{http_client, Instance};
use crate::model::Message;
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum ApiError {
    Unauthorized,
    Message(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Unauthorized => write!(f, "Your session has ended. Log in again."),
            ApiError::Message(message) => write!(f, "{message}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum LoginOutcome {
    Token(String),
    SecondFactor { ticket: String },
    Captcha,
}

#[derive(Clone)]
pub struct Api {
    client: reqwest::Client,
    base: String,
    token: Option<String>,
}

pub fn error_message(status: u16, body: &Value) -> String {
    fn first_field_error(value: &Value) -> Option<String> {
        if let Some(errors) = value.get("_errors").and_then(Value::as_array) {
            return errors.first().and_then(|error| error.get("message")).and_then(Value::as_str).map(str::to_string);
        }
        value.as_object()?.values().find_map(first_field_error)
    }
    if let Some(retry) = body.get("retry_after").and_then(Value::as_f64) {
        return format!("You're doing that too fast. Try again in {} seconds.", retry.ceil().max(1.0));
    }
    body.get("errors")
        .and_then(first_field_error)
        .or_else(|| body.get("message").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| format!("The instance answered {status}."))
}

pub fn login_outcome(status: u16, body: &Value) -> Result<LoginOutcome, ApiError> {
    if body.get("captcha_key").is_some() {
        return Ok(LoginOutcome::Captcha);
    }
    if !(200..300).contains(&status) {
        return Err(ApiError::Message(error_message(status, body)));
    }
    if let Some(token) = body.get("token").and_then(Value::as_str).filter(|token| !token.is_empty()) {
        return Ok(LoginOutcome::Token(token.to_string()));
    }
    if body.get("mfa").and_then(Value::as_bool) == Some(true) {
        if let Some(ticket) = body.get("ticket").and_then(Value::as_str) {
            return Ok(LoginOutcome::SecondFactor { ticket: ticket.to_string() });
        }
    }
    Err(ApiError::Message("The instance didn't log you in.".into()))
}

pub fn second_factor_kind(code: &str) -> &'static str {
    let digits = code.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    if digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_digit()) {
        "totp"
    } else {
        "backup"
    }
}

fn nonce() -> String {
    let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) as u64;
    ((millis.saturating_sub(1_420_070_400_000)) << 22).to_string()
}

impl Api {
    pub fn new(instance: &Instance, token: Option<String>) -> Result<Self, String> {
        Ok(Self {
            client: http_client()?,
            base: instance.api(),
            token,
        })
    }

    async fn request(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<(u16, Value), ApiError> {
        let mut request = self.client.request(method, format!("{}{path}", self.base));
        if let Some(token) = &self.token {
            request = request.header(reqwest::header::AUTHORIZATION, token);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|error| {
            ApiError::Message(if error.is_timeout() {
                "The instance took too long to answer.".into()
            } else {
                "Couldn't reach the instance. Check your connection.".into()
            })
        })?;
        let status = response.status().as_u16();
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        if status == 401 && self.token.is_some() {
            return Err(ApiError::Unauthorized);
        }
        Ok((status, body))
    }

    async fn expect<T: serde::de::DeserializeOwned>(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<T, ApiError> {
        let (status, body) = self.request(method, path, body).await?;
        if !(200..300).contains(&status) {
            return Err(ApiError::Message(error_message(status, &body)));
        }
        serde_json::from_value(body).map_err(|_| ApiError::Message("The instance sent something the app didn't understand.".into()))
    }

    pub async fn login(&self, login: &str, password: &str) -> Result<LoginOutcome, ApiError> {
        let (status, body) = self
            .request(
                reqwest::Method::POST,
                "/auth/login",
                Some(json!({ "login": login.trim(), "password": password, "undelete": false, "login_source": null, "gift_code_sku_id": null })),
            )
            .await?;
        login_outcome(status, &body)
    }

    pub async fn second_factor(&self, ticket: &str, code: &str) -> Result<String, ApiError> {
        let code: String = code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
        let (status, body) = self
            .request(
                reqwest::Method::POST,
                &format!("/auth/mfa/{}", second_factor_kind(&code)),
                Some(json!({ "code": code, "ticket": ticket })),
            )
            .await?;
        match login_outcome(status, &body)? {
            LoginOutcome::Token(token) => Ok(token),
            _ => Err(ApiError::Message("That code didn't work.".into())),
        }
    }

    pub async fn logout(&self) {
        let _ = self
            .request(reqwest::Method::POST, "/auth/logout", Some(json!({ "provider": null, "voip_provider": null })))
            .await;
    }

    pub async fn messages(&self, channel_id: &str, before: Option<&str>) -> Result<Vec<Message>, ApiError> {
        let before = before.map(|id| format!("&before={id}")).unwrap_or_default();
        let mut messages: Vec<Message> = self
            .expect(reqwest::Method::GET, &format!("/channels/{channel_id}/messages?limit=50{before}"), None)
            .await?;
        messages.reverse();
        Ok(messages)
    }

    pub async fn send(&self, channel_id: &str, content: &str) -> Result<Message, ApiError> {
        self.expect(
            reqwest::Method::POST,
            &format!("/channels/{channel_id}/messages"),
            Some(json!({ "content": content, "nonce": nonce(), "tts": false })),
        )
        .await
    }

    pub async fn image(&self, url: &str) -> Option<Vec<u8>> {
        let response = self.client.get(url).send().await.ok()?;
        if !response.status().is_success() || response.content_length().is_some_and(|length| length > 4 * 1024 * 1024) {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        (bytes.len() <= 4 * 1024 * 1024).then(|| bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_answers_are_understood() {
        assert_eq!(login_outcome(200, &json!({ "token": "abc", "user_id": "1" })), Ok(LoginOutcome::Token("abc".into())));
        assert_eq!(
            login_outcome(200, &json!({ "token": null, "mfa": true, "ticket": "t" })),
            Ok(LoginOutcome::SecondFactor { ticket: "t".into() })
        );
        assert_eq!(
            login_outcome(400, &json!({ "captcha_key": ["captcha-required"], "captcha_service": "cap" })),
            Ok(LoginOutcome::Captcha)
        );
        assert_eq!(
            login_outcome(
                400,
                &json!({ "code": 50035, "message": "Invalid Form Body", "errors": { "login": { "_errors": [{ "code": "INVALID_LOGIN", "message": "Login or password is invalid." }] } } })
            ),
            Err(ApiError::Message("Login or password is invalid.".into()))
        );
    }

    #[test]
    fn rate_limits_and_codes_read_well() {
        assert_eq!(error_message(429, &json!({ "retry_after": 2.4 })), "You're doing that too fast. Try again in 3 seconds.");
        assert_eq!(error_message(403, &json!({ "message": "Missing Permissions", "code": 50013 })), "Missing Permissions");
        assert_eq!(second_factor_kind("123 456"), "totp");
        assert_eq!(second_factor_kind("abcd-efgh"), "backup");
    }

    #[test]
    fn nonces_are_snowflake_shaped() {
        let value: u64 = nonce().parse().unwrap();
        assert!(value > (1 << 22));
    }
}
