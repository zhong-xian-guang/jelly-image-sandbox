import './style.css';

import { JellySandbox } from './app';
import { createAppRoot } from './mount';

// First playable（issue #11 / T10）：預設 Jelly + 指標拖曳 + 固定步主迴圈。
const root = createAppRoot(document);

void JellySandbox.create(root).then((sandbox) => {
  sandbox.start();
  // 開發時方便從 console 抓來看狀態。
  (globalThis as Record<string, unknown>).__jelly = sandbox;
});
