import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { conversationMarkdown, findConversations, importFiles, mergeArchives, normalizeConversation } from '../src/lib/archive';
import { emptyArchive } from '../src/lib/types';

const raw = { uuid: 'conversation-1', name: '测试对话：完整性', created_at: '2026-11-18T10:00:00Z', chat_messages: [
  { uuid: 'm1', sender: 'human', text: '请保留全部内容', content: [{ type: 'text', text: '请保留全部内容' }], attachments: [{ file_name: 'notes.txt', extracted_content: '附件中的完整文字' }] },
  { uuid: 'm2', sender: 'assistant', text: '完整回答', content: [{ type: 'thinking', thinking: '导出中存在的思考内容' }, { type: 'text', text: '完整回答' }, { type: 'tool_use', name: 'test_tool', input: { query: '工具关键词' } }, { type: 'unknown_future_block', value: '不可丢失' }] },
  { uuid: 'm3', parent_message_uuid: 'm1', sender: 'assistant', text: '另一个分支的完整回答' },
] };
const makeJson = (name: string, value: unknown) => new File([JSON.stringify(value)], name, { type: 'application/json' });

describe('Claude archive integrity', () => {
  it('preserves every message, order, raw field, branch and unknown block', () => {
    const conversation = normalizeConversation(raw, 'conversations.json', 0);
    expect(conversation.raw).toEqual(raw);
    expect(conversation.messages.map(message => message.id)).toEqual(['m1', 'm2', 'm3']);
    expect(conversation.messages[1].content).toHaveLength(4);
    expect(conversation.messages[2].raw.parent_message_uuid).toBe('m1');
    expect(conversation.searchText).toContain('工具关键词');
    expect(conversation.searchText).toContain('附件中的完整文字');
  });
  it('supports array, wrapped and single conversation formats', () => {
    for (const value of [[raw], { conversations: [raw] }, { data: { chats: [raw] } }, raw]) expect(findConversations(value)).toEqual([raw]);
  });
  it('does not truncate very long content', async () => {
    const text = '完整内容'.repeat(30000) + '最后一个字符标记';
    const result = await importFiles([makeJson('conversations.json', [{ ...raw, chat_messages: [{ sender: 'assistant', text }] }])]);
    expect(result.conversations[0].messages[0].text).toBe(text);
    expect(result.parsedMessageCount).toBe(1);
  });
  it('imports multiple ZIPs with metadata, memories and binary files intact', async () => {
    const image = new Uint8Array([1, 2, 3, 4, 255]);
    const zip = zipSync({ 'conversations.json': strToU8(JSON.stringify([raw])), 'attachments/example.png': image });
    const result = await importFiles([new File([zip], 'conversations-000.zip'), makeJson('memories.json', { memories: [{ text: '真实记忆字段' }] }), makeJson('projects.json', [{ name: '项目字段' }])]);
    expect(result.parsedMessageCount).toBe(3);
    expect(result.sources).toHaveLength(3);
    expect(result.documents).toHaveLength(3);
    expect(new Uint8Array(await result.assets.find(asset => asset.name === 'example.png')!.blob.arrayBuffer())).toEqual(image);
    expect(new Uint8Array(await result.sources[0].rawBlob.arrayBuffer())).toEqual(zip);
  });
  it('rejects manifests without using expiring links', async () => {
    await expect(importFiles([makeJson('manifest.json', { data_files: [{ export_url: 'redacted-export-link' }] })])).rejects.toThrow('下载清单');
  });
  it('rejects HTML masquerading as ZIP and corrupt JSON', async () => {
    await expect(importFiles([new File(['<html>Unavailable</html>'], 'export.zip')])).rejects.toThrow('不是有效 ZIP');
    await expect(importFiles([new File(['{"broken"'], 'conversations.json')])).rejects.toThrow('不是有效 JSON');
  });
  it('retains unsupported primitive message records instead of silently dropping them', () => {
    const conversation = normalizeConversation({ uuid: 'odd', messages: [null, 'raw message', { role: 'system', content: [{ type: 'custom', data: [1, 2] }] }] }, 'odd.json', 0);
    expect(conversation.messages).toHaveLength(3);
    expect(conversation.messages[1].raw.content).toBe('raw message');
    expect(conversation.messages[2].role).toBe('system');
  });
  it('deduplicates identical conversations but preserves differing versions with same ID', async () => {
    const first = await importFiles([makeJson('first.json', [raw])]);
    const identical = mergeArchives(first, first);
    expect(identical.conversations).toHaveLength(1);
    expect(identical.assets).toHaveLength(first.assets.length);
    const changed = await importFiles([makeJson('second.json', [{ ...raw, chat_messages: [...raw.chat_messages, { uuid: 'm4', sender: 'assistant', text: '新版本消息' }] }])]);
    const combined = mergeArchives(identical, changed);
    expect(combined.conversations).toHaveLength(2);
    expect(new Set(combined.conversations.map(item => item.id)).size).toBe(2);
    expect(combined.conversations[1].messages).toHaveLength(4);
    expect(combined.sources).toHaveLength(3);
  });
  it('exports Markdown with complete raw records including tool data', () => {
    const output = conversationMarkdown(normalizeConversation(raw, 'input.json', 0));
    expect(output).toContain('不可丢失');
    expect(output).toContain('工具关键词');
    expect(output).toContain('附件中的完整文字');
    expect(output).toContain('另一个分支的完整回答');
  });
  it('preserves empty conversations and zero data archives', async () => {
    expect((await importFiles([makeJson('empty.json', [{ uuid: 'empty', chat_messages: [] }])])).conversations).toHaveLength(1);
    expect(mergeArchives(emptyArchive(), emptyArchive()).conversations).toHaveLength(0);
  });
});
