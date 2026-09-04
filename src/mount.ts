/** 掛載點的 element id；App shell 與測試共用。 */
export const APP_ROOT_ID = 'app';

/**
 * 建立（或取回）Jelly 沙盒的掛載點——一個空的 `<div id="app">`，接在 `<body>` 底下。
 * 之後 App shell 會把畫布與控制項掛進這個節點。呼叫多次只會保留一個掛載點。
 */
export function createAppRoot(doc: Document): HTMLDivElement {
  const existing = doc.getElementById(APP_ROOT_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const root = doc.createElement('div');
  root.id = APP_ROOT_ID;
  doc.body.appendChild(root);
  return root;
}
