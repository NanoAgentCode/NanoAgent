use scraper::{Html, Selector};

use crate::error::{AppError, AppResult};
use crate::models::WebSearchResult;

pub async fn internet_search(query: &str) -> AppResult<Vec<WebSearchResult>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

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
        let url = title_node.value().attr("href").unwrap_or_default().to_string();
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
