// 各ページで動く部分：選択した時点で文字数を数え、
// ①選択範囲の横に小バッジ ②右クリックメニューの項目名 に反映する。
// 計算はこのPCの中だけで行い、文章をどこにも送信しません。
(() => {
  if (window.__mojiCountLoaded) return;
  window.__mojiCountLoaded = true;

  const EDITOR_URL = 'https://bookacco.github.io/moji-counter/';
  const css = (node, styles) => Object.assign(node.style, styles);

  // 選択中の文章を取得（入力欄の中の選択にも対応）
  function getSelectedText() {
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
        typeof el.selectionStart === 'number' && el.selectionEnd > el.selectionStart) {
      return el.value.slice(el.selectionStart, el.selectionEnd);
    }
    // ページ上の段落間は空行として取れてしまうため、連続する改行は1つにまとめる
    return String(window.getSelection() || '').replace(/\n{2,}/g, '\n');
  }

  // ---- 右クリックメニューの項目名を更新 ----
  let lastTitleKey = '';
  function updateMenu(r) {
    const key = r ? `${r.zenkaku}-${r.genkoPages}` : '';
    if (key === lastTitleKey) return;
    lastTitleKey = key;
    try { chrome.runtime.sendMessage({ type: 'updateMenu', result: r }); } catch (e) { /* 拡張の再読み込み直後など */ }
  }

  // ---- 小バッジ ----
  let badge = null;
  function hideBadge() { if (badge) { badge.remove(); badge = null; } }
  function showBadge(r, x, y) {
    hideBadge();
    badge = document.createElement('div');
    badge.textContent = `${r.zenkaku}字`;
    css(badge, {
      position: 'absolute', left: `${x + window.scrollX + 8}px`, top: `${y + window.scrollY + 8}px`,
      zIndex: '2147483647', pointerEvents: 'none',
      background: '#8a5a2b', color: '#fff', borderRadius: '10px', padding: '2px 8px',
      font: '600 12px/1.6 system-ui, "Yu Gothic UI", "Hiragino Sans", sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,.2)', whiteSpace: 'nowrap'
    });
    (document.body || document.documentElement).appendChild(badge);
  }

  // 選択範囲の右下あたりの座標（取れなければマウス位置）
  function anchorPoint(fallbackX, fallbackY) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const rects = sel.getRangeAt(0).getClientRects();
      const last = rects[rects.length - 1];
      if (last && (last.width || last.height)) return [last.right, last.bottom];
    }
    return [fallbackX, fallbackY];
  }

  let lastMouse = [0, 0];
  function refresh(showAtMouse) {
    const text = getSelectedText();
    if (!text.trim()) { hideBadge(); updateMenu(null); return; }
    const r = window.MojiCount.countAll(text);
    updateMenu(r);
    if (showAtMouse) {
      const [x, y] = anchorPoint(lastMouse[0], lastMouse[1]);
      showBadge(r, x, y);
    }
  }

  // ドラッグを終えた時・キーボードで選択した時にバッジを出す
  document.addEventListener('mouseup', (e) => {
    lastMouse = [e.clientX, e.clientY];
    setTimeout(() => refresh(true), 0);
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) refresh(true);
  }, true);
  // 選択が消えたらバッジも消す（メニュー名も戻す）
  let timer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!getSelectedText().trim()) { hideBadge(); updateMenu(null); } }, 150);
  });
  document.addEventListener('mousedown', hideBadge, true);
  // 右クリック直前にも念のため最新化／タブを切り替えて戻った時も最新化
  document.addEventListener('contextmenu', () => refresh(false), true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { lastTitleKey = '?'; refresh(false); }
  });

  // ---- メニューをクリックした時の小窓（数秒で消える） ----
  function showToast() {
    const text = getSelectedText();
    const r = window.MojiCount.countAll(text);
    hideBadge();
    const old = document.getElementById('moji-count-toast');
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = 'moji-count-toast';
    css(box, {
      position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647',
      background: '#fff', color: '#222', borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 6px 24px rgba(0,0,0,.18)', minWidth: '220px',
      font: '14px/1.5 system-ui, "Yu Gothic UI", "Hiragino Sans", sans-serif',
      transition: 'opacity .3s', opacity: '1'
    });

    const main = document.createElement('div');
    const num = document.createElement('span');
    num.textContent = r.zenkaku;
    css(num, { fontSize: '28px', fontWeight: '600', color: '#8a5a2b', marginRight: '6px' });
    const unit = document.createElement('span');
    unit.textContent = '文字（全角換算）';
    css(unit, { fontSize: '12px', color: '#777' });
    main.append(num, unit);

    const sub = document.createElement('div');
    sub.textContent = `文字数 ${r.chars}　原稿用紙 ${r.genkoPages}枚（${r.genkoLines}行）`;
    css(sub, { fontSize: '12px', color: '#555', margin: '2px 0 10px' });

    const btn = document.createElement('button');
    btn.textContent = '編集画面で開く';
    css(btn, {
      border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer',
      background: '#8a5a2b', color: '#fff', font: 'inherit', fontSize: '13px'
    });
    btn.addEventListener('click', () => {
      window.open(EDITOR_URL + '#text=' + encodeURIComponent(text), '_blank');
      box.remove();
    });

    const close = document.createElement('span');
    close.textContent = '×';
    css(close, { position: 'absolute', top: '6px', right: '10px', cursor: 'pointer', color: '#999', fontSize: '16px' });
    close.addEventListener('click', () => box.remove());

    box.append(close, main, sub, btn);
    (document.body || document.documentElement).appendChild(box);

    // 5秒で消える。マウスを乗せている間は消えない
    let t;
    const startTimer = (ms) => {
      clearTimeout(t);
      t = setTimeout(() => { box.style.opacity = '0'; setTimeout(() => box.remove(), 300); }, ms);
    };
    box.addEventListener('mouseenter', () => { clearTimeout(t); box.style.opacity = '1'; });
    box.addEventListener('mouseleave', () => startTimer(2000));
    startTimer(5000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'showToast') showToast();
  });
})();
