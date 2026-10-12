/* 存钱罐 · 双人记账 —— 业务逻辑（原生 JS + Supabase JS SDK v2） */
'use strict';

// ---------- 小工具 ----------

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function round2(n) { return Math.round(n * 100) / 100; }
function fmt(n) { return '¥' + toNum(n).toFixed(2); }
function fmtSigned(n) {
  const v = toNum(n);
  return (v < 0 ? '-¥' : '¥') + Math.abs(v).toFixed(2);
}
function errMsg(e) { return (e && e.message) ? e.message : String(e); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowMonthId() { return todayStr().slice(0, 7); }
function monthLabel(id) {
  const parts = String(id).split('-');
  return parts[0] + '年' + Number(parts[1] || 0) + '月';
}

function toast(msg, ms) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toast-root').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms || 2600);
}

// ---------- 常量与状态 ----------

const PRESET_CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗'];
const OTHER = '其他';

let sb = null;
const state = {
  settings: null,          // {id, person_a_name, person_b_name, custom_categories}
  months: [],              // 全部月份，按 id 倒序
  activeMonth: null,
  expenses: [],            // 当前 active 月份的支出
  pools: { A: 0, B: 0 },
};

let currentPage = 'home';
let histDetail = null;     // {month, expenses}

const me = () => localStorage.getItem('whoami'); // 'A' | 'B' | null
const customCats = () => (state.settings && Array.isArray(state.settings.custom_categories)) ? state.settings.custom_categories : [];
const nameA = () => (state.settings && state.settings.person_a_name) || 'A';
const nameB = () => (state.settings && state.settings.person_b_name) || 'B';
const personName = p => (p === 'A' ? nameA() : nameB());

// ---------- 启动 ----------

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_KEY === 'undefined' || !SUPABASE_URL || !SUPABASE_KEY) {
    renderConfigNeeded();
    return;
  }
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    showFullscreen(`
      <div class="hero">
        <div class="hero-emoji">📡</div>
        <div class="hero-title">网络不给力</div>
        <div class="hero-sub">Supabase 组件加载失败，请检查网络后重试</div>
        <button class="btn btn-primary btn-big" onclick="location.reload()">重新加载</button>
      </div>`);
    return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  showPage('home');
  try {
    await loadAll();
  } catch (e) {
    $('#page-home').innerHTML = `
      <div class="hero">
        <div class="hero-emoji">😵</div>
        <div class="hero-title">加载失败</div>
        <div class="hero-sub">${esc(errMsg(e))}<br>请检查网络，以及 config.js 里的密钥是否填对</div>
        <button class="btn btn-primary btn-big" onclick="location.reload()">重试</button>
      </div>`;
    return;
  }
  renderPage('home');
  if (!me()) showOnboarding();
  setInterval(silentRefresh, 30000); // 每 30 秒轮询一次
  document.addEventListener('visibilitychange', () => { if (!document.hidden) silentRefresh(); });
}

function renderConfigNeeded() {
  showFullscreen(`
    <div class="hero">
      <div class="hero-emoji">🔑</div>
      <div class="hero-title">还差一步：填写密钥</div>
      <div class="hero-sub" style="text-align:left;max-width:340px;margin-left:auto;margin-right:auto;">
        1. 打开电脑，编辑项目里的 <b>js/config.js</b><br>
        2. 把 Supabase 的 Project URL 和 publishable key 填进去<br>
        3. 重新部署 / 刷新本页面<br><br>
        详细步骤见 README.md 第一节。
      </div>
      <button class="btn btn-primary btn-big" onclick="location.reload()">我已填好，刷新</button>
    </div>`);
}

// ---------- 数据读写 ----------

async function loadAll() {
  const [settingsRes, monthsRes, poolsRes] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1),
    sb.from('months').select('*').order('id', { ascending: false }),
    sb.from('pools').select('*'),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (monthsRes.error) throw monthsRes.error;
  if (poolsRes.error) throw poolsRes.error;

  let settings = settingsRes.data && settingsRes.data[0];
  if (!settings) {
    await sb.from('settings').upsert({ id: 1 });
    settings = { id: 1, person_a_name: 'A', person_b_name: 'B', custom_categories: [] };
  }
  if (!Array.isArray(settings.custom_categories)) settings.custom_categories = [];
  state.settings = settings;

  state.months = monthsRes.data || [];
  state.activeMonth = state.months.find(m => m.status === 'active') || null;

  state.pools = { A: 0, B: 0 };
  (poolsRes.data || []).forEach(p => { state.pools[p.person] = toNum(p.balance); });

  if (state.activeMonth) {
    const { data, error } = await sb.from('expenses')
      .select('*')
      .eq('month_id', state.activeMonth.id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    state.expenses = data || [];
  } else {
    state.expenses = [];
  }
}

// 备用池加减（delta 为正=入池，为负=扣减）
async function adjustPool(person, delta) {
  const { data, error } = await sb.from('pools').select('balance').eq('person', person).single();
  if (error) throw error;
  const nb = round2(toNum(data.balance) + delta);
  const { error: e2 } = await sb.from('pools').update({ balance: nb }).eq('person', person);
  if (e2) throw e2;
  state.pools[person] = nb;
}

