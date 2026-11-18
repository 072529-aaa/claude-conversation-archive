import { importFiles } from './archive';
import type { ArchiveData } from './types';

export const isSharedArchive = import.meta.env.MODE === 'shared';

export async function loadSharedArchive(): Promise<ArchiveData> {
  const filename = import.meta.env.DEV ? 'dist-shared/shared-conversations.json' : 'shared-conversations.json';
  const response = await fetch(`${import.meta.env.BASE_URL}${filename}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('分享数据暂时无法加载，请稍后刷新。');
  const file = new File([await response.blob()], 'shared-conversations.json', { type: 'application/json' });
  return importFiles([file]);
}
