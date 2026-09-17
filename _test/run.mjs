#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 一键回归测试 —— 启动本地服务 + headless Chrome 跑完所有测试页并汇总
//
//   node _test/run.mjs            跑全部
//   node _test/run.mjs diag geo   只跑指定页面
//   node _test/run.mjs --list     列出所有测试页
//
// 依赖：Node 18+（用内置 fetch）、本机已安装的 Chrome 或 Edge。
//       可用环境变量 CHROME_PATH 指定浏览器路径。
//
// 退出码：0 = 全部通过；1 = 有失败项或无法运行。
//
// 为什么需要这个脚本：本项目的表现层（WebGL 画面）无法用纯 Node 单测覆盖，
// 只能开真实浏览器。而手工拼命令容易踩三个坑（见 docs/TESTING.md §2）：
//   1) --dump-dom 在 --virtual-time-budget 下会挂住不退出，要用后台进程 + 超时；
//   2) 结果要靠页面 POST 回本地服务，服务必须把路径规范成绝对路径（否则 Windows
//      上 path.join 用反斜杠，startsWith 校验会全部 404）；
//   3) 部分沙箱环境下 Chrome 起不来（mojo 命名管道被拒），要给出明确提示而不是干等。
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');           // 仓库根（含 index.html）
const TMP = path.join(HERE, '_out');
const PORT = Number(process.env.PORT || 18742);

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8',
  '.mjs': 'application/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8',
  '.json': 'application/json;charset=utf-8', '.md': 'text/markdown;charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

// 测试页定义。needsServer 恒为 true；weight 用于输出排序。
const PAGES = [
  { id: 'diag', file: '_test/diag2.html', timeout: 200000,
    desc: '逻辑+引擎：数据完整性、邻接连通、战场生成、6兵种×38战法全推演、25场战斗节奏、存档一致性、双渲染器像素校验' },
  { id: 'ui', file: '_test/ui.html', timeout: 220000,
    desc: '端到端：iframe 驱动真实 index.html，开局→内政→5弹窗→回合(含AI)→出兵→进入战斗→结算→存档' },
  { id: 'geo', file: '_test/geo.html', timeout: 180000,
    desc: '地形几何自检：顶点范围/NaN/相邻跳变、取景构图、贴图vs纯色A/B对照、多视角截图' },
  { id: 'bt', file: '_test/bt.html', timeout: 150000,
    desc: '战场渲染专项：rAF、帧数、三角形计数、逐帧像素采样' },
];

// ---------------------------------------------------------------- 工具
const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log('可用测试页：');
  for (const p of PAGES) console.log(`  ${p.id.padEnd(6)} ${p.file.padEnd(24)} ${p.desc}`);
  process.exit(0);
}
const pick = args.filter((a) => !a.startsWith('-'));
const targets = pick.length ? PAGES.filter((p) => pick.includes(p.id)) : PAGES;
if (!targets.length) { console.error(`没有匹配的测试页。可用：${PAGES.map((p) => p.id).join(', ')}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (n) => (n / 1048576).toFixed(1) + ' MB';

// ---------------------------------------------------------------- 语法预检
// 测试页的失败模式很坑：内联脚本一旦有语法错误（重复声明、括号不配对），
// 整段 IIFE 根本不会执行，页面既不报错也不回传，只能干等到超时。
// 这里在开浏览器之前用 vm.Script 把每个内联脚本块过一遍，秒级发现问题。
function preflight() {
  const files = ['index.html', ...PAGES.map((p) => p.file)];
  const problems = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(`${rel}: 文件不存在`); continue; }
    const text = fs.readFileSync(abs, 'utf8');
    // 内联脚本（排除带 src 的）与独立 js 文件
    const blocks = [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const srcs = [...text.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    blocks.forEach((b, i) => {
      try { new vm.Script(b, { filename: `${rel}#inline${i}` }); }
      catch (e) { problems.push(`${rel} 内联脚本#${i}: ${e.message}`); }
    });
    for (const s of srcs) {
      if (/^https?:/.test(s)) continue;
      const f = path.resolve(ROOT, s.replace(/^\//, ''));
      if (!fs.existsSync(f)) { problems.push(`${rel} 引用了不存在的脚本 ${s}`); continue; }
      try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: s }); }
      catch (e) { problems.push(`${s}: ${e.message}`); }
    }
  }
  return problems;
}

