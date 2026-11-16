// 小熊星座 · 评分与报告逻辑 v1.0
import { QUESTIONS, COMPARE_SETS } from './questions.js';

export const DIMS = ['EI','SN','TF','JP','Ne','Ni','Se','Si','Te','Ti','Fe','Fi',
  'SPACE','PERC','RESP','D','C','O','H','COMM','PLAY',
  'n1','n2','n3','n4','n5','n6','n7','n8','n9'];

// 每个维度的理论最大绝对值（用于归一化）
export const DIM_MAX = (() => {
  const max = {};
  for (const q of QUESTIONS) for (const o of q.o) for (const [k, v] of Object.entries(o.s || {})) {
    max[k] = (max[k] || 0) + Math.abs(v);
  }
  return max;
})();

// ---------------- 计分 ----------------
// answers: { qid: optionIndex } 或 multi 题为 optionIndex 数组
export function computeScores(answers) {
  const dims = {}; const contrib = {}; const compare = {}; let skipped = 0;
  for (const q of QUESTIONS) {
    const a = answers[q.id];
    if (a === undefined || (Array.isArray(a) && a.length === 0)) { skipped++; continue; }
    compare[q.id] = a;
    const chosen = Array.isArray(a) ? a : [a];
    for (const i of chosen) add(q.o[i].s || {}, q.id);
    if (Array.isArray(a)) { // multi：未选中的惩罚项
      q.o.forEach((o, i) => { if (!chosen.includes(i) && o.penalty) sub(o.penalty, q.id); });
    }
  }
  function add(s, qid) { for (const [k, v] of Object.entries(s)) { dims[k] = (dims[k] || 0) + v; (contrib[k] = contrib[k] || new Set()).add(qid); } }
  function sub(s, qid) { for (const [k, v] of Object.entries(s)) { dims[k] = (dims[k] || 0) - v; } }
  return { dims, contrib, compare, skipped };
}

export const norm = (d, k) => Math.min(1, Math.max(0, 0.5 + (d[k] || 0) / (2 * (DIM_MAX[k] || 1))));

// ---------------- 个人画像 ----------------
const FUNC_TEXT = {
  Ne: '你的脑子像一台可能性发生器：看到一个想法，第一反应是它还能长出什么别的可能。',
  Ni: '你习惯往后多看几步：比起眼前发散，你更想知道事情背后的规律和走向。',
  Se: '你是行动先行的体验派：搞明白一件事的最好方式，是直接上手。',
  Si: '你是细节收藏家：过往的经验和具体的事例，是你判断世界的依据。',
  Te: '你信效率：一件事好不好，先看它能不能解决问题、拿出结果。',
  Ti: '你脑子里有一套自己的逻辑账本：说得通不通，比听起来爽不爽更重要。',
  Fe: '你天然关注场里的每个人：气氛不对，你会比谁都先察觉。',
  Fi: '你心里有一杆自己的秤：别人怎么说不重要，跟自己的感受一致才作数。',
};
const FUNC_TAG = { Ne: '脑洞补给站', Ni: '直觉雷达', Se: '行动派玩家', Si: '细节收藏家', Te: '效率主义者', Ti: '逻辑洁癖', Fe: '气氛担当', Fi: '内心戏丰富' };
const CONFLICT_LABEL = { D: '有话直说', C: '先冷后谈', O: '静观其变', H: '以和为贵' };
const CONFLICT_TAG = { D: '有话直说', C: '先冷后谈', O: '静观其变', H: '以和为贵' };
const MOTIVE_TAG = { n1: '细节控', n2: '热心肠', n3: '目标感强', n4: '独特星人', n5: '独处充电', n6: '安全感优先', n7: '快乐至上', n8: '主意正', n9: '和平使者' };
const HEADLINES = {
  EJT: '雷厉风行的行动派，心里装着一张时刻表', EJF: '热心的大管家，把大家都照顾得妥妥帖帖',
  EPT: '自来熟的实干家，先干了再说', EPF: '气氛发动机，走到哪都热热闹闹',
  IJT: '安静的秩序守护者，自己的规矩自己守', IJF: '温柔的贴心人，心里有一本细账',
  IPT: '冷静的手艺人，话不多但一出手就知道有没有', IPF: '安静的水面下，有自己的主意',
};

