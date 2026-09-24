/* Окно у значка расширения: одна кнопка «Сохранить вкладку» и выбор папки.
   Про папки попап знает только со слов самой страницы — она присылает снимок
   через мост, расширение держит его в chrome.storage. Если страница ни разу не
   открывалась, снимка нет: остаются «Активная папка» и «Без папки». */
const $ = s => document.querySelector(s);
let tab = null, snap = null;

const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return u || ''; } };

function letterTile(url){
  const h = hostOf(url).split('.');
  return (h.length > 1 ? h[h.length - 2] : h[0] || '?')[0] || '?';
}

async function boot(){
  const settings = await getSettings();
  $('#appUrl').value = settings.appUrl;
  $('#newtabRedirect').checked = settings.newtabRedirect;

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  snap = (await chrome.storage.local.get('snap')).snap || null;

  paintTab();
  paintFolders();
  paintState();
}

function paintTab(){
  const ok = tab && savable(tab.url);
  $('#title').textContent = ok ? (tab.title || hostOf(tab.url)) : 'Эту страницу сохранять нечего';
  $('#host').textContent = ok ? hostOf(tab.url) : (tab ? (tab.url || '').split('/')[0] : '');
  const fav = $('#fav');
  fav.textContent = ok ? letterTile(tab.url) : '?';   /* запасной вариант готовим заранее */
  if(ok && tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)){
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
  const ok = tab && savable(tab.url);
  const go = $('#go'), note = $('#note');
  go.disabled = !ok;
  if(!ok){
    note.hidden = false;
    note.textContent = 'Служебные страницы Chrome вне браузера ничего не значат.';
    return;
  }
  const dup = dupFolder();
  if(dup === undefined){
    go.textContent = 'Сохранить вкладку';
    note.hidden = !!snap;
    if(!snap) note.innerHTML = 'Папки покажу, как только ZAKLADKA откроется хоть раз.';
    return;
  }
  const f = ((snap && snap.folders) || []).find(x => x.id === dup);
  go.textContent = 'Сохранить ещё раз';
  note.hidden = false;
  note.innerHTML = 'Такая ссылка уже есть' + (f ? ' — в «<b>' + f.name + '</b>»' : ' в ZAKLADKA') + '.';
}

$('#go').addEventListener('click', async () => {
  if(!tab || !savable(tab.url)) return;
  const go = $('#go');
  go.disabled = true;
  const folder = $('#folder').value;
  const r = await chrome.runtime.sendMessage({
    type: 'save',
    items: [{ title: tab.title || '', url: tab.url }],
    folder
  });
  if(!r || !r.ok){
    go.disabled = false;
    $('#note').hidden = false;
    $('#note').textContent = 'Не получилось сохранить — попробуйте ещё раз.';
    return;
  }
  go.classList.add('ok');
  go.textContent = r.live ? 'Сохранено' : 'Сохраню при открытии';
  $('#note').hidden = false;
  $('#note').textContent = r.live
    ? 'Ссылка уже в ZAKLADKA.'
    : 'ZAKLADKA сейчас закрыта — ссылка ляжет в папку, как только откроется.';
  setTimeout(() => window.close(), 900);
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