const problems = preflight();
if (problems.length) {
  console.error('✘ 语法预检未通过，先修好再跑浏览器（否则会白等好几分钟）：\n');
  for (const p of problems) console.error('   ' + p);
  console.error('\n提示：最常见的成因是「同名变量被声明两次」——整段脚本会静默不执行。');
  process.exit(1);
}
console.log('✔ 语法预检通过（' + (1 + PAGES.length) + ' 个页面，含全部内联脚本与引用的 js）');

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}

// ---------------------------------------------------------------- 服务
let resultBody = null;
let shots = 0;

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (req.method === 'POST' && req.url === '/result') {
        let b = '';
        req.on('data', (d) => (b += d));
        req.on('end', () => { resultBody = b; res.writeHead(200, cors); res.end('ok'); });
        return;
      }
      if (req.method === 'POST' && req.url === '/shot') {
        let b = '';
        req.on('data', (d) => (b += d));
        req.on('end', () => {
          const m = /^data:image\/(\w+);base64,(.*)$/s.exec(b);
          if (m) {
            const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
            const f = path.join(TMP, `shot_${String(++shots).padStart(2, '0')}_${Date.now()}.${ext}`);
            fs.writeFileSync(f, Buffer.from(m[2], 'base64'));
          }
          res.writeHead(200, cors); res.end('ok');
        });
        return;
      }
      // 静态文件：必须 resolve 成绝对路径再校验前缀（Windows 上 path.join 用反斜杠）
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.resolve(ROOT, '.' + p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); res.end('404'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ---------------------------------------------------------------- 单页执行
function runPage(browser, page) {
  return new Promise((resolve) => {
    resultBody = null;
    const profile = path.join(TMP, 'profile_' + page.id);
    fs.rmSync(profile, { recursive: true, force: true });
    const url = `http://127.0.0.1:${PORT}/${page.file}`;
    const errLog = path.join(TMP, `chrome_${page.id}.log`);
    const errFd = fs.openSync(errLog, 'w');

    // 注意：stdio 走文件描述符而非管道。沙箱环境禁止匿名管道时，
    // 用 'pipe' 抓输出会让子进程直接 EPERM 起不来。
    const child = spawn(browser, [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      '--disable-crash-reporter', '--disable-breakpad', '--disable-sync',
      '--disable-background-networking', '--disable-component-update',
      '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      '--mute-audio', '--hide-scrollbars', '--enable-unsafe-swiftshader',
      '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${profile}`, '--window-size=1600,1000', url,
    ], { stdio: ['ignore', errFd, errFd] });

    let earlyExit = null;
    child.on('exit', (code) => { earlyExit = code; });
    child.on('error', (e) => { earlyExit = 'spawn-error: ' + e.message; });

    const t0 = Date.now();
    const tick = setInterval(() => {
      const el = Math.round((Date.now() - t0) / 1000);
      process.stdout.write(`\r  … 运行中 ${el}s / 上限 ${page.timeout / 1000}s   `);
    }, 1000);

    const finish = () => {
      clearInterval(tick);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      try { fs.closeSync(errFd); } catch { /* ignore */ }
      const body = resultBody;
      const plain = body ? body.replace(/<[^>]+>/g, '') : '';
      // 各测试页输出风格不一：diag2/ui 用 <span class="ok|err|warn">，
      // geo/bt 用纯文本 "✔ / ✘ / !"。两种都统计，另外兜一层"必须有实质输出"。
      const count = (re) => (body ? (body.match(re) || []).length : 0);
      const clicks = count(/class="ok"/g) + count(/^\s*✔/gm);
      const errs = count(/class="err"/g) + count(/^\s*✘/gm);
      const warns = count(/class="warn"/g) + count(/^\s*!\s/gm);
      const chars = plain.replace(/\s/g, '').length;
      let chromeTail = '';
      try {
        chromeTail = fs.readFileSync(errLog, 'utf8').split('\n')
          .filter((l) => /FATAL|Access is denied|拒绝访问|platform_channel|Uncaught|SyntaxError/.test(l))
          .slice(0, 4).join('\n');
      } catch { /* ignore */ }
      // 有输出且不是"脚本未能执行"之类的空壳，才算真的跑过
      const substantive = !!body && chars > 60 && !/^\(脚本未能执行\)/.test(plain.trim());
      resolve({ page, ok: !!body, substantive, body, plain, clicks, errs, warns, earlyExit, chromeTail, secs: Math.round((Date.now() - t0) / 1000) });
    };

    (async () => {
      const deadline = t0 + page.timeout;
      while (Date.now() < deadline) {
        if (resultBody) { await sleep(1200); return finish(); }   // 留时间让截图 POST 完
        if (earlyExit !== null && !resultBody) {
          // 浏览器提前退出：再等 3 秒看是否有迟到的结果
          await sleep(3000);
          return finish();
        }
        await sleep(400);
      }
      finish();
    })();
  });
}

// ---------------------------------------------------------------- 主流程
(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const browser = findBrowser();
  if (!browser) {
    console.error('✘ 找不到 Chrome / Edge。请设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
    process.exit(1);
  }
  console.log('浏览器: ' + browser);
  console.log('项目根: ' + ROOT);
  console.log('输出目录: ' + TMP + '\n');

  let srv;
  try {
    srv = await startServer();
  } catch (e) {
    console.error(`✘ 无法在 127.0.0.1:${PORT} 启动服务：${e.message}`);
    console.error('   端口可能被占用。用 PORT=另一个端口 重试。');
    process.exit(1);
  }
  console.log(`服务已启动 http://127.0.0.1:${PORT}/\n`);

  const results = [];
  for (const p of targets) {
    process.stdout.write(`▶ ${p.id}  ${p.desc}\n`);
    const r = await runPage(browser, p);
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    if (!r.ok) {
      console.log(`  ✘ 未取到结果（${r.secs}s）`);
      if (r.earlyExit !== null) console.log(`     浏览器提前退出：${r.earlyExit}`);
      if (r.chromeTail) console.log('     Chrome 日志：\n' + r.chromeTail.split('\n').map((l) => '       ' + l.trim()).join('\n'));
    } else if (!r.substantive) {
      console.log(`  ✘ 有回传但内容为空（很可能是脚本语法错误，${r.secs}s）`);
      console.log('     片段：' + r.plain.trim().slice(0, 200).replace(/\n/g, ' | '));
    } else {
      console.log(`  ${r.errs ? '✘' : '✔'} 通过 ${r.clicks} 项，失败 ${r.errs} 项，警告 ${r.warns} 项（${r.secs}s）`);
      // 把失败项单独摘出来，方便一眼看到
      const bad = [
        ...[...r.body.matchAll(/<span class="err">([^<]*)<\/span>/g)].map((m) => m[1]),
        ...[...r.plain.matchAll(/^\s*✘\s*(.+)$/gm)].map((m) => m[1]),
      ].map((s) => s.replace(/<[^>]*>/g, '').replace(/^✘\s*/, '').trim()).filter(Boolean);
      for (const b of bad.slice(0, 12)) console.log('     ✘ ' + b);
    }
    results.push(r);
    // 保存完整文本结果，便于细看
    if (r.body) fs.writeFileSync(path.join(TMP, `result_${p.id}.txt`), r.body.replace(/<[^>]+>/g, ''), 'utf8');
  }

  srv.close();

  const failed = results.filter((r) => !r.ok || !r.substantive || r.errs > 0);
  console.log('\n' + '='.repeat(64));
  console.log(`汇总：${results.length - failed.length} / ${results.length} 个测试页通过`);
  for (const r of results) {
    if (r.ok && r.substantive) console.log(`  ${r.errs ? '✘' : '✔'} ${r.page.id.padEnd(6)} 通过 ${r.clicks} 项 / 失败 ${r.errs} / 警告 ${r.warns}  ${r.secs}s`);
    else console.log(`  ✘ ${r.page.id.padEnd(6)} 未得到有效结果`);
  }
  if (failed.length) {
    console.log('失败页面：' + failed.map((r) => r.page.id).join(', '));
    console.log('详细输出见 ' + path.relative(process.cwd(), TMP));
  } else if (results.length === PAGES.length) {
    console.log('全部通过。截图与文本输出见 ' + path.relative(process.cwd(), TMP));
  }
  let shotFiles = [];
  try { shotFiles = fs.readdirSync(TMP).filter((f) => f.startsWith('shot_')); } catch { /* ignore */ }
  if (shotFiles.length) console.log(`截图 ${shotFiles.length} 张：${shotFiles.slice(0, 3).join(', ')}${shotFiles.length > 3 ? ' …' : ''}`);
  console.log('='.repeat(64));
  console.log('\n提醒：截图必须人工过目一次。像素统计只能证明"画出了东西"，');
  console.log('      证明不了"画得对"（地形是否可辨、城池是否落地、战斗是否看得懂）。');

  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('运行器异常：', e); process.exit(1); });
