use std::collections::BTreeMap;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct ToolPolicyDescriptor {
    pub name: &'static str,
    pub description: &'static str,
    pub risk: &'static str,
    pub requires_approval: bool,
}

#[derive(Debug, Clone)]
pub struct ToolPolicyContext {
    pub allow_command: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolPolicyDecision {
    pub tool_name: String,
    pub risk: String,
    pub requires_approval: bool,
    pub reason: String,
}

pub fn built_in_tool_policies() -> Vec<ToolPolicyDescriptor> {
    vec![
        ToolPolicyDescriptor {
            name: "read_file",
            description: "Read a UTF-8 text file inside the active project.",
            risk: "low",
            requires_approval: true,
        },
        ToolPolicyDescriptor {
            name: "write_file",
            description: "Create or overwrite a UTF-8 text file inside the active project.",
            risk: "high",
            requires_approval: true,
        },
        ToolPolicyDescriptor {
            name: "execute_command",
            description: "Run a PowerShell or cmd command in the active project directory.",
            risk: "high",
            requires_approval: true,
        },
        ToolPolicyDescriptor {
            name: "ocr_image",
            description: "Extract text from a project image with local PaddleOCR PP-OCRv6 small.",
            risk: "medium",
            requires_approval: true,
        },
    ]
}

pub fn evaluate_tool_call(
    tool_name: &str,
    args: &BTreeMap<String, String>,
    context: &ToolPolicyContext,
) -> AppResult<ToolPolicyDecision> {
    match tool_name {
        "read_file" => {
            let path = required_policy_arg(args, "path")?;
            reject_internal_path(path)?;
            Ok(decision(tool_name, "low", true, "project_file_read"))
        }
        "write_file" => {
            let path = required_policy_arg(args, "path")?;
            reject_internal_path(path)?;
            Ok(decision(tool_name, "high", true, "project_file_write"))
        }
        "execute_command" => {
            if !context.allow_command {
                return Err(AppError::Message(
                    "Bash Tool 技能已被禁用，请在设置中启用后再试。".to_string(),
                ));
            }
            let command = required_policy_arg(args, "command")?;
            reject_blocked_command(command)?;
            Ok(decision(tool_name, "high", true, "project_shell_command"))
        }
        "ocr_image" => {
            let path = required_policy_arg(args, "path")?;
            reject_internal_path(path)?;
            Ok(decision(tool_name, "medium", true, "project_image_ocr"))
        }
        name if name.starts_with("mcp__") => {
            Ok(decision(tool_name, "external", true, "mcp_tool_call"))
        }
        _ => Err(AppError::Message(format!("unknown tool: {tool_name}"))),
    }
}

fn decision(
    tool_name: &str,
    risk: &str,
    requires_approval: bool,
    reason: &str,
) -> ToolPolicyDecision {
    ToolPolicyDecision {
        tool_name: tool_name.to_string(),
        risk: risk.to_string(),
        requires_approval,
        reason: reason.to_string(),
    }
}

fn required_policy_arg<'a>(args: &'a BTreeMap<String, String>, name: &str) -> AppResult<&'a str> {
    args.get(name)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Message(format!("missing tool argument: {name}")))
}

fn reject_internal_path(path: &str) -> AppResult<()> {
    let normalized = path.trim().replace('\\', "/").to_ascii_lowercase();
    let trimmed = normalized.trim_matches('/');
    if trimmed == ".git"
        || trimmed.starts_with(".git/")
        || trimmed == ".codegraph"
        || trimmed.starts_with(".codegraph/")
    {
        return Err(AppError::Message(
            "工具策略拒绝访问项目内部控制目录".to_string(),
        ));
    }
    Ok(())
}

fn reject_blocked_command(command: &str) -> AppResult<()> {
    let normalized = command
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let blocked_patterns = [
        "git reset --hard",
        "git clean -fd",
        "rm -rf",
        "remove-item -recurse",
        "remove-item -r",
        "del /s",
        "rmdir /s",
        "format ",
        "shutdown ",
        "reg delete",
    ];

    if blocked_patterns
        .iter()
        .any(|pattern| normalized.contains(pattern))
    {
        return Err(AppError::Message(
            "工具策略拒绝执行高破坏性命令，请改用更小范围的操作".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[(&str, &str)]) -> BTreeMap<String, String> {
        values
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn blocks_command_when_command_tool_disabled() {
        let result = evaluate_tool_call(
            "execute_command",
            &args(&[("command", "npm run build")]),
            &ToolPolicyContext {
                allow_command: false,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn blocks_highly_destructive_commands() {
        let result = evaluate_tool_call(
            "execute_command",
            &args(&[("command", "git reset --hard HEAD")]),
            &ToolPolicyContext {
                allow_command: true,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn blocks_internal_control_paths() {
        let result = evaluate_tool_call(
            "write_file",
            &args(&[("path", ".git/config"), ("content", "x")]),
            &ToolPolicyContext {
                allow_command: true,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn allows_mcp_tools_as_external_policy_scope() {
        let decision = evaluate_tool_call(
            "mcp__server__tool",
            &args(&[("arguments", "{}")]),
            &ToolPolicyContext {
                allow_command: true,
            },
        )
        .expect("mcp policy should allow registered mcp calls");

        assert_eq!(decision.risk, "external");
        assert!(decision.requires_approval);
    }
}
