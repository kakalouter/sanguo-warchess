// ---------------------------------------------------------------------------
// 生成 js/data_generals.js —— 势力名册 + 在野池
//
// 数据源：_source/ne/generals.json
//   由《三国志11》武将数据 (renmu123/koei_san_data, san11/general.json) 修复而来。
//   ⚠ 上游原始文件 san11_general.json 本身是**坏的**：以 " {" 开头（缺开头的 "["）
//     却以 "]" 结尾，JSON.parse 直接报错。这是上游问题，已用多个镜像交叉验证。
//     generals.json 是逐对象扫描提取的修复版（670 条）。
//   ⚠ power.json 带 UTF-8 BOM，读取前需去掉。
//
// 字段：id,name,trickId,command,mforce,intelligence,politics,charm,
//       gun,halberd,crossbow,ride,weapons,water,biography,pic,powerId
//   统率 command / 武力 mforce / 智力 intelligence / 政治 politics / 魅力 charm
//   兵种适性 S>A>B>C：枪 gun / 戟 halberd / 弩 crossbow / 骑 ride / 兵器 weapons / 水 water
//
// 运行：node _source/roster.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'sanguo-warchess-build', 'ne', 'generals.json');
const OUT = path.join(__dirname, '..', 'js', 'data_generals.js');

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const byName = new Map();
for (const g of raw) if (!byName.has(g.name)) byName.set(g.name, g);

// ---- 189 年群雄名册：势力 -> 君主 + 部将 ----
// 数据是《三国志11》全时代的 670 人，这里按 189 年前后的史实归属分派。
// 同一人只归一家（在野除外）；名单里没有的人名会被记为 missing 并在末尾报告。
const ROSTER = {
  dongzhuo: {
    lord: '董卓',
    members: ['李儒', '贾诩', '吕布', '华雄', '李傕', '郭汜', '张济', '樊稠', '徐荣', '胡轸', '牛辅', '李肃',
      '张辽', '高顺', '侯成', '魏续', '宋宪', '成廉', '曹性', '臧霸', '董旻', '段煨', '杨奉', '李蒙', '王方', '李别'],
  },
  caocao: {
    lord: '曹操',
    members: ['夏侯惇', '夏侯渊', '曹仁', '曹洪', '曹纯', '乐进', '李典', '于禁', '典韦', '荀彧', '荀攸', '程昱',
      '郭嘉', '刘晔', '满宠', '毛玠', '任峻', '枣祗', '夏侯尚', '曹休', '曹真', '许褚', '史涣', '韩浩', '吕虔', '朱灵'],
  },
  yuanshao: {
    lord: '袁绍',
    members: ['颜良', '文丑', '张郃', '高览', '沮授', '田丰', '审配', '逢纪', '郭图', '许攸', '荀谌', '高干',
      '袁谭', '袁尚', '袁熙', '淳于琼', '蒋义渠', '麴义', '吕旷', '吕翔', '马延', '张南', '焦触', '尹楷'],
  },
  yuanshu: {
    lord: '袁术',
    members: ['纪灵', '张勋', '桥蕤', '雷薄', '陈兰', '乐就', '梁纲', '李丰', '杨弘', '阎象', '孙香', '袁胤',
      '刘勋', '张闿', '苌奴', '韩胤'],
  },
  gongsunzan: {
    lord: '公孙瓒',
    members: ['严纲', '单经', '田楷', '关靖', '公孙越', '公孙范', '邹丹', '王门', '范方', '刘备', '赵云', '刘关'],
  },
  gongsundu: { lord: '公孙度', members: ['公孙康', '公孙渊', '柳毅', '阳仪', '公孙恭', '韩忠'] },
  liubei: {
    lord: '刘备',
    members: ['关羽', '张飞', '简雍', '孙乾', '糜竺', '糜芳', '陈到', '周仓', '廖化', '关平', '刘封', '伊籍',
      '马良', '马谡', '孙尚香'],
  },
  sunjian: {
    lord: '孙坚',
    members: ['孙策', '孙权', '孙翊', '孙匡', '孙朗', '孙静', '吴景', '徐琨', '程普', '黄盖', '韩当', '朱治',
      '祖茂', '吴夫人', '孙尚香'],
  },
  liubiao: {
    lord: '刘表',
    members: ['蔡瑁', '张允', '蒯良', '蒯越', '黄祖', '文聘', '王威', '霍峻', '刘磐', '刘琦', '刘琮', '韩玄',
      '金旋', '赵范', '刘度', '巩志', '黄忠', '魏延', '伊籍', '向朗', '张虎', '陈生'],
  },
  liuyan: {
    lord: '刘焉',
    members: ['刘璋', '张任', '严颜', '吴懿', '吴兰', '雷铜', '李严', '法正', '张松', '黄权', '刘巴', '孟达',
      '泠苞', '邓贤', '刘循', '费观', '卓膺', '杨怀', '高沛'],
  },
  taoqian: {
    lord: '陶谦',
    members: ['曹豹', '臧霸', '孙观', '尹礼', '吴敦', '昌豨', '陈登', '陈珪', '糜竺', '曹宏', '笮融', '张闿'],
  },
  kongrong: { lord: '孔融', members: ['太史慈', '武安国', '管亥', '宗宝', '王修', '是仪'] },
  mateng: {
    lord: '马腾',
    members: ['马超', '马休', '马铁', '庞德', '马岱', '韩遂', '成宜', '梁兴', '马玩', '杨秋', '候选', '程银',
      '李堪', '张横', '马宇'],
  },
  zhanglu: { lord: '张鲁', members: ['张卫', '杨任', '杨昂', '阎圃', '庞德', '马超', '张富', '杨松', '杨柏'] },
  zhangyang: { lord: '张杨', members: ['杨丑', '穆顺', '董昭', '吕布', '薛兰', '李封'] },
  liuyao: { lord: '刘繇', members: ['太史慈', '张英', '樊能', '于糜', '陈横', '笮融', '薛礼', '周昕', '周昂'] },
  wanglang: { lord: '王朗', members: ['虞翻', '周昕', '许贡', '周鲂'] },
  gongsunzhi: { lord: '士燮', members: ['士壹', '士徽', '士武', '张津'] },
  yanbaihu: { lord: '严白虎', members: ['严舆', '陈横'] },
  zhangyang2: { lord: '李傕', members: ['郭汜', '张济', '樊稠', '张绣', '贾诩'] },
  neutral: { lord: null, members: ['吕布', '貂蝉', '高顺', '陈宫', '张辽', '臧霸', '华佗', '左慈', '于吉', '管辂', '许贡'] },
};

