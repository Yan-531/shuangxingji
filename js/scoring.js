// 双星记 2.0 · 计分与报告算法
// 标准化：Score = 50 + 50 × (实际得分 / 已答题目中该维度的最大可能绝对分之和)，截断 0~100
import { COMPARE_SETS } from './questions.js';
import {
  MBTI, FUNC_NAME, FUNC_1ST, FUNC_2ND, FUNC_3RD, FUNC_4TH, FUNC_TAIL, FUNC_GAP, FUNC_COMBO,
  needParagraphs, TITLES, NEUTRAL_TITLES, DIM_INFO, GUIDE_RULES, GUIDE_FIXED,
  CONFLICT_COMPAT, CONFLICT_LABEL, OVERALL_GRADE,
} from './content.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const FUNCS8 = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

// ---------- 原始计分 ----------
export function computeScores(answers, questions) {
  const dims = {}; const compare = {}; let skipped = 0;
  for (const q of questions) {
    const a = answers[q.id];
    if (a === undefined) { skipped++; continue; }
    compare[q.id] = a;
    for (const [k, v] of Object.entries(q.o[a]?.s || {})) dims[k] = (dims[k] || 0) + v;
  }
  return { dims, compare, skipped };
}

// ---------- 标准化 ----------
// 每题同一维度最大可能绝对分 = 该题所有选项中该维度 |s| 的最大值；分母只计实际作答且涉及该维度的题
export function normalize(dims, answers, questions) {
  const denom = {}; const valid = {};
  for (const q of questions) {
    if (answers[q.id] === undefined) continue;
    const dimsInQ = new Set();
    for (const o of q.o) for (const k of Object.keys(o.s || {})) dimsInQ.add(k);
    for (const k of dimsInQ) {
      const m = Math.max(...q.o.map(o => Math.abs(o.s?.[k] || 0)));
      if (m > 0) { denom[k] = (denom[k] || 0) + m; valid[k] = (valid[k] || 0) + 1; }
    }
  }
  const norm = {};
  for (const k of Object.keys(denom)) norm[k] = clamp(50 + 50 * ((dims[k] || 0) / denom[k]), 0, 100);
  return { norm, valid };
}

// ---------- MBTI 四轴 ----------
const AXES = [
  { key: 'EI', pos: 'E', neg: 'I' },
  { key: 'SN', pos: 'N', neg: 'S' },
  { key: 'TF', pos: 'T', neg: 'F' },
  { key: 'JP', pos: 'P', neg: 'J' },
];
const axisLevel = v => (v >= 56 || v <= 44) ? '明显' : (v === 50) ? '中性' : '轻微';

export function mbti(norm) {
  const axes = AXES.map(a => {
    const v = Math.round(norm[a.key] ?? 50);
    return { ...a, v, letter: v > 50 ? a.pos : v < 50 ? a.neg : a.pos, level: axisLevel(v) };
  });
  const type = axes.map(a => a.letter).join('');
  const neutralCount = axes.filter(a => a.level === '中性').length;
  const slightCount = axes.filter(a => a.level === '轻微').length;
  return { type, axes, uncertainty: neutralCount >= 1 || slightCount >= 2 };
}

