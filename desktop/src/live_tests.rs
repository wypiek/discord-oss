use crate::api::{Api, ApiError};
use crate::gateway::{self, GatewayEvent};
use crate::model::Ready;
use std::time::Duration;

fn setting(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a running instance: OSS_CHAT_TEST_INSTANCE and OSS_CHAT_TEST_TOKEN"]
async fn talks_to_a_live_instance() {
    let (Some(address), Some(token)) = (setting("OSS_CHAT_TEST_INSTANCE"), setting("OSS_CHAT_TEST_TOKEN")) else {
        panic!("set OSS_CHAT_TEST_INSTANCE and OSS_CHAT_TEST_TOKEN");
    };
    let instance = crate::discovery::discover(&address).await.expect("discovery works");

    let anonymous = Api::new(&instance, None).unwrap();
    match anonymous.login("nobody@example.invalid", "wrong password").await {
        Err(ApiError::Message(message)) => assert!(!message.is_empty()),
        other => panic!("a wrong password should fail with a message, got {other:?}"),
    }

    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let task = gateway::spawn(&tokio::runtime::Handle::current(), instance.gateway(), token.clone(), "OSS Chat".into(), sender);
    let ready = tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(event) = receiver.recv().await {
            match event {
                GatewayEvent::Dispatch(name, data) if name == "READY" => return serde_json::from_value::<Ready>(data).expect("READY parses"),
                GatewayEvent::AuthFailed => panic!("the token was refused"),
                _ => {}
            }
        }
        panic!("the gateway closed before READY");
    })
    .await
    .expect("READY arrives within 20 seconds");
    task.abort();
    assert!(!ready.user.id.is_empty());

    let api = Api::new(&instance, Some(token)).unwrap();
    let guild = ready.guilds.first().expect("the account is in a server");
    let roles = ready
        .merged_members
        .first()
        .and_then(|members| members.first())
        .map(|member| member.roles.clone())
        .unwrap_or_default();
    let listed = crate::app::guild_channels(guild, &ready.user.id, &roles);
    let channel = listed.iter().find(|channel| channel.enabled).expect("a text channel is listed");
    let messages = api.messages(&channel.id, None).await.expect("messages load");
    println!(
        "{}: {} servers, {} DMs, {} channels listed in {}, {} messages in #{}",
        instance.name,
        ready.guilds.len(),
        ready.private_channels.len(),
        listed.len(),
        guild.name,
        messages.len(),
        channel.name
    );
}
