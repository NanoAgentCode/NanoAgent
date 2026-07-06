import { searchCodeIndex, searchProjectIndex } from "../api";
import type { CodeSearchResult, ProjectIndexSearchResult } from "../types";

const CODE_INDEX_LIMIT = 8;
const DOCUMENT_INDEX_LIMIT = 6;
const DOCUMENT_INDEXER = "document";

export interface ProjectRetrievalContext {
  codeMatches: CodeSearchResult[];
  projectIndexMatches: ProjectIndexSearchResult[];
}

export async function loadProjectRetrievalContext(
  projectPath: string | undefined,
  query: string
): Promise<ProjectRetrievalContext> {
  if (!projectPath || !query.trim()) {
    return {
      codeMatches: [],
      projectIndexMatches: []
    };
  }

  const [codeMatches, projectIndexMatches] = await Promise.all([
    loadCodeMatches(projectPath, query),
    loadProjectIndexMatches(projectPath, query)
  ]);

  return {
    codeMatches,
    projectIndexMatches
  };
}

async function loadCodeMatches(projectPath: string, query: string) {
  if (!isLikelyCodeQuestion(query)) return [];
  try {
    return await searchCodeIndex(projectPath, query, CODE_INDEX_LIMIT);
  } catch (error) {
    console.warn("Failed to search code index:", error);
    return [];
  }
}

async function loadProjectIndexMatches(projectPath: string, query: string) {
  try {
    return await searchProjectIndex(projectPath, query, DOCUMENT_INDEXER, DOCUMENT_INDEX_LIMIT);
  } catch (error) {
    console.warn("Failed to search project index:", error);
    return [];
  }
}

function isLikelyCodeQuestion(query: string) {
  const normalized = query.toLowerCase();
  return /代码|函数|组件|接口|调用|实现|报错|文件|模块|重构|类|类型|方法|tsx?|rust|tauri|api|hook|component|function|class|type|interface|error|trace|call/.test(normalized);
}
