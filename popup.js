/* Список вкладок текущего окна + очередь, сданная горячей клавишей.
   Всё уезжает в буфер обмена строками «Заголовок | адрес» — ZAKLADKA
   разбирает такой формат при вставке. */
const $ = s => document.querySelector(s);
let tabs = [], queue = [], picked = new Set(), settings = null;

const plural = (n,a,b,c) => { const m = n % 100, k = n % 10;
  return (m > 10 && m < 20) ? c : k === 1 ? a : (k >= 2 && k <= 4) ? b : c; };
const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return u; } };

async function boot(){
  settings = await getSettings();
  queue = await getQueue();
  $('#appUrl').value = settings.appUrl;
  $('#closeAfter').checked = settings.closeAfter;
  $('#newtabRedirect').checked = settings.newtabRedirect;

  const all = await chrome.tabs.query({ currentWindow: true });
  const appHost = (() => { try{ return new URL(settings.appUrl).href; }catch(e){ return ''; } })();
  tabs = all.filter(t => savable(t.url) && t.url !== appHost);
  picked = new Set(tabs.filter(t => !t.pinned).map(t => t.id));

  $('#count').textContent = tabs.length + ' ' + plural(tabs.length,'вкладка','вкладки','вкладок');
  paint();
}

function visible(){
  const q = $('#q').value.trim().toLowerCase();
  if(!q) return tabs;
  return tabs.filter(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q));
}

function paint(){
  const list = $('#list'), rows = visible();
  list.innerHTML = '';
  for(const t of rows){
    const li = document.createElement('li');
    li.dataset.id = t.id;

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = picked.has(t.id);
    li.appendChild(cb);

    if(t.favIconUrl && /^https?:|^data:/.test(t.favIconUrl)){
      const img = document.createElement('img');
      img.className = 'fav'; img.src = t.favIconUrl; img.alt = '';
      img.onerror = () => { img.replaceWith(letterTile(t.url)); };
      li.appendChild(img);
    } else li.appendChild(letterTile(t.url));

    const txt = document.createElement('div');
    txt.className = 'txt';
    const a = document.createElement('div'); a.className = 't'; a.textContent = t.title || hostOf(t.url);
    const b = document.createElement('div'); b.className = 'h'; b.textContent = hostOf(t.url);
    txt.append(a, b);
    li.appendChild(txt);
    if(t.pinned){ const p = document.createElement('span'); p.className = 'pin'; p.textContent = 'закреплена'; li.appendChild(p); }

    li.addEventListener('click', e => {
      if(e.target !== cb) cb.checked = !cb.checked;
      cb.checked ? picked.add(t.id) : picked.delete(t.id);
      refreshButton();
    });
    list.appendChild(li);
  }
  $('#none').hidden = tabs.length > 0;
  $('#queueBox').hidden = queue.length === 0;
  $('#qn').textContent = queue.length;
  refreshButton();
}
function letterTile(url){
  const s = document.createElement('span');
  s.className = 'fav letter';
  const h = hostOf(url).split('.');
  s.textContent = (h.length > 1 ? h[h.length-2] : h[0] || '?')[0] || '?';
  return s;
}
function refreshButton(){
  const n = picked.size + queue.length;
  $('#go').disabled = n === 0;
  $('#go').textContent = n ? 'Сдать ' + n + ' ' + plural(n,'ссылку','ссылки','ссылок') : 'Сдать';
  $('#hint').textContent = queue.length && picked.size
    ? 'Уедут и выбранные вкладки, и очередь.'
    : (picked.size ? 'Вкладки закроются, ссылки лягут в буфер.' : '');
}

$('#q').addEventListener('input', paint);
$('#selAll').addEventListener('click', () => { visible().forEach(t => picked.add(t.id)); paint(); });
$('#selNone').addEventListener('click', () => { visible().forEach(t => picked.delete(t.id)); paint(); });
$('#gear').addEventListener('click', () => { $('#settings').hidden = !$('#settings').hidden; });
$('#appUrl').addEventListener('change', async e => {
  const v = e.target.value.trim();
  if(v) await chrome.storage.local.set({ appUrl: v });
});
$('#closeAfter').addEventListener('change', async e => {
  await chrome.storage.local.set({ closeAfter: e.target.checked });
});
$('#newtabRedirect').addEventListener('change', async e => {
  await chrome.storage.local.set({ newtabRedirect: e.target.checked });
});
$('#qClear').addEventListener('click', async () => { queue = []; await setQueue(queue); paint(); });

