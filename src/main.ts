import './style.css';

import { JellySandbox } from './app';
import { createAppRoot } from './mount';

// First playable（issue #11 / T10）：預設 Jelly + 指標拖曳 + 固定步主迴圈。
const root = createAppRoot(document);

JellySandbox.create(root)
  .then((sandbox) => {
    sandbox.start();
    if (import.meta.env.DEV) {
      // 開發時方便從 console 抓來看狀態。
      (globalThis as Record<string, unknown>).__jelly = sandbox;
    }
  })
  .catch((err: unknown) => {
    console.error('[jelly] 初始化失敗', err);
    root.textContent = `初始化失敗：${err instanceof Error ? err.message : String(err)}`;
  });
