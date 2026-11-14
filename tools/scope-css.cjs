/* 一次性工具：把工程页样式表的所有选择器加上作用域前缀，
 * 使其能安全地与三维页面样式共存于同一个 SPA 打包产物。
 * 用法：node tools/scope-css.cjs <css文件> <作用域类名> */
'use strict';
const fs = require('fs');

const [, , file, scope] = process.argv;
if (!file || !scope) { console.error('usage: node scope-css.cjs <file> <scope>'); process.exit(1); }

function prefixSelectors(selectorText) {
  return selectorText.split(',').map(part => {
    const selector = part.trim();
    if (selector === ':root' || selector === 'body' || selector === 'html') return scope;
    return `${scope} ${selector}`;
  }).join(',');
}

function transform(css) {
  let output = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) { output += css.slice(i); break; }
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      // 找到 @media 块的匹配结束括号，递归转换内部。
      let depth = 1, j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const inner = css.slice(open + 1, j - 1);
      output += prelude + '{' + transform(inner) + '}';
      i = j;
    } else {
      let depth = 1, j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const body = css.slice(open + 1, j - 1);
      output += prefixSelectors(prelude) + '{' + body + '}';
      i = j;
    }
  }
  return output;
}

const source = fs.readFileSync(file, 'utf8');
const header = `/* 已由 tools/scope-css.cjs 加上 ${scope} 作用域前缀（SPA 收编后样式共存）。\n * 修改本文件无需重跑脚本：保持新规则同样带 ${scope} 前缀即可。 */\n`;
const extra = `${scope}{display:block;min-height:100vh}\n`;
fs.writeFileSync(file, header + transform(source) + extra);
console.log(`scoped ${file} -> ${scope}`);
