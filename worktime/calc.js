/* 근무시간 계산 로직 (브라우저 / Node 공용) */
(function (root) {
  'use strict';

  // 대한민국 공휴일 (대체공휴일·선거일 포함). 설정 화면에서 추가/해제 가능.
  const HOLIDAYS = {
    // 2025
    '2025-01-01': '신정', '2025-01-27': '임시공휴일', '2025-01-28': '설날 연휴', '2025-01-29': '설날',
    '2025-01-30': '설날 연휴', '2025-03-01': '삼일절', '2025-03-03': '대체공휴일(삼일절)',
    '2025-05-01': '근로자의 날', '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일',
    '2025-06-03': '대통령 선거일', '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절',
    '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일(추석)',
    '2025-10-09': '한글날', '2025-12-25': '성탄절',
    // 2026
    '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)', '2026-05-01': '근로자의 날',
    '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)',
    '2026-06-03': '전국동시지방선거', '2026-06-06': '현충일', '2026-08-15': '광복절',
    '2026-08-17': '대체공휴일(광복절)', '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)', '2026-10-09': '한글날', '2026-12-25': '성탄절',
    // 2027
    '2027-01-01': '신정', '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴',
    '2027-02-09': '대체공휴일(설날)', '2027-03-01': '삼일절', '2027-05-01': '노동절',
    '2027-05-03': '대체공휴일(노동절)', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
    '2027-06-06': '현충일', '2027-07-17': '제헌절', '2027-07-19': '대체공휴일(제헌절)', '2027-08-15': '광복절',
    '2027-08-16': '대체공휴일(광복절)', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
    '2027-10-03': '개천절', '2027-10-04': '대체공휴일(개천절)', '2027-10-09': '한글날',
    '2027-10-11': '대체공휴일(한글날)', '2027-12-25': '성탄절', '2027-12-27': '대체공휴일(성탄절)'
  };

  const DAY_MIN = 480; // 하루 순수 근무 8시간
  const LEAVE = {
    full: { label: '연차', credit: 480 },
    am: { label: '오전반차', credit: 240 },
    pm: { label: '오후반차', credit: 240 },
    quarter: { label: '반반차', credit: 120 }
  };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dowOf = (s) => parseYmd(s).getDay();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = (min) => { min = Math.max(0, Math.round(min)); return pad(Math.floor(min / 60)) + ':' + pad(min % 60); };
  const ceil10 = (m) => Math.ceil(m / 10) * 10;
  const floor10 = (m) => Math.floor(m / 10) * 10;

  /** "H:MM" (음수 허용) */
  function fmtHM(min) {
    const sign = min < 0 ? '-' : '';
    min = Math.abs(Math.round(min));
    return sign + Math.floor(min / 60) + ':' + pad(min % 60);
  }
  /** "8시간 30분" */
  function fmtKo(min) {
    min = Math.abs(Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + '분';
    return m ? h + '시간 ' + m + '분' : h + '시간';
  }

  /**
   * 회사 체류시간(분) → 순수 근무시간(분). 법정 휴게: 4시간 근무 30분, 8시간 근무 1시간.
   * 시각은 10분 단위이므로 8시간 인정에는 9시간 체류가 필요하다.
   */
  function netFromStay(s) {
    if (s <= 0) return 0;
    if (s <= 240) return s;          // 4시간 이하: 휴게 없음 (반차 4시간 근무)
    if (s < 270) return 240;
    if (s < 540) return Math.min(s - 30, 470);
    return s - 60;
  }
  /** 순수 근무시간을 채우는 데 필요한 체류시간 */
  function stayForNet(w) {
    if (w <= 0) return 0;
    if (w <= 240) return w;
    if (w < 480) return w + 30;
    return w + 60;
  }

  /** 출근 10분 올림, 퇴근 10분 내림 */
  const roundIn = (t) => fromMin(ceil10(toMin(t)));
  const roundOut = (t) => fromMin(floor10(toMin(t)));

  function holidayName(state, ds) {
    const s = state.settings;
    if ((s.disabledHolidays || []).includes(ds)) return null;
    return (s.customHolidays || {})[ds] || HOLIDAYS[ds] || null;
  }

  function leaveCredit(leave) { return (LEAVE[leave] && LEAVE[leave].credit) || 0; }

  /** 하루 근무 계산 */
  function dayNet(rec, ds, todayStr, nowMin) {
    rec = rec || {};
    const inM = toMin(rec.in), outM = toMin(rec.out);
    if (inM != null && outM != null) {
      const inR = ceil10(inM), outR = floor10(outM);
      return { status: 'done', inR, outR, stay: Math.max(0, outR - inR), min: netFromStay(outR - inR) };
    }
    if (inM != null && ds === todayStr) {
      const inR = ceil10(inM), outR = floor10(nowMin);
      return { status: 'live', inR, outR, stay: Math.max(0, outR - inR), min: netFromStay(outR - inR) };
    }
    if (inM != null || outM != null) return { status: 'partial', min: 0 };
    return { status: 'none', min: 0 };
  }

  function defaultStartFor(state, rec) {
    const st = state.settings.defaultStart || '08:40';
    if (rec && rec.planStart) return rec.planStart;
    if (rec && rec.leave === 'am') return fromMin(toMin(st) + 300); // 오전반차: 4시간 + 점심 1시간 뒤
    return st;
  }

  /**
   * 월간 계획 계산
   * @returns 월 요약 + 남은 날짜별 추천 근무
   */
  function monthPlan(state, ym, now) {
    const S = state.settings;
    const [y, m] = ym.split('-').map(Number);
    const nDays = new Date(y, m, 0).getDate();
    const todayStr = ymd(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const capMin = Math.max(0, Number(S.otCap != null ? S.otCap : 90));

    const days = [];
    let base = 0, completed = 0, leaveTotal = 0, missing = 0;
    const workdays = [];
    for (let d = 1; d <= nDays; d++) {
      const ds = y + '-' + pad(m) + '-' + pad(d);
      const dow = new Date(y, m - 1, d).getDay();
      const weekend = dow === 0 || dow === 6;
      const hol = holidayName(state, ds);
      const work = !weekend && !hol;
      const rec = state.days[ds] || {};
      const credit = work ? leaveCredit(rec.leave) : 0;
      const net = dayNet(rec, ds, todayStr, nowMin);
      const past = ds < todayStr || (ds === todayStr && !!rec.out);
      if (work) { base += DAY_MIN; workdays.push(ds); }
      leaveTotal += credit;
      if (net.status === 'done') completed += net.min;
      if (work && ds < todayStr && credit < DAY_MIN && net.status !== 'done') missing++;
      days.push({ ds, d, dow, weekend, hol, work, rec, credit, net, past, isToday: ds === todayStr });
    }
    const done = completed + leaveTotal;
    const remaining = base - done;

    // 목표 (휴무 / 조기퇴근)
    const mcfg = (state.months || {})[ym] || {};
    const lastWork = workdays[workdays.length - 1] || null;
    const target = mcfg.target && workdays.includes(mcfg.target) ? mcfg.target : lastWork;
    const tdow = target ? dowOf(target) : null;
    const modeSetting = mcfg.mode || 'auto';
    const mode = modeSetting === 'auto' ? ((tdow === 1 || tdow === 5) ? 'off' : 'early') : modeSetting;
    const earlyTime = mcfg.earlyTime || S.earlyTime || '15:30';
    const targetDay = days.find((x) => x.ds === target) || null;
    const targetActive = mode !== 'none' && !!targetDay && !targetDay.past && targetDay.credit < DAY_MIN;

    const startOf = (x) => (x.isToday && x.rec.in) ? x.rec.in : defaultStartFor(state, x.rec);
    const leaveAt = (start, net) => fromMin(ceil10(toMin(start)) + stayForNet(net));

    const future = days.filter((x) => x.work && !x.past && x.credit < DAY_MIN);
    const planDays = future.filter((x) => !(targetActive && x.ds === target)).map((x) => ({
      ds: x.ds, d: x.d, dow: x.dow, isToday: x.isToday, rec: x.rec,
      normal: DAY_MIN - x.credit, ot: 0, start: startOf(x),
      eligible: !x.rec.noOT && !x.rec.leave
    }));

    let targetPlanned = 0;
    if (targetActive && mode === 'early') {
      const st = startOf(targetDay);
      const stay = Math.max(0, toMin(earlyTime) - ceil10(toMin(st)));
      targetPlanned = Math.min(DAY_MIN - targetDay.credit, netFromStay(stay));
    }

    const normalSum = planDays.reduce((a, x) => a + x.normal, 0);
    const extra = remaining - targetPlanned - normalSum; // >0: 오버타임 필요, <0: 여유
    let shortage = 0;
    if (extra > 0) {
      const eligible = planDays.filter((x) => x.eligible);
      const capUnits = Math.floor(capMin / 10);
      let units = Math.ceil(extra / 10);
      eligible.forEach((x, i) => {
        const give = Math.min(capUnits, Math.ceil(units / (eligible.length - i)));
        x.ot = give * 10; units -= give;
      });
      shortage = Math.max(0, units * 10);
    }
    planDays.forEach((x) => {
      x.planned = x.normal + x.ot;
      x.leaveAt = leaveAt(x.start, x.planned);
    });
    const plannedSum = planDays.reduce((a, x) => a + x.planned, 0);
    const otSum = planDays.reduce((a, x) => a + x.ot, 0);
    const otDays = planDays.filter((x) => x.ot > 0).length;

    let goal = null;
    if (targetDay) {
      const need = remaining - plannedSum; // 목표일에 필요한 근무
      goal = {
        target, dow: tdow, mode, modeSetting, earlyTime, active: targetActive,
        past: targetDay.past, hol: targetDay.hol
      };
      if (targetActive) {
        const st = startOf(targetDay);
        goal.start = roundIn(st);
        goal.need = Math.max(0, need);
        goal.feasible = mode === 'off' ? need <= 0 : need <= DAY_MIN - targetDay.credit;
        goal.surplus = need < 0 ? -need : 0;
        goal.leaveAt = need > 0 ? leaveAt(st, need) : null;
      } else {
        goal.feasible = remaining <= 0;
        goal.deficit = Math.max(0, remaining - plannedSum);
        goal.surplus = Math.max(0, plannedSum - remaining);
      }
    }

    return {
      ym, days, workdays, base, completed, leaveTotal, done, remaining, missing,
      planDays, extra, shortage, otSum, otDays, goal, todayStr, capMin
    };
  }

  /** 단축어/URL 이벤트 시간 파싱: 2026-11-19T08:31, 2026-11-19 08:31:00+09:00 등 */
  function parseEventTime(t, now) {
    if (!t) return { ds: ymd(now), time: fromMin(now.getHours() * 60 + now.getMinutes()) };
    const m = String(t).match(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\.?[T\s]+(\d{1,2}):(\d{2})/);
    if (m) return { ds: m[1] + '-' + pad(m[2]) + '-' + pad(m[3]), time: pad(m[4]) + ':' + m[5] };
    const hm = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if (hm) return { ds: ymd(now), time: pad(hm[1]) + ':' + hm[2] };
    const d = new Date(t);
    if (!isNaN(d)) return { ds: ymd(d), time: fromMin(d.getHours() * 60 + d.getMinutes()) };
    return null;
  }

  /** 출근은 가장 이른 시각, 퇴근은 가장 늦은 시각을 유지 (점심 외출 등에도 안전) */
  function applyEvent(state, type, ds, time, source) {
    const rec = state.days[ds] || (state.days[ds] = {});
    rec.events = rec.events || [];
    rec.events.push({ type, time, source: source || 'auto', at: new Date().toISOString() });
    if (rec.events.length > 30) rec.events = rec.events.slice(-30);
    if (type === 'in') {
      // 퇴근(외출) 이후 다시 도착 → 아직 근무 중이므로 퇴근 기록 해제
      if (rec.out && toMin(time) > toMin(rec.out)) delete rec.out;
      if (!rec.in || toMin(time) < toMin(rec.in)) rec.in = time;
    } else if (type === 'out') {
      if (!rec.out || toMin(time) > toMin(rec.out)) rec.out = time;
    }
    return rec;
  }

  const api = {
    HOLIDAYS, LEAVE, DOW, DAY_MIN, pad, ymd, parseYmd, dowOf, toMin, fromMin, ceil10, floor10,
    fmtHM, fmtKo, netFromStay, stayForNet, roundIn, roundOut, holidayName, leaveCredit, dayNet,
    defaultStartFor, monthPlan, parseEventTime, applyEvent
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WT = api;
})(typeof self !== 'undefined' ? self : this);