// ---------- 八维排名 ----------
export function funcRank(norm) {
  return FUNCS8
    .map((f, i) => ({ f, name: FUNC_NAME[f], score: Math.round(norm[f] ?? 50), order: i }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

export function conflictStyle(norm) {
  return ['D', 'C', 'O', 'H'].reduce((best, k) => ((norm[k] ?? 50) > (norm[best] ?? 50) ? k : best), 'D');
}

const sim = (a, b) => 100 - Math.abs(a - b);
const pct = v => Math.round(v);

// 个人报告组装（0~100 分制）
export function buildPersonal(norm, { version = 36, answeredCount = 0, valid = {} } = {}) {
  const m = mbti(norm);
  const rank = funcRank(norm);
  const functions = rank.map(r => ({
    ...r,
    text: r.rank === 1 ? FUNC_1ST[r.f] : r.rank === 2 ? FUNC_2ND[r.f] : r.rank === 3 ? FUNC_3RD[r.f] : r.rank === 4 ? FUNC_4TH[r.f] : FUNC_TAIL[r.rank - 5],
  }));
  const gap = Math.abs(rank[0].score - rank[1].score);
  const combo = FUNC_COMBO[[rank[0].f, rank[1].f].sort().join('+')] || null;
  const lowDims = Object.keys(valid).filter(k => (valid[k] || 0) < 2);
  const confidence = lowDims.length === 0 ? '高' : lowDims.length <= 5 ? '中' : '低';
  const t = MBTI[m.type];
  return {
    v: 2, type: m.type, typeName: t.name, tag: t.tag, profile: t.profile,
    mind: t.mind, emo: t.emo, social: t.social,
    strengths: t.strengths, blind: t.blind, love: t.love, growth: t.growth,
    axes: m.axes, uncertainty: m.uncertainty,
    functions, gap, gapText: FUNC_GAP(gap), combo,
    needs: needParagraphs(norm),
    confidence, lowDims, version, answeredCount,
  };
}

// ---------- 逐题对照率（0~100；无可对照题时取中性 50） ----------
export function compareRates(ca, cb, versionA, versionB) {
  const sets = COMPARE_SETS[versionA === 72 && versionB === 72 ? 'full' : 'core'];
  const rate = ids => {
    const usable = ids.filter(id => ca[id] !== undefined && cb[id] !== undefined);
    if (!usable.length) return 50;
    const same = usable.filter(id => ca[id] === cb[id]).length;
    return same / usable.length * 100;
  };
  return { values: rate(sets.values), comm: rate(sets.comm) };
}

// ---------- 双人报告 ----------
export function buildDual(pa, pb) {
  const na = pa.norm, nb = pb.norm;
  const S_FUNC = 100 - FUNCS8.reduce((s, f) => s + Math.abs((na[f] ?? 50) - (nb[f] ?? 50)), 0) / 8;
  const M = 0.35 * sim(na.SN ?? 50, nb.SN ?? 50) + 0.35 * sim(na.TF ?? 50, nb.TF ?? 50) + 0.30 * S_FUNC;
  const V = 0.5 * pa.cmp.values + 0.25 * sim(na.Fi ?? 50, nb.Fi ?? 50) + 0.25 * (sim(na.Te ?? 50, nb.Te ?? 50) + sim(na.Ti ?? 50, nb.Ti ?? 50)) / 2;
  const E = 0.25 * sim(na.SPACE ?? 50, nb.SPACE ?? 50) + 0.25 * sim(na.PERC ?? 50, nb.PERC ?? 50) + 0.25 * sim(na.RESP ?? 50, nb.RESP ?? 50) + 0.25 * sim(na.DEP ?? 50, nb.DEP ?? 50);
  const styleA = pa.style, styleB = pb.style;
  const compat = CONFLICT_COMPAT[styleA][styleB];
  const C = 0.4 * sim(na.COMM ?? 50, nb.COMM ?? 50) + 0.3 * compat + 0.3 * pa.cmp.comm;
  const R = 0.3 * sim(na.PLAN ?? 50, nb.PLAN ?? 50) + 0.25 * sim(na.PLAY ?? 50, nb.PLAY ?? 50) + 0.25 * sim(na.INIT ?? 50, nb.INIT ?? 50) + 0.2 * sim(na.EI ?? 50, nb.EI ?? 50);
  const overall = 0.22 * M + 0.20 * V + 0.22 * E + 0.18 * C + 0.18 * R;

  // 互补度：差异 × 可协调系数（冲突兼容与沟通相似的均值）
  const dPlan = Math.abs((na.PLAN ?? 50) - (nb.PLAN ?? 50));
  const dThink = (Math.abs((na.SN ?? 50) - (nb.SN ?? 50)) + Math.abs((na.TF ?? 50) - (nb.TF ?? 50))) / 2;
  const dEmotion = (Math.abs((na.SPACE ?? 50) - (nb.SPACE ?? 50)) + Math.abs((na.DEP ?? 50) - (nb.DEP ?? 50))) / 2;
  const dSocial = (Math.abs((na.INIT ?? 50) - (nb.INIT ?? 50)) + Math.abs((na.EI ?? 50) - (nb.EI ?? 50))) / 2;
  const coord = (compat / 100 + C / 100) / 2;
  const compParts = [
    { name: '计划与临场', v: dPlan * coord },
    { name: '发散与收敛', v: dThink * coord },
    { name: '情绪需求错位互补', v: dEmotion * coord },
    { name: '社交主动互补', v: dSocial * coord },
  ];
  const Comp = compParts.reduce((s, p) => s + p.v, 0) / 4;

  const playAvg = ((na.PLAY ?? 50) + (nb.PLAY ?? 50)) / 2;
  const energyDiff = Math.abs((na.EI ?? 50) - (nb.EI ?? 50));
  const diff = {
    SPACE: Math.abs((na.SPACE ?? 50) - (nb.SPACE ?? 50)),
    PERC: Math.abs((na.PERC ?? 50) - (nb.PERC ?? 50)),
    COMM: Math.abs((na.COMM ?? 50) - (nb.COMM ?? 50)),
    PLAN: dPlan,
    E: energyDiff,
  };

  const dims = { M, V, E, C, R, Comp };
  const hit = key => {
    switch (key) {
      case 'soulmates': return overall >= 85 && E >= 75;
      case 'magic': return overall >= 80 && compat >= 80;
      case 'samefreq': return M >= 78 && energyDiff <= 20;
      case 'mutual': return (na.D ?? 50) >= 65 && (nb.D ?? 50) >= 65 && E >= 70;
      case 'souls': return M >= 75 && E >= 72;
      case 'understand': return E >= 75 && Math.max(na.PERC ?? 50, nb.PERC ?? 50) >= 65;
      case 'partners': return Comp >= 70 && compat >= 70;
      case 'complement': return Comp >= 65 && E >= 60;
      case 'golden': return V >= 75;
      case 'bicker': return C <= 60 && E >= 40 && E <= 75 && playAvg >= 50;
      case 'lovefight': return (na.COMM ?? 50) >= 65 && (nb.COMM ?? 50) >= 65 && V <= 55;
      case 'rivals': return (na.INIT ?? 50) >= 60 && (nb.INIT ?? 50) >= 60 && M >= 60;
      case 'stubborn': return (na.D ?? 50) >= 65 && (nb.D ?? 50) >= 65 && compat <= 55;
      case 'buddies': return playAvg >= 70 && C >= 60;
      case 'partnersincrime': return (na.JP ?? 50) >= 60 && (nb.JP ?? 50) >= 60 && dPlan <= 20 && playAvg >= 60;
      case 'casual': return (na.RESP ?? 50) <= 45 && (nb.RESP ?? 50) <= 45 && playAvg >= 60;
      case 'contrast': return energyDiff >= 55 && overall >= 50 && overall <= 72 && E >= 65;
      case 'clash': return E <= 45 && compat <= 50;
      default: return false;
    }
  };

  const hits = TITLES.filter(t => hit(t.key));
  let main, aux = [];
  if (hits.length) {
    main = hits[0];
    const cats = new Set([main.cat]);
    for (const t of hits.slice(1)) {
      if (aux.length < 2 && !cats.has(t.cat) && t.cat !== '兜底') { aux.push(t); cats.add(t.cat); }
    }
  } else {
    const top = ['M', 'Comp', 'E'].sort((x, y) => dims[y] - dims[x])[0];
    const nt = NEUTRAL_TITLES.find(t => t.dim === top) || NEUTRAL_TITLES.find(t => t.dim === '*');
    main = { name: nt.name, tag: nt.tag, cat: '中性', neutral: true };
  }

  const order = ['M', 'V', 'E', 'C', 'R'].map(k => ({ k, v: dims[k] })).sort((x, y) => y.v - x.v);
  const matches = order.map(x => ({ key: x.k, name: DIM_INFO[x.k].name, pct: pct(x.v) }));
  const best = order.slice(0, 2).map(x => ({ title: DIM_INFO[x.k].name, text: DIM_INFO[x.k].best }));

  // 分歧文案：按 A/B 各自得分方向生成，明确写“A……”“B……”
  const g = (o, k) => o[k] ?? 50;
  const cmp = (x, y, hi, lo) => (x - y >= 8 ? hi : y - x >= 8 ? lo : `${hi}（与对方相近）`);
  const frictionTexts = {
    M: `A更偏${cmp(g(na, 'SN'), g(nb, 'SN'), '直觉和可能性', '具体和现实')}、${cmp(g(na, 'TF'), g(nb, 'TF'), '逻辑利弊', '感受和谐')}的判断方式，B更偏${cmp(g(nb, 'SN'), g(na, 'SN'), '直觉和可能性', '具体和现实')}、${cmp(g(nb, 'TF'), g(na, 'TF'), '逻辑利弊', '感受和谐')}的判断方式——讨论同一件事时容易各说各的，先对齐“我们在说什么”，再讨论谁对谁错。`,
    V: 'A和B对“事情应该怎么办”的标准不一样：当A觉得B“太较真”时，B可能觉得A“不上心”。重大决定之前，先把各自看重的标准说开。',
    E: 'A习惯表达关心的方式，未必是B最需要的；B期待的回应方式，A也未必习惯给出。与其互相猜测，不如直接告诉对方“我需要怎样的关心”。',
    C: `A习惯${cmp(g(na, 'COMM'), g(nb, 'COMM'), '有话直说', '委婉和暗示')}，B习惯${cmp(g(nb, 'COMM'), g(na, 'COMM'), '有话直说', '委婉和暗示')}——不是谁不想说，是表达的频道不同。重要的事，请用对方听得懂的方式再说一遍。`,
    R: `A更想${cmp(g(na, 'PLAN'), g(nb, 'PLAN'), '把计划提前定好', '保留随机应变的空间')}，B更想${cmp(g(nb, 'PLAN'), g(na, 'PLAN'), '把计划提前定好', '保留随机应变的空间')}——分歧大多出现在“计划”两个字上。共同活动前，先分清哪些必须定、哪些可以随意。`,
  };
  const friction = [];
  if (compat <= 60) friction.push({ title: '冲突处理', text: `A的冲突风格是“${CONFLICT_LABEL[styleA]}”，B是“${CONFLICT_LABEL[styleB]}”——给彼此一个“再开口”的时间，而不是逼对方立刻表态。` });
  for (const x of [...order].reverse()) {
    if (friction.length < 2) friction.push({ title: DIM_INFO[x.k].name, text: frictionTexts[x.k] });
  }

  // 视角差异：命中规则后按 A/B 谁触发生成定向描述
  const clashes = [];
  const addClash = (title, text) => { if (clashes.length < 4) clashes.push({ title, text }); };
  const hi = (o, k, t = 65) => g(o, k) >= t;
  const lo = (o, k, t = 45) => g(o, k) <= t;
  if (hi(na, 'SPACE') && hi(nb, 'DEP')) addClash('空间与陪伴', 'A更需要独处恢复，B更希望通过陪伴建立连接。双方都没有错，关键是找到彼此舒适的距离。');
  else if (hi(nb, 'SPACE') && hi(na, 'DEP')) addClash('空间与陪伴', 'B更需要独处恢复，A更希望通过陪伴建立连接。双方都没有错，关键是找到彼此舒适的距离。');
  if (hi(na, 'PERC') && lo(nb, 'PERC')) addClash('主动察觉', 'A更希望对方主动注意自己的变化，B更习惯等待明确表达。需要减少猜测，增加主动沟通。');
  else if (hi(nb, 'PERC') && lo(na, 'PERC')) addClash('主动察觉', 'B更希望对方主动注意自己的变化，A更习惯等待明确表达。需要减少猜测，增加主动沟通。');
  if (hi(na, 'RESP') && hi(nb, 'RESP')) addClash('双向等待', 'A和B都比较在意回复和沟通的连续性。如果同时等待对方主动，容易出现不必要的失落。');
  if (hi(na, 'COMM') && lo(nb, 'COMM')) addClash('直球与潜台词', 'A倾向于直接表达，B更习惯委婉沟通。需要避免把表达方式不同误解为态度不同。');
  else if (hi(nb, 'COMM') && lo(na, 'COMM')) addClash('直球与潜台词', 'B倾向于直接表达，A更习惯委婉沟通。需要避免把表达方式不同误解为态度不同。');
  if (Math.abs(g(na, 'PLAN') - g(nb, 'PLAN')) >= 30) addClash('计划节奏', g(na, 'PLAN') > g(nb, 'PLAN')
    ? 'A更希望提前确定安排，B更愿意保留变化空间。共同活动最好提前明确必须确定的部分。'
    : 'B更希望提前确定安排，A更愿意保留变化空间。共同活动最好提前明确必须确定的部分。');
  if (hi(na, 'DEP') && hi(nb, 'SPACE')) addClash('亲密边界', 'A更希望通过陪伴建立连接，B更需要个人空间。关系稳定的关键不是谁改变自己，而是建立双方认可的互动节奏。');
  else if (hi(nb, 'DEP') && hi(na, 'SPACE')) addClash('亲密边界', 'B更希望通过陪伴建立连接，A更需要个人空间。关系稳定的关键不是谁改变自己，而是建立双方认可的互动节奏。');
  if (hi(na, 'D') && hi(nb, 'D')) addClash('双强表达', 'A和B在冲突中都比较直接，讨论效率可能较高，但也需要注意表达方式，避免让讨论变成竞争。');
  if (hi(na, 'H') && hi(nb, 'H')) addClash('过度迁就', 'A和B都可能为了避免冲突而暂时让步，需要留意彼此的真实需求是否被长期隐藏。');

  const guideCtx = { compat, diff, V, playAvg };
  const guide = GUIDE_RULES.filter(r => r.when(guideCtx)).map(r => r.text).concat(GUIDE_FIXED).slice(0, 5);

  return {
    title: main.name, tag: main.tag, neutral: !!main.neutral,
    intro: main.intro, intro2: main.intro2, strengths: main.strengths, watch: main.watch, advice: main.advice,
    aux: aux.map(t => t.name),
    grade: OVERALL_GRADE(overall), overall: pct(overall),
    matches, best, friction,
    comp: { pct: pct(Comp), parts: compParts.map(p => ({ name: p.name, v: pct(p.v) })) },
    compat: pct(compat), styleA, styleB, styleLabelA: CONFLICT_LABEL[styleA], styleLabelB: CONFLICT_LABEL[styleB],
    clashes, guide,
    names: { a: `A（${pa.nickname || '第一位'}）`, b: `B（${pb.nickname || '第二位'}）` },
  };
}
