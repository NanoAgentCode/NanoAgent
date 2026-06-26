import { useState } from "react";
import {
  deleteRagFile,
  indexRagFile,
  listRagFiles,
  readAbsoluteFile,
  searchRagContext
} from "../api";
import { isSupportedRagFile } from "../lib/formatters";
import type { RagChunkMatch, RagFile } from "../types";

export interface UseRagFilesReturn {
  ragFiles: RagFile[];
  setRagFiles: React.Dispatch<React.SetStateAction<RagFile[]>>;
  isRagDragging: boolean;
  setIsRagDragging: React.Dispatch<React.SetStateAction<boolean>>;
  indexingRagFileName: string;
  setIndexingRagFileName: React.Dispatch<React.SetStateAction<string>>;
  refreshRagFiles: (conversationId: string) => Promise<void>;
  loadRagMatches: (conversationId: string, queryText: string, modelConfigId: string) => Promise<RagChunkMatch[]>;
  handleDeleteRagFile: (id: string, conversationId: string) => Promise<void>;
}

export function useRagFiles(setNotice: (message: string) => void): UseRagFilesReturn {
  const [ragFiles, setRagFiles] = useState<RagFile[]>([]);
  const [isRagDragging, setIsRagDragging] = useState(false);
  const [indexingRagFileName, setIndexingRagFileName] = useState("");

  async function refreshRagFiles(conversationId: string) {
    try {
      setRagFiles(await listRagFiles(conversationId));
    } catch (error) {
      console.error("Failed to list RAG files:", error);
      setRagFiles([]);
    }
  }

  async function loadRagMatches(
    conversationId: string,
    queryText: string,
    modelConfigId: string
  ): Promise<RagChunkMatch[]> {
    if (!conversationId || !queryText.trim() || !modelConfigId || ragFiles.length === 0) {
      return [];
    }
    try {
      return await searchRagContext(conversationId, queryText, modelConfigId, 6);
    } catch (error) {
      console.error("Failed to search RAG context:", error);
      setNotice(`文件检索失败，将跳过 RAG 上下文：${String(error)}`);
      return [];
    }
  }

  async function handleDeleteRagFile(id: string, conversationId: string) {
    try {
      await deleteRagFile(id);
      if (conversationId) {
        await refreshRagFiles(conversationId);
      }
    } catch (error) {
      console.error("Failed to delete RAG file:", error);
      setNotice(`删除文件索引失败：${String(error)}`);
    }
  }

  return {
    ragFiles,
    setRagFiles,
    isRagDragging,
    setIsRagDragging,
    indexingRagFileName,
    setIndexingRagFileName,
    refreshRagFiles,
    loadRagMatches,
    handleDeleteRagFile
  };
}
