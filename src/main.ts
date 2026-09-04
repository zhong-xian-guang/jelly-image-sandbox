import './style.css';

import { createAppRoot } from './mount';

// v1 骨架：只準備好掛載點，畫面維持空白。
// 後續票（Mesh pipeline → Simulation core → Renderer → App shell）會往這裡接。
createAppRoot(document);
