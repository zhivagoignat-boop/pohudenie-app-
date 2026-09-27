/* Генератор постоянного отчёта для Claude.
   Работает и в браузере (вкладка «Отчёт»), и в Node (scripts/build-report.mjs). */
(function (root) {
  'use strict';

  var D = root.APP_DATA;
  var S = root.Store;

  function r1(x) { return Math.round(x * 10) / 10; }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function bar(p) {
    var n = Math.max(0, Math.min(10, Math.round(p / 10)));
    return '█'.repeat(n) + '░'.repeat(10 - n);
  }
  function sign(x) { return (x > 0 ? '+' : '') + r1(x); }

  function totalDaysOf(state) {
    if (!state.profile.startDate || !state.profile.endDate) return 0;
    return Math.max(1, S.diffDays(state.profile.startDate, state.profile.endDate));
  }
  function weeklyLossOf(state) {
    var d = totalDaysOf(state);
    if (!d) return D.program.weeklyLossDefault;
    return Math.round((state.profile.startWeight - state.profile.goalWeight) / (d / 7) * 10) / 10;
  }

  /* Питание конкретного дня по ПЕРЕДАННОМУ state (не по глобальному хранилищу) */
  function nutritionOf(state, date) {
    var d = state.days[date];
    var sum = { kcal: 0, p: 0, f: 0, c: 0, fb: 0, meals: [] };
    if (!d || !d.m) return sum;
    ['breakfast', 'lunch', 'snack', 'dinner', 'extra'].forEach(function (slot) {
      var id = d.m[slot];
      if (!id) return;
      var opt = S.findOption(slot, id);
      if (!opt) return;
      sum.kcal += opt.kcal; sum.p += opt.p; sum.f += opt.f || 0; sum.c += opt.c || 0; sum.fb += opt.fb || 0;
      var name = opt.name;
      if (opt.bb) {
        var i = d.m[slot + 'BB'] || 0;
        var bbName = ((state.bb && state.bb[opt.bbSlot]) || [])[i];
        name = 'БодиБалансом: ' + (bbName || ('опция ' + (i + 1)));
      }
      sum.meals.push({ slot: slot, name: name, kcal: opt.kcal, p: opt.p });
    });
    (d.m.add || []).forEach(function (a) {
      sum.kcal += +a.k || 0; sum.p += +a.p || 0; sum.f += +a.f || 0; sum.c += +a.c || 0; sum.fb += +a.fb || 0;
      sum.meals.push({ slot: a.src || 'add', name: a.n, kcal: +a.k || 0, p: +a.p || 0 });
    });
    if (d.m.freeKcal) {
      sum.kcal += +d.m.freeKcal; sum.p += (+d.m.freeP || 0);
      sum.meals.push({ slot: 'free', name: 'Своё', kcal: +d.m.freeKcal, p: +d.m.freeP || 0 });
    }
    sum.fb = Math.round(sum.fb * 10) / 10;
    return sum;
  }

  /* Есть ли в дне реальные данные. Пустая заготовка дня создаётся при простом
     листании календаря, и раньше она расширяла период отчёта на будущие дни. */
  function dayHasContent(x) {
    if (!x) return false;
    if (x.w && (x.w.done || x.w.skipped)) return true;
    var ex = (x.w && x.w.ex) || {};
    if (Object.keys(ex).some(function (i) { return ex[i].done || ex[i].kg != null || ex[i].note; })) return true;
    if (x.w && x.w.cardio && x.w.cardio.done) return true;
    if (x.m && Object.keys(x.m).some(function (i) { return x.m[i]; })) return true;
    return !!(x.steps || x.sleep || x.water || x.pain || x.energy || (x.note && x.note.trim()));
  }

  /* Все даты программы от старта до «сегодня» включительно */
  function datesUpTo(state, now) {
    var days = state.days || {};
    var logged = Object.keys(days).filter(function (d) { return dayHasContent(days[d]); })
      .concat((state.weights || []).map(function (w) { return w.d; })).sort();
    var start = state.profile.startDate;
    var end = now;
    if (logged.length) {
      if (logged[0] < start) start = logged[0];                       // ничего записанное не теряем
      if (logged[logged.length - 1] > end) end = logged[logged.length - 1];
    }
    var out = [];
    if (S.diffDays(start, end) < 0) return out;
    for (var d = start; S.diffDays(d, end) >= 0 && out.length < 1000; d = S.addDays(d, 1)) out.push(d);
    return out;
  }

  function lastN(dates, n) { return dates.slice(Math.max(0, dates.length - n)); }

  /* ---------- блоки ---------- */

  function weightBlock(state, now, L) {
    var p = D.program;
    var ws = (state.weights || []).slice();
    var start = ws.length ? ws[0] : { d: state.profile.startDate, kg: state.profile.startWeight };
    var cur = ws.length ? ws[ws.length - 1] : null;
    var planNow = S.planWeight(now);
    L.push('## ⚖️ ВЕС');
    L.push('');
    if (!cur) {
      L.push('> Взвешиваний ещё нет. Стартовый вес по плану — ' + state.profile.startWeight + ' кг.');
      L.push('');
      return;
    }
    var lost = start.kg - cur.kg;
    var left = cur.kg - state.profile.goalWeight;
    var stale = S.diffDays(cur.d, now);                  // сколько дней назад взвешивались
    var delta = cur.kg - S.planWeight(cur.d);            // сравниваем с планом НА ДАТУ взвешивания
    var total = state.profile.startWeight - state.profile.goalWeight;
    L.push('| Параметр | Значение |');
    L.push('|---|---|');
    L.push('| Старт (' + S.human(start.d) + ') | ' + r1(start.kg) + ' кг |');
    L.push('| Сейчас (' + S.human(cur.d) + ') | **' + r1(cur.kg) + ' кг** |');
    L.push('| Цель | ' + state.profile.goalWeight + ' кг |');
    L.push('| Сброшено | **' + r1(lost) + ' кг** из ' + r1(total) + ' (' + pct(lost, total) + '%) |');
    L.push('| Осталось | ' + r1(left) + ' кг |');
    L.push('| План на сегодня | ' + r1(planNow) + ' кг |');
    L.push('| Отклонение от плана (на дату взвешивания) | **' + sign(delta) + ' кг** ' + (delta > 0.5 ? '⚠️ отстаём' : (delta < -0.5 ? '✅ опережаем' : '✅ в графике')) + ' |');
    if (stale > 2) L.push('| ⚠️ Свежесть | взвешивание ' + stale + ' дн. назад — сравнивать с сегодняшней кривой рано |');
    L.push('| Прогресс | `' + bar(pct(lost, total)) + '` ' + pct(lost, total) + '% |');

    // фактический темп
    var days = S.diffDays(start.d, cur.d);
    if (days >= 7) {
      var rate = lost / days * 7;
      L.push('| Темп факт | ' + r1(rate) + ' кг/нед (план ' + weeklyLossOf(state) + ') |');
      if (rate > 0.05) {
        var weeksLeft = left / rate;
        var eta = S.addDays(cur.d, Math.round(weeksLeft * 7));
        L.push('| Прогноз достижения ' + state.profile.goalWeight + ' кг | ' + S.human(eta) + ' ' + S.parse(eta).getFullYear() +
               ' (цель — ' + S.human(state.profile.endDate) + ' ' + S.parse(state.profile.endDate).getFullYear() + ') |');
      }
    }
    var waists = ws.filter(function (w) { return w.waist; });
    if (waists.length) {
      var fw = waists[0], lw = waists[waists.length - 1];
      L.push('| Талия | **' + r1(lw.waist) + ' см**' +
        (waists.length > 1 ? ' (' + sign(lw.waist - fw.waist) + ' см от ' + r1(fw.waist) + ')' : '') + ' |');
    }
    L.push('');
    L.push('**Последние взвешивания:**');
    L.push('');
    var anyWaist = ws.some(function (w) { return w.waist; });
    L.push('| Дата | Вес | Δ к пред. | Δ к плану |' + (anyWaist ? ' Талия |' : ''));
    L.push('|---|---|---|---|' + (anyWaist ? '---|' : ''));
    var tail = ws.slice(Math.max(0, ws.length - 8));
    tail.forEach(function (w, i) {
      var prev = i > 0 ? tail[i - 1] : null;
      var idxAll = ws.indexOf(w);
      if (!prev && idxAll > 0) prev = ws[idxAll - 1];
      L.push('| ' + S.human(w.d) + ' | ' + r1(w.kg) + ' кг | ' + (prev ? sign(w.kg - prev.kg) : '—') +
             ' | ' + sign(w.kg - S.planWeight(w.d)) + ' |' + (anyWaist ? ' ' + (w.waist ? r1(w.waist) + ' см' : '—') + ' |' : ''));
    });
    L.push('');
  }

  function workoutStats(state, dates) {
    var res = { planned: 0, done: 0, optPlanned: 0, optDone: 0, extra: 0, skipped: [], missed: [], log: [] };
    dates.forEach(function (date) {
      var d = state.days[date];
      var plan = S.plannedWorkout(date);
      var logged = (d && d.w && d.w.id && D.workouts[d.w.id]) ? D.workouts[d.w.id] : null;
      var wk = plan || logged;
      if (!wk) return;
      var done = !!(d && d.w && d.w.done);
      res.log.push({ date: date, id: (logged || wk).id, title: (logged || wk).title, done: done, skipped: !!(d && d.w && d.w.skipped), planned: !!plan });
      if (!plan) { if (done) res.extra++; return; }          // тренировка вне графика
      if (plan.optional) { res.optPlanned++; if (done) res.optDone++; return; }
      res.planned++;
      if (done) res.done++;
      else if (d && d.w && d.w.skipped) res.skipped.push(date);
      else res.missed.push(date);
    });
    return res;
  }

  function workoutBlock(state, now, dates, L) {
    var all = workoutStats(state, dates);
    var w14 = workoutStats(state, lastN(dates, 14));
    L.push('## 🏋️ ТРЕНИРОВКИ');
    L.push('');
    L.push('| Период | Обязательных (Пн/Ср/Пт) | Выполнено | % | Опциональных (Сб) |');
    L.push('|---|---|---|---|---|');
    L.push('| Всего с начала | ' + all.planned + ' | ' + all.done + ' | **' + pct(all.done, all.planned) + '%** | ' + all.optDone + '/' + all.optPlanned + ' |');
    L.push('| Последние 14 дней | ' + w14.planned + ' | ' + w14.done + ' | **' + pct(w14.done, w14.planned) + '%** | ' + w14.optDone + '/' + w14.optPlanned + ' |');
    L.push('');
    var recent = all.log.slice(Math.max(0, all.log.length - 6)).reverse();
    if (recent.length) {
      L.push('**Последние тренировочные дни:**');
      L.push('');
      recent.forEach(function (r) {
        var d = state.days[r.date];
        var pl = S.plannedWorkout(r.date);
        var optional = !!(pl && pl.optional);
        var mark = r.done ? '✅' : (r.skipped ? '⏭️ пропуск' : (optional ? '— опционально, не делал' : '❌ не отмечено'));
        var exDone = d && d.w ? Object.keys(d.w.ex || {}).filter(function (k) { return d.w.ex[k].done; }).length : 0;
        var total = D.workouts[r.id].exercises.length;
        var cardio = d && d.w && d.w.cardio && d.w.cardio.done ? ', кардио ✅' : '';
        L.push('- ' + S.human(r.date) + ' — ' + r.title.replace(/ —.*/, '') + ' ' + mark + ' (' + exDone + '/' + total + ' упр.' + cardio + ')' +
               (d && d.note ? ' · _' + d.note + '_' : ''));
      });
      L.push('');
    }
    if (all.extra) { L.push('➕ Тренировок вне графика: ' + all.extra); L.push(''); }
    if (all.missed.length) {
      L.push('⚠️ **Не отмечено/пропущено:** ' + all.missed.slice(-6).map(S.human).join(', '));
      L.push('');
    }
    return all;
  }

  function shoulderBlock(state, now, dates, L) {
    var win = lastN(dates, 21);
    L.push('## 🚨 ПЛЕЧО (критичный блок)');
    L.push('');
    L.push('| Упражнение | Плановых | Сделано | Последний раз | Статус |');
    L.push('|---|---|---|---|---|');
    var alerts = [];
    D.shoulder.critical.forEach(function (c) {
      var planned = 0, done = 0, last = null;
      win.forEach(function (date) {
        var wk = S.plannedWorkout(date);
        if (wk && !wk.optional && wk.exercises.some(function (e) { return c.exIds.indexOf(e.id) >= 0; })) planned++;
        var d = state.days[date];
        var ex = d && d.w ? d.w.ex : null;
        if (!ex) return;
        var hit = c.exIds.some(function (id) { return ex[id] && ex[id].done; });
        if (hit) { done++; last = date; }
      });
      var ok = planned === 0 ? true : done / planned >= 0.8;
      if (!ok) alerts.push(c.name + ': ' + done + ' из ' + planned + ' за 3 недели');
      L.push('| **' + c.name + '** (' + c.sets + ', ' + c.days + ') | ' + planned + ' | ' + done + ' | ' +
             (last ? S.human(last) : '—') + ' | ' + (ok ? '✅' : '🔴 пробел') + ' |');
    });
    L.push('');
    var pains = win.map(function (date) { return { d: date, p: (state.days[date] && state.days[date].pain) || 0 }; })
                   .filter(function (x) { return x.p > 0; });
    if (pains.length) {
      var max = Math.max.apply(null, pains.map(function (x) { return x.p; }));
      var names = ['нет', 'лёгкий дискомфорт', 'заметная боль', 'сильная боль/щелчки'];
      L.push('🔴 **Боль в плече отмечена ' + pains.length + ' раз(а) за 3 недели**, максимум — «' + names[max] + '»:');
      L.push('');
      pains.slice(-6).forEach(function (x) { L.push('- ' + S.human(x.d) + ': ' + names[x.p]); });
      L.push('');
      if (max >= 3) alerts.push('Отмечены щелчки/сильная боль в плече — по плану это СТОП-сигнал');
    } else {
      L.push('Боль в плече за 3 недели не отмечалась. 🟢');
      L.push('');
    }
    return alerts;
  }

  function strengthBlock(state, dates, L) {
    var byEx = {};
    dates.forEach(function (date) {
      var d = state.days[date];
      if (!d || !d.w || !d.w.ex) return;
      Object.keys(d.w.ex).forEach(function (id) {
        var st = d.w.ex[id];
        if (!st || st.kg == null || st.kg === '') return;
        (byEx[id] = byEx[id] || []).push({ d: date, kg: +st.kg });
      });
    });
    var ids = Object.keys(byEx);
    L.push('## 💪 СИЛОВЫЕ ПОКАЗАТЕЛИ');
    L.push('');
    if (!ids.length) { L.push('_Рабочие веса пока не записаны._'); L.push(''); return; }
    L.push('| Упражнение | Первый вес | Последний | Δ | Записей |');
    L.push('|---|---|---|---|---|');
    ids.forEach(function (id) {
      var name = exName(id), arr = byEx[id];
      var a = arr[0], b = arr[arr.length - 1];
      L.push('| ' + name + ' | ' + a.kg + ' кг (' + S.human(a.d) + ') | **' + b.kg + ' кг** | ' +
             (arr.length > 1 ? sign(b.kg - a.kg) + ' кг' : '—') + ' | ' + arr.length + ' |');
    });
    L.push('');
  }

  function exName(id) {
    var out = id;
    D.workoutOrder.forEach(function (w) {
      D.workouts[w].exercises.forEach(function (e) {
        if (e.id === id) out = e.name + ' · ' + D.workouts[w].short;
      });
    });
    return out;
  }

  function nutritionBlock(state, dates, L) {
    var p = D.program;
    var win = lastN(dates, 14);
    var logged = [], kcalSum = 0, pSum = 0, fbSum = 0, inRange = 0, lowP = 0;
    win.forEach(function (date) {
      var n = nutritionOf(state, date);
      if (!n.kcal) return;
      logged.push({ d: date, n: n });
      kcalSum += n.kcal; pSum += n.p; fbSum += n.fb || 0;
      if (n.kcal >= p.kcalTarget[0] - 150 && n.kcal <= p.kcalHardMax) inRange++;
      if (n.p < p.proteinMin) lowP++;
    });
    L.push('## 🍽️ ПИТАНИЕ (14 дней)');
    L.push('');
    if (!logged.length) { L.push('_За последние 14 дней питание не отмечалось._'); L.push(''); return { logged: 0 }; }
    var avgK = Math.round(kcalSum / logged.length), avgP = Math.round(pSum / logged.length);
    var avgFb = Math.round(fbSum / logged.length * 10) / 10;
    L.push('| Параметр | Факт | Цель |');
    L.push('|---|---|---|');
    L.push('| Дней отмечено | ' + logged.length + ' из ' + win.length + ' | все |');
    L.push('| Средние калории | **' + avgK + ' ккал** | ' + p.kcalTarget[0] + '–' + p.kcalTarget[1] + ' |');
    L.push('| Средний белок | **' + avgP + ' г** | ' + p.protein[0] + '–' + p.protein[1] + ' (минимум ' + p.proteinMin + ') |');
    L.push('| Дней в коридоре калорий | ' + inRange + '/' + logged.length + ' | — |');
    L.push('| Дней с белком ниже ' + p.proteinMin + ' г | ' + lowP + '/' + logged.length + ' | 0 |');
    L.push('| Клетчатка (среднее) | **' + avgFb + ' г** | ' + p.fiber[0] + '–' + p.fiber[1] + ' |');
    L.push('');
    L.push('**Последние дни:**');
    L.push('');
    L.push('| Дата | Ккал | Белок | Что ел |');
    L.push('|---|---|---|---|');
    logged.slice(-7).forEach(function (x) {
      L.push('| ' + S.human(x.d) + ' | ' + x.n.kcal + ' | ' + x.n.p + ' г | ' +
             x.n.meals.map(function (m) { return m.name; }).join(' · ') + ' |');
    });
    L.push('');
    return { logged: logged.length, avgK: avgK, avgP: avgP, avgFb: avgFb, lowP: lowP, total: win.length };
  }

  function regimeBlock(state, dates, L) {
    var win = lastN(dates, 14);
    var steps = [], sleep = [];
    win.forEach(function (date) {
      var d = state.days[date];
      if (!d) return;
      if (d.steps) steps.push(+d.steps);
      if (d.sleep) sleep.push(+d.sleep);
    });
    var avg = function (a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; };
    var avgSleep = sleep.length ? r1(sleep.reduce(function (x, y) { return x + y; }, 0) / sleep.length) : null;
    L.push('## 🚶 РЕЖИМ (14 дней)');
    L.push('');
    L.push('| Параметр | Факт | Цель |');
    L.push('|---|---|---|');
    L.push('| Шаги (среднее) | ' + (steps.length ? avg(steps) + ' (' + steps.length + ' дн.)' : '—') + ' | ' + D.program.stepsTarget + ' |');
    L.push('| Сон (среднее) | ' + (avgSleep != null ? avgSleep + ' ч (' + sleep.length + ' дн.)' : '—') + ' | ' + D.program.sleepTarget + ' ч |');
    L.push('');
    return { steps: steps.length ? avg(steps) : null, sleep: avgSleep };
  }

  /* ---------- главный сборщик ---------- */

  function buildReport(state, opts) {
    opts = opts || {};
    var now = opts.now || S.today();
    var L = [];
    var p = D.program;
    var dayNo = S.diffDays(state.profile.startDate, now) + 1;
    var left = S.diffDays(now, state.profile.endDate);
    var dates = datesUpTo(state, now);

    L.push('# 📊 ОТЧЁТ ДЛЯ CLAUDE — «Жизнь на похудение»');
    L.push('');
    L.push('**Сформирован:** ' + S.human(now) + ' ' + S.parse(now).getFullYear() +
           '  |  **День программы:** ' + (dayNo > 0 ? dayNo : 0) + ' из ' + totalDaysOf(state) +
           '  |  **Осталось:** ' + (left > 0 ? left + ' дн.' : 'финиш') );
    L.push('');
    L.push('> Это живой отчёт приложения. Клод, прочитай его целиком и дай разбор по разделу «Что нужно от тебя» в конце.');
    L.push('');
    L.push('---');
    L.push('');

    weightBlock(state, now, L);
    L.push('---');
    L.push('');
    var wk = workoutBlock(state, now, dates, L);
    L.push('---');
    L.push('');
    var shoulderAlerts = shoulderBlock(state, now, dates, L);
    L.push('---');
    L.push('');
    strengthBlock(state, dates, L);
    L.push('---');
    L.push('');
    var nut = nutritionBlock(state, dates, L);
    L.push('---');
    L.push('');
    var reg = regimeBlock(state, dates, L);
    L.push('---');
    L.push('');

    /* флаги */
    var flags = [];
    var cur = state.weights.length ? state.weights[state.weights.length - 1] : null;
    if (cur) {
      var first = state.weights[0];
      if (Math.abs(first.kg - state.profile.startWeight) > 0.5) {
        flags.push('🟠 Стартовый вес в профиле ' + r1(state.profile.startWeight) + ' кг, а первое взвешивание — ' +
          r1(first.kg) + ' кг. Плановая кривая смещена на ' + r1(Math.abs(first.kg - state.profile.startWeight)) +
          ' кг, поэтому «опережение/отставание» врёт. Поправь стартовый вес в «Прогресс → Профиль».');
      }
      var delta = cur.kg - S.planWeight(cur.d);
      if (delta > 1.5) flags.push('🔴 Отставание от плановой кривой на ' + r1(delta) + ' кг — нужен пересмотр дефицита или активности.');
      if (delta < -1.5) flags.push('🟠 Опережение плана на ' + r1(-delta) + ' кг — проверь, не слишком ли агрессивный дефицит (риск потери мышц).');
      if (S.diffDays(cur.d, now) > 10) flags.push('🟠 Последнее взвешивание ' + S.diffDays(cur.d, now) + ' дней назад — взвешивайся по понедельникам утром натощак.');
      var ws = state.weights;
      if (ws.length >= 3) {
        var a = ws[ws.length - 3], b = ws[ws.length - 1];
        if (a.kg - b.kg < 0.3 && S.diffDays(a.d, b.d) >= 12) flags.push('🟠 Вес стоит на месте ' + S.diffDays(a.d, b.d) + ' дней (' + r1(a.kg - b.kg) + ' кг) — плато.');
      }
    } else {
      flags.push('🟠 Нет ни одного взвешивания — без него отчёт почти бесполезен.');
    }
    if (wk.planned && pct(wk.done, wk.planned) < 80) flags.push('🔴 Выполнено только ' + pct(wk.done, wk.planned) + '% обязательных тренировок.');
    shoulderAlerts.forEach(function (a) { flags.push('🔴 ' + a); });
    if (nut.logged && nut.lowP > nut.logged / 2) flags.push('🔴 Белок ниже ' + p.proteinMin + ' г в большинстве дней — на дефиците это потеря мышц. Решение по плану: протеиновый перекус (30 г + молоко + банан).');
    if (nut.logged && nut.avgFb < p.fiber[0]) flags.push('🟠 Клетчатки в среднем ' + nut.avgFb + ' г при норме ' + p.fiber[0] + '–' + p.fiber[1] +
      ' — на готовой еде это обычное дело. Овощи, бобовые, отруби и ягоды закрывают разрыв без готовки.');
    if (nut.logged === 0) flags.push('🟠 Питание не отмечается — непонятно, держится ли коридор 2200–2300 ккал.');
    if (reg.steps && reg.steps < 7000) flags.push('🟠 Средние шаги ' + reg.steps + ' — TDEE 2700 посчитан под 10 000 шагов.');
    if (reg.sleep && reg.sleep < 7) flags.push('🟠 Сон ' + reg.sleep + ' ч — на дефиците это бьёт по восстановлению и голоду.');

    L.push('## 🚩 АВТОМАТИЧЕСКИЕ ФЛАГИ');
    L.push('');
    if (flags.length) flags.forEach(function (f) { L.push('- ' + f); });
    else L.push('- ✅ Критичных отклонений не найдено.');
    L.push('');
    L.push('---');
    L.push('');

    var chkDone = Object.keys(state.checklist || {}).filter(function (k) { return state.checklist[k]; }).length;
    if (chkDone < D.checklist.length) {
      L.push('## 📋 ПОДГОТОВКА К СТАРТУ — ' + chkDone + '/' + D.checklist.length);
      L.push('');
      var partner = (state.profile.partner || '').trim();
      D.checklist.forEach(function (item, i) {
        var text = String(item).replace(/\{partner\}/g, partner ? ' с ' + partner : '');
        L.push('- [' + (state.checklist && state.checklist[i] ? 'x' : ' ') + '] ' + text);
      });
      L.push('');
      L.push('---');
      L.push('');
    }

    if (state.askClaude && state.askClaude.trim()) {
      L.push('## ❓ ВОПРОСЫ ОТ МЕНЯ');
      L.push('');
      state.askClaude.trim().split('\n').forEach(function (line) { if (line.trim()) L.push('- ' + line.trim()); });
      L.push('');
      L.push('---');
      L.push('');
    }

    L.push('## 🤖 ЧТО НУЖНО ОТ ТЕБЯ, CLAUDE');
    L.push('');
    L.push('1. Сверь факт с планом: темп −' + weeklyLossOf(state) + ' кг/нед, цель ' + state.profile.goalWeight + ' кг к ' + S.human(state.profile.endDate) + '. Успеваю?');
    L.push('2. Если есть отставание/плато — что менять первым: калории, кардио, шаги или сон? Дай одно конкретное изменение, не список.');
    L.push('3. Проверь блок «Плечо»: пробелы в Face Pulls / обратном Pec Deck / гиперэкстензии — это риск повторного вывиха.');
    L.push('4. Посмотри силовые: где пора добавлять вес по прогрессии, а где стоять на месте.');
    L.push('5. Белок: если ниже ' + p.proteinMin + ' г — предложи, чем добрать без готовки.');
    L.push('6. Верни ответ коротко: 3–5 пунктов «что делать на следующей неделе».');
    L.push('');
    L.push('---');
    L.push('');
    L.push('<details><summary>Машиночитаемый снимок данных (для точного разбора)</summary>');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(compact(state, now), null, 1));
    L.push('```');
    L.push('');
    L.push('</details>');
    L.push('');
    return L.join('\n');
  }

  /* Короткая сводка — для отправки в чат Telegram (URL ограничен по длине) */
  function brief(state, opts) {
    opts = opts || {};
    var now = opts.now || S.today();
    var dates = datesUpTo(state, now);
    var L = [];
    var dayNo = S.diffDays(state.profile.startDate, now) + 1;
    var cur = state.weights.length ? state.weights[state.weights.length - 1] : null;
    var wk = workoutStats(state, dates);
    var w14 = workoutStats(state, lastN(dates, 14));

    L.push('📊 Похудение — день ' + (dayNo > 0 ? dayNo : 0) + '/' + totalDaysOf(state) +
           ', осталось ' + Math.max(0, S.diffDays(now, state.profile.endDate)) + ' дн.');
    if (cur) {
      var lastWaist = (state.weights.filter(function (w) { return w.waist; }).pop() || {}).waist;
      if (lastWaist) L.push('📏 Талия ' + r1(lastWaist) + ' см');
      var delta = cur.kg - S.planWeight(cur.d);
      L.push('⚖️ ' + r1(cur.kg) + ' кг (' + S.human(cur.d) + '), сброшено ' +
             r1(state.profile.startWeight - cur.kg) + ' кг из ' + r1(state.profile.startWeight - state.profile.goalWeight) +
             ', к плану ' + sign(delta) + ' кг');
    } else L.push('⚖️ Взвешиваний нет');
    L.push('🏋️ Тренировки: ' + wk.done + '/' + wk.planned + ' всего, ' + w14.done + '/' + w14.planned + ' за 2 недели');

    var gaps = [];
    D.shoulder.critical.forEach(function (c) {
      var planned = 0, done = 0;
      lastN(dates, 21).forEach(function (date) {
        var pw = S.plannedWorkout(date);
        if (pw && !pw.optional && pw.exercises.some(function (e) { return c.exIds.indexOf(e.id) >= 0; })) planned++;
        var d = state.days[date], ex = d && d.w ? d.w.ex : null;
        if (ex && c.exIds.some(function (id) { return ex[id] && ex[id].done; })) done++;
      });
      if (planned && done / planned < 0.8) gaps.push(c.name + ' ' + done + '/' + planned);
    });
    L.push(gaps.length ? '🚨 Плечо, пробелы: ' + gaps.join(', ') : '🚨 Плечо: критичные упражнения в норме');

    var logged = 0, kcal = 0, prot = 0, fiber = 0;
    lastN(dates, 14).forEach(function (date) {
      var n = nutritionOf(state, date);
      if (n.kcal) { logged++; kcal += n.kcal; prot += n.p; fiber += n.fb || 0; }
    });
    L.push(logged ? '🍽️ Среднее за 14 дн.: ' + Math.round(kcal / logged) + ' ккал, ' + Math.round(prot / logged) + ' г белка, ' +
                     Math.round(fiber / logged) + ' г клетчатки (' + logged + ' дн.)'
                  : '🍽️ Питание не отмечалось');
    if (state.askClaude && state.askClaude.trim()) L.push('❓ ' + state.askClaude.trim().split('\n').join('; '));
    L.push('');
    L.push('Полный отчёт — в приложении, вкладка «Отчёт».');
    return L.join('\n');
  }

  /* компактный снимок: без пустых дней */
  function compact(state, now) {
    var days = {};
    Object.keys(state.days).forEach(function (d) {
      var x = state.days[d];
      var ex = {};
      Object.keys((x.w && x.w.ex) || {}).forEach(function (id) {
        var e = x.w.ex[id];
        if (e.done || e.kg != null || e.note) ex[id] = { done: !!e.done, kg: e.kg, note: e.note || undefined };
      });
      var meals = {};
      Object.keys((x.m) || {}).forEach(function (k) { if (x.m[k]) meals[k] = x.m[k]; });
      if (!dayHasContent(x)) return;
      days[d] = {
        workout: x.w.done ? 'done' : (x.w.skipped ? 'skipped' : 'partial'),
        ex: Object.keys(ex).length ? ex : undefined,
        cardio: x.w.cardio && x.w.cardio.done ? (x.w.cardio.min || true) : undefined,
        meals: Object.keys(meals).length ? meals : undefined,
        kcal: nutritionOf(state, d).kcal || undefined,
        protein: nutritionOf(state, d).p || undefined,
        fiber: nutritionOf(state, d).fb || undefined,
        added: (x.m && x.m.add && x.m.add.length) ? x.m.add.map(function (a) { return a.n + ' ' + a.k + 'к'; }) : undefined,
        steps: x.steps || undefined, sleep: x.sleep || undefined,
        pain: x.pain || undefined, energy: x.energy || undefined, note: x.note || undefined
      };
    });
    return {
      generatedFor: now,
      profile: state.profile,
      weights: state.weights,
      bodyBalance: state.bb,
      days: days
    };
  }

  root.Report = { build: buildReport, brief: brief, compact: compact };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Report;
})(typeof window !== 'undefined' ? window : globalThis);
