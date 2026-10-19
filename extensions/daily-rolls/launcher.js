/* Only the launcher and schedule header are changed. Hapana forms stay untouched.
   DOM anchors were inspected on live Hapana on 12 September 2026. */
function createRollLauncher({document, runtime, isSchedule, MutationObserver, requestAnimationFrame}) {
  const launcherId='stp-rolls-launcher', styleId='stp-rolls-launcher-style';
  const headerClass='stp-rolls-sticky-header';
  const normalTitle='Generate rolls for the selected Hapana day. Choose rooms before printing.';
  let host=null, link=null, label=null, notice=null, header=null, busy=false, queued=false, observer=null;
  const css=`
    /* Sticky, not fixed: the header keeps its original space in document flow.
       1000 is below Hapana's inspected Add Clients backdrop (1039) and panel (1040). */
    header.${headerClass}{position:sticky!important;top:0!important;z-index:1000!important;background:#1a1932}
    #${launcherId}{position:relative!important;float:none;list-style:none;margin:0}
    #${launcherId} > a.stp-rolls-nav-link{
      display:flex;align-items:center;gap:5px;white-space:nowrap;
      color:#b9bfcb;background:transparent;border:0;border-radius:0;box-shadow:none;
      cursor:pointer;font:inherit;text-decoration:none
    }
    #${launcherId} > a.stp-rolls-nav-link:hover{color:#fff;background:rgba(255,255,255,.055)}
    #${launcherId} > a.stp-rolls-nav-link:focus-visible{outline:2px solid #31c8ff;outline-offset:-4px;color:#fff}
    #${launcherId} > a.stp-rolls-nav-link[aria-disabled="true"]{opacity:.55;cursor:wait}
    #${launcherId} .stp-rolls-icon{font-size:.95em;flex-shrink:0}
    #${launcherId} .stp-rolls-status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;pointer-events:none}
    @media(max-width:767px){
      header.${headerClass} #navbar.show{max-height:calc(100vh - 72px);overflow-y:auto}
    }
    @media print{header.${headerClass}{position:static!important;z-index:auto!important}#${launcherId}{display:none!important}}
  `;
  function ensureStyle() {
    if(document.getElementById(styleId))return;
    const style=document.createElement('style');style.id=styleId;style.textContent=css;
    (document.head||document.body).append(style);
  }
  async function launch(event) {
    event.preventDefault();event.stopPropagation();
    if(busy||!isSchedule())return;
    busy=true;link.setAttribute('aria-disabled','true');link.setAttribute('aria-busy','true');
    notice.textContent='Opening Daily Rolls…';
    try {
      const response=await runtime.sendMessage({namespace:'stp-rolls',type:'OPEN_REVIEW'});
      if(!response?.ok)throw new Error('Could not open Daily Rolls.');
      label.textContent='Daily Rolls';link.title=normalTitle;notice.textContent='Daily Rolls opened in a new tab.';
    } catch {
      label.textContent='Reload Hapana';
      link.title='Daily Rolls could not open. Refresh Hapana after reloading the extension, then try again.';
      notice.textContent=link.title;
    } finally {
      busy=false;link.removeAttribute('aria-disabled');link.removeAttribute('aria-busy');
    }
  }
  function makeHost() {
    host=document.createElement('li');host.id=launcherId;host.className='nav-item';
    // A native-looking nav link with button semantics, matching Hapana's link padding.
    link=document.createElement('a');link.href='#';link.className='nav-link py-2 py-md-3 stp-rolls-nav-link';
    link.setAttribute('role','button');link.title=normalTitle;
    const icon=document.createElement('span');icon.className='glyphicon glyphicon-list-alt stp-rolls-icon';icon.setAttribute('aria-hidden','true');
    label=document.createElement('span');label.textContent='Daily Rolls';
    notice=document.createElement('span');notice.className='stp-rolls-status';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
    link.append(icon,label);host.append(link,notice);
    link.addEventListener('click',launch);
    link.addEventListener('keydown',event=>{if(event.key===' ')return launch(event);});
  }
  function mount() {
    if(!isSchedule()) {
      host?.remove();header?.classList.remove(headerClass);header=null;return;
    }
    const nav=document.querySelector('#hedderNav');
    const menu=nav?.querySelector('#navbar > ul.navbar-nav');
    const nextHeader=nav?.closest('header');
    // If Hapana changes its structure, never fall back to an overlay. Chrome's
    // extension toolbar action still opens Daily Rolls from the current tab.
    if(!menu||!nextHeader) {
      host?.remove();header?.classList.remove(headerClass);header=null;return;
    }
    ensureStyle();
    if(!host)makeHost();
    const previous=document.getElementById(launcherId);
    if(previous&&previous!==host)previous.remove();
    if(header!==nextHeader){header?.classList.remove(headerClass);header=nextHeader;}
    if(!header.classList.contains(headerClass))header.classList.add(headerClass);
    const reports=[...menu.children].find(item=>[...item.querySelectorAll('a[href]')].some(a=>{
      try{return new URL(a.getAttribute('href'),document.baseURI).searchParams.get('route')==='dashboard/advreports';}catch{return false;}
    }));
    if(reports) {
      if(host.parentElement!==menu||reports.nextElementSibling!==host)menu.insertBefore(host,reports.nextElementSibling);
    } else if(host.parentElement!==menu)menu.append(host);
  }
  function scheduleMount() {
    if(queued)return;queued=true;
    requestAnimationFrame(()=>{queued=false;mount();});
  }
  function start() {
    if(observer)return;
    mount();
    // Hapana replaces schedule content without a full reload. Reuse one launcher
    // and retain native scroll/menu behaviour when that happens.
    observer=new MutationObserver(scheduleMount);
    observer.observe(document.body,{childList:true,subtree:true});
  }
  return {start,mount};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createRollLauncher};
