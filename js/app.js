// 双星记 · 主逻辑（多好友模式：一个邀请码可邀请多人，各自生成一份双人报告）
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
  creator: 'bear_creator',                          // {testId, token, nickname, inviteCode}
  friend: id => `bear_friend_${id}`,                // friend token
  code: code => `bear_code_${code}`,                // {testId, token}
  lastFriend: 'bear_last_friend',                   // {testId, token}
  draft: (id, role) => `bear_draft_${id}_${role}`,  // {answers, skips}
};
const urlParams = new URLSearchParams(location.search);

// ---------- 后端封装 ----------
const rpc = (fn, args) => sb.rpc(fn, args).then(r => { if (r.error) throw r.error; return r.data; });
const one = r => Array.isArray(r) ? (r[0] || null) : r;

// ---------- 路由 ----------
async function boot() {
  if (urlParams.get('home')) return home(ls.get(K.creator));

  const code = urlParams.get('code');
  if (code) return enterWithCode(code.toUpperCase());

  const t = urlParams.get('t');
  if (t) {
    const c = urlParams.get('c');
    if (c) return enterWithToken(t, c);
    const ft = ls.get(K.friend(t));
    if (ft) return enterWithToken(t, ft);
    return renderError('链接已更新', '现在改用邀请码邀请：让对方把 8 位邀请码发给你，在首页输入即可。');
  }

  const creator = ls.get(K.creator);
  if (creator) {
    try {
      const st = one(await rpc('get_my_state', { p_test_id: creator.testId, p_token: creator.token }));
      if (st?.role === 'creator') {
        const nick = st.nickname || creator.nickname;
        if (!st.completed) return quiz({ testId: creator.testId, token: creator.token, role: 'creator', nickname: nick, resume: true });
        return inviteView(creator.testId, creator.token, nick);
      }
    } catch { /* 回退 */ }
  }

  const fs = ls.get(K.lastFriend);
  if (fs) {
    try {
      const st = one(await rpc('get_my_state', { p_test_id: fs.testId, p_token: fs.token }));
      if (st?.role === 'friend') return routeFriend(fs.testId, fs.token, st);
    } catch { /* 回退首页 */ }
  }
  return home(creator);
}

async function enterWithCode(code) {
  const known = ls.get(K.code(code));
  if (known) {
    try {
      const st = one(await rpc('get_my_state', { p_test_id: known.testId, p_token: known.token }));
      if (st?.role === 'friend') return routeFriend(known.testId, known.token, st);
    } catch { /* 继续认领 */ }
  }
  return joinByCode(code);
}

async function enterWithToken(testId, token) {
  try {
    const st = one(await rpc('get_my_state', { p_test_id: testId, p_token: token }));
    if (!st || !st.role) throw new Error('链接无效');
    if (st.role === 'creator') {
      ls.set(K.creator, { ...(ls.get(K.creator) || {}), testId, token, nickname: st.nickname || '' });
      if (!st.completed) return quiz({ testId, token, role: 'creator', nickname: st.nickname || '', resume: true });
      return inviteView(testId, token, st.nickname);
    }
    ls.set(K.friend(testId), token);
    ls.set(K.lastFriend, { testId, token });
    routeFriend(testId, token, st);
  } catch (e) { renderError('链接无效或已过期', String(e.message || e)); }
}

function routeFriend(testId, token, st) {
  if (!st.completed) return quiz({ testId, token, role: 'friend', nickname: st.nickname || '', resume: true });
  if (st.creator_done) return showDual(testId, token, 'friend').catch(() => friendWait(testId, token));
  return friendWait(testId, token);
}

