/**
 * 软件设计师模拟考试系统 · 前端单页应用（原生 JS，无构建）。
 *
 * 路由：#/ 首页 | #/exam/:id 考试 | #/result/:id 成绩 | #/history 历史
 */

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const modalRoot = document.getElementById('modal-root');

const LETTERS = 'ABCDE';
// 页面基路径：直接在根路径（/）或子路径（/exam/）下都能正确请求接口
const PAGE_BASE = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
const TYPE_NAME = {
  single: '单选题',
  multi: '多选题',
  fill: '填空题',
  tf: '判断题',
  subjective: '主观题',
};
const TYPE_TAG = {
  single: 'tag',
  multi: 'tag orange',
  fill: 'tag green',
  tf: 'tag gray',
  subjective: 'tag red',
};

const state = {
  meta: null,
  examId: null,
  exam: null, // GET /api/exams/:id 的响应
  current: 0,
  flags: new Set(),
  timerId: null,
  deadline: 0,
  timeUp: false,
  saveTimers: new Map(),
  resultFilter: 'all',
};

/* ───────────────────────── 工具函数 ───────────────────────── */

async function api(path, opts = {}) {
  const res = await fetch(PAGE_BASE + path.replace(/^\//, ''), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 空响应体 */
  }
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, kind = '') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => (toastEl.className = 'toast'), 2200);
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${sss}` : `${mm}:${sss}`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
}

function answered(q) {
  if (q.type === 'subjective') return typeof q.userAnswer === 'string' && q.userAnswer.trim() !== '';
  return Array.isArray(q.userAnswer) && q.userAnswer.filter((x) => String(x ?? '').trim()).length > 0;
}

function clearTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function showModal(html, onMount) {
  modalRoot.innerHTML = `<div class="modal-mask"><div class="modal">${html}</div></div>`;
  const mask = modalRoot.firstElementChild;
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeModal();
  });
  if (onMount) onMount(mask.querySelector('.modal'));
}

function closeModal() {
  modalRoot.innerHTML = '';
}

/* ───────────────────────── 路由 ───────────────────────── */

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

async function route() {
  clearTimer();
  const hash = location.hash || '#/';
  const examMatch = hash.match(/^#\/exam\/(\d+)/);
  const resultMatch = hash.match(/^#\/result\/(\d+)/);
  const practiceMatch = hash.match(/^#\/practice\/(basic|application)/);

  document.querySelectorAll('.app-nav a').forEach((a) => a.classList.remove('active'));
  try {
    if (practiceMatch) {
      await renderPractice(practiceMatch[1]);
    } else if (examMatch) {
      await renderExam(Number(examMatch[1]));
    } else if (resultMatch) {
      await renderResult(Number(resultMatch[1]));
    } else if (hash.startsWith('#/history')) {
      document.querySelector('[data-nav="history"]')?.classList.add('active');
      await renderHistory();
    } else {
      document.querySelector('[data-nav="home"]')?.classList.add('active');
      await renderHome();
    }
  } catch (err) {
    app.innerHTML = `<div class="card empty">页面加载失败：${escapeHtml(err.message)}<br><br><button class="btn" onclick="location.hash='#/'">返回首页</button></div>`;
  }
}

/* ───────────────────────── 首页 ───────────────────────── */

async function renderHome() {
  const [meta, history] = await Promise.all([
    api('/api/meta'),
    api('/api/exams?limit=5'),
  ]);
  state.meta = meta;
  const t = meta.byType || {};
  const total = meta.total || 0;

  const modeCards = (meta.modes || [])
    .map(
      (m) => `
      <div class="mode-card">
        <h3>${escapeHtml(m.name)}</h3>
        <div class="mode-desc">${escapeHtml(m.desc)}</div>
        <div class="mode-meta">
          <span>⏱ ${Math.round(m.durationSec / 60)} 分钟</span>
          <span>📝 ${m.key === 'morning' ? '75 题' : m.key === 'afternoon' ? '5 题' : '85 题'}</span>
        </div>
        <button class="btn block" data-start="${m.key}">开始考试</button>
      </div>`,
    )
    .join('');

  const active = meta.activeExam;
  const resumeHtml = active
    ? `<div class="resume-banner">
         <div>检测到一场进行中的考试：<b>${escapeHtml(active.modeName)}</b>（第 ${active.id} 场）</div>
         <div style="display:flex;gap:8px">
           <a class="btn sm" href="#/exam/${active.id}">继续作答</a>
           <button class="btn sm ghost" data-abort="${active.id}">放弃本场</button>
         </div>
       </div>`
    : '';

  const practiceHtml = `
    <div class="section-head"><h2>练习模式</h2><span style="font-size:12px;color:var(--text-3)">做完一题即看答案解析 · 整库循环出题不重复</span></div>
    <div class="modes practice-modes">
      <div class="mode-card">
        <h3>基础知识练习</h3>
        <div class="mode-desc">单选 / 多选 / 填空 / 判断随机出题，点「下一题」立即显示答案与解析；整库抽完自动开启下一轮。</div>
        <div class="mode-meta"><span>题库 ${(t.single || 0) + (t.multi || 0) + (t.fill || 0) + (t.tf || 0)} 题</span><span>无限循环</span></div>
        <button class="btn block" data-practice="basic">开始练习</button>
      </div>
      <div class="mode-card">
        <h3>应用技术练习</h3>
        <div class="mode-desc">下午案例题（数据流图 / 数据库 / UML / 算法 / 程序设计）随机出题，作答后对照参考答案与评分要点。</div>
        <div class="mode-meta"><span>题库 ${t.subjective || 0} 题</span><span>无限循环</span></div>
        <button class="btn block" data-practice="application">开始练习</button>
      </div>
    </div>`;

  const papers = meta.papers || [];
  const realCount = papers.reduce((s, p) => s + p.n, 0);
  const papersHtml = papers.length
    ? `<div class="section-head"><h2>历年真题（完整成套）</h2><span style="font-size:12px;color:var(--text-3)">共 ${realCount} 题</span></div>
       <div class="papers">${papers.map((p) => `
         <div class="paper-item">
           <div class="p-main">
             <div class="p-title">${escapeHtml(p.paper_title || p.paper)}</div>
             <div class="p-sub">${p.n} 道单选题 · 150 分钟 · 75 分 · 使用官方试卷原题</div>
           </div>
           <button class="btn sm" data-start-real="${escapeHtml(p.paper)}">开始真题模考</button>
         </div>`).join('')}
       </div>`
    : '';

  const historyHtml = (history.exams || []).length
    ? `<div class="history-list">${history.exams.map(historyItemHtml).join('')}</div>`
    : `<div class="card empty">还没有考试记录，点击上方「开始考试」来一场模拟吧。</div>`;

  app.innerHTML = `
    <section class="hero">
      <h1>软件设计师 · 全真模拟考试</h1>
      <p>软考中级「软件设计师」模拟考场：倒计时、答题卡、未答拦截、自动评分、主观题标准答案与自评，全部本地运行，手机/电脑均可访问。</p>
      <div class="hero-stats">
        <span class="chip"><b>${total}</b>题库总量</span>
        <span class="chip"><b>${(t.single || 0)}</b>单选</span>
        <span class="chip"><b>${(t.multi || 0)}</b>多选</span>
        <span class="chip"><b>${(t.fill || 0)}</b>填空</span>
        <span class="chip"><b>${(t.tf || 0)}</b>判断</span>
        <span class="chip"><b>${(t.subjective || 0)}</b>主观题</span>
        ${realCount ? `<span class="chip"><b>${realCount}</b>历年真题</span>` : ''}
      </div>
    </section>
    ${resumeHtml}
    <div class="section-head"><h2>选择考试模式</h2></div>
    <div class="modes">${modeCards}</div>
    ${practiceHtml}
    ${papersHtml}
    <div class="section-head"><h2>最近考试</h2><a href="#/history" style="font-size:13px">全部记录 →</a></div>
    ${historyHtml}
    <p style="margin-top:26px;font-size:12px;color:var(--text-3);text-align:center">
      局域网访问地址：${escapeHtml(meta.lanUrl || '')} ｜ 端口 ${meta.port || ''}
    </p>
  `;

  app.querySelectorAll('[data-practice]').forEach((btn) =>
    btn.addEventListener('click', () => {
      location.hash = `#/practice/${btn.dataset.practice}`;
    }),
  );
  app.querySelectorAll('[data-start]').forEach((btn) =>
    btn.addEventListener('click', () => startExam(btn.dataset.start)),
  );
  app.querySelectorAll('[data-start-real]').forEach((btn) =>
    btn.addEventListener('click', () => startExam('real', btn.dataset.startReal)),
  );
  app.querySelectorAll('[data-abort]').forEach((btn) =>
    btn.addEventListener('click', () => abortExam(Number(btn.dataset.abort), true)),
  );
  app.querySelectorAll('[data-view]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('[data-retake]')) return;
      location.hash = `#/result/${el.dataset.view}`;
    }),
  );
  app.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteExam(Number(btn.dataset.del));
    }),
  );
  app.querySelectorAll('[data-retake]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      retakeExam(Number(btn.dataset.retake));
    }),
  );
}

