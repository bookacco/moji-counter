// Webページにマーカーを引き、このPCのChromeに保存して、次に開いたときに復元する。
// 位置は「マーカーの文字列＋前後の文字」で覚える（ページの構造が多少変わっても復元しやすい）。
// 保存先は chrome.storage.local（このPCのみ）。どこにも送信しません。
(() => {
  if (window.MojiMarker || window.top !== window) return; // いちばん外側のページだけで動かす

  const COLOR = 'rgba(255, 221, 87, .75)';       // 明るい背景用：薄い黄色（文字色はそのまま）
  const DARK_BG = '#FFE066', DARK_TEXT = '#111';  // 暗い背景用：濃い黄色＋黒文字（白文字だと読みにくいため）
  const CONTEXT = 32;          // 前後に覚えておく文字数
  const UI_ATTR = 'data-moji-ui'; // 拡張自身が作った要素の目印
  const css = (node, styles) => Object.assign(node.style, styles);
  const pageKey = () => 'marks:' + location.origin + location.pathname + location.search;

  // ---------- ページ本文のテキストノードを順番に集める ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE']);
  function textNodes() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        for (let p = n.parentElement; p; p = p.parentElement) {
          if (SKIP.has(p.tagName) || p.hasAttribute(UI_ATTR)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (let n; (n = walker.nextNode());) out.push(n);
    return out;
  }
  function indexText() {
    const nodes = textNodes();
    const starts = [];
    let text = '';
    for (const n of nodes) { starts.push(text.length); text += n.data; }
    return { nodes, starts, text };
  }
  // 範囲の端（コンテナ＋オフセット）を、本文全体の何文字目かに変換
  function toOffset(idx, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const i = idx.nodes.indexOf(container);
      return i >= 0 ? idx.starts[i] + offset : -1;
    }
    // 要素の場合：その位置より後ろにある最初のテキストノードの先頭
    const probe = document.createRange();
    probe.setStart(container, offset);
    for (let i = 0; i < idx.nodes.length; i++) {
      if (probe.comparePoint(idx.nodes[i], 0) >= 0) return idx.starts[i];
    }
    return idx.text.length;
  }
  // 本文の何文字目〜何文字目 を、テキストノード上の位置に戻す
  function toPoint(idx, pos, isEnd) {
    for (let i = 0; i < idx.nodes.length; i++) {
      const s = idx.starts[i], e = s + idx.nodes[i].data.length;
      if (pos < e || (isEnd && pos === e)) return [idx.nodes[i], pos - s];
    }
    const last = idx.nodes[idx.nodes.length - 1];
    return [last, last.data.length];
  }

  // 文字色が明るい（＝暗い背景のページ）かどうか
  function isLightText(el) {
    const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
  }

  // ---------- 描画：範囲内のテキストを <mark> で囲む ----------
  function wrap(idx, start, end, id) {
    const pieces = [];
    for (let i = 0; i < idx.nodes.length; i++) {
      const s = idx.starts[i], e = s + idx.nodes[i].data.length;
      if (e <= start || s >= end) continue;
      pieces.push([idx.nodes[i], Math.max(start, s) - s, Math.min(end, e) - s]);
    }
    const marks = [];
    for (const [node, a, b] of pieces) {
      if (!node.data.slice(a, b).trim()) continue; // 空白だけの部分は囲まない
      let target = node;
      if (b < target.data.length) target.splitText(b);
      if (a > 0) target = target.splitText(a);
      const m = document.createElement('mark');
      m.dataset.mojiMark = id;
      const dark = isLightText(target.parentElement);
      css(m, { background: dark ? DARK_BG : COLOR, color: dark ? DARK_TEXT : 'inherit',
               padding: '0', borderRadius: '2px', cursor: 'pointer' });
      target.parentNode.insertBefore(m, target);
      m.appendChild(target);
      m.addEventListener('click', onMarkClick);
      marks.push(m);
    }
    return marks;
  }
  function unwrap(id) {
    document.querySelectorAll(`mark[data-moji-mark="${id}"]`).forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
  }

  // ---------- 保存・読み込み ----------
  async function load() {
    const key = pageKey();
    const data = await chrome.storage.local.get(key);
    return data[key] || [];
  }
  async function save(list) {
    const key = pageKey();
    if (list.length) await chrome.storage.local.set({ [key]: list });
    else await chrome.storage.local.remove(key);
  }

  // ---------- マーカーを追加（選択範囲から） ----------
  async function addFromRange(range) {
    if (!range || range.collapsed) return false;
    const idx = indexText();
    const start = toOffset(idx, range.startContainer, range.startOffset);
    const end = toOffset(idx, range.endContainer, range.endOffset);
    if (start < 0 || end <= start) return false;
    const quote = idx.text.slice(start, end);
    if (!quote.trim()) return false;
    const mark = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      quote,
      prefix: idx.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: idx.text.slice(end, end + CONTEXT),
      pos: start,
      created: new Date().toISOString()
    };
    wrap(idx, start, end, mark.id);
    window.getSelection()?.removeAllRanges();
    const list = await load();
    list.push(mark);
    await save(list);
    drawTicks();
    return true;
  }

  // ---------- 復元：文字列を探し、前後の文字が一番合う場所に引き直す ----------
  function score(text, at, mark) {
    const before = text.slice(Math.max(0, at - mark.prefix.length), at);
    const after = text.slice(at + mark.quote.length, at + mark.quote.length + mark.suffix.length);
    let s = 0;
    for (let i = 1; i <= Math.min(before.length, mark.prefix.length) && before.at(-i) === mark.prefix.at(-i); i++) s++;
    for (let i = 0; i < Math.min(after.length, mark.suffix.length) && after[i] === mark.suffix[i]; i++) s++;
    return s * 100000 - Math.abs(at - mark.pos); // 前後一致を最優先、同点なら元の位置に近い方
  }
  function find(idx, mark) {
    let best = -1, bestScore = -Infinity;
    for (let at = idx.text.indexOf(mark.quote); at >= 0; at = idx.text.indexOf(mark.quote, at + 1)) {
      const sc = score(idx.text, at, mark);
      if (sc > bestScore) { bestScore = sc; best = at; }
    }
    return best;
  }
  let missing = [];
  async function restore() {
    const list = await load();
    const todo = list.filter(m => !document.querySelector(`mark[data-moji-mark="${m.id}"]`));
    if (!todo.length) { missing = []; drawTicks(); return; }
    missing = [];
    for (const m of todo) {
      const idx = indexText(); // 引くたびにテキストノードが分割されるので毎回作り直す
      const at = find(idx, m);
      if (at >= 0) wrap(idx, at, at + m.quote.length, m.id);
      else missing.push(m);
    }
    drawTicks();
  }

  // ---------- 右端の目印（クリックでその場所へ移動） ----------
  let rail = null;
  function drawTicks() {
    const firsts = new Map();
    document.querySelectorAll('mark[data-moji-mark]').forEach(m => {
      if (!firsts.has(m.dataset.mojiMark)) firsts.set(m.dataset.mojiMark, m);
    });
    if (!firsts.size) { rail?.remove(); rail = null; copyBtn?.remove(); copyBtn = null; return; }
    if (!rail) {
      rail = document.createElement('div');
      rail.setAttribute(UI_ATTR, '');
      css(rail, { position: 'fixed', top: '34px', right: '0', width: '14px', height: 'calc(100vh - 34px)',
                  zIndex: '2147483646', pointerEvents: 'none' });
      document.documentElement.appendChild(rail);
    }
    drawCopyButton(firsts.size);
    rail.replaceChildren();
    const total = Math.max(document.documentElement.scrollHeight, 1);
    for (const [id, m] of firsts) {
      const top = m.getBoundingClientRect().top + window.scrollY;
      const tick = document.createElement('div');
      tick.title = m.textContent.slice(0, 60) + ' （クリックで移動）';
      css(tick, {
        position: 'absolute', right: '2px', width: '10px', height: '5px', borderRadius: '2px',
        top: `calc(${(top / total) * 100}% - 2px)`, background: '#f2b705',
        boxShadow: '0 0 0 1px rgba(0,0,0,.25)', cursor: 'pointer', pointerEvents: 'auto'
      });
      tick.addEventListener('click', () => {
        m.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flash(id);
      });
      rail.appendChild(tick);
    }
  }
  function flash(id) {
    const ms = document.querySelectorAll(`mark[data-moji-mark="${id}"]`);
    ms.forEach(m => { m.style.transition = 'box-shadow .2s'; m.style.boxShadow = '0 0 0 3px #f2b705'; });
    setTimeout(() => ms.forEach(m => { m.style.boxShadow = 'none'; }), 1200);
  }

  // ---------- 右上のコピーボタン：ページ内のマーカーを上から順にまとめてコピー ----------
  let copyBtn = null;
  function drawCopyButton(count) {
    if (!copyBtn) {
      copyBtn = document.createElement('div');
      copyBtn.setAttribute(UI_ATTR, '');
      copyBtn.title = 'このページのマーカーをまとめてコピー';
      css(copyBtn, {
        position: 'fixed', top: '6px', right: '4px', zIndex: '2147483647', cursor: 'pointer',
        background: '#f2b705', color: '#222', borderRadius: '6px', padding: '1px 6px',
        font: '600 12px/1.6 system-ui, "Yu Gothic UI", sans-serif', boxShadow: '0 1px 6px rgba(0,0,0,.3)',
        userSelect: 'none'
      });
      copyBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
      copyBtn.addEventListener('click', copyAll);
      document.documentElement.appendChild(copyBtn);
    }
    copyBtn.textContent = `📋 ${count}`;
  }
  // ページ上の並び順（上から）でマーカーのidを返す
  function orderedIds() {
    const ids = [];
    document.querySelectorAll('mark[data-moji-mark]').forEach(m => {
      if (!ids.includes(m.dataset.mojiMark)) ids.push(m.dataset.mojiMark);
    });
    return ids;
  }
  async function copyAll() {
    const byId = new Map((await load()).map(m => [m.id, m.quote]));
    const lines = orderedIds().map(id => (byId.get(id) || '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    const text = lines.join('\n');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute(UI_ATTR, '');
      css(ta, { position: 'fixed', top: '-1000px', opacity: '0' });
      document.body.appendChild(ta); ta.select();
      ok = document.execCommand('copy'); ta.remove();
    }
    notice(ok ? `マーカー ${lines.length}件をコピーしました` : 'コピーできませんでした');
  }

  // ---------- 右下の小さなお知らせ（「3 / 7」「コピーしました」など） ----------
  let noticeEl = null, noticeTimer = null;
  function notice(msg) {
    if (!noticeEl) {
      noticeEl = document.createElement('div');
      noticeEl.setAttribute(UI_ATTR, '');
      css(noticeEl, {
        position: 'fixed', right: '24px', bottom: '24px', zIndex: '2147483647', pointerEvents: 'none',
        background: 'rgba(30,30,30,.88)', color: '#fff', borderRadius: '8px', padding: '4px 12px',
        font: '600 13px/1.6 system-ui, "Yu Gothic UI", sans-serif', transition: 'opacity .3s'
      });
      document.documentElement.appendChild(noticeEl);
    }
    noticeEl.textContent = msg;
    noticeEl.style.opacity = '1';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (noticeEl) noticeEl.style.opacity = '0'; }, 1300);
  }

  // ---------- Ctrl+↓ / Ctrl+↑ で次・前のマーカーへ移動 ----------
  function isEditable(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }
  let lastId = null; // 直前にキーで移動したマーカー
  function jump(dir) {
    const ids = orderedIds();
    if (!ids.length) return false;
    const el = id => document.querySelector(`mark[data-moji-mark="${id}"]`);
    let i;
    const cur = lastId ? ids.indexOf(lastId) : -1;
    const r = cur >= 0 ? el(lastId).getBoundingClientRect() : null;
    if (r && r.bottom > 0 && r.top < window.innerHeight) {
      // 直前のマーカーが画面内にある → そこから1つ前後へ（端まで行ったら反対側へ）
      i = (cur + dir + ids.length) % ids.length;
    } else {
      // 自分でスクロールした後など → 画面の中央を基準に次・前を探す
      const center = window.innerHeight / 2;
      const mids = ids.map(id => { const b = el(id).getBoundingClientRect(); return (b.top + b.bottom) / 2; });
      if (dir > 0) {
        i = mids.findIndex(m => m > center + 20);
        if (i < 0) i = 0;
      } else {
        i = -1;
        mids.forEach((m, k) => { if (m < center - 20) i = k; });
        if (i < 0) i = ids.length - 1;
      }
    }
    lastId = ids[i];
    el(lastId).scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(lastId);
    notice(`${i + 1} / ${ids.length}`);
    return true;
  }
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (isEditable(document.activeElement)) return; // 入力中はブラウザ本来の動きを優先
    if (jump(e.key === 'ArrowDown' ? 1 : -1)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- マーカーをクリック → 「消す」ボタン ----------
  let chip = null;
  function onMarkClick(e) {
    const id = e.currentTarget.dataset.mojiMark;
    chip?.remove();
    chip = document.createElement('div');
    chip.setAttribute(UI_ATTR, '');
    chip.textContent = '✕ マーカーを消す';
    css(chip, {
      position: 'absolute', left: `${e.clientX + window.scrollX + 6}px`, top: `${e.clientY + window.scrollY + 10}px`,
      zIndex: '2147483647', background: '#333', color: '#fff', borderRadius: '6px', padding: '3px 10px',
      font: '12px/1.6 system-ui, "Yu Gothic UI", sans-serif', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.25)'
    });
    chip.addEventListener('mousedown', ev => ev.stopPropagation(), true);
    chip.addEventListener('click', async () => {
      unwrap(id);
      await save((await load()).filter(m => m.id !== id));
      chip.remove(); chip = null;
      drawTicks();
    });
    document.body.appendChild(chip);
    setTimeout(() => { chip?.remove(); chip = null; }, 3000);
  }

  // ---------- 起動時の復元と、後から読み込まれる本文への対応 ----------
  let pending = null;
  function scheduleRestore() {
    clearTimeout(pending);
    pending = setTimeout(restore, 400);
  }
  restore();
  const observer = new MutationObserver((records) => {
    const fromUs = records.every(r => [...r.addedNodes, ...r.removedNodes].every(n =>
      (n.nodeType === 1 && (n.hasAttribute?.(UI_ATTR) || n.dataset?.mojiMark)) || n.nodeType === 3));
    if (!fromUs) scheduleRestore();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 20000); // 20秒後に監視を止める（重くしないため）

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawTicks, 200); });
  window.addEventListener('load', () => setTimeout(drawTicks, 500));

  window.MojiMarker = { addFromRange, restore, UI_ATTR, getMissing: () => missing };
})();
