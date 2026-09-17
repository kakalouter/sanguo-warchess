// ---------------------------------------------------------------------------
// 生成 js/data_portraits.js —— 武将姓名 -> 头像文件名映射
//
// 数据源：assets/portraits/index.json
//   由 renmu123/koei_san_character_img（光荣三国志人物头像全集，5068 张）
//   筛选而来：文件名即中文人名，取 311_s(964) + 310_s(872) 去重，筛掉 >100KB 的，
//   得到 1052 张 —— 838 个有名人物 + 214 张通用立绘（新武将/养育系统）。
//
//   ⚠ 版权：图像版权归 光荣特库摩 (Koei Tecmo)。仅供本地学习/原型/个人非商业用途，
//     不得再分发或商用。若公开发布请删除 assets/portraits/，游戏会自动回退到
//     js/portrait.js 的程序化头像生成。
//
// 运行：node _source/manifest.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'portraits');
const OUT = path.join(__dirname, '..', 'js', 'data_portraits.js');

if (!fs.existsSync(path.join(DIR, 'index.json'))) {
  console.error('找不到 ' + path.join(DIR, 'index.json'));
  console.error('若已删除头像素材，js/data_portraits.js 会退化为空索引，游戏将使用程序化头像。');
  console.error('此时可写入空索引：');
  fs.writeFileSync(OUT, '// 头像素材已移除，全部使用程序化头像（js/portrait.js）\n' +
    'window.PORTRAIT_INDEX = { base: "assets/portraits/", chars: {}, generic: [] };\n', 'utf8');
  console.error('  已写出空索引到 ' + OUT);
  process.exit(0);
}

const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const named = {};
let collisions = 0;
for (const it of idx.items) {
  if (it.type !== 'character') continue;
  if (named[it.name]) { collisions++; continue; }   // 同名取先出现的
  named[it.name] = it.file;
}
const generic = idx.items.filter((i) => i.type !== 'character').map((i) => i.file);

// 校验文件是否真的都在
let missing = 0;
for (const f of Object.values(named)) if (!fs.existsSync(path.join(DIR, f))) missing++;
for (const f of generic) if (!fs.existsSync(path.join(DIR, f))) missing++;

const out = { base: 'assets/portraits/', chars: named, generic };
const body = '// 自动生成：由 _source/manifest.js 生成，请勿手改\n' +
  '// 头像素材版权归 光荣特库摩 (Koei Tecmo)，仅供本地非商业使用\n' +
  'window.PORTRAIT_INDEX = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(OUT, body, 'utf8');

console.log('已写出 ' + OUT + '  ' + (body.length / 1024).toFixed(0) + ' KB');
console.log(`人物 ${Object.keys(named).length} 名，通用立绘 ${generic.length} 张` + (collisions ? `，同名跳过 ${collisions}` : ''));
if (missing) console.warn(`⚠ 有 ${missing} 个索引条目找不到对应文件`);
else console.log('全部索引条目均有对应文件');
console.log('抽查: 曹操=' + named['曹操'] + ' 吕布=' + named['吕布'] + ' 诸葛亮=' + named['诸葛亮'] + ' 貂蝉=' + named['貂蝉']);
