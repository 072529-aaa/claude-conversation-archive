import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ArrowUpRight, Brain, Check, Code2, Copy, Download, FileCode2, FileText, GitBranch, ImageOff, Paperclip, Terminal } from 'lucide-react';
import type { ArchiveAsset, ArchiveMessage, Raw } from '../lib/types';
import 'katex/dist/katex.min.css';
import './message.css';

interface MessageProps {
  message: ArchiveMessage;
  index: number;
  assets: ArchiveAsset[];
  onInspect: (title: string, value: unknown) => void;
  onArtifact: (title: string, content: string, language: string) => void;
}

type RenderContext = Pick<MessageProps, 'assets' | 'onInspect' | 'onArtifact'>;
const record = (value: unknown): Raw => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const json = (value: unknown): string => {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return String(value); }
};
const pathKey = (value: string) => value.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
const basename = (value: string) => pathKey(value).split('/').pop() ?? value;
// A reference is never a resource URL. Only our own Blob URLs reach media elements.
const isRemote = (value: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(value.trim()) && !/^[a-z]:[\\/]/i.test(value);
const rasterTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
const safeImageTypes = new Set(Object.values(rasterTypes));

type AssetMatch = { asset?: ArchiveAsset; reason?: string };
function resolveAsset(references: string[], assets: ArchiveAsset[]): AssetMatch {
  const local = references.flatMap(ref => {
    if (!ref || isRemote(ref)) return [];
    try {
      const decoded = decodeURIComponent(ref);
      return isRemote(decoded) ? [pathKey(ref)] : [pathKey(ref), pathKey(decoded)];
    } catch { return [pathKey(ref)]; }
  });
  if (!local.length) return { reason: '导出包未包含原始文件；不会自动加载外部资源。' };
  const exact = assets.filter(asset => local.includes(pathKey(asset.path)));
  if (exact.length === 1) return { asset: exact[0] };
  if (exact.length > 1) return { reason: '多个文件使用同一路径，无法确定对应的原始文件。' };
  const names = new Set(local.map(basename));
  const matches = assets.filter(asset => names.has(basename(asset.path)) || names.has(basename(asset.name)));
  if (matches.length === 1) return { asset: matches[0] };
  return { reason: matches.length > 1
    ? '导出包中有多个同名文件，没有自动选取其中任何一个。'
    : '已导入的导出包未包含此原始文件。' };
}

function useObjectUrl(blob?: Blob) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) { setValue(undefined); return; }
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value?.blob === blob ? value?.url : undefined;
}

function embeddedAsset(source: Raw, name: string): ArchiveAsset | undefined {
  if (source.type !== 'base64' || typeof source.data !== 'string') return undefined;
  try {
    const bytes = Uint8Array.from(atob(source.data.replace(/\s/g, '')), char => char.charCodeAt(0));
    return { name, path: name, blob: new Blob([bytes], { type: string(source.media_type) || 'application/octet-stream' }) };
  } catch { return undefined; }
}

function nodeText(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children);
    return '';
  }).join('');
}

