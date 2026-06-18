use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::models::{
    ChatMessage, ChatRequest, ChatResponse, ChatStreamEvent, ChatStreamRequest, ModelConfig,
};

#[derive(Debug, Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChunk {
    choices: Vec<OpenAiStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiStreamDelta,
}

#[derive(Debug, Deserialize)]
struct OpenAiStreamDelta {
    content: Option<String>,
    reasoning: Option<String>,
    reasoning_content: Option<String>,
}

#[derive(Debug, Serialize)]
struct AnthropicChatRequest {
    model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicChatResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamChunk {
    #[serde(rename = "type")]
    event_type: String,
    delta: Option<AnthropicStreamDelta>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamDelta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    text: Option<String>,
    thinking: Option<String>,
}

enum ParsedStreamDelta {
    Content(String),
    Reasoning(String),
}

pub async fn send_chat_completion(
    config: ModelConfig,
    request: ChatRequest,
) -> AppResult<ChatResponse> {
    if is_anthropic_provider(&config.provider) {
        send_anthropic_chat_completion(config, request).await
    } else {
        send_openai_chat_completion(config, request).await
    }
}

pub async fn send_chat_completion_stream(
    app: AppHandle,
    config: ModelConfig,
    request: ChatStreamRequest,
) -> AppResult<()> {
    if is_anthropic_provider(&config.provider) {
        send_anthropic_chat_completion_stream(app, config, request).await
    } else {
        send_openai_chat_completion_stream(app, config, request).await
    }
}

async fn send_openai_chat_completion(
    config: ModelConfig,
    request: ChatRequest,
) -> AppResult<ChatResponse> {
    ensure_api_key(&config)?;
    let endpoint = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );
    let payload = OpenAiChatRequest {
        model: config.model,
        messages: request.messages,
        temperature: request.temperature.unwrap_or(0.4),
        stream: None,
    };

    let client = reqwest::Client::new();
    let mut builder = client
        .post(endpoint)
        .header("content-type", "application/json")
        .json(&payload);

    if !config.api_key.trim().is_empty() {
        builder = builder.bearer_auth(config.api_key);
    }

    let response = builder.send().await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(AppError::Message(format!(
            "model request failed with {status}: {text}"
        )));
    }

    let parsed: OpenAiChatResponse = serde_json::from_str(&text)?;
    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .ok_or_else(|| AppError::Message("model returned no choices".to_string()))?;

    Ok(ChatResponse { content })
}

async fn send_anthropic_chat_completion(
    config: ModelConfig,
    request: ChatRequest,
) -> AppResult<ChatResponse> {
    ensure_api_key(&config)?;
    let endpoint = anthropic_messages_endpoint(&config.base_url);
    let payload = build_anthropic_payload(
        config.model,
        request.messages,
        request.temperature.unwrap_or(0.4),
        None,
    );

    let response = reqwest::Client::new()
        .post(endpoint)
        .header("content-type", "application/json")
        .header("x-api-key", config.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&payload)
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(AppError::Message(format!(
            "model request failed with {status}: {text}"
        )));
    }

    let parsed: AnthropicChatResponse = serde_json::from_str(&text)?;
    let content = parsed
        .content
        .into_iter()
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("");

    Ok(ChatResponse { content })
}

async fn send_openai_chat_completion_stream(
    app: AppHandle,
    config: ModelConfig,
    request: ChatStreamRequest,
) -> AppResult<()> {
    if let Err(err) = ensure_api_key(&config) {
        emit_stream_error(&app, &request.request_id, &err.to_string());
        return Ok(());
    }

    let endpoint = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );
    let payload = OpenAiChatRequest {
        model: config.model,
        messages: request.messages,
        temperature: request.temperature.unwrap_or(0.4),
        stream: Some(true),
    };

    let mut builder = reqwest::Client::new()
        .post(endpoint)
        .header("content-type", "application/json")
        .json(&payload);

    if !config.api_key.trim().is_empty() {
        builder = builder.bearer_auth(config.api_key);
    }

    stream_sse_response(app, request.request_id, builder, StreamProvider::OpenAi).await
}

async fn send_anthropic_chat_completion_stream(
    app: AppHandle,
    config: ModelConfig,
    request: ChatStreamRequest,
) -> AppResult<()> {
    if let Err(err) = ensure_api_key(&config) {
        emit_stream_error(&app, &request.request_id, &err.to_string());
        return Ok(());
    }

    let endpoint = anthropic_messages_endpoint(&config.base_url);
    let payload = build_anthropic_payload(
        config.model,
        request.messages,
        request.temperature.unwrap_or(0.4),
        Some(true),
    );
    let builder = reqwest::Client::new()
        .post(endpoint)
        .header("content-type", "application/json")
        .header("x-api-key", config.api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&payload);

    stream_sse_response(app, request.request_id, builder, StreamProvider::Anthropic).await
}

