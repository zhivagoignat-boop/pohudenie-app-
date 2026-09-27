/* Хранилище состояния: localStorage + импорт/экспорт JSON.
   Всё, что вводит пользователь, живёт здесь. */
(function (root) {
  'use strict';

  var KEY = 'weightloss.v1';
  var D = root.APP_DATA;

  function emptyState() {
    return {
      v: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        startDate: null, endDate: null,
        startWeight: null, goalWeight: null,
        height: null, age: null, sex: 'м', partner: ''
      },
      bb: { lunch: ['', '', '', ''], dinner: ['', '', '', ''] },
      weights: [],
      days: {},
      photos: {},
      checklist: {},
      settings: { photoUrl: '', photoToken: '' },
      askClaude: ''
    };
  }

  /* ---- даты ---- */
  function iso(d) {
    var x = (d instanceof Date) ? d : new Date(d);
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { return iso(new Date()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function weekday(s) { return parse(s).getDay(); }
  var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  function human(s) { var d = parse(s); return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }

  /* ---- доступ ---- */
  var state = null;
  var saved = false;   // было ли хоть одно сохранение на этом устройстве

  function load() {
    if (state) return state;
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      saved = !!raw;
      state = raw ? migrate(JSON.parse(raw)) : emptyState();
    } catch (e) {
      console.warn('Не удалось прочитать сохранение:', e);
      state = emptyState();
    }
    return state;
  }

  /* Есть ли у состояния реальное содержимое (пустые заготовки дней не считаются) */
  function hasContent(s) {
    s = s || load();
    if (s.weights && s.weights.length) return true;
    if (s.askClaude && s.askClaude.trim()) return true;
    if (s.checklist && Object.keys(s.checklist).length) return true;
    if (s.photos && Object.keys(s.photos).length) return true;
    var days = s.days || {};
    return Object.keys(days).some(function (k) {
      var d = days[k];
      if (!d) return false;
      if (d.w && (d.w.done || d.w.skipped || Object.keys(d.w.ex || {}).some(function (i) {
        return d.w.ex[i].done || d.w.ex[i].kg != null || d.w.ex[i].note;
      }) || (d.w.cardio && d.w.cardio.done))) return true;
      if (d.m && Object.keys(d.m).some(function (i) { return d.m[i]; })) return true;
      return !!(d.steps || d.sleep || d.water || d.pain || d.energy || (d.note && d.note.trim()));
    });
  }

  function wasSaved() { return saved; }

  function migrate(s) {
    var base = emptyState();
    for (var k in base) if (!(k in s)) s[k] = base[k];
    if (!s.settings) s.settings = { photoUrl: '', photoToken: '' };
    if (!s.bb.lunch) s.bb.lunch = ['', '', '', ''];
    if (!s.bb.dinner) s.bb.dinner = ['', '', '', ''];
    return s;
  }

  function persist() {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
      saved = true;
    } catch (e) {
      console.warn('Не удалось сохранить:', e);
    }
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    persist();
    if (root.dispatchEvent) root.dispatchEvent(new CustomEvent('state:changed'));
  }

  /* Подменить состояние целиком (загрузка из облака Telegram или импорт).
     silent = не поднимать событие, чтобы не отправить данные обратно в облако. */
  function setState(obj, opts) {
    state = migrate(obj);
    persist();
    if (!(opts && opts.silent) && root.dispatchEvent) root.dispatchEvent(new CustomEvent('state:changed'));
    return state;
  }

  /* день */
  function day(date, create) {
    var s = load();
    if (!s.days[date] && create) {
      s.days[date] = {
        w: { done: false, skipped: false, ex: {}, cardio: { done: false, min: null } },
        m: { breakfast: null, lunch: null, snack: null, dinner: null, extra: null, freeKcal: null, freeP: null, add: [] },
        steps: null, sleep: null, water: null, pain: 0, energy: null, note: ''
      };
    }
    return s.days[date] || null;
  }

  function exState(date, exId, create) {
    var d = day(date, create === true);
    if (!d) return null;
    if (!d.w.ex[exId] && create) d.w.ex[exId] = { done: false, kg: null, note: '' };
    return d.w.ex[exId] || null;
  }

  /* плановая тренировка на дату */
  function plannedWorkout(date) {
    var wd = weekday(date);
    var sch = D.schedule[wd];
    return sch && sch.workout ? D.workouts[sch.workout] : null;
  }

  function isTrainingDay(date) {
    var wd = weekday(date);
    return D.schedule[wd] && D.schedule[wd].type === 'train';
  }

  /* питание за день */
  function nutrition(date) {
    var d = day(date);
    var sum = { kcal: 0, p: 0, f: 0, c: 0, fb: 0, meals: [] };
    if (!d) return sum;
    ['breakfast', 'lunch', 'snack', 'dinner', 'extra'].forEach(function (slot) {
      var id = d.m[slot];
      if (!id) return;
      var opt = findOption(slot, id);
      if (!opt) return;
      sum.kcal += opt.kcal; sum.p += opt.p; sum.f += opt.f || 0; sum.c += opt.c || 0; sum.fb += opt.fb || 0;
      var name = opt.name;
      if (opt.bb) {
        var bbIdx = d.m[slot + 'BB'];
        var bbName = (load().bb[opt.bbSlot] || [])[bbIdx || 0];
        name = 'БодиБалансом: ' + (bbName || ('опция ' + ((bbIdx || 0) + 1)));
      }
      sum.meals.push({ slot: slot, name: name, kcal: opt.kcal, p: opt.p });
    });
    (d.m.add || []).forEach(function (a) {
      sum.kcal += +a.k || 0; sum.p += +a.p || 0; sum.f += +a.f || 0; sum.c += +a.c || 0; sum.fb += +a.fb || 0;
      sum.meals.push({ slot: a.src || 'add', name: a.n, kcal: +a.k || 0, p: +a.p || 0 });
    });
    if (d.m.freeKcal) { sum.kcal += +d.m.freeKcal; sum.p += (+d.m.freeP || 0); sum.meals.push({ slot: 'free', name: 'Своё', kcal: +d.m.freeKcal, p: +d.m.freeP || 0 }); }
    sum.fb = Math.round(sum.fb * 10) / 10;
    return sum;
  }

  /* Добавить продукт/блюдо в день (клетчатка, кафе, оценка по фото) */
  function addFood(date, item) {
    var d = day(date, true);
    if (!d.m.add) d.m.add = [];
    d.m.add.push({
      n: item.n, k: +item.k || 0, p: +item.p || 0, f: +item.f || 0, c: +item.c || 0,
      fb: +item.fb || 0, src: item.src || null
    });
    save();
  }

  function removeFood(date, index) {
    var d = day(date, true);
    if (d.m.add && d.m.add.length > index) { d.m.add.splice(index, 1); save(); }
  }

  /* Поиск по базе продуктов с клетчаткой */
  function searchFood(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return D.fiberFoods.filter(function (f) { return f.n.toLowerCase().indexOf(q) >= 0; });
  }

  function findOption(slot, id) {
    var group = D.meals[slot];
    if (!group) return null;
    for (var i = 0; i < group.options.length; i++) if (group.options[i].id === id) return group.options[i];
    return null;
  }

  /* вес */
  function addWeight(date, kg, note, waist) {
    var s = load();
    var existing = s.weights.filter(function (w) { return w.d === date; })[0];
    if (existing) {
      existing.kg = kg;
      if (note != null) existing.note = note;
      if (waist != null) existing.waist = waist || undefined;
    } else s.weights.push({ d: date, kg: kg, note: note || '', waist: waist || undefined });
    s.weights.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    save();
  }

  function removeWeight(date) {
    var s = load();
    s.weights = s.weights.filter(function (w) { return w.d !== date; });
    save();
  }

  function lastWeight() {
    var s = load();
    return s.weights.length ? s.weights[s.weights.length - 1] : null;
  }

  /* плановый вес на дату: линейно от стартового веса к цели за срок программы */
  function planWeight(date) {
    var p = load().profile;
    if (!isConfigured()) return null;
    var span = totalDays();
    var n = diffDays(p.startDate, date);
    if (n < 0) n = 0;
    if (n > span) n = span;
    return p.startWeight - (p.startWeight - p.goalWeight) * (n / span);
  }

  /* ---- профиль ---- */
  function isConfigured() {
    var p = load().profile;
    return !!(p && p.startWeight && p.goalWeight && p.startDate && p.endDate);
  }
  function totalDays() {
    var p = load().profile;
    if (!p.startDate || !p.endDate) return 0;
    return Math.max(1, diffDays(p.startDate, p.endDate));
  }
  function weeklyLoss() {
    var p = load().profile, d = totalDays();
    if (!d || !p.startWeight || !p.goalWeight) return D.program.weeklyLossDefault;
    return Math.round((p.startWeight - p.goalWeight) / (d / 7) * 10) / 10;
  }
  function setProfile(patch) {
    var p = load().profile;
    Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
    save();
    return p;
  }

  /* ---- код быстрой настройки ----
     Короткая строка с личными цифрами: её можно один раз вставить в приложение,
     чтобы не заполнять поля руками. В коде приложения этих цифр нет. */
  function b64enc(str) {
    // через UTF-8: в строке бывает кириллица (пол «м»/«ж»)
    var bytes = unescape(encodeURIComponent(str));
    var b = root.btoa ? root.btoa(bytes) : Buffer.from(str, 'utf8').toString('base64');
    return b.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  function b64dec(str) {
    var b = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    if (root.atob) return decodeURIComponent(escape(root.atob(b)));
    return Buffer.from(b, 'base64').toString('utf8');
  }
  function encodeSetup(p) {
    p = p || load().profile;
    return 'WL1-' + b64enc(JSON.stringify({
      sw: p.startWeight, gw: p.goalWeight, h: p.height, a: p.age, s: p.sex,
      sd: p.startDate, ed: p.endDate, pt: p.partner || undefined
    }));
  }
  function decodeSetup(code) {
    code = String(code || '').trim().replace(/\s+/g, '');
    if (code.indexOf('WL1-') !== 0) throw new Error('Код должен начинаться с WL1-');
    var o;
    try { o = JSON.parse(b64dec(code.slice(4))); }
    catch (e) { throw new Error('Код повреждён — проверь, что скопирован целиком'); }
    var prof = {
      startWeight: +o.sw, goalWeight: +o.gw,
      height: o.h ? +o.h : null, age: o.a ? +o.a : null, sex: o.s || 'м',
      partner: o.pt || '', startDate: o.sd, endDate: o.ed
    };
    if (!prof.startWeight || !prof.goalWeight || !prof.startDate || !prof.endDate) throw new Error('В коде не хватает данных');
    return prof;
  }

  /* Подстановка имени спутника в тексты расписания:
     {partner} -> " с <имя в творительном падеже>" */
  function fill(text) {
    var name = (load().profile.partner || '').trim();
    return String(text).replace(/\{partner\}/g, name ? ' с ' + name : '');
  }

  function exportJSON() { return JSON.stringify(load(), null, 2); }

  function importJSON(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !('days' in parsed)) throw new Error('Это не файл данных приложения');
    setState(parsed);
    return state;
  }

  function reset() { state = emptyState(); saved = false; save(); }

  root.Store = {
    KEY: KEY, load: load, save: save, day: day, exState: exState,
    plannedWorkout: plannedWorkout, isTrainingDay: isTrainingDay,
    nutrition: nutrition, findOption: findOption, addFood: addFood, removeFood: removeFood, searchFood: searchFood,
    addWeight: addWeight, removeWeight: removeWeight, lastWeight: lastWeight, planWeight: planWeight,
    isConfigured: isConfigured, totalDays: totalDays, weeklyLoss: weeklyLoss, setProfile: setProfile, fill: fill,
    encodeSetup: encodeSetup, decodeSetup: decodeSetup,
    exportJSON: exportJSON, importJSON: importJSON, reset: reset, emptyState: emptyState, setState: setState,
    hasContent: hasContent, wasSaved: wasSaved,
    iso: iso, today: today, parse: parse, addDays: addDays, diffDays: diffDays,
    weekday: weekday, human: human, WD: WD, MONTHS: MONTHS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Store;
})(typeof window !== 'undefined' ? window : globalThis);
