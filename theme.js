/* Тема попапа и новой вкладки — та же, что выбрана в самой ZAKLADKA.
   Страница сообщает её в снимке, но chrome.storage асинхронный, и окошко
   успевало бы мигнуть светлым. Поэтому последнюю известную тему держим ещё и
   в localStorage расширения — он читается сразу, до первой отрисовки. */
(function(){
  const KEY = 'zakladka.theme';
  const apply = t => {
    if(t === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
  };
  try{ apply(localStorage.getItem(KEY)); }catch(e){}
  chrome.storage.local.get('snap').then(({ snap }) => {
    const t = snap && snap.theme === 'dark' ? 'dark' : 'light';
    apply(t);
    try{ localStorage.setItem(KEY, t); }catch(e){}
  }, () => {});
})();
