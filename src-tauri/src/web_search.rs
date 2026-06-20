use scraper::{Html, Selector};
use serde_json::Value;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::error::{AppError, AppResult};
use crate::models::{WebSearchResponse, WebSearchResult, WebSearchStatus};

pub async fn internet_search(
    query: &str,
    tavily_api_key: Option<&str>,
) -> AppResult<WebSearchResponse> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(WebSearchResponse {
            results: Vec::new(),
            status: WebSearchStatus {
                engine: "none".to_string(),
                used_fallback: false,
                fallback_reason: None,
            },
        });
    }

    match tavily_search(query, tavily_api_key).await {
        Ok(results) if !results.is_empty() => {
            return Ok(WebSearchResponse {
                results,
                status: WebSearchStatus {
                    engine: "tavily".to_string(),
                    used_fallback: false,
                    fallback_reason: None,
                },
            });
        }
        Ok(_) => {}
        Err(error) => {
            let results = duckduckgo_search(query).await?;
            return Ok(WebSearchResponse {
                results,
                status: WebSearchStatus {
                    engine: "duckduckgo".to_string(),
                    used_fallback: true,
                    fallback_reason: Some(error.to_string()),
                },
            });
        }
    }

    let results = duckduckgo_search(query).await?;
    Ok(WebSearchResponse {
        results,
        status: WebSearchStatus {
            engine: "duckduckgo".to_string(),
            used_fallback: true,
            fallback_reason: Some("Tavily returned no results".to_string()),
        },
    })
}

async fn tavily_search(query: &str, tavily_api_key: Option<&str>) -> AppResult<Vec<WebSearchResult>> {
    let mut last_error = None;
    for command in tavily_commands() {
        match run_tavily_command(command, query, tavily_api_key).await {
            Ok(results) => return Ok(results),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| AppError::Message("Tavily CLI is not available".to_string())))
}

fn tavily_commands() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["tvly", "tvly.cmd"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["tvly"]
    }
}

async fn run_tavily_command(
    command: &str,
    query: &str,
    tavily_api_key: Option<&str>,
) -> AppResult<Vec<WebSearchResult>> {
    let mut child = Command::new(command);
    child.args(["search", query, "--json"]);
    if let Some(api_key) = tavily_api_key.map(str::trim).filter(|key| !key.is_empty()) {
        child.env("TAVILY_API_KEY", api_key);
    }

    #[cfg(target_os = "windows")]
    {
        child.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = timeout(Duration::from_secs(12), child.output())
        .await
        .map_err(|_| AppError::Message("Tavily search timed out".to_string()))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Message(if stderr.is_empty() {
            "Tavily search failed".to_string()
        } else {
            format!("Tavily search failed: {stderr}")
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_tavily_results(&stdout)
}

fn parse_tavily_results(stdout: &str) -> AppResult<Vec<WebSearchResult>> {
    let json_text = extract_json(stdout)
        .ok_or_else(|| AppError::Message("Tavily search returned no JSON".to_string()))?;
    let value: Value = serde_json::from_str(json_text)?;
    let items = if let Some(results) = value.get("results").and_then(Value::as_array) {
        results
    } else if let Some(results) = value
        .get("data")
        .and_then(|data| data.get("results"))
        .and_then(Value::as_array)
    {
        results
    } else if let Some(results) = value.as_array() {
        results
    } else {
        return Ok(Vec::new());
    };

    let mut results = Vec::new();
    for item in items.iter().take(8) {
        let title = item
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let url = item
            .get("url")
            .or_else(|| item.get("link"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let snippet = item
            .get("content")
            .or_else(|| item.get("snippet"))
            .or_else(|| item.get("description"))
            .or_else(|| item.get("raw_content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");

        if !title.is_empty() && !url.is_empty() {
            results.push(WebSearchResult {
                title,
                url,
                snippet,
            });
        }
    }

    Ok(results)
}

fn extract_json(output: &str) -> Option<&str> {
    let trimmed = output.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Some(trimmed);
    }

    let object_index = trimmed.find('{');
    let array_index = trimmed.find('[');
    match (object_index, array_index) {
        (Some(object), Some(array)) => Some(&trimmed[object.min(array)..]),
        (Some(object), None) => Some(&trimmed[object..]),
        (None, Some(array)) => Some(&trimmed[array..]),
        (None, None) => None,
    }
}

async fn duckduckgo_search(query: &str) -> AppResult<Vec<WebSearchResult>> {
    let url = format!(
        "https://duckduckgo.com/html/?q={}",
        urlencoding::encode(query)
    );
    let html = reqwest::Client::new()
        .get(url)
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NanoAgent/0.1",
        )
        .send()
        .await?
        .text()
        .await?;

    parse_duckduckgo_results(&html)
}

fn parse_duckduckgo_results(html: &str) -> AppResult<Vec<WebSearchResult>> {
    let document = Html::parse_document(html);
    let result_selector = Selector::parse(".result")
        .map_err(|err| AppError::Message(format!("search parser error: {err}")))?;
    let title_selector = Selector::parse(".result__a")
        .map_err(|err| AppError::Message(format!("search parser error: {err}")))?;
    let snippet_selector = Selector::parse(".result__snippet")
        .map_err(|err| AppError::Message(format!("search parser error: {err}")))?;

    let mut results = Vec::new();
    for result in document.select(&result_selector).take(6) {
        let Some(title_node) = result.select(&title_selector).next() else {
            continue;
        };
        let title = title_node
            .text()
            .collect::<Vec<_>>()
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let url = title_node
            .value()
            .attr("href")
            .unwrap_or_default()
            .to_string();
        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|node| {
                node.text()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();

        if !title.is_empty() && !url.is_empty() {
            results.push(WebSearchResult {
                title,
                url: normalize_duckduckgo_url(&url),
                snippet,
            });
        }
    }

    Ok(results)
}

fn normalize_duckduckgo_url(url: &str) -> String {
    if let Some(encoded) = url.split("uddg=").nth(1) {
        let encoded = encoded.split('&').next().unwrap_or(encoded);
        if let Ok(decoded) = urlencoding::decode(encoded) {
            return decoded.into_owned();
        }
    }

    url.to_string()
}