// 新自定义分类写入 settings.custom_categories
async function saveCustomCategory(name) {
  const cur = customCats().slice();
  if (PRESET_CATEGORIES.includes(name) || name === OTHER || cur.includes(name)) return;
  cur.push(name);
  const { error } = await sb.from('settings').update({ custom_categories: cur }).eq('id', 1);
  if (error) throw error;
  state.settings.custom_categories = cur;
}

// ---------- 统计 ----------

function statsFor(month, expenses) {
  const s = {
    budgetA: toNum(month.budget_a), budgetB: toNum(month.budget_b),
    spentA: 0, spentB: 0,           // 仅从「本月预算」扣的部分
    spentATotal: 0, spentBTotal: 0, // 含备用池来源的全部支出
    total: 0, cats: {},
  };
  (expenses || []).forEach(e => {
    const amt = toNum(e.amount);
    s.total += amt;
    if (e.person === 'A') s.spentATotal += amt; else s.spentBTotal += amt;
    if (e.source === 'budget') {
      if (e.person === 'A') s.spentA += amt; else s.spentB += amt;
    }
    s.cats[e.category] = (s.cats[e.category] || 0) + amt;
  });
  s.remainA = round2(s.budgetA - s.spentA);
  s.remainB = round2(s.budgetB - s.spentB);
  s.catList = Object.keys(s.cats).map(name => ({ name, amt: s.cats[name] })).sort((a, b) => b.amt - a.amt);
  return s;
}

const currentStats = () => statsFor(state.activeMonth, state.expenses);

// 剩余预算颜色：超支红；剩余 ≤20% 预算（且 >0）黄
function remainCls(remain, budget) {
  if (remain < 0) return 'danger';
  if (remain > 0 && budget > 0 && remain <= budget * 0.2) return 'warn';
  return '';
}

// ---------- 页面切换 ----------

