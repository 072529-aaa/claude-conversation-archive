import { unzip } from 'fflate';
import { emptyArchive, type ArchiveData, type ArchiveMessage, type Conversation, type ImportResult, type Raw } from './types';

export const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const records = (value: unknown): Raw[] => Array.isArray(value) ? value.filter(isRecord) : [];
const hash = (text: string) => {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(36);
};

export function messageText(message: ArchiveMessage): string {
  const parts = message.content.filter(isRecord).filter(block => block.type === 'text').map(block => str(block.text));
  const joined = parts.join('\n\n');
  return message.text || joined || JSON.stringify(message.content, null, 2);
}

export function normalizeConversation(value: Raw, source: string, index: number): Conversation {
  const inputMessages = Array.isArray(value.chat_messages) ? value.chat_messages : Array.isArray(value.messages) ? value.messages : [];
  const id = str(value.uuid) || str(value.id) || `conversation-${hash(JSON.stringify(value))}-${index}`;
  const messages: ArchiveMessage[] = inputMessages.map((input, i) => {
    const raw: Raw = isRecord(input) ? input : { content: input };
    const content = Array.isArray(raw.content) ? raw.content : typeof raw.content === 'string' ? [{ type: 'text', text: raw.content }] : raw.content == null ? [] : [raw.content];
    return {
      id: str(raw.uuid) || str(raw.id) || `${id}-message-${i}`,
      role: str(raw.sender) || str(raw.role) || 'unknown',
      text: str(raw.text),
      content,
      attachments: records(raw.attachments),
      files: [...records(raw.files), ...records(raw.files_v2)],
      createdAt: str(raw.created_at) || str(raw.createdAt),
      raw,
    };
  });
  return {
    id,
    title: str(value.name) || str(value.title) || '未命名对话',
    createdAt: str(value.created_at) || str(value.createdAt),
    updatedAt: str(value.updated_at) || str(value.updatedAt) || str(value.created_at),
    messages,
    source,
    searchText: JSON.stringify(value).normalize('NFKC').toLocaleLowerCase(),
    raw: value,
  };
}

export function findConversations(value: unknown): Raw[] {
  const found: Raw[] = [];
  function walk(node: unknown) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isRecord(node)) return;
    if (Array.isArray(node.chat_messages) || (Array.isArray(node.messages) && ('uuid' in node || 'id' in node || 'name' in node || 'title' in node))) {
      found.push(node);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (['conversations', 'chats', 'data', 'items', 'chat_conversations'].includes(key)) walk(child);
    }
  }
  walk(value);
  return found;
}

const mimeTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
  html: 'text/html', htm: 'text/html', json: 'application/json', mp3: 'audio/mpeg',
  wav: 'audio/wav', mp4: 'video/mp4', csv: 'text/csv',
};

async function expandZip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let oversized = false;
    unzip(bytes, {
      filter: entry => {
        total += entry.originalSize;
        if (entry.originalSize > 256 * 1024 * 1024 || total > 1024 * 1024 * 1024) oversized = true;
        return !oversized;
      },
    }, (error, files) => {
      if (oversized) reject(new Error('解压后文件过大（单文件上限 256 MB，总计 1 GB）。请将导出拆分后再导入；没有保存部分内容。'));
      else if (error) reject(new Error(`ZIP 无法解压：${error.message}`));
      else resolve(files);
    });
  });
}