function axisText(key, pct) {
  if (key === 'EI') return pct >= 60 ? '偏外向：热闹让你充电' : pct <= 40 ? '偏内向：热闹之后需要独处回血' : '中间地带：看心情，也看场合';
  if (key === 'SN') return pct >= 60 ? '偏直觉：喜欢想法和可能性' : pct <= 40 ? '偏实感：更相信具体细节和实际经验' : '中间地带：既能落地也会畅想';
  if (key === 'TF') return pct >= 60 ? '偏逻辑：讲道理优先' : pct <= 40 ? '偏感受：在意人的情绪' : '中间地带：讲道理，但也在意人';
  return pct >= 60 ? '偏灵活：随性应变' : pct <= 40 ? '偏计划：有安排才踏实' : '中间地带：计划里留着弹性';
}

// 从已保存的对照编码重建"依据题目"映射（用于服务端数据重渲染，避免再存一份原始答案）
export function contribFromCompare(compare = {}) {
  const contrib = {};
  for (const q of QUESTIONS) {
    const a = compare[q.id];
    if (a === undefined) continue;
    const chosen = Array.isArray(a) ? a : [a];
    for (const i of chosen) {
      for (const k of Object.keys(q.o[i]?.s || {})) (contrib[k] = contrib[k] || new Set()).add(q.id);
    }
  }
  return contrib;
}

export function buildPersonal(p) {
  const dims = p.dims || {};
  const contrib = p.contrib || contribFromCompare(p.compare || {});
  const n = k => norm(dims, k);
  const ev = ks => [...new Set(ks.flatMap(k => [...(contrib[k] || [])]))].join('、') || '综合你的全部作答';

  const topFuncs = ['Ne','Ni','Se','Si','Te','Ti','Fe','Fi'].sort((a, b) => n(b) - n(a)).slice(0, 2);
  const conflictRank = ['D','C','O','H'].sort((a, b) => (dims[b] || 0) - (dims[a] || 0));
  const motive = ['n1','n2','n3','n4','n5','n6','n7','n8','n9'].sort((a, b) => (dims[b] || 0) - (dims[a] || 0))[0];

  const side = (k, pos) => n(k) >= 0.55 ? pos : n(k) <= 0.45 ? (pos === 'E' ? 'I' : pos === 'N' ? 'S' : pos === 'T' ? 'F' : 'J') : (pos === 'E' ? 'E' : pos === 'N' ? 'N' : pos === 'T' ? 'T' : 'J');
  const key = [side('EI','E'), side('SN','N'), side('TF','T'), side('JP','J')].join('').replace(/[NS]/, m => m).replace('N','N');
  const headline = HEADLINES[
    (n('EI') >= .55 ? 'E' : n('EI') <= .45 ? 'I' : 'I') +
    (n('JP') >= .55 ? 'P' : n('JP') <= .45 ? 'J' : 'J') +
    (n('TF') >= .55 ? 'T' : n('TF') <= .45 ? 'F' : 'F')
  ] || '正在成形中的自己';

  const keywords = [
    FUNC_TAG[topFuncs[0]], CONFLICT_TAG[conflictRank[0]],
    n('SPACE') >= .55 ? '需要充电舱' : n('PERC') >= .55 ? '渴望被读懂' : n('RESP') >= .55 ? '消息很重要' : '松弛型选手',
    n('COMM') >= .55 ? '直球选手' : '潜台词大师',
  ];

  const axes = [
    { l: '外向 E', r: '内向 I', key: 'EI' }, { l: '直觉 N', r: '实感 S', key: 'SN' },
    { l: '逻辑 T', r: '感受 F', key: 'TF' }, { l: '计划 J', r: '灵活 P', key: 'JP' },
  ].map(a => {
    const pct = Math.round((1 - n(a.key)) * 100); // 圆点位置：右端=第二个字母方向
    return { ...a, pct, side: axisText(a.key, 100 - pct) };
  });

  const mind = `${FUNC_TEXT[topFuncs[0]]}${topFuncs[1] ? FUNC_TEXT[topFuncs[1]] : ''}`;

  let emo;
  if (n('SPACE') >= .6 && n('PERC') >= .6) emo = '你需要独处充电，同时又希望对方能主动察觉你的情绪——这两种需要并不矛盾，但值得被说出口。';
  else if (n('SPACE') >= .6) emo = '你需要固定的独处时间来充电，这不是冷淡，是你的恢复方式。';
  else if (n('PERC') >= .6) emo = '你不习惯把需求挂在嘴边，但内心很希望被主动察觉——这既是你的温柔，也可能让对方猜得辛苦。';
  else if (n('RESP') >= .6) emo = '回复速度对你来说是态度的一部分，消息石沉大海会让你不安。';
  else if (n('SPACE') <= .4) emo = '你更喜欢有人陪的状态，接近让你安心，独处太久反而会空落落的。';
  else emo = '你对陪伴和空间的需求都比较松弛：有人陪很好，一个人也行，相处起来不费劲。';

  let adv = n('JP') <= .45
    ? '优势：靠谱、有准备，答应的事一定做到。盲点：计划被打乱时容易别扭，试着给"计划外"留一点空间。'
    : n('JP') >= .55
    ? '优势：灵活、随性，总有 Plan B。盲点：有时显得不够上心，重要的事给对方一个明确的时间点。'
    : '优势：该计划时能计划，该随性时能随性。盲点：偶尔在"要不要认真"之间摇摆，让别人拿不准你的节奏。';
  adv += n('COMM') >= .55 ? ' 你习惯有话直说——高效，但记得给委婉的人留一点台阶。' : ' 你习惯温和表达——体贴，但别让重要的话沉在暗示里。';

  return {
    headline, keywords, axes,
    sections: [
      { title: '思维方式', text: mind, evidence: ev(topFuncs) },
      { title: '情绪与关系需求', text: emo, evidence: ev(['SPACE','PERC','RESP']) },
      { title: '优势与潜在盲点', text: adv, evidence: ev(['JP','COMM', conflictRank[0]]) },
    ],
    conflict: conflictRank[0],
  };
}

