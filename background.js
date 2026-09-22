importScripts('common.js', 'resolve.js');

/* Горячая клавиша: текущая вкладка уходит в очередь и закрывается.
   Буфер обмена из фонового скрипта недоступен — нет документа, — поэтому
   копчение происходит позже, в попапе, разом по всей очереди. */
chrome.commands.onCommand.addListener(async cmd => {
  if(cmd !== 'stash-current') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if(!tab || !savable(tab.url)) return;
  const queue = await getQueue();
  if(!queue.some(q => q.url === tab.url)) queue.push({ title: tab.title || '', url: tab.url });
  await setQueue(queue);
  /* последнюю вкладку окна не закрываем — иначе закроется само окно */
  const inWindow = await chrome.tabs.query({ currentWindow: true });
  if(inWindow.length > 1) chrome.tabs.remove(tab.id);
});

chrome.runtime.onStartup.addListener(async () => paintBadge((await getQueue()).length));
chrome.runtime.onInstalled.addListener(async () => paintBadge((await getQueue()).length));

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