function showPage(p) {
  currentPage = p;
  $$('.page').forEach(el => el.classList.toggle('active', el.id === 'page-' + p));
  const tabFor = { home: 'home', records: 'home', add: 'add', history: 'history', 'history-detail': 'history', settings: 'settings' }[p];
  $$('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tabFor));
  window.scrollTo(0, 0);
}

function renderPage(p) {
  if (p === 'home') renderHome();
  else if (p === 'add') renderAdd();
  else if (p === 'history') renderHistory();
  else if (p === 'settings') renderSettings();
  else if (p === 'records') renderRecords();
  else if (p === 'history-detail') renderHistoryDetail();
}

async function silentRefresh() {
  if (overlayOpen() || currentPage === 'add') return; // 不打扰正在填写的表单
  try {
    await loadAll();
    if (!overlayOpen() && currentPage !== 'add') renderPage(currentPage);
  } catch (e) { /* 静默失败，下次再试 */ }
}

function overlayOpen() {
  return $('#overlay-root').children.length > 0 || $('#modal-root').children.length > 0;
}

// ---------- 通用弹层 ----------

function showFullscreen(html) {
  $('#overlay-root').innerHTML = `<div class="overlay overlay-full"><div class="sheet">${html}</div></div>`;
}
function closeOverlay() { $('#overlay-root').innerHTML = ''; }

function showModal({ title, bodyHTML, okText, cancelText, danger, onOk }) {
  $('#modal-root').innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div class="modal-title">${esc(title)}</div>
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-btns">
          <button class="btn btn-ghost" id="m-cancel">${esc(cancelText || '取消')}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="m-ok">${esc(okText || '确认')}</button>
        </div>
      </div>
    </div>`;
  $('#m-cancel').onclick = closeModal;
  $('#m-ok').onclick = async ev => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const r = await onOk();
      if (r !== false) closeModal();
    } catch (e) {
      toast('操作失败：' + errMsg(e));
    } finally {
      btn.disabled = false;
    }
  };
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// ---------- 表单碎片 ----------

function personChipsHTML(selected) {
  return ['A', 'B'].map(p =>
    `<button type="button" class="chip${p === selected ? ' selected' : ''}" data-value="${p}">${esc(personName(p))}</button>`
  ).join('');
}

function categoryChipsHTML(selected) {
  const list = [...PRESET_CATEGORIES, ...customCats(), OTHER];
  if (selected && !list.includes(selected)) list.splice(list.length - 1, 0, selected); // 兼容旧分类
  return list.map(c =>
    `<button type="button" class="chip${c === selected ? ' selected' : ''}" data-value="${esc(c)}">${esc(c)}</button>`
  ).join('');
}

function sourceChipsHTML(selected) {
  return `
    <button type="button" class="chip${selected === 'budget' ? ' selected' : ''}" data-value="budget">本月预算</button>
    <button type="button" class="chip${selected === 'pool' ? ' selected' : ''}" data-value="pool">备用池</button>`;
}

// 选项片点击：单选 + 「其他」输入框 + 备用池提示
document.addEventListener('click', ev => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  const group = chip.closest('.chip-group');
  if (!group) return;
  $$('.chip', group).forEach(c => c.classList.toggle('selected', c === chip));
  const root = chip.closest('.form-root') || document;
  if (group.classList.contains('cats-group')) {
    const oi = $('.other-input', root);
    if (oi) {
      oi.classList.toggle('hidden', chip.dataset.value !== OTHER);
      if (chip.dataset.value === OTHER) oi.focus();
    }
  }
  if (group.classList.contains('person-group')) updatePoolHint(root);
});

function updatePoolHint(root) {
  const hint = $('.pool-hint', root);
  if (!hint) return;
  const sel = $('.person-group .chip.selected', root);
  const p = sel ? sel.dataset.value : 'A';
  hint.textContent = `选「备用池」将从「${personName(p)}」的池子扣（当前余额 ${fmtSigned(state.pools[p])}），不影响本月预算剩余`;
}

function parseAmountInput(raw) {
  const v = String(raw || '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  if (!(n > 0) || n >= 1e9) return null;
  return round2(n);
}

function readCategory(root) {
  const chip = $('.cats-group .chip.selected', root);
  if (!chip) { toast('请选择分类'); return null; }
  let cat = chip.dataset.value;
  let newCustom = null;
  if (cat === OTHER) {
    const v = $('.other-input', root).value.trim();
    if (!v) { toast('请填写自定义分类名'); return null; }
    if (v.length > 10) { toast('分类名太长了（10 个字以内）'); return null; }
    cat = v;
    const known = [...PRESET_CATEGORIES, ...customCats()];
    if (!known.includes(v)) newCustom = v;
  }
  return { category: cat, newCustom };
}

function recRow(e, editable) {
  const badge = e.source === 'pool' ? '<span class="badge">池</span>' : '';
  const note = e.note ? ` · ${esc(e.note)}` : '';
  return `
    <div class="rec"${editable ? ` onclick="openEdit('${e.id}')"` : ''}>
      <div class="rec-main">
        <div class="rec-cat">${esc(e.category)}${badge}</div>
        <div class="rec-sub">${String(e.date).slice(5)} · ${esc(personName(e.person))}${note}</div>
      </div>
      <div class="rec-amt">-¥${toNum(e.amount).toFixed(2)}</div>
    </div>`;
}

// ---------- 首页 ----------

function remainRow(label, remain, budget, strong) {
  return `
    <div class="row">
      <div class="row-label">${esc(label)}<span class="row-sub">预算 ${fmt(budget)}</span></div>
      <div class="num big ${remainCls(remain, budget)}${strong ? ' strong' : ''}">${fmtSigned(remain)}</div>
    </div>`;
}

function spentRow(label, amt, pct, strong) {
  return `
    <div class="row">
      <div class="row-label"${strong ? ' style="font-weight:700"' : ''}>${esc(label)}</div>
      <div class="row-val"><span class="num"${strong ? ' style="font-weight:700"' : ''}>${fmt(amt)}</span><span class="pct">${pct}</span></div>
    </div>`;
}

function poolRow(label, balance, strong) {
  const cls = balance < 0 ? 'danger' : '';
  return `
    <div class="row">
      <div class="row-label"${strong ? ' style="font-weight:700"' : ''}>${esc(label)}</div>
      <div class="num ${cls}"${strong ? ' style="font-weight:700"' : ''}>${fmtSigned(balance)}</div>
    </div>`;
}

function renderHome() {
  const el = $('#page-home');
  const m = state.activeMonth;
  if (!m) {
    el.innerHTML = `
      <div class="hero">
        <div class="hero-emoji">💰</div>
        <div class="hero-title">还没有进行中的月份</div>
        <div class="hero-sub">开启新月，填入两人的本月预算，就可以开始记账了</div>
        <button class="btn btn-primary btn-big" onclick="openNewMonth()">开启新月</button>
      </div>`;
    return;
  }
  const s = currentStats();
  const totalBudget = round2(s.budgetA + s.budgetB);
  const remainT = round2(s.remainA + s.remainB);
  const pct = v => (s.total > 0 ? Math.round(v / s.total * 100) + '%' : '0%');

  el.innerHTML = `
    <div class="page-title">${esc(monthLabel(m.id))} <span class="badge-soft">进行中</span></div>

    <div class="card">
      <div class="card-title">本月剩余预算</div>
      ${remainRow(nameA(), s.remainA, s.budgetA)}
      ${remainRow(nameB(), s.remainB, s.budgetB)}
      <div class="divider"></div>
      ${remainRow('合计', remainT, totalBudget, true)}
      ${state.expenses.length === 0
        ? '<button class="btn btn-outline btn-block" onclick="openEditBudget()">修改预算（本月还没有支出，可改）</button>'
        : ''}
    </div>

    <div class="card">
      <div class="card-title">本月已花</div>
      ${spentRow(nameA(), s.spentATotal, pct(s.spentATotal))}
      ${spentRow(nameB(), s.spentBTotal, pct(s.spentBTotal))}
      <div class="divider"></div>
      ${spentRow('合计', s.total, s.total > 0 ? '100%' : '0%', true)}
    </div>

    <div class="card">
      <div class="card-title">分类支出</div>
      ${s.catList.length
        ? s.catList.map(c => spentRow(c.name, c.amt, pct(c.amt))).join('')
        : '<div class="empty">还没有支出</div>'}
    </div>

    <div class="card">
      <div class="card-title">备用池</div>
      ${poolRow(nameA(), state.pools.A)}
      ${poolRow(nameB(), state.pools.B)}
      <div class="divider"></div>
      ${poolRow('合计', round2(state.pools.A + state.pools.B), true)}
    </div>

    <div class="card">
      <div class="card-title">最近记录
        ${state.expenses.length ? `<button class="link" onclick="showPage('records');renderPage('records')">查看全部 ›</button>` : ''}
      </div>
      ${state.expenses.length
        ? state.expenses.slice(0, 10).map(e => recRow(e, false)).join('')
        : '<div class="empty">还没有记录，点下方「＋」记一笔吧</div>'}
    </div>

    <div class="bottom-cta">
      <button class="btn btn-outline btn-big" onclick="openRollover()">月末结转 · 开启新月</button>
    </div>`;
}

// ---------- 记一笔 ----------

function renderAdd() {
  const el = $('#page-add');
  if (!state.activeMonth) {
    el.innerHTML = `
      <div class="hero">
        <div class="hero-emoji">🗓️</div>
        <div class="hero-title">还没有开启本月账本</div>
        <div class="hero-sub">先开启新月、填好预算，才能开始记账</div>
        <button class="btn btn-primary btn-big" onclick="openNewMonth()">开启新月</button>
      </div>`;
    return;
  }
  const who = me() || 'A';
  el.innerHTML = `
    <div class="page-title">记一笔</div>
    <div class="card form-root" id="add-form">
      <div class="field">
        <label>金额</label>
        <div class="amount-wrap">
          <span class="yen">¥</span>
          <input id="f-amount" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>谁花的</label>
        <div class="chip-group person-group" data-field="person">${personChipsHTML(who)}</div>
      </div>
      <div class="field">
        <label>分类</label>
        <div class="chip-group cats-group" data-field="category">${categoryChipsHTML(null)}</div>
        <input class="other-input hidden" type="text" maxlength="10" placeholder="输入新分类名，保存后会记住">
      </div>
      <div class="field">
        <label>扣款来源</label>
        <div class="chip-group source-group" data-field="source">${sourceChipsHTML('budget')}</div>
        <div class="pool-hint"></div>
      </div>
      <div class="field">
        <label>日期</label>
        <input id="f-date" type="date" value="${todayStr()}" max="${todayStr()}">
      </div>
      <div class="field">
        <label>备注（可选）</label>
        <input id="f-note" type="text" maxlength="50" placeholder="一句话说明">
      </div>
      <button class="btn btn-primary btn-big" id="btn-save-expense">保存</button>
    </div>`;
  updatePoolHint($('#add-form'));
  $('#btn-save-expense').onclick = submitAdd;
}

async function submitAdd() {
  if (!state.activeMonth) { toast('请先开启新月'); return; }
  const root = $('#add-form');
  const amount = parseAmountInput($('#f-amount', root).value);
  if (amount === null) { toast('请输入正确金额（大于 0，最多两位小数）'); return; }
  const personChip = $('.person-group .chip.selected', root);
  const person = personChip ? personChip.dataset.value : (me() || 'A');
  const cat = readCategory(root);
  if (!cat) return;
  const sourceChip = $('.source-group .chip.selected', root);
  const source = sourceChip ? sourceChip.dataset.value : 'budget';
  const date = $('#f-date', root).value || todayStr();
  if (date > todayStr()) { toast('日期不能超过今天'); return; }
  const note = $('#f-note', root).value.trim();

  const btn = $('#btn-save-expense', root);
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const { error } = await sb.from('expenses').insert({
      month_id: state.activeMonth.id,
      date, amount, person,
      category: cat.category,
      note: note || null,
      source,
    });
    if (error) throw error;
    if (source === 'pool') await adjustPool(person, -amount);
    if (cat.newCustom) await saveCustomCategory(cat.newCustom);
    await loadAll();
    toast('已保存');
    renderAdd();
  } catch (e) {
    // 失败：保留表单内容，只提示
    toast('保存失败：' + errMsg(e) + '，内容已保留，请重试');
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

// ---------- 全部记录 / 编辑 / 删除 ----------

function renderRecords() {
  const el = $('#page-records');
  const rows = state.expenses.map(e => recRow(e, true)).join('');
  el.innerHTML = `
    <div class="page-title">
      <button class="back" onclick="showPage('home');renderPage('home')">‹</button>
      全部记录（${state.expenses.length}）
    </div>
    <div class="card">
      ${rows || '<div class="empty">这个月还没有记录</div>'}
    </div>
    ${state.expenses.length ? '<div class="tip" style="text-align:center">点任意一条可编辑或删除</div>' : ''}`;
}

function openEdit(id) {
  const e = state.expenses.find(x => x.id === id);
  if (!e) { toast('记录不存在，请刷新'); return; }
  showFullscreen(`
    <div class="sheet-head">
      <button class="btn btn-ghost" onclick="closeOverlay()">取消</button>
      <div class="sheet-title">编辑记录</div>
      <button class="btn btn-primary" id="btn-edit-save">保存</button>
    </div>
    <div class="card form-root" id="edit-form" data-id="${esc(e.id)}">
      <div class="field">
        <label>金额</label>
        <div class="amount-wrap">
          <span class="yen">¥</span>
          <input id="f-amount" type="text" inputmode="decimal" value="${toNum(e.amount).toFixed(2)}" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>谁花的</label>
        <div class="chip-group person-group" data-field="person">${personChipsHTML(e.person)}</div>
      </div>
      <div class="field">
        <label>分类</label>
        <div class="chip-group cats-group" data-field="category">${categoryChipsHTML(e.category)}</div>
        <input class="other-input hidden" type="text" maxlength="10" placeholder="输入新分类名，保存后会记住">
      </div>
      <div class="field">
        <label>扣款来源</label>
        <div class="chip-group source-group" data-field="source">${sourceChipsHTML(e.source)}</div>
        <div class="pool-hint"></div>
      </div>
      <div class="field">
        <label>日期</label>
        <input id="f-date" type="date" value="${esc(String(e.date))}" max="${todayStr()}">
      </div>
      <div class="field">
        <label>备注（可选）</label>
        <input id="f-note" type="text" maxlength="50" value="${esc(e.note || '')}">
      </div>
    </div>
    <div class="bottom-cta">
      <button class="btn btn-danger-outline btn-big" onclick="askDelete('${esc(e.id)}')">删除这条记录</button>
    </div>`);
  updatePoolHint($('#edit-form'));
  $('#btn-edit-save').onclick = submitEdit;
}

async function submitEdit() {
  const root = $('#edit-form');
  const id = root.dataset.id;
  const old = state.expenses.find(x => x.id === id);
  if (!old) { toast('记录不存在，请刷新'); return; }

  const amount = parseAmountInput($('#f-amount', root).value);
  if (amount === null) { toast('请输入正确金额（大于 0，最多两位小数）'); return; }
  const personChip = $('.person-group .chip.selected', root);
  const person = personChip ? personChip.dataset.value : old.person;
  const cat = readCategory(root);
  if (!cat) return;
  const sourceChip = $('.source-group .chip.selected', root);
  const source = sourceChip ? sourceChip.dataset.value : old.source;
  const date = $('#f-date', root).value || String(old.date);
  if (date > todayStr()) { toast('日期不能超过今天'); return; }
  const note = $('#f-note', root).value.trim();

  const btn = $('#btn-edit-save');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const { error } = await sb.from('expenses').update({
      date, amount, person,
      category: cat.category,
      note: note || null,
      source,
    }).eq('id', id);
    if (error) throw error;
    // 备用池联动：旧的先回补，新的再重扣
    if (old.source === 'pool') await adjustPool(old.person, toNum(old.amount));
    if (source === 'pool') await adjustPool(person, -amount);
    if (cat.newCustom) await saveCustomCategory(cat.newCustom);
    await loadAll();
    closeOverlay();
    renderPage(currentPage);
    toast('已保存');
  } catch (e) {
    toast('保存失败：' + errMsg(e) + '，请重试');
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

function askDelete(id) {
  const e = state.expenses.find(x => x.id === id);
  if (!e) { toast('记录不存在，请刷新'); return; }
  const poolNote = e.source === 'pool'
    ? `<div class="roll-tip">这条是从备用池扣的，删除后 ${fmt(toNum(e.amount))} 会退回到「${esc(personName(e.person))}」的备用池。</div>`
    : '';
  showModal({
    title: '删除这条记录？',
    bodyHTML: `
      <div class="roll-person">
        <div class="roll-name">${esc(e.category)} ${fmt(toNum(e.amount))}</div>
        <div class="roll-line sub">${esc(String(e.date))} · ${esc(personName(e.person))}${e.note ? ' · ' + esc(e.note) : ''}</div>
      </div>
      ${poolNote}`,
    okText: '确认删除',
    danger: true,
    onOk: async () => {
      const { error } = await sb.from('expenses').delete().eq('id', id);
      if (error) throw error;
      if (e.source === 'pool') await adjustPool(e.person, toNum(e.amount)); // 退回备用池
      await loadAll();
      closeOverlay(); // 如果编辑面板开着，一起关掉
      renderPage(currentPage);
      toast('已删除');
    },
  });
}

// ---------- 开启新月 / 修改预算 / 月末结转 ----------

function openNewMonth() {
  const id = nowMonthId();
  if (state.months.some(m => m.id === id)) {
    toast(monthLabel(id) + '的账本已存在，不能再开');
    return;
  }
  showFullscreen(`
    <div class="big-center">开启 ${esc(monthLabel(id))}</div>
    <div class="sheet-sub">填入两人的本月预算，确认后当月不可修改<br>（本月还没有任何支出时可以改）</div>
    <div class="card form-root">
      <div class="field">
        <label>${esc(nameA())} 的预算</label>
        <div class="amount-wrap">
          <span class="yen">¥</span>
          <input id="f-budget-a" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>${esc(nameB())} 的预算</label>
        <div class="amount-wrap">
          <span class="yen">¥</span>
          <input id="f-budget-b" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off">
        </div>
      </div>
      <button class="btn btn-primary btn-big" id="btn-open-month">确认开启</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost btn-big" onclick="closeOverlay()">先不开了</button>
    </div>`);
  $('#btn-open-month').onclick = submitNewMonth;
}

async function submitNewMonth() {
  const a = $('#f-budget-a').value.trim();
  const b = $('#f-budget-b').value.trim();
  const ok = v => /^\d+(\.\d{1,2})?$/.test(v);
  if (!ok(a) || !ok(b)) { toast('请填写两人的预算（数字，最多两位小数）'); return; }
  const btn = $('#btn-open-month');
  btn.disabled = true;
  btn.textContent = '开启中…';
  try {
    const { error } = await sb.from('months').insert({
      id: nowMonthId(),
      budget_a: round2(Number(a)),
      budget_b: round2(Number(b)),
      status: 'active',
    });
    if (error) throw error;
    await loadAll();
    closeOverlay();
    showPage('home');
    renderPage('home');
    toast('新月已开启，开始记账吧');
  } catch (e) {
    toast('开启失败：' + errMsg(e));
    btn.disabled = false;
    btn.textContent = '确认开启';
  }
}

function openEditBudget() {
  const m = state.activeMonth;
  if (!m) return;
  if (state.expenses.length > 0) { toast('本月已有支出记录，预算不能再改了'); return; }
  showFullscreen(`
    <div class="big-center">修改本月预算</div>
    <div class="sheet-sub">本月还没有支出记录，所以现在可以改；一旦有支出就会锁定</div>
    <div class="card form-root">
      <div class="field">
        <label>${esc(nameA())} 的预算</label>
        <div class="amount-wrap">
          <span class="yen">¥</span>
          <input id="f-budget-a" type="text" inputmode="decimal" value="${toNum(m.budget_a).toFixed(2)}" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>${esc(nameB())} 的预算</label>
        <div class="amount-wrap">
          <span class="yen">¥</span>
          <input id="f-budget-b" type="text" inputmode="decimal" value="${toNum(m.budget_b).toFixed(2)}" autocomplete="off">
        </div>
      </div>
      <button class="btn btn-primary btn-big" id="btn-save-budget">保存预算</button>
      <div style="height:10px"></div>
      <button class="btn btn-ghost btn-big" onclick="closeOverlay()">取消</button>
    </div>`);
  $('#btn-save-budget').onclick = async () => {
    const a = $('#f-budget-a').value.trim();
    const b = $('#f-budget-b').value.trim();
    const ok = v => /^\d+(\.\d{1,2})?$/.test(v);
    if (!ok(a) || !ok(b)) { toast('请填写两人的预算（数字，最多两位小数）'); return; }
    const btn = $('#btn-save-budget');
    btn.disabled = true;
    try {
      const { error } = await sb.from('months').update({
        budget_a: round2(Number(a)),
        budget_b: round2(Number(b)),
      }).eq('id', m.id);
      if (error) throw error;
      await loadAll();
      closeOverlay();
      renderPage(currentPage);
      toast('预算已更新');
    } catch (e) {
      toast('保存失败：' + errMsg(e));
      btn.disabled = false;
    }
  };
}

function openRollover() {
  if (!state.activeMonth) { openNewMonth(); return; }
  const s = currentStats();
  const line = (name, remain, pool, budget) => `
    <div class="roll-person">
      <div class="roll-name">${esc(name)}</div>
      <div class="roll-line">本月剩余 <b class="num ${remainCls(remain, budget)}">${fmtSigned(remain)}</b>，将转入备用池</div>
      <div class="roll-line sub">备用池：${fmtSigned(pool)} → <b>${fmtSigned(round2(pool + remain))}</b></div>
    </div>`;
  showModal({
    title: '月末结转 · 开启新月',
    bodyHTML: `
      ${line(nameA(), s.remainA, state.pools.A, s.budgetA)}
      ${line(nameB(), s.remainB, state.pools.B, s.budgetB)}
      <div class="roll-tip">确认后：本月账本归档为只读并进入「历史」；剩余为负时会从备用池中扣减；然后就可以设置新预算了。</div>`,
    okText: '确认结转并开启新月',
    onOk: async () => {
      const m = state.activeMonth;
      const { error } = await sb.from('months').update({
        status: 'archived',
        closed_at: new Date().toISOString(),
      }).eq('id', m.id);
      if (error) throw error;
      await adjustPool('A', s.remainA);
      await adjustPool('B', s.remainB);
      await loadAll();
      renderPage(currentPage);
      toast('已结转，请设置新预算');
      setTimeout(openNewMonth, 150);
    },
  });
}

// ---------- 历史 ----------

function renderHistory() {
  const el = $('#page-history');
  const archived = state.months.filter(m => m.status === 'archived');
  const rows = archived.map(m => {
    const total = round2(toNum(m.budget_a) + toNum(m.budget_b));
    const closed = m.closed_at ? String(m.closed_at).slice(0, 10) : '';
    return `
      <div class="rec" onclick="openHistoryDetail('${esc(m.id)}')">
        <div class="rec-main">
          <div class="rec-cat">${esc(monthLabel(m.id))}</div>
          <div class="rec-sub">总预算 ${fmt(total)}${closed ? ' · 归档于 ' + esc(closed) : ''}</div>
        </div>
        <div class="rec-amt" style="color:var(--muted);font-weight:400">›</div>
      </div>`;
  }).join('');
  el.innerHTML = `
    <div class="page-title">历史</div>
    <div class="card">
      ${rows || '<div class="empty">还没有历史月份。<br>月末在首页或设置页点「开启新月」结转后，旧月份会出现在这里。</div>'}
    </div>`;
}

async function openHistoryDetail(id) {
  const m = state.months.find(x => x.id === id);
  if (!m) return;
  const { data, error } = await sb.from('expenses')
    .select('*')
    .eq('month_id', id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { toast('加载失败：' + errMsg(error)); return; }
  histDetail = { month: m, expenses: data || [] };
  showPage('history-detail');
  renderHistoryDetail();
}

function renderHistoryDetail() {
  const el = $('#page-history-detail');
  if (!histDetail) { el.innerHTML = ''; return; }
  const { month: m, expenses } = histDetail;
  const s = statsFor(m, expenses);
  const pct = v => (s.total > 0 ? Math.round(v / s.total * 100) + '%' : '0%');
  el.innerHTML = `
    <div class="page-title">
      <button class="back" onclick="showPage('history');renderPage('history')">‹</button>
      ${esc(monthLabel(m.id))} <span class="badge-soft">已归档 · 只读</span>
    </div>

    <div class="card">
      <div class="card-title">预算</div>
      <div class="row"><div class="row-label">${esc(nameA())}</div><div class="num">${fmt(s.budgetA)}</div></div>
      <div class="row"><div class="row-label">${esc(nameB())}</div><div class="num">${fmt(s.budgetB)}</div></div>
      <div class="divider"></div>
      <div class="row"><div class="row-label" style="font-weight:700">合计</div><div class="num" style="font-weight:700">${fmt(round2(s.budgetA + s.budgetB))}</div></div>
    </div>

    <div class="card">
      <div class="card-title">支出</div>
      ${spentRow(nameA(), s.spentATotal, pct(s.spentATotal))}
      ${spentRow(nameB(), s.spentBTotal, pct(s.spentBTotal))}
      <div class="divider"></div>
      ${spentRow('合计', s.total, s.total > 0 ? '100%' : '0%', true)}
      <div class="divider"></div>
      <div class="row"><div class="row-label">${esc(nameA())} 结转时剩余</div><div class="num ${remainCls(s.remainA, s.budgetA)}">${fmtSigned(s.remainA)}</div></div>
      <div class="row"><div class="row-label">${esc(nameB())} 结转时剩余</div><div class="num ${remainCls(s.remainB, s.budgetB)}">${fmtSigned(s.remainB)}</div></div>
    </div>

    <div class="card">
      <div class="card-title">分类支出</div>
      ${s.catList.length
        ? s.catList.map(c => spentRow(c.name, c.amt, pct(c.amt))).join('')
        : '<div class="empty">没有支出</div>'}
    </div>

    <div class="card">
      <div class="card-title">全部明细（${expenses.length}）</div>
      ${expenses.length ? expenses.map(e => recRow(e, false)).join('') : '<div class="empty">没有记录</div>'}
    </div>`;
}

// ---------- 设置 ----------

function renderSettings() {
  const el = $('#page-settings');
  const who = me();
  el.innerHTML = `
    <div class="page-title">设置</div>

    <div class="card form-root">
      <div class="card-title">两人昵称</div>
      <div class="field">
        <label>第一个人（A）</label>
        <input id="f-name-a" type="text" maxlength="8" value="${esc(nameA())}">
      </div>
      <div class="field">
        <label>第二个人（B）</label>
        <input id="f-name-b" type="text" maxlength="8" value="${esc(nameB())}">
      </div>
      <button class="btn btn-primary btn-big" id="btn-save-names">保存昵称</button>
    </div>

    <div class="card form-root">
      <div class="card-title">我是谁（这台手机的主人）</div>
      <div class="chip-group" id="me-chips">
        <button type="button" class="chip${who === 'A' ? ' selected' : ''}" data-value="A">${esc(nameA())}</button>
        <button type="button" class="chip${who === 'B' ? ' selected' : ''}" data-value="B">${esc(nameB())}</button>
      </div>
      <div class="tip">「记一笔」时会默认选中这个人；两台手机各选各的。</div>
    </div>

    <div class="card">
      <div class="card-title">数据备份</div>
      <div class="tip">把全部数据（月份、支出明细、备用池、设置）导出为一个 JSON 文件保存到手机。</div>
      <button class="btn btn-outline btn-big" id="btn-export">导出备份（JSON）</button>
    </div>

    <div class="card">
      <div class="card-title">月末结转</div>
      <div class="tip">把本月剩余转入备用池，归档本月账本，开始新的一个月。</div>
      <button class="btn btn-primary btn-big" onclick="openRollover()">开启新月</button>
    </div>`;
  $('#btn-save-names').onclick = saveNames;
  $('#btn-export').onclick = exportBackup;
  $$('#me-chips .chip').forEach(chip => {
    chip.onclick = () => {
      localStorage.setItem('whoami', chip.dataset.value);
      renderSettings();
      toast(`已设置：这台手机是「${personName(chip.dataset.value)}」在用`);
    };
  });
}

async function saveNames() {
  const a = $('#f-name-a').value.trim();
  const b = $('#f-name-b').value.trim();
  if (!a || !b) { toast('两个昵称都要填'); return; }
  const btn = $('#btn-save-names');
  btn.disabled = true;
  try {
    const { error } = await sb.from('settings').update({ person_a_name: a, person_b_name: b }).eq('id', 1);
    if (error) throw error;
    state.settings.person_a_name = a;
    state.settings.person_b_name = b;
    renderSettings();
    toast('昵称已保存');
  } catch (e) {
    toast('保存失败：' + errMsg(e));
    btn.disabled = false;
  }
}

async function exportBackup() {
  const btn = $('#btn-export');
  btn.disabled = true;
  btn.textContent = '导出中…';
  try {
    const [s, m, e, p] = await Promise.all([
      sb.from('settings').select('*'),
      sb.from('months').select('*').order('id'),
      sb.from('expenses').select('*').order('created_at'),
      sb.from('pools').select('*'),
    ]);
    if (s.error) throw s.error;
    if (m.error) throw m.error;
    if (e.error) throw e.error;
    if (p.error) throw p.error;
    const payload = {
      app: '存钱罐·双人记账',
      exported_at: new Date().toISOString(),
      settings: s.data,
      months: m.data,
      expenses: e.data,
      pools: p.data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '记账备份-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出');
  } catch (err) {
    toast('导出失败：' + errMsg(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '导出备份（JSON）';
  }
}

// ---------- 首次使用引导 ----------

function showOnboarding() {
  showFullscreen(`
    <div class="onboard-emoji">💰</div>
    <div class="onboard-title">欢迎来到存钱罐</div>
    <div class="onboard-sub">第一次使用，先花 30 秒设置一下</div>
    <div class="card form-root">
      <div class="field">
        <label>第一个人（A）的昵称</label>
        <input id="f-ob-name-a" type="text" maxlength="8" value="${esc(nameA())}">
      </div>
      <div class="field">
        <label>第二个人（B）的昵称</label>
        <input id="f-ob-name-b" type="text" maxlength="8" value="${esc(nameB())}">
      </div>
      <div class="field">
        <label>这台手机是谁在用？</label>
        <div class="chip-group" id="ob-who">
          <button type="button" class="chip selected" data-value="A"></button>
          <button type="button" class="chip" data-value="B"></button>
        </div>
        <div class="tip">以后「记一笔」会默认选中这个人；另一台手机选另一个人。</div>
      </div>
      <button class="btn btn-primary btn-big" id="btn-ob-save">开始使用</button>
    </div>`);

  const syncLabels = () => {
    const a = $('#f-ob-name-a').value.trim() || 'A';
    const b = $('#f-ob-name-b').value.trim() || 'B';
    $$('#ob-who .chip').forEach(c => {
      c.textContent = '我是 ' + (c.dataset.value === 'A' ? a : b);
    });
  };
  $('#f-ob-name-a').addEventListener('input', syncLabels);
  $('#f-ob-name-b').addEventListener('input', syncLabels);
  syncLabels();

  $('#btn-ob-save').onclick = async () => {
    const a = $('#f-ob-name-a').value.trim();
    const b = $('#f-ob-name-b').value.trim();
    if (!a || !b) { toast('请把两个昵称都填上'); return; }
    const whoChip = $('#ob-who .chip.selected');
    const who = whoChip ? whoChip.dataset.value : 'A';
    const btn = $('#btn-ob-save');
    btn.disabled = true;
    try {
      const { error } = await sb.from('settings').update({ person_a_name: a, person_b_name: b }).eq('id', 1);
      if (error) throw error;
      state.settings.person_a_name = a;
      state.settings.person_b_name = b;
      localStorage.setItem('whoami', who);
      closeOverlay();
      showPage('home');
      renderPage('home');
      toast('设置完成，去开启新月吧');
    } catch (e) {
      toast('保存失败：' + errMsg(e) + '，请检查网络');
      btn.disabled = false;
    }
  };
}