async function startExam(mode, paper) {
  try {
    const r = await api('/api/exams', {
      method: 'POST',
      body: JSON.stringify(paper ? { mode, paper } : { mode }),
    });
    location.hash = `#/exam/${r.examId}`;
  } catch (err) {
    if (err.status === 409 && err.data?.examId) {
      const examId = err.data.examId;
      showModal(
        `<h3>已有进行中的考试</h3>
         <p>同一时间只允许一场考试。你可以继续上次的考试，或放弃后重新开始。</p>
         <div class="modal-actions">
           <button class="btn ghost" data-m="abort">放弃并开始新考试</button>
           <button class="btn" data-m="resume">继续上次考试</button>
         </div>`,
        (modal) => {
          modal.querySelector('[data-m="resume"]').onclick = () => {
            closeModal();
            location.hash = `#/exam/${examId}`;
          };
          modal.querySelector('[data-m="abort"]').onclick = async () => {
            closeModal();
            await abortExam(examId, false);
            startExam(mode, paper);
          };
        },
      );
    } else {
      toast(err.message, 'err');
    }
  }
}

async function abortExam(examId, goHome) {
  try {
    await api(`/api/exams/${examId}/abort`, { method: 'POST' });
    toast('已放弃本场考试', 'ok');
    if (goHome) route();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteExam(examId) {
  showModal(
    `<h3>删除考试记录</h3><p>确定删除这场考试记录吗？删除后不可恢复。</p>
     <div class="modal-actions"><button class="btn ghost" data-m="no">取消</button><button class="btn danger" data-m="yes">删除</button></div>`,
    (modal) => {
      modal.querySelector('[data-m="no"]').onclick = closeModal;
      modal.querySelector('[data-m="yes"]').onclick = async () => {
        closeModal();
        try {
          await api(`/api/exams/${examId}`, { method: 'DELETE' });
          toast('已删除', 'ok');
          route();
        } catch (err) {
          toast(err.message, 'err');
        }
      };
    },
  );
}

/* ───────────────────────── 考试页 ───────────────────────── */

async function renderExam(examId) {
  const data = await api(`/api/exams/${examId}`);
  if (data.status === 'submitted') {
    location.hash = `#/result/${examId}`;
    return;
  }
  if (data.status === 'aborted') {
    toast('该考试已放弃', 'err');
    location.hash = '#/';
    return;
  }
  state.examId = examId;
  state.exam = data;
  state.current = 0;
  state.flags = new Set();
  state.timeUp = false;

  app.innerHTML = `
    <div class="exam-page">
      <div class="exam-header">
        <div class="exam-title">${escapeHtml(data.exam.title)}</div>
        <div class="exam-timer">
          <span class="label">剩余时间</span>
          <span class="clock" id="clock">--:--</span>
        </div>
        <div class="exam-progress" id="progress"></div>
        <button class="btn danger" id="btn-submit">交卷</button>
      </div>
      <div class="exam-body">
        <div>
          <div class="question-card" id="question-card"></div>
          <div class="exam-footer">
            <button class="btn ghost" id="btn-prev">上一题</button>
            <button class="btn ghost" id="btn-flag">标记本题</button>
            <button class="btn" id="btn-next">下一题</button>
          </div>
        </div>
        <aside class="answer-sheet">
          <div class="sheet-card">
            <h3>答题卡 <span class="tag gray" id="sheet-count"></span></h3>
            <div class="sheet-legend">
              <span><i style="background:var(--primary)"></i>已答</span>
              <span><i style="background:#fff;border:1px solid #d5dde7"></i>未答</span>
              <span><i style="background:var(--accent)"></i>标记</span>
            </div>
            <div class="sheet-sections" id="sheet-sections"></div>
            <div class="sheet-hint">点击题号可快速跳转。倒计时结束后将自动交卷。</div>
          </div>
        </aside>
      </div>
      <button class="sheet-toggle" id="sheet-toggle"><b id="sheet-toggle-n">0</b>答题卡</button>
    </div>
  `;

  document.getElementById('btn-prev').onclick = () => goTo(state.current - 1);
  document.getElementById('btn-next').onclick = () => goTo(state.current + 1);
  document.getElementById('btn-flag').onclick = toggleFlag;
  document.getElementById('btn-submit').onclick = handleSubmit;
  document.getElementById('sheet-toggle').onclick = openSheetDrawer;

  renderSheet();
  renderQuestion();
  updateProgress();
  startTimer(data.remainingSec);
}

function startTimer(remainingSec) {
  state.deadline = Date.now() + remainingSec * 1000;
  tickClock();
  state.timerId = setInterval(tickClock, 1000);
}

function tickClock() {
  const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
  const clock = document.getElementById('clock');
  if (clock) {
    clock.textContent = fmtClock(left);
    clock.classList.toggle('warn', left <= 300);
  }
  if (left <= 0 && !state.timeUp) {
    state.timeUp = true;
    clearTimer();
    forceSubmit();
  }
}

function questions() {
  return state.exam?.questions || [];
}

function currentQ() {
  return questions()[state.current];
}

function goTo(idx) {
  const list = questions();
  if (idx < 0 || idx >= list.length) return;
  if (idx === state.current) return;
  flushPendingSaves();
  state.current = idx;
  renderQuestion();
  renderSheet();
  updateProgress();
}

function renderQuestion() {
  const card = document.getElementById('question-card');
  if (!card) return;
  const q = currentQ();
  if (!q) return;
  const list = questions();
  const no = q.seq;
  const flagged = state.flags.has(no);

  let body = '';
  if (q.type === 'single' || q.type === 'multi' || q.type === 'tf') {
    const opts = q.type === 'tf' ? ['对', '错'] : q.options || [];
    body = `<div class="q-options">${opts
      .map((text, i) => {
        const key = q.type === 'tf' ? text : LETTERS[i];
        const selected =
          q.type === 'tf'
            ? (q.userAnswer || [])[0] === key
            : (q.userAnswer || []).includes(key);
        const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
        return `<label class="option ${selected ? 'selected' : ''}" data-opt="${escapeHtml(key)}">
            <input type="${inputType}" name="q${no}" value="${escapeHtml(key)}" ${selected ? 'checked' : ''}>
            ${q.type !== 'tf' ? `<span class="opt-key">${key}</span>` : ''}
            <span class="opt-text">${escapeHtml(text)}</span>
          </label>`;
      })
      .join('')}</div>`;
  } else if (q.type === 'fill') {
    const n = q.blankCount || (q.userAnswer || []).length || 1;
    body = `<div class="fill-list">${Array.from({ length: n }, (_, i) => {
      const v = (q.userAnswer || [])[i] || '';
      return `<div class="fill-item"><label>第 ${i + 1} 空</label>
        <input data-blank="${i}" value="${escapeHtml(v)}" placeholder="请输入答案" autocomplete="off"></div>`;
    }).join('')}</div>`;
  } else {
    const text = typeof q.userAnswer === 'string' ? q.userAnswer : '';
    body = `<textarea class="subjective-input" id="subjective-input" placeholder="请在此作答（可分段书写）……">${escapeHtml(text)}</textarea>
      <div class="subjective-hint"><span>主观题不自动评分，交卷后对照参考答案自评</span><span id="char-count">${text.length} 字</span></div>`;
  }

  card.innerHTML = `
    <div class="q-head">
      <span class="q-index">第 ${no} 题</span>
      <span class="${TYPE_TAG[q.type] || 'tag'}">${TYPE_NAME[q.type] || q.type}</span>
      ${q.section ? `<span class="tag gray">${escapeHtml(q.section)}</span>` : ''}
      <span class="tag gray">${q.score} 分</span>
      ${q.knowledge ? `<span class="tag gray">考点：${escapeHtml(q.knowledge)}</span>` : ''}
      ${flagged ? '<span class="tag orange">已标记</span>' : ''}
      <span style="margin-left:auto;font-size:12px;color:var(--text-3)">${state.current + 1} / ${list.length}</span>
    </div>
    <div class="q-stem">${escapeHtml(q.stem)}</div>
    ${body}
  `;

  // 绑定作答事件
  if (q.type === 'single' || q.type === 'multi' || q.type === 'tf') {
    card.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        const values = [...card.querySelectorAll('input:checked')].map((i) => i.value);
        const answer = values.length ? values.sort() : null;
        applyAnswer(q, answer);
        card.querySelectorAll('.option').forEach((lab) => {
          const inp = lab.querySelector('input');
          lab.classList.toggle('selected', inp.checked);
        });
      });
    });
  } else if (q.type === 'fill') {
    const inputs = [...card.querySelectorAll('input[data-blank]')];
    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const values = inputs.map((i) => i.value);
        const answer = values.some((v) => v.trim()) ? values : null;
        scheduleSave(q, answer);
        updateProgress();
      });
    });
  } else if (q.type === 'subjective') {
    const ta = card.querySelector('#subjective-input');
    const counter = card.querySelector('#char-count');
    ta.addEventListener('input', () => {
      counter.textContent = `${ta.value.length} 字`;
      scheduleSave(q, ta.value.trim() ? ta.value : null);
      updateProgress();
    });
  }
}

