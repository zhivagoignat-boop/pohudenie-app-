/* Интеграция с Telegram Mini App:
   тема, нативные кнопки, хаптика и облачная синхронизация (CloudStorage).
   Вне Telegram файл ничего не ломает — приложение работает как обычная страница. */
(function (root) {
  'use strict';

  var api = root.Telegram && root.Telegram.WebApp;
  var S = root.Store;
  var TG = {
    active: false,      // запущено внутри Telegram
    cloud: false,       // доступно облачное хранилище
    status: 'локально', // что показывать в интерфейсе
    user: null
  };

  /* ---------- определение среды ---------- */
  // initData пуст при открытии по прямой ссылке в браузере — тогда это не мини-апп
  TG.active = !!(api && api.initData !== undefined && api.platform && api.platform !== 'unknown');
  if (api) {
    try {
      TG.cloud = !!(api.CloudStorage && api.isVersionAtLeast && api.isVersionAtLeast('6.9'));
      TG.user = (api.initDataUnsafe && api.initDataUnsafe.user) || null;
    } catch (e) { TG.cloud = false; }
  }

  /* ---------- тема Telegram ---------- */
  function applyTheme() {
    if (!TG.active) return;
    var t = api.themeParams || {};
    var css = document.documentElement.style;
    function set(varName, value) { if (value) css.setProperty(varName, value); }
    set('--bg', t.bg_color);
    set('--card', t.secondary_bg_color || t.bg_color);
    set('--card2', t.section_bg_color || t.secondary_bg_color);
    set('--fg', t.text_color);
    set('--muted', t.hint_color);
    set('--accent2', t.link_color);
    if (t.section_separator_color) set('--line', t.section_separator_color);
    document.documentElement.setAttribute('data-theme', api.colorScheme === 'light' ? 'light' : 'dark');
    try {
      api.setHeaderColor(t.bg_color || (api.colorScheme === 'light' ? '#ffffff' : '#0f1216'));
      api.setBackgroundColor(t.bg_color || (api.colorScheme === 'light' ? '#f3f5f8' : '#0f1216'));
    } catch (e) {}
  }

  /* ---------- нативные кнопки ---------- */
  var mainHandler = null, backHandler = null;

  function setMain(text, onClick) {
    if (!TG.active) return;
    var b = api.MainButton;
    if (mainHandler) b.offClick(mainHandler);
    mainHandler = onClick;
    b.setText(text);
    b.onClick(mainHandler);
    b.show();
  }
  function hideMain() {
    if (!TG.active) return;
    if (mainHandler) { api.MainButton.offClick(mainHandler); mainHandler = null; }
    api.MainButton.hide();
  }
  function setBack(show, onBack) {
    if (!TG.active || !api.BackButton) return;
    if (backHandler) { api.BackButton.offClick(backHandler); backHandler = null; }
    if (show) {
      backHandler = onBack;
      api.BackButton.onClick(backHandler);
      api.BackButton.show();
    } else api.BackButton.hide();
  }
  function haptic(kind) {
    if (!TG.active || !api.HapticFeedback) { if (root.navigator.vibrate) root.navigator.vibrate(15); return; }
    try {
      if (kind === 'success' || kind === 'error' || kind === 'warning') api.HapticFeedback.notificationOccurred(kind);
      else api.HapticFeedback.impactOccurred(kind || 'light');
    } catch (e) {}
  }
  function alert(msg) {
    if (TG.active && api.showAlert) { try { return api.showAlert(msg); } catch (e) {} }
    root.alert(msg);
  }
  function confirm(msg, cb) {
    if (TG.active && api.showConfirm) { try { return api.showConfirm(msg, cb); } catch (e) {} }
    cb(root.confirm(msg));
  }

  /* ---------- отправка отчёта в чат ---------- */
  function share(text) {
    var url = 'https://t.me/share/url?url=' + encodeURIComponent('') + '&text=' + encodeURIComponent(text);
    if (TG.active && api.openTelegramLink) { try { api.openTelegramLink(url); return true; } catch (e) {} }
    root.open(url, '_blank');
    return true;
  }

  /* ---------- облачная синхронизация ----------
     CloudStorage хранит значения до 4096 символов на ключ,
     поэтому состояние режется на куски: meta + c0..cN. */
  var CHUNK = 3500, KEY_META = 'meta', pushTimer = null, pushing = false, lastPushed = null;

  function cs() { return api.CloudStorage; }

  function cloudSave(state, cb) {
    cb = cb || function () {};
    if (!TG.cloud) return cb(new Error('нет облака'));
    var json;
    try { json = JSON.stringify(state); } catch (e) { return cb(e); }
    var chunks = [];
    for (var i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
    if (chunks.length > 900) return cb(new Error('данные слишком большие для облака'));

    var left = chunks.length, failed = null;
    if (!left) return writeMeta();
    chunks.forEach(function (c, idx) {
      cs().setItem('c' + idx, c, function (err) {
        if (err) failed = err;
        if (--left === 0) failed ? cb(failed) : writeMeta();
      });
    });

    function writeMeta() {
      // meta пишется последней: если запись оборвётся, старый снимок останется целым
      cs().setItem(KEY_META, JSON.stringify({ v: 1, n: chunks.length, u: state.updatedAt }), function (err) {
        if (err) return cb(err);
        lastPushed = state.updatedAt;
        TG.status = 'облако Telegram';
        cleanup(chunks.length);
        cb(null);
      });
    }
  }

  // удаляем куски, оставшиеся от более длинного прошлого снимка
  function cleanup(n) {
    if (!cs().getKeys) return;
    cs().getKeys(function (err, keys) {
      if (err || !keys) return;
      var extra = keys.filter(function (k) {
        var m = /^c(\d+)$/.exec(k);
        return m && +m[1] >= n;
      });
      if (extra.length && cs().removeItems) cs().removeItems(extra, function () {});
    });
  }

  function cloudLoad(cb) {
    if (!TG.cloud) return cb(null);
    cs().getItem(KEY_META, function (err, val) {
      if (err || !val) return cb(null);
      var meta;
      try { meta = JSON.parse(val); } catch (e) { return cb(null); }
      if (!meta || !meta.n) return cb(null);
      var keys = [];
      for (var i = 0; i < meta.n; i++) keys.push('c' + i);
      cs().getItems(keys, function (err2, obj) {
        if (err2 || !obj) return cb(null);
        var s = '';
        for (var j = 0; j < meta.n; j++) {
          if (obj['c' + j] == null) return cb(null);   // снимок неполный — игнорируем
          s += obj['c' + j];
        }
        try { cb(JSON.parse(s)); } catch (e) { cb(null); }
      });
    });
  }

  function pushLater() {
    if (!TG.cloud) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      if (pushing) return pushLater();
      pushing = true;
      TG.status = 'сохраняю…';
      cloudSave(S.load(), function (err) {
        pushing = false;
        TG.status = err ? 'только локально' : 'облако Telegram';
        if (TG.onStatus) TG.onStatus(TG.status, err);
      });
    }, 2500);
  }

  function pushNow(cb) {
    clearTimeout(pushTimer);
    if (!TG.cloud) { cb && cb(new Error('нет облака')); return; }
    TG.status = 'сохраняю…';
    if (TG.onStatus) TG.onStatus(TG.status);
    cloudSave(S.load(), function (err) {
      TG.status = err ? 'только локально' : 'облако Telegram';
      if (TG.onStatus) TG.onStatus(TG.status, err);
      cb && cb(err);
    });
  }

  /* ---------- запуск ---------- */
  function init(onStateFromCloud) {
    if (!TG.active) return;
    try {
      api.ready();
      api.expand();
      if (api.disableVerticalSwipes) api.disableVerticalSwipes();
      if (api.enableClosingConfirmation) api.enableClosingConfirmation();
    } catch (e) {}
    applyTheme();
    api.onEvent('themeChanged', applyTheme);

    if (TG.cloud) {
      TG.status = 'проверяю облако…';
      cloudLoad(function (cloudState) {
        var local = S.load();
        var localTime = local.updatedAt || '';
        var cloudTime = (cloudState && cloudState.updatedAt) || '';
        // на новом устройстве локальных сохранений нет — облако главнее по определению
        var localEmpty = !S.wasSaved() || !S.hasContent(local);
        if (cloudState && (localEmpty || cloudTime > localTime)) {
          S.setState(cloudState, { silent: true });
          lastPushed = cloudTime;
          TG.status = 'облако Telegram';
          if (onStateFromCloud) onStateFromCloud(true);
        } else {
          TG.status = 'облако Telegram';
          if (onStateFromCloud) onStateFromCloud(false);
          if (!localEmpty && localTime >= cloudTime) pushLater();
        }
      });
    } else {
      TG.status = 'локально (обнови Telegram для облака)';
    }

    // любое изменение состояния уходит в облако с задержкой
    root.addEventListener('state:changed', pushLater);
  }

  TG.init = init;
  TG.applyTheme = applyTheme;
  TG.setMain = setMain;
  TG.hideMain = hideMain;
  TG.setBack = setBack;
  TG.haptic = haptic;
  TG.alert = alert;
  TG.confirm = confirm;
  TG.share = share;
  TG.pushNow = pushNow;
  TG.pull = cloudLoad;
  TG.api = api;

  root.TG = TG;
})(typeof window !== 'undefined' ? window : globalThis);