export async function importFiles(files: File[], progress: (message: string) => void = () => {}): Promise<ImportResult> {
  const result: ImportResult = { ...emptyArchive(), parsedMessageCount: 0 };
  for (const file of files) {
    progress(`正在读取 ${file.name}`);
    if (file.size > 512 * 1024 * 1024) throw new Error(`${file.name} 超过单次文件上限 512 MB，请拆分导出。没有保存本次导入。`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (/\.zip$/i.test(file.name) && !isZip) throw new Error(`${file.name} 不是有效 ZIP，可能是登录页、地区限制页面或过期链接。请在 Claude 下载真正的导出包。`);
    const entries: Record<string, Uint8Array> = isZip ? await expandZip(bytes) : { [file.webkitRelativePath || file.name]: bytes };
    let documentCount = 0;
    let conversationCount = 0;
    let messageCount = 0;
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/')) continue;
      const fullPath = isZip ? `${file.name}/${path}` : path;
      const extension = path.split('.').pop()?.toLocaleLowerCase() || '';
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data))), byte => byte.toString(16).padStart(2, '0')).join('');
      const asset = { checksum, path: fullPath, name: path.split(/[\\/]/).pop() || path, blob: new Blob([new Uint8Array(data)], { type: mimeTypes[extension] || 'application/octet-stream' }) };
      if (extension === 'json') {
        let value: unknown;
        try { value = JSON.parse(new TextDecoder().decode(data).replace(/^\uFEFF/, '')); }
        catch { throw new Error(`${fullPath} 不是有效 JSON。本次导入未保存，请检查文件是否完整。`); }
        if (isRecord(value) && Array.isArray(value.data_files) && value.data_files.some(item => isRecord(item) && 'export_url' in item)) {
          throw new Error('这是导出下载清单，不是对话数据。请从 Claude 下载 conversations、memories 和 light_metadata 三个 ZIP，再一起导入。为保护隐私，网页不会自动访问带有账户凭据的下载地址。');
        }
        result.documents.push({ path: fullPath, value });
        documentCount++;
        const conversations = findConversations(value).map((item, index) => normalizeConversation(item, fullPath, index));
        result.conversations.push(...conversations);
        conversationCount += conversations.length;
        messageCount += conversations.reduce((sum, item) => sum + item.messages.length, 0);
      }
      result.assets.push(asset);
    }
    if (!documentCount && isZip) result.warnings.push(`${file.name} 未包含 JSON 对话文档，已保留全部文件，可作为附件包使用。`);
    result.sources.push({ name: file.name, size: file.size, importedAt: new Date().toISOString(), jsonDocuments: documentCount, conversations: conversationCount, messages: messageCount, rawBlob: file });
    result.parsedMessageCount += messageCount;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return result;
}

export function mergeArchives(current: ArchiveData, incoming: ArchiveData): ArchiveData {
  const conversations = [...current.conversations];
  const ids = new Set(conversations.map(item => item.id));
  const seen = new Map<string, string[]>();
  for (const item of conversations) {
    const serialized = JSON.stringify(item.raw);
    const key = hash(serialized);
    seen.set(key, [...(seen.get(key) || []), serialized]);
  }
  for (const conversation of incoming.conversations) {
    const serialized = JSON.stringify(conversation.raw);
    const key = hash(serialized);
    const bucket = seen.get(key) || [];
    if (bucket.includes(serialized)) continue;
    seen.set(key, [...bucket, serialized]);
    let id = conversation.id;
    if (ids.has(id)) id = `${id}~${key}`;
    while (ids.has(id)) id += '-copy';
    ids.add(id);
    conversations.push({ ...conversation, id });
  }
  const assets = [...current.assets];
  const assetKeys = new Set(assets.filter(asset => asset.checksum).map(asset => `${asset.path}\0${asset.checksum}`));
  for (const asset of incoming.assets) {
    const key = `${asset.path}\0${asset.checksum}`;
    if (asset.checksum && assetKeys.has(key)) continue;
    assets.push(asset);
    if (asset.checksum) assetKeys.add(key);
  }
  return {
    conversations,
    assets,
    sources: [...current.sources, ...incoming.sources],
    documents: [...current.documents, ...incoming.documents],
    warnings: [...new Set([...current.warnings, ...incoming.warnings])],
  };
}

export function conversationMarkdown(conversation: Conversation): string {
  return `# ${conversation.title}\n\n${conversation.messages.map(message => {
    const role = message.role === 'human' || message.role === 'user' ? '用户' : message.role === 'assistant' ? 'Claude' : message.role;
    return `## ${role}${message.createdAt ? ` · ${message.createdAt}` : ''}\n\n${messageText(message)}\n\n<details><summary>完整原始消息（含附件、工具及元数据）</summary>\n\n\`\`\`json\n${JSON.stringify(message.raw, null, 2)}\n\`\`\`\n</details>`;
  }).join('\n\n---\n\n')}\n`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatDate(value: string, detailed = false): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '时间未提供';
  return new Intl.DateTimeFormat('zh-CN', detailed ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'long', day: 'numeric' }).format(date);
}
