import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = JSON.parse(await readFile(new URL('../downloads/shared-conversations-source.json', import.meta.url), 'utf8'));
assert.ok(Array.isArray(source.conversations) && source.conversations.length > 0, 'No real conversations available for sharing');
const conversations = source.conversations.map(({ account, ...conversation }) => conversation);
for (let index = 0; index < conversations.length; index++) assert.deepEqual(conversations[index].chat_messages, source.conversations[index].chat_messages);
await writeFile(new URL('../dist-shared/shared-conversations.json', import.meta.url), JSON.stringify({ conversations }));
const htmlPath = new URL('../dist-shared/index.html', import.meta.url);
const html = await readFile(htmlPath, 'utf8');
await writeFile(htmlPath, html.replace('<title>Claude · 对话档案</title>', '<title>Claude · 对话分享</title>\n<meta name="robots" content="noindex, nofollow, noarchive" />').replace("connect-src 'self' ws://127.0.0.1:5173", "connect-src 'self'"));
console.log(`Prepared ${conversations.length} conversations, ${conversations.reduce((sum, item) => sum + item.chat_messages.length, 0)} messages. Account metadata excluded; all message records unchanged.`);