// ---------- 首页 ----------
function home(creator) {
  const friendSession = ls.get(K.lastFriend);
  app.innerHTML = `
  <section class="page active" id="home">
    <div class="bear-wrap">
      <div class="b1">${bear('#3D5A80', '#E6EFF7', 82)}</div>
      <div class="heart-dot"></div>
      <div class="b2">${bear('#8FA9C9', '#F3F7FB', 74)}</div>
    </div>
    <h1 class="title">双星记</h1>
    <p class="subtitle">两个人，两种性格，一个星座。<br>先认识自己，再看见我们。</p>

    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">🐻</span>
        <div><b>自我测试</b><div class="muted">36 题 · 约 6–8 分钟 · 做完拿到邀请码，可邀请多人</div></div>
      </div>
      <input id="nick" maxlength="12" placeholder="怎么称呼你？" value="${creator?.nickname || ''}">
      <button class="btn btn-primary" id="start">开始自我测试</button>
      ${creator ? `<button class="btn btn-secondary" id="resume" style="height:44px;margin-top:10px">继续上次测试</button>` : ''}
    </div>

    <div class="entry-card">
      <div class="entry-head">
        <span class="entry-ico">💌</span>
        <div><b>粘贴好友的邀请码</b><div class="muted">答完自己的部分，就能看到你和 TA 的关系报告</div></div>
      </div>
      <input id="code-input" maxlength="10" placeholder="输入 8 位邀请码" class="code-input">
      <button class="btn btn-primary" id="join">加入好友的测试</button>
      ${friendSession ? `<button class="btn btn-secondary" id="friend-resume" style="height:44px;margin-top:10px">继续我参与的测试</button>` : ''}
    </div>

    <div class="feature-list">
      <div class="row"><div class="ico">⏱</div><div>每人 36 题，约 6–8 分钟</div></div>
      <div class="row"><div class="ico">🤝</div><div>分别独立作答，互不干扰</div></div>
      <div class="row"><div class="ico">✨</div><div>和每位好友各生成一份组合报告</div></div>
    </div>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记</p>
  </section>`;

  $('#start').onclick = async () => {
    const nickname = $('#nick').value.trim() || '小熊';
    try {
      const d = one(await rpc('create_test', {}));
      ls.set(K.creator, { testId: d.test_id, token: d.creator_token, nickname, inviteCode: d.invite_code });
      quiz({ testId: d.test_id, token: d.creator_token, role: 'creator', nickname, resume: false });
    } catch (e) { renderError('创建失败', String(e.message || e)); }
  };
  $('#join').onclick = () => joinByCode($('#code-input').value);
  $('#code-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode($('#code-input').value); });
  if (creator) $('#resume').onclick = () => enterWithToken(creator.testId, creator.token);
  if (friendSession) $('#friend-resume').onclick = () => enterWithToken(friendSession.testId, friendSession.token);
}

// ---------- 凭邀请码加入 ----------
async function joinByCode(raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 6) return renderError('邀请码不完整', '邀请码是 8 位字母数字组合，请向好友再确认一次。');
  try {
    const r = one(await rpc('claim_by_code', { p_code: code }));
    ls.set(K.friend(r.test_id), r.friend_token);
    ls.set(K.code(code), { testId: r.test_id, token: r.friend_token });
    ls.set(K.lastFriend, { testId: r.test_id, token: r.friend_token });
    friendJoin(r.test_id, r.friend_token);
  } catch (e) {
    const m = String(e.message || e);
    if (m.includes('CODE_NOT_FOUND')) renderError('找不到这个邀请码', '请检查有没有输错字母或数字，或让好友重新发一次。');
    else if (m.includes('CREATOR_NOT_READY')) renderError('好友还没做完题', '请让发起测试的朋友先完成自己的 36 题，邀请码才能生效。');
    else renderError('加入失败', m);
  }
}

// ---------- 答题 ----------
function quiz(ctx) {
  const draftKey = K.draft(ctx.testId, ctx.role);
  const draft = ls.get(draftKey) || { answers: {}, skips: 0 };
  let qi = firstUnanswered(draft.answers);

  function firstUnanswered(ans) {
    for (let i = 0; i < QUESTIONS.length; i++) if (ans[QUESTIONS[i].id] === undefined) return i;
    return 0;
  }
  function saveDraft() { ls.set(draftKey, draft); }

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
    try {
      await rpc('submit_answers', {
        p_test_id: ctx.testId, p_token: ctx.token, p_nickname: ctx.nickname,
        p_answers: draft.answers,
        p_scores: { dims, conflict: personal.conflict, compare, skipped },
      });
      ls.del(draftKey);
      if (ctx.role === 'creator') {
        const c = ls.get(K.creator) || {};
        ls.set(K.creator, { ...c, nickname: ctx.nickname });
        inviteView(ctx.testId, ctx.token, ctx.nickname, personal);
      } else {
        ls.set(`bear_nick_${ctx.testId}`, ctx.nickname);
        showDual(ctx.testId, ctx.token, 'friend').catch(() => {
          resultView(personal, ctx);
        });
      }
    } catch (e) {
      renderError('提交失败', String(e.message || e) + '（你的答案已保存在本机，可关闭后重试）');
    }
  }
  render();
}