// ---------------- 双人特征 ----------------
const COMPAT = { 'DD': .4, 'DC': .8, 'DO': .6, 'DH': .6, 'CC': .7, 'CO': .8, 'CH': .7, 'OO': .7, 'OH': .8, 'HH': .8 };
const samePick = (a, b, qid) => JSON.stringify(a.compare[qid]) === JSON.stringify(b.compare[qid]);

function buildFeatures(a, b) {
  const na = k => norm(a.dims, k), nb = k => norm(b.dims, k);
  const diff = k => Math.abs(na(k) - nb(k));
  const rate = qids => qids.length ? qids.filter(q => samePick(a, b, q)).length / qids.length : 0;

  const mind = 1 - (diff('SN') + diff('TF')) / 2;
  const values = 0.8 * rate(COMPARE_SETS.values) + 0.2 * (1 - diff('TF'));
  const emotion = 1 - (diff('SPACE') + diff('PERC') + diff('RESP')) / 3;
  const comm = 0.5 * (1 - diff('COMM')) + 0.5 * rate(COMPARE_SETS.comm);
  const conflictCompat = COMPAT[a.conflict + b.conflict] ?? 0.65;
  const mode = 0.4 * (1 - diff('JP')) + 0.3 * conflictCompat + 0.3 * rate(COMPARE_SETS.mode);
  const overall = 0.22 * mind + 0.2 * values + 0.22 * emotion + 0.18 * comm + 0.18 * mode;

  const assertP = p => { const np = k => norm(p.dims, k); return (Math.max(0, (np('TF') - .5) * 2) + Math.max(0, (np('COMM') - .5) * 2) + np('D')) / 3; };
  const assert = (assertP(a) + assertP(b)) / 2;
  const playful = (norm(a.dims,'PLAY') + norm(b.dims,'PLAY')) / 2;

  return {
    mind: cl(mind), values: cl(values), emotion: cl(emotion), comm: cl(comm), mode: cl(mode),
    overall: cl(overall), conflictCompat,
    energyGap: diff('EI'), planGap: diff('JP'),
    compGap: (diff('EI') + diff('JP') + (1 - cl(mind))) / 3,
    assert, playful,
    percMax: Math.max(na('PERC'), nb('PERC')), respMax: Math.max(na('RESP'), nb('RESP')),
    bothDirect: a.conflict === 'D' && b.conflict === 'D',
    bothP: na('JP') >= .6 && nb('JP') >= .6,
    a, b, na, nb,
  };
}
const cl = v => Math.min(1, Math.max(0, v));