function applyAnswer(q, answer) {
  q.userAnswer = answer;
  updateProgress();
  renderSheet();
  persistAnswer(q, answer);
}

function scheduleSave(q, answer) {
  q.userAnswer = answer;
  renderSheet();
  clearTimeout(state.saveTimers.get(q.seq));
  state.saveTimers.set(
    q.seq,
    setTimeout(() => {
      state.saveTimers.delete(q.seq);
      persistAnswer(q, q.userAnswer);
    }, 400),
  );
}

function flushPendingSaves() {
  for (const [seq, timer] of state.saveTimers.entries()) {
    clearTimeout(timer);
    state.saveTimers.delete(seq);
    const q = questions().find((x) => x.seq === seq);
    if (q) persistAnswer(q, q.userAnswer, true);
  }
}

async function persistAnswer(q, answer, silent = false) {
  try {
    await api(`/api/exams/${state.examId}/answers`, {
      method: 'PATCH',
      body: JSON.stringify({ seq: q.seq, answer }),
    });
  } catch (err) {
    if (err.status === 409) {
      // 服务端已到期并强制交卷
      clearTimer();
      toast('考试时间已到，系统已自动交卷', 'err');
      setTimeout(() => (location.hash = `#/result/${state.examId}`), 600);
      return;
    }
    if (!silent) toast(`保存失败：${err.message}`, 'err');
  }
}

