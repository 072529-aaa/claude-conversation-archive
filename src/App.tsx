import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, ChevronsUpDown, Database, FileCode2, FileJson, Files, FolderClosed, HardDrive, History, Import, Info, LoaderCircle, Menu, MessageCircle, Moon, PanelLeftClose, Plus, Search, ShieldCheck, SlidersHorizontal, Star, Sun, Upload, X } from 'lucide-react';
import Message from './components/Message';
import Modal from './components/Modal';
import { conversationMarkdown, downloadBlob, formatDate, importFiles, mergeArchives, messageText } from './lib/archive';
import { loadArchive, saveArchive } from './lib/storage';
import { isSharedArchive, loadSharedArchive } from './lib/shared';
import { emptyArchive, type ArchiveData, type Conversation } from './lib/types';

function ClaudeMark({ size = 40 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="claude-mark">{Array.from({ length: 12 }, (_, i) => <path key={i} d="M24 7 L24 17" stroke="currentColor" strokeWidth={i % 3 === 0 ? 4.3 : 3.3} strokeLinecap="square" transform={`rotate(${i * 30 + (i % 2 ? 2 : -2)} 24 24)`} />)}<circle cx="24" cy="24" r="7.5" fill="currentColor" /></svg>;
}

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
const safeName = (value: string) => value.replace(/[<>:"/\\|?*]/g, '_').slice(0, 140);
const jsonBlob = (value: unknown) => new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
const initialTheme = () => localStorage.getItem('archive-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export default function App() {
  const [archive, setArchive] = useState<ArchiveData>(emptyArchive);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState(isSharedArchive ? 'library' : 'home');
  const [activeId, setActiveId] = useState(() => decodeURIComponent(location.hash.slice(1)));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [query, setQuery] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [inspect, setInspect] = useState<{ title: string; value: unknown } | null>(null);
  const [artifact, setArtifact] = useState<{ title: string; content: string; language: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sort, setSort] = useState('recent');
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [starred, setStarred] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('archive-starred') || '[]'); } catch { return []; } });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollArea = useRef<HTMLElement>(null);
  const importLock = useRef(false);
  const active = archive.conversations.find(item => item.id === activeId);
  const messageCount = archive.conversations.reduce((sum, item) => sum + item.messages.length, 0);
  const documents = archive.documents.filter(item => !/conversations[^/]*\.json$/i.test(item.path));
  const memories = documents.filter(item => /memor/i.test(item.path));
  const projects = documents.filter(item => /project/i.test(item.path));

  useEffect(() => {
    let alive = true;
    (isSharedArchive ? loadSharedArchive() : loadArchive()).then(data => { if (alive && data) { setArchive(data); if (location.hash) setView('chat'); } }).catch(() => { if (alive) setError(isSharedArchive ? '分享数据加载失败，请刷新重试。尚未加载的内容不会被替换为示例。' : '无法读取本机档案数据库。请检查浏览器是否允许本地存储；原始 ZIP 不受影响。'); }).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('archive-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('archive-starred', JSON.stringify(starred)); }, [starred]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(open => !open); }
      if (event.key === 'Escape') { setSidebarOpen(false); setExportOpen(false); }
    };
    const onHash = () => { setActiveId(decodeURIComponent(location.hash.slice(1))); setView(location.hash ? 'chat' : isSharedArchive ? 'library' : 'home'); setChatQuery(''); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHash); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { scrollArea.current?.scrollTo({ top: 0 }); setExportOpen(false); }, [activeId, view]);

  const sorted = useMemo(() => [...archive.conversations].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)), [archive.conversations, sort]);
  const results = useMemo(() => sorted.filter(item => (!onlyStarred || starred.includes(item.id)) && (!query.trim() || item.searchText.includes(normalized(query.trim())))), [sorted, query, onlyStarred, starred]);
  const matches = useMemo(() => !chatQuery.trim() || !active ? [] : active.messages.map((message, i) => normalized(JSON.stringify(message.raw)).includes(normalized(chatQuery.trim())) ? i : -1).filter(i => i !== -1), [active, chatQuery]);

  function openConversation(conversation: Conversation, term = '') {
    setActiveId(conversation.id); setView('chat'); setSidebarOpen(false); setSearchOpen(false); setChatQuery(term); setMatchIndex(0);
    history.pushState(null, '', `#${encodeURIComponent(conversation.id)}`);
  }
  function goHome(next = isSharedArchive ? 'library' : 'home') { setView(next); setSidebarOpen(false); history.pushState(null, '', location.pathname); }
  function jumpToMatch(next: number) {
    if (!matches.length) return;
    const index = (next + matches.length) % matches.length;
    setMatchIndex(index);
    const target = document.getElementById(`message-${matches[index]}`);
    target?.querySelectorAll('details').forEach(details => { details.open = true; });
    target?.scrollIntoView({ behavior: 'instant', block: 'center' });
  }
  function toggleStar(id: string) { setStarred(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); }
  function showInspect(title: string, value: unknown) { setInspect({ title, value }); }
  async function handleFiles(files: File[]) {
    if (isSharedArchive || !files.length || importLock.current || !loaded) return;
    importLock.current = true; setError(''); setBusy('正在检查导出文件'); setDragging(false);
    try {
      const imported = await importFiles(files, setBusy);
      const merged = mergeArchives(archive, imported);
      setBusy('正在保存到本机');
      await saveArchive(merged);
      setArchive(merged); setImportOpen(false); setReportOpen(true);
      setNotice(`已读取 ${imported.conversations.length} 段对话、${imported.parsedMessageCount.toLocaleString()} 条消息；原始文件已保留。`);
      if (imported.conversations.length) openConversation(merged.conversations.find(item => item.id === imported.conversations[0].id) || imported.conversations[0]);
    } catch (cause) {
      setError(cause instanceof DOMException && cause.name === 'QuotaExceededError' ? '浏览器存储空间不足，本次导入没有保存。请保留原始 ZIP，释放空间后重试。' : cause instanceof Error ? cause.message : '导入失败，本次数据未保存。');
    } finally { setBusy(''); importLock.current = false; if (fileInput.current) fileInput.current.value = ''; }
  }
  async function copyShareLink() {
    try { await navigator.clipboard.writeText(location.origin + location.pathname + location.hash); setNotice('分享链接已复制，任何持有链接的人都可阅读。'); }
    catch { showInspect('复制此分享链接', location.origin + location.pathname + location.hash); }
  }
  const chooseFiles = () => { if (!isSharedArchive) fileInput.current?.click(); };
  const renderImportBox = () => <div className={`import-box ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); void handleFiles(Array.from(event.dataTransfer.files)); }}>
    <div className="import-prompt">{busy || '把 Claude 导出文件放在这里'}</div>
    <div className="import-hint">拖入 ZIP 或 JSON，即可找回完整对话</div>
    <div className="import-box-bottom"><span className="file-hint"><Plus size={18} /> 支持多个导出包</span><button className="primary-button" disabled={!loaded || !!busy} onClick={chooseFiles}>{busy ? <LoaderCircle size={17} className="spin" /> : <Upload size={17} />} {busy ? '正在导入' : '选择文件'}</button></div>
  </div>;

  return <div className={`app-shell${isSharedArchive ? ' shared-archive' : ''}`}>
    {!isSharedArchive && <input ref={fileInput} type="file" accept=".zip,.json,.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.html,.svg,.csv,.mp3,.mp4" multiple hidden aria-label="导入 Claude 导出文件" onChange={event => void handleFiles(Array.from(event.target.files || []))} />}
    {sidebarOpen && <button className="sidebar-scrim" aria-label="收起侧边栏" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="sidebar-brand"><button onClick={() => goHome()} className="brand-button" aria-label="Claude 档案首页">Claude<span className="archive-badge">档案</span></button><button className="icon-button sidebar-close" aria-label="收起侧边栏" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></button></div>
      {isSharedArchive ? <button className="new-chat" onClick={() => void copyShareLink()}><span className="new-chat-icon"><ArrowRight size={17} /></span>复制分享链接<span className="shortcut">分享</span></button> : <button className="new-chat" onClick={() => { setError(''); setImportOpen(true); }} disabled={!!busy}><span className="new-chat-icon"><Plus size={17} /></span>导入对话<span className="shortcut">ZIP</span></button>}
      <nav className="main-nav" aria-label="主导航">
        <button onClick={() => { setQuery(''); setSearchOpen(true); }}><Search size={19} /><span>搜索对话</span><kbd>Ctrl K</kbd></button>
        <button className={view === 'library' ? 'selected' : ''} onClick={() => { setQuery(''); goHome('library'); }}><MessageCircle size={19} /><span>对话</span>{archive.conversations.length > 0 && <span className="nav-count">{archive.conversations.length}</span>}</button>
        {!isSharedArchive && <><button onClick={() => showInspect('项目 · 原始导出数据', projects.length ? projects : { 提示: '尚未导入项目数据。导入 light_metadata 导出包后，可查看其中提供的项目内容。' })}><FolderClosed size={19} /><span>项目</span></button>
        <button onClick={() => showInspect('记忆 · 原始导出数据', memories.length ? memories : { 提示: '尚未导入记忆数据。请导入 memories 导出包；这里不会生成或补写记忆。' })}><History size={19} /><span>记忆</span></button></>}
      </nav>
      <div className="recent-label"><span>最近的对话</span>{sorted.length > 0 && <button aria-label="查看全部对话" onClick={() => goHome('library')}><ChevronRight size={14} /></button>}</div>
      <div className="recent-list">
        {sorted.slice(0, 60).map(item => <button key={item.id} className={`recent-item ${view === 'chat' && activeId === item.id ? 'active' : ''}`} onClick={() => openConversation(item)} title={item.title}>{starred.includes(item.id) && <Star size={13} fill="currentColor" />}<span>{item.title}</span></button>)}
        {!sorted.length && <div className="sidebar-empty"><MessageCircle size={23} strokeWidth={1.3} /><p>熟悉的对话，<br />会在这里与你重逢。</p><span>导入后显示历史记录</span></div>}
        {sorted.length > 60 && <button className="text-button recent-more" onClick={() => goHome('library')}>查看全部 {sorted.length} 段对话 <ArrowRight size={14} /></button>}
      </div>
      <button className="sidebar-storage" onClick={() => setReportOpen(true)}><HardDrive size={16} /><span>{isSharedArchive ? '持有链接即可阅读' : '仅保存在此设备'}</span><ShieldCheck size={14} /></button>
      <div className="sidebar-profile"><span className="profile-avatar">L</span><button onClick={() => setReportOpen(true)}><strong>{isSharedArchive ? '分享档案' : '本地档案'}</strong><span>{isSharedArchive ? '公开分享 · 只读访问' : '私人空间 · 无需登录'}</span></button><button className="icon-button" aria-label="切换明暗主题" title="切换明暗主题" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="打开侧边栏" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>{view === 'chat' && active ? <><button className="icon-button" aria-label="返回对话列表" onClick={() => goHome('library')}><ArrowLeft size={18} /></button><span className="topbar-title" title={active.title}>{active.title}</span><ChevronDown size={14} className="muted" /></> : <><span className="workspace-label">{isSharedArchive ? '分享空间' : '个人空间'}</span><ChevronRight size={13} className="muted" /><span>对话档案</span></>}</div><div className="topbar-actions"><span className="privacy-badge"><span />{isSharedArchive ? '公开只读' : '本地私密'}</span><button className="icon-button" title="导入与完整性报告" aria-label="导入与完整性报告" onClick={() => setReportOpen(true)}><SlidersHorizontal size={18} /></button></div></header>
      {error && !importOpen && <div className="error-banner" role="alert"><Info size={18} /><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div>}
      {busy && <div className="busy-banner" role="status"><LoaderCircle size={15} className="spin" />{busy}，请勿关闭页面</div>}
      <main ref={scrollArea} className={`main-scroll ${view === 'chat' ? 'chat-scroll' : ''}`}>
        {!loaded ? <div className="loading-state"><LoaderCircle className="spin" size={26} /><p>正在打开你的档案</p></div> : view === 'chat' && active ? <>
          <div className="conversation-toolbar"><span>{active.messages.length.toLocaleString()} 条消息<span className="toolbar-dot">·</span>{formatDate(active.createdAt)}</span><div><button className={`icon-button ${starred.includes(active.id) ? 'is-starred' : ''}`} aria-label={starred.includes(active.id) ? '取消收藏' : '收藏对话'} onClick={() => toggleStar(active.id)}><Star size={16} fill={starred.includes(active.id) ? 'currentColor' : 'none'} /></button><button className="icon-button" aria-label="查看完整原始对话" onClick={() => showInspect(active.title, active.raw)}><FileJson size={17} /></button><div className="dropdown-wrap"><button className="small-button" aria-expanded={exportOpen} onClick={() => setExportOpen(open => !open)}><ArrowDownToLine size={15} />导出<ChevronDown size={12} /></button>{exportOpen && <div className="dropdown-menu"><button onClick={() => { downloadBlob(jsonBlob(active.raw), `${safeName(active.title)}.json`); setExportOpen(false); }}>完整原始 JSON</button><button onClick={() => { downloadBlob(new Blob([conversationMarkdown(active)], { type: 'text/markdown;charset=utf-8' }), `${safeName(active.title)}.md`); setExportOpen(false); }}>Markdown（含原始消息）</button></div>}</div></div></div>
          <div className="conversation-find"><Search size={15} /><input aria-label="在当前对话内搜索" placeholder="在这段对话中查找" value={chatQuery} onChange={event => { setChatQuery(event.target.value); setMatchIndex(0); }} onKeyDown={event => { if (event.key === 'Enter') jumpToMatch(matchIndex + (event.shiftKey ? -1 : 1)); }} />{chatQuery && <><span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : '无匹配'}</span><button className="icon-button" aria-label="定位搜索结果" disabled={!matches.length} onClick={() => jumpToMatch(matchIndex)}><Search size={14} /></button><button className="icon-button" aria-label="下一个搜索结果" disabled={!matches.length} onClick={() => jumpToMatch(matchIndex + 1)}><ArrowDown size={14} /></button><button className="icon-button" aria-label="清除对话搜索" onClick={() => setChatQuery('')}><X size={14} /></button></>}</div>
          <div className="conversation-messages">{active.messages.map((message, index) => <div id={`message-${index}`} key={`${message.id}-${index}`} className={matches.includes(index) ? 'message-match' : ''}><Message message={message} index={index} assets={archive.assets} onInspect={showInspect} onArtifact={(title, content, language) => { setArtifact({ title, content, language }); setPreview(false); }} /></div>)}{!active.messages.length && <div className="empty-state"><MessageCircle size={28} /><h3>这段对话没有消息</h3><p>原始导出中的消息列表为空，没有补写任何内容。</p></div>}<div className="conversation-end"><span />已展示此对话的全部 {active.messages.length} 条消息<span /></div></div>
        </> : view === 'library' ? <section className="library-page"><div className="page-eyebrow"><Archive size={17} /> {isSharedArchive ? '分享的对话档案' : '你的私人档案'}</div><div className="library-heading"><h1>所有对话</h1>{isSharedArchive ? <button className="primary-button" onClick={() => void copyShareLink()}><ArrowRight size={16} />分享</button> : <button className="primary-button" onClick={() => setImportOpen(true)}><Plus size={16} />导入</button>}</div><p className="page-subtitle">{archive.conversations.length.toLocaleString()} 段对话 · {messageCount.toLocaleString()} 条消息，按原始内容保留。</p><div className="library-controls"><label className="search-field"><Search size={17} /><input aria-label="搜索全部对话" placeholder="搜索标题、正文、代码或附件…" value={query} onChange={event => setQuery(event.target.value)} /></label><button className={`filter-button ${onlyStarred ? 'on' : ''}`} onClick={() => setOnlyStarred(value => !value)}><Star size={15} />收藏</button><label className="sort-control"><ChevronsUpDown size={15} /><select aria-label="对话排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近更新</option><option value="title">标题顺序</option></select></label></div><div className="conversation-list">{results.map(item => <div className="conversation-row" key={item.id}><button className="conversation-row-main" onClick={() => openConversation(item, query)}><MessageCircle size={19} strokeWidth={1.4} /><span><strong>{item.title}</strong><small>{item.messages.length} 条消息 · {formatDate(item.updatedAt)}</small></span><ChevronRight size={16} /></button><button className={`icon-button ${starred.includes(item.id) ? 'is-starred' : ''}`} aria-label={`${starred.includes(item.id) ? '取消收藏' : '收藏'} ${item.title}`} onClick={() => toggleStar(item.id)}><Star size={16} fill={starred.includes(item.id) ? 'currentColor' : 'none'} /></button></div>)}{!results.length && <div className="empty-state"><Search size={28} /><h3>{query || onlyStarred ? '没有找到匹配的对话' : '你的档案，从第一份导出开始'}</h3><p>{query || onlyStarred ? '试试其他关键词，或取消收藏筛选。' : '导入 Claude 的 ZIP 或 JSON 文件，所有对话将在这里显示。'}</p>{!isSharedArchive && !query && !onlyStarred && <button className="secondary-button" onClick={chooseFiles}>选择导出文件</button>}</div>}</div></section> : <section className="home-page"><div className="home-greeting"><ClaudeMark size={55} /><span>每一段思考，都值得留下</span></div><h1>{archive.conversations.length ? '欢迎回到你的对话。' : '你的对话，原样回来。'}</h1><p className="home-subtitle">一个熟悉的空间，留住你与 Claude 的每一次交流。</p>{renderImportBox()}<div className="supported-files"><span><MessageCircle size={14} />对话记录</span><span><History size={14} />记忆</span><span><Files size={14} />附件与元数据</span></div>{archive.conversations.length ? <div className="home-recent"><div className="section-heading"><h2>继续阅读</h2><button className="text-button" onClick={() => goHome('library')}>全部 {archive.conversations.length} 段对话<ArrowRight size={14} /></button></div>{sorted.slice(0, 4).map(item => <button className="home-recent-row" onClick={() => openConversation(item)} key={item.id}><MessageCircle size={17} /><strong>{item.title}</strong><span>{formatDate(item.updatedAt)}</span><ArrowRight size={15} /></button>)}</div> : <div className="import-guide"><div className="guide-icon"><FileJson size={22} strokeWidth={1.4} /></div><div><h2>从 Claude 导出，到这里重逢</h2><p>在 Claude「设置 → 隐私」导出数据，下载后直接导入。</p><button className="text-button" onClick={() => setImportOpen(true)}>查看支持的内容 <ArrowRight size={13} /></button></div></div>}<div className="home-privacy"><ShieldCheck size={14} /><span>本地读取，不上传服务器，不需要 API Key。</span></div></section>}
      </main>
      {view === 'chat' && active ? <footer className="reader-footer"><div><ShieldCheck size={15} /><span>只读档案<span className="footer-detail"> · 不连接 Claude，不生成新回复</span></span></div><button className="small-button" onClick={() => scrollArea.current?.scrollTo({ top: scrollArea.current.scrollHeight, behavior: 'instant' })}>前往末尾<ArrowDown size={14} /></button></footer> : <footer className="page-footer"><span>Claude 风格的独立档案阅读器</span><span>非 Anthropic 官方服务</span></footer>}
    </section>
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {importOpen && <Modal title="导入你的 Claude 档案" onClose={() => { if (!busy) setImportOpen(false); }}><p className="modal-intro">选择多个 ZIP 或 JSON，一次还原对话、记忆与元数据。已有对话不会被覆盖；不同版本会分别保留。</p>{error && <div className="inline-error" role="alert">{error}</div>}{renderImportBox()}<div className="import-formats"><div><MessageCircle size={18} /><span><strong>conversations</strong><small>完整消息、代码、工具内容与附件信息</small></span></div><div><History size={18} /><span><strong>memories</strong><small>账户导出的记忆，保留原始内容</small></span></div><div><Files size={18} /><span><strong>light_metadata</strong><small>账户与项目元数据，按实际导出保留</small></span></div></div><p className="fine-print"><Info size={15} />manifest 文件只是下载清单，不能还原正文。缺失的原始附件不会凭空补全；外部图片不会自动联网加载。</p></Modal>}
    {searchOpen && <Modal title="搜索你的对话" onClose={() => setSearchOpen(false)} wide><label className="search-field modal-search"><Search size={20} /><input autoFocus aria-label="全文搜索" placeholder="搜索标题、内容、代码、附件…" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="search-summary">{results.length} 段匹配对话 · 搜索范围包含原始消息中的所有字段{onlyStarred && <button className="text-button" onClick={() => setOnlyStarred(false)}>取消收藏筛选</button>}</div><div className="search-results">{results.map(item => { const hit = item.messages.find(message => normalized(JSON.stringify(message.raw)).includes(normalized(query))); const text = hit ? messageText(hit) : ''; const position = normalized(text).indexOf(normalized(query)); const start = Math.max(0, position - 45); return <button className="search-result" key={item.id} onClick={() => openConversation(item, query)}><MessageCircle size={18} /><span><strong>{item.title}</strong><p>{text.slice(start, start + 180) || '匹配标题或原始元数据'}</p><small>{item.messages.length} 条消息 · {formatDate(item.updatedAt)}</small></span><ArrowRight size={15} /></button>; })}{!results.length && <div className="empty-state"><Search size={28} /><h3>没有找到匹配的对话</h3><p>{archive.conversations.length ? '换个关键词试试。' : '导入对话后，即可搜索全部历史内容。'}</p></div>}</div></Modal>}
    {reportOpen && <Modal title="档案与完整性" onClose={() => setReportOpen(false)} wide><div className="report-stats"><div><strong>{archive.conversations.length.toLocaleString()}</strong><span>已保存对话</span></div><div><strong>{messageCount.toLocaleString()}</strong><span>已保存消息</span></div><div><strong>{archive.sources.length}</strong><span>原始导入文件</span></div></div><div className="report-notice"><ShieldCheck size={20} /><div><strong>{isSharedArchive ? '已保留完整消息内容，账户标识未公开' : archive.sources.length ? '已保留原始文件与消息字段' : '尚未导入真实对话数据'}</strong><p>所有消息按导出顺序显示，包含导出中存在的分支。完全相同的对话去重，不同版本分别保留。只能还原导出包实际提供的内容，不能恢复未导出的消息、删除记录或缺失附件。</p></div></div><h3 className="report-heading">导入来源</h3>{archive.sources.map((source, i) => <div className="source-row" key={`${source.name}-${i}`}><FileJson size={19} /><div><strong>{source.name}</strong><small>{(source.size / 1024 / 1024).toFixed(2)} MB · {source.conversations} 段对话 · {source.messages} 条原始消息</small></div><button className="icon-button" aria-label={`下载原始文件 ${source.name}`} title="下载原始文件" onClick={() => downloadBlob(source.rawBlob, source.name)}><ArrowDownToLine size={17} /></button></div>)}{!archive.sources.length && <p className="muted">请导入 conversations、memories、light_metadata 导出包。</p>}{archive.warnings.map(warning => <p className="inline-error" key={warning}>{warning}</p>)}<div className="report-actions">{!isSharedArchive && <button className="secondary-button" onClick={() => { setReportOpen(false); setImportOpen(true); }}><Import size={16} />继续导入</button>}<button className="secondary-button" disabled={!archive.conversations.length} onClick={() => downloadBlob(jsonBlob(archive.conversations.map(item => item.raw)), 'conversations-restored.json')}><ArrowDownToLine size={16} />导出全部对话 JSON</button><button className="secondary-button" disabled={!archive.documents.length} onClick={() => showInspect('所有原始 JSON 文档', archive.documents)}><Database size={16} />查看全部原始数据</button><button className="secondary-button" disabled={!archive.assets.length} onClick={() => showInspect('导出包文件清单', archive.assets.map(asset => ({ path: asset.path, bytes: asset.blob.size, type: asset.blob.type })))}><Files size={16} />文件清单</button></div><p className="fine-print">{isSharedArchive ? '这是发布时的对话快照，任何持有链接的人均可阅读及下载。全部消息内容保留；账户标识、登录历史和独立记忆文件未公开。此页面不会自动同步发布者后续导入的数据。' : '数据保存在此浏览器的 IndexedDB。清理浏览器数据会移除本机档案，请另行保管原始 ZIP。页面不会把数据写入 Qoder 记忆。'}</p></Modal>}
    {inspect && <Modal title={inspect.title} onClose={() => setInspect(null)} wide><div className="inspector-actions"><span>完整原始数据 · 无截断</span><button className="small-button" onClick={() => downloadBlob(jsonBlob(inspect.value), `${safeName(inspect.title)}.json`)}><ArrowDownToLine size={14} />下载 JSON</button></div><pre className="raw-json">{JSON.stringify(inspect.value, null, 2)}</pre></Modal>}
    {artifact && <Modal title={artifact.title || 'Artifact'} onClose={() => setArtifact(null)} wide><div className="artifact-toolbar"><div className="segmented"><button className={!preview ? 'selected' : ''} onClick={() => setPreview(false)}><FileCode2 size={15} />源码</button><button className={preview ? 'selected' : ''} disabled={!/html|svg/i.test(artifact.language)} onClick={() => setPreview(true)}>静态预览</button></div><button className="small-button" onClick={() => downloadBlob(new Blob([artifact.content], { type: 'text/plain;charset=utf-8' }), `${safeName(artifact.title || 'artifact')}.${/html/i.test(artifact.language) ? 'html' : /svg/i.test(artifact.language) ? 'svg' : 'txt'}`)}><ArrowDownToLine size={15} />下载</button></div>{preview ? <><p className="fine-print">安全静态预览：不执行脚本、不访问网络，因此交互式内容可能与原页面不同。</p><iframe className="artifact-frame" title="Artifact 安全静态预览" sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'none'; form-action 'none'; base-uri 'none';"><style>body{font-family:system-ui;margin:24px;overflow-wrap:anywhere}img,svg{max-width:100%}</style></head><body>${artifact.content}</body></html>`} /></> : <pre className="raw-json artifact-source">{artifact.content}</pre>}</Modal>}
  </div>;
}
