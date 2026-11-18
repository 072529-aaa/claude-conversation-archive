import { mkdir, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';

const date = '2026-11-18T12:30:00Z';
const conversations = [
  {
    uuid: 'fixture-complete', name: '[测试数据] 完整消息与排版核验', created_at: date, updated_at: date,
    chat_messages: [
      { uuid: 'human-one', sender: 'human', created_at: date, text: '请完整保留这份分析，包括代码、公式、附件、表格和引用。', content: [{ type: 'text', text: '请完整保留这份分析，包括代码、公式、附件、表格和引用。' }], attachments: [{ file_name: 'research-notes.txt', extracted_content: '附件文本完整性标记：这段内容不能丢失。' }] },
      { uuid: 'assistant-one', sender: 'assistant', created_at: date, text: '', content: [
        { type: 'thinking', thinking: '这是显式包含在测试导出中的思考块，用于验证完整展示。' },
        { type: 'text', text: '## 让信息保持完整\n\n这是用于验证阅读器的**合成测试数据**，不是你的真实对话。正文不会以摘要代替，也不会省略末尾内容。\n\n> 清晰的结构，让长对话更容易阅读。\n\n| 内容 | 状态 |\n| --- | --- |\n| 正文与代码 | 原样保留 |\n| 原始字段 | 可查看与下载 |\n\n### 一段代码\n\n```typescript\nconst restore = (messages: string[]) => {\n  return messages.map(message => message);\n};\nconsole.log(restore(["完整", "保留"]));\n```\n\n### 公式与任务\n\n行内公式 $E = mc^2$。\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$\n\n- [x] Markdown 排版\n- [x] 本地数据保留\n- [ ] 等待真实导出 ZIP\n\n![本地像素图片](pixel.png)\n\n![外部图片不应联网加载](https://example.invalid/private.png)\n\n<script>window.__ARCHIVE_XSS_TEST__ = true</script>\n\n注释测试[^1]。 [下载笔记](research-notes.txt)\n\n[^1]: 脚注正文完整保留。\n\n正文结束标记：已完整保留。' },
        { type: 'tool_use', id: 'tool-one', name: 'search', input: { query: '工具检索唯一关键词' } },
        { type: 'tool_result', tool_use_id: 'tool-one', content: [{ type: 'text', text: '完整工具返回内容' }] },
        { type: 'future_block', custom_value: '未知类型完整性标记' },
      ] },
      { uuid: 'human-two', sender: 'human', text: '请提供一个静态 Artifact。' },
      { uuid: 'assistant-two', sender: 'assistant', parent_message_uuid: 'human-two', text: '下面是完整的卡片。\n<antArtifact identifier="card" type="text/html" title="测试静态卡片"><div style="padding:30px;background:#f4efe6"><h1>静态 Artifact</h1><p>源码完整保存，脚本不会运行。</p><script>window.parent.__ARTIFACT_XSS_TEST__=true</script></div></antArtifact>\n卡片之后的文字也要保留。' },
      { uuid: 'assistant-branch', sender: 'assistant', parent_message_uuid: 'human-two', text: '分支消息保留标记：这是一条独立的回答分支。', files: [{ file_name: 'missing-report.pdf', file_size: 1024 }] },
    ],
  },
  { uuid: 'fixture-long', name: '[测试数据] 长对话末尾核验', created_at: date, updated_at: '2026-11-17T10:00:00Z', chat_messages: Array.from({ length: 121 }, (_, index) => ({ uuid: `long-${index}`, sender: index % 2 ? 'assistant' : 'human', text: index === 120 ? '长对话最后一条标记：第 121 条消息完整存在。' : `第 ${index + 1} 条测试消息。\n\n这是测试消息正文，需要逐条完整展示，不裁剪历史消息。`, created_at: date })) },
  { uuid: 'fixture-empty', name: '[测试数据] 空对话', created_at: date, updated_at: date, chat_messages: [] },
];
const pixel = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=', 'base64'));
await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('./fixtures/conversations-test.zip', import.meta.url), zipSync({ 'conversations.json': strToU8(JSON.stringify(conversations)), 'attachments/pixel.png': pixel, 'attachments/research-notes.txt': strToU8('附件文本完整性标记：这段内容不能丢失。') }));
await writeFile(new URL('./fixtures/memories-test.zip', import.meta.url), zipSync({ 'memories.json': strToU8(JSON.stringify({ memories: [{ text: '合成测试记忆：保留原文。' }] })) }));
await writeFile(new URL('./fixtures/metadata-test.zip', import.meta.url), zipSync({ 'projects.json': strToU8(JSON.stringify([{ uuid: 'p1', name: '测试项目', description: '项目原始信息完整性标记' }])), 'user.json': strToU8(JSON.stringify({ display_name: '本地测试用户' })) }));
await writeFile(new URL('./fixtures/manifest-test.json', import.meta.url), JSON.stringify({ total_files: 3, data_files: [{ export_url: 'redacted' }] }));
console.log('Created explicitly labeled synthetic browser-test fixtures.');
