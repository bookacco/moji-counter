// 右クリックメニュー。項目名に「選択中の文字数」を表示する
const EDITOR_URL = 'https://bookacco.github.io/moji-counter/';
const MENU_ID = 'moji-count';
const DEFAULT_TITLE = '選択範囲の文字数を数える';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: DEFAULT_TITLE, contexts: ['selection'] });
});

// 各ページ（content.js）から届いた文字数で、メニューの項目名を書き換える
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'updateMenu') return;
  const r = msg.result;
  const title = r
    ? `${r.zenkaku}字（全角換算）・原稿用紙${r.genkoPages}枚 ― 詳しく見る`
    : DEFAULT_TITLE;
  chrome.contextMenus.update(MENU_ID, { title }).catch(() => {});
});

// タブを切り替えたら、いったん既定の名前に戻す（前のタブの数字が残らないように）
chrome.tabs.onActivated.addListener(() => {
  chrome.contextMenus.update(MENU_ID, { title: DEFAULT_TITLE }).catch(() => {});
});

// クリック時：ページ右下に小窓を出す。出せないページ（Chromeの設定画面など）では編集画面を直接開く
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  try {
    if (!tab || tab.id === undefined) throw new Error('no tab');
    await chrome.tabs.sendMessage(tab.id, { type: 'showToast' }, { frameId: info.frameId ?? 0 });
  } catch (e) {
    chrome.tabs.create({ url: EDITOR_URL + '#text=' + encodeURIComponent(info.selectionText || '') });
  }
});
