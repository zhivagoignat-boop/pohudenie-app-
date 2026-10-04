/* Интерфейс приложения. Вся логика рендера вкладок. */
(function () {
  'use strict';

  var D = window.APP_DATA, S = window.Store, R = window.Report;
  var TG = window.TG || { active: false, cloud: false, status: 'локально', setMain: function () {}, hideMain: function () {}, setBack: function () {}, haptic: function () {}, confirm: function (m, c) { c(window.confirm(m)); }, alert: function (m) { window.alert(m); }, share: function () {}, pushNow: function (cb) { cb && cb(new Error('нет Telegram')); }, init: function () {} };
  var cur = S.today();           // выбранная дата
  var tab = 'today';
  var timer = null, timerLeft = 0;
  var foodQuery = '', foodGroup = 'Все';
  var movePicker = false;
  var pendingPaste = null;               // текст из буфера, который надо подставить на вкладке «Еда»                 // открыт ли выбор даты для переноса тренировки   // фильтры в списке продуктов с клетчаткой

  /* ---------- утилиты ---------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function view(name) { return $('.view[data-view="' + name + '"]'); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function num(v) { return v === '' || v == null ? null : +v; }

  /* ---------- шапка ---------- */
  function renderTop() {
    var sch = D.schedule[S.weekday(cur)];
    var dayNo = S.diffDays(S.load().profile.startDate, cur) + 1;
    $('#curDate').textContent = S.human(cur) + (cur === S.today() ? ' · сегодня' : '');
    var wkToday = S.plannedWorkout(cur);
    var type = wkToday ? (wkToday.optional ? 'опционально' : 'тренировка') : 'восстановление';
    if (S.movedAt(cur) !== null) type += ' ⇄';
    $('#curMeta').textContent = sch.name + ' · ' + type + (dayNo > 0 && dayNo <= S.totalDays() ? ' · день ' + dayNo + '/' + S.totalDays() : '');
    var st = S.load();
    var last = S.lastWeight();
    var lost = last ? st.profile.startWeight - last.kg : 0;
    var total = st.profile.startWeight - st.profile.goalWeight;
    $('#topProgress').style.width = Math.max(0, Math.min(100, lost / total * 100)) + '%';
  }

  /* ---------- СЕГОДНЯ ---------- */
  function renderToday() {
    var st = S.load(), d = S.day(cur, true);
    var sch = D.schedule[S.weekday(cur)];
    var wk = workoutForDate(cur);
    var last = S.lastWeight();
    var planNow = S.planWeight(cur);
    var delta = last ? last.kg - S.planWeight(last.d) : null;
    var left = S.diffDays(cur, st.profile.endDate);
    var n = S.nutrition(cur);
    var kcalPct = Math.min(100, n.kcal / D.program.kcalTarget[1] * 100);
    var pPct = Math.min(100, n.p / D.program.protein[0] * 100);

    var h = '';
    h += '<div class="grid2">' +
      stat(last ? r1(last.kg) + ' кг' : '—', 'текущий вес') +
      stat(last ? (delta > 0 ? '+' : '') + r1(delta) + ' кг' : '—', 'к плановой кривой') +
      '</div><div class="grid2" style="margin-top:10px">' +
      stat(last ? r1(st.profile.startWeight - last.kg) + ' кг' : '0 кг', 'сброшено') +
      stat(left > 0 ? left : 0, 'дней до цели') +
      '</div>';

    // взвешивание
    var weighedToday = st.weights.filter(function (w) { return w.d === cur; })[0];
    if (S.weekday(cur) === 1 || weighedToday) {
      h += '<div class="card" style="margin-top:12px"><h3>⚖️ Взвешивание' + (S.weekday(cur) === 1 ? ' (понедельник)' : '') + '</h3>' +
        '<p class="small muted">Утром, натощак, после туалета, без одежды, те же весы. План на сегодня: ' + r1(planNow) + ' кг.</p>' +
        '<div class="grid2">' +
        '<label class="field"><span>Вес, кг</span><input type="number" step="0.1" inputmode="decimal" id="wIn" placeholder="' + r1(planNow) + '" value="' + (weighedToday ? weighedToday.kg : '') + '"></label>' +
        '<label class="field"><span>Талия, см</span><input type="number" step="0.5" inputmode="decimal" id="waistIn" placeholder="на уровне пупка" value="' + (weighedToday && weighedToday.waist ? weighedToday.waist : '') + '"></label>' +
        '</div>' +
        '<button class="btn-primary btn-wide" id="wSave">Записать</button></div>';
    }

    // тренировка
    h += '<h2>Тренировка</h2><div class="card">';
    if (wk) {
      var exDone = Object.keys(d.w.ex).filter(function (k) { return d.w.ex[k].done; }).length;
      h += '<div class="row spread"><strong>' + esc(wk.title) + '</strong>' +
        '<span class="badge ' + (d.w.done ? 'ok' : (d.w.skipped ? 'bad' : 'train')) + '">' +
        (d.w.done ? 'выполнена' : (d.w.skipped ? 'пропущена' : exDone + '/' + wk.exercises.length)) + '</span></div>' +
        '<p class="small muted">' + wk.duration + ' мин · ~' + wk.kcal + ' ккал · ' + wk.exercises.length + ' упражнений' +
        (sch.type === 'optional' ? ' · опционально' : '') + '</p>' +
        '<button class="btn-primary btn-wide" data-goto="workout">' + (d.w.done ? 'Открыть тренировку' : 'Начать тренировку') + '</button>';
    } else {
      h += '<strong>День восстановления</strong><p class="small muted">Прогулка 10 000 шагов, сон 7–8 часов. Силовой работы нет.</p>' +
        '<button class="btn-wide" data-goto="workout">Всё равно открыть тренировку</button>';
    }
    h += '</div>';

    // питание
    h += '<h2>Питание</h2><div class="card">' +
      '<div class="row spread"><span>Калории</span><strong>' + n.kcal + ' / ' + D.program.kcalTarget[0] + '–' + D.program.kcalTarget[1] + '</strong></div>' +
      '<div class="meter' + (n.kcal > D.program.kcalHardMax ? ' bad' : '') + '"><div style="width:' + kcalPct + '%"></div></div>' +
      '<div class="row spread" style="margin-top:10px"><span>Белок</span><strong>' + n.p + ' / ' + D.program.protein[0] + ' г</strong></div>' +
      '<div class="meter' + (n.p < D.program.proteinMin ? ' warn' : '') + '"><div style="width:' + pPct + '%"></div></div>' +
      (n.p && n.p < D.program.proteinMin ? '<p class="small" style="color:var(--warn)">⚠️ Белка меньше ' + D.program.proteinMin + ' г — добавь протеиновый перекус (30 г + молоко + банан = +32 г).</p>' : '') +
      '<div class="row" style="margin-top:10px">' +
      '<button style="flex:1" data-goto="food">Отметить еду</button>' +
      '<button class="btn-primary" style="flex:1" id="pasteFood">📋 Еда от Клода</button></div></div>';

    // режим
    h += '<h2>Режим дня</h2><div class="card">' +
      '<div class="grid3">' +
      '<label class="field"><span>Шаги</span><input type="number" inputmode="numeric" data-f="steps" value="' + (d.steps || '') + '" placeholder="10000"></label>' +
      '<label class="field"><span>Сон, ч</span><input type="number" step="0.5" inputmode="decimal" data-f="sleep" value="' + (d.sleep || '') + '" placeholder="8"></label>' +
      '<label class="field"><span>Вода, л</span><input type="number" step="0.1" inputmode="decimal" data-f="water" value="' + (d.water || '') + '" placeholder="2.5"></label>' +
      '</div>' +
      '<label class="field"><span>Плечо сегодня</span></label>' +
      seg('pain', d.pain || 0, [[0, '🟢 Норма'], [1, '🟡 Дискомфорт'], [2, '🟠 Боль'], [3, '🔴 Щелчки']]) +
      '<label class="field" style="margin-top:12px"><span>Энергия</span></label>' +
      seg('energy', d.energy || 0, [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]) +
      '<label class="field" style="margin-top:12px"><span>Заметка дня</span><textarea data-f="note" rows="2" placeholder="Как прошёл день, самочувствие, что мешало">' + esc(d.note) + '</textarea></label>' +
      '</div>';

    if (d.pain >= 3) h += '<div class="card" style="border-color:var(--danger)"><strong style="color:var(--danger)">🔴 Щелчки/хруст в плече — это сигнал нестабильности.</strong><p class="small">По плану: СТОП. Прекрати нагрузку на плечо и обратись к врачу.</p></div>';
    else if (d.pain === 2) h += '<div class="card" style="border-color:var(--warn)"><strong style="color:var(--warn)">🟠 Боль в передней части плеча — пропусти тренировку.</strong><p class="small">Боль при Face Pulls → уменьши вес. Боль ночью → снизь веса на неделю.</p></div>';

    // чеклист подготовки — пока не всё отмечено
    var doneCnt = Object.keys(st.checklist || {}).filter(function (k) { return st.checklist[k]; }).length;
    if (doneCnt < D.checklist.length) {
      h += '<h2>Подготовка к старту <span class="badge">' + doneCnt + '/' + D.checklist.length + '</span></h2><div class="card">';
      D.checklist.forEach(function (item, i) {
        var on = !!(st.checklist && st.checklist[i]);
        h += '<div class="opt ' + (on ? 'on' : '') + '" data-chk="' + i + '"><span class="dot"></span><span class="t small">' + esc(S.fill(item)) + '</span></div>';
      });
      h += '</div>';
    }

    h += '<div class="card flat"><strong>🤖 Отчёт для Claude</strong>' +
      '<p class="small muted">Отчёт собирается автоматически из этих данных. Открой вкладку «Отчёт», скопируй и отправь мне — разберу прогресс.</p>' +
      '<button class="btn-wide" data-goto="report">Открыть отчёт</button></div>';

    var v = view('today'); v.innerHTML = h;

    $$('[data-f]', v).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var day = S.day(cur, true);
        var f = inp.dataset.f;
        day[f] = f === 'note' ? inp.value : num(inp.value);
        S.save();
      });
    });
    wireSeg(v, function (name, val) {
      var day = S.day(cur, true); day[name] = +val; S.save(); render();
    });
    $$('[data-chk]', v).forEach(function (el) {
      el.addEventListener('click', function () {
        var s2 = S.load(); s2.checklist = s2.checklist || {};
        var i = el.dataset.chk;
        if (s2.checklist[i]) delete s2.checklist[i]; else s2.checklist[i] = true;
        S.save(); render();
      });
    });
    var pf = $('#pasteFood', v);
    if (pf) pf.addEventListener('click', function () {
      readClipboard(function (text) { pendingPaste = text || ''; tab = 'food'; render(); });
    });
    var ws = $('#wSave', v);
    if (ws) ws.addEventListener('click', function () {
      var val = num($('#wIn', v).value);
      var waist = num($('#waistIn', v).value);
      if (!val || val < 30 || val > 300) return toast('Введи вес в килограммах');
      if (waist && (waist < 40 || waist > 200)) return toast('Талия указывается в сантиметрах');
      S.addWeight(cur, val, null, waist);
      TG.haptic('success');
      toast(waist ? 'Вес и талия записаны' : 'Вес записан');
      render();
    });
  }

  function stat(big, label) { return '<div class="stat"><b>' + esc(big) + '</b><span>' + esc(label) + '</span></div>'; }
  function seg(name, val, opts) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button data-val="' + o[0] + '" class="' + (String(val) === String(o[0]) ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function wireSeg(root, cb) {
    $$('[data-seg]', root).forEach(function (grp) {
      grp.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        cb(grp.dataset.seg, b.dataset.val);   // строка: числовые значения приводит вызывающий
      });
    });
  }

  /* ---------- ТРЕНИРОВКА ---------- */
  function workoutForDate(date) {
    var d = S.day(date);
    if (d && d.w && d.w.id && D.workouts[d.w.id]) return D.workouts[d.w.id];
    return S.plannedWorkout(date);
  }

  function renderWorkout() {
    var d = S.day(cur, true);
    var wk = workoutForDate(cur) || D.workouts.day1;
    var h = '';
    h += '<div class="seg" data-seg="wday" style="margin-bottom:12px">' + D.workoutOrder.map(function (id) {
      var w = D.workouts[id];
      return '<button data-val="' + id + '" class="' + (w.id === wk.id ? 'on' : '') + '">' + w.short + ' · Д' + id.slice(3) + '</button>';
    }).join('') + '</div>';

    h += '<div class="card"><div class="row spread"><strong>' + esc(wk.title) + '</strong>' +
      '<span class="badge">' + wk.duration + ' мин</span></div>' +
      '<p class="small muted">' + esc(wk.note) + '</p>' +
      (S.movedAt(cur) ? '<p class="small" style="color:var(--accent2)">⇄ Перенесена с другого дня</p>' : '') +
      '<div class="row" style="margin-top:8px"><button id="restT" class="btn-ghost">⏱ Отдых 60 сек</button><span id="restV" class="small muted"></span></div>' +
      (d.w.done ? '' : '<button class="btn-wide" id="moveBtn" style="margin-top:8px">⇄ Перенести на другой день</button>') +
      (S.movedAt(cur) ? '<button class="btn-ghost btn-wide small" id="moveReset" style="margin-top:6px">Вернуть по расписанию</button>' : '') +
      movePickerHtml() +
      '</div>';

    wk.exercises.forEach(function (e, i) {
      var st = S.exState(cur, e.id, true);
      h += '<div class="ex ' + (st.done ? 'done' : '') + '" data-ex="' + e.id + '">' +
        '<div class="ex-head"><button class="check ' + (st.done ? 'on' : '') + '" data-check="' + e.id + '">✓</button>' +
        '<h3>' + (i + 1) + '. ' + esc(e.name) + (e.critical ? ' <span class="badge crit">критично для плеча</span>' : '') + '</h3></div>' +
        '<div class="row spread small" style="margin-top:6px"><span class="sets">' + e.sets + ' × ' + e.reps + '</span>' +
        '<span class="muted">' + esc(e.target) + '</span></div>' +
        '<div class="row" style="margin-top:8px">' +
        '<input type="number" step="0.5" inputmode="decimal" data-kg="' + e.id + '" value="' + (st.kg == null ? '' : st.kg) + '" placeholder="вес, кг' + (e.weightHint ? '' : '') + '">' +
        '<input type="text" data-note="' + e.id + '" value="' + esc(st.note) + '" placeholder="заметка">' +
        '</div>' +
        (e.weightHint ? '<p class="small muted" style="margin:6px 0 0">💡 ' + esc(e.weightHint) + '</p>' : '') +
        lastWeightHint(e.id) +
        '<details><summary>Техника и безопасность</summary>' +
        '<ol class="small">' + e.technique.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' +
        '<p class="small" style="color:var(--accent)">✅ ' + esc(e.safety) + '</p>' +
        (e.progression ? '<p class="small muted">📈 ' + esc(e.progression) + '</p>' : '') +
        '</details></div>';
    });

    var c = wk.cardio, cs = d.w.cardio || (d.w.cardio = { done: false, min: null });
    h += '<div class="ex ' + (cs.done ? 'done' : '') + '">' +
      '<div class="ex-head"><button class="check ' + (cs.done ? 'on' : '') + '" data-check="__cardio">✓</button>' +
      '<h3>🚶 ' + esc(c.name) + '</h3></div>' +
      '<p class="small muted">' + c.min + ' мин · ' + esc(c.speed) + ' · ~' + c.kcal + ' ккал. Аэробная зона (ЧСС 120–150), это восстановление, а не испытание.</p>' +
      '<input type="number" inputmode="numeric" data-cmin value="' + (cs.min == null ? '' : cs.min) + '" placeholder="фактически минут: ' + c.min + '"></div>';

    h += '<div class="row" style="margin-top:14px">' +
      '<button class="btn-primary" id="wDone" style="flex:2">' + (d.w.done ? '✅ Тренировка завершена' : 'Завершить тренировку') + '</button>' +
      '<button class="btn-danger" id="wSkip" style="flex:1">' + (d.w.skipped ? 'Пропущена' : 'Пропустить') + '</button></div>';

    var v = view('workout'); v.innerHTML = h;

    wireSeg(v, function (name, val) {
      if (name !== 'wday') return;
      var day = S.day(cur, true); day.w.id = val; S.save(); render();
    });
    $$('[data-check]', v).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.check, day = S.day(cur, true);
        if (id === '__cardio') day.w.cardio.done = !day.w.cardio.done;
        else { var st = S.exState(cur, id, true); st.done = !st.done; }
        S.save();
        TG.haptic('light');
        render();
      });
    });
    $$('[data-kg]', v).forEach(function (inp) {
      inp.addEventListener('change', function () { S.exState(cur, inp.dataset.kg, true).kg = num(inp.value); S.save(); });
    });
    $$('[data-note]', v).forEach(function (inp) {
      inp.addEventListener('change', function () { S.exState(cur, inp.dataset.note, true).note = inp.value; S.save(); });
    });
    var cm = $('[data-cmin]', v);
    if (cm) cm.addEventListener('change', function () { S.day(cur, true).w.cardio.min = num(cm.value); S.save(); });
    $('#wDone', v).addEventListener('click', function () {
      var day = S.day(cur, true);
      day.w.done = !day.w.done;
      if (day.w.done) { day.w.skipped = false; day.w.id = wk.id; }
      S.save(); toast(day.w.done ? 'Тренировка засчитана 💪' : 'Отметка снята'); render();
    });
    $('#wSkip', v).addEventListener('click', function () {
      var day = S.day(cur, true);
      day.w.skipped = !day.w.skipped;
      if (day.w.skipped) day.w.done = false;
      S.save(); render();
    });
    $('#restT', v).addEventListener('click', startTimer);
    var mb = $('#moveBtn', v);
    if (mb) mb.addEventListener('click', function () { movePicker = !movePicker; render(); });
    var mr = $('#moveReset', v);
    if (mr) mr.addEventListener('click', function () { S.clearMove(cur); toast('Вернул по расписанию'); render(); });
    $$('[data-moveto]', v).forEach(function (b) {
      b.addEventListener('click', function () {
        try {
          var res = S.moveWorkout(cur, b.dataset.moveto);
          movePicker = false;
          TG.haptic('success');
          toast(res.swapped ? 'Поменял местами с «' + res.swapped.dayName + '»' : 'Перенесено на ' + S.human(b.dataset.moveto));
          cur = b.dataset.moveto;
          render();
        } catch (e) { TG.alert(e.message); }
      });
    });
  }

  /* Выбор новой даты: ближайшие 7 дней с подсказкой, что там уже стоит */
  function movePickerHtml() {
    if (!movePicker) return '';
    var h = '<div class="card flat" style="margin-top:10px"><strong class="small">Куда перенести</strong>';
    var found = 0;
    for (var i = 1; i <= 7; i++) {
      var date = S.addDays(cur, i);
      var there = S.plannedWorkout(date);
      var dayRec = S.day(date);
      if (dayRec && dayRec.w && dayRec.w.done) continue;          // туда уже отходили
      found++;
      var busy = there && !there.optional;
      var streak = neighbourTraining(date);
      var warn = streak >= 2 ? '⚠️ будет ' + (streak + 1) + ' тренировки подряд' : (streak === 1 ? '⚠️ подряд с соседним днём' : '');
      h += '<div class="opt" data-moveto="' + date + '"><span class="dot"></span>' +
        '<span class="t small"><strong>' + S.human(date) + '</strong>' +
        '<br><span class="muted">' + (there ? 'сейчас ' + there.title.split(' — ')[0] + (busy ? ' · поменяются местами' : '') : 'сейчас день отдыха') + '</span>' +
        (warn ? '<br><span style="color:var(--warn)">' + warn + '</span>' : '') +
        '</span><span class="k">⇄</span></div>';
    }
    if (!found) h += '<p class="small muted">Свободных дней на неделю вперёд нет.</p>';
    h += '<p class="small muted" style="margin-bottom:0">По плану между тренировками нужен день отдыха: мышцы растут не в зале, а после него.</p></div>';
    return h;
  }

  /* Сколько обязательных тренировок в соседние дни. День, откуда переносим,
     не считаем: оттуда тренировка уедет. */
  function neighbourTraining(date) {
    var n = 0;
    [-1, 1].forEach(function (shift) {
      var d2 = S.addDays(date, shift);
      if (d2 === cur) return;
      var w = S.plannedWorkout(d2);
      if (w && !w.optional) n++;
    });
    return n;
  }

  function lastWeightHint(exId) {
    var st = S.load(), best = null;
    Object.keys(st.days).sort().forEach(function (date) {
      if (date >= cur) return;
      var e = st.days[date].w && st.days[date].w.ex && st.days[date].w.ex[exId];
      if (e && e.kg != null) best = { d: date, kg: e.kg };
    });
    return best ? '<p class="small muted" style="margin:6px 0 0">Прошлый раз: <strong>' + best.kg + ' кг</strong> (' + S.human(best.d) + ')</p>' : '';
  }

  function startTimer() {
    clearInterval(timer); timerLeft = 60;
    var out = $('#restV');
    timer = setInterval(function () {
      timerLeft--;
      if (out) out.textContent = timerLeft > 0 ? timerLeft + ' сек' : '';
      if (timerLeft <= 0) {
        clearInterval(timer);
        TG.haptic('success');
        toast('Отдых окончен — следующий подход');
      }
    }, 1000);
    if (out) out.textContent = '60 сек';
  }

  /* ---------- ПИТАНИЕ ---------- */
  function renderFood() {
    var st = S.load(), d = S.day(cur, true), n = S.nutrition(cur);
    var training = S.isTrainingDay(cur);
    var h = '';

    h += '<div class="card"><div class="row spread"><strong>Итого за день</strong>' +
      '<span class="badge ' + (n.kcal >= D.program.kcalTarget[0] - 150 && n.kcal <= D.program.kcalHardMax ? 'ok' : (n.kcal ? 'bad' : '')) + '">' + n.kcal + ' ккал</span></div>' +
      '<div class="meter"><div style="width:' + Math.min(100, n.kcal / D.program.kcalTarget[1] * 100) + '%"></div></div>' +
      '<div class="grid3" style="margin-top:10px">' +
      stat(n.p + ' г', 'белок / ' + D.program.protein[0]) + stat(n.f + ' г', 'жир / ' + D.program.fat[0]) + stat(n.c + ' г', 'углеводы / ' + D.program.carbs[0]) +
      '</div>' +
      '<div class="row spread" style="margin-top:10px"><span>🥦 Клетчатка</span><strong>' + n.fb + ' / ' + D.program.fiberTarget + ' г</strong></div>' +
      '<div class="meter' + (n.fb < D.program.fiber[0] ? ' warn' : '') + '"><div style="width:' + Math.min(100, n.fb / D.program.fiberTarget * 100) + '%"></div></div>' +
      '<p class="small muted" style="margin-bottom:0">Цель: ' + D.program.kcalTarget[0] + '–' + D.program.kcalTarget[1] + ' ккал (TDEE ' + D.program.tdee + ' − дефицит ' + D.program.deficit[0] + '–' + D.program.deficit[1] + ').</p>' +
      '</div>';

    ['breakfast', 'lunch', 'snack', 'dinner', 'extra'].forEach(function (slot) {
      var g = D.meals[slot];
      h += '<h2>' + esc(g.title) + ' <span class="badge">' + esc(slot === 'breakfast' && !training ? g.timeRest : g.time) + '</span></h2>';
      if (g.goal) h += '<p class="small muted" style="margin-top:-4px">' + esc(g.goal) + '</p>';
      g.options.forEach(function (o) {
        if (o.bb && !training) return;                       // БодиБалансом только в Пн/Ср/Пт
        var on = d.m[slot] === o.id;
        h += '<div class="opt ' + (on ? 'on' : '') + '" data-pick="' + slot + '" data-id="' + o.id + '">' +
          '<span class="dot"></span><span class="t">' + esc(o.name) +
          (o.items ? '<br><span class="small muted">' + o.items.map(esc).join(' · ') + '</span>' : '') +
          '</span><span class="k">' + o.kcal + ' ккал<br>' + o.p + ' г белка</span></div>';
        if (on && o.bb) {
          var names = st.bb[o.bbSlot] || ['', '', '', ''];
          h += '<div class="card flat" style="margin:-3px 0 8px"><label class="field"><span>Какое блюдо БодиБалансом</span>' +
            '<select data-bbpick="' + slot + '">' + names.map(function (nm, i) {
              return '<option value="' + i + '"' + (d.m[slot + 'BB'] === i ? ' selected' : '') + '>' + esc(nm || ('Опция ' + (i + 1))) + '</option>';
            }).join('') + '</select></label></div>';
        }
        if (on && o.how) h += '<p class="small muted" style="margin:-3px 0 8px 12px">💡 ' + esc(o.how) + '</p>';
      });
      if (d.m[slot]) h += '<button class="btn-ghost small" data-clear="' + slot + '">Убрать выбор</button>';
    });

    h += '<h2>Своё / добор</h2><div class="card">' +
      '<div class="grid2">' +
      '<label class="field"><span>Доп. калории</span><input type="number" inputmode="numeric" data-free="freeKcal" value="' + (d.m.freeKcal || '') + '" placeholder="0"></label>' +
      '<label class="field"><span>Доп. белок, г</span><input type="number" inputmode="numeric" data-free="freeP" value="' + (d.m.freeP || '') + '" placeholder="0"></label>' +
      '</div>' +
      (d.m.freeKcal ? '<button class="btn-ghost small" id="freeReset">Обнулить добор</button>' : '') +
      '</div>';

    // что уже добавлено сегодня
    var added = d.m.add || [];
    if (added.length) {
      h += '<h2>Добавлено сегодня</h2><div class="card">';
      added.forEach(function (a, i) {
        h += '<div class="row spread" style="padding:6px 0;border-bottom:1px solid var(--line)">' +
          '<span class="small">' + (a.src === 'photo' ? '📷 ' : (a.src === 'fiber' ? '🥦 ' : '🍴 ')) + esc(a.n) + '</span>' +
          '<span class="small muted" style="white-space:nowrap">' + a.k + ' ккал' + (a.fb ? ' · ' + a.fb + ' г кл.' : '') +
          ' <button class="btn-ghost small" data-rmfood="' + i + '">✕</button></span></div>';
      });
      h += '</div>';
    }

    // ----- клетчатка -----
    h += '<h2>🥦 Добор клетчатки</h2><div class="card">' +
      '<p class="small muted">Цель ' + D.program.fiberTarget + ' г в день, сейчас <strong>' + n.fb + ' г</strong>. ' +
      'Клетчатка держит сытость на дефиците и спасает пищеварение, когда еда в основном готовая.</p>' +
      '<div class="chips">' + D.fiberCombos.map(function (c, i) {
        var fb = c.items.reduce(function (acc, nm) {
          var f = D.fiberFoods.filter(function (x) { return x.n === nm; })[0];
          return acc + (f ? f.fb : 0);
        }, 0);
        return '<button class="chip" data-combo="' + i + '">' + esc(c.n) + ' <b>+' + Math.round(fb * 10) / 10 + ' г</b></button>';
      }).join('') + '</div>' +
      '<label class="field" style="margin-top:10px"><span>Найти продукт</span>' +
      '<input type="text" id="fiberSearch" placeholder="яблоко, нут, отруби…" value="' + esc(foodQuery) + '" autocomplete="off"></label>' +
      '<div class="seg" data-seg="fgroup" style="margin-bottom:10px">' +
      ['Все'].concat(fiberGroups()).map(function (g) {
        return '<button data-val="' + esc(g) + '" class="' + (foodGroup === g ? 'on' : '') + '">' + esc(g) + '</button>';
      }).join('') + '</div>' +
      '<div class="chips">' + fiberList().map(function (f) {
        return '<button class="chip" data-food="' + esc(f.n) + '">' + esc(f.n) + ' <b>' + f.fb + ' г</b></button>';
      }).join('') + '</div>' +
      (fiberList().length ? '' : '<p class="small muted">Ничего не нашлось. Впиши вручную в «Своё / добор» ниже.</p>') +
      '<p class="small muted" style="margin-bottom:0">Значения — на типовую порцию (указана при добавлении).</p>' +
      '</div>';

    // ----- оценка по фото -----
    var photoCfg = (S.load().settings || {}).photoUrl;
    h += '<h2>📷 Еда по фото</h2>';

    if (photoCfg) {
      h += '<div class="card"><p class="small muted">Сфотографируй тарелку — вернутся блюда с КБЖУ и клетчаткой. ' +
        'Оценка примерная: модель не знает, сколько масла на сковороде.</p>' +
        '<button class="btn-primary btn-wide" id="photoBtn">Сделать фото или выбрать</button>' +
        '<input type="file" id="photoIn" accept="image/*" capture="environment" hidden>' +
        '<div id="photoOut"></div></div>';
    }

    // Путь без всякой настройки: фото уходит в чат с Клодом, оттуда возвращается строка
    h += '<div class="card">' +
      (photoCfg ? '<strong>Через чат с Клодом</strong>' : '<strong>Как это работает</strong>') +
      '<ol class="small" style="margin-top:6px">' +
      '<li>Сфотографируй тарелку.</li>' +
      '<li>Отправь фото Клоду в чат со словом <strong>«посчитай»</strong>.</li>' +
      '<li>Он ответит строками вида <code>Блюдо | ккал | белок | жир | углеводы | клетчатка</code>.</li>' +
      '<li>Скопируй ответ целиком и вставь сюда.</li>' +
      '</ol>' +
      '<button class="btn-primary btn-wide" id="fdClip">📋 Вставить ответ Клода</button>' +
      '<textarea id="fdText" rows="4" style="margin-top:8px" placeholder="или вставь вручную: Стейк (250 г) | 620 | 54 | 44 | 0 | 0"></textarea>' +
      '<button class="btn-wide" id="fdParse" style="margin-top:8px">Разобрать и показать</button>' +
      '<div id="fdOut"></div>' +
      (photoCfg ? '' : '<p class="small muted" style="margin-bottom:0">Можно и без чата: свой сервис с ключом Claude API будет считать прямо в приложении — ' +
        'см. <code>worker/README.md</code>, адрес вписывается в «Прогресс → Оценка по фото».</p>') +
      '</div>';

    // Совсем без техники: оценка порции по руке
    h += '<details class="card"><summary>✋ Прикинуть на глаз, без фото</summary>' +
      '<p class="small muted">Рука всегда с собой и растёт вместе с человеком, поэтому как мерка она надёжнее глазомера.</p>' +
      '<table>' + D.portionHints.map(function (x) {
        return '<tr><td class="small" style="white-space:nowrap">' + esc(x.n) + '</td><td class="small">' + esc(x.v) +
          '<br><span class="muted">' + esc(x.k) + '</span></td></tr>';
      }).join('') + '</table>' +
      '<p class="small muted" style="margin-bottom:0">Сложил порции — впиши сумму в «Своё / добор» ниже.</p></details>';

    h += '<h2>🍴 Ел не дома</h2><div class="card">' +
      '<p class="small muted">Кафе, ресторан, командировка. Тапни по блюду — калории и белок добавятся в «добор». ' +
      'Цифры примерные, и это нормально: важен порядок, а не точность. Лучше грубая оценка, чем пустой день.</p>' +
      '<div class="chips">' +
      D.eatingOut.map(function (o, i) {
        return '<button class="chip" data-out="' + i + '">' + esc(o.n) + ' <b>' + o.k + '</b></button>';
      }).join('') +
      '</div>' +
      '<p class="small muted" style="margin-bottom:0">Порция больше обычной — тапни дважды. Половина — тапни и убери половину в поле выше.</p>' +
      '</div>';

    h += '<h2>Меню БодиБалансом</h2><div class="card"><p class="small muted">Впиши названия блюд из фото — они попадут в отчёт и помогут не повторяться.</p>';
    [['lunch', 'Обед'], ['dinner', 'Ужин']].forEach(function (pair) {
      h += '<strong class="small">' + pair[1] + '</strong>';
      for (var i = 0; i < 4; i++) {
        h += '<label class="field"><span>Опция ' + (i + 1) + '</span><input type="text" data-bb="' + pair[0] + ':' + i + '" value="' + esc(st.bb[pair[0]][i] || '') + '" placeholder="название блюда"></label>';
      }
    });
    h += '</div>';

    h += '<details class="card"><summary>🛒 Список покупок на неделю</summary>' +
      D.shopping.map(function (g) {
        return '<p class="small"><strong>' + esc(g.group) + '</strong></p><ul class="small">' + g.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      }).join('') + '</details>';
    h += '<details class="card"><summary>📝 Памятка «без готовки»</summary>' +
      '<p class="small" style="color:var(--accent)">Делать:</p><ul class="small">' + D.noCook.do.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' +
      '<p class="small" style="color:var(--danger)">Не делать:</p><ul class="small">' + D.noCook.dont.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></details>';

    var v = view('food'); v.innerHTML = h;

    wireSeg(v, function (name, val) { if (name === 'fgroup') { foodGroup = String(val); render(); } });
    $$('[data-pick]', v).forEach(function (el) {
      el.addEventListener('click', function () {
        var day = S.day(cur, true), slot = el.dataset.pick;
        day.m[slot] = day.m[slot] === el.dataset.id ? null : el.dataset.id;
        if (day.m[slot] && day.m[slot + 'BB'] == null) day.m[slot + 'BB'] = 0;
        S.save(); render();
      });
    });
    $$('[data-clear]', v).forEach(function (b) {
      b.addEventListener('click', function () { S.day(cur, true).m[b.dataset.clear] = null; S.save(); render(); });
    });
    $$('[data-bbpick]', v).forEach(function (sel) {
      sel.addEventListener('change', function () { S.day(cur, true).m[sel.dataset.bbpick + 'BB'] = +sel.value; S.save(); render(); });
    });
    // клетчатка: наборы, поиск, фильтр, продукты
    $$('[data-combo]', v).forEach(function (b) {
      b.addEventListener('click', function () {
        var combo = D.fiberCombos[+b.dataset.combo];
        combo.items.forEach(function (nm) {
          var f = D.fiberFoods.filter(function (x) { return x.n === nm; })[0];
          if (f) S.addFood(cur, { n: f.n + ' (' + f.por + ')', k: f.k, p: f.p, f: f.f, c: f.c, fb: f.fb, src: 'fiber' });
        });
        TG.haptic('success'); toast(combo.n + ' добавлен'); render();
      });
    });
    $$('[data-food]', v).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = D.fiberFoods.filter(function (x) { return x.n === b.dataset.food; })[0];
        if (!f) return;
        S.addFood(cur, { n: f.n + ' (' + f.por + ')', k: f.k, p: f.p, f: f.f, c: f.c, fb: f.fb, src: 'fiber' });
        TG.haptic('light'); toast('+' + f.fb + ' г клетчатки · ' + f.k + ' ккал');
        render();
      });
    });
    var fs = $('#fiberSearch', v);
    if (fs) {
      fs.addEventListener('input', function () {
        foodQuery = fs.value;
        render();
        var again = $('#fiberSearch');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      });
    }
    $$('[data-rmfood]', v).forEach(function (b) {
      b.addEventListener('click', function () { S.removeFood(cur, +b.dataset.rmfood); render(); });
    });
    var pb = $('#photoBtn', v);
    if (pb) {
      pb.addEventListener('click', function () { $('#photoIn', v).click(); });
      $('#photoIn', v).addEventListener('change', function (e) { estimatePhoto(e.target.files[0]); });
    }
    function parsePasted() {
      var out = $('#fdOut', v);
      var block = S.parseFoodBlock($('#fdText', v).value);
      if (!block.items.length) {
        out.innerHTML = '<p class="small" style="color:var(--warn)">Не нашёл ни одной строки с блюдом. ' +
          'Нужен формат <code>Название | ккал | белок | жир | углеводы | клетчатка</code> — по строке на блюдо.</p>';
        return;
      }
      renderPhotoResult({ items: block.items, comment: 'Разобрано строк: ' + block.items.length }, out, block.date || cur);
    }
    var fp = $('#fdParse', v);
    if (fp) fp.addEventListener('click', parsePasted);
    var fc = $('#fdClip', v);
    if (fc) fc.addEventListener('click', function () {
      readClipboard(function (text) {
        if (text) { $('#fdText', v).value = text; parsePasted(); }
        else { $('#fdText', v).focus(); toast('Вставь текст долгим нажатием в поле'); }
      });
    });
    // пришли с кнопки на главной — подставляем и сразу разбираем
    if (pendingPaste !== null) {
      var txt = pendingPaste; pendingPaste = null;
      var area = $('#fdText', v);
      if (area) {
        setTimeout(function () {
          area.scrollIntoView({ block: 'center' });
          if (txt) { area.value = txt; parsePasted(); }
          else { area.focus(); toast('Вставь текст долгим нажатием в поле'); }
        }, 50);
      }
    }

    $$('[data-out]', v).forEach(function (b) {
      b.addEventListener('click', function () {
        var o = D.eatingOut[+b.dataset.out], day = S.day(cur, true);
        day.m.freeKcal = (+day.m.freeKcal || 0) + o.k;
        day.m.freeP = (+day.m.freeP || 0) + o.p;
        S.save(); TG.haptic('light');
        toast('+' + o.k + ' ккал · ' + esc(o.n));
        render();
      });
    });
    var fr = $('#freeReset', v);
    if (fr) fr.addEventListener('click', function () {
      var day = S.day(cur, true); day.m.freeKcal = null; day.m.freeP = null; S.save(); render();
    });
    $$('[data-free]', v).forEach(function (inp) {
      inp.addEventListener('change', function () { S.day(cur, true).m[inp.dataset.free] = num(inp.value); S.save(); render(); });
    });
    $$('[data-bb]', v).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var p = inp.dataset.bb.split(':');
        S.load().bb[p[0]][+p[1]] = inp.value; S.save();
      });
    });
  }

  function fiberGroups() {
    var out = [];
    D.fiberFoods.forEach(function (f) { if (out.indexOf(f.g) < 0) out.push(f.g); });
    return out;
  }

  function fiberList() {
    var q = foodQuery.trim().toLowerCase();
    return D.fiberFoods.filter(function (f) {
      if (foodGroup !== 'Все' && f.g !== foodGroup) return false;
      return !q || f.n.toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ---------- ОЦЕНКА ПО ФОТО ----------
     Фото уменьшается на устройстве и уходит в свой сервис-посредник,
     который и хранит ключ Claude API. В самом приложении ключа нет. */
  function estimatePhoto(file) {
    if (!file) return;
    var out = $('#photoOut');
    var cfg = S.load().settings || {};
    if (!cfg.photoUrl) return;
    out.innerHTML = '<p class="small muted">Сжимаю фото…</p>';

    shrinkImage(file, 1024, function (dataUrl, err) {
      if (err) { out.innerHTML = '<p class="small" style="color:var(--danger)">Не удалось прочитать фото: ' + esc(err) + '</p>'; return; }
      out.innerHTML = '<p class="small muted">Отправляю на оценку… это 5–15 секунд.</p>';
      var base64 = dataUrl.split(',')[1];
      var headers = { 'Content-Type': 'application/json' };
      if (cfg.photoToken) headers['Authorization'] = 'Bearer ' + cfg.photoToken;

      fetch(cfg.photoUrl, {
        method: 'POST', headers: headers,
        body: JSON.stringify({ image: base64, media_type: 'image/jpeg' })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ': ' + t.slice(0, 200)); });
        return r.json();
      }).then(function (data) {
        renderPhotoResult(data, out);
      }).catch(function (e) {
        out.innerHTML = '<p class="small" style="color:var(--danger)">Не вышло: ' + esc(e.message) + '</p>' +
          '<p class="small muted">Проверь адрес сервиса в «Прогресс → Оценка по фото». Пока можно добавить блюдо кнопками ниже.</p>';
      });
    });
  }

  function renderPhotoResult(data, out, targetDate) {
    targetDate = targetDate || cur;
    var items = (data && data.items) || [];
    if (!items.length) {
      out.innerHTML = '<p class="small muted">Модель не нашла еду на фото. Попробуй снять ближе и при свете.</p>';
      return;
    }
    var dupes = items.filter(function (it) { return S.hasFood(targetDate, foodItem(it)); }).length;
    var html = '<div class="card flat" style="margin-top:10px">';
    if (targetDate !== cur) html += '<p class="small" style="color:var(--accent2)">📅 Будет добавлено на ' + esc(S.human(targetDate)) + '</p>';
    if (data.comment) html += '<p class="small muted">' + esc(data.comment) + '</p>';
    if (dupes) html += '<p class="small" style="color:var(--warn)">' + (dupes === items.length ? 'Всё это уже добавлено' : 'Уже добавлено: ' + dupes + ' из ' + items.length) +
      ' — повторно не добавлю.</p>';
    items.forEach(function (it, i) {
      html += '<div class="row spread" style="padding:6px 0;border-bottom:1px solid var(--line)">' +
        '<span class="small">' + esc(it.n) + (it.portion ? ' <span class="muted">(' + esc(it.portion) + ')</span>' : '') + '</span>' +
        '<span class="small muted" style="white-space:nowrap">' + Math.round(it.k) + ' ккал · ' + Math.round(it.p) + ' г б.' +
        '<button class="btn-ghost small" data-addphoto="' + i + '">＋</button></span></div>';
    });
    var tot = items.reduce(function (a, it) {
      return { k: a.k + (+it.k || 0), p: a.p + (+it.p || 0), fb: a.fb + (+it.fb || 0) };
    }, { k: 0, p: 0, fb: 0 });
    html += '<div class="row spread" style="margin-top:8px"><strong class="small">Всего</strong>' +
      '<strong class="small">' + Math.round(tot.k) + ' ккал · ' + Math.round(tot.p) + ' г белка · ' + Math.round(tot.fb) + ' г кл.</strong></div>' +
      '<button class="btn-primary btn-wide" id="addAllPhoto" style="margin-top:8px">Добавить всё в день</button>' +
      '<p class="small muted" style="margin-bottom:0">Это оценка по виду блюда. Если знаешь состав точнее — поправь в «Своё / добор».</p></div>';
    out.innerHTML = html;

    $$('[data-addphoto]', out).forEach(function (b) {
      b.addEventListener('click', function () {
        var ok = addPhotoItem(items[+b.dataset.addphoto], targetDate);
        toast(ok ? 'Добавлено' : 'Уже есть в этом дне'); render();
      });
    });
    $('#addAllPhoto', out).addEventListener('click', function () {
      var added = items.filter(function (it) { return addPhotoItem(it, targetDate); }).length;
      TG.haptic('success');
      toast(added ? 'Добавлено блюд: ' + added + (targetDate !== cur ? ' на ' + S.human(targetDate) : '') : 'Всё уже было добавлено');
      if (targetDate !== cur) cur = targetDate;           // показываем день, куда добавили
      render();
    });
  }

  function foodItem(it) {
    return { n: it.n + (it.portion ? ' (' + it.portion + ')' : ''), k: it.k, p: it.p, f: it.f, c: it.c, fb: it.fb, src: 'photo' };
  }

  /* Добавляет блюдо в день; повтор того же блока не задваивает калории */
  function addPhotoItem(it, date) {
    var item = foodItem(it);
    date = date || cur;
    if (S.hasFood(date, item)) return false;
    S.addFood(date, item);
    return true;
  }

  /* Чтение буфера обмена. В Telegram на iOS система покажет пузырь «Вставить»,
     где-то чтение запрещено вовсе — тогда вернём null и попросим вставить руками. */
  function readClipboard(cb) {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) { cb(t || null); }, function () { cb(null); });
        return;
      }
    } catch (e) { /* падаем в ручную вставку */ }
    cb(null);
  }

  /* Уменьшаем фото до 1024 px — меньше трафика и дешевле запрос */
  function shrinkImage(file, maxSide, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(null, 'файл не читается'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null, 'это не изображение'); };
      img.onload = function () {
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), hh = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hh;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
        try { cb(canvas.toDataURL('image/jpeg', 0.8)); }
        catch (e) { cb(null, e.message); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- ПРОГРЕСС ---------- */
  function renderProgress() {
    var st = S.load();
    var h = '';
    h += '<div class="card"><h3>Добавить взвешивание</h3>' +
      '<div class="row"><input type="date" id="pDate" value="' + cur + '"><input type="number" step="0.1" inputmode="decimal" id="pKg" placeholder="кг"></div>' +
      '<button class="btn-primary btn-wide" id="pAdd" style="margin-top:8px">Записать вес</button></div>';

    h += '<div class="card">' + chartSVG() + '<p class="small muted" style="text-align:center;margin:4px 0 0">— факт · - - план (' + st.profile.startWeight + ' → ' + st.profile.goalWeight + ' кг)</p></div>';

    if (st.weights.length) {
      var anyWaist = st.weights.some(function (w) { return w.waist; });
      h += '<h2>История</h2><div class="card"><table><tr><th>Дата</th><th>Вес</th><th>Δ</th>' +
        (anyWaist ? '<th>Талия</th>' : '<th>к плану</th>') + '<th></th></tr>';
      st.weights.slice().reverse().forEach(function (w, i, arr) {
        var prev = arr[i + 1];
        var dl = w.kg - S.planWeight(w.d);
        var waistCell;
        if (anyWaist) {
          var pw = null;
          for (var j = i + 1; j < arr.length; j++) if (arr[j].waist) { pw = arr[j].waist; break; }
          waistCell = w.waist ? r1(w.waist) + (pw ? ' <span class="small muted">(' + (w.waist - pw > 0 ? '+' : '') + r1(w.waist - pw) + ')</span>' : '') : '—';
        } else {
          waistCell = '<span style="color:' + (dl > 0.5 ? 'var(--warn)' : 'var(--accent)') + '">' + (dl > 0 ? '+' : '') + r1(dl) + '</span>';
        }
        h += '<tr><td>' + S.human(w.d) + '</td><td><strong>' + r1(w.kg) + '</strong></td>' +
          '<td>' + (prev ? (w.kg - prev.kg > 0 ? '+' : '') + r1(w.kg - prev.kg) : '—') + '</td>' +
          '<td>' + waistCell + '</td>' +
          '<td><button class="btn-ghost small" data-del="' + w.d + '">✕</button></td></tr>';
      });
      h += '</table></div>';
    }

    // силовые
    var strength = strengthRows();
    h += '<h2>Силовые показатели</h2><div class="card">';
    if (!strength.length) h += '<p class="small muted">Записывай рабочий вес в упражнениях — здесь появится прогрессия.</p>';
    else {
      h += '<table><tr><th>Упражнение</th><th>Было</th><th>Стало</th><th>Δ</th></tr>';
      strength.forEach(function (r) {
        h += '<tr><td class="small">' + esc(r.name) + '</td><td>' + r.first + '</td><td><strong>' + r.last + '</strong></td>' +
          '<td style="color:' + (r.delta > 0 ? 'var(--accent)' : 'var(--muted)') + '">' + (r.delta > 0 ? '+' : '') + r1(r.delta) + '</td></tr>';
      });
      h += '</table>';
    }
    h += '</div>';

    // фото
    h += '<h2>Фото прогресса</h2><div class="card"><p class="small muted">Спереди, сбоку, сзади — одинаковый свет и ракурс. Фото храни в галерее, здесь только отметка.</p>';
    var shots = D.photoWeeks
      .filter(function (week) { return S.diffDays(st.profile.startDate, S.addDays(st.profile.startDate, (week - 1) * 7)) < S.totalDays(); })
      .map(function (week) { return { id: week, label: 'Неделя ' + week, date: S.addDays(st.profile.startDate, (week - 1) * 7) }; });
    shots.push({ id: 'final', label: 'Финал', date: st.profile.endDate });
    shots.forEach(function (shot) {
      var on = st.photos[shot.id];
      h += '<div class="opt ' + (on ? 'on' : '') + '" data-photo="' + shot.id + '"><span class="dot"></span>' +
        '<span class="t">' + shot.label + '</span><span class="k">' + S.human(shot.date) + '</span></div>';
    });
    h += '</div>';

    // профиль
    var pr = st.profile;
    h += '<h2>Профиль</h2><div class="card">' +
      '<div class="row spread small"><span class="muted">Старт</span><span>' + S.human(pr.startDate) + ' · ' + r1(pr.startWeight) + ' кг</span></div>' +
      '<div class="row spread small"><span class="muted">Цель</span><span>' + S.human(pr.endDate) + ' · ' + r1(pr.goalWeight) + ' кг</span></div>' +
      '<div class="row spread small"><span class="muted">Темп по плану</span><span>' + S.weeklyLoss() + ' кг/нед · ' + S.totalDays() + ' дней</span></div>' +
      (function () {
        var ws2 = st.weights.filter(function (w) { return w.waist; });
        if (!ws2.length) return '<p class="small muted" style="margin:6px 0 0">Талия ещё не измерена — впиши её при взвешивании, на дефиците она меняется раньше веса.</p>';
        var f = ws2[0], l = ws2[ws2.length - 1];
        return '<div class="row spread small"><span class="muted">Талия</span><span>' + r1(l.waist) + ' см' +
          (ws2.length > 1 ? ' (' + (l.waist - f.waist > 0 ? '+' : '') + r1(l.waist - f.waist) + ' см от старта)' : '') + '</span></div>';
      })() +
      '<details><summary>Изменить</summary><div class="grid2" style="margin-top:8px">' +
      '<label class="field"><span>Стартовый вес, кг</span><input type="number" step="0.1" inputmode="decimal" data-pf="startWeight" value="' + (pr.startWeight || '') + '"></label>' +
      '<label class="field"><span>Цель, кг</span><input type="number" step="0.1" inputmode="decimal" data-pf="goalWeight" value="' + (pr.goalWeight || '') + '"></label>' +
      '<label class="field"><span>Рост, см</span><input type="number" inputmode="numeric" data-pf="height" value="' + (pr.height || '') + '"></label>' +
      '<label class="field"><span>Возраст</span><input type="number" inputmode="numeric" data-pf="age" value="' + (pr.age || '') + '"></label>' +
      '<label class="field"><span>Дата старта</span><input type="date" data-pf="startDate" value="' + pr.startDate + '"></label>' +
      '<label class="field"><span>Дата цели</span><input type="date" data-pf="endDate" value="' + pr.endDate + '"></label>' +
      '</div>' +
      '<label class="field"><span>Вечерние прогулки — с кем</span><input type="text" data-pf="partner" value="' + esc(pr.partner || '') + '" placeholder="например: Аней"></label>' +
      '<p class="small muted">Код настройки для переноса на другое устройство:</p>' +
      '<div class="row"><input type="text" id="setupOut" readonly value="' + esc(S.encodeSetup()) + '"><button id="copyCode">📋</button></div>' +
      '</details></div>';

    // сервис оценки по фото
    var cfg = st.settings || {};
    h += '<h2>📷 Оценка по фото</h2><div class="card">' +
      '<p class="small muted">Адрес своего сервиса-посредника, который хранит ключ Claude API и считает КБЖУ по фотографии. ' +
      'Как его поднять за пять минут — в <code>worker/README.md</code> репозитория. Пусто — блок «Оценить по фото» в «Еде» скрыт.</p>' +
      '<label class="field"><span>Адрес сервиса</span><input type="text" data-cfg="photoUrl" value="' + esc(cfg.photoUrl || '') + '" placeholder="https://…workers.dev" autocapitalize="off" spellcheck="false"></label>' +
      '<label class="field"><span>Пароль (если задан)</span><input type="text" data-cfg="photoToken" value="' + esc(cfg.photoToken || '') + '" placeholder="необязательно" autocapitalize="off" spellcheck="false"></label>' +
      '</div>';

    // синхронизация с Telegram
    if (TG.active) {
      h += '<h2>Синхронизация</h2><div class="card">' +
        '<div class="row spread"><span>Хранилище</span><span class="badge ' + (TG.cloud ? 'ok' : '') + '" id="syncStatus">' + esc(TG.status) + '</span></div>' +
        '<p class="small muted">' + (TG.cloud
          ? 'Данные лежат в облаке Telegram и подтянутся на любом устройстве, где ты откроешь это приложение.'
          : 'Твоя версия Telegram не поддерживает облако — данные хранятся только в этом браузере. Делай экспорт JSON.') + '</p>' +
        (TG.cloud ? '<div class="row wrap"><button id="syncUp">☁️ Сохранить в облако</button><button id="syncDown">⬇️ Загрузить из облака</button></div>' : '') +
        '</div>';
    }

    // данные
    h += '<h2>Данные</h2><div class="card"><div class="row wrap">' +
      '<button id="expJson">💾 Экспорт JSON</button>' +
      '<button id="impJson">📥 Импорт JSON</button>' +
      '<button class="btn-danger" id="resetAll">Сбросить всё</button>' +
      '</div><input type="file" id="fileIn" accept="application/json" hidden>' +
      '<p class="small muted">Данные хранятся только в этом браузере. Экспорт — резервная копия и файл для отчёта в репозитории.</p></div>';

    h += '<p class="small muted" style="text-align:center;margin:18px 0 0">Версия ' + esc(D.version.v) +
      ' · последнее: ' + esc(D.version.feature) + '</p>';

    var v = view('progress'); v.innerHTML = h;
    $('#pAdd', v).addEventListener('click', function () {
      var kg = num($('#pKg', v).value), dt = $('#pDate', v).value;
      if (!kg || !dt) return toast('Укажи дату и вес');
      S.addWeight(dt, kg); toast('Записано'); render();
    });
    $$('[data-del]', v).forEach(function (b) {
      b.addEventListener('click', function () { S.removeWeight(b.dataset.del); render(); });
    });
    $$('[data-photo]', v).forEach(function (el) {
      el.addEventListener('click', function () {
        var w = el.dataset.photo, s = S.load();
        if (s.photos[w]) delete s.photos[w]; else s.photos[w] = { date: S.today() };
        S.save(); render();
      });
    });
    $$('[data-cfg]', v).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var s2 = S.load();
        if (!s2.settings) s2.settings = {};
        s2.settings[inp.dataset.cfg] = inp.value.trim();
        S.save(); toast('Сохранено');
      });
    });
    $$('[data-pf]', v).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var f = inp.dataset.pf;
        var val = (f === 'startDate' || f === 'endDate' || f === 'partner') ? inp.value : num(inp.value);
        if (!val && f !== 'partner') return toast('Значение не может быть пустым');
        var patch = {}; patch[f] = val;
        S.setProfile(patch);
        if (!S.isConfigured()) { S.setProfile({ startWeight: st.profile.startWeight }); return toast('Так нельзя — верни значение'); }
        render();
      });
    });
    var cc = $('#copyCode', v);
    if (cc) cc.addEventListener('click', function () { copy(S.encodeSetup()); });

    var up = $('#syncUp', v);
    if (up) up.addEventListener('click', function () {
      TG.pushNow(function (err) {
        toast(err ? 'Не вышло: ' + err.message : 'Сохранено в облако Telegram');
        render();
      });
    });
    var down = $('#syncDown', v);
    if (down) down.addEventListener('click', function () {
      TG.pull(function (cloudState) {
        if (!cloudState) return toast('В облаке пока пусто');
        TG.confirm('Заменить данные на этом устройстве версией из облака?', function (yes) {
          if (!yes) return;
          S.setState(cloudState, { silent: true });
          toast('Загружено из облака'); render();
        });
      });
    });
    $('#expJson', v).addEventListener('click', function () { download('weightloss-data.json', S.exportJSON(), 'application/json'); });
    $('#impJson', v).addEventListener('click', function () { $('#fileIn', v).click(); });
    $('#fileIn', v).addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { S.importJSON(fr.result); toast('Данные загружены'); render(); }
        catch (err) { toast('Ошибка: ' + err.message); }
      };
      fr.readAsText(f);
    });
    $('#resetAll', v).addEventListener('click', function () {
      TG.confirm('Удалить все записи? Сделай сначала экспорт.', function (yes) {
        if (yes) { S.reset(); render(); }
      });
    });
  }

  function strengthRows() {
    var st = S.load(), by = {};
    Object.keys(st.days).sort().forEach(function (date) {
      var ex = st.days[date].w && st.days[date].w.ex; if (!ex) return;
      Object.keys(ex).forEach(function (id) {
        if (ex[id].kg == null) return;
        (by[id] = by[id] || []).push(+ex[id].kg);
      });
    });
    return Object.keys(by).map(function (id) {
      var a = by[id], name = id;
      D.workoutOrder.forEach(function (w) { D.workouts[w].exercises.forEach(function (e) { if (e.id === id) name = e.name + ' · ' + D.workouts[w].short; }); });
      return { name: name, first: a[0], last: a[a.length - 1], delta: a[a.length - 1] - a[0] };
    });
  }

  function chartSVG() {
    var st = S.load(), W = 320, H = 180, padL = 30, padB = 18, padT = 10;
    var start = st.profile.startDate, end = st.profile.endDate;
    var span = S.diffDays(start, end);
    var maxW = st.profile.startWeight + 1, minW = st.profile.goalWeight - 1;
    var x = function (d) { return padL + (S.diffDays(start, d) / span) * (W - padL - 6); };
    var y = function (kg) { return padT + (maxW - kg) / (maxW - minW) * (H - padT - padB); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    s += '<line class="axis" x1="' + padL + '" y1="' + y(maxW) + '" x2="' + W + '" y2="' + y(maxW) + '"/>';
    s += '<line class="axis" x1="' + padL + '" y1="' + y(minW) + '" x2="' + W + '" y2="' + y(minW) + '"/>';
    [st.profile.startWeight, (st.profile.startWeight + st.profile.goalWeight) / 2, st.profile.goalWeight].forEach(function (kg) {
      s += '<text x="2" y="' + (y(kg) + 3) + '">' + r1(kg) + '</text>';
      s += '<line class="axis" x1="' + padL + '" y1="' + y(kg) + '" x2="' + W + '" y2="' + y(kg) + '" opacity=".4"/>';
    });
    s += '<polyline class="plan" points="' + x(start) + ',' + y(st.profile.startWeight) + ' ' + x(end) + ',' + y(st.profile.goalWeight) + '"/>';
    if (st.weights.length) {
      var pts = st.weights.map(function (w) { return x(w.d) + ',' + y(w.kg); }).join(' ');
      s += '<polyline class="fact" points="' + pts + '"/>';
      st.weights.forEach(function (w) { s += '<circle class="pt" cx="' + x(w.d) + '" cy="' + y(w.kg) + '" r="2.6"/>'; });
    }
    s += '<text x="' + padL + '" y="' + (H - 4) + '">' + S.human(start) + '</text>';
    s += '<text x="' + (W - 48) + '" y="' + (H - 4) + '">' + S.human(end) + '</text>';
    return s + '</svg>';
  }

  /* ---------- ГРАФИК ---------- */
  function renderSchedule() {
    var st = S.load();
    var monday = S.addDays(cur, -((S.weekday(cur) + 6) % 7));
    var h = '<h2>Неделя ' + S.human(monday) + ' — ' + S.human(S.addDays(monday, 6)) + '</h2>';
    for (var i = 0; i < 7; i++) {
      var date = S.addDays(monday, i);
      var sch = D.schedule[S.weekday(date)];
      var d = st.days[date];
      var done = d && d.w && d.w.done;
      var n = S.nutrition(date);
      var wk2 = S.plannedWorkout(date);
      h += '<div class="opt ' + (date === cur ? 'on' : '') + '" data-day="' + date + '"><span class="dot"></span>' +
        '<span class="t"><strong>' + sch.name + '</strong> ' + S.human(date).replace(/^\S+\s/, '') +
        (S.movedAt(date) !== null ? ' <span class="badge">⇄ перенос</span>' : '') +
        '<br><span class="small muted">' + (wk2 ? wk2.title.replace(/ —.*/, '') + ' · ' + wk2.title.split('— ')[1] : 'Восстановление · прогулка 10k') + '</span></span>' +
        '<span class="k">' + (done ? '✅' : (wk2 && !wk2.optional ? '⬜' : '')) + (n.kcal ? '<br>' + n.kcal + ' ккал' : '') + '</span></div>';
    }

    var movedThisWeek = 0;
    for (var k = 0; k < 7; k++) if (S.movedAt(S.addDays(monday, k)) !== null) movedThisWeek++;
    if (movedThisWeek) {
      h += '<div class="card flat"><div class="row spread"><span class="small">⇄ Переносов на этой неделе: ' + movedThisWeek + '</span>' +
        '<button class="btn-ghost small" id="movesReset">Сбросить</button></div></div>';
    }

    var sch2 = D.schedule[S.weekday(cur)];
    h += '<h2>' + sch2.name + ' — распорядок</h2><div class="card"><table>';
    sch2.blocks.forEach(function (b) {
      h += '<tr><td class="muted small" style="white-space:nowrap">' + b[0] + '</td><td>' + esc(S.fill(b[1])) + '</td></tr>';
    });
    h += '</table><p class="small muted" style="margin-bottom:0">Подъём ' + sch2.wake + ' · целевые калории ~' + sch2.kcal + '</p></div>';

    h += '<div class="card flat"><strong>Правила недели</strong><ul class="small">' +
      '<li>Тренировки: Пн (спина+грудь+руки), Ср (ноги), Пт (спина+плечи). Сб — опционально лёгкое восстановление.</li>' +
      '<li>10 000 шагов каждый день — TDEE 2700 посчитан под это.</li>' +
      '<li>Сон 8 часов: на дефиците это половина результата.</li>' +
      '<li>Воскресенье 18:00 — планирование недели и список покупок.</li>' +
      '</ul></div>';

    var v = view('schedule'); v.innerHTML = h;
    $$('[data-day]', v).forEach(function (el) {
      el.addEventListener('click', function () { cur = el.dataset.day; render(); });
    });
    var mw = $('#movesReset', v);
    if (mw) mw.addEventListener('click', function () {
      TG.confirm('Вернуть все тренировки недели по расписанию?', function (yes) {
        if (yes && S.clearMovesInWeek(monday)) { toast('Расписание восстановлено'); render(); }
      });
    });
  }

  /* ---------- ПЛЕЧО ---------- */
  function renderShoulder() {
    var st = S.load();
    var h = '<div class="card"><strong>🚨 Вывих плеча = нестабильность.</strong>' +
      '<p class="small">Причины: ' + D.shoulder.causes.join(' · ') + '. Программа закрывает все четыре — но только если делать три упражнения ниже.</p></div>';

    h += '<h2>Критичные упражнения (21 день)</h2>';
    D.shoulder.critical.forEach(function (c) {
      var done = 0, last = null, planned = 0;
      for (var i = 20; i >= 0; i--) {
        var date = S.addDays(S.today(), -i);
        var wk = S.plannedWorkout(date);
        if (wk && !wk.optional && wk.exercises.some(function (e) { return c.exIds.indexOf(e.id) >= 0; })) planned++;
        var d = st.days[date];
        if (!d || !d.w || !d.w.ex) continue;
        if (c.exIds.some(function (id) { return d.w.ex[id] && d.w.ex[id].done; })) { done++; last = date; }
      }
      var ok = planned === 0 || done / planned >= 0.8;
      h += '<div class="card"><div class="row spread"><strong>' + esc(c.name) + '</strong>' +
        '<span class="badge ' + (ok ? 'ok' : 'bad') + '">' + done + ' / ' + planned + '</span></div>' +
        '<p class="small muted">' + esc(c.sets) + ' · ' + esc(c.days) + ' · последний раз: ' + (last ? S.human(last) : 'никогда') + '</p>' +
        '<p class="small">' + esc(c.why) + '</p>' +
        (ok ? '' : '<p class="small" style="color:var(--danger)">🔴 Пробел. Это прямой риск повторного вывиха — не пропускай.</p>') + '</div>';
    });

    h += '<h2>⛔ Запрещённые упражнения</h2><div class="card"><table><tr><th>Упражнение</th><th>Почему</th><th>Замена</th></tr>' +
      D.shoulder.forbidden.map(function (f) {
        return '<tr><td class="small">' + esc(f[0]) + '</td><td class="small muted">' + esc(f[1]) + '</td><td class="small" style="color:var(--accent)">' + esc(f[2]) + '</td></tr>';
      }).join('') + '</table></div>';

    h += '<h2>🔴 Признаки перетренированности</h2><div class="card"><table>' +
      D.shoulder.overtraining.map(function (o) {
        return '<tr><td class="small">' + esc(o[0]) + '</td><td class="small" style="color:var(--warn)">' + esc(o[1]) + '</td></tr>';
      }).join('') + '</table></div>';

    var pains = [];
    for (var i = 20; i >= 0; i--) {
      var date = S.addDays(S.today(), -i), d = st.days[date];
      if (d && d.pain) pains.push({ d: date, p: d.pain });
    }
    h += '<h2>Дневник плеча (21 день)</h2><div class="card">';
    if (!pains.length) h += '<p class="small" style="color:var(--accent)">🟢 Жалоб не отмечено.</p>';
    else h += '<table>' + pains.map(function (x) {
      var names = ['', '🟡 дискомфорт', '🟠 боль', '🔴 щелчки/сильная боль'];
      return '<tr><td class="small">' + S.human(x.d) + '</td><td class="small">' + names[x.p] + '</td></tr>';
    }).join('') + '</table>';
    h += '</div>';

    view('shoulder').innerHTML = h;
  }

  /* ---------- ОТЧЁТ ---------- */
  function renderReport() {
    var st = S.load();
    var md = R.build(st, { now: S.today() });
    var h = '<div class="card"><strong>🤖 Постоянный отчёт для Claude</strong>' +
      '<p class="small muted">Собирается сам из твоих отметок. Скопируй и отправь мне в чат — или положи файл в <code>reports/</code> репозитория, чтобы отчёт всегда был у меня перед глазами.</p>' +
      '<div class="row wrap" style="margin-top:8px">' +
      '<button class="btn-primary" id="rCopy">📋 Скопировать отчёт</button>' +
      (TG.active ? '<button id="rSend">📨 Сводка в чат</button>' : '') +
      '</div>' +
      (TG.active ? '<p class="small muted" style="margin-bottom:0">«Сводка в чат» отправит короткую выжимку (вес, тренировки, плечо) в любой чат — удобно закинуть в «Избранное». Полный отчёт — кнопкой «Скопировать».</p>' : '') +
      '<details><summary>Файлы</summary><div class="row wrap" style="margin-top:8px">' +
      '<button id="rMd">⬇️ Отчёт .md</button>' +
      '<button id="rJson">⬇️ Данные .json</button>' +
      '</div>' + (TG.active ? '<p class="small muted">В Telegram скачивание файлов может не сработать — тогда открой приложение в обычном браузере.</p>' : '') +
      '</details></div>';

    h += '<div class="card"><label class="field"><span>Вопросы ко мне (попадут в отчёт)</span>' +
      '<textarea id="askC" rows="3" placeholder="Например: вес встал на неделю, что менять?">' + esc(st.askClaude || '') + '</textarea></label>' +
      '<button id="askSave">Сохранить вопросы</button></div>';

    h += '<pre class="report" id="rPre">' + esc(md) + '</pre>';

    var v = view('report'); v.innerHTML = h;
    $('#rCopy', v).addEventListener('click', function () { copy(md); });
    var send = $('#rSend', v);
    if (send) send.addEventListener('click', function () {
      TG.haptic('light');
      TG.share(R.brief(S.load(), { now: S.today() }));
    });
    $('#rMd', v).addEventListener('click', function () { download('claude-report-' + S.today() + '.md', md, 'text/markdown'); });
    $('#rJson', v).addEventListener('click', function () { download('weightloss-data.json', S.exportJSON(), 'application/json'); });
    $('#askSave', v).addEventListener('click', function () {
      S.load().askClaude = $('#askC', v).value; S.save(); toast('Сохранено'); render();
    });
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Отчёт скопирован'); }, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) return toast('Отчёт скопирован');
      var pre = $('#rPre');                      // последний шанс: выделяем отчёт на экране
      if (pre && window.getSelection) {
        var range = document.createRange(); range.selectNodeContents(pre);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        toast('Текст выделен — скопируй долгим нажатием');
      } else toast('Выдели текст отчёта и скопируй вручную');
    }
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Файл сохранён');
  }

  /* ---------- ПЕРВЫЙ ЗАПУСК ---------- */
  function renderSetup() {
    var p = S.load().profile;
    var today = S.today();
    var h = '<div class="card" style="margin-top:8px"><h2 style="margin-top:0">💪 Настройка за 30 секунд</h2>' +
      '<p class="small muted">Программа тренировок и питания уже внутри. Нужны только твои цифры — они хранятся' +
      ' на твоём устройстве и в твоём облаке Telegram, больше нигде.</p></div>';

    h += '<div class="card"><h3>Быстро: вставить код</h3>' +
      '<p class="small muted">Если тебе прислали код настройки — вставь его, поля заполнятся сами.</p>' +
      '<div class="row"><input type="text" id="setupCode" placeholder="WL1-..." autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<button class="btn-primary" id="applyCode">OK</button></div></div>';

    h += '<div class="card"><h3>Или заполнить руками</h3><div class="grid2">' +
      '<label class="field"><span>Вес сейчас, кг</span><input type="number" step="0.1" inputmode="decimal" id="sw" value="' + (p.startWeight || '') + '" placeholder="90"></label>' +
      '<label class="field"><span>Цель, кг</span><input type="number" step="0.1" inputmode="decimal" id="gw" value="' + (p.goalWeight || '') + '" placeholder="75"></label>' +
      '<label class="field"><span>Рост, см</span><input type="number" inputmode="numeric" id="hh" value="' + (p.height || '') + '" placeholder="175"></label>' +
      '<label class="field"><span>Возраст</span><input type="number" inputmode="numeric" id="aa" value="' + (p.age || '') + '" placeholder="30"></label>' +
      '<label class="field"><span>Старт</span><input type="date" id="sd" value="' + (p.startDate || today) + '"></label>' +
      '<label class="field"><span>Дата цели</span><input type="date" id="ed" value="' + (p.endDate || S.addDays(today, 120)) + '"></label>' +
      '</div>' +
      '<label class="field"><span>Вечерние прогулки — с кем (необязательно)</span><input type="text" id="pt" value="' + esc(p.partner || '') + '" placeholder="например: Аней"></label>' +
      '<label class="field"><span>Пол</span></label>' + seg('sex', p.sex || 'м', [['м', 'Мужской'], ['ж', 'Женский']]) +
      '<button class="btn-primary btn-wide" id="startBtn" style="margin-top:14px">Начать программу</button>' +
      '<p class="small muted" id="setupHint" style="margin-bottom:0"></p></div>';

    var v = view('setup'); v.innerHTML = h;
    var sex = p.sex || 'м';
    wireSeg(v, function (name, val) { if (name === 'sex') { sex = val; S.setProfile({ sex: val }); render(); } });

    $('#applyCode', v).addEventListener('click', function () {
      try {
        var prof = S.decodeSetup($('#setupCode', v).value);
        S.setProfile(prof);
        if (!S.load().weights.length) S.addWeight(prof.startDate, prof.startWeight);
        TG.haptic('success');
        toast('Профиль заполнен');
        render();
      } catch (e) { TG.alert(e.message); }
    });

    $('#startBtn', v).addEventListener('click', function () {
      var prof = {
        startWeight: num($('#sw', v).value), goalWeight: num($('#gw', v).value),
        height: num($('#hh', v).value), age: num($('#aa', v).value), sex: sex,
        partner: $('#pt', v).value.trim(),
        startDate: $('#sd', v).value, endDate: $('#ed', v).value
      };
      if (!prof.startWeight || !prof.goalWeight) return TG.alert('Укажи текущий вес и цель');
      if (prof.goalWeight >= prof.startWeight) return TG.alert('Цель должна быть меньше текущего веса');
      if (!prof.startDate || !prof.endDate || S.diffDays(prof.startDate, prof.endDate) < 7) return TG.alert('Дата цели должна быть хотя бы через неделю после старта');
      S.setProfile(prof);
      if (!S.load().weights.length) S.addWeight(prof.startDate, prof.startWeight);
      TG.haptic('success');
      render();
    });
  }

  /* ---------- маршрутизация ---------- */
  var RENDER = {
    today: renderToday, workout: renderWorkout, food: renderFood,
    progress: renderProgress, schedule: renderSchedule, shoulder: renderShoulder, report: renderReport
  };

  function render() {
    if (!S.isConfigured()) {
      $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== 'setup'; });
      $('#tabbar').hidden = true;
      $('.topbar').hidden = true;
      renderSetup();
      if (TG.active) { TG.hideMain(); TG.setBack(false); }
      return;
    }
    $('#tabbar').hidden = false;
    $('.topbar').hidden = false;
    renderTop();
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== tab; });
    $$('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    RENDER[tab]();
    nativeButtons();
    window.scrollTo({ top: 0 });
  }

  /* MainButton и BackButton Telegram под текущую вкладку */
  function nativeButtons() {
    if (!TG.active) return;
    document.body.classList.add('tg');
    document.body.classList.toggle('tg-main', tab === 'workout' || tab === 'report');
    TG.setBack(tab !== 'today', function () { tab = 'today'; render(); });
    if (tab === 'workout') {
      var day = S.day(cur, true);
      TG.setMain(day.w.done ? '✅ Тренировка засчитана' : 'Завершить тренировку', function () {
        var dd = S.day(cur, true);
        dd.w.done = !dd.w.done;
        if (dd.w.done) { dd.w.skipped = false; dd.w.id = (workoutForDate(cur) || D.workouts.day1).id; }
        S.save(); TG.haptic(dd.w.done ? 'success' : 'light');
        toast(dd.w.done ? 'Тренировка засчитана 💪' : 'Отметка снята');
        render();
      });
    } else if (tab === 'report') {
      TG.setMain('📋 Скопировать отчёт', function () { copy(R.build(S.load(), { now: S.today() })); });
    } else TG.hideMain();
  }

  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-goto]');
    if (g) { tab = g.dataset.goto; render(); }
  });
  $('#tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.tab; render();
  });
  $('#prevDay').addEventListener('click', function () { cur = S.addDays(cur, -1); render(); });
  $('#nextDay').addEventListener('click', function () { cur = S.addDays(cur, 1); render(); });

  S.load();
  render();

  TG.init(function (loadedFromCloud) {
    render();
    if (loadedFromCloud) toast('Данные загружены из облака Telegram');
  });
  TG.onStatus = function (status) {
    var el = $('#syncStatus');
    if (el) el.textContent = status;
  };

  /* ---------- обновления ----------
     Telegram не перезагружает мини-приложение, когда его сворачивают свайпом,
     и старый код может жить в памяти сколько угодно. Поэтому приложение само
     сверяет свою версию с той, что лежит на сервере. */
  function checkForUpdate(initial) {
    if (location.protocol.indexOf('http') !== 0 || !window.fetch) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !info.version || info.version === D.version.v) return;
        var already = null;
        try { already = sessionStorage.getItem('reloadedFor'); } catch (e) { /* без sessionStorage — просто покажем плашку */ }
        if (initial && already !== info.version) {
          // при открытии обновляемся молча; флаг не даёт уйти в бесконечную перезагрузку
          try { sessionStorage.setItem('reloadedFor', info.version); } catch (e) {}
          reloadFresh(info.version);
        } else {
          showUpdateBanner(info);
        }
      })
      .catch(function () { /* нет сети — проверим в следующий раз */ });
  }

  /* Перезагрузка с новым ?v= — ни один кеш не узнает этот адрес.
     Хвост после # сохраняем: в нём Telegram передаёт данные входа. */
  function reloadFresh(ver) {
    location.replace(location.pathname + '?v=' + encodeURIComponent(ver) + location.hash);
  }

  function showUpdateBanner(info) {
    if ($('#updBanner')) return;
    var bar = document.createElement('div');
    bar.id = 'updBanner';
    bar.className = 'upd-banner';
    bar.innerHTML = '<span>🔄 Вышло обновление' + (info.feature ? ': ' + esc(info.feature) : '') + '</span>' +
      '<button class="btn-primary" id="updGo">Обновить</button>';
    document.body.appendChild(bar);
    $('#updGo').addEventListener('click', function () { reloadFresh(info.version); });
  }

  checkForUpdate(true);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkForUpdate(false);   // вернулись в свёрнутое приложение
  });
  setInterval(function () { checkForUpdate(false); }, 30 * 60 * 1000);

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
