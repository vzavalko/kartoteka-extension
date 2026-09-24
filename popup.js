/* Окно у значка расширения: сохранить текущую вкладку — и, если надо, разом
   всё окно. Про папки попап знает только со слов самой страницы: она шлёт
   снимок через мост, расширение держит его в chrome.storage. Снимка нет —
   остаются «Активная папка», «Без папки» и «+ Новая папка…». */
const $ = s => document.querySelector(s);
let tab = null, snap = null, rest = [];

const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return u || ''; } };
const plural = (n,a,b,c) => { const m = n % 100, k = n % 10;
  return (m > 10 && m < 20) ? c : k === 1 ? a : (k >= 2 && k <= 4) ? b : c; };

function letterTile(url){
  const h = hostOf(url).split('.');
  return (h.length > 1 ? h[h.length - 2] : h[0] || '?')[0] || '?';
}
const ok = () => !!tab && savable(tab.url);

async function boot(){
  const settings = await getSettings();
  $('#appUrl').value = settings.appUrl;
  $('#newtabRedirect').checked = settings.newtabRedirect;
  $('#closeAfter').checked = settings.closeAfter;

  const all = await chrome.tabs.query({ currentWindow: true });
  tab = all.find(t => t.active) || null;
  snap = (await chrome.storage.local.get('snap')).snap || null;

  /* Всё окно — без закреплённых и без самой ZAKLADKA: её сохранять незачем. */
  const app = settings.appUrl;
  rest = all.filter(t => savable(t.url) && !t.pinned && !String(t.url).startsWith(app));

  paintTab();
  paintFolders();
  paintState();
}

function paintTab(){
  const on = ok();
  const title = $('#title');
  title.value = on ? (tab.title || hostOf(tab.url)) : 'Эту страницу сохранять нечего';
  title.disabled = !on;
  $('#host').textContent = on ? hostOf(tab.url) : (tab ? String(tab.url || '').split('/')[0] : '');

  const fav = $('#fav');
  fav.textContent = on ? letterTile(tab.url) : '?';   /* запасной вариант готовим заранее */
  if(on && tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)){
    const img = document.createElement('img');
    img.className = 'fav'; img.src = tab.favIconUrl; img.alt = '';
    img.onerror = () => { img.replaceWith(fav); };
    fav.replaceWith(img);
  }
}

/* Плоский список с отступами: у <option> нет вложенности, поэтому глубину
   рисуем пробелами — так же, как в самой ZAKLADKA. */
function paintFolders(){
  const sel = $('#folder'), folders = (snap && snap.folders) || [];
  const active = folders.find(f => f.id === (snap && snap.active));
  sel.innerHTML = '';

  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  };
  add('@at', active ? 'Активная папка — ' + active.name : 'Активная папка');
  add('', 'Без папки');
  for(const f of folders){
    if(f.id === (snap && snap.active)) continue;      /* она уже первой строкой */
    add(f.id, '  '.repeat(f.depth) + (f.depth ? '└ ' : '') + f.name);
  }
  add('@new', '+ Новая папка…');
  sel.value = '@at';
}

/* Повтор ловим здесь же: иначе страница спросила бы про него в фоновой
   вкладке, и человек наткнулся бы на вопрос много позже и без контекста. */
function dupFolder(){
  if(!tab || !snap || !snap.urls) return undefined;
  const key = normUrl(tab.url);
  return Object.prototype.hasOwnProperty.call(snap.urls, key) ? snap.urls[key] : undefined;
}

function paintState(){
  const on = ok(), go = $('#go'), note = $('#note');
  go.disabled = !on;
  $('#all').disabled = !rest.length;
  $('#all').innerHTML = rest.length
    ? 'Забрать все вкладки окна — <b>' + rest.length + '</b>'
    : 'В этом окне больше нечего забирать';

  if(!on){
    note.hidden = false;
    note.textContent = 'Служебные страницы Chrome вне браузера ничего не значат.';
    return;
  }
  const dup = dupFolder();
  if(dup === undefined){
    go.textContent = 'Сохранить вкладку';
    note.hidden = !!snap;
    if(!snap) note.textContent = 'Папки покажу, как только ZAKLADKA откроется хоть раз.';
    return;
  }
  const f = ((snap && snap.folders) || []).find(x => x.id === dup);
  go.textContent = 'Сохранить ещё раз';
  note.hidden = false;
  note.innerHTML = 'Такая ссылка уже есть' + (f ? ' — в «<b>' + f.name + '</b>»' : ' в ZAKLADKA') + '.';
}

/* ── новая папка прямо здесь ──
   Имя уезжает вместе со ссылкой: страница сама найдёт папку с таким названием
   или заведёт её. Иначе попапу пришлось бы уметь создавать папки, а он до
   картотеки даже не дотягивается. */
function newMode(on){
  $('#selWrap').hidden = on;
  $('#newName').hidden = !on;
  if(on){ $('#newName').focus(); $('#newName').select(); }
}
$('#folder').addEventListener('change', e => { if(e.target.value === '@new') newMode(true); });
$('#newName').addEventListener('keydown', e => {
  if(e.key === 'Escape'){ $('#folder').value = '@at'; newMode(false); }
  if(e.key === 'Enter') $('#go').click();
});
$('#newName').addEventListener('blur', () => {
  if(!$('#newName').value.trim()){ $('#folder').value = '@at'; newMode(false); }
});