function toggleFlag() {
  const q = currentQ();
  if (!q) return;
  if (state.flags.has(q.seq)) state.flags.delete(q.seq);
  else state.flags.add(q.seq);
  renderQuestion();
  renderSheet();
}

function updateProgress() {
  const list = questions();
  const done = list.filter(answered).length;
  const el = document.getElementById('progress');
  if (el) el.innerHTML = `已答 <b>${done}</b> / ${list.length}`;
  const toggle = document.getElementById('sheet-toggle-n');
  if (toggle) toggle.textContent = `${done}/${list.length}`;
  const count = document.getElementById('sheet-count');
  if (count) count.textContent = `${done}/${list.length}`;
}

function renderSheet() {
  const wrap = document.getElementById('sheet-sections');
  if (!wrap) return;
  const list = questions();
  const sections = [];
  for (const q of list) {
    const title = q.section || '试题';
    let g = sections.find((s) => s.title === title);
    if (!g) {
      g = { title, items: [] };
      sections.push(g);
    }
    g.items.push(q);
  }
  wrap.innerHTML = sections
    .map(
      (sec) => `
      <div class="sheet-sec-title">${escapeHtml(sec.title)}</div>
      <div class="sheet-grid">${sec.items
        .map((q) => {
          const idx = list.indexOf(q);
          const cls = [
            'sheet-btn',
            answered(q) ? 'answered' : '',
            idx === state.current ? 'current' : '',
            state.flags.has(q.seq) ? 'flagged' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `<button class="${cls}" data-jump="${idx}">${q.seq}</button>`;
        })
        .join('')}</div>`,
    )
    .join('');
  wrap.querySelectorAll('[data-jump]').forEach((btn) =>
    btn.addEventListener('click', () => {
      goTo(Number(btn.dataset.jump));
      closeSheetDrawer();
    }),
  );
}

function openSheetDrawer() {
  const sections = document.getElementById('sheet-sections');
  if (!sections) return;
  const drawer = document.createElement('div');
  drawer.className = 'modal-mask';
  drawer.innerHTML = `<div class="sheet-drawer">
      <h3 style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span>答题卡</span><button class="btn sm ghost" data-close>收起</button>
      </h3>
      <div class="sheet-drawer-body"></div>
    </div>`;
  drawer.querySelector('.sheet-drawer-body').appendChild(sections.cloneNode(true));
  drawer.querySelector('[data-close]').onclick = () => drawer.remove();
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.remove();
    const btn = e.target.closest('[data-jump]');
    if (btn) {
      goTo(Number(btn.dataset.jump));
      drawer.remove();
    }
  });
  document.body.appendChild(drawer);
}

function closeSheetDrawer() {
  document.querySelectorAll('.modal-mask .sheet-drawer').forEach((d) => d.parentElement.remove());
}

