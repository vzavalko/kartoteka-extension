importScripts('common.js', 'resolve.js');

/* ── сохранение одной вкладки ──
   Единственный путь, которым ссылка попадает в ZAKLADKA из расширения: им
   пользуются и кнопка в попапе, и горячая клавиша. Если страница открыта —
   отдаём ей напрямую, она сама разберётся с повторами и названием. Если нет —
   кладём в почтовый ящик, мост заберёт его при следующем открытии. */
async function appTabs(){
  const { appUrl } = await getSettings();
  const pats = [appUrl].concat(OLD_APPS).map(u => String(u).replace(/\/?$/, '/') + '*');
  try{ return await chrome.tabs.query({ url: pats }); }catch(e){ return []; }
}

const INBOX_MAX = 300;

async function deliver(items, folder){
  const list = (items || []).filter(x => x && x.url);
  if(!list.length) return { ok:false };
  for(const t of await appTabs()){
    try{
      const r = await chrome.tabs.sendMessage(t.id, { type:'push', items:list, folder });
      if(r && r.ok) return { ok:true, live:true };
    }catch(e){}
  }
  const inbox = (await chrome.storage.local.get('inbox')).inbox || [];
  for(const it of list) inbox.push({ title: it.title || '', url: it.url, folder });
  while(inbox.length > INBOX_MAX) inbox.shift();
  await chrome.storage.local.set({ inbox });
  await paintBadge(inbox.length);
  return { ok:true, live:false };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'save') return;
  deliver(msg.items, msg.folder).then(reply, () => reply({ ok:false }));
  return true;
});

/* Мост спрашивает при каждом открытии страницы: что накопилось, пока её не было. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'inbox') return;
  (async () => {
    const inbox = (await chrome.storage.local.get('inbox')).inbox || [];
    if(inbox.length){ await chrome.storage.local.set({ inbox: [] }); await paintBadge(0); }
    reply({ items: inbox });
  })();
  return true;
});

/* ── снимок страницы ──
   Папки и адреса живут в localStorage страницы, попапу туда хода нет. Страница
   присылает выжимку сама — после каждой правки. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'snapshot') return;
  chrome.storage.local.set({
    snap: { at: Date.now(), folders: msg.folders || [], active: msg.at || null, urls: msg.urls || {} }
  }).then(() => reply({ ok:true }), () => reply({ ok:false }));
  return true;
});

/* Горячая клавиша: текущая вкладка уезжает в ту папку, куда складывают сейчас,
   и закрывается. Значок коротко показывает галочку — попапа-то нет. */
chrome.commands.onCommand.addListener(async cmd => {
  if(cmd !== 'stash-current') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab || !savable(tab.url)) return;
  const r = await deliver([{ title: tab.title || '', url: tab.url }], '@at');
  if(!r.ok) return;
  if(r.live) flashBadge();
  /* последнюю вкладку окна не закрываем — иначе закроется само окно */
  const inWindow = await chrome.tabs.query({ currentWindow: true });
  if(inWindow.length > 1) chrome.tabs.remove(tab.id);
});

let flashTimer = null;
function flashBadge(){
  clearTimeout(flashTimer);
  chrome.action.setBadgeText({ text: '\u2713' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#FA0CF7' }).catch(() => {});
  flashTimer = setTimeout(async () => {
    const inbox = (await chrome.storage.local.get('inbox')).inbox || [];
    paintBadge(inbox.length);
  }, 1400);
}

const waiting = async () => ((await chrome.storage.local.get('inbox')).inbox || []).length;
chrome.runtime.onStartup.addListener(async () => paintBadge(await waiting()));
chrome.runtime.onInstalled.addListener(async () => paintBadge(await waiting()));

/* Страница просит узнать названия. Сама она не может: чужой сайт ей читать
   не дадут (CORS), а расширению с выданным разрешением — можно. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'resolve') return;
  (async () => {
    let allowed = false;
    try{ allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] }); }catch(e){}
    if(!allowed){ reply([]); return; }
    const out = [];
    for(const u of (msg.urls || [])) out.push({ url: u, title: await resolveTitle(u) });
    reply(out);
  })();
  return true;   /* ответим асинхронно */
});

/* ── Полоса открытых вкладок на странице ──
   Страница сама про вкладки ничего не знает, поэтому список собираем здесь и
   отдаём по запросу, а на любое изменение шлём новый — иначе полоса врала бы
   про закрытые вкладки. Отдаём только вкладки того окна, из которого спросили:
   полоса про «здесь и сейчас», чужие окна в ней только мешают. */
const tabItem = t => ({ id:t.id, title:t.title || '', url:t.url || '', pinned:!!t.pinned, active:!!t.active });

