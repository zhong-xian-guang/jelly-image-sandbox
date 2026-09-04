import { beforeEach, describe, expect, it } from 'vitest';

import { APP_ROOT_ID, createAppRoot } from './mount';

describe('createAppRoot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('在 body 底下建立一個掛載用的 <div id="app">', () => {
    const root = createAppRoot(document);

    expect(root.tagName).toBe('DIV');
    expect(root.id).toBe(APP_ROOT_ID);
    expect(root.parentElement).toBe(document.body);
  });

  it('掛載點是空的（畫面空白、掛載點就緒）', () => {
    const root = createAppRoot(document);

    expect(root.childElementCount).toBe(0);
    expect(root.textContent).toBe('');
  });

  it('呼叫多次只會有一個掛載點，且回傳同一個節點', () => {
    const first = createAppRoot(document);
    const second = createAppRoot(document);

    expect(second).toBe(first);
    expect(document.querySelectorAll(`#${APP_ROOT_ID}`)).toHaveLength(1);
  });
});