/* ───────────────────────── 交卷 ───────────────────────── */

function handleSubmit() {
  const list = questions();
  const unanswered = list.filter((q) => !answered(q));
  if (unanswered.length) {
    showUnanswered(unanswered.map((q) => q.seq));
    return;
  }
  showModal(
    `<h3>确认交卷</h3>
     <p>所有 ${list.length} 道题均已作答。交卷后将立即评分，且不能再修改答案。</p>
     <div class="modal-actions"><button class="btn ghost" data-m="no">再检查一下</button><button class="btn" data-m="yes">确认交卷</button></div>`,
    (modal) => {
      modal.querySelector('[data-m="no"]').onclick = closeModal;
      modal.querySelector('[data-m="yes"]').onclick = () => {
        closeModal();
        doSubmit(false);
      };
    },
  );
}

function showUnanswered(seqs) {
  showModal(
    `<h3>还有 ${seqs.length} 题未作答</h3>
     <p>考试要求全部作答后才能交卷，请点击题号前往作答：</p>
     <div class="unanswered-list">${seqs.slice(0, 200).map((s) => `<button data-go="${s}">第 ${s} 题</button>`).join('')}</div>
     <div class="modal-actions"><button class="btn ghost" data-m="close">继续作答</button></div>`,
    (modal) => {
      modal.querySelector('[data-m="close"]').onclick = closeModal;
      modal.querySelectorAll('[data-go]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const idx = questions().findIndex((q) => q.seq === Number(btn.dataset.go));
          closeModal();
          if (idx >= 0) goTo(idx);
        }),
      );
    },
  );
}

async function doSubmit(force) {
  flushPendingSaves();
  try {
    await api(`/api/exams/${state.examId}/submit`, { method: 'POST' });
    clearTimer();
    toast('交卷成功，正在评分…', 'ok');
    location.hash = `#/result/${state.examId}`;
  } catch (err) {
    if (err.status === 422 && !force) {
      showUnanswered(err.data?.unanswered || []);
    } else if (err.status === 409) {
      location.hash = `#/result/${state.examId}`;
    } else {
      toast(err.message, 'err');
    }
  }
}

async function forceSubmit() {
  toast('考试时间到，正在强制交卷…', 'err');
  try {
    await api(`/api/exams/${state.examId}/submit`, { method: 'POST' });
  } catch {
    // 服务端已到期自动交卷；读取一次以触发/确认
    try {
      await api(`/api/exams/${state.examId}`);
    } catch {
      /* 忽略 */
    }
  }
  clearTimer();
  setTimeout(() => (location.hash = `#/result/${state.examId}`), 300);
}

/* ───────────────────────── 成绩页 ───────────────────────── */

async function renderResult(examId) {
  const data = await api(`/api/exams/${examId}/result`);
  if (data.status === 'in_progress') {
    location.hash = `#/exam/${examId}`;
    return;
  }
  const e = data.exam;
  const subjective = data.subjective;
  const allGraded = subjective.total === 0 || subjective.graded === subjective.total;
  const pass = e.totalScore != null && e.totalScore >= data.passLine;

  const used = e.submittedAt ? e.submittedAt - e.startedAt : null;

  const subjectiveCard = subjective.total
    ? `<div class="score-box"><b>${subjective.score ?? 0}</b><span>主观题得分（${subjective.graded}/${subjective.total} 题已评）</span></div>`
    : '';

  const items = data.questions || [];
  const filtered = state.resultFilter === 'wrong' ? items.filter((q) => q.isCorrect === 0) : items;

  app.innerHTML = `
    <div class="result-hero">
      <div class="result-score">
        <b>${e.totalScore ?? 0}</b>
        <span>总分 / 满分 ${e.maxScore ?? ''}</span>
      </div>
      <div class="result-info">
        <h2>${escapeHtml(e.title)}</h2>
        <div class="meta-row">
          <span>${escapeHtml(e.modeName)}</span>
          <span>交卷时间 ${fmtDate(e.submittedAt)}</span>
          <span>用时 ${fmtDuration(used)}</span>
          ${e.autoSubmitted ? '<span>⏰ 超时自动交卷</span>' : ''}
          <span>合格线 ${data.passLine} 分</span>
        </div>
        <div class="pass-badge ${pass ? 'pass' : 'fail'}">${pass ? '✓ 达到合格线' : '未达到合格线'}</div>
      </div>
    </div>
    <div class="score-grid">
      <div class="score-box"><b>${e.objectiveScore ?? 0}</b><span>客观题得分</span></div>
      ${subjectiveCard}
      <div class="score-box"><b>${items.filter((q) => q.isCorrect === 1).length}</b><span>答对题数</span></div>
      <div class="score-box"><b>${items.length}</b><span>总题数</span></div>
    </div>
    ${subjective.total ? `<div class="card" style="padding:16px 18px;margin-bottom:16px;font-size:14px;color:var(--text-2)">
        ${allGraded ? '✅ 主观题已全部自评。' : '📝 主观题未自动评分，请对照下方参考答案与评分要点，为每道主观题打分（0–15 分）。'}
      </div>` : ''}
    <div class="review-toolbar">
      <button class="btn sm" id="btn-retake">重做这套试卷</button>
      <button class="btn sm ${state.resultFilter === 'all' ? '' : 'ghost'}" data-filter="all">全部题目</button>
      <button class="btn sm ${state.resultFilter === 'wrong' ? '' : 'ghost'}" data-filter="wrong">只看错题</button>
      <a class="btn sm ghost" href="#/history" style="margin-left:auto">返回历史记录</a>
    </div>
    <div id="review-list"></div>
  `;

  document.getElementById('btn-retake').onclick = () => retakeExam(examId);
  app.querySelectorAll('[data-filter]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.resultFilter = btn.dataset.filter;
      renderResult(examId);
    }),
  );

  const listEl = document.getElementById('review-list');
  listEl.innerHTML = filtered.length
    ? filtered.map(reviewItemHtml).join('')
    : '<div class="card empty">没有符合条件的题目。</div>';

  bindGradeInputs(items, examId);
}

