// 文字数の計算ロジック（Web画面とChrome拡張で共通に使う）
(function (global) {
  const segmenter = global.Intl && Intl.Segmenter
    ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
    : null;

  // 見た目どおりの1文字（書記素）に分割する。絵文字や結合文字も1文字
  function graphemes(str) {
    return segmenter ? Array.from(segmenter.segment(str), s => s.segment) : [...str];
  }

  // 半角文字か：ASCII（半角スペース含む）と半角カナ
  function isHankaku(g) {
    if ([...g].length !== 1) return false;
    const c = g.codePointAt(0);
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xff61 && c <= 0xff9f);
  }

  // 全角換算を原則とした各種カウント
  function countAll(text) {
    const clean = text.replace(/\r/g, '');
    const body = graphemes(clean).filter(g => g !== '\n');

    const zenkaku = body.reduce((sum, g) => sum + (isHankaku(g) ? 0.5 : 1), 0);
    const chars = body.length;
    const charsNoSpace = body.filter(g => !/^\s$/.test(g)).length;

    // 原稿用紙（20字×20行）：段落ごとに新しい行から。空行も1行
    const paragraphs = clean === '' ? [] : clean.split('\n');
    const genkoLines = paragraphs.reduce(
      (sum, p) => sum + Math.max(1, Math.ceil(graphemes(p).length / 20)), 0);
    const genkoPages = Math.ceil(genkoLines / 20);

    return { zenkaku, chars, charsNoSpace, genkoLines, genkoPages, lines: paragraphs.length };
  }

  global.MojiCount = { countAll, graphemes, isHankaku };
})(typeof window !== 'undefined' ? window : globalThis);
