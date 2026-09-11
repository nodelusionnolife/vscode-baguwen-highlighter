'use strict';

/**
 * Aho–Corasick 多模式串匹配。
 *
 * 词表有 700+ 条短语，若逐条 indexOf 扫全文，每次编辑都是 O(词数 × 文本长度)，
 * 大文件下会明显卡顿。这里改成建一次自动机、单遍扫描得到全部命中。
 *
 * 说明：内部按 UTF-16 码元（text[i]）遍历，因为 VS Code 的 Range 用的就是
 * UTF-16 偏移量。词表全部是 BMP 字符，与码点遍历等价。
 */
class AhoCorasick {
  /**
   * @param {Array<{word: string, categoryId: string}>} patterns
   */
  constructor(patterns) {
    /** @type {Array<Map<string, number>>} */
    this.goto = [new Map()];
    /** @type {number[]} */
    this.fail = [0];
    /** @type {Array<Array<{len: number, categoryId: string, word: string}>>} */
    this.out = [[]];

    for (const p of patterns) this._insert(p);
    this._buildFailureLinks();
  }

  _insert({ word, categoryId }) {
    let state = 0;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      let next = this.goto[state].get(ch);
      if (next === undefined) {
        next = this.goto.length;
        this.goto.push(new Map());
        this.fail.push(0);
        this.out.push([]);
        this.goto[state].set(ch, next);
      }
      state = next;
    }
    this.out[state].push({ len: word.length, categoryId, word });
  }

  _buildFailureLinks() {
    const queue = [];
    for (const child of this.goto[0].values()) {
      this.fail[child] = 0;
      queue.push(child);
    }
    while (queue.length > 0) {
      const state = queue.shift();
      for (const [ch, child] of this.goto[state]) {
        queue.push(child);
        let f = this.fail[state];
        while (f !== 0 && !this.goto[f].has(ch)) f = this.fail[f];
        const candidate = this.goto[f].get(ch);
        this.fail[child] = candidate !== undefined && candidate !== child ? candidate : 0;
        // 合并失配链上的输出，保证所有后缀模式都能被报告
        this.out[child] = this.out[child].concat(this.out[this.fail[child]]);
      }
    }
  }

  /**
   * @param {string} text
   * @returns {Array<{start: number, end: number, categoryId: string, word: string}>}
   */
  search(text) {
    /** @type {Array<{start: number, end: number, categoryId: string, word: string}>} */
    const hits = [];
    let state = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (state !== 0 && !this.goto[state].has(ch)) state = this.fail[state];
      state = this.goto[state].get(ch) || 0;
      const outs = this.out[state];
      if (outs.length === 0) continue;
      for (const o of outs) {
        hits.push({
          start: i - o.len + 1,
          end: i + 1,
          categoryId: o.categoryId,
          word: o.word,
        });
      }
    }
    return hits;
  }

  get size() {
    return this.goto.length;
  }
}

module.exports = { AhoCorasick };
