#!/usr/bin/env node
/*
  Поднимает версию приложения во всех местах сразу:
    node scripts/bump-version.mjs 2026-10-04.2 "что нового"

  Версия должна совпадать в четырёх местах, иначе телефон может
  держаться за старые файлы:
    assets/js/data.js  — версия, которую видит запущенное приложение
    version.json       — версия на сервере; приложение сверяет с ней свою
    index.html         — ?v= в адресах файлов, чтобы ни один кеш не отдал старое
    sw.js              — имя кеша офлайн-режима, старый удаляется
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [ver, feature] = process.argv.slice(2);
if (!ver || !/^[0-9A-Za-z._-]+$/.test(ver)) {
  console.error('Использование: node scripts/bump-version.mjs <версия: буквы, цифры, . _ -> "что нового"');
  process.exit(1);
}
const feat = feature || '';

function edit(file, fn) {
  const p = path.join(root, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error('Ничего не поменялось в ' + file + ' — шаблон не найден');
  fs.writeFileSync(p, after);
  console.log('  ' + file);
}

edit('assets/js/data.js', (s) => s.replace(
  /var VERSION = \{[^}]*\};/,
  `var VERSION = { v: ${JSON.stringify(ver)}, feature: ${JSON.stringify(feat)} };`));

edit('index.html', (s) => s.replace(/(href|src)="(assets\/[^"?]+)(\?v=[^"]*)?"/g, `$1="$2?v=${ver}"`));

edit('sw.js', (s) => s.replace(/var CACHE = '[^']*';/, `var CACHE = 'weightloss-${ver}';`));

fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: ver, feature: feat }) + '\n');
console.log('  version.json');
console.log('Версия ' + ver + ' проставлена.');
