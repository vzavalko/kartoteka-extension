importScripts('common.js', 'resolve.js');

/* ── сохранение одной вкладки ──
   Единственный путь, которым ссылка попадает в ZAKLADKA из расширения: им
   пользуются и кнопка в попапе, и горячая клавиша. Если страница открыта —
   отдаём ей напрямую, она сама разберётся с повторами и названием. Если нет —
   кладём в почтовый ящик, мост заберёт его при следующем открытии. */
/* Страница живёт и в обычной вкладке, и во фрейме новой вкладки. У второй
   адрес chrome://newtab — шаблоном url его не найти, поэтому фильтруем сами.
   Новая вкладка без фрейма (автопереход выключен) просто не ответит. */
const NEWTAB = /^chrome:\/\/newtab\b|^chrome-extension:\/\/[^/]+\/newtab\.html/;
async function appTabs(){
  const { appUrl } = await getSettings();
  const roots = [appUrl].concat(OLD_APPS).map(u => String(u).replace(/\/?$/, '/'));
  let all = [];
  try{ all = await chrome.tabs.query({}); }catch(e){ return []; }
  return all.filter(t => {
    const u = t.url || t.pendingUrl || '';
    return NEWTAB.test(u) || roots.some(r => u.startsWith(r));
  });
}

const INBOX_MAX = 300;

async function deliver(items, folder, newFolder){
  const list = (items || []).filter(x => x && x.url);
  if(!list.length) return { ok:false };
  let out = null;
  for(const t of await appTabs()){
    try{
      const r = await chrome.tabs.sendMessage(t.id, { type:'push', items:list, folder, newFolder });
      if(r && r.ok){ out = { ok:true, live:true }; break; }
    }catch(e){}
  }
  if(!out){
    const inbox = (await chrome.storage.local.get('inbox')).inbox || [];
    for(const it of list) inbox.push({ title: it.title || '', url: it.url, folder, newFolder });
    while(inbox.length > INBOX_MAX) inbox.shift();
    await chrome.storage.local.set({ inbox });
    await paintBadge(inbox.length);
    out = { ok:true, live:false };
  }
  await noteSaved(list, folder);
  return out;
}

/* Дописываем сохранённое в свой снимок, не дожидаясь нового от страницы:
   иначе галочка на значке появится через полминуты, а попап ещё раз предложит
   сохранить то, что только что сохранили. */
async function noteSaved(list, folder){
  const snap = (await chrome.storage.local.get('snap')).snap;
  if(!snap || !snap.urls) return;
  const where = (folder === undefined || folder === '@at') ? (snap.active || '')
              : (folder === '@new' ? '' : folder);
  for(const it of list) snap.urls[normUrl(it.url)] = where;
  await chrome.storage.local.set({ snap });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'save') return;
  deliver(msg.items, msg.folder, msg.newFolder).then(reply, () => reply({ ok:false }));
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
    snap: { at: Date.now(), folders: msg.folders || [], active: msg.at || null, urls: msg.urls || {}, theme: msg.theme || 'light' }
  }).then(() => { markActive(); reply({ ok:true }); }, () => reply({ ok:false }));
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
  else markTab(tab.id, tab.url);
});

/* ── галочка на значке ──
   Вкладка, которая уже лежит в картотеке, получает свою иконку: тот же розовый
   квадрат, но вместо папки галочка — чтобы не открывать попап ради проверки.
   Иконка у каждой вкладки своя (`tabId`) и с текстом значка не спорит, так что
   счётчик ожидающих ссылок виден поверх неё как обычно. */
const ICON = { 16: 'icons/icon16.png', 32: 'icons/icon32.png' };
const SAVED = { 16: 'icons/saved16.png', 32: 'icons/saved32.png' };

async function markTab(tabId, url){
  if(!Number.isInteger(tabId)) return;
  const urls = ((await chrome.storage.local.get('snap')).snap || {}).urls || null;
  const known = !!urls && savable(url) &&
                Object.prototype.hasOwnProperty.call(urls, normUrl(url));
  try{ await chrome.action.setIcon({ tabId, path: known ? SAVED : ICON }); }
  catch(e){}   /* вкладка могла закрыться, пока мы ходили в хранилище */
}

/* Активные вкладки всех окон: снимок поменялся — метки могли устареть. */
async function markActive(){
  let list = [];
  try{ list = await chrome.tabs.query({ active: true }); }catch(e){ return; }
  for(const t of list) await markTab(t.id, t.url);
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try{ const t = await chrome.tabs.get(tabId); markTab(tabId, t.url); }catch(e){}
});
chrome.tabs.onUpdated.addListener((tabId, info, t) => {
  if(info.url || info.status === 'complete') markTab(tabId, t.url);
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
    const pages = await appTabs();
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