// ---------------- 称号库 ----------------
const TITLES = [
  { name: '天生一对', cat: '同频', blurb: '像是在对方的答案里看到了自己。', cond: f => f.overall >= .82 && f.emotion >= .75, w: f => (f.overall - .8) * 2 },
  { name: '神仙组合', cat: '同频', blurb: '不仅像，而且处得来——这种概率真的不多。', cond: f => f.overall >= .78 && f.conflictCompat >= .75, w: f => (f.overall - .75) * 1.5 },
  { name: '同频好友', cat: '同频', blurb: '不用解释太多，你们能接住对方的话。', cond: f => f.mind >= .78 && f.energyGap <= .2, w: f => f.mind * .5 },
  { name: '双向奔赴', cat: '同频', blurb: '你们都愿意先迈一步，这在关系里很奢侈。', cond: f => f.bothDirect && f.emotion >= .7, w: () => .6 },
  { name: '灵魂知己', cat: '知己', blurb: '连纠结的地方都一样，答题的节奏惊人地一致。', cond: f => f.mind >= .75 && f.emotion >= .72, w: f => f.mind * .4 },
  { name: '懂你的人', cat: '知己', blurb: '你不说话，TA 也大概知道怎么回事。', cond: f => f.percMax >= .7 && f.emotion >= .75, w: () => .5 },
  { name: '最佳拍档', cat: '拍档', blurb: '一个出主意，一个干实事，配合起来刚刚好。', cond: f => f.compGap >= .5 && f.conflictCompat >= .7, w: f => f.compGap * .6 },
  { name: '互补搭档', cat: '拍档', blurb: '差异不小，但刚好补上对方缺的那块。', cond: f => f.compGap >= .55 && f.emotion >= .6, w: f => f.compGap * .4 },
  { name: '黄金搭档', cat: '拍档', blurb: '方向一致，分工明确，效率拉满。', cond: f => f.values >= .75, w: () => .4 },
  { name: '欢喜冤家', cat: '张力', blurb: '三天一小吵五天一大吵，但谁也离不开谁。', cond: f => f.comm <= .5 && f.emotion >= .4 && f.emotion <= .72 && f.playful >= .5, w: f => f.playful * .5 },
  { name: '相爱相杀', cat: '张力', blurb: '互相刺激，互相较劲，也互相成就。', cond: f => f.bothDirect && f.values <= .55 && f.assert >= .65, w: () => .5 },
  { name: '棋逢对手', cat: '张力', blurb: '谁也不服谁，但心底都认可对方。', cond: f => f.assert >= .7 && f.mind >= .6, w: f => f.assert * .4 },
  { name: '谁也不服谁', cat: '张力', blurb: '你们吵架的频率，取决于谁先低头。', cond: f => f.bothDirect && f.conflictCompat <= .5, w: () => .45 },
  { name: '最佳损友', cat: '损友', blurb: '互相吐槽是你们的日常，也是你们的默契。', cond: f => f.playful >= .7 && f.comm >= .6, w: f => f.playful * .5 },
  { name: '狼狈为奸', cat: '损友', blurb: '两个随性的人凑一起，主打一个"到时候再说"。', cond: f => f.bothP && f.planGap <= .2 && f.playful >= .6, w: () => .5 },
  { name: '不靠谱搭子', cat: '损友', blurb: '计划是不存在的，但快乐是真实的。', cond: f => f.bothP && f.respMax <= .45 && f.playful >= .6, w: () => .55 },
  { name: '反差组合', cat: '反差', blurb: '完全不同的两个人，处出了意外的和谐。', cond: f => f.energyGap >= .55 && f.overall >= .5 && f.overall <= .72 && f.emotion >= .65, w: () => .6 },
  { name: '冤家路窄', cat: '兜底', blurb: '你们想要的关心和给出去的方式，正好拧着——差异不是终点，是你们要聊的话题。', cond: f => f.emotion <= .45 && f.conflictCompat <= .5, w: () => .1 },
];

