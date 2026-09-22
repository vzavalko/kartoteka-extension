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