function optionLine(q, idx, correctSet, userSet) {
  const key = LETTERS[idx];
  const isCorrect = correctSet.has(key);
  const isUser = userSet.has(key);
  let cls = 'option';
  if (isCorrect) cls += ' correct';
  else if (isUser) cls += ' wrong';
  return `<div class="${cls}">
      <span class="opt-key">${key}</span>
      <span class="opt-text">${escapeHtml(q.options?.[idx] ?? '')}</span>
      ${isCorrect ? '<span class="tag green" style="margin-left:auto">正确答案</span>' : ''}
      ${isUser && !isCorrect ? '<span class="tag red" style="margin-left:auto">你的选择</span>' : ''}
    </div>`;
}

function reviewItemHtml(q) {
  const type = TYPE_NAME[q.type] || q.type;
  const correctSet = new Set((q.answer || []).map((x) => String(x).toUpperCase()));
  const userSet = new Set((Array.isArray(q.userAnswer) ? q.userAnswer : []).map((x) => String(x).toUpperCase()));

  let badge = '';
  if (q.type !== 'subjective') {
    badge = q.isCorrect
      ? '<span class="tag green">答对</span>'
      : '<span class="tag red">答错</span>';
  } else {
    badge = q.graded ? `<span class="tag green">已评 ${q.awarded} 分</span>` : '<span class="tag orange">待自评</span>';
  }

  let body = '';
  if (q.type === 'single' || q.type === 'multi') {
    body = `<div class="q-options">${(q.options || []).map((_, i) => optionLine(q, i, correctSet, userSet)).join('')}</div>`;
  } else if (q.type === 'tf') {
    body = `<div class="review-answer-row"><span class="k">正确答案</span><span class="answer-good">${escapeHtml((q.answer || [])[0] || '')}</span>
      <span class="k">你的答案</span><span class="${q.isCorrect ? 'answer-good' : 'answer-bad'}">${escapeHtml((q.userAnswer || [])[0] || '未作答')}</span></div>`;
  } else if (q.type === 'fill') {
    body = `<div class="review-answer-row" style="flex-direction:column;align-items:flex-start;gap:6px">
      ${(q.answer || []).map((ans, i) => {
        const mine = (q.userAnswer || [])[i] || '未作答';
        const ok = String(mine).trim().toLowerCase() === String(ans).split('|')[0].trim().toLowerCase();
        return `<div><span class="k">第 ${i + 1} 空</span>
          <span class="${ok ? 'answer-good' : 'answer-bad'}">你的答案：${escapeHtml(mine)}</span>
          <span style="margin-left:14px;color:var(--text-2)">参考答案：${escapeHtml(String(ans).split('|').join(' / '))}</span></div>`;
      }).join('')}</div>`;
  }

  const refAnswer = q.type === 'subjective'
    ? `<div class="subjective-block">
        <h4>你的作答</h4>
        <div class="ref-answer">${escapeHtml(typeof q.userAnswer === 'string' && q.userAnswer.trim() ? q.userAnswer : '（未作答）')}</div>
        <h4 style="margin-top:14px">参考答案</h4>
        <div class="ref-answer">${escapeHtml(Array.isArray(q.answer) ? q.answer.join('\n') : q.answer || '')}</div>
        ${q.rubric?.length ? `<h4 style="margin-top:14px">评分要点</h4><ul class="rubric">${q.rubric.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        <div class="grade-row">
          <span>自评得分（0–${q.score} 分）：</span>
          <input type="number" min="0" max="${q.score}" step="1" value="${q.awarded ?? ''}" data-grade="${q.seq}">
          <span class="score-saved">${q.graded ? '已保存' : ''}</span>
        </div>
      </div>`
    : '';

  return `<div class="review-item">
    <div class="r-head">
      <span class="q-index">第 ${q.seq} 题</span>
      <span class="${TYPE_TAG[q.type] || 'tag'}">${type}</span>
      ${q.section ? `<span class="tag gray">${escapeHtml(q.section)}</span>` : ''}
      <span class="tag gray">${q.score} 分</span>
      ${badge}
    </div>
    <div class="q-stem">${escapeHtml(q.stem)}</div>
    ${body}
    ${q.explanation ? `<div class="explain"><b>解析：</b>${escapeHtml(q.explanation)}</div>` : ''}
    ${refAnswer}
  </div>`;
}

function bindGradeInputs(items, examId) {
  const inputs = [...document.querySelectorAll('[data-grade]')];
  if (!inputs.length) return;
  const save = async () => {
    const scores = inputs
      .filter((inp) => inp.value !== '')
      .map((inp) => ({ seq: Number(inp.dataset.grade), score: Number(inp.value) }));
    if (!scores.length) {
      toast('请至少填写一道主观题的分数', 'err');
      return;
    }
    try {
      const r = await api(`/api/exams/${examId}/grade-subjective`, {
        method: 'POST',
        body: JSON.stringify({ scores }),
      });
      toast(`已保存，总分 ${r.totalScore} 分`, 'ok');
      renderResult(examId);
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  const btn = document.createElement('div');
  btn.style.cssText = 'display:flex;justify-content:flex-end;margin:4px 0 18px';
  btn.innerHTML = '<button class="btn" id="btn-save-grade">保存主观题评分</button>';
  btn.querySelector('button').onclick = save;
  document.getElementById('review-list').prepend(btn);
}

/* ───────────────────────── 历史页 ───────────────────────── */

async function renderHistory() {
  const { exams } = await api('/api/exams?limit=200');
  const rows = exams || [];
  app.innerHTML = `
    <h1 class="page-title">历史考试记录</h1>
    <p class="page-sub">共 ${rows.length} 场考试。点击记录可查看成绩详情、主观题得分与逐题解析。</p>
    <div class="history-list history-full">
      ${rows.length ? rows.map(historyItemHtml).join('') : '<div class="card empty">暂无考试记录。</div>'}
    </div>
  `;
  app.querySelectorAll('[data-view]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      location.hash = `#/result/${el.dataset.view}`;
    }),
  );
  app.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteExam(Number(btn.dataset.del));
    }),
  );
  app.querySelectorAll('[data-retake]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      retakeExam(Number(btn.dataset.retake));
    }),
  );
}