async fn stream_sse_response(
    app: AppHandle,
    request_id: String,
    builder: reqwest::RequestBuilder,
    provider: StreamProvider,
) -> AppResult<()> {
    let response = match builder.send().await {
        Ok(response) => response,
        Err(err) => {
            emit_stream_error(&app, &request_id, &err.to_string());
            return Ok(());
        }
    };
    let status = response.status();

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        emit_stream_error(
            &app,
            &request_id,
            &format!("model request failed with {status}: {text}"),
        );
        return Ok(());
    }

    let mut buffer = String::new();
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                emit_stream_error(&app, &request_id, &err.to_string());
                return Ok(());
            }
        };

        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();
            process_sse_line(&app, &request_id, &line, provider)?;
        }
    }

    if !buffer.trim().is_empty() {
        process_sse_line(&app, &request_id, buffer.trim(), provider)?;
    }

    app.emit("chat-stream", ChatStreamEvent::Done { request_id })
        .map_err(|err| AppError::Message(err.to_string()))?;
    Ok(())
}

fn process_sse_line(
    app: &AppHandle,
    request_id: &str,
    line: &str,
    provider: StreamProvider,
) -> AppResult<()> {
    if line.is_empty() || line.starts_with(':') || !line.starts_with("data:") {
        return Ok(());
    }

    let data = line.trim_start_matches("data:").trim();
    if data == "[DONE]" {
        return Ok(());
    }

    let delta = match provider {
        StreamProvider::OpenAi => parse_openai_delta(data),
        StreamProvider::Anthropic => parse_anthropic_delta(data),
    };

    if let Some(delta) = delta {
        let event = match delta {
            ParsedStreamDelta::Content(content) => ChatStreamEvent::Delta {
                request_id: request_id.to_string(),
                content,
            },
            ParsedStreamDelta::Reasoning(content) => ChatStreamEvent::ReasoningDelta {
                request_id: request_id.to_string(),
                content,
            },
        };

        app.emit(
            "chat-stream",
            event,
        )
        .map_err(|err| AppError::Message(err.to_string()))?;
    }

    Ok(())
}

fn parse_openai_delta(data: &str) -> Option<ParsedStreamDelta> {
    let parsed: OpenAiStreamChunk = serde_json::from_str(data).ok()?;
    let mut content_parts = Vec::new();
    let mut reasoning_parts = Vec::new();

    for choice in parsed.choices {
        if let Some(content) = choice.delta.content {
            content_parts.push(content);
        }
        if let Some(reasoning) = choice.delta.reasoning_content {
            reasoning_parts.push(reasoning);
        }
        if let Some(reasoning) = choice.delta.reasoning {
            reasoning_parts.push(reasoning);
        }
    }

    let content = content_parts.join("");
    if !content.is_empty() {
        return Some(ParsedStreamDelta::Content(content));
    }

    let reasoning = reasoning_parts.join("");
    if !reasoning.is_empty() {
        return Some(ParsedStreamDelta::Reasoning(reasoning));
    }

    None
}

fn parse_anthropic_delta(data: &str) -> Option<ParsedStreamDelta> {
    let parsed: AnthropicStreamChunk = serde_json::from_str(data).ok()?;
    if parsed.event_type != "content_block_delta" {
        return None;
    }
    let delta = parsed.delta?;

    if delta.delta_type.as_deref() == Some("thinking_delta") {
        return delta
            .thinking
            .filter(|thinking| !thinking.is_empty())
            .map(ParsedStreamDelta::Reasoning);
    }

    delta
        .text
        .filter(|text| !text.is_empty())
        .map(ParsedStreamDelta::Content)
}

fn build_anthropic_payload(
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    stream: Option<bool>,
) -> AnthropicChatRequest {
    let mut system_parts = Vec::new();
    let mut anthropic_messages = Vec::new();

    for message in messages {
        if message.role == "system" {
            system_parts.push(message.content);
            continue;
        }

        anthropic_messages.push(AnthropicMessage {
            role: if message.role == "assistant" {
                "assistant".to_string()
            } else {
                "user".to_string()
            },
            content: message.content,
        });
    }

    AnthropicChatRequest {
        model,
        system: if system_parts.is_empty() {
            None
        } else {
            Some(system_parts.join("\n\n"))
        },
        messages: anthropic_messages,
        max_tokens: 4096,
        temperature,
        stream,
    }
}

fn anthropic_messages_endpoint(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    }
}

fn ensure_api_key(config: &ModelConfig) -> AppResult<()> {
    if config.api_key.trim().is_empty() && !config.base_url.contains("localhost") {
        return Err(AppError::Message("missing api key".to_string()));
    }
    Ok(())
}

fn is_anthropic_provider(provider: &str) -> bool {
    let provider = provider.trim().to_lowercase();
    provider == "anthropic" || provider == "claude"
}

#[derive(Debug, Clone, Copy)]
enum StreamProvider {
    OpenAi,
    Anthropic,
}

fn emit_stream_error(app: &AppHandle, request_id: &str, message: &str) {
    let _ = app.emit(
        "chat-stream",
        ChatStreamEvent::Error {
            request_id: request_id.to_string(),
            message: message.to_string(),
        },
    );
}
