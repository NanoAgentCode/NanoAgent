use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Semaphore;

use crate::error::{AppError, AppResult};

const ANTHROPIC_SKILLS_API: &str =
    "https://api.github.com/repos/anthropics/skills/contents/skills?ref=main";
const RAW_SKILL_BASE: &str = "https://raw.githubusercontent.com/anthropics/skills/main/skills";
const USER_AGENT: &str = "NanoAgent/0.1 (https://github.com/NanoAgentCode/NanoAgent)";

/// Maximum concurrent HTTP requests when fetching individual SKILL.md files.
/// Keeps us well below GitHub's unauthenticated rate limit (60 req / hr) for
/// small skill counts while still parallelising the work.
const MAX_CONCURRENT_FETCHES: usize = 4;

#[derive(Debug, Clone, Serialize)]
pub struct GitHubSkill {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub doc_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubContentItem {
    name: String,
    #[serde(rename = "type")]
    item_type: String,
}

#[derive(Debug, Deserialize)]
struct GitHubError {
    message: Option<String>,
    documentation_url: Option<String>,
}

pub async fn sync_anthropic_skills() -> AppResult<Vec<GitHubSkill>> {
    sync_github_skills(
        ANTHROPIC_SKILLS_API,
        RAW_SKILL_BASE,
        "https://github.com/anthropics/skills/tree/main/skills",
        "Anthropic",
    )
    .await
}

async fn sync_github_skills(
    contents_api: &str,
    raw_skill_base: &str,
    doc_base: &str,
    provider: &str,
) -> AppResult<Vec<GitHubSkill>> {
    let client = Arc::new(github_client()?);
    let response = client.get(contents_api).send().await?;

    if !response.status().is_success() {
        return Err(github_status_error(response).await);
    }

    let items = response.json::<Vec<GitHubContentItem>>().await?;
    let dir_items: Vec<_> = items
        .into_iter()
        .filter(|item| item.item_type == "dir")
        .collect();

    // Fetch all SKILL.md files concurrently, bounded by a semaphore so we
    // don't blast GitHub's unauthenticated API with dozens of requests at once.
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_FETCHES));

    let futures: Vec<_> = dir_items
        .iter()
        .map(|item| {
            let client = Arc::clone(&client);
            let sem = Arc::clone(&semaphore);
            let slug = item.name.clone();
            let doc_base = doc_base.to_string();
            let provider = provider.to_string();
            let raw_skill_base = raw_skill_base.to_string();
            async move {
                let _permit = sem.acquire_owned().await;
                let (name, description) = fetch_skill_frontmatter(&client, &raw_skill_base, &slug)
                    .await
                    .unwrap_or_else(|_| {
                        (
                            title_from_slug(&slug),
                            fallback_description(&provider, &slug),
                        )
                    });
                GitHubSkill {
                    doc_url: format!("{doc_base}/{slug}"),
                    slug,
                    name,
                    description,
                }
            }
        })
        .collect();

    let skills = join_all(futures).await;
    Ok(skills)
}

fn github_client() -> AppResult<reqwest::Client> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::USER_AGENT,
        reqwest::header::HeaderValue::from_static(USER_AGENT),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        "X-GitHub-Api-Version",
        reqwest::header::HeaderValue::from_static("2022-11-28"),
    );

    if let Ok(token) = std::env::var("GITHUB_TOKEN").or_else(|_| std::env::var("GH_TOKEN")) {
        if !token.trim().is_empty() {
            let value = format!("Bearer {}", token.trim());
            let auth = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|err| AppError::Message(format!("invalid GitHub token header: {err}")))?;
            headers.insert(reqwest::header::AUTHORIZATION, auth);
        }
    }

    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(AppError::from)
}

async fn fetch_skill_frontmatter(
    client: &reqwest::Client,
    raw_skill_base: &str,
    slug: &str,
) -> AppResult<(String, String)> {
    let response = client
        .get(format!("{raw_skill_base}/{slug}/SKILL.md"))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(github_status_error(response).await);
    }

    let markdown = response.text().await?;
    let (name, description) = parse_frontmatter(&markdown);
    Ok((
        name.unwrap_or_else(|| title_from_slug(slug)),
        description.unwrap_or_else(|| fallback_description("GitHub", slug)),
    ))
}

fn parse_frontmatter(markdown: &str) -> (Option<String>, Option<String>) {
    // Normalise Windows-style CRLF so the delimiter logic works regardless of
    // the line endings used in the raw GitHub file.
    let normalised = markdown.replace("\r\n", "\n");

    let Some(rest) = normalised.strip_prefix("---") else {
        return (None, None);
    };
    let Some(frontmatter) = rest.trim_start_matches('\n').split("\n---").next() else {
        return (None, None);
    };

    let mut name = None;
    let mut description = None;

    for line in frontmatter.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }

    (name, description)
}

async fn github_status_error(response: reqwest::Response) -> AppError {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    let detail = serde_json::from_str::<GitHubError>(&text)
        .ok()
        .and_then(|err| {
            let message = err.message?;
            Some(match err.documentation_url {
                Some(url) => format!("{message} ({url})"),
                None => message,
            })
        })
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| text);

    AppError::Message(format!(
        "GitHub request failed with HTTP {status}: {detail}"
    ))
}

fn title_from_slug(slug: &str) -> String {
    slug.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn fallback_description(provider: &str, slug: &str) -> String {
    format!("来自 {provider} 官方仓库的 \"{slug}\" 技能。")
}

pub async fn list_local_skills(app: &tauri::AppHandle) -> AppResult<(String, Vec<GitHubSkill>)> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Message(format!("failed to resolve app data directory: {err}")))?;
    let skills_dir = data_dir.join("skills");

    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir)?;
    }

    let skills_dir_str = skills_dir.to_string_lossy().to_string();
    let mut local_skills = Vec::new();

    // Recursively find all SKILL.md paths inside the skills directory (up to 3 levels deep)
    let skill_md_files = find_skill_md_files(&skills_dir, 0);

    for skill_md_path in skill_md_files {
        let parent_dir = skill_md_path.parent().unwrap();
        let slug = parent_dir
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        if let Ok(markdown) = std::fs::read_to_string(&skill_md_path) {
            let (name, description) = parse_frontmatter(&markdown);
            let name = name.unwrap_or_else(|| title_from_slug(&slug));
            let description = description.unwrap_or_else(|| format!("本地安装目录技能：{slug}"));

            local_skills.push(GitHubSkill {
                slug,
                name,
                description,
                doc_url: format!(
                    "file:///{}",
                    skill_md_path.to_string_lossy().replace('\\', "/")
                ),
            });
        }
    }

    Ok((skills_dir_str, local_skills))
}

fn find_skill_md_files(dir: &std::path::Path, depth: usize) -> Vec<std::path::PathBuf> {
    if depth > 3 {
        return Vec::new();
    }

    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if skill_md.exists() {
                    results.push(skill_md);
                } else {
                    results.extend(find_skill_md_files(&path, depth + 1));
                }
            }
        }
    }
    results
}
