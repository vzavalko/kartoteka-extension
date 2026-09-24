/* Новая вкладка. По умолчанию показываем ZAKLADKA во фрейме на всю страницу.
   Не переходом: после location.replace в адресной строке висел бы адрес
   github.io, а курсор уходил бы из неё. Мост (bridge.js) попадает во фрейм
   сам — у контент-скрипта all_frames. Если автопереход выключен, показываем
   локальную страницу с теми же действиями. */
(async () => {
  const { appUrl, newtabRedirect } = await chrome.storage.local.get(['appUrl', 'newtabRedirect']);
  const url = appOr(appUrl);

  const $ = s => document.querySelector(s);
  if(newtabRedirect !== false){
    $('#app').src = url;
    $('#app').hidden = false;
    return;
  }

  $('#panel').hidden = false;

  $('#open').addEventListener('click', () => { $('#panel').hidden = true; $('#app').src = url; $('#app').hidden = false; });
  $('#stash').addEventListener('click', async () => {
    const all = await chrome.tabs.query({ currentWindow: true });
    const mine = all.filter(t => savable(t.url) && t.url !== url && !t.pinned);
    const payload = mine.map(t => ({ title: t.title || '', url: t.url }));
    if(!payload.length){ $('#sub').textContent = 'Сдавать нечего.'; return; }
    try{ await navigator.clipboard.writeText(linesFor(payload)); }
    catch(e){ $('#sub').textContent = 'Не удалось скопировать — вкладки не тронуты.'; return; }
    await chrome.tabs.remove(mine.map(t => t.id));
    location.replace(url);
  });
})();