$('#closeAfter').addEventListener('change', async e => {
  await chrome.storage.local.set({ closeAfter: e.target.checked });
});

/* ── сохранение ── */
async function save(items, folder, newFolder){
  const r = await chrome.runtime.sendMessage({ type:'save', items, folder, newFolder });
  return r && r.ok ? r : null;
}
function done(btn, live, extra){
  btn.classList.add('ok');
  btn.textContent = live ? 'Сохранено' : 'Сохраню при открытии';
  $('#note').hidden = false;
  $('#note').textContent = live
    ? (extra || 'Ссылка уже в ZAKLADKA.')
    : 'ZAKLADKA сейчас закрыта — ссылки лягут в папку, как только откроется.';
}
/* Последнюю вкладку окна не закрываем — вместе с ней закроется само окно. */
async function closeTabs(ids){
  const inWindow = await chrome.tabs.query({ currentWindow: true });
  const go = ids.slice(0, Math.max(0, inWindow.length - 1));
  if(go.length) try{ await chrome.tabs.remove(go); }catch(e){}
}

$('#go').addEventListener('click', async e => {
  if(!ok()) return;
  const folder = $('#folder').value;
  const name = $('#newName').value.trim();
  if(folder === '@new' && !name){ $('#newName').focus(); return; }

  const go = $('#go');
  go.disabled = true;
  const r = await save([{ title: $('#title').value.trim() || tab.title || '', url: tab.url }], folder, name);
  if(!r){
    go.disabled = false;
    $('#note').hidden = false;
    $('#note').textContent = 'Не получилось сохранить — попробуйте ещё раз.';
    return;
  }
  done(go, r.live);
  /* ⌥ делает наоборот — на случай «в этот раз вкладку оставить». Закрываем
     не сразу: вместе с вкладкой пропадёт и это окошко вместе с ответом. */
  const shut = e.altKey ? !$('#closeAfter').checked : $('#closeAfter').checked;
  setTimeout(async () => { if(shut) await closeTabs([tab.id]); window.close(); }, 700);
});

/* ── всё окно разом ── */
const dateName = () => 'Вкладки, ' +
  new Date().toLocaleDateString('ru-RU', { day:'numeric', month:'long' });

$('#all').addEventListener('click', async e => {
  if(!rest.length) return;
  const btn = $('#all');
  btn.disabled = true;
  const name = dateName();
  const r = await save(rest.map(t => ({ title: t.title || '', url: t.url })), '@new', name);
  if(!r){
    btn.disabled = false;
    $('#note').hidden = false;
    $('#note').textContent = 'Не получилось сохранить — попробуйте ещё раз.';
    return;
  }
  btn.innerHTML = r.live
    ? 'Забрал <b>' + rest.length + '</b> ' + plural(rest.length,'вкладку','вкладки','вкладок') + ' → «' + name + '»'
    : 'Заберу при открытии ZAKLADKA';
  const shut = e.altKey ? !$('#closeAfter').checked : $('#closeAfter').checked;
  setTimeout(async () => { if(shut) await closeTabs(rest.map(t => t.id)); window.close(); }, 900);
});

$('#gear').addEventListener('click', () => {
  const box = $('#settings'), show = box.hidden;
  box.hidden = !show;
  $('#gear').setAttribute('aria-expanded', String(show));
  if(show) paintBackup();
});

/* Копия, которую присылает страница. Держим её здесь, но толку от неё нет,
   если её нельзя забрать — поэтому рядом кнопка «Скачать». */
async function paintBackup(){
  const list = (await chrome.storage.local.get('backups')).backups || [];
  const last = list[list.length - 1];
  const txt = $('#bakTxt');
  if(!last){
    txt.textContent = 'Запасная копия: пока нет — откройте ZAKLADKA';
    $('#bakGet').hidden = true;
    return;
  }
  const d = new Date(last.at);
  const when = d.toLocaleDateString('ru-RU', { day:'numeric', month:'long' }) + ', ' +
               d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  txt.textContent = 'Копия от ' + when + ' — ссылок: ' + (last.links || 0) +
                    (list.length > 1 ? ' (хранится ' + list.length + ')' : '');
  $('#bakGet').hidden = false;
}
$('#bakGet').addEventListener('click', async () => {
  const list = (await chrome.storage.local.get('backups')).backups || [];
  const last = list[list.length - 1];
  if(!last) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([last.json], { type:'application/json' }));
  a.download = 'zakladka-' + new Date(last.at).toISOString().slice(0,10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

$('#appUrl').addEventListener('change', async e => {
  const v = e.target.value.trim();
  if(v) await chrome.storage.local.set({ appUrl: v });
});
$('#newtabRedirect').addEventListener('change', async e => {
  await chrome.storage.local.set({ newtabRedirect: e.target.checked });
});

/* Разрешение на сайты — явной галочкой: без него ZAKLADKA не сможет спросить
   у расширения настоящее название страницы. */
(async () => {
  const box = $('#netAccess');
  box.checked = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  box.addEventListener('change', async e => {
    if(e.target.checked) e.target.checked = await chrome.permissions.request({ origins: ['<all_urls>'] });
    else await chrome.permissions.remove({ origins: ['<all_urls>'] });
  });
})();

boot();