function historyItemHtml(e) {
  const statusTag =
    e.status === 'submitted'
      ? `<span class="tag ${e.autoSubmitted ? 'orange' : 'green'}">${e.autoSubmitted ? '超时交卷' : '已交卷'}</span>`
      : e.status === 'aborted'
        ? '<span class="tag gray">已放弃</span>'
        : '<span class="tag orange">进行中</span>';
  const score = e.status === 'submitted' ? (e.totalScore ?? 0) : '—';
  return `<div class="history-item" data-view="${e.id}" style="cursor:pointer">
      <div class="h-main">
        <div class="h-title">${escapeHtml(e.title || e.modeName)} ${statusTag}</div>
        <div class="h-sub">
          ${fmtDate(e.startedAt)} ｜ 客观 ${e.objectiveScore ?? '—'} 分
          ${e.subjectiveScore != null ? ` ｜ 主观 ${e.subjectiveScore} 分` : ''}
          ｜ 满分 ${e.maxScore ?? ''} 分
        </div>
      </div>
      <div class="h-score">${score}<small>分</small></div>
      <div class="history-actions">
        <a class="btn sm ghost" href="#/result/${e.id}">查看</a>
        <button class="btn sm ghost" data-retake="${e.id}">重做</button>
        <button class="btn sm ghost" data-del="${e.id}">删除</button>
      </div>
    </div>`;
}

/* ───────────────────────── 练习模式 ───────────────────────── */

let practice = { mode: 'basic', question: null, progress: null, revealed: false, answer: null, pos: 0, nextPos: 1 };

function practicePosKey(mode) {
  return 'practicePos:' + mode;
}

async function renderPractice(mode) {
  practice = {
    mode,
    question: null,
    progress: null,
    revealed: false,
    answer: null,
    pos: Number(localStorage.getItem(practicePosKey(mode)) || 0),
    nextPos: 1,
  };
  const title = mode === 'basic' ? '基础知识练习' : '应用技术练习';
  app.innerHTML = `
    <div class="exam-page">
      <div class="exam-header">
        <div class="exam-title">练习模式 · ${title}</div>
        <div class="exam-progress" id="practice-progress">加载中…</div>
        <a class="btn ghost sm" href="#/">退出练习</a>
      </div>
      <div class="question-card" id="practice-card"><div class="empty">正在抽题…</div></div>
      <div id="practice-answer"></div>
      <div class="exam-footer">
        <button class="btn" id="btn-practice-next">下一题</button>
      </div>
    </div>`;
  document.getElementById('btn-practice-next').onclick = practiceNext;
  await loadPracticeQuestion();
}

async function loadPracticeQuestion() {
  const d = await api('/api/practice/next?mode=' + practice.mode + '&pos=' + practice.pos);
  practice.question = d.question;
  practice.progress = d.progress;
  practice.nextPos = d.nextPos;
  practice.revealed = false;
  practice.answer = null;
  document.getElementById('practice-answer').innerHTML = '';
  const btn = document.getElementById('btn-practice-next');
  btn.textContent = '下一题';
  btn.classList.remove('success');
  const prog = document.getElementById('practice-progress');
  prog.textContent = `本轮 第 ${d.progress.pos + 1} 题 / 共 ${d.progress.total} 题`;
  renderPracticeCard();
}