function pick(g) {
  return {
    n: g.name,
    lead: g.command, war: g.mforce, intel: g.intelligence, pol: g.politics, charm: g.charm,
    gun: g.gun, hal: g.halberd, xbow: g.crossbow, ride: g.ride, wep: g.weapons, wat: g.water,
    bio: (g.biography || '').replace(/\r\n/g, '\n').replace(/\n+/g, ' ').slice(0, 240),
  };
}

const out = { factions: {}, missing: [], stats: {} };
const used = new Set();
for (const [fid, r] of Object.entries(ROSTER)) {
  const list = [];
  for (const nm of r.members) {
    const g = byName.get(nm);
    if (!g) { out.missing.push(`${fid}:${nm}`); continue; }
    if (used.has(nm) && fid !== 'neutral') continue;   // 一人只归一家
    used.add(nm);
    list.push(pick(g));
  }
  out.factions[fid] = { lord: r.lord, members: list };
}

// ---- 在野 / 补任池 ----
// 只取能力最高的一批：可登用人才有限，避免一城坐拥数十名将（会破坏平衡）。
const REST_SIZE = 130;
const rest = raw.filter((g) => !used.has(g.name));
rest.sort((a, b) => (b.command + b.mforce + b.intelligence) - (a.command + a.mforce + a.intelligence));
out.reserve = rest.slice(0, REST_SIZE).map((g) => { const o = pick(g); delete o.bio; return o; });

out.stats = { totalGenerals: raw.length, named: out.stats.named, reserve: out.reserve.length, missing: out.missing };

const body = '// 自动生成：来源 光荣三国志11 武将数据 (renmu123/koei_san_data, san11/general.json)\n' +
  '// 属性为原作数值：统率 lead / 武力 war / 智力 intel / 政治 pol / 魅力 charm；兵种适性 S>A>B>C\n' +
  '// 由 _source/roster.js 生成，请勿手改\n' +
  'window.SANGUO_ROSTER = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(OUT, body, 'utf8');

console.log('已写出 ' + OUT + '  ' + (body.length / 1024).toFixed(0) + ' KB');
const namedCount = Object.values(out.factions).reduce((s, f) => s + f.members.length, 0);
console.log('名册武将 ' + namedCount + ' 名（跨势力去重后 ' + used.size + ' 人），在野池 ' + out.reserve.length + ' 名，缺失 ' + out.missing.length + ' 名');
if (out.missing.length) console.log('缺失（原作数据里没有该姓名，属正常）: ' + out.missing.join(', '));
for (const fid of ['caocao', 'liubei', 'sunjian', 'dongzhuo', 'yuanshao']) {
  const f = out.factions[fid];
  console.log(`${fid}: ${f.members.length} 人  代表 ${f.members.slice(0, 5).map((m) => `${m.n}(统${m.lead}/武${m.war}/智${m.intel})`).join(' ')}`);
}
