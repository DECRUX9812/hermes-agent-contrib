import{t as e}from"./styles-LQKrxs_r.js";function t(e){let t=document.createElement(`div`);return t.textContent=e,t.innerHTML}function n(n){let r=new URLSearchParams(location.search),i=r.get(`bot`)??`bot`,a=decodeURIComponent(r.get(`name`)??i),o=decodeURIComponent(r.get(`color`)??``),s=document.createElement(`style`);s.textContent=e,document.head.appendChild(s);let c=document.createElement(`div`);c.className=`hr-pill`,c.innerHTML=`
    <div class="hr-pill-head">
      <span class="hr-pill-avatar">${t(a.slice(0,1).toUpperCase())}</span>
      <span class="hr-pill-name">${t(a)}</span>
      <span class="hr-pill-status" data-kind="idle"></span>
    </div>
    <form class="hr-pill-form">
      <input class="hr-pill-input" placeholder="Ask ${t(a)}…" autocomplete="off" spellcheck="false" />
      <button class="hr-pill-send" type="submit" aria-label="Send">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 8h10M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </form>`,n.appendChild(c);let l=c.querySelector(`.hr-pill-input`),u=c.querySelector(`.hr-pill-form`),d=c.querySelector(`.hr-pill-status`),f=c.querySelector(`.hr-pill-name`),p=c.querySelector(`.hr-pill-avatar`),m=window.hermesDesktop;o&&c.style.setProperty(`--hr-pill-accent`,o),window.setTimeout(()=>l.focus(),80),u.addEventListener(`submit`,e=>{e.preventDefault();let t=l.value.trim();t&&(m?.botroom?.control?.({type:`task`,botId:i,text:t}),l.value=``,d.dataset.kind=`working`,l.blur())}),l.addEventListener(`keydown`,e=>{e.key===`Escape`&&l.blur()});let h=m?.botroomMascot?.onState?.(e=>{!e||e.id!==i||(e.displayName&&e.displayName!==a&&(a=e.displayName,f.textContent=e.displayName,p.textContent=e.displayName.slice(0,1).toUpperCase(),l.placeholder=`Ask ${e.displayName}…`),d.dataset.kind=e.status===`working`?`working`:e.status===`sleeping`?`sleeping`:`idle`,d.title=e.statusLine??``)});window.addEventListener(`beforeunload`,()=>h?.())}export{n as mountBotRoomPillWindow};