function renderPracticeCard() {
  const card = document.getElementById('practice-card');
  const q = practice.question;
  if (!card || !q) return;
  let body = '';
  if (q.type === 'single' || q.type === 'multi' || q.type === 'tf') {
    const opts = q.type === 'tf' ? ['对', '错'] : q.options || [];
    body = `<div class="q-options">${opts
      .map((text, i) => {
        const key = q.type === 'tf' ? text : LETTERS[i];
        const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
        return `<label class="option" data-opt="${escapeHtml(key)}">
            <input type="${inputType}" name="pq" value="${escapeHtml(key)}">
            ${q.type !== 'tf' ? `<span class="opt-key">${key}</span>` : ''}
            <span class="opt-text">${escapeHtml(text)}</span>
          </label>`;
      })
      .join('')}</div>`;
  } else if (q.type === 'fill') {
    const n = q.blankCount || 1;
    body = `<div class="fill-list">${Array.from({ length: n }, (_, i) => `
      <div class="fill-item"><label>第 ${i + 1} 空</label>
        <input data-blank="${i}" placeholder="请输入答案" autocomplete="off"></div>`).join('')}</div>`;
  } else {
    body = `<textarea class="subjective-input" id="practice-text" placeholder="请在此作答……"></textarea>
      <div class="subjective-hint"><span>主观题不自动评分，对照参考答案与评分要点自检</span><span id="practice-count">0 字</span></div>`;
  }

  card.innerHTML = `
    <div class="q-head">
      <span class="q-index">练习题</span>
      <span class="${TYPE_TAG[q.type] || 'tag'}">${TYPE_NAME[q.type] || q.type}</span>
      <span class="tag gray">${q.score} 分</span>
      ${q.knowledge ? `<span class="tag gray">考点：${escapeHtml(q.knowledge)}</span>` : ''}
    </div>
    <div class="q-stem">${escapeHtml(q.stem)}</div>
    ${body}
  `;

  if (q.type === 'single' || q.type === 'multi' || q.type === 'tf') {
    card.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        const values = [...card.querySelectorAll('input:checked')].map((i) => i.value);
        practice.answer = values.length ? values.sort() : null;
        card.querySelectorAll('.option').forEach((lab) => {
          lab.classList.toggle('selected', lab.querySelector('input').checked);
        });
      });
    });
  } else if (q.type === 'fill') {
    const inputs = [...card.querySelectorAll('input[data-blank]')];
    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const values = inputs.map((i) => i.value);
        practice.answer = values.some((v) => v.trim()) ? values : null;
      });
    });
  } else {
    const ta = card.querySelector('#practice-text');
    const counter = card.querySelector('#practice-count');
    ta.addEventListener('input', () => {
      counter.textContent = `${ta.value.length} 字`;
      practice.answer = ta.value.trim() ? ta.value : null;
    });
  }
}

async function practiceNext() {
  if (!practice.question) return;
  const btn = document.getElementById('btn-practice-next');
  if (!practice.revealed) {
    btn.disabled = true;
    try {
      const d = await api('/api/practice/check', {
        method: 'POST',
        body: JSON.stringify({
          mode: practice.mode,
          qid: practice.question.id,
          answer: practice.answer,
        }),
      });
      showPracticeAnswer(d);
      practice.revealed = true;
      btn.textContent = '继续下一题 →';
      btn.classList.add('success');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
    return;
  }
  practice.pos = practice.nextPos;
  localStorage.setItem(practicePosKey(practice.mode), String(practice.pos));
  await loadPracticeQuestion();
}

function showPracticeAnswer(d) {
  const q = practice.question;
  const box = document.getElementById('practice-answer');
  const opts = q.type === 'tf' ? ['对', '错'] : q.options || [];
  const fmt = (arr) => {
    if (!arr || !arr.length) return '未作答';
    if (q.type === 'tf') return arr.join('、');
    if (q.type === 'fill') return arr.map((v) => `「${v}」`).join(' ');
    return arr.map((k) => `${k}. ${opts[LETTERS.indexOf(k)] ?? ''}`).join('<br>');
  };

  let status = '';
  if (q.type === 'subjective') {
    status = '<span class="tag orange">对照参考答案自检</span>';
  } else if (d.correct) {
    status = '<span class="tag green">回答正确</span>';
  } else if (d.type === 'fill' && d.matchedBlanks > 0) {
    status = `<span class="tag orange">部分正确 ${d.matchedBlanks}/${d.totalBlanks} 空（得 ${d.awarded} 分）</span>`;
  } else {
    status = '<span class="tag red">回答错误</span>';
  }

  const yourAnswer = q.type === 'subjective'
    ? escapeHtml(typeof practice.answer === 'string' ? practice.answer : '（未作答）')
    : fmt(practice.answer);

  const refBlock = q.type === 'subjective'
    ? `<h4 style="margin-top:14px;color:var(--primary-dark)">参考答案</h4>
       <div class="ref-answer">${escapeHtml((d.answer || []).join('\n'))}</div>
       ${d.rubric?.length ? `<h4 style="margin-top:12px;color:var(--primary-dark)">评分要点</h4><ul class="rubric">${d.rubric.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}`
    : '';

  box.innerHTML = `<div class="review-item" style="margin-top:14px">
      <div class="r-head"><span class="tag">答案解析</span>${status}</div>
      <div class="review-answer-row"><span class="k">你的答案</span><span>${yourAnswer}</span></div>
      ${q.type !== 'subjective' ? `<div class="review-answer-row"><span class="k">正确答案</span><span class="answer-good">${fmt(d.answer)}</span></div>` : ''}
      ${d.explanation ? `<div class="explain"><b>解析：</b>${escapeHtml(d.explanation)}</div>` : ''}
      ${refBlock}
    </div>`;

  const card = document.getElementById('practice-card');
  card.querySelectorAll('input, textarea').forEach((el) => {
    el.disabled = true;
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ───────────────────────── 重做试卷 ───────────────────────── */

async function retakeExam(examId) {
  try {
    const r = await api(`/api/exams/${examId}/retake`, { method: 'POST' });
    toast('已生成重做试卷', 'ok');
    location.hash = `#/exam/${r.examId}`;
  } catch (err) {
    if (err.status === 409 && err.data?.examId) {
      const activeId = err.data.examId;
      showModal(
        `<h3>已有进行中的考试</h3>
         <p>同一时间只允许一场考试。你可以继续上次的考试，或放弃后重做本套试卷。</p>
         <div class="modal-actions">
           <button class="btn ghost" data-m="abort">放弃并重做本套</button>
           <button class="btn" data-m="resume">继续上次考试</button>
         </div>`,
        (modal) => {
          modal.querySelector('[data-m="resume"]').onclick = () => {
            closeModal();
            location.hash = `#/exam/${activeId}`;
          };
          modal.querySelector('[data-m="abort"]').onclick = async () => {
            closeModal();
            await abortExam(activeId, false);
            retakeExam(examId);
          };
        },
      );
    } else {
      toast(err.message, 'err');
    }
  }
}