// ---------- 个人结果 ----------
function resultView(p, ctx) {
  const isCreator = ctx.role === 'creator';
  app.innerHTML = `
  <section class="page active">
    <div class="card profile-card">
      <div class="hello">${ctx.nickname}，这是你的性格画像</div>
      <div class="headline">${p.headline}</div>
      <div class="kw-row">${p.keywords.map(k => `<span class="tag">${k}</span>`).join('')}</div>
    </div>
    <div class="section-title">你的倾向刻度</div>
    <div class="card" id="axes"></div>
    ${p.sections.map(s => `
      <div class="section-title">${s.title}</div>
      <div class="card insight">${s.text}<div class="evidence">依据：${s.evidence}</div></div>`).join('')}
    <div class="dual-btns">
      ${isCreator
        ? `<button class="btn btn-primary" id="invite">回到我的邀请码</button>`
        : `<button class="btn btn-primary" id="dual">查看我们的关系报告</button>`}
      <button class="btn btn-secondary" id="my-answers">查看我的答案</button>
    </div>
    <p class="footer-note">本测试为娱乐与自我探索工具，结果基于自评倾向，不构成心理评估。</p>
  </section>`;
  renderAxes(p.axes);
  if (isCreator) $('#invite').onclick = () => inviteView(ctx.testId, ctx.token, ctx.nickname);
  else $('#dual').onclick = () => showDual(ctx.testId, ctx.token, 'friend').catch(e => renderError('报告还没准备好', String(e.message || e)));
  $('#my-answers').onclick = () => answersView(ctx.testId, ctx.token, ctx.role, null, () => showMyPersonal(ctx.testId, ctx.token, ctx.role));
}

