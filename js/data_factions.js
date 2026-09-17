// ===========================================================================
// 剧本数据 —— 189年 反董卓联盟（群雄并起）
// 势力配色：每家给一对主色/暗色 + 色相，用于地图领地、旗帜、头像背景
// ===========================================================================
window.SANGUO_FACTIONS = {
  dongzhuo:  { id: 'dongzhuo',  name: '董卓',   lord: '董卓',   color: '#7a2f3a', dark: '#3d1620', hue: 350, color2: '#c0555f', trait: '西凉铁骑', desc: '挟天子以令诸侯，据洛阳、长安，兵甲最盛而人心不附。' },
  caocao:    { id: 'caocao',    name: '曹操',   lord: '曹操',   color: '#2f5f8f', dark: '#16324f', hue: 210, color2: '#5f96c8', trait: '青州兵',   desc: '治世之能臣，乱世之奸雄。屯田养兵，唯才是举。' },
  yuanshao:  { id: 'yuanshao',  name: '袁绍',   lord: '袁绍',   color: '#3f6f4a', dark: '#1d3a26', hue: 135, color2: '#6fa87c', trait: '四世三公', desc: '汝南袁氏，门生故吏遍天下，河北之众莫能强。' },
  yuanshu:   { id: 'yuanshu',   name: '袁术',   lord: '袁术',   color: '#6a8f3f', dark: '#354a1d', hue: 90,  color2: '#9ec46a', trait: '淮南富庶', desc: '据淮南膏腴之地，僭号称帝，为天下所弃。' },
  gongsunzan:{ id: 'gongsunzan',name: '公孙瓒', lord: '公孙瓒', color: '#c9cdd4', dark: '#6d7480', hue: 220, color2: '#f0f3f7', trait: '白马义从', desc: '白马将军，威震北疆，与袁绍争河北。' },
  gongsundu:{ id: 'gongsundu',  name: '公孙度', lord: '公孙度', color: '#4f6f7a', dark: '#243840', hue: 195, color2: '#82a6b3', trait: '辽东偏安', desc: '割据辽东，东伐高句丽，海外皆附。' },
  liubei:    { id: 'liubei',    name: '刘备',   lord: '刘备',   color: '#b8442a', dark: '#5e2114', hue: 14,  color2: '#e07a5f', trait: '仁德',     desc: '中山靖王之后，织席贩履起家，然天下英雄皆愿从之。' },
  sunjian:   { id: 'sunjian',   name: '孙坚',   lord: '孙坚',   color: '#a83232', dark: '#551818', hue: 0,   color2: '#d66666', trait: '江东猛虎', desc: '孙武之后，勇挚刚毅，江东子弟兵锋甚锐。' },
  liubiao:   { id: 'liubiao',   name: '刘表',   lord: '刘表',   color: '#d2a94f', dark: '#6d5620', hue: 45,  color2: '#e8cd86', trait: '荆襄富盛', desc: '汉室宗亲，据荆州八郡，带甲十万而守成。' },
  liuzhang:  { id: 'liuzhang',  name: '刘璋',   lord: '刘璋',   color: '#c98a4a', dark: '#6b4520', hue: 30,  color2: '#e5b183', trait: '天府之国', desc: '益州牧，民殷国富而暗弱，蜀中豪杰多怀异心。' },
  liuyan:    { id: 'liuyan',    name: '刘焉',   lord: '刘焉',   color: '#a06a3a', dark: '#523418', hue: 25,  color2: '#c99a6a', trait: '益州牧',   desc: '汉室宗亲，首创州牧之议，据蜀称雄。' },
  taoqian:   { id: 'taoqian',   name: '陶谦',   lord: '陶谦',   color: '#8f6f3f', dark: '#483618', hue: 40,  color2: '#bfa06a', trait: '徐州殷富', desc: '徐州牧，年迈仁厚，然徐州四战之地。' },
  kongrong:  { id: 'kongrong',  name: '孔融',   lord: '孔融',   color: '#c98f9a', dark: '#6b4650', hue: 345, color2: '#e8b8c0', trait: '名士之望', desc: '孔子之后，北海相，名重天下而不知兵。' },
  mateng:    { id: 'mateng',    name: '马腾',   lord: '马腾',   color: '#9a7f5a', dark: '#4d3f28', hue: 38,  color2: '#c4a882', trait: '西凉铁骑', desc: '凉州军阀，马超之父，羌胡畏服。' },
  zhanglu:   { id: 'zhanglu',   name: '张鲁',   lord: '张鲁',   color: '#8f8f8f', dark: '#454545', hue: 0,   color2: '#bfbfbf', trait: '五斗米道', desc: '据汉中，以五斗米道教化民众，政教合一。' },
  gongsunzhi:{ id: 'gongsunzhi',name: '士燮',   lord: '士燮',   color: '#7a9a6a', dark: '#3d4d33', hue: 100, color2: '#a8c496', trait: '岭南雄长', desc: '交州士氏，雄长岭南，偏安一隅。' },
  liuyao:    { id: 'liuyao',    name: '刘繇',   lord: '刘繇',   color: '#cf8f4a', dark: '#6b4820', hue: 32,  color2: '#e8b57f', trait: '汉室宗亲', desc: '扬州刺史，为孙策所迫，保守江东一隅。' },
  wanglang:  { id: 'wanglang',  name: '王朗',   lord: '王朗',   color: '#5f7a8f', dark: '#2d3d4a', hue: 205, color2: '#8fa8bf', trait: '经学名家', desc: '会稽太守，通经博学，后归曹操。' },
  yanbaihu:  { id: 'yanbaihu',  name: '严白虎', lord: '严白虎', color: '#9a5a4a', dark: '#4d2c24', hue: 12,  color2: '#c48a7a', trait: '吴郡豪帅', desc: '吴郡强宗，聚众自保，盗匪之雄。' },
  zhangyang: { id: 'zhangyang', name: '张杨',   lord: '张杨',   color: '#6a6a8f', dark: '#33334a', hue: 240, color2: '#9a9ac4', trait: '河内之众', desc: '河内太守，与吕布交厚。' },
  lifeng:    { id: 'lifeng',    name: '李封',   lord: '李封',   color: '#5a4a3a', dark: '#2a221a', hue: 28,  color2: '#8a7460', trait: '董卓部曲', desc: '董卓旧部，据守河东。' },
  neutral:   { id: 'neutral',   name: '在野',   lord: null,     color: '#7a7468', dark: '#3a3630', hue: 40,  color2: '#a8a294', trait: '在野',     desc: '无主之地，豪杰散落。' },
};

