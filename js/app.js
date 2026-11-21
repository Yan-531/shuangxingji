// 双星记 2.0 · 主逻辑 v5（个人报告码 + 36/72 双版本 + 16型人格报告）
import { MODULES, questionSet } from './questions.js';
import { computeScores, normalize, buildPersonal, buildDual, compareRates, conflictStyle } from './scoring.js';

const SUPABASE_URL = 'https://bxfkxjidcbqoetcttndg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lXAY675jZF6BTLRQhNPxxg_RAdSD3EC';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = sel => document.querySelector(sel);
const app = $('#app');
const ls = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k),
};
const K = {
  me: 'sx_me',            // {code, token, nickname}
  draft: 'sx_draft',      // {answers, skips, nickname, version}
  partner: 'sx_partner',  // 对方的报告码
  pairs: 'sx_pairs',      // 本机涉及的双人报告缓存 [{partner_code, created_at}]
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normCode = raw => String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const urlParams = new URLSearchParams(location.search);

const rpc = (fn, args) => sb.rpc(fn, args).then(r => { if (r.error) throw r.error; return r.data; });
const one = r => Array.isArray(r) ? (r[0] || null) : r;

// ---------- 双人报告配对记录（双方设备都可找回） ----------
function savePair(codeA, codeB) {
  const me = ls.get(K.me);
  if (me && (me.code === codeA || me.code === codeB)) {
    const partner = me.code === codeA ? codeB : codeA;
    const list = (ls.get(K.pairs) || []).filter(p => p.partner_code !== partner);
    list.unshift({ partner_code: partner, created_at: new Date().toISOString() });
    ls.set(K.pairs, list.slice(0, 10));
  }
  rpc('save_pair', { p_a: codeA, p_b: codeB }).catch(() => {});
}
async function fetchPairs(code) {
  try {
    const rows = await rpc('get_pairs', { p_code: code });
    const list = (rows || []).map(r => ({ partner_code: r.partner_code, created_at: r.created_at }));
    if (list.length) ls.set(K.pairs, list);
    return list;
  } catch { return ls.get(K.pairs) || []; }
}
async function refreshPairs(boxId, myCode) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const list = await fetchPairs(myCode);
  if (!box.isConnected) return;
  if (!list.length) {
    box.innerHTML = '<p class="muted" style="margin:0">还没有双人报告。对方用你的报告码配对后，这里会出现你们的双人报告，点开就能重看。</p>';
    return;
  }
  box.innerHTML = list.map(p => {
    const d = p.created_at ? new Date(p.created_at).toLocaleDateString('zh-CN') : '';
    return `<div class="ans-item pair-item" data-code="${p.partner_code}">
      <div class="ans-q">与 <b>${p.partner_code}</b> 的双人报告</div>
      <div class="ans-line"><span class="muted">${d} · 点击查看</span></div>
    </div>`;
  }).join('');
  box.querySelectorAll('.pair-item').forEach(el => {
    el.onclick = () => openDual(myCode, el.dataset.code, () => home())
      .catch(e => renderError('打开双人报告失败', String(e.message || e)));
  });
}

// ---------- 路由 ----------
async function boot() {
  if (urlParams.get('home')) return home();
  const code = urlParams.get('code');
  if (code) return handleCode(code);
  const a = urlParams.get('a'), b = urlParams.get('b');
  if (a && b) return openDual(normCode(a), normCode(b), () => home()).catch(e => renderError('打不开这份双人报告', String(e.message || e)));
  return home();
}

async function handleCode(raw) {
  const code = normCode(raw);
  if (code.length !== 8) return renderError('报告码不完整', '报告码是 8 位字母数字组合，请检查后重新输入。');
  const me = ls.get(K.me);
  if (me && me.code === code) return showPersonal(code, me.token);
  let prof;
  try { prof = one(await rpc('get_profile', { p_code: code })); }
  catch (e) { return renderError('查询失败', String(e.message || e)); }
  if (!prof) return renderError('找不到这个报告码', '请检查有没有输错字母或数字，或让对方重新发一次。');
  if (me) return openDual(me.code, code, () => home()).catch(e => renderError('生成双人报告失败', String(e.message || e)));
  return codeLanding(code, prof);
}