function renderAxes(axes) {
  const card = $('#axes');
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

// ---------- 创建者：邀请码 + 好友列表 ----------
let pollTimer = null;
async function inviteView(testId, token, nickname, personal) {
  clearInterval(pollTimer);
  let st = null, friends = [];
  try { st = one(await rpc('get_my_state', { p_test_id: testId, p_token: token })); } catch { /* 忽略 */ }
  try { friends = await rpc('list_friends', { p_test_id: testId, p_creator_token: token }); } catch { /* 忽略 */ }
  const code = st?.invite_code || (ls.get(K.creator)?.testId === testId ? ls.get(K.creator)?.inviteCode : '') || '';
  if (code) ls.set(K.creator, { ...(ls.get(K.creator) || {}), testId, token, nickname, inviteCode: code });
  const shareLink = code ? `${location.origin}${location.pathname}?code=${code}` : '';
  const myLink = `${location.origin}${location.pathname}?t=${testId}&c=${token}`;
  const doneCount = friends.filter(f => f.done).length;

  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#8FA9C9', '#F3F7FB', 88)}</div>
      <div class="wait-title">邀请码：${code || '生成中…'}</div>
      <p class="muted" style="margin-top:8px">这个邀请码可以给多个人用，<br>你和每个人都会各有一份关系报告。</p>
    </div>

    <div class="card">
      <div class="code-box" id="code">${code || '—'}</div>
      <button class="btn btn-primary" id="copy-code" style="height:46px;margin-top:12px">复制邀请码</button>
      <button class="btn btn-secondary" id="copy-link" style="height:44px;margin-top:10px">复制邀请链接</button>
      <p class="muted" style="margin-top:10px">对方在首页输入邀请码即可开始，无需注册。</p>
    </div>

    <div class="section-title">已完成 ${doneCount} / ${friends.length} 人</div>
    <div class="card" id="friends">
      ${friends.length ? friends.map(f => `
        <div class="friend-row">
          <span class="who">${f.nickname || '一位好友'}</span>
          ${f.done
            ? `<button class="btn btn-secondary" data-fid="${f.friend_id}">看报告</button>`
            : `<span class="badge now">答题中</span>`}
        </div>`).join('')
        : `<div class="muted">还没有人加入，把邀请码发出去吧。</div>`}
    </div>

    <div class="dual-btns">
      ${personal ? `<button class="btn btn-primary" id="my-personal">先看我的个人报告</button>` : ''}
      <button class="btn btn-secondary" id="my-personal2">我的个人报告</button>
    </div>
    <p class="footer-note" style="margin-top:14px">专属链接（换设备找回）：<br>${myLink}</p>
  </section>`;

  $('#copy-code').onclick = () => navigator.clipboard?.writeText(code).then(() => { $('#copy-code').textContent = '已复制 ✓'; });
  $('#copy-link').onclick = () => navigator.clipboard?.writeText(shareLink).then(() => { $('#copy-link').textContent = '已复制 ✓'; });
  $('#friends').addEventListener('click', e => {
    const btn = e.target.closest('button[data-fid]');
    if (btn) showDual(testId, token, 'creator', btn.dataset.fid);
  });
  const openPersonal = () => showMyPersonal(testId, token, 'creator');
  if ($('#my-personal')) $('#my-personal').onclick = openPersonal;
  $('#my-personal2').onclick = openPersonal;

  async function refresh() {
    try {
      const list = await rpc('list_friends', { p_test_id: testId, p_creator_token: token });
      const box = $('#friends');
      if (!box) return;
      const changed = JSON.stringify(list.map(f => f.done)) !== JSON.stringify(friends.map(f => f.done)) || list.length !== friends.length;
      friends = list;
      if (changed) {
        const done = friends.filter(f => f.done).length;
        const title = box.closest('.page').querySelector('.section-title');
        if (title) title.textContent = `已完成 ${done} / ${friends.length} 人`;
        box.innerHTML = friends.length ? friends.map(f => `
          <div class="friend-row">
            <span class="who">${f.nickname || '一位好友'}</span>
            ${f.done
              ? `<button class="btn btn-secondary" data-fid="${f.friend_id}">看报告</button>`
              : `<span class="badge now">答题中</span>`}
          </div>`).join('') : `<div class="muted">还没有人加入，把邀请码发出去吧。</div>`;
      }
    } catch { /* 忽略 */ }
  }
  pollTimer = setInterval(refresh, 6000);
}

async function showMyPersonal(testId, token, role) {
  try {
    const pair = await rpc('get_pair_data', { p_test_id: testId, p_token: token, p_friend_id: null });
    const me = pair.find(p => p.role === role);
    if (!me) throw new Error('未找到你的答题记录');
    resultView(buildPersonal(me.scores), { testId, token, role, nickname: me.nickname });
  } catch (e) {
    // 创建者无好友时 get_pair_data 会报错，改为从状态里取昵称后回首页提示
    renderError('暂时读不到个人报告', '你的答题已完成，报告会在页面重新打开后加载。');
  }
}

// ---------- 好友：等待创建者 ----------
async function friendWait(testId, token) {
  clearInterval(pollTimer);
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
      <div class="wait-title">你已完成，等对方答题</div>
      <p class="muted" style="margin-top:8px">对方答完后，你们的关系报告就会出现在这里。</p>
    </div>
    <div class="dual-btns"><button class="btn btn-secondary" id="back">回看我的个人报告</button></div>
  </section>`;
  $('#back').onclick = () => showMyPersonal(testId, token, 'friend');
  async function check() {
    try {
      const st = one(await rpc('get_my_state', { p_test_id: testId, p_token: token }));
      if (st?.creator_done && st?.completed) { clearInterval(pollTimer); await showDual(testId, token, 'friend'); }
    } catch { /* 忽略 */ }
  }
  pollTimer = setInterval(check, 6000);
}

// ---------- 双人报告 ----------
async function showDual(testId, token, role, friendId) {
  const pair = await rpc('get_pair_data', { p_test_id: testId, p_token: token, p_friend_id: friendId || null });
  const pa = pair.find(p => p.role === 'creator');
  const pb = pair.find(p => p.role === 'friend');
  if (!pa || !pb) throw new Error('对方还未完成答题');
  const report = buildDual(pa, pb);
  if (role === 'creator') {
    rpc('save_report', { p_test_id: testId, p_creator_token: token, p_friend_id: pb.friend_id, p_report: report }).catch(() => {});
  }
  renderDual(report, { testId, token, role, friendId: pb.friend_id });
}

function renderDual(r, ctx) {
  app.innerHTML = `
  <section class="page active">
    <div class="title-hero">
      <div class="small">你们是什么组合</div>
      <div class="big">${r.title}</div>
      <p class="explain">${r.blurb}</p>
      ${r.aux.length ? `<div class="aux-tags">${r.aux.map(t => `<span class="tag tag-gray">${t}</span>`).join('')}</div>` : ''}
      <div class="rival-name"><span class="me">● ${r.names.a}</span><span style="color:#C9C2B8">×</span><span class="ta">${r.names.b} ●</span></div>
    </div>
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
      ${ctx.role === 'creator' ? '<button class="btn btn-primary" id="back-list">返回我的邀请码</button>' : ''}
      <button class="btn btn-secondary" id="my-personal">回看我的个人报告</button>
    </div>
    <p class="footer-note">本报告基于双方自评倾向生成，仅供娱乐与沟通参考，不能预测关系走向。 · 双星记</p>
  </section>`;

  if (ctx.role === 'creator') $('#back-list').onclick = () => inviteView(ctx.testId, ctx.token, '', null);
  $('#my-personal').onclick = () => showMyPersonal(ctx.testId, ctx.token, ctx.role);
  $('#fb-send').onclick = async () => {
    const content = $('#fb-content').value.trim();
    const hint = $('#fb-hint');
    if (content.length < 2) { hint.textContent = '写几句话再发送吧'; hint.className = 'fb-hint err'; return; }
    const btn = $('#fb-send');
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      await rpc('send_feedback', { p_content: content, p_contact: $('#fb-contact').value.trim(), p_test_id: ctx.testId, p_role: ctx.role });
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

// ---------- 答案对照 ----------
function ansText(q, v) {
  if (v === undefined || v === null) return '<span class="skipped">跳过</span>';
  const idx = Array.isArray(v) ? v : [v];
  if (!idx.length) return '<span class="skipped">跳过</span>';
  return idx.map(i => q.o[i]?.t || '').join('<br>');
}
async function answersView(testId, token, role, friendId, back) {
  let rows = [];
  try {
    rows = await rpc('get_answers', { p_test_id: testId, p_token: token });
  } catch (e) { return renderError('读取答案失败', String(e.message || e)); }
  const me = rows[0];
  if (!me) return renderError('还没有答案', '你的答题记录还没保存。');

  const list = QUESTIONS.map((q, i) => `
    <div class="ans-item">
      <div class="ans-q">${i + 1}. ${q.t}</div>
      <div class="ans-line"><span class="ans-who">我的选择</span><span>${ansText(q, me.answers?.[q.id])}</span></div>
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

// ---------- 好友加入（已认领 token） ----------
async function friendJoin(testId, token) {
  const nick = ls.get(`bear_nick_${testId}`);
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#3D5A80', '#E6EFF7', 92)}</div>
      <div class="wait-title">邀请码验证成功</div>
      <p class="muted" style="margin-top:8px">你们会分别独立完成同一套 36 道题，<br>答完就能看到属于你们俩的关系报告。</p>
    </div>
    <div class="card nickname-card">
      <label class="muted">怎么称呼你？</label>
      <input id="nick" maxlength="12" placeholder="写个昵称吧" value="${nick || ''}">
    </div>
    <button class="btn btn-primary" id="go">开始答题</button>
    <p class="footer-note">娱乐向测试，非心理评估 · 双星记</p>
  </section>`;
  $('#go').onclick = () => quiz({ testId, token, role: 'friend', nickname: $('#nick').value.trim() || '小熊', resume: false });
}

// ---------- 错误页 ----------
function renderError(title, msg) {
  app.innerHTML = `
  <section class="page active">
    <div class="wait-hero">
      <div class="bear-wrap" style="margin-bottom:8px">${bear('#B9B2A9', '#F1EDE7', 86)}</div>
      <div class="wait-title">${title}</div>
      <p class="muted" style="margin-top:8px">${msg}</p>
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