function pickTitle(f) {
  const scored = TITLES.map(t => ({ ...t, score: t.cond(f) ? 1 + t.w(f) : 0 })).filter(t => t.score > 0);
  scored.sort((x, y) => y.score - x.score); // 数组顺序即同分优先级；兜底类排最后
  if (!scored.length) return { main: TITLES[TITLES.length - 1], aux: [] };
  const main = scored[0];
  const aux = []; const cats = new Set([main.cat]);
  for (const t of scored.slice(1)) { if (aux.length < 2 && !cats.has(t.cat) && t.cat !== '兜底') { aux.push(t); cats.add(t.cat); } }
  return { main, aux };
}

// ---------------- 双人报告 ----------------
const BEST_TEXT = {
  mind: '你们看待问题和下判断的方式几乎同频，讨论事情时常常"对，我也是这么想的"。',
  values: '在"什么算靠谱""该怎么办事"这类问题上你们高度一致，这是长期信任的地基。',
  emotion: '你们对陪伴和空间的需要几乎一样，不用磨合"粘人程度"。',
  comm: '你们的沟通节奏接近：该直说直说，该委婉委婉，很少鸡同鸭讲。',
  mode: '你们的相处节奏合拍，出行做事都不用反复拉扯。',
};
const FRICTION_TEXT = {
  mind: '你们接收信息的频道不同：一个抓具体细节，一个想抽象可能，讨论时容易各说各的。',
  values: '你们对"事情应该怎么办"的标准不一样，一个讲效率一个讲感受，容易互相觉得对方"太较真"或"不上心"。',
  emotion: '你们需要的关心方式和给出的方式正好错位：TA 想要的，你未必习惯给。',
  comm: '一个习惯直球，一个习惯潜台词——不是不想说，是说的频道不同。',
  mode: '一个想安排妥当，一个想随性而为——你们的分歧大多出现在"计划"两个字上。',
};

function unwrap(p) {
  const s = p.scores || {};
  let conflict = s.conflict;
  if (!conflict) { const order = ['D','C','O','H'].sort((x, y) => (s.dims[y] || 0) - (s.dims[x] || 0)); conflict = order[0]; }
  return { dims: s.dims || {}, compare: s.compare || {}, conflict, nickname: p.nickname || '', role: p.role };
}

