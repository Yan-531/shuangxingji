// 双星记 · 主逻辑 v4（个人报告码模式：一个码对应一个人的测试结果，两个码随时生成双人报告）
import { QUESTIONS, MODULES } from './questions.js';
import { computeScores, buildPersonal, buildDual } from './scoring.js';

const SUPABASE_URL = 'https://bxfkxjidcbqoetcttndg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lXAY675jZF6BTLRQhNPxxg_RAdSD3EC';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const SKIP_LIMIT = 3;

const $ = sel => document.querySelector(sel);
const app = $('#app');
const ls = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k),
};
const K = {
  me: 'sx_me',            // {code, token, nickname} 本机最近一次测试的身份
  draft: 'sx_draft',      // {answers, skips, nickname} 答题草稿
  partner: 'sx_partner',  // 对方的报告码（先测试后自动配对时用）
};
const urlParams = new URLSearchParams(location.search);

// ---------- 后端封装 ----------
const rpc = (fn, args) => sb.rpc(fn, args).then(r => { if (r.error) throw r.error; return r.data; });
const one = r => Array.isArray(r) ? (r[0] || null) : r;
const normCode = raw => String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 路由 ----------
async function boot() {
  if (urlParams.get('home')) return home();

  const code = urlParams.get('code');
  if (code) return handleCode(code);

  const a = urlParams.get('a'), b = urlParams.get('b');
  if (a && b) {
    return openDual(normCode(a), normCode(b), () => home()).catch(e => renderError('打不开这份双人报告', String(e.message || e)));
  }
  return home();
}

// 输入/打开一个报告码：可能是我的码、别人的码、或本机没有身份
async function handleCode(raw) {
  const code = normCode(raw);
  if (code.length !== 8) return renderError('报告码不完整', '报告码是 8 位字母数字组合，请检查后重新输入。');
  const me = ls.get(K.me);
  if (me && me.code === code) return showPersonal(code, me.token);

  let prof;
  try {
    prof = one(await rpc('get_profile', { p_code: code }));
  } catch (e) { return renderError('查询失败', String(e.message || e)); }
  if (!prof) return renderError('找不到这个报告码', '请检查有没有输错字母或数字，或让对方重新发一次。');

  if (me) return openDual(me.code, code, () => home()).catch(e => renderError('生成双人报告失败', String(e.message || e)));
  return codeLanding(code, prof); // 本机还没有身份：让用户选「看这份报告」或「去配对」
}

// 本机无身份时的落点页（情况 B / D）
function codeLanding(code, prof) {
  const when = prof.created_at ? new Date(prof.created_at).toLocaleDateString('zh-CN') : '';
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
      <div class="wait-title">报告码验证成功</div>
      <p class="muted" style="margin-top:8px">这个码对应 <b>${esc(prof.nickname)}</b> 的测试结果${when ? `（${when} 完成）` : ''}。</p>
    </div>
    <div class="card">
      <div class="code-box">${code}</div>
    </div>
    <div class="dual-btns">
      <button class="btn btn-secondary" id="view-this">查看这份个人报告</button>
      <button class="btn btn-primary" id="pair">用它生成双人报告</button>
    </div>
    <p class="footer-note">生成双人报告需要你也有一份自己的测试结果 · 双星记</p>
  </section>`;
  $('#view-this').onclick = () => showPersonal(code, null).catch(e => renderError('读取报告失败', String(e.message || e)));
  $('#pair').onclick = () => startPairFlow(code);
}

// 情况 B：没有自己的报告码，先完成测试再自动配对
function startPairFlow(code) {
  const me = ls.get(K.me);
  if (me) return openDual(me.code, code, () => home()).catch(e => renderError('生成双人报告失败', String(e.message || e)));
  ls.set(K.partner, code);
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#8FA9C9', '#F3F7FB', 92)}</div>
      <div class="wait-title">先完成你自己的测试</div>
      <p class="muted" style="margin-top:8px">36 题约 6–8 分钟。答完后你会得到自己的报告码，<br>系统会自动用两个报告码生成你们的双人报告，<br>不需要再输入对方的码，也不用重复做任何题。</p>
    </div>
    <div class="card nickname-card">
      <label class="muted">怎么称呼你？</label>
      <input id="nick" maxlength="12" placeholder="写个昵称吧">
    </div>
    <button class="btn btn-primary" id="go">开始答题</button>
    <button class="btn btn-secondary" id="cancel" style="height:44px;margin-top:10px">先不配对了</button>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记</p>
  </section>`;
  $('#go').onclick = () => quiz({ nickname: $('#nick').value.trim() || '小熊', partnerCode: code });
  $('#cancel').onclick = () => { ls.del(K.partner); home(); };
}

