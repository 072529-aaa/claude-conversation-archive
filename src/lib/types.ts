export type Raw = Record<string, unknown>;

export interface ArchiveMessage {
  id: string;
  role: string;
  text: string;
  content: unknown[];
  attachments: Raw[];
  files: Raw[];
  createdAt: string;
  raw: Raw;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ArchiveMessage[];
  source: string;
  searchText: string;
  raw: Raw;
}

export interface ArchiveAsset {
  checksum?: string;
  path: string;
  name: string;
  blob: Blob;
}

export interface SourceFile {
  name: string;
  size: number;
  importedAt: string;
  jsonDocuments: number;
  conversations: number;
  messages: number;
  rawBlob: Blob;
}

export interface ArchiveData {
  conversations: Conversation[];
  assets: ArchiveAsset[];
  sources: SourceFile[];
  documents: { path: string; value: unknown }[];
  warnings: string[];
}

export interface ImportResult extends ArchiveData {
  parsedMessageCount: number;
}

export const emptyArchive = (): ArchiveData => ({
  conversations: [], assets: [], sources: [], documents: [], warnings: [],
});