function CodeBlock({ text, language = 'text' }: { text: string; language?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'selected'>('idle');
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (status === 'idle') return;
    const timeout = window.setTimeout(() => setStatus('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [status]);
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      if (pre.current) {
        const range = document.createRange();
        range.selectNodeContents(pre.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        setStatus('selected');
      }
    }
  }
  return <div className="msg-code">
    <div className="msg-code-bar"><span>{language}</span><button type="button" className="msg-copy" title="复制完整内容" aria-label="复制完整内容" onClick={copy}>
      {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span>{status === 'copied' ? '已复制' : '复制'}</span>
    </button></div>
    <span className="msg-sr-only" role="status">{status === 'copied' ? '已复制到剪贴板' : status === 'selected' ? '已选中文本，请使用键盘快捷键或右键菜单复制。' : ''}</span>
    <pre ref={pre} tabIndex={0} aria-label={`${language} code`}><code>{text}</code></pre>
  </div>;
}

function AssetMedia({ asset, alt, image, download = true }: { asset: ArchiveAsset; alt: string; image: boolean; download?: boolean }) {
  const mime = safeImageTypes.has(asset.blob.type) ? asset.blob.type : rasterTypes[basename(asset.name || asset.path).split('.').pop()?.toLowerCase() ?? ''];
  const imageBlob = useMemo(() => image && mime ? new Blob([asset.blob], { type: mime }) : undefined, [asset.blob, image, mime]);
  const downloadUrl = useObjectUrl(asset.blob);
  const imageUrl = useObjectUrl(imageBlob);
  const [failedUrl, setFailedUrl] = useState('');
  return <span className="msg-asset-media">
    {image && (imageBlob
      ? imageUrl && (failedUrl === imageUrl
        ? <span className="msg-file-note">The local image could not be decoded.{download ? ' The original file is available below.' : ' The original reference is preserved in the message record.'}</span>
        : <img src={imageUrl} alt={alt} loading="lazy" onError={() => setFailedUrl(imageUrl)} />)
      : <span className="msg-file-note">Preview unavailable for this file format.{download ? ' The original file is available to download.' : ' The file is present in the imported archive.'}</span>)}
    {download && downloadUrl && <a className="msg-download" href={downloadUrl} download={basename(asset.name || asset.path)} title={`Download original ${asset.name || asset.path}`}><Download size={15} aria-hidden="true" />下载原始文件</a>}
  </span>;
}

function OfflineImage({ src, alt, title, assets }: { src?: string; alt?: string; title?: string; assets: ArchiveAsset[] }) {
  const match = useMemo<AssetMatch>(() => {
    if (src?.startsWith('data:')) {
      const data = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(src);
      const asset = data && safeImageTypes.has(data[1].toLowerCase()) ? embeddedAsset({ type: 'base64', media_type: data[1].toLowerCase(), data: data[2] }, 'Embedded image') : undefined;
      return asset ? { asset } : { reason: 'This embedded image cannot be safely previewed. Its original data is preserved in the message record.' };
    }
    return src && !isRemote(src) ? resolveAsset([src], assets) : { reason: '为保护隐私，不会自动加载外部图片。' };
  }, [src, assets]);
  if (match.asset) return <AssetMedia asset={match.asset} alt={alt || 'Archived image'} image download={false} />;
  return <span className="msg-offline-image" role="img" aria-label={alt || 'Missing original image'} title={title}>
    <ImageOff size={20} aria-hidden="true" /><span><strong>{alt || '图片'} · 原图不可用</strong><span className="msg-file-note">{match.reason}</span>{src && <span className="msg-file-reference">{src}</span>}</span>
  </span>;
}

type TextSegment = { kind: 'text'; text: string } | { kind: 'artifact'; title: string; language: string; content: string; original: string };
const decodeAttribute = (value: string) => value.replace(/&(quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, key: string) => {
  const named: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
  if (!key.startsWith('#')) return named[key.toLowerCase()] ?? entity;
  const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
});

// Recognize legacy artifacts without consuming examples inside fenced or inline code.
function textSegments(text: string): TextSegment[] {
  const parts: TextSegment[] = [];
  const tokens = /(^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$))|(`+)|(<antArtifact\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)/gim;
  let cursor = 0;
  let fence = '';
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text))) {
    if (match[1]) {
      const marker = match[2];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && match[1].trim() === marker) fence = '';
      continue;
    }
    if (fence) continue;
    if (match[3]) {
      const closing = new RegExp(`(?<!\x60)\x60{${match[3].length}}(?!\x60)`, 'g');
      closing.lastIndex = tokens.lastIndex;
      const end = closing.exec(text);
      if (end) tokens.lastIndex = end.index + end[0].length;
      continue;
    }
    const linePrefix = text.slice(text.lastIndexOf('\n', match.index - 1) + 1, match.index);
    if (/^(?: {4}|\t)/.test(linePrefix)) continue;
    const close = /<\/antArtifact\s*>/gi;
    close.lastIndex = tokens.lastIndex;
    const end = close.exec(text);
    if (!end) continue;
    const attributes: Record<string, string> = {};
    for (const attr of match[4].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[attr[1].toLowerCase()] = decodeAttribute(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    if (match.index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, match.index) });
    const typeLanguages: Record<string, string> = { 'text/html': 'html', 'image/svg+xml': 'svg', 'application/vnd.ant.react': 'jsx', 'application/vnd.ant.code': 'text', 'text/plain': 'text', 'text/markdown': 'markdown', 'application/vnd.ant.mermaid': 'mermaid', 'application/javascript': 'javascript', 'text/javascript': 'javascript' };
    parts.push({ kind: 'artifact', title: attributes.title || attributes.identifier || 'Untitled artifact', language: attributes.language || typeLanguages[attributes.type] || attributes.type || 'text', content: text.slice(tokens.lastIndex, end.index), original: text.slice(match.index, close.lastIndex) });
    cursor = close.lastIndex;
    tokens.lastIndex = cursor;
  }
  if (cursor < text.length || !parts.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

function ArchiveLink({ href, children, assets, ...props }: { href?: string; children?: ReactNode; assets: ArchiveAsset[]; [key: string]: unknown }) {
  const match = href && !href.startsWith('#') && !isRemote(href) ? resolveAsset([href], assets) : {};
  const localUrl = useObjectUrl(match.asset?.blob);
  return <a {...props} href={localUrl || href} download={match.asset ? basename(match.asset.name) : undefined} target={href?.startsWith('#') || localUrl ? undefined : '_blank'} rel="noopener noreferrer" onClick={event => {
    if (href?.startsWith('#')) {
      event.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }}>{children}</a>;
}

function MarkdownText({ text, context }: { text: string; context: RenderContext }) {
  const prefix = useId().replace(/:/g, '');
  const segments = useMemo(() => textSegments(text), [text]);
  return <>{segments.map((part, index) => part.kind === 'artifact'
    ? <div className="msg-artifact" key={index}>
      <button className="msg-artifact-open" type="button" title={`View artifact: ${part.title}`} onClick={() => context.onArtifact(part.title, part.content, part.language)}>
        <FileCode2 size={25} aria-hidden="true" /><span><strong>{part.title}</strong><small>{part.language} · View artifact</small></span><ArrowUpRight size={18} aria-hidden="true" />
      </button>
      <button className="msg-icon-button" type="button" title="Inspect original artifact markup" aria-label="Inspect original artifact markup" onClick={() => context.onInspect(`Artifact · ${part.title}`, part.original)}><Code2 size={17} aria-hidden="true" /></button>
    </div>
    : <div className="msg-markdown" key={index}><ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: 'warn', throwOnError: false, maxExpand: 1000 }]]}
      remarkRehypeOptions={{ clobberPrefix: `msg-${prefix}-${index}-` }}
      urlTransform={(url, key) => key === 'src' ? url : defaultUrlTransform(url)}
      components={{
        pre: ({ children }) => {
          const code = Children.toArray(children).find(child => isValidElement(child));
          const className = isValidElement<{ className?: string }>(code) ? code.props.className || '' : '';
          return <CodeBlock text={nodeText(children)} language={/language-([^\s]+)/.exec(className)?.[1] || 'text'} />;
        },
        img: ({ src, alt, title }) => <OfflineImage src={typeof src === 'string' ? src : undefined} alt={alt} title={title} assets={context.assets} />,
        a: ({ node: _node, href, children, ...props }) => <ArchiveLink {...props} href={href} assets={context.assets}>{children}</ArchiveLink>,
        table: ({ children }) => <div className="msg-table-scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>,
      }}
    >{part.text}</ReactMarkdown></div>)}</>;
}

function InspectButton({ title, value, context }: { title: string; value: unknown; context: RenderContext }) {
  return <button type="button" className="msg-inspect-label" title={`Inspect ${title}`} onClick={() => context.onInspect(title, value)}><Code2 size={15} aria-hidden="true" />查看原始数据</button>;
}

function Attachment({ value, context, label = '附件' }: { value: unknown; context: RenderContext; label?: string }) {
  const file = record(value);
  const source = record(file.source);
  const referenceKeys = ['path', 'file_path', 'filename', 'file_name', 'name', 'url', 'uri', 'relative_path', 'storage_path'];
  const references = [typeof value === 'string' ? value : '', ...referenceKeys.flatMap(key => [string(file[key]), string(source[key])])].filter(Boolean);
  const name = string(file.file_name) || string(file.filename) || string(file.name) || string(file.title) || references[0] || label;
  const inline = useMemo(() => embeddedAsset(source, name), [file.source, name]);
  const match = inline ? { asset: inline } : resolveAsset(references, context.assets);
  const mime = string(file.file_type) || string(file.mime_type) || string(file.media_type) || string(source.media_type);
  const image = file.type === 'image' || mime.startsWith('image/') || !!rasterTypes[basename(name).split('.').pop()?.toLowerCase() ?? ''];
  const extracts = [
    ['提取的完整内容', file.extracted_content], ['提取的文本', file.extracted_text],
    ['文本内容', file.text], ['文件内容', typeof file.content === 'string' || Array.isArray(file.content) ? file.content : undefined],
    ['来源提取内容', source.extracted_content], ['来源文本', source.text],
    ['来源文本数据', source.type === 'text' ? source.data : undefined],
  ] as const;
  return <section className="msg-attachment" aria-label={`${label}: ${name}`}>
    <div className="msg-file-heading"><Paperclip size={18} aria-hidden="true" /><div><strong>{name}</strong><small>{mime || label}</small></div><button className="msg-icon-button" type="button" title={`Inspect file metadata: ${name}`} aria-label={`Inspect file metadata: ${name}`} onClick={() => context.onInspect(`File · ${name}`, value)}><Code2 size={17} aria-hidden="true" /></button></div>
    {match.asset ? <AssetMedia asset={match.asset} alt={name} image={image} /> : <div className="msg-missing-file"><ImageOff size={17} aria-hidden="true" /><span><strong>原始附件未包含在导出中</strong><span className="msg-file-note">{match.reason}</span></span></div>}
    {extracts.filter(([, content]) => content !== undefined && content !== null).map(([title, content]) => <details className="msg-details msg-extracted" key={title}>
      <summary><FileText size={16} aria-hidden="true" /><span>{title}</span></summary>
      <div className="msg-details-body"><CodeBlock text={typeof content === 'string' ? content : json(content)} language={typeof content === 'string' ? 'text' : 'json'} /></div>
    </details>)}
  </section>;
}

function ContentBlock({ value, context, position }: { value: unknown; context: RenderContext; position: number }) {
  if (typeof value === 'string') return <MarkdownText text={value} context={context} />;
  const block = record(value);
  const type = string(block.type);
  if (type === 'text' && typeof block.text === 'string') return <MarkdownText text={block.text} context={context} />;
  if (['thinking', 'redacted_thinking', 'reasoning'].includes(type)) {
    const thought = typeof block.thinking === 'string' ? block.thinking : typeof block.text === 'string' ? block.text : typeof block.content === 'string' ? block.content : undefined;
    return <details className="msg-details msg-thinking"><summary><Brain size={16} aria-hidden="true" /><span>{type === 'redacted_thinking' ? '已隐去的思考' : '思考过程'}</span></summary><div className="msg-details-body">
      {thought !== undefined ? <MarkdownText text={thought} context={context} /> : <CodeBlock text={json(value)} language="json" />}
      <InspectButton title={`Thinking block ${position + 1}`} value={value} context={context} />
    </div></details>;
  }
  if (['tool_use', 'tool_result', 'server_tool_use', 'web_search_tool_result', 'web_fetch_tool_result', 'code_execution_tool_result', 'bash_code_execution_tool_result', 'text_editor_code_execution_tool_result'].includes(type) || type.endsWith('_tool_result')) {
    return <details className="msg-details msg-tool"><summary><Terminal size={16} aria-hidden="true" /><span>{type.replace(/_/g, ' ')}{block.name ? ` · ${String(block.name)}` : ''}{block.is_error ? ' · error' : ''}</span></summary><div className="msg-details-body"><CodeBlock text={json(value)} language="json" /><InspectButton title={`Tool block ${position + 1}`} value={value} context={context} /></div></details>;
  }
  if (['image', 'document', 'file', 'attachment', 'audio', 'video'].includes(type)) return <Attachment value={value} context={context} label={type} />;
  return <details className="msg-details msg-unknown"><summary><Code2 size={16} aria-hidden="true" /><span>{type || '未知内容'} · 原始数据块</span></summary><div className="msg-details-body"><CodeBlock text={json(value)} language="json" /><InspectButton title={`Content block ${position + 1} · ${type || 'unknown'}`} value={value} context={context} /></div></details>;
}

export default function Message({ message, index, assets, onInspect, onArtifact }: MessageProps) {
  const context = { assets, onInspect, onArtifact };
  const heading = useId();
  const role = message.role.toLowerCase();
  const human = role === 'human' || role === 'user';
  const assistant = role === 'assistant';
  const sender = human ? '你' : assistant ? 'Claude' : message.role || '未知发送方';
  const content = message.content ?? [];
  const textBlocks = content.flatMap(value => typeof value === 'string' ? [value] : record(value).type === 'text' && typeof record(value).text === 'string' ? [string(record(value).text)] : []);
  const duplicateText = textBlocks.includes(message.text) || ['', '\n', '\n\n'].some(separator => textBlocks.join(separator) === message.text);
  const displayText = !!message.text && !duplicateText;
  const date = message.createdAt ? new Date(message.createdAt) : null;
  const validDate = date !== null && !Number.isNaN(date.getTime());
  const branch = Object.fromEntries(['parent_message_uuid', 'parent_uuid'].filter(key => Object.hasOwn(message.raw, key)).map(key => [key, message.raw[key]]));
  return <article className={`archive-message ${human ? 'msg-human' : assistant ? 'msg-assistant' : 'msg-other'}`} aria-labelledby={heading} data-message-id={message.id}>
    <header className="msg-header">
      {assistant && <svg className="msg-claude-mark" viewBox="0 0 32 32" aria-hidden="true"><g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">{Array.from({ length: 12 }, (_, ray) => <path key={ray} d={`M16 ${ray % 2 ? 4 : 2.5} V11`} transform={`rotate(${ray * 30} 16 16)`} />)}</g></svg>}
      <span className="msg-sender" id={heading}>{sender}</span>
      {!human && !assistant && <span className="msg-role-label">original role</span>}
      {message.createdAt && <time className="msg-date" dateTime={validDate ? date!.toISOString() : undefined} title={message.createdAt}>{validDate ? date!.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : message.createdAt}</time>}
      <button type="button" className="msg-icon-button msg-raw-button" title={`Inspect original message ${index + 1}`} aria-label={`Inspect original message ${index + 1}`} onClick={() => onInspect(`Message ${index + 1} · ${message.role || 'unknown'}`, message.raw)}><Code2 size={17} aria-hidden="true" /></button>
    </header>
    <div className="msg-body">
      {displayText && textBlocks.length === 0 && <MarkdownText text={message.text} context={context} />}
      {content.map((value, position) => <ContentBlock value={value} context={context} position={position} key={position} />)}
      {displayText && textBlocks.length > 0 && <section className="msg-supplemental" aria-label="补充正文（导出原文）"><div className="msg-section-label">补充正文（导出原文）</div><MarkdownText text={message.text} context={context} /></section>}
      {(message.attachments ?? []).map((file, position) => <Attachment key={`attachment-${position}`} value={file} context={context} />)}
      {(message.files ?? []).map((file, position) => <Attachment key={`file-${position}`} value={file} context={context} label="File" />)}
      {!message.text && content.length === 0 && !message.attachments?.length && !message.files?.length && <p className="msg-empty">导出中此消息没有正文，可通过上方按钮查看原始记录。</p>}
    </div>
    {Object.keys(branch).length > 0 && <details className="msg-details msg-branch"><summary><GitBranch size={14} aria-hidden="true" /><span>分支信息</span></summary><div className="msg-details-body"><CodeBlock text={json(branch)} language="json" /></div></details>}
  </article>;
}