// ---------- 首页（永远展示完整入口，不受本地记忆限制） ----------
function home() {
  const me = ls.get(K.me);
  const draft = ls.get(K.draft);
  const hasDraft = draft && Object.keys(draft.answers || {}).length > 0;

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

    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">🐻</span>
        <div><b>开始测试</b><div class="muted">36 题 · 约 6–8 分钟 · 完成后生成你的专属报告码${me ? '<br>重新测试会生成新的报告码，旧报告保留有效' : ''}</div></div>
      </div>
      <input id="nick" maxlength="12" placeholder="怎么称呼你？" value="${esc(me?.nickname || draft?.nickname || '')}">
      <button class="btn btn-primary" id="start">开始自我测试</button>
      ${hasDraft ? `<button class="btn btn-secondary" id="resume" style="height:44px;margin-top:10px">继续上次未完成的测试（已答 ${Object.keys(draft.answers).length} 题）</button>` : ''}
    </div>

    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">💌</span>
        <div><b>输入报告码</b><div class="muted">输入自己的码查看报告；输入 TA 的码和你自己的码，立即生成双人报告</div></div>
      </div>
      <input id="code-input" maxlength="10" placeholder="输入 8 位报告码" class="code-input">
      <button class="btn btn-primary" id="join">查看报告</button>
    </div>

    <div class="feature-list">
      <div class="row"><div class="ico">⏱</div><div>每人 36 题，约 6–8 分钟</div></div>
      <div class="row"><div class="ico">🔑</div><div>报告码永久对应你的测试结果，可跨设备调取</div></div>
      <div class="row"><div class="ico">✨</div><div>任意两个报告码，随时生成双人报告</div></div>
    </div>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记</p>
  </section>`;

  $('#start').onclick = () => quiz({ nickname: $('#nick').value.trim() || '小熊', partnerCode: null });
  if (hasDraft) $('#resume').onclick = () => quiz({ nickname: draft.nickname || '小熊', partnerCode: ls.get(K.partner), resume: true });
  $('#join').onclick = () => handleCode($('#code-input').value);
  $('#code-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleCode($('#code-input').value); });
  if (me) {
    $('#my-report').onclick = () => showPersonal(me.code, me.token).catch(e => renderError('读取报告失败', String(e.message || e)));
    $('#copy-my').onclick = () => navigator.clipboard?.writeText(me.code).then(() => { $('#copy-my').textContent = '已复制 ✓'; });
  }
}

// ---------- 答题 ----------
function quiz(ctx) {
  const draft = ls.get(K.draft) || { answers: {}, skips: 0, nickname: ctx.nickname };
  draft.nickname = ctx.nickname;
  let qi = firstUnanswered(draft.answers);

  function firstUnanswered(ans) {
    for (let i = 0; i < QUESTIONS.length; i++) if (ans[QUESTIONS[i].id] === undefined) return i;
    return 0;
  }
  function saveDraft() { ls.set(K.draft, draft); }

  function render() {
    const q = QUESTIONS[qi];
    const answeredCount = Object.keys(draft.answers).length;
    app.innerHTML = `
    <section class="page active">
      <div class="quiz-top">
        <span class="module-name">${MODULES[q.m]}</span>
        <span class="q-index">${qi + 1} / ${QUESTIONS.length}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${(answeredCount / QUESTIONS.length) * 100}%"></div></div>
      <div class="question">${q.t}</div>
      <div id="opts"></div>
      <div class="quiz-nav">
        <button class="btn btn-secondary" id="prev" style="visibility:${qi === 0 ? 'hidden' : 'visible'}">上一题</button>
        <button class="btn btn-primary" id="next" ${draft.answers[q.id] === undefined || (Array.isArray(draft.answers[q.id]) && !draft.answers[q.id].length) ? 'disabled' : ''}>${qi === QUESTIONS.length - 1 ? '完成答题' : '下一题'}</button>
      </div>
      <div class="skip-hint"><a id="skip">跳过这题（还可跳过 ${Math.max(0, SKIP_LIMIT - draft.skips)} 次）</a>　<a id="home-link">回到首页</a></div>
      <p class="footer-note">答案已自动保存，随时可以关闭页面回来继续</p>
    </section>`;
    const box = $('#opts');
    const multi = q.type === 'multi';
    const sel = draft.answers[q.id];
    q.o.forEach((op, i) => {
      const el = document.createElement('button');
      el.className = 'option' + (multi ? (Array.isArray(sel) && sel.includes(i) ? ' selected' : '') : (sel === i ? ' selected' : ''));
      el.textContent = op.t;
      el.onclick = () => {
        if (multi) {
          const cur = Array.isArray(sel) ? sel : [];
          const nx = cur.includes(i) ? cur.filter(x => x !== i) : (cur.length >= (q.max || 2) ? cur : [...cur, i]);
          draft.answers[q.id] = nx;
          box.querySelectorAll('.option').forEach((e, j) => e.classList.toggle('selected', nx.includes(j)));
          $('#next').disabled = nx.length === 0;
        } else {
          draft.answers[q.id] = i; saveDraft();
          render(); setTimeout(next, 200);
        }
      };
      box.appendChild(el);
    });
    $('#prev').onclick = () => { if (qi > 0) { qi--; render(); } };
    $('#next').onclick = next;
    $('#skip').onclick = () => {
      if (draft.skips >= SKIP_LIMIT) return;
      draft.skips++; delete draft.answers[q.id]; saveDraft();
      qi < QUESTIONS.length - 1 ? (qi++, render()) : finish();
    };
    $('#home-link').onclick = () => { location.href = `${location.pathname}?home=1`; };
  }
  function next() {
    const q = QUESTIONS[qi];
    if (draft.answers[q.id] === undefined) return;
    saveDraft();
    if (qi < QUESTIONS.length - 1) { qi++; render(); } else finish();
  }
  async function finish() {
    if ($('#next')) $('#next').disabled = true;
    const { dims, contrib, compare, skipped } = computeScores(draft.answers);
    const personal = buildPersonal({ dims, contrib });
    app.innerHTML = `
    <section class="page active">
      <div class="wait-hero">
        <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
        <div class="wait-title">正在生成你的报告码…</div>
      </div>
    </section>`;
    try {
      const d = one(await rpc('create_profile', {
        p_nickname: ctx.nickname,
        p_answers: draft.answers,
        p_scores: { dims, conflict: personal.conflict, compare, skipped },
      }));
      const me = { code: d.code, token: d.owner_token, nickname: ctx.nickname };
      ls.set(K.me, me);
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

// ---------- 个人报告页（报告码即入口） ----------
async function showPersonal(code, ownerToken, opts = {}) {
  const prof = one(await rpc('get_profile', { p_code: code }));
  if (!prof) return renderError('找不到这个报告码', '请检查报告码是否正确。');
  const p = buildPersonal(prof.scores);
  const shareLink = `${location.origin}${location.pathname}?code=${code}`;

  app.innerHTML = `
  <section class="page active">
    <div class="card profile-card">
      <div class="hello">${esc(prof.nickname)}，这是你的性格画像</div>
      <div class="headline">${p.headline}</div>
      <div class="kw-row">${p.keywords.map(k => `<span class="tag">${k}</span>`).join('')}</div>
    </div>

    ${opts.firstTime ? `
    <div class="card" style="border-color:#3D5A80">
      <div class="section-title" style="margin-top:0">你的报告码</div>
      <div class="code-box" id="code">${code}</div>
      <button class="btn btn-primary" id="copy-code" style="height:46px;margin-top:12px">复制报告码</button>
      <p class="muted" style="margin-top:10px">请保存好这个码：以后随时用它查看这份报告；<br>和别人的报告码放在一起，就能生成双人报告。</p>
    </div>` : ''}

    <div class="section-title">你的倾向刻度</div>
    <div class="card" id="axes"></div>
    ${p.sections.map(s => `
      <div class="section-title">${s.title}</div>
      <div class="card insight">${s.text}<div class="evidence">依据：${s.evidence}</div></div>`).join('')}

    <div class="dual-btns">
      <button class="btn btn-primary" id="pair-input">输入 TA 的报告码，生成双人报告</button>
      ${ownerToken ? `<button class="btn btn-secondary" id="my-answers">查看我的答案</button>` : ''}
      <button class="btn btn-secondary" id="copy-link">复制报告链接</button>
      <button class="btn btn-secondary" id="retest">重新测试（生成新报告码）</button>
      <button class="btn btn-secondary" id="back-home">回到首页</button>
    </div>
    <p class="footer-note">本测试为娱乐与自我探索工具，结果基于自评倾向，不构成心理评估。</p>
  </section>`;

  renderAxes(p.axes);
  $('#pair-input').onclick = () => pairInput(code);
  if (ownerToken) $('#my-answers').onclick = () => answersView(code, ownerToken, () => showPersonal(code, ownerToken));
  $('#copy-link').onclick = () => navigator.clipboard?.writeText(shareLink).then(() => { $('#copy-link').textContent = '已复制 ✓'; });
  $('#retest').onclick = () => quiz({ nickname: prof.nickname, partnerCode: null });
  $('#back-home').onclick = () => home();
  if ($('#copy-code')) $('#copy-code').onclick = () => navigator.clipboard?.writeText(code).then(() => { $('#copy-code').textContent = '已复制 ✓'; });
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
    <div class="card">
      <input id="ta-code" maxlength="10" placeholder="TA 的 8 位报告码" class="code-input">
    </div>
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

// ---------- 双人报告（两个报告码 → 随时生成/重看） ----------
async function openDual(codeA, codeB, back, opts = {}) {
  if (codeA === codeB) throw new Error('两个报告码相同，双人报告需要两个不同的人。');
  const [p1, p2] = await Promise.all([
    rpc('get_profile', { p_code: codeA }).then(r => one(r)),
    rpc('get_profile', { p_code: codeB }).then(r => one(r)),
  ]);
  if (!p1) throw new Error(`报告码 ${codeA} 不存在`);
  if (!p2) throw new Error(`报告码 ${codeB} 不存在`);
  const pa = { scores: p1.scores, nickname: p1.nickname, role: 'creator' };
  const pb = { scores: p2.scores, nickname: p2.nickname, role: 'friend' };
  const report = buildDual(pa, pb);
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
      <p class="explain">${r.blurb}</p>
      ${r.aux.length ? `<div class="aux-tags">${r.aux.map(t => `<span class="tag tag-gray">${t}</span>`).join('')}</div>` : ''}
      <div class="rival-name"><span class="me">● ${esc(r.names.a)}</span><span style="color:#C9C2B8">×</span><span class="ta">${esc(r.names.b)} ●</span></div>
    </div>
    ${opts.justCreated ? `
    <div class="card" style="border-color:#3D5A80">
      <p class="muted" style="margin:0">你的报告码 <b>${opts.justCreated}</b> 已生成，请保存好。<br>这份双人报告随时可以用两个报告码重新打开。</p>
    </div>` : ''}
    <div class="section-title">你们有多像</div>
    <div class="card">
      ${r.matches.map(m => `
        <div class="match-row">
          <div class="head"><span>${m.name}</span><span class="pct">${m.pct}%</span></div>
          <div class="mbar"><i class="fillbar" style="width:${m.pct}%"></i></div>
        </div>`).join('')}
      <p class="muted" style="margin-top:12px">百分比表示"相似程度"而非"关系好坏"，差异是话题不是扣分项。</p>
    </div>
    <div class="section-title">你们最合拍的地方</div>
    ${r.best.map(x => `<div class="card insight"><b>${x.title}</b><br>${x.text}</div>`).join('')}
    <div class="section-title">你们最容易分歧的地方</div>
    ${r.friction.map(x => `<div class="card insight"><b>${x.title}</b><br>${x.text}</div>`).join('')}
    <div class="section-title">双方视角差异</div>
    ${r.clashes.map(x => `
      <div class="card">
        <div class="clash">
          <div class="side">${x.a}</div><div class="mid">↔</div><div class="side b">${x.b}</div>
        </div>
        <p class="muted" style="margin-top:12px">${x.note}</p>
      </div>`).join('') || '<div class="card insight">你们的相处里没有明显的"错位"模式，遇到拿不准的直接聊就好。</div>'}
    <div class="section-title">相处指南</div>
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
    <p class="footer-note">报告码 ${ctx.a} × ${ctx.b} · 本报告基于双方自评倾向生成，仅供娱乐与沟通参考。 · 双星记</p>
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

// ---------- 刻度条 ----------
function renderAxes(axes) {
  const card = $('#axes');
  if (!card) return;
  for (const a of axes) {
    const dot = a.pct, lo = Math.min(50, dot), hi = Math.max(50, dot);
    card.insertAdjacentHTML('beforeend', `
      <div class="axis">
        <div class="labels"><b>${a.l}</b><b>${a.r}</b></div>
        <div class="track"><div class="fill" style="left:${lo}%;width:${hi - lo}%"></div>
        <div class="dot" style="left:${dot}%"></div></div>
        <div class="side">${a.side}</div>
      </div>`);
  }
}

// ---------- 我的答案（仅本人密钥可见） ----------
function ansText(q, v) {
  if (v === undefined || v === null) return '<span class="skipped">跳过</span>';
  const idx = Array.isArray(v) ? v : [v];
  if (!idx.length) return '<span class="skipped">跳过</span>';
  return idx.map(i => q.o[i]?.t || '').join('<br>');
}
async function answersView(code, ownerToken, back) {
  let row;
  try {
    row = one(await rpc('get_my_answers', { p_code: code, p_owner_token: ownerToken }));
  } catch (e) { return renderError('读取答案失败', String(e.message || e)); }
  if (!row) return renderError('还没有答案', '你的答题记录还没保存。');

  const list = QUESTIONS.map((q, i) => `
    <div class="ans-item">
      <div class="ans-q">${i + 1}. ${q.t}</div>
      <div class="ans-line"><span class="ans-who">我的选择</span><span>${ansText(q, row.answers?.[q.id])}</span></div>
    </div>`).join('');

  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero" style="padding-top:6px">
      <div class="wait-title">我的答案</div>
      <p class="muted" style="margin-top:8px">共 ${QUESTIONS.length} 题 · 只有你自己能看到</p>
    </div>
    <div class="card">${list}</div>
    <div class="dual-btns"><button class="btn btn-secondary" id="ans-back">返回</button></div>
    <p class="footer-note">答案仅本人可见 · 双星记</p>
  </section>`;
  $('#ans-back').onclick = back;
}

// ---------- 错误页 ----------
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

// ---------- 小熊 SVG ----------
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