export function buildDual(pa, pb) {
  const ca = unwrap(pa), cb = unwrap(pb);
  const f = buildFeatures(ca, cb);
  const { main, aux } = pickTitle(f);
  const nameOf = p => p.nickname || (p.role === 'creator' ? '我' : 'TA');
  const A = nameOf(pa), B = nameOf(pb);

  const matches = [
    { name: '思维方式', pct: Math.round(f.mind * 100) },
    { name: '价值观', pct: Math.round(f.values * 100) },
    { name: '情绪需求', pct: Math.round(f.emotion * 100) },
    { name: '沟通习惯', pct: Math.round(f.comm * 100) },
    { name: '相处模式', pct: Math.round(f.mode * 100) },
  ];

  const dimOrder = [['mind', f.mind], ['values', f.values], ['emotion', f.emotion], ['comm', f.comm], ['mode', f.mode]];
  const sorted = [...dimOrder].sort((x, y) => y[1] - x[1]);
  const best = sorted.slice(0, 2).map(d => ({ title: { mind: '思维方式', values: '价值观', emotion: '情绪需求', comm: '沟通习惯', mode: '相处模式' }[d[0]], text: BEST_TEXT[d[0]] }));
  const friction = [];
  if (f.conflictCompat < .55) friction.push({ title: '冲突处理', text: `冲突风格差异明显：一个是"${CONFLICT_LABEL[ca.conflict]}"，一个是"${CONFLICT_LABEL[cb.conflict]}"——一个想马上谈，一个想先缓缓。给彼此一个"再开口"的时间，而不是逼对方立刻表态。` });
  for (const d of [...sorted].reverse()) { if (friction.length < 2 && !friction.some(x => x.title === { mind: '思维方式', values: '价值观', emotion: '情绪需求', comm: '沟通习惯', mode: '相处模式' }[d[0]])) friction.push({ title: { mind: '思维方式', values: '价值观', emotion: '情绪需求', comm: '沟通习惯', mode: '相处模式' }[d[0]], text: FRICTION_TEXT[d[0]] }); }

  // 视角差异
  const clashes = [];
  const { na, nb } = f;
  if (na('SPACE') >= .62 && nb('PERC') >= .62) clashes.push({ a: `${A}觉得："我在给彼此空间，这是尊重。"`, b: `${B}却觉得："TA 不够在意我，连问都不问一句。"`, note: '你们对"亲密"的定义不同：一个用距离表达信任，一个用询问表达关心。' });
  else if (nb('SPACE') >= .62 && na('PERC') >= .62) clashes.push({ a: `${A}觉得："TA 怎么还不来问我，是不是不在乎。"`, b: `${B}却觉得："我给 TA 空间，这难道不是体贴？"`, note: '一个用距离表达信任，一个用询问表达关心——方式拧着，心意没坏。' });
  if (na('COMM') <= .42 && nb('PERC') <= .45 || nb('COMM') <= .42 && na('PERC') <= .45) clashes.push({ a: '一方觉得："我都暗示得这么明显了。" ', b: '另一方其实根本没收到信号。', note: '潜台词只在双方都装了接收器时才有效——重要的话，请直说。' });
  if (na('RESP') >= .6 && nb('RESP') >= .6) clashes.push({ a: `${A}在等对方先回消息。`, b: `${B}也在等对方先回消息。`, note: '你们对回复速度都很敏感，但没有一个人是故意冷落的。' });
  if (!samePick(ca, cb, 'A4') || !samePick(ca, cb, 'E4')) clashes.push({ a: '一方觉得："我在认真分析问题，是在帮你解决它。"', b: '另一方却觉得："你一直在讲道理，根本没在意我的情绪。"', note: '错位来自你们对"被关心"的定义不同：一个给方案，一个要陪伴。' });

  // 相处指南
  const guide = [];
  if (f.conflictCompat < .6) guide.push('吵架当晚别急着解决问题，先互相确认一句"我没有不想理你"。');
  if ((na('PERC') >= .6 && nb('PERC') <= .45) || (nb('PERC') >= .6 && na('PERC') <= .45)) guide.push('被期待"主动察觉"的一方请记住：猜很累，直接问反而是关心。');
  if (f.planGap >= .35) guide.push('行程类的事让计划性强的一方牵头，但明确留出 20% 的"随性额度"，双方都要让渡一点。');
  if (f.emotion < .55) guide.push('把"被关心"的定义说出来：你要的是拥抱、分析还是安静陪着——直接告诉对方，别让对方猜。');
  if (f.playful >= .65) guide.push('保留你们的玩闹暗号：玩闹是你们关系的减压阀，认真吵架前先开个玩笑试试。');
  if (f.energyGap >= .5) guide.push('热闹的场合允许一人先撤，不必互相硬撑——社交电量不同，不代表感情深浅不同。');
  guide.push('重要的事用文字说，情绪的事当面说。', '每月留一天"随性日"：不安排、不催促，谁提议谁负责。');

  return {
    title: main.name, blurb: main.blurb,
    aux: aux.map(t => t.name),
    matches, best, friction,
    clashes: clashes.slice(0, 2),
    guide: guide.slice(0, 4),
    names: { a: A, b: B },
  };
}
