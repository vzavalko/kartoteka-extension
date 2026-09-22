/* Общее для попапа и фонового скрипта. */
const DEFAULT_APP = 'https://vzavalko.github.io/zakladka/';

/* Сервис назывался «Картотека» и жил по другому адресу. Кто уже пользовался,
   держит старый адрес в настройках — молча переводим на новый, иначе новая
   вкладка будет упираться в несуществующую страницу. */
const OLD_APPS = ['https://vzavalko.github.io/kartoteka/'];
const appOr = u => (!u || OLD_APPS.includes(u)) ? DEFAULT_APP : u;

/* Служебные страницы сохранять нечего: их адрес вне Chrome ничего не значит. */
const SKIP = /^(chrome|edge|about|chrome-extension|devtools|view-source|file):/i;
const savable = u => !!u && !SKIP.test(u) && !/^https?:\/\/(newtab|chrome\.google\.com\/webstore)/i.test(u);

async function getSettings(){
  const s = await chrome.storage.local.get(['appUrl', 'closeAfter', 'newtabRedirect']);
  const appUrl = appOr(s.appUrl);
  if(appUrl !== s.appUrl && s.appUrl) chrome.storage.local.set({ appUrl });
  return {
    appUrl,
    closeAfter: s.closeAfter !== false,
    newtabRedirect: s.newtabRedirect !== false
  };
}
async function getQueue(){ return (await chrome.storage.local.get('queue')).queue || []; }
async function setQueue(q){ await chrome.storage.local.set({ queue: q }); await paintBadge(q.length); }

async function paintBadge(n){
  try{
    await chrome.action.setBadgeText({ text: n ? String(n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#FA0CF7' });
  }catch(e){}
}

/* Формат, который ZAKLADKA понимает при вставке: «Заголовок | адрес». */
const lineFor = t => (t.title && t.title.trim() ? t.title.trim().replace(/\s+/g,' ') + ' | ' : '') + t.url;
const linesFor = list => list.map(lineFor).join('\n');
