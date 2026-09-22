/* Новая вкладка. По умолчанию сразу уходим в ZAKLADKA: встроить её во фрейм
   нельзя — claude.ai отдаёт x-frame-options: SAMEORIGIN. Если автопереход
   выключен, показываем локальную страницу с теми же действиями. */
(async () => {
  const { appUrl, newtabRedirect } = await chrome.storage.local.get(['appUrl', 'newtabRedirect']);
  const url = appOr(appUrl);

  if(newtabRedirect !== false){ location.replace(url); return; }

  const $ = s => document.querySelector(s);
  $('#panel').hidden = false;
  const queue = await getQueue();
  if(queue.length) $('#sub').textContent = 'В очереди ' + queue.length + ' — сдайте их через значок расширения.';

  $('#open').addEventListener('click', () => location.replace(url));
  $('#stash').addEventListener('click', async () => {
    const all = await chrome.tabs.query({ currentWindow: true });
    const mine = all.filter(t => savable(t.url) && t.url !== url && !t.pinned);
    const payload = queue.concat(mine.map(t => ({ title: t.title || '', url: t.url })));
    if(!payload.length){ $('#sub').textContent = 'Сдавать нечего.'; return; }
    try{ await navigator.clipboard.writeText(linesFor(payload)); }
    catch(e){ $('#sub').textContent = 'Не удалось скопировать — вкладки не тронуты.'; return; }
    await setQueue([]);
    if(mine.length) await chrome.tabs.remove(mine.map(t => t.id));
    location.replace(url);
  });
})();