function codeLanding(code, prof) {
  const when = prof.created_at ? new Date(prof.created_at).toLocaleDateString('zh-CN') : '';
  const old = !prof.scores || prof.scores.v !== 2;
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
      <div class="wait-title">报告码验证成功</div>
      <p class="muted" style="margin-top:8px">这个码对应 <b>${esc(prof.nickname)}</b> 的测试结果${when ? `（${when} 完成）` : ''}。</p>
    </div>
    <div class="card"><div class="code-box">${code}</div></div>
    ${old ? `
    <div class="card insight">这份报告来自旧版题库（1.0），与新版算法不兼容，只能确认它仍然有效。<br>想看新版报告，需要用新版题库重新做一次测试。</div>
    <div class="dual-btns"><button class="btn btn-primary" id="retest">用新版题库重新测试</button></div>`
    : `
    <div class="dual-btns">
      <button class="btn btn-secondary" id="view-this">查看这份个人报告</button>
      <button class="btn btn-primary" id="pair">用它生成双人报告</button>
    </div>
    <p class="footer-note">生成双人报告需要你也有一份自己的测试结果 · 双星记</p>`}
  </section>`;
  if (old) { $('#retest').onclick = () => { ls.del(K.partner); home(); }; return; }
  $('#view-this').onclick = () => showPersonal(code, null).catch(e => renderError('读取报告失败', String(e.message || e)));
  $('#pair').onclick = () => startPairFlow(code);
}

function startPairFlow(code) {
  const me = ls.get(K.me);
  if (me) return openDual(me.code, code, () => home()).catch(e => renderError('生成双人报告失败', String(e.message || e)));
  ls.set(K.partner, code);
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#8FA9C9', '#F3F7FB', 92)}</div>
      <div class="wait-title">先完成你自己的测试</div>
      <p class="muted" style="margin-top:8px">答完后你会得到自己的报告码，<br>系统会自动用两个报告码生成你们的双人报告，<br>不需要再输入对方的码，也不用重复做任何题。</p>
    </div>
    <div class="card nickname-card">
      <label class="muted">怎么称呼你？</label>
      <input id="nick" maxlength="12" placeholder="写个昵称吧">
    </div>
    <div class="card">
      <label class="muted">选择题库版本</label>
      <div class="dual-btns" style="margin:8px 0 0">
        <button class="btn btn-secondary ver-btn active" data-v="36" style="height:44px">36 题快测</button>
        <button class="btn btn-secondary ver-btn" data-v="72" style="height:44px">72 题完整版</button>
      </div>
    </div>
    <button class="btn btn-primary" id="go">开始答题</button>
    <button class="btn btn-secondary" id="cancel" style="height:44px;margin-top:10px">先不配对了</button>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记</p>
  </section>`;
  let version = 36;
  document.querySelectorAll('.ver-btn').forEach(btn => btn.onclick = () => {
    version = Number(btn.dataset.v);
    document.querySelectorAll('.ver-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
  $('#go').onclick = () => quiz({ nickname: $('#nick').value.trim() || '小熊', partnerCode: code, version });
  $('#cancel').onclick = () => { ls.del(K.partner); home(); };
}

// ---------- 首页 ----------
function home() {
  const me = ls.get(K.me);
  const draft = ls.get(K.draft);
  const hasDraft = draft && Object.keys(draft.answers || {}).length > 0;
  const lastV = draft?.version || 36;

  app.innerHTML = `
  <section class="page active" id="home">
    <div class="bear-wrap">
      <div class="b1">${bear('#3D5A80', '#E6EFF7', 82)}</div>
      <div class="heart-dot"></div>
      <div class="b2">${bear('#8FA9C9', '#F3F7FB', 74)}</div>
    </div>
    <h1 class="title">双星记</h1>
    <p class="subtitle">一个人一份测试结果，一个报告码。<br>两个报告码，看见我们。</p>

    ${me ? `
    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">⭐</span>
        <div><b>我的报告码：${me.code}</b><div class="muted">换设备后在本页输入这个码，就能找回你的报告</div></div>
      </div>
      <div class="dual-btns" style="margin:0">
        <button class="btn btn-primary" id="my-report" style="height:46px">查看我的报告</button>
        <button class="btn btn-secondary" id="copy-my" style="height:46px">复制报告码</button>
      </div>
    </div>` : ''}

    ${me ? `
    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">💞</span>
        <div><b>我们的双人报告</b><div class="muted">TA 用你的码配对过，这里就会出现你们的双人报告</div></div>
      </div>
      <div id="home-pairs" style="margin-top:8px"><p class="muted" style="margin:0">加载中…</p></div>
    </div>` : ''}

    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">🐻</span>
        <div><b>开始测试</b><div class="muted">完成后生成你的专属报告码${me ? '<br>重新测试会生成新的报告码，旧报告保留有效' : ''}</div></div>
      </div>
      <div class="card" style="margin:10px 0">
        <label class="muted">题库版本</label>
        <div class="dual-btns" style="margin:8px 0 0">
          <button class="btn btn-secondary ver-btn ${lastV === 36 ? 'active' : ''}" data-v="36" style="height:44px">36 题快测 · 约 6–8 分钟</button>
          <button class="btn btn-secondary ver-btn ${lastV === 72 ? 'active' : ''}" data-v="72" style="height:44px">72 题完整版 · 约 15 分钟</button>
        </div>
      </div>
      <input id="nick" maxlength="12" placeholder="怎么称呼你？" value="${esc(me?.nickname || draft?.nickname || '')}">
      <button class="btn btn-primary" id="start">开始自我测试</button>
      ${hasDraft ? `<button class="btn btn-secondary" id="resume" style="height:44px;margin-top:10px">继续上次未完成的测试（已答 ${Object.keys(draft.answers).length} 题）</button>` : ''}
    </div>

    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">💌</span>
        <div><b>输入报告码</b><div class="muted">输入自己的码查看报告；输入 TA 的码立即生成双人报告</div></div>
      </div>
      <input id="code-input" maxlength="10" placeholder="输入 8 位报告码" class="code-input">
      <button class="btn btn-primary" id="join">查看报告</button>
    </div>

    <div class="feature-list">
      <div class="row"><div class="ico">⏱</div><div>36 题快测 / 72 题完整版，报告码互通</div></div>
      <div class="row"><div class="ico">🔑</div><div>报告码永久对应你的测试结果，可跨设备调取</div></div>
      <div class="row"><div class="ico">✨</div><div>16 型人格画像 + 八维功能 + 双人五维契合</div></div>
    </div>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记 2.0</p>
  </section>`;

  let version = lastV;
  document.querySelectorAll('.ver-btn').forEach(btn => btn.onclick = () => {
    version = Number(btn.dataset.v);
    document.querySelectorAll('.ver-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
  $('#start').onclick = () => quiz({ nickname: $('#nick').value.trim() || '小熊', partnerCode: null, version });
  if (hasDraft) $('#resume').onclick = () => quiz({ nickname: draft.nickname || '小熊', partnerCode: ls.get(K.partner), version: draft.version || 36, resume: true });
  $('#join').onclick = () => handleCode($('#code-input').value);
  $('#code-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleCode($('#code-input').value); });
  if (me) {
    refreshPairs('home-pairs', me.code);
    $('#my-report').onclick = () => showPersonal(me.code, me.token).catch(e => renderError('读取报告失败', String(e.message || e)));
    $('#copy-my').onclick = () => navigator.clipboard?.writeText(me.code).then(() => { $('#copy-my').textContent = '已复制 ✓'; });
  }
}

// ---------- 答题 ----------
function quiz(ctx) {
  const questions = questionSet(ctx.version);
  const skipLimit = ctx.version === 72 ? 6 : 3;
  const draft = ls.get(K.draft) || { answers: {}, skips: 0, nickname: ctx.nickname, version: ctx.version };
  draft.nickname = ctx.nickname; draft.version = ctx.version;
  let qi = firstUnanswered(draft.answers);

  function firstUnanswered(ans) {
    for (let i = 0; i < questions.length; i++) if (ans[questions[i].id] === undefined) return i;
    return 0;
  }
  function saveDraft() { ls.set(K.draft, draft); }
  // 模块跳题保护：跳过该题后模块内不能再出现“全部跳过”
  function canSkip(q) {
    const siblings = questions.filter(x => x.m === q.m);
    const answered = siblings.filter(x => draft.answers[x.id] !== undefined).length;
    const skippedOthers = siblings.filter(x => x.id !== q.id && draft.answers[x.id] === undefined && (draft.skippedIds || []).includes(x.id)).length;
    return answered > 0 || siblings.length - skippedOthers - 1 >= 1;
  }

  function render() {
    const q = questions[qi];
    const answeredCount = Object.keys(draft.answers).length;
    app.innerHTML = `
    <section class="page active">
      <div class="quiz-top">
        <span class="module-name">${MODULES[q.m]}</span>
        <span class="q-index">${qi + 1} / ${questions.length}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${(answeredCount / questions.length) * 100}%"></div></div>
      <div class="question">${q.t}</div>
      <div id="opts"></div>
      <div class="quiz-nav">
        <button class="btn btn-secondary" id="prev" style="visibility:${qi === 0 ? 'hidden' : 'visible'}">上一题</button>
        <button class="btn btn-primary" id="next" ${draft.answers[q.id] === undefined ? 'disabled' : ''}>${qi === questions.length - 1 ? '完成答题' : '下一题'}</button>
      </div>
      <div class="skip-hint"><a id="skip">跳过这题（还可跳过 ${Math.max(0, skipLimit - draft.skips)} 次）</a>　<a id="home-link">回到首页</a></div>
      <p class="footer-note">答案已自动保存，随时可以关闭页面回来继续</p>
    </section>`;
    const box = $('#opts');
    q.o.forEach((op, i) => {
      const el = document.createElement('button');
      el.className = 'option' + (draft.answers[q.id] === i ? ' selected' : '');
      el.textContent = op.t;
      el.onclick = () => { draft.answers[q.id] = i; saveDraft(); render(); setTimeout(next, 200); };
      box.appendChild(el);
    });
    $('#prev').onclick = () => { if (qi > 0) { qi--; render(); } };
    $('#next').onclick = next;
    $('#skip').onclick = () => {
      if (draft.skips >= skipLimit) return;
      if (!canSkip(q)) { alert('每个模块至少要回答一道题，这题暂时不能跳过。'); return; }
      draft.skips++; draft.skippedIds = draft.skippedIds || [];
      draft.skippedIds.push(q.id);
      delete draft.answers[q.id]; saveDraft();
      qi < questions.length - 1 ? (qi++, render()) : finish();
    };
    $('#home-link').onclick = () => { location.href = `${location.pathname}?home=1`; };
  }
  function next() {
    const q = questions[qi];
    if (draft.answers[q.id] === undefined) return;
    saveDraft();
    if (qi < questions.length - 1) { qi++; render(); } else finish();
  }
  async function finish() {
    if ($('#next')) $('#next').disabled = true;
    app.innerHTML = `
    <section class="page active">
      <div class="wait-hero">
        <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
        <div class="wait-title">正在生成你的报告码…</div>
      </div>
    </section>`;
    try {
      const { dims, compare, skipped } = computeScores(draft.answers, questions);
      const { norm, valid } = normalize(dims, draft.answers, questions);
      const answeredCount = Object.keys(draft.answers).length;
      const scores = { v: 2, version: ctx.version, dims, norm, valid, compare, skipped, answeredCount };
      const d = one(await rpc('create_profile', {
        p_nickname: ctx.nickname, p_answers: draft.answers, p_scores: scores,
      }));
      ls.set(K.me, { code: d.code, token: d.owner_token, nickname: ctx.nickname });
      ls.del(K.draft);

      if (ctx.partnerCode) {
        const ta = ctx.partnerCode;
        ls.del(K.partner);
        return openDual(d.code, ta, () => home(), { justCreated: d.code })
          .catch(e => renderError('生成双人报告失败', `你的报告码 ${d.code} 已生成并保存，请先记下它。` + String(e.message || e)));
      }
      return showPersonal(d.code, d.owner_token, { firstTime: true });
    } catch (e) {
      renderError('提交失败', String(e.message || e) + '（你的答案已保存在本机，可关闭后重试）');
    }
  }
  render();
}

// ---------- 个人报告 ----------
async function showPersonal(code, ownerToken, opts = {}) {
  const prof = one(await rpc('get_profile', { p_code: code }));
  if (!prof) return renderError('找不到这个报告码', '请检查报告码是否正确。');
  const sc = prof.scores || {};
  if (sc.v !== 2) {
    app.innerHTML = `
    <section class="page active">
      <div class="wait-hero">
        <div class="bear-wrap" style="margin-bottom:8px">${bear('#B9B2A9', '#F1EDE7', 86)}</div>
        <div class="wait-title">旧版报告码</div>
        <p class="muted" style="margin-top:8px">报告码 ${code} 有效，但它来自旧版题库（1.0），<br>与新版算法不兼容，无法生成新版报告。</p>
      </div>
      <div class="dual-btns">
        <button class="btn btn-primary" id="retest">用新版题库重新测试</button>
        <button class="btn btn-secondary" id="back-home">回到首页</button>
      </div>
      <p class="footer-note">双星记 2.0</p>
    </section>`;
    $('#retest').onclick = () => home();
    $('#back-home').onclick = () => home();
    return;
  }
  const p = buildPersonal(sc.norm, { version: sc.version, answeredCount: sc.answeredCount, valid: sc.valid || {} });
  const shareLink = `${location.origin}${location.pathname}?code=${code}`;

  app.innerHTML = `
  <section class="page active">
    <div class="card profile-card">
      <div class="hello">${p.type} · ${esc(p.typeName)}</div>
      <div class="headline">${p.tag}</div>
      ${p.uncertainty ? '<p class="muted" style="margin-top:10px">注：你有至少一个维度的分数接近中间值，类型边界存在不确定性，请把下面的描述当作参考倾向。</p>' : ''}
    </div>

    ${opts.firstTime ? `
    <div class="card" style="border-color:#3D5A80">
      <div class="section-title" style="margin-top:0">你的报告码</div>
      <div class="code-box" id="code">${code}</div>
      <button class="btn btn-primary" id="copy-code" style="height:46px;margin-top:12px">复制报告码</button>
      <p class="muted" style="margin-top:10px">请保存好这个码：以后随时用它查看这份报告；<br>和别人的报告码放在一起，就能生成双人报告。</p>
    </div>` : ''}

    <div class="section-title">我们的双人报告</div>
    <div class="card" id="personal-pairs"><p class="muted" style="margin:0">加载中…</p></div>

    <div class="section-title">四轴倾向</div>
    <div class="card" id="axes"></div>
    ${p.uncertainty ? '<p class="muted" style="margin-top:-14px;margin-bottom:10px">「轻微 / 中性」表示该轴接近中间，不要强行贴标签。</p>' : ''}

    <div class="section-title">情绪与关系需求（按你的实际得分生成）</div>
    <div class="card">${p.needs.map(n => `<p style="margin:6px 0">· ${n.text}</p>`).join('')}</div>

    <div class="section-title">八维功能排名</div>
    <div class="card">
      ${p.functions.map(f => `
        <div class="ans-item">
          <div class="ans-q">第${['一','二','三','四','五','六','七','八'][f.rank - 1]}名 · ${f.name}（${f.score}）</div>
          <div class="ans-line"><span>${f.text}</span></div>
        </div>`).join('')}
      <p class="muted" style="margin-top:10px">第一、二名功能差距：${p.gapText}。排名描述的是本次问卷中的表现倾向，不等于荣格功能堆栈。</p>
      ${p.combo ? `<div class="card insight" style="margin-top:10px"><b>功能组合：${p.combo.name}</b><br>${p.combo.desc}</div>` : ''}
    </div>

    <div class="section-title">人格整体画像</div>
    ${p.profile.map(t => `<div class="card insight">${t}</div>`).join('')}
    <div class="section-title">思维方式</div>
    <div class="card insight">${p.mind}</div>
    <div class="section-title">社交与相处模式</div>
    <div class="card insight">${p.social}</div>
    <div class="section-title">优势</div>
    <div class="card"><ul class="guide">${p.strengths.map(s => `<li>${s}</li>`).join('')}</ul></div>
    <div class="section-title">容易出现的盲点</div>
    <div class="card"><ul class="guide">${p.blind.map(s => `<li>${s}</li>`).join('')}</ul></div>
    <div class="section-title">亲密关系中的表现</div>
    <div class="card insight">${p.love}</div>
    <div class="section-title">成长方向</div>
    <div class="card insight">${p.growth}</div>

    <div class="dual-btns">
      <button class="btn btn-primary" id="pair-input">输入 TA 的报告码，生成双人报告</button>
      ${ownerToken ? `<button class="btn btn-secondary" id="my-answers">查看我的答案</button>` : ''}
      <button class="btn btn-secondary" id="copy-link">复制报告链接</button>
      <button class="btn btn-secondary" id="retest">重新测试（生成新报告码）</button>
      <button class="btn btn-secondary" id="back-home">回到首页</button>
    </div>
    <p class="footer-note">测试版本：${p.version} 题 · 完成 ${p.answeredCount} 题 · 置信等级：${p.confidence}<br>本测试为娱乐与自我探索工具，结果基于自评倾向，不构成心理评估。</p>
  </section>`;

  renderAxes(p.axes);
  refreshPairs('personal-pairs', code);
  $('#pair-input').onclick = () => pairInput(code);
  if (ownerToken) $('#my-answers').onclick = () => answersView(code, ownerToken, () => showPersonal(code, ownerToken));
  $('#copy-link').onclick = () => navigator.clipboard?.writeText(shareLink).then(() => { $('#copy-link').textContent = '已复制 ✓'; });
  $('#retest').onclick = () => quiz({ nickname: prof.nickname, partnerCode: null, version: sc.version || 36 });
  $('#back-home').onclick = () => home();
  if ($('#copy-code')) $('#copy-code').onclick = () => navigator.clipboard?.writeText(code).then(() => { $('#copy-code').textContent = '已复制 ✓'; });
}

function renderAxes(axes) {
  const card = $('#axes');
  if (!card) return;
  for (const a of axes) {
    card.insertAdjacentHTML('beforeend', `
      <div class="axis">
        <div class="labels"><b>${a.pos}（${a.pos === 'E' ? '外向' : a.pos === 'N' ? '直觉' : a.pos === 'T' ? '逻辑' : '灵活'}）</b><b>${a.neg}（${a.neg === 'I' ? '内向' : a.neg === 'S' ? '实感' : a.neg === 'F' ? '感受' : '计划'}）</b></div>
        <div class="track"><div class="fill" style="left:${Math.min(50, 100 - a.v)}%;width:${Math.abs(50 - a.v)}%"></div>
        <div class="dot" style="left:${100 - a.v}%"></div></div>
        <div class="side">${a.v} · ${a.level}偏${a.letter}</div>
      </div>`);
  }
}

// 输入对方的报告码 → 生成双人报告
function pairInput(myCode) {
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
      <div class="wait-title">输入 TA 的报告码</div>
      <p class="muted" style="margin-top:8px">两个人都做过测试后，两个码放在一起<br>就能随时生成或重新打开双人报告。</p>
    </div>
    <div class="card"><input id="ta-code" maxlength="10" placeholder="TA 的 8 位报告码" class="code-input"></div>
    <button class="btn btn-primary" id="go">生成双人报告</button>
    <button class="btn btn-secondary" id="cancel" style="height:44px;margin-top:10px">返回</button>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记</p>
  </section>`;
  const go = () => {
    const ta = normCode($('#ta-code').value);
    if (ta.length !== 8) return renderError('报告码不完整', '报告码是 8 位字母数字组合，请检查后重新输入。');
    if (ta === myCode) return renderError('两个码是一样的', '双人报告需要两个不同的人的报告码。');
    openDual(myCode, ta, () => showPersonal(myCode, ls.get(K.me)?.token))
      .catch(e => renderError('生成双人报告失败', String(e.message || e)));
  };
  $('#go').onclick = go;
  $('#ta-code').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  $('#cancel').onclick = () => showPersonal(myCode, ls.get(K.me)?.token).catch(() => home());
}

// ---------- 双人报告 ----------
async function openDual(codeA, codeB, back, opts = {}) {
  if (codeA === codeB) throw new Error('两个报告码相同，双人报告需要两个不同的人。');
  const [p1, p2] = await Promise.all([
    rpc('get_profile', { p_code: codeA }).then(r => one(r)),
    rpc('get_profile', { p_code: codeB }).then(r => one(r)),
  ]);
  if (!p1) throw new Error(`报告码 ${codeA} 不存在`);
  if (!p2) throw new Error(`报告码 ${codeB} 不存在`);
  for (const p of [p1, p2]) {
    if (!p.scores || p.scores.v !== 2) throw new Error(`${p.nickname || '其中一方'}的报告来自旧版题库，请让对方用新版重新测试后再配对。`);
  }
  const cmp = compareRates(p1.scores.compare || {}, p2.scores.compare || {}, p1.scores.version, p2.scores.version);
  const pa = { norm: p1.scores.norm, cmp, style: conflictStyle(p1.scores.norm), nickname: p1.nickname };
  const pb = { norm: p2.scores.norm, cmp, style: conflictStyle(p2.scores.norm), nickname: p2.nickname };
  const report = buildDual(pa, pb);
  savePair(codeA, codeB);
  renderDual(report, { a: codeA, b: codeB, back }, opts);
}

function renderDual(r, ctx, opts = {}) {
  const me = ls.get(K.me);
  const shareLink = `${location.origin}${location.pathname}?a=${ctx.a}&b=${ctx.b}`;
  const mineInvolved = me && (me.code === ctx.a || me.code === ctx.b);

  app.innerHTML = `
  <section class="page active">
    <div class="title-hero">
      <div class="small">你们是什么组合</div>
      <div class="big">${r.title}</div>
      <p class="explain">${r.tag}</p>
      ${r.aux.length ? `<div class="aux-tags">${r.aux.map(t => `<span class="tag tag-gray">${t}</span>`).join('')}</div>` : ''}
      <div class="rival-name"><span class="me">● ${esc(r.names.a)}</span><span style="color:#C9C2B8">×</span><span class="ta">${esc(r.names.b)} ●</span></div>
    </div>

    <div class="card">
      <div class="match-row">
        <div class="head"><span>综合契合度（${r.grade}）</span><span class="pct">${r.overall}%</span></div>
        <div class="mbar"><i class="fillbar" style="width:${r.overall}%"></i></div>
      </div>
      <p class="muted" style="margin-top:10px">称号描述关系特征，分数描述本次问卷反映的契合程度，两者独立参考。百分比不等于“关系好坏”。</p>
    </div>

    <div class="section-title">五大关系维度</div>
    <div class="card">
      ${r.matches.map(m => `
        <div class="match-row">
          <div class="head"><span>${m.name}</span><span class="pct">${m.pct}%</span></div>
          <div class="mbar"><i class="fillbar" style="width:${m.pct}%"></i></div>
        </div>`).join('')}
    </div>

    <div class="section-title">彼此相似的地方</div>
    ${r.best.map(x => `<div class="card insight"><b>${x.title}</b><br>${x.text}</div>`).join('')}

    <div class="section-title">彼此互补的地方</div>
    <div class="card">
      <div class="match-row">
        <div class="head"><span>互补度（已按沟通兼容性修正）</span><span class="pct">${r.comp.pct}%</span></div>
        <div class="mbar"><i class="fillbar" style="width:${r.comp.pct}%"></i></div>
      </div>
      ${r.comp.parts.map(p => `<div class="match-row"><div class="head"><span>${p.name}</span><span class="pct">${p.v}</span></div><div class="mbar"><i class="fillbar" style="width:${p.v}%"></i></div></div>`).join('')}
      <p class="muted" style="margin-top:10px">互补不是差异越大越好：只有当双方沟通方式兼容时，差异才是资源。</p>
    </div>

    <div class="section-title">冲突兼容度</div>
    <div class="card">
      <div class="match-row">
        <div class="head"><span>${esc(r.names.a)}：${r.styleLabelA} × ${esc(r.names.b)}：${r.styleLabelB}</span><span class="pct">${r.compat}%</span></div>
        <div class="mbar"><i class="fillbar" style="width:${r.compat}%"></i></div>
      </div>
    </div>

    <div class="section-title">最容易产生分歧的地方</div>
    ${r.friction.map(x => `<div class="card insight"><b>${x.title}</b><br>${x.text}</div>`).join('')}

    <div class="section-title">双方视角差异</div>
    ${r.clashes.length ? r.clashes.map(x => `
      <div class="card">
        <div class="clash"><div class="side">${esc(r.names.a)}</div><div class="mid">↔</div><div class="side b">${esc(r.names.b)}</div></div>
        <p class="muted" style="margin-top:10px"><b>${x.title}</b> · ${x.text}</p>
      </div>`).join('')
      : '<div class="card insight">本次测试没有检测到明显的“错位”模式，遇到拿不准的直接聊就好。</div>'}

    <div class="section-title">相处建议</div>
    <div class="card"><ul class="guide">${r.guide.map(g => `<li>${g}</li>`).join('')}</ul></div>

    <div class="section-title">给开发者留言</div>
    <div class="card">
      <div class="muted" style="margin-bottom:8px">这个测试还在打磨中，任何想法都可以写给我 👇</div>
      <textarea id="fb-content" maxlength="800" placeholder="哪里觉得准、哪里觉得不准？想要什么新内容？"></textarea>
      <input id="fb-contact" maxlength="40" placeholder="联系方式（选填，方便回复你）">
      <button class="btn btn-secondary" id="fb-send" style="height:46px;margin-top:12px">发送留言</button>
      <div class="fb-hint" id="fb-hint"></div>
    </div>

    <div class="dual-btns">
      <button class="btn btn-secondary" id="copy-share">复制报告链接</button>
      ${mineInvolved ? `<button class="btn btn-primary" id="my-personal">回看我的个人报告</button>` : ''}
      <button class="btn btn-secondary" id="back-btn">返回</button>
    </div>
    <p class="footer-note">报告码 ${ctx.a} × ${ctx.b} · 关系总结：${r.grade}（${r.overall}%）。<br>本报告基于双方自评倾向生成，仅供娱乐与沟通参考，不能预测关系走向。 · 双星记 2.0</p>
  </section>`;

  $('#copy-share').onclick = () => navigator.clipboard?.writeText(shareLink).then(() => { $('#copy-share').textContent = '已复制 ✓'; });
  if ($('#my-personal')) $('#my-personal').onclick = () => showPersonal(me.code, me.token).catch(e => renderError('读取报告失败', String(e.message || e)));
  $('#back-btn').onclick = () => (ctx.back || home)();
  $('#fb-send').onclick = async () => {
    const content = $('#fb-content').value.trim();
    const hint = $('#fb-hint');
    if (content.length < 2) { hint.textContent = '写几句话再发送吧'; hint.className = 'fb-hint err'; return; }
    const btn = $('#fb-send');
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      await rpc('send_feedback', { p_content: content, p_contact: $('#fb-contact').value.trim(), p_test_id: null, p_role: 'dual' });
      $('#fb-content').value = ''; $('#fb-contact').value = '';
      hint.textContent = '已收到，谢谢你的留言 🐻';
      hint.className = 'fb-hint ok';
      btn.textContent = '再写一条';
      btn.disabled = false;
    } catch (e) {
      hint.textContent = '发送失败：' + String(e.message || e);
      hint.className = 'fb-hint err';
      btn.textContent = '发送留言'; btn.disabled = false;
    }
  };
}

// ---------- 我的答案 ----------
function ansText(q, v) {
  if (v === undefined || v === null) return '<span class="skipped">跳过</span>';
  return q.o[v]?.t || '';
}
async function answersView(code, ownerToken, back) {
  let row;
  try { row = one(await rpc('get_my_answers', { p_code: code, p_owner_token: ownerToken })); }
  catch (e) { return renderError('读取答案失败', String(e.message || e)); }
  if (!row) return renderError('还没有答案', '你的答题记录还没保存。');
  const questions = questionSet(row.version || 36);
  const list = questions.map((q, i) => `
    <div class="ans-item">
      <div class="ans-q">${i + 1}. ${q.t}</div>
      <div class="ans-line"><span class="ans-who">我的选择</span><span>${ansText(q, row.answers?.[q.id])}</span></div>
    </div>`).join('');
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero" style="padding-top:6px">
      <div class="wait-title">我的答案</div>
      <p class="muted" style="margin-top:8px">${questions.length} 题 · 只有你自己能看到</p>
    </div>
    <div class="card">${list}</div>
    <div class="dual-btns"><button class="btn btn-secondary" id="ans-back">返回</button></div>
    <p class="footer-note">答案仅本人可见 · 双星记</p>
  </section>`;
  $('#ans-back').onclick = back;
}

// ---------- 错误页 / 小熊 ----------
function renderError(title, msg) {
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#B9B2A9', '#F1EDE7', 86)}</div>
      <div class="wait-title">${esc(title)}</div>
      <p class="muted" style="margin-top:8px">${esc(msg)}</p>
    </div>
    <button class="btn btn-primary" onclick="location.href='${location.origin}${location.pathname}?home=1'">回到首页</button>
    <p class="footer-note">双星记</p>
  </section>`;
}

function bear(color, inner, size) {
  return `<svg viewBox="0 0 120 112" width="${size}" height="${Math.round(size * 0.93)}">
    <circle cx="34" cy="27" r="15" fill="${color}"/><circle cx="86" cy="27" r="15" fill="${color}"/>
    <circle cx="34" cy="27" r="7.5" fill="${inner}"/><circle cx="86" cy="27" r="7.5" fill="${inner}"/>
    <circle cx="60" cy="64" r="41" fill="${color}"/><circle cx="60" cy="75" r="19" fill="${inner}"/>
    <circle cx="46" cy="56" r="5" fill="#FFFDF9"/><circle cx="47.5" cy="57" r="2.6" fill="#2E2E38"/>
    <circle cx="74" cy="56" r="5" fill="#FFFDF9"/><circle cx="72.5" cy="57" r="2.6" fill="#2E2E38"/>
    <circle cx="36" cy="70" r="6.5" fill="#F3C9B8" opacity=".75"/><circle cx="84" cy="70" r="6.5" fill="#F3C9B8" opacity=".75"/>
    <ellipse cx="60" cy="71" rx="7" ry="5.2" fill="#2E2E38"/>
    <path d="M54 80 Q60 85 66 80" stroke="#2E2E38" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  </svg>`;
}

boot();