$('#go').addEventListener('click', async () => {
  const chosen = tabs.filter(t => picked.has(t.id));
  const payload = queue.concat(chosen.map(t => ({ title: t.title || '', url: t.url })));
  if(!payload.length) return;

  /* Буфер пишем первым делом: если сорвётся, вкладки останутся целы. */
  try{
    await navigator.clipboard.writeText(linesFor(payload));
  }catch(e){
    $('#done').hidden = false; $('#main').hidden = true;
    $('#done').innerHTML = '<div class="big">Не удалось скопировать</div><div class="sub">Chrome не дал доступ к буферу обмена. Вкладки не тронуты.</div>';
    return;
  }

  queue = []; await setQueue(queue);
  const url = ($('#appUrl').value.trim() || DEFAULT_APP);
  await chrome.storage.local.set({ appUrl: url });

  $('#main').hidden = true; $('#done').hidden = false;

  /* Сначала открываем ZAKLADKA, потом закрываем сданные вкладки —
     иначе закрытие последней вкладки утянет за собой окно. */
  const open = await chrome.tabs.query({ currentWindow: true });
  const already = open.find(t => t.url && t.url.startsWith(url));
  let appTab;
  if(already){ appTab = already; await chrome.tabs.update(already.id, { active: true }); }
  else appTab = await chrome.tabs.create({ url, active: true });

  if($('#closeAfter').checked && chosen.length){
    const ids = chosen.filter(t => !t.pinned).map(t => t.id);
    if(ids.length) await chrome.tabs.remove(ids);
  }

  /* На своём домене страница слышит расширение — тогда ⌘V не нужен вовсе. */
  const pushed = await pushTo(appTab.id, payload);
  if(pushed){
    $('#done').innerHTML = '<div class="big">Сохранено в ZAKLADKA</div><div class="sub">' +
      payload.length + ' ' + plural(payload.length,'ссылка','ссылки','ссылок') + ' уже на месте.</div>';
  }
  setTimeout(() => window.close(), pushed ? 1100 : 900);
});

boot();

/* ───────── адрес без открытой вкладки ─────────
   Заголовок берём из сети силами расширения: страница ZAKLADKA так не умеет,
   на ней запрет на любые внешние запросы. */
const rawIn = $('#rawUrl'), rawGo = $('#rawGo'), rawNote = $('#rawNote');

function urlsIn(text){
  const out = [];
  for(const part of String(text || '').split(/[\s,]+/)){
    const t = part.trim(); if(!t) continue;
    try{
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : 'https://' + t);
      if(/^https?:$/.test(u.protocol) && !out.includes(u.href)) out.push(u.href);
    }catch(e){}
  }
  return out;
}

/* Если в буфере уже лежит адрес — подставим, чтобы не вставлять руками. */
(async () => {
  try{
    const text = await navigator.clipboard.readText();
    const list = urlsIn(text);
    if(list.length && !list.some(u => u.startsWith('http') && text.includes(' | '))){
      rawIn.value = list.join(' ');
      rawIn.placeholder = '';
      note(list.length === 1 ? 'Адрес взят из буфера.' : 'Из буфера: ' + list.length + ' ' + plural(list.length,'адрес','адреса','адресов') + '.');
    }
  }catch(e){ /* без разрешения или пустой буфер — просто оставим поле пустым */ }
})();

function note(html){ rawNote.hidden = false; rawNote.innerHTML = html; }

rawGo.addEventListener('click', async () => {
  const list = urlsIn(rawIn.value);
  if(!list.length){ note('Не вижу адреса.'); rawIn.focus(); return; }

  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if(!granted){ note('Без доступа к сайтам название не узнать — можно добавить и без него.'); return; }

  rawGo.disabled = true;
  const done = [];
  for(let i = 0; i < list.length; i++){
    note('Узнаю названия… <b>' + (i + 1) + ' из ' + list.length + '</b>');
    const title = await resolveTitle(list[i]);
    done.push({ title, url: list[i] });
  }
  rawGo.disabled = false;

  const named = done.filter(d => d.title).length;
  try{
    await navigator.clipboard.writeText(linesFor(done));
  }catch(e){ note('Не удалось записать в буфер.'); return; }

  note('Готово: <b>' + named + ' из ' + list.length + '</b> с названием. Открываю ZAKLADKA — нажмите ⌘V.');
  const url = ($('#appUrl').value.trim() || DEFAULT_APP);
  const open = await chrome.tabs.query({ currentWindow: true });
  const already = open.find(t => t.url === url);
  if(already) await chrome.tabs.update(already.id, { active: true });
  else await chrome.tabs.create({ url, active: true });
  setTimeout(() => window.close(), 1200);
});
rawIn.addEventListener('keydown', e => { if(e.key === 'Enter') rawGo.click(); });

/* Страница отвечает не сразу после открытия — даём мосту подняться. */
async function pushTo(tabId, items){
  for(let i = 0; i < 6; i++){
    try{
      const r = await chrome.tabs.sendMessage(tabId, { type:'push', items });
      if(r && r.ok) return true;
    }catch(e){}
    await new Promise(r => setTimeout(r, 350));
  }
  return false;
}

/* Разрешение на сайты — явной галочкой, а не только при нажатии «Узнать»:
   без него страница ZAKLADKA не сможет спросить название у расширения. */
(async () => {
  const box = $('#netAccess');
  const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  box.checked = has;
  box.addEventListener('change', async e => {
    if(e.target.checked){
      const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
      e.target.checked = ok;
      if(ok) note('Теперь названия узнаются и при вставке прямо в ZAKLADKA.');
    }else{
      await chrome.permissions.remove({ origins: ['<all_urls>'] });
      note('Доступ отозван — названия будут собираться из адреса.');
    }
  });
})();
