(function () {
  'use strict';
  const KEY = 'worktime.v1';
  const W = window.WT;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymOf = (d) => d.getFullYear() + '-' + W.pad(d.getMonth() + 1);
  const md = (ds) => Number(ds.slice(5, 7)) + '/' + Number(ds.slice(8));
  const mdw = (ds) => md(ds) + '(' + W.DOW[W.dowOf(ds)] + ')';
  const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)); };
  const nowHM = () => { const d = new Date(); return W.pad(d.getHours()) + ':' + W.pad(d.getMinutes()); };

  /* ---------- 저장소 ---------- */
  function defaults() {
    return {
      version: 1, days: {}, months: {},
      settings: { defaultStart: '08:40', otCap: 90, earlyTime: '15:30', customHolidays: {}, disabledHolidays: [], lastBackup: null }
    };
  }
  function normalize(s) {
    const d = defaults();
    if (!s || typeof s !== 'object' || typeof s.days !== 'object') return null;
    s.settings = Object.assign(d.settings, s.settings || {});
    s.months = s.months || {};
    s.version = 1;
    return s;
  }
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY))) || defaults(); } catch (e) { return defaults(); }
  }
  let state = load();
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  let tab = 'today';
  let viewYm = ymOf(new Date());

  /* ---------- 공용 UI ---------- */
  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }
  function monthNav() {
    const [y, m] = viewYm.split('-');
    return `<div class="monthnav"><button data-action="prev-month" aria-label="이전 달">‹</button>
      <b>${y}년 ${Number(m)}월</b><button data-action="next-month" aria-label="다음 달">›</button></div>`;
  }
  function progressBar(p) {
    const work = Math.min(100, (p.completed / p.base) * 100 || 0);
    const leave = Math.min(100 - work, (p.leaveTotal / p.base) * 100 || 0);
    return `<div class="progress"><i class="p-work" style="width:${work}%"></i><i class="p-leave" style="width:${leave}%"></i></div>`;
  }
  function summaryStats(p) {
    return `
      ${progressBar(p)}
      <div class="grid3">
        <div class="stat"><div class="k">기본 근로</div><div class="v">${W.fmtHM(p.base)}<small> ${p.workdays.length}일</small></div></div>
        <div class="stat"><div class="k">완료${p.leaveTotal ? ' (휴가 ' + W.fmtHM(p.leaveTotal) + ')' : ''}</div><div class="v">${W.fmtHM(p.done)}</div></div>
        <div class="stat"><div class="k">남은 시간</div><div class="v">${p.remaining > 0 ? W.fmtHM(p.remaining) : '0:00'}</div></div>
      </div>`;
  }

  function goalBanner(p) {
    const g = p.goal;
    if (!g) return '';
    const day = mdw(g.target);
    const avg = p.otDays ? Math.round(p.otSum / p.otDays / 10) * 10 : 0;
    const otText = p.otSum > 0
      ? `남은 ${p.otDays}일 동안 오버타임 총 <b>${W.fmtKo(p.otSum)}</b> (하루 약 ${avg}분)`
      : '';
    if (p.remaining <= 0) {
      return `<div class="banner ok"><div class="t">🎉 이번 달 기본 근로시간을 다 채웠어요</div>
        <div class="d">${p.remaining < 0 ? '초과 ' + W.fmtKo(-p.remaining) + '. ' : ''}남은 평일은 출근하지 않아도 되는 상태예요.</div></div>`;
    }
    if (g.past) {
      return `<div class="banner info"><div class="t">목표일(${day})이 지났어요</div><div class="d">남은 ${W.fmtKo(p.remaining)}</div></div>`;
    }
    if (g.active && g.mode === 'off') {
      if (g.feasible) {
        return `<div class="banner ok"><div class="t">✓ ${day} 휴무 가능</div><div class="d">${otText ||
          (g.surplus > 0 ? `오버타임 없이도 여유 <b>${W.fmtKo(g.surplus)}</b>` : '평소대로 8시간씩 근무하면 돼요')}</div></div>`;
      }
      return `<div class="banner bad"><div class="t">✕ ${day} 휴무까지 ${W.fmtKo(g.need)} 부족</div>
        <div class="d">하루 최대 ${p.capMin}분 오버타임으로도 모자라요. 목표일에 ${W.fmtKo(g.need)} 근무 (${g.start} → ${g.leaveAt})가 필요해요.
        약속 날짜를 줄이거나, 설정에서 최대 오버타임을 늘리거나, 목표를 조기퇴근으로 바꿔보세요.</div></div>`;
    }
    if (g.active && g.mode === 'early') {
      if (g.need === 0) {
        return `<div class="banner ok"><div class="t">✓ ${day} 아예 휴무도 가능해요</div><div class="d">${otText || '여유 ' + W.fmtKo(g.surplus)}</div></div>`;
      }
      if (g.feasible) {
        return `<div class="banner info"><div class="t">${day} ${g.leaveAt} 조기퇴근</div>
          <div class="d">목표일 근무 ${W.fmtKo(g.need)} (${g.start} 출근 기준). ${otText || '평소대로 8시간씩 근무하면 돼요.'}</div></div>`;
      }
      return `<div class="banner warn"><div class="t">${day} 조기퇴근 어려움</div>
        <div class="d">목표일에 ${W.fmtKo(g.need)} 근무가 필요해요. 약속 날짜를 줄이거나 최대 오버타임을 늘려보세요.</div></div>`;
    }
    // 목표 없음
    if (g.deficit > 0) {
      return `<div class="banner warn"><div class="t">남은 근무일로 ${W.fmtKo(g.deficit)} 부족</div><div class="d">하루 최대 오버타임을 넣어도 모자라요.</div></div>`;
    }
    return `<div class="banner info"><div class="t">남은 ${W.fmtKo(p.remaining)}</div>
      <div class="d">${otText || (g.surplus > 0 ? '평소대로 근무하면 여유 ' + W.fmtKo(g.surplus) : '평소대로 8시간씩 근무하면 딱 맞아요')}</div></div>`;
  }

  /* ---------- 오늘 ---------- */
  function renderToday() {
    const now = new Date();
    const p = W.monthPlan(state, ymOf(now), now);
    const day = p.days.find((x) => x.isToday);
    const rec = day.rec;
    const plan = p.planDays.find((x) => x.isToday);
    const net = day.net;
    const g = p.goal;
    let body = '';

    const isTarget = g && g.active && g.target === day.ds;
    if (!day.work) {
      body += `<div class="banner info"><div class="t">오늘은 ${esc(day.hol || '주말')}이에요 🌿</div></div>`;
    } else if (day.credit >= W.DAY_MIN) {
      body += `<div class="banner info"><div class="t">오늘은 연차예요 🌴</div></div>`;
    } else if (isTarget && g.mode === 'off' && !rec.in) {
      body += `<div class="banner ok"><div class="t">오늘은 휴무 목표일이에요 🎉</div><div class="d">${g.feasible ? '출근하지 않아도 돼요.' : '다만 아직 ' + W.fmtKo(g.need) + ' 부족해요.'}</div></div>`;
    }

    const inR = rec.in ? W.roundIn(rec.in) : null;
    const outR = rec.out ? W.roundOut(rec.out) : null;
    let status = '';
    if (net.status === 'live') {
      const goalNet = isTarget && g.mode === 'early' ? g.need : plan ? plan.planned : W.DAY_MIN - day.credit;
      const leave = W.fromMin(net.inR + W.stayForNet(goalNet));
      const eight = W.fromMin(net.inR + W.stayForNet(W.DAY_MIN - day.credit));
      const ot = plan ? plan.ot : 0;
      status = `
        <div class="sub">근무 중</div>
        <div class="big">${W.fmtHM(net.min)}</div>
        <div class="grid2" style="margin-top:12px">
          <div class="stat"><div class="k">${day.credit ? '반차 반영 ' : ''}${W.fmtKo(W.DAY_MIN - day.credit)} 달성</div><div class="v">${eight}</div></div>
          <div class="stat"><div class="k">추천 퇴근${ot ? ' (+' + ot + '분)' : ''}</div><div class="v" style="color:var(--accent)">${leave}</div></div>
        </div>`;
    } else if (net.status === 'done') {
      const diff = net.min - (W.DAY_MIN - day.credit);
      status = `<div class="sub">오늘 근무 완료</div><div class="big">${W.fmtHM(net.min)}</div>
        <div class="sub">${diff >= 0 ? '+' : ''}${W.fmtHM(diff)} (기준 ${W.fmtHM(W.DAY_MIN - day.credit)})</div>`;
    } else if (net.status === 'partial') {
      status = `<div class="banner warn"><div class="t">출근 기록이 없어요</div><div class="d">‘수정’을 눌러 출근 시간을 입력해주세요.</div></div>`;
    } else {
      status = `<div class="sub">아직 출근 기록이 없어요</div>` +
        (plan ? `<div class="mid" style="margin-top:6px">추천 ${plan.start} → ${plan.leaveAt}${plan.ot ? ' <span class="tag ot">+' + plan.ot + '분</span>' : ''}</div>` : '');
    }

    body += `<div class="card">
      ${status}
      <div class="grid2" style="margin-top:12px">
        <div class="stat"><div class="k">출근</div><div class="v">${inR || '—'}</div>${rec.in && rec.in !== inR ? `<div class="sub">실제 ${rec.in}</div>` : ''}</div>
        <div class="stat"><div class="k">퇴근</div><div class="v">${outR || '—'}</div>${rec.out && rec.out !== outR ? `<div class="sub">실제 ${rec.out}</div>` : ''}</div>
      </div>
      <div class="btns">
        ${!rec.in || rec.out ? `<button class="btn" data-action="punch" data-type="in">지금 출근</button>` : ''}
        ${rec.in && !rec.out ? `<button class="btn" data-action="punch" data-type="out">지금 퇴근</button>` : ''}
        <button class="btn secondary" data-action="edit-day" data-ds="${day.ds}">수정</button>
      </div>
      ${day.work ? `<label class="check"><input type="checkbox" data-action="toggle-noot" data-ds="${day.ds}" ${rec.noOT ? 'checked' : ''}> 오늘 약속 있음 (오버타임 안 함)</label>` : ''}
    </div>`;

    body += `<div class="card"><div class="row"><h2 style="margin:0">${Number(p.ym.slice(5))}월 현황</h2>
      <button class="btn small secondary" data-action="goto" data-tab="plan">계획 보기 ›</button></div>
      ${summaryStats(p)}</div>
      ${goalBanner(p)}`;
    if (p.missing) body += missingBanner(p.missing);
    return body;
  }

  function missingBanner(n) {
    return `<div class="banner warn"><div class="t">기록이 없는 평일 ${n}일</div><div class="d">0시간으로 계산 중이에요. 기록 탭에서 입력해주세요.</div></div>`;
  }

  /* ---------- 계획 ---------- */
  function renderPlan() {
    const now = new Date();
    const p = W.monthPlan(state, viewYm, now);
    const g = p.goal;
    const mcfg = state.months[viewYm] || {};
    let html = monthNav();
    html += `<div class="card"><h2>이번 달 근로시간</h2>${summaryStats(p)}</div>`;

    if (g) {
      const autoLabel = (W.dowOf(g.target) === 1 || W.dowOf(g.target) === 5) ? '휴무' : '조기퇴근';
      const modes = [['auto', '자동(' + autoLabel + ')'], ['off', '휴무'], ['early', '조기퇴근'], ['none', '없음']];
      html += `<div class="card"><h2>목표</h2>
        <label class="f">목표일 (기본: 마지막 평일)</label>
        <select data-action="set-target">
          <option value="">${mdw(p.workdays[p.workdays.length - 1])} · 마지막 평일</option>
          ${p.workdays.slice(0, -1).reverse().map((ds) => `<option value="${ds}" ${mcfg.target === ds ? 'selected' : ''}>${mdw(ds)}</option>`).join('')}
        </select>
        <label class="f">목표 방식</label>
        <div class="seg">${modes.map(([k, l]) => `<button data-action="set-mode" data-mode="${k}" class="${(mcfg.mode || 'auto') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${g.mode === 'early' ? `<label class="f">조기퇴근 목표 시각</label>
          <input type="time" data-action="set-early" value="${esc(g.earlyTime)}">` : ''}
        <div class="sub" style="margin-top:8px">월·금이면 주말과 붙여 쉬도록 ‘휴무’, 화~목이면 ‘조기퇴근’이 자동 선택돼요.</div>
      </div>`;
    }
    html += goalBanner(p);
    if (p.missing) html += missingBanner(p.missing);

    // 남은 일정
    const rows = [];
    p.planDays.forEach((x) => rows.push({ ds: x.ds, html: planRow(x, p) }));
    if (g && g.active) rows.push({ ds: g.target, html: targetRow(p) });
    rows.sort((a, b) => a.ds.localeCompare(b.ds));
    html += `<div class="row" style="margin-top:18px"><h2 style="margin:0 4px;font-size:17px">추천 스케줄</h2>
      <span class="sub">‘약속’을 누르면 그날은 오버타임 제외</span></div>`;
    html += rows.length ? `<div class="list">${rows.map((r) => r.html).join('')}</div>`
      : `<div class="card muted">남은 근무일이 없어요.</div>`;
    return html;
  }

  function dateCell(ds) {
    const dow = W.dowOf(ds);
    return `<div class="date"><b class="${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">${md(ds)}</b><span>${W.DOW[dow]}요일</span></div>`;
  }

  function planRow(x, p) {
    const rec = x.rec;
    const tags = [];
    if (rec.leave) tags.push(`<span class="tag leave">${W.LEAVE[rec.leave].label}</span>`);
    if (rec.noOT && rec.memo) tags.push(`<span class="tag noot">${esc(rec.memo)}</span>`);
    const live = x.isToday && rec.in;
    return `<div class="item tap ${x.isToday ? 'today' : ''}" data-action="edit-day" data-ds="${x.ds}">
      ${dateCell(x.ds)}
      <div class="main"><div class="l1">${W.roundIn(x.start)} → ${x.leaveAt} ${tags.join('')}</div>
        <div class="l2">${live ? '근무 중 · ' : ''}근무 ${W.fmtHM(x.planned)} · 회사 ${W.fmtHM(W.stayForNet(x.planned))}</div></div>
      <div class="right">
        ${x.ot ? `<span class="tag ot">+${x.ot}분</span>` : '<span class="sub">정시</span>'}
        <div style="margin-top:6px"><button class="chip ${rec.noOT ? 'on' : ''}" data-action="toggle-noot" data-ds="${x.ds}">약속</button></div>
      </div></div>`;
  }

  function targetRow(p) {
    const g = p.goal;
    let l1, l2;
    if (g.need === 0) { l1 = '휴무 🎉'; l2 = g.mode === 'off' ? '목표 휴무일' : '조기퇴근 목표였지만 휴무 가능'; }
    else if (g.mode === 'off') { l1 = `휴무 목표 · ${W.fmtKo(g.need)} 부족`; l2 = `이대로면 ${g.start} → ${g.leaveAt} 근무 필요`; }
    else { l1 = `${g.start} → ${g.leaveAt} 조기퇴근`; l2 = `근무 ${W.fmtHM(g.need)}`; }
    return `<div class="item tap target" data-action="edit-day" data-ds="${g.target}">
      ${dateCell(g.target)}
      <div class="main"><div class="l1">${l1}</div><div class="l2">${l2}</div></div>
      <div class="right"><span class="tag off">목표</span></div></div>`;
  }

  /* ---------- 기록 ---------- */
  function renderLog() {
    const now = new Date();
    const p = W.monthPlan(state, viewYm, now);
    let html = monthNav();
    html += `<div class="card"><div class="row"><div><div class="sub">근무 ${W.fmtHM(p.completed)} + 휴가 ${W.fmtHM(p.leaveTotal)}</div>
      <div class="mid">${W.fmtHM(p.done)} <span class="sub">/ ${W.fmtHM(p.base)}</span></div></div>
      <button class="btn small secondary" data-action="edit-day" data-ds="${p.todayStr.slice(0, 7) === viewYm ? p.todayStr : viewYm + '-01'}">+ 입력</button></div>
      ${progressBar(p)}</div>`;
    html += '<div class="list">' + p.days.map((x) => logRow(x, p)).join('') + '</div>';
    return html;
  }

  function logRow(x, p) {
    const rec = x.rec, net = x.net;
    const tags = [];
    if (x.hol) tags.push(`<span class="tag hol">${esc(x.hol)}</span>`);
    if (x.work && rec.leave) tags.push(`<span class="tag leave">${W.LEAVE[rec.leave].label}</span>`);
    if (rec.noOT) tags.push(`<span class="tag noot">약속</span>`);
    let l1 = '', right = '';
    if (net.status === 'done') {
      l1 = `${W.fromMin(net.inR)} → ${W.fromMin(net.outR)}`;
      const diff = net.min - (x.work ? W.DAY_MIN - x.credit : 0);
      right = `<b>${W.fmtHM(net.min)}</b><div class="sub">${diff > 0 ? '+' : ''}${diff ? W.fmtHM(diff) : '정시'}</div>`;
    } else if (net.status === 'live') {
      l1 = `${W.fromMin(net.inR)} → 근무 중`;
      right = `<b>${W.fmtHM(net.min)}</b>`;
    } else if (net.status === 'partial') {
      l1 = rec.in ? `${W.roundIn(rec.in)} → <span style="color:var(--warn)">퇴근 기록 없음</span>`
        : `<span style="color:var(--warn)">출근 기록 없음</span> → ${W.roundOut(rec.out)}`;
    } else if (x.work && x.credit >= W.DAY_MIN) {
      l1 = '<span class="muted">휴가</span>';
    } else if (x.work && x.ds < p.todayStr) {
      l1 = '<span style="color:var(--warn)">기록 없음</span>';
    } else if (x.work) {
      l1 = '<span class="muted">예정</span>';
    }
    if (!x.work && net.status === 'none') {
      return `<div class="item tap weekend" data-action="edit-day" data-ds="${x.ds}">${dateCell(x.ds)}
        <div class="main"><div class="l2">${tags.join('') || ''}</div></div></div>`;
    }
    return `<div class="item tap ${x.isToday ? 'today' : ''}" data-action="edit-day" data-ds="${x.ds}">
      ${dateCell(x.ds)}
      <div class="main"><div class="l1">${l1} ${tags.join('')}</div>${rec.memo ? `<div class="l2">${esc(rec.memo)}</div>` : ''}</div>
      <div class="right">${right}</div></div>`;
  }

  /* ---------- 날짜 편집 시트 ---------- */
  function openDay(ds) {
    const rec = state.days[ds] || {};
    const hol = W.holidayName(state, ds);
    const dow = W.dowOf(ds);
    const isWork = !hol && dow !== 0 && dow !== 6;
    const events = (rec.events || []).slice().reverse();
    $('#sheet-body').innerHTML = `
      <div class="row"><h3>${Number(ds.slice(0, 4))}년 ${mdw(ds)}</h3><button class="btn small secondary" data-action="close-sheet">닫기</button></div>
      ${hol ? `<div class="sub">${esc(hol)}</div>` : ''}
      <label class="f">날짜</label>
      <input type="date" id="f-date" value="${ds}" data-action="change-date">
      <div class="grid2">
        <div><label class="f">출근 (실제 도착)</label><input type="time" id="f-in" value="${esc(rec.in || '')}"></div>
        <div><label class="f">퇴근 (실제 이탈)</label><input type="time" id="f-out" value="${esc(rec.out || '')}"></div>
      </div>
      <div class="sub" id="f-preview" style="margin-top:8px"></div>
      ${isWork ? `
      <label class="f">휴가</label>
      <select id="f-leave">
        <option value="">없음</option>
        ${Object.entries(W.LEAVE).map(([k, v]) => `<option value="${k}" ${rec.leave === k ? 'selected' : ''}>${v.label} (${v.credit / 60}시간 인정)</option>`).join('')}
      </select>
      <label class="check"><input type="checkbox" id="f-noot" ${rec.noOT ? 'checked' : ''}> 약속·일정 있음 (이날은 오버타임 안 함)</label>
      <label class="f">예정 출근 시간 (추천 계산용, 비우면 기본 ${esc(state.settings.defaultStart)})</label>
      <input type="time" id="f-plan" value="${esc(rec.planStart || '')}">` : ''}
      <label class="f">메모</label>
      <input type="text" id="f-memo" value="${esc(rec.memo || '')}" placeholder="예: 저녁 약속, 병원">
      <div class="btns"><button class="btn" data-action="save-day" data-ds="${ds}">저장</button></div>
      <div class="btns"><button class="btn danger" data-action="clear-day" data-ds="${ds}">이 날 기록 지우기</button></div>
      ${events.length ? `<label class="f">자동/수동 기록 이력</label><div class="sub">${events.map((e) =>
        `${e.type === 'in' ? '도착' : '이탈'} ${esc(e.time)} · ${e.source === 'shortcut' ? '단축어' : e.source === 'button' ? '버튼' : e.source === 'import' ? '가져오기' : '자동'}`).join('<br>')}</div>` : ''}
    `;
    $('#sheet').classList.remove('hidden');
    const upd = () => {
      const i = $('#f-in').value, o = $('#f-out').value;
      let t = '';
      if (i) t += `인정 출근 ${W.roundIn(i)}`;
      if (o) t += `${t ? ' · ' : ''}인정 퇴근 ${W.roundOut(o)}`;
      if (i && o) {
        const stay = W.floor10(W.toMin(o)) - W.ceil10(W.toMin(i));
        t += ` · 순수 근무 <b>${W.fmtHM(W.netFromStay(stay))}</b> (회사 ${W.fmtHM(Math.max(0, stay))})`;
      }
      $('#f-preview').innerHTML = t;
    };
    $('#f-in').addEventListener('input', upd);
    $('#f-out').addEventListener('input', upd);
    upd();
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); }

  function saveDay(ds) {
    const rec = state.days[ds] || {};
    const v = (id) => { const el = $(id); return el ? el.value.trim() : ''; };
    const set = (k, val) => { if (val) rec[k] = val; else delete rec[k]; };
    set('in', v('#f-in')); set('out', v('#f-out'));
    if ($('#f-leave')) { set('leave', v('#f-leave')); set('planStart', v('#f-plan')); if ($('#f-noot').checked) rec.noOT = true; else delete rec.noOT; }
    set('memo', v('#f-memo'));
    commitDay(ds, rec);
    closeSheet(); render(); toast('저장했어요');
  }
  function commitDay(ds, rec) {
    const keys = Object.keys(rec).filter((k) => k !== 'events');
    if (keys.length || (rec.events && rec.events.length)) state.days[ds] = rec; else delete state.days[ds];
    save();
  }

  /* ---------- 설정 ---------- */
  function appUrl() { return location.origin + location.pathname; }
  function renderSettings() {
    const s = state.settings;
    const base = appUrl();
    const year = new Date().getFullYear();
    const hols = {};
    Object.entries(W.HOLIDAYS).forEach(([d, n]) => { if (+d.slice(0, 4) >= year) hols[d] = { name: n, builtin: true }; });
    Object.entries(s.customHolidays || {}).forEach(([d, n]) => { hols[d] = { name: n, builtin: false }; });
    const holList = Object.keys(hols).sort().filter((d) => d >= year + '-01-01' && d < (year + 2) + '-01-01');
    const lastBackup = s.lastBackup ? Math.floor((Date.now() - new Date(s.lastBackup)) / 86400000) : null;

    return `
    <div class="card"><h2>근무 기본값</h2>
      <label class="f">기본 출근 시간 (추천 스케줄 계산 기준)</label>
      <input type="time" data-setting="defaultStart" value="${esc(s.defaultStart)}">
      <label class="f">하루 최대 오버타임</label>
      <select data-setting="otCap">
        ${[30, 60, 90, 120, 150].map((n) => `<option value="${n}" ${+s.otCap === n ? 'selected' : ''}>${W.fmtKo(n)}</option>`).join('')}
      </select>
      <label class="f">조기퇴근 기본 목표 시각 (화~목 마지막 평일)</label>
      <input type="time" data-setting="earlyTime" value="${esc(s.earlyTime)}">
      <div class="sub" style="margin-top:10px">계산 규칙 · 하루 8시간, 출근 10분 올림 / 퇴근 10분 내림, 휴게 4시간 근무 시 30분 · 8시간 근무 시 1시간 (8시간 인정 = 회사 9시간)</div>
    </div>

    <div class="card"><h2>단축어 자동 기록 주소</h2>
      <div class="sub">단축어 ‘URL 열기’에 아래 주소 뒤에 날짜(yyyy-MM-dd'T'HH:mm)를 붙여 사용해요.</div>
      <label class="f">도착(출근)</label>
      <div class="code">${esc(base)}?e=in&amp;t=</div>
      <button class="btn small secondary" style="margin-top:6px" data-action="copy" data-text="${esc(base)}?e=in&t=">복사</button>
      <label class="f">떠남(퇴근)</label>
      <div class="code">${esc(base)}?e=out&amp;t=</div>
      <button class="btn small secondary" style="margin-top:6px" data-action="copy" data-text="${esc(base)}?e=out&t=">복사</button>
      <div class="sub" style="margin-top:10px">점심 외출로 ‘떠남’이 찍혀도, 다시 ‘도착’하면 퇴근 기록이 지워지고 마지막 이탈 시각이 퇴근으로 남아요.</div>
    </div>

    <div class="card"><h2>공휴일 (${year}~${year + 1})</h2>
      <div class="sub">대한민국 공휴일이 기본 반영돼 있어요. 체크를 끄면 근무일로 계산해요. 회사 지정 휴일은 추가할 수 있어요.</div>
      <details style="margin-top:8px"><summary style="color:var(--accent);font-weight:600">공휴일 목록 보기 (${holList.length}개)</summary>
      <div style="margin-top:8px">${holList.map((d) => {
        const h = hols[d]; const off = (s.disabledHolidays || []).includes(d);
        return `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)">
          <label class="inline" style="flex:1"><input type="checkbox" style="flex:none" data-action="toggle-hol" data-ds="${d}" ${off ? '' : 'checked'}>
          <span style="flex:1">${d.slice(2).replace(/-/g, '.')} (${W.DOW[W.dowOf(d)]}) ${esc(h.name)}${h.builtin ? '' : ' <span class="tag leave">회사</span>'}</span></label>
          ${h.builtin ? '' : `<button class="btn small danger" data-action="del-hol" data-ds="${d}">삭제</button>`}</div>`;
      }).join('')}</div></details>
      <label class="f">회사 지정 휴일 추가</label>
      <div class="inline"><input type="date" id="h-date"><input type="text" id="h-name" placeholder="이름" value="회사 휴무"></div>
      <div class="btns"><button class="btn secondary" data-action="add-hol">추가</button></div>
    </div>

    <div class="card"><h2>백업</h2>
      <div class="sub">데이터는 이 아이폰(Safari)에만 저장돼요. 가끔 ‘파일’ 앱이나 iCloud에 백업해두세요.
        ${lastBackup == null ? '<b style="color:var(--warn)">아직 백업한 적이 없어요.</b>' : `마지막 백업: ${lastBackup === 0 ? '오늘' : lastBackup + '일 전'}`}</div>
      <div class="btns"><button class="btn" data-action="export-json">백업 파일 저장</button></div>
      <div class="btns"><button class="btn secondary" data-action="import-json">백업 복원</button>
        <button class="btn secondary" data-action="export-csv">CSV 내보내기</button></div>
      <input type="file" id="file-json" accept=".json,application/json" hidden>
      <label class="f">기록 텍스트 붙여넣기 (줄마다 “in 2026-11-19T08:31” 형식)</label>
      <textarea id="paste-log" rows="3" placeholder="in 2026-11-19T08:31&#10;out 2026-11-19T18:47"></textarea>
      <div class="btns"><button class="btn secondary" data-action="import-text">텍스트 기록 가져오기</button></div>
    </div>

    <div class="card"><h2>초기화</h2>
      <button class="btn danger" data-action="reset">모든 데이터 삭제</button>
    </div>
    <div class="sub" style="text-align:center;margin:10px 0 20px">근무시간 v1</div>`;
  }

  /* ---------- 백업 ---------- */
  function shareOrDownload(name, text, type) {
    const blob = new Blob([text], { type });
    let file = null;
    try { file = new File([blob], name, { type }); } catch (e) { /* 구형 브라우저 */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).then(() => true).catch(() => false);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return Promise.resolve(true);
  }
  function exportJson() {
    const stamp = W.ymd(new Date());
    state.settings.lastBackup = new Date().toISOString();
    const text = JSON.stringify(state, null, 1);
    shareOrDownload(`worktime-backup-${stamp}.json`, text, 'application/json').then((ok) => {
      if (ok) { save(); render(); toast('백업 파일을 만들었어요'); }
    });
  }
  function exportCsv() {
    const rows = [['날짜', '요일', '실제출근', '실제퇴근', '인정출근', '인정퇴근', '순수근무(분)', '휴가', '약속', '메모']];
    Object.keys(state.days).sort().forEach((ds) => {
      const r = state.days[ds];
      const n = W.dayNet(r, ds, '', 0);
      rows.push([ds, W.DOW[W.dowOf(ds)], r.in || '', r.out || '', r.in ? W.roundIn(r.in) : '', r.out ? W.roundOut(r.out) : '',
        n.status === 'done' ? n.min : '', r.leave ? W.LEAVE[r.leave].label : '', r.noOT ? 'Y' : '', r.memo || '']);
    });
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    shareOrDownload(`worktime-${W.ymd(new Date())}.csv`, csv, 'text/csv');
  }
  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let s;
      try { s = normalize(JSON.parse(reader.result)); } catch (e) { s = null; }
      if (!s) { toast('올바른 백업 파일이 아니에요'); return; }
      if (!confirm(`백업(${Object.keys(s.days).length}일 기록)으로 현재 데이터를 덮어쓸까요?`)) return;
      state = s; save(); render(); toast('복원했어요');
    };
    reader.readAsText(file);
  }
  function importText(text) {
    const re = /(in|out|출근|퇴근|도착|떠남)[\s,]+(\d{4}[-./]\s?\d{1,2}[-./]\s?\d{1,2}\.?[T\s]+\d{1,2}:\d{2})/gi;
    let m, n = 0;
    while ((m = re.exec(text))) {
      const type = /^(in|출근|도착)$/i.test(m[1]) ? 'in' : 'out';
      const pt = W.parseEventTime(m[2], new Date());
      if (pt) { W.applyEvent(state, type, pt.ds, pt.time, 'import'); n++; }
    }
    if (n) { save(); render(); }
    toast(n ? `${n}건 가져왔어요` : '가져올 기록을 찾지 못했어요');
  }

  /* ---------- 단축어 URL 처리 ---------- */
  function handleUrl() {
    const q = new URLSearchParams(location.search);
    const e = (q.get('e') || q.get('action') || '').toLowerCase();
    if (!e) return;
    history.replaceState(null, '', location.pathname);
    const type = /^(in|출근|arrive|도착)$/.test(e) ? 'in' : /^(out|퇴근|leave|떠남)$/.test(e) ? 'out' : null;
    if (!type) return;
    const pt = W.parseEventTime(q.get('t'), new Date());
    if (!pt) { toast('시간 형식을 읽지 못했어요: ' + q.get('t'), 4000); return; }
    const rec = state.days[pt.ds];
    if (rec && rec.events && rec.events.some((x) => x.type === type && x.time === pt.time)) {
      toast('이미 기록된 시각이에요'); return;
    }
    W.applyEvent(state, type, pt.ds, pt.time, 'shortcut');
    save();
    const today = pt.ds === W.ymd(new Date()) ? '' : md(pt.ds) + ' ';
    toast(type === 'in'
      ? `✓ ${today}출근 ${pt.time} 기록 → ${W.roundIn(pt.time)} 인정`
      : `✓ ${today}퇴근 ${pt.time} 기록 → ${W.roundOut(pt.time)} 인정`, 4000);
  }

  /* ---------- 렌더 & 이벤트 ---------- */
  const TITLES = { today: '오늘', plan: '계획', log: '기록', settings: '설정' };
  function render() {
    $('#title').textContent = tab === 'today'
      ? (() => { const d = new Date(); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${W.DOW[d.getDay()]}요일`; })()
      : TITLES[tab];
    const fn = { today: renderToday, plan: renderPlan, log: renderLog, settings: renderSettings }[tab];
    $('#view').innerHTML = fn();
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  }
  function setTab(t) { tab = t; if (t !== 'settings') viewYm = viewYm || ymOf(new Date()); render(); window.scrollTo(0, 0); }

  document.addEventListener('click', (ev) => {
    const tabBtn = ev.target.closest('.tabbar button');
    if (tabBtn) { if (tabBtn.dataset.tab === 'today') viewYm = ymOf(new Date()); setTab(tabBtn.dataset.tab); return; }
    const el = ev.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
    const a = el.dataset.action, ds = el.dataset.ds;
    switch (a) {
      case 'prev-month': viewYm = shiftYm(viewYm, -1); render(); break;
      case 'next-month': viewYm = shiftYm(viewYm, 1); render(); break;
      case 'goto': setTab(el.dataset.tab); break;
      case 'edit-day': openDay(ds); break;
      case 'close-sheet': closeSheet(); break;
      case 'save-day': saveDay(ds); break;
      case 'clear-day':
        if (confirm(`${mdw(ds)} 기록을 모두 지울까요?`)) { delete state.days[ds]; save(); closeSheet(); render(); toast('지웠어요'); }
        break;
      case 'punch': {
        const t = nowHM(), type = el.dataset.type, today = W.ymd(new Date());
        const rec = state.days[today] || (state.days[today] = {});
        if (type === 'in' && rec.out) delete rec.out; // 퇴근 후 재출근
        W.applyEvent(state, type, today, t, 'button');
        if (type === 'out') rec.out = t;
        save(); render();
        toast(type === 'in' ? `출근 ${t} → ${W.roundIn(t)} 인정` : `퇴근 ${t} → ${W.roundOut(t)} 인정`);
        break;
      }
      case 'toggle-noot': {
        ev.stopPropagation();
        const rec = state.days[ds] || {};
        if (rec.noOT) delete rec.noOT; else rec.noOT = true;
        commitDay(ds, rec); render();
        toast(rec.noOT ? `${mdw(ds)} 오버타임 제외` : `${mdw(ds)} 오버타임 가능`);
        break;
      }
      case 'set-mode': {
        const c = state.months[viewYm] || (state.months[viewYm] = {});
        c.mode = el.dataset.mode; save(); render(); break;
      }
      case 'copy': {
        const text = el.dataset.text;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
          () => toast('복사했어요'), () => { prompt('복사해서 사용하세요', text); });
        break;
      }
      case 'toggle-hol': {
        const list = state.settings.disabledHolidays || (state.settings.disabledHolidays = []);
        const i = list.indexOf(ds);
        if (el.checked) { if (i >= 0) list.splice(i, 1); } else if (i < 0) list.push(ds);
        save(); break;
      }
      case 'del-hol': delete state.settings.customHolidays[ds]; save(); render(); break;
      case 'add-hol': {
        const d = $('#h-date').value, n = $('#h-name').value.trim() || '회사 휴무';
        if (!d) { toast('날짜를 선택해주세요'); break; }
        state.settings.customHolidays[d] = n;
        const list = state.settings.disabledHolidays; const i = list.indexOf(d); if (i >= 0) list.splice(i, 1);
        save(); render(); toast(`${md(d)} ${n} 추가`); break;
      }
      case 'export-json': exportJson(); break;
      case 'export-csv': exportCsv(); break;
      case 'import-json': $('#file-json').click(); break;
      case 'import-text': importText($('#paste-log').value); break;
      case 'reset':
        if (confirm('모든 기록과 설정을 삭제할까요? 되돌릴 수 없어요.') && confirm('정말 삭제할까요? 백업은 하셨나요?')) {
          state = defaults(); save(); render(); toast('초기화했어요');
        }
        break;
    }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'file-json' && el.files[0]) { importJsonFile(el.files[0]); el.value = ''; return; }
    if (el.dataset.setting) {
      const k = el.dataset.setting;
      if (k === 'otCap') state.settings.otCap = Number(el.value);
      else if (el.value) state.settings[k] = el.value;
      save(); toast('저장했어요'); return;
    }
    const a = el.dataset.action;
    if (a === 'set-target') {
      const c = state.months[viewYm] || (state.months[viewYm] = {});
      if (el.value) c.target = el.value; else delete c.target;
      save(); render();
    } else if (a === 'set-early' && el.value) {
      const c = state.months[viewYm] || (state.months[viewYm] = {});
      c.earlyTime = el.value; save(); render();
    } else if (a === 'change-date' && el.value) {
      openDay(el.value);
    }
  });

  // 오늘 탭은 근무 중 시간이 갱신되도록 주기적으로 다시 그림
  setInterval(() => { if (tab === 'today' && $('#sheet').classList.contains('hidden') && document.visibilityState === 'visible') render(); }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { state = load(); handleUrl(); if ($('#sheet').classList.contains('hidden')) render(); }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { state = load(); handleUrl(); render(); } });

  // 시작
  handleUrl();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
