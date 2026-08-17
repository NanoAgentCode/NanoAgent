use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentToolDefinition {
    pub name: String,
    pub description: String,
    pub risk: String,
    pub requires_approval: bool,
    pub parameters_json: String,
}

pub trait AppPlugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;

    fn agent_tool_definitions(&self) -> Vec<AgentToolDefinition> {
        Vec::new()
    }

    fn owns_agent_tool(&self, _name: &str) -> bool {
        false
    }

    fn validate_agent_tool_args(
        &self,
        name: &str,
        _args: &BTreeMap<String, String>,
    ) -> AppResult<()> {
        Err(AppError::Message(format!(
            "plugin does not handle tool: {name}"
        )))
    }
}

pub struct PluginRegistry {
    plugins: Vec<Box<dyn AppPlugin>>,
}

impl PluginRegistry {
    pub fn new(plugins: Vec<Box<dyn AppPlugin>>) -> AppResult<Self> {
        let registry = Self { plugins };
        registry.validate()?;
        Ok(registry)
    }

    pub fn manifests(&self) -> Vec<PluginManifest> {
        self.plugins
            .iter()
            .map(|plugin| plugin.manifest())
            .collect()
    }

    pub fn agent_tool_definitions(&self) -> Vec<AgentToolDefinition> {
        self.plugins
            .iter()
            .flat_map(|plugin| plugin.agent_tool_definitions())
            .collect()
    }

    pub fn owns_agent_tool(&self, name: &str) -> bool {
        self.plugins
            .iter()
            .any(|plugin| plugin.owns_agent_tool(name))
    }

    pub fn validate_agent_tool_args(
        &self,
        name: &str,
        args: &BTreeMap<String, String>,
    ) -> AppResult<()> {
        let mut owners = self
            .plugins
            .iter()
            .filter(|plugin| plugin.owns_agent_tool(name));
        let owner = owners
            .next()
            .ok_or_else(|| AppError::Message(format!("unknown tool: {name}")))?;
        if owners.next().is_some() {
            return Err(AppError::Message(format!(
                "multiple plugins handle tool: {name}"
            )));
        }
        owner.validate_agent_tool_args(name, args)
    }

    fn validate(&self) -> AppResult<()> {
        let mut plugin_ids = BTreeSet::new();
        let mut tool_names = BTreeSet::new();
        for plugin in &self.plugins {
            let manifest = plugin.manifest();
            if manifest.id.trim().is_empty() {
                return Err(AppError::Message("plugin id cannot be empty".to_string()));
            }
            if !plugin_ids.insert(manifest.id.clone()) {
                return Err(AppError::Message(format!(
                    "duplicate plugin id: {}",
                    manifest.id
                )));
            }
            for tool in plugin.agent_tool_definitions() {
                if !plugin.owns_agent_tool(&tool.name) {
                    return Err(AppError::Message(format!(
                        "plugin {} declares but does not own tool {}",
                        manifest.id, tool.name
                    )));
                }
                if !tool_names.insert(tool.name.clone()) {
                    return Err(AppError::Message(format!(
                        "duplicate agent tool: {}",
                        tool.name
                    )));
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EmptyPlugin(&'static str);

    impl AppPlugin for EmptyPlugin {
        fn manifest(&self) -> PluginManifest {
            PluginManifest {
                id: self.0.to_string(),
                name: self.0.to_string(),
                version: "1.0.0".to_string(),
                capabilities: Vec::new(),
            }
        }
    }

    #[test]
    fn rejects_duplicate_plugin_ids() {
        let result = PluginRegistry::new(vec![
            Box::new(EmptyPlugin("same")),
            Box::new(EmptyPlugin("same")),
        ]);
        assert!(result.is_err());
    }
}