async function tabsOf(windowId){
  const list = await chrome.tabs.query(windowId ? { windowId } : { currentWindow: true });
  return list.filter(t => savable(t.url) && !t.pinned).map(tabItem);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'tabs') return;
  (async () => {
    const wid = sender.tab ? sender.tab.windowId : undefined;
    const list = await tabsOf(wid);
    /* саму страницу ZAKLADKA в список не кладём — её сохранять незачем */
    reply(sender.tab ? list.filter(t => t.id !== sender.tab.id) : list);
  })();
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'close') return;
  (async () => {
    const ids = (msg.ids || []).filter(Number.isInteger);
    if(!ids.length){ reply({ closed: 0 }); return; }
    /* последнюю вкладку окна не трогаем — вместе с ней закроется окно */
    const wid = sender.tab ? sender.tab.windowId : undefined;
    const inWindow = await chrome.tabs.query(wid ? { windowId: wid } : { currentWindow: true });
    const keepAlive = inWindow.length - ids.length < 1;
    const go = keepAlive ? ids.slice(0, Math.max(0, inWindow.length - 1)) : ids;
    try{ await chrome.tabs.remove(go); }catch(e){}
    reply({ closed: go.length });
  })();
  return true;
});

/* Рассылаем обновлённый список тем страницам, где живёт мост. */
let blinkTimer = null;
function tabsChanged(){
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(async () => {
    let pages = [];
    try{ pages = await chrome.tabs.query({ url: ['https://vzavalko.github.io/zakladka/*', 'https://vzavalko.github.io/kartoteka/*'] }); }
    catch(e){ return; }
    for(const p of pages){
      const list = (await tabsOf(p.windowId)).filter(t => t.id !== p.id);
      chrome.tabs.sendMessage(p.id, { type:'tablist', items: list }).catch(() => {});
    }
  }, 150);
}
chrome.tabs.onCreated.addListener(tabsChanged);
chrome.tabs.onRemoved.addListener(tabsChanged);
chrome.tabs.onUpdated.addListener((id, info) => { if(info.status === 'complete' || info.title || info.url) tabsChanged(); });

/* ── Проверка, жива ли ссылка ──
   Страница этого не может: чужой домен ей читать не дают. Нас интересует
   только «отвечает или нет», поэтому тела не ждём и режем по таймауту. */
async function aliveOne(url){
  const ctl = new AbortController();
  const stop = setTimeout(() => ctl.abort(), 9000);
  try{
    let r = await fetch(url, { method:'HEAD', redirect:'follow', signal:ctl.signal });
    /* часть сайтов отвечает на HEAD отказом, хотя страница есть */
    if(r.status === 405 || r.status === 501)
      r = await fetch(url, { method:'GET', redirect:'follow', signal:ctl.signal });
    return { url, status: r.status, dead: r.status >= 400 };
  }catch(e){
    return { url, status: 0, dead: e.name !== 'AbortError' };
  }finally{ clearTimeout(stop); }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'alive') return;
  (async () => {
    let allowed = false;
    try{ allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] }); }catch(e){}
    if(!allowed){ reply({ denied: true, items: [] }); return; }
    const urls = (msg.urls || []).slice(0, 300);
    const items = [];
    /* по восемь за раз: разом три сотни запросов браузер не обрадуется */
    for(let i = 0; i < urls.length; i += 8)
      items.push(...await Promise.all(urls.slice(i, i + 8).map(aliveOne)));
    reply({ denied: false, items });
  })();
  return true;
});

/* ── Запасная копия ──
   Страница присылает выгрузку, мы держим её у себя. Это другое хранилище:
   чистка данных сайта его не трогает, а localStorage страницы — сметает.
   Чаще раза в сутки не пишем: смысл в «вчерашнем состоянии», а не в копии
   того же самого по десять раз за вечер. */
const DAY = 24 * 60 * 60 * 1000, KEEP = 5;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'backup') return;
  (async () => {
    const json = String(msg.json || '');
    if(json.length < 2 || json.length > 4e6){ reply({ saved:false }); return; }
    const store = (await chrome.storage.local.get('backups')).backups || [];
    const last = store[store.length - 1];
    if(last && Date.now() - last.at < DAY && !msg.force){ reply({ saved:false, at:last.at }); return; }
    store.push({ at: Date.now(), links: msg.links | 0, json });
    while(store.length > KEEP) store.shift();
    try{ await chrome.storage.local.set({ backups: store }); }
    catch(e){ reply({ saved:false, error:String(e) }); return; }
    reply({ saved:true, at: store[store.length - 1].at, kept: store.length });
  })();
  return true;
});