// 剧本初始归属：城池 -> 势力
window.SANGUO_SCENARIO_189 = {
  name: '189年 · 反董卓联盟',
  year: 189, month: 9,
  desc: '董卓入洛阳，废少帝立献帝，焚烧宫室，迁都长安。关东州郡起兵讨之，推袁绍为盟主。天下自此板荡，群雄各怀异志。',
  owner: {
    // 董卓
    luoyang: 'dongzhuo', changan: 'dongzhuo', hongnong: 'dongzhuo', hulao: 'dongzhuo', sishui: 'dongzhuo',
    mengjin: 'dongzhuo', tongguan: 'dongzhuo', wuguan: 'dongzhuo', sanguan: 'dongzhuo', hedong: 'lifeng',
    // 曹操（陈留起兵）
    chenliu: 'caocao', puyang: 'caocao', luoyang_e: 'caocao',
    // 袁绍（渤海）
    nanpi: 'yuanshao', julu: 'yuanshao', pingyuan: 'yuanshao',
    // 袁术（南阳/淮南）
    wan: 'yuanshu', shouchun: 'yuanshu', anfeng: 'yuanshu',
    // 公孙瓒
    ji: 'gongsunzan', zhuojun: 'gongsunzan', yuyang: 'gongsunzan', beiping: 'gongsunzan', shanggu: 'gongsunzan', juyong: 'gongsunzan',
    // 公孙度
    xiangping: 'gongsundu', liaodong: 'gongsundu',
    // 刘备（平原/涿郡一带，寄居）
    // -> 刘备初始据 小沛（由平原县起家，此处给一城以可玩）
    xiaopei: 'liubei',
    // 孙坚（长沙）
    changsha: 'sunjian', wuling: 'sunjian', guiyang: 'sunjian', lingling: 'sunjian', changsha2: 'sunjian',
    // 刘表（荆州）
    xiangyang: 'liubiao', fancheng: 'liubiao', jiangling: 'liubiao', xinye: 'liubiao', jiangxia: 'liubiao',
    yidu: 'liubiao', xiakou: 'liubiao', xiangyang2: 'liubiao',
    // 刘焉（益州）
    chengdu: 'liuyan', mianzhu: 'liuyan', jiameng: 'liuyan', zitong: 'liuyan', bajun: 'liuyan', fuling: 'liuyan',
    yongan: 'liuyan', nanzhong: 'liuyan', yunnan: 'liuyan', hanzhong: 'liuyan', yangping: 'liuyan', jianning: 'liuyan',
    // 张鲁（汉中，189年尚随刘焉，此处给独立以增变数）
    // 陶谦（徐州）
    xuzhou: 'taoqian', xiapi: 'taoqian', guangling: 'taoqian', xiapi2: 'taoqian',
    // 孔融（北海）
    beihai: 'kongrong', linzi: 'kongrong',
    // 马腾（西凉）
    tianshui: 'mateng', wuwei: 'mateng', jincheng: 'mateng', xiping: 'mateng', zhangye: 'mateng',
    // 张杨（河内）
    shangdang: 'zhangyang', jinyang: 'zhangyang', hukou: 'zhangyang', yanmen: 'zhangyang', daijun: 'zhangyang',
    // 刘繇（扬州）
    jianye: 'liuyao', wu: 'liuyao', nanchang: 'liuyao',
    // 王朗（会稽）
    kuaiji: 'wanglang', jianan: 'wanglang',
    // 严白虎
    // -> 严白虎据吴郡，但为避免城太少，给了刘繇，严白虎作为在野强宗出现
    // 士燮（交州）
    panyu: 'gongsunzhi', jiaozhi: 'gongsunzhi', cangwu: 'gongsunzhi',
    // 其余
    runan: 'yuanshu', xuchang: 'neutral', hefei: 'neutral', ruxu: 'neutral',
    dunhuang: 'neutral', yumen: 'neutral', chencang: 'zhanglu', wudu: 'zhanglu', shangyong: 'zhanglu',
    hanzhong2: 'zhanglu',
  },
  // 额外初始资源调整
  bonus: {
    dongzhuo: { gold: 12000, food: 90000, troops: 90000, note: '兵甲最盛' },
    caocao: { gold: 3000, food: 20000, troops: 12000 },
    liubei: { gold: 1500, food: 8000, troops: 5000 },
    sunjian: { gold: 5000, food: 35000, troops: 26000 },
    yuanshao: { gold: 8000, food: 50000, troops: 40000 },
  },
};

// 可玩势力（按推荐度排序）
window.SANGUO_PLAYABLE = ['caocao', 'liubei', 'sunjian', 'yuanshao', 'dongzhuo', 'liubiao', 'taoqian', 'kongrong', 'mateng', 'gongsunzan', 'yuanshu', 'liuyan', 'zhangyang', 'liuyao', 'wanglang', 'gongsundu', 'gongsunzhi'];
