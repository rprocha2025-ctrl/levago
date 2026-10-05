/* LEVA — SPA (fala com o backend por REST; Google Maps na tela de pedido) */
const $ = s => document.querySelector(s);
const app = () => document.getElementById('app');
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const brl = n => 'R$ ' + (Number(n)||0).toFixed(2).replace('.',',');
function toast(m,bad){const t=$('#toast');t.textContent=m;t.className='toast show'+(bad?' bad':'');clearTimeout(t._t);t._t=setTimeout(()=>t.className='toast',3400);}
function loading(on){const b=$('#loadbar');if(on){b.style.width='70%';}else{b.style.width='100%';setTimeout(()=>b.style.width='0',260);}}

let TOKEN = localStorage.getItem('leva_token') || null;
let USER = null, CFG = null, pollTimer = null;
const MGCENTER = { lat:-22.3716, lng:-46.9426 }; // centro de Mogi Guaçu

function setPoll(fn,ms){clearPoll();fn();pollTimer=setInterval(fn,ms);}
function clearPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}

async function api(path, opts={}){
  const r = await fetch('/api'+path, {
    method: opts.method||'GET',
    headers: { 'Content-Type':'application/json', ...(TOKEN?{Authorization:'Bearer '+TOKEN}:{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data=null; try{ data=await r.json(); }catch(e){}
  if(!r.ok){ const err=new Error('api'); err.status=r.status; err.data=data||{}; throw err; }
  return data;
}

function fatorPicoLocal(){
  const p=CFG.pricing; if(!p.picoHoras) return 1;
  const h=(new Date().getUTCHours()-3+24)%24;
  return p.picoHoras.some(([a,b])=>h>=a&&h<b)?(p.picoFator||1):1;
}
// calcula apenas o valor que o CLIENTE paga (com detalhamento estilo Uber)
function cotarLocal(km,min,peso){
  const p=CFG.pricing;
  const vBase=p.base, vDist=p.porKm*km, vTempo=p.porMin*(min||0);
  const vPeso=(peso>p.kgFree)?(peso-p.kgFree)*p.kgExtra:0;
  let sub=vBase+vDist+vTempo+vPeso;
  const aplicouMin = sub < p.tarifaMinima;
  sub=Math.max(sub,p.tarifaMinima);
  const fator=fatorPicoLocal();
  const valor=Math.round(sub*fator*100)/100;
  return {valor, vBase, vDist, vTempo, vPeso, fator, aplicouMin, min:min||Math.max(4,Math.round(km/22*60))};
}
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ================= UI: modal, fotos, estilos ================= */
function ensureUiStyles(){
  if($('#uistyles'))return;
  const st=document.createElement('style');st.id='uistyles';
  st.textContent=`
  .modalov{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;padding:28px 14px;overflow:auto}
  .modalbx{position:relative;background:#121212;border:1px solid #2b2b2b;border-radius:18px;width:100%;max-width:520px;box-shadow:0 24px 70px rgba(0,0,0,.6)}
  .modalbx.wide{max-width:680px}
  .modalx{position:absolute;top:12px;right:12px;z-index:3;width:34px;height:34px;border-radius:50%;border:1px solid #333;background:#1b1b1b;color:#ddd;cursor:pointer;font-size:14px}
  .rc{padding:22px 22px 20px}
  .rc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid #222;padding-bottom:14px;margin-bottom:14px}
  .rc-brand{font-weight:800;font-size:18px;color:#fff;letter-spacing:.02em}
  .rc-brand small{display:block;font-weight:500;font-size:11px;color:#9a9a9a;letter-spacing:0}
  .rc-badge{background:#C6FF00;color:#0a0a0a;font-weight:800;font-size:11px;padding:5px 10px;border-radius:999px;white-space:nowrap}
  .rc-map{height:180px;border-radius:12px;overflow:hidden;margin-bottom:14px;border:1px solid #242424;background:#1a1a1a}
  .rc-row{display:flex;gap:10px;font-size:13px;color:#cfcfcf;padding:3px 0}
  .rc-row .k{color:#8c8c8c;min-width:92px}
  .rc-addr{display:flex;gap:10px;align-items:flex-start;font-size:13px;padding:4px 0}
  .rc-dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex:none}
  .rc-sec{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8c8c8c;margin:16px 0 8px}
  .rc-fotos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .rc-fotos figure{margin:0}.rc-fotos img{width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid #242424;background:#1a1a1a;display:block}
  .rc-fotos figcaption{font-size:11px;color:#8c8c8c;margin-top:4px;text-align:center}
  .rc-vals{border:1px solid #242424;border-radius:12px;padding:12px 14px;margin-top:8px}
  .rc-vals .lin{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#d6d6d6}
  .rc-vals .lin.extra{color:#ffd56b}
  .rc-vals .tot{display:flex;justify-content:space-between;border-top:1px solid #2b2b2b;margin-top:8px;padding-top:10px;font-weight:800;font-size:17px;color:#fff}
  .foto-up{border:1px dashed #3a3a3a;border-radius:12px;padding:14px;text-align:center;margin-top:12px;background:#161616}
  .foto-up.ok{border-color:#C6FF00;background:#14180a}
  .foto-up img{max-width:100%;max-height:150px;border-radius:10px;margin-bottom:8px}
  .foto-up input{display:none}
  .tip-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
  .tip-grid button{padding:12px 6px;border-radius:12px;border:1px solid #333;background:#1a1a1a;color:#eee;font-weight:700;cursor:pointer}
  .tip-grid button.sel{border-color:#C6FF00;background:#14180a;color:#C6FF00}
  .stars-big button{background:none;border:none;font-size:30px;color:#444;cursor:pointer;padding:0 2px}
  .stars-big button.on{color:#ffd33a}`;
  document.head.appendChild(st);
}
function closeModal(){const m=$('#modalov');if(m)m.remove();}
function modal(html,opts={}){
  ensureUiStyles();closeModal();
  const ov=document.createElement('div');ov.className='modalov';ov.id='modalov';
  ov.innerHTML=`<div class="modalbx ${opts.wide?'wide':''}"><button class="modalx" id="modalx">✕</button>${html}</div>`;
  document.body.appendChild(ov);
  $('#modalx').onclick=closeModal;
  ov.addEventListener('mousedown',e=>{if(e.target===ov&&!opts.sticky)closeModal();});
  return ov;
}
// redimensiona uma foto (File) para no máx 1000px, JPEG ~0.72 -> dataURL leve
function fileParaDataURL(file,maxPx=1000,q=0.72){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{let w=img.width,h=img.height;
      if(w>h&&w>maxPx){h=Math.round(h*maxPx/w);w=maxPx;}else if(h>=w&&h>maxPx){w=Math.round(w*maxPx/h);h=maxPx;}
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);res(cv.toDataURL('image/jpeg',q));};
    img.onerror=()=>{URL.revokeObjectURL(url);rej('img');};img.src=url;});
}

/* ================= BOOT ================= */
(async function boot(){
  try{ CFG = await api('/config'); }catch(e){ CFG={pricing:{comissao:.18,base:7,porKm:2.2,kgFree:5,kgExtra:.5,esperaFreeMin:5,esperaPorMin:.5},max:{c:60,l:50,a:50,peso:25},tipos:['Outro'],mapsEnabled:false}; }
  if(TOKEN){ try{ USER = await api('/me'); }catch(e){ TOKEN=null; localStorage.removeItem('leva_token'); } }
  render();
})();

function logout(){TOKEN=null;USER=null;localStorage.removeItem('leva_token');clearPoll();render();}
function render(){ clearPoll(); if(!USER){renderAuth();return;} const r=USER.role; if(!viewTab||!NAV[r].some(n=>n[0]===viewTab))viewTab=NAV[r][0][0]; renderShell(); renderTab(); }

/* ================= AUTH ================= */
let authMode='login', authRole='cliente';
let resetStep=1, resetEmail='', resetDevCode='', resetCode='', resetExpiresAt=0, resetTimer=null;
const DEMO=[['cliente','cliente@leva.com','123456'],['motoboy','motoboy@leva.com','123456'],['admin','admin@leva.com','admin123']];

function renderAuth(){
  app().innerHTML=`<div class="authwrap"><div class="authbox">
    <div class="brand"><span class="dot"></span>LEVA</div>
    <div class="tagline">Plataforma de entregas por motocicleta</div>
    <div class="authcard"><div class="segment">
      <button data-m="login" class="${authMode==='login'?'active':''}">Entrar</button>
      <button data-m="cadastro" class="${authMode==='cadastro'?'active':''}">Cadastrar</button>
    </div><div id="authbody"></div></div>
    <div class="demo"><div class="t">Contas demo — clique para preencher</div><div class="chips">
      ${DEMO.map(d=>`<button class="chip" data-e="${d[1]}" data-s="${d[2]}"><b>${d[0]}</b> · ${d[1]}</button>`).join('')}
    </div></div>
  </div></div>`;
  app().querySelectorAll('.segment button').forEach(b=>b.onclick=()=>{authMode=b.dataset.m;renderAuth();});
  app().querySelectorAll('.demo .chip').forEach(b=>b.onclick=()=>{authMode='login';renderAuth();$('#li_email').value=b.dataset.e;$('#li_senha').value=b.dataset.s;});
  authMode==='login'?renderLogin():renderCadastro();
}
function renderLogin(){
  $('#authbody').innerHTML=`
    <div class="field"><label>E-mail <span class="req">*</span></label><input id="li_email" type="email" placeholder="voce@email.com"><div class="fe" id="e_li_email"></div></div>
    <div class="field"><label>Senha <span class="req">*</span></label><input id="li_senha" type="password" placeholder="••••••"><div class="fe" id="e_li_senha"></div></div>
    <button class="btn btn-neon btn-block" id="li_go">Entrar</button>
    <div style="text-align:center;margin-top:14px"><a href="#" id="li_reset" class="small muted">Esqueci minha senha</a></div>`;
  $('#li_go').onclick=doLogin;
  $('#li_reset').onclick=e=>{e.preventDefault();resetStep=1;resetEmail='';renderResetScreen();};
  $('#li_senha').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
}
async function doLogin(){
  const email=$('#li_email').value.trim().toLowerCase(), senha=$('#li_senha').value;
  let ok=true; const fe=(id,m)=>{const el=$('#e_'+id);el.textContent=m||'';el.className='fe'+(m?' show':'');if(m)ok=false;};
  fe('li_email',!email?'Informe o e-mail':(!emailOk(email)?'E-mail inválido':''));
  fe('li_senha',!senha?'Informe a senha':'');
  if(!ok)return; loading(true);
  try{
    const res=await api('/auth/login',{method:'POST',body:{email,senha}});
    TOKEN=res.token; localStorage.setItem('leva_token',TOKEN); USER=res.user;
    loading(false); toast('Bem-vindo, '+USER.nome.split(' ')[0]+'!'); render();
  }catch(e){ loading(false);
    if(e.status===404)fe('li_email','E-mail não cadastrado');
    else if(e.status===401)fe('li_senha','Senha incorreta');
    else toast('Erro ao entrar',1);
  }
}
function renderCadastro(){
  $('#authbody').innerHTML=`
    <div class="rolepick">
      <div class="rp ${authRole==='cliente'?'sel':''}" data-r="cliente"><div class="t">Cliente</div><div class="d">Quero pedir entregas</div></div>
      <div class="rp ${authRole==='motoboy'?'sel':''}" data-r="motoboy"><div class="t">Motoboy</div><div class="d">Quero fazer entregas</div></div>
    </div>
    <div class="field"><label>Nome completo <span class="req">*</span></label><input id="cd_nome"><div class="fe" id="e_cd_nome"></div></div>
    <div class="row2">
      <div class="field"><label>E-mail <span class="req">*</span></label><input id="cd_email" type="email"><div class="fe" id="e_cd_email"></div></div>
      <div class="field"><label>WhatsApp <span class="req">*</span></label><input id="cd_tel" placeholder="(19) 9____-____"><div class="fe" id="e_cd_tel"></div></div>
    </div>
    <div class="row2">
      <div class="field"><label>CPF <span class="req">*</span></label><input id="cd_cpf" placeholder="000.000.000-00"><div class="fe" id="e_cd_cpf"></div></div>
      <div class="field"><label>Gênero <span class="req">*</span></label><select id="cd_gen"><option value="">Selecione…</option><option value="f">Feminino</option><option value="m">Masculino</option><option value="n">Prefiro não informar</option></select><div class="fe" id="e_cd_gen"></div></div>
    </div>
    <div id="cd_moto"></div>
    <div class="row2">
      <div class="field"><label>Senha <span class="req">*</span></label><input id="cd_senha" type="password" placeholder="mín. 6"><div class="fe" id="e_cd_senha"></div></div>
      <div class="field"><label>Confirmar senha <span class="req">*</span></label><input id="cd_senha2" type="password"><div class="fe" id="e_cd_senha2"></div></div>
    </div>
    <button class="btn btn-neon btn-block" id="cd_go">Criar conta</button>`;
  app().querySelectorAll('.rp').forEach(r=>r.onclick=()=>{authRole=r.dataset.r;renderCadastro();});
  $('#cd_moto').innerHTML = authRole==='motoboy'?`
    <div class="row2">
      <div class="field"><label>Placa <span class="req">*</span></label><input id="cd_placa" placeholder="ABC1D23"><div class="fe" id="e_cd_placa"></div></div>
      <div class="field"><label>Modelo <span class="req">*</span></label><input id="cd_modelo" placeholder="Honda CG 160"><div class="fe" id="e_cd_modelo"></div></div>
    </div>
    <div class="field"><label>Nº da CNH <span class="req">*</span></label><input id="cd_cnh"><div class="fe" id="e_cd_cnh"></div></div>`:'';
  $('#cd_go').onclick=doCadastro;
}
async function doCadastro(){
  let ok=true; const v=id=>($('#'+id)?$('#'+id).value.trim():'');
  const fe=(id,m)=>{const el=$('#e_'+id);if(!el)return;el.textContent=m||'';el.className='fe'+(m?' show':'');const i=$('#'+id);if(i)i.className=m?'err':'';if(m)ok=false;};
  const b={nome:v('cd_nome'),email:v('cd_email').toLowerCase(),telefone:v('cd_tel'),cpf:v('cd_cpf'),genero:v('cd_gen'),senha:v('cd_senha'),role:authRole};
  fe('cd_nome',!b.nome?'Obrigatório':(b.nome.split(' ').length<2?'Nome e sobrenome':''));
  fe('cd_email',!b.email?'Obrigatório':(!emailOk(b.email)?'E-mail inválido':''));
  fe('cd_tel',!b.telefone?'Obrigatório':(b.telefone.replace(/\D/g,'').length<10?'Telefone inválido':''));
  fe('cd_cpf',!b.cpf?'Obrigatório':(b.cpf.replace(/\D/g,'').length!==11?'11 dígitos':''));
  fe('cd_gen',!b.genero?'Selecione':'');
  fe('cd_senha',!b.senha?'Obrigatório':(b.senha.length<6?'Mínimo 6':''));
  fe('cd_senha2',v('cd_senha2')!==b.senha?'Senhas não coincidem':'');
  if(authRole==='motoboy'){b.placa=v('cd_placa');b.modelo=v('cd_modelo');b.cnh=v('cd_cnh');
    fe('cd_placa',!b.placa?'Obrigatório':'');fe('cd_modelo',!b.modelo?'Obrigatório':'');fe('cd_cnh',!b.cnh?'Obrigatório':'');}
  if(!ok)return; loading(true);
  try{
    const res=await api('/auth/register',{method:'POST',body:b});
    TOKEN=res.token; localStorage.setItem('leva_token',TOKEN); USER=res.user;
    loading(false); toast('Conta criada!'); render();
  }catch(e){ loading(false);
    if(e.data&&e.data.erros){Object.entries(e.data.erros).forEach(([k,m])=>fe('cd_'+(k==='telefone'?'tel':k),m));}
    else toast('Erro ao cadastrar',1);
  }
}
/* ---- esqueci a senha ---- */
function stopResetTimer(){if(resetTimer){clearInterval(resetTimer);resetTimer=null;}}
function renderResetScreen(){
  stopResetTimer();
  app().innerHTML=`<div class="authwrap"><div class="authbox">
    <div class="brand"><span class="dot"></span>LEVA</div><div class="tagline">Redefinir senha</div>
    <div class="authcard"><div id="resetbody"></div></div>
    <div style="text-align:center;margin-top:16px"><a href="#" id="rs_back" class="small muted">← Voltar para entrar</a></div>
  </div></div>`;
  $('#rs_back').onclick=e=>{e.preventDefault();stopResetTimer();authMode='login';renderAuth();if(resetEmail&&$('#li_email'))$('#li_email').value=resetEmail;};
  renderResetStep();
}
function renderResetStep(){
  const body=$('#resetbody');if(!body)return;stopResetTimer();
  if(resetStep===1){
    body.innerHTML=`<h3 style="font-size:17px;text-transform:uppercase;margin-bottom:6px">Esqueci minha senha</h3>
      <p class="small muted" style="margin-bottom:18px">Informe seu e-mail. Enviaremos um código de 6 dígitos, válido por 5 minutos.</p>
      <div class="field"><label>E-mail <span class="req">*</span></label><input id="rs_email" type="email" value="${esc(resetEmail)}"><div class="fe" id="e_rs_email"></div></div>
      <button class="btn btn-neon btn-block" id="rs_send">Enviar código</button>`;
    $('#rs_send').onclick=()=>doForgot(false);
  } else if(resetStep===2){
    body.innerHTML=`<h3 style="font-size:17px;text-transform:uppercase;margin-bottom:6px">Digite o código</h3>
      <div class="banner info">Código enviado para <b>${esc(resetEmail)}</b>. Expira em <b id="rs_count">05:00</b>.</div>
      ${resetDevCode?`<div class="banner warn"><div>Demo (sem servidor de e-mail): seu código é <b style="font-size:16px;letter-spacing:.15em">${esc(resetDevCode)}</b></div></div>`:''}
      <div class="field"><label>Código <span class="req">*</span></label><input id="rs_code" inputmode="numeric" maxlength="6" placeholder="000000" style="letter-spacing:.3em;text-align:center;font-size:18px"><div class="fe" id="e_rs_code"></div></div>
      <button class="btn btn-neon btn-block" id="rs_validate">Validar código</button>
      <div style="text-align:center;margin-top:14px"><a href="#" id="rs_resend" class="small muted">Reenviar novo código</a></div>`;
    $('#rs_validate').onclick=doVerify; $('#rs_resend').onclick=e=>{e.preventDefault();doForgot(true);};
    startResetCountdown();
  } else {
    body.innerHTML=`<h3 style="font-size:17px;text-transform:uppercase;margin-bottom:6px">Nova senha</h3>
      <p class="small muted" style="margin-bottom:18px">Código validado. Defina sua nova senha.</p>
      <div class="field"><label>Nova senha <span class="req">*</span></label><input id="rs_pw" type="password" placeholder="mín. 6"><div class="fe" id="e_rs_pw"></div></div>
      <div class="field"><label>Confirmar <span class="req">*</span></label><input id="rs_pw2" type="password"><div class="fe" id="e_rs_pw2"></div></div>
      <button class="btn btn-neon btn-block" id="rs_save">Salvar nova senha</button>`;
    $('#rs_save').onclick=doResetSave;
  }
}
function startResetCountdown(){stopResetTimer();const tick=()=>{const el=$('#rs_count');if(!el)return stopResetTimer();const ms=resetExpiresAt-Date.now();if(ms<=0){el.textContent='expirado';const b=$('#rs_validate');if(b)b.disabled=true;const fe=$('#e_rs_code');if(fe){fe.textContent='Código expirado. Reenvie.';fe.className='fe show';}return stopResetTimer();}el.textContent=String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor((ms%60000)/1000)).padStart(2,'0');};tick();resetTimer=setInterval(tick,1000);}
async function doForgot(isResend){
  const inp=$('#rs_email'); const email=(inp?inp.value:resetEmail).trim().toLowerCase();
  const fe=m=>{const el=$('#e_rs_email');if(el){el.textContent=m||'';el.className='fe'+(m?' show':'');}};
  if(resetStep===1){if(!email){fe('Informe o e-mail');return;}if(!emailOk(email)){fe('E-mail inválido');return;}}
  loading(true);
  try{ const r=await api('/auth/forgot',{method:'POST',body:{email}});
    resetEmail=email; resetDevCode=r.devCode||''; resetExpiresAt=Date.now()+5*60*1000; resetStep=2;
    loading(false); renderResetStep(); toast(isResend?'Novo código gerado.':'Código enviado!');
  }catch(e){loading(false); if(e.status===404){resetStep===1?fe('E-mail não cadastrado'):toast('E-mail não cadastrado',1);} else toast('Erro',1);}
}
async function doVerify(){
  const code=($('#rs_code').value||'').trim(); const fe=m=>{const el=$('#e_rs_code');if(el){el.textContent=m||'';el.className='fe'+(m?' show':'');}};
  if(!/^\d{6}$/.test(code)){fe('O código tem 6 dígitos');return;} loading(true);
  try{ await api('/auth/verify-code',{method:'POST',body:{email:resetEmail,code}}); resetCode=code; loading(false); resetStep=3; renderResetStep(); }
  catch(e){loading(false); fe(e.data&&e.data.error==='expirado'?'Código expirado. Reenvie.':'Código incorreto.');}
}
async function doResetSave(){
  let ok=true; const fe=(id,m)=>{const el=$('#e_'+id);if(el){el.textContent=m||'';el.className='fe'+(m?' show':'');}if(m)ok=false;};
  const pw=$('#rs_pw').value, pw2=$('#rs_pw2').value;
  fe('rs_pw',!pw?'Obrigatório':(pw.length<6?'Mínimo 6':'')); fe('rs_pw2',pw2!==pw?'Não coincidem':'');
  if(!ok)return; loading(true);
  try{ await api('/auth/reset',{method:'POST',body:{email:resetEmail,code:resetCode,senha:pw}});
    loading(false); stopResetTimer(); toast('Senha redefinida! Faça login.'); authMode='login'; renderAuth(); if($('#li_email'))$('#li_email').value=resetEmail;
  }catch(e){loading(false); toast(e.data&&e.data.error==='expirado'?'Código expirado, recomece.':'Erro ao redefinir',1); if(e.data&&e.data.error==='expirado'){resetStep=1;renderResetScreen();}}
}

/* ================= SHELL ================= */
const NAV={
  cliente:[['pedir','Pedir corrida'],['minhas','Minhas corridas'],['perfil','Perfil']],
  motoboy:[['online','Corridas online'],['atual','Corrida atual'],['carteira','Carteira'],['metas','Metas'],['perfil','Perfil']],
  admin:[['kpis','Indicadores'],['cadastros','Cadastros'],['corridas','Corridas']],
};
let viewTab=null;
function saudacao(nome,genero){const n=(nome||'').trim().split(' ')[0]||'';let w;if(genero==='f')w='Bem-vinda';else if(genero==='m')w='Bem-vindo';else if(genero==='n')w='Bem-vindo(a)';else{const l=n.slice(-1).toLowerCase();w=l==='a'?'Bem-vinda':l==='o'?'Bem-vindo':'Bem-vindo(a)';}return{w,n};}
function renderShell(){
  const r=USER.role, ini=(USER.nome||'?').trim()[0].toUpperCase();
  let hello=''; if(r==='cliente'){const {w,n}=saudacao(USER.nome,USER.genero);hello=`<div class="hello"><div class="wrap"><h2>${w}, <span class="neon">${esc(n)}</span>!</h2><p>O que podemos levar para você hoje?</p></div></div>`;}
  app().innerHTML=`<div class="top"><div class="wrap"><div class="top-in">
    <div class="brand"><span class="dot"></span>LEVA <span class="rolebadge">${r}</span></div>
    <div class="who"><div style="text-align:right"><b>${esc(USER.nome.split(' ')[0])}</b><div class="small muted">${esc(USER.email)}</div></div>
    <div class="avatar">${esc(ini)}</div><button class="btn btn-ghost btn-sm" id="sair">Sair</button></div>
  </div></div></div>${hello}
  <div class="wrap"><div class="tabs">${NAV[r].map(([k,l])=>`<button class="tab ${viewTab===k?'active':''}" data-k="${k}">${l}</button>`).join('')}</div>
  <div id="tabbody" style="padding-bottom:60px"></div></div>`;
  $('#sair').onclick=logout;
  app().querySelectorAll('.tab').forEach(t=>t.onclick=()=>{viewTab=t.dataset.k;clearPoll();renderShell();renderTab();});
}
function setBody(h){const b=$('#tabbody');if(b)b.innerHTML=h;}
function renderTab(){
  const r=USER.role;
  if(r==='cliente')({pedir:cliPedir,minhas:cliMinhas,perfil:perfil})[viewTab]();
  else if(r==='motoboy')({online:motoOnline,atual:motoAtual,carteira:motoCarteira,metas:motoMetas,perfil:perfil})[viewTab]();
  else ({kpis:admKpis,cadastros:admCadastros,corridas:admCorridas})[viewTab]();
}
const ORD={solicitada:0,aceita:1,a_caminho:2,aguardando:3,em_andamento:4,concluida:5,paga:6,cancelada:-1};
const labelStatus=s=>({solicitada:'Solicitada',aceita:'Aceita',a_caminho:'A caminho',aguardando:'Aguardando',em_andamento:'Em andamento',concluida:'Concluída',paga:'Paga',cancelada:'Cancelada'})[s]||s;

/* ================= GOOGLE MAPS ================= */
let mapsPromise=null;
function loadMaps(){
  if(!CFG.mapsEnabled) return Promise.reject('no-key');
  if(mapsPromise) return mapsPromise;
  mapsPromise=new Promise((res,rej)=>{
    window.__mapsReady=()=>res(window.google);
    const s=document.createElement('script');
    s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.mapsKey)}&language=pt-BR&region=BR&callback=__mapsReady`;
    s.async=true; s.onerror=()=>rej('load-fail'); document.head.appendChild(s);
  });
  return mapsPromise;
}
function parseComp(place){
  const c={}; (place.address_components||[]).forEach(comp=>{
    const t=comp.types;
    if(t.includes('route'))c.rua=comp.long_name;
    if(t.includes('street_number'))c.numero=comp.long_name;
    if(!c.bairro&&(t.includes('sublocality_level_1')||t.includes('neighborhood')||t.includes('sublocality')))c.bairro=comp.long_name;
  });
  if(place.geometry&&place.geometry.location){c.lat=place.geometry.location.lat();c.lng=place.geometry.location.lng();}
  return c;
}

/* ================= CLIENTE ================= */
const ped={o:{},d:{}};
let gmap=null,mkO=null,mkD=null,dirRenderer=null,dirService=null;
function cliPedir(){
  ped.o={};ped.d={};
  setBody(`
  ${CFG.mapsEnabled?'<div id="map"></div>':'<div id="map"><div class="maptip">🗺️ Mapa indisponível — configure a chave do Google Maps no servidor (GOOGLE_MAPS_API_KEY).<br>O pedido ainda funciona; a distância é estimada.</div></div>'}
  <div class="grid g2" style="margin-top:16px">
    <div class="card">
      <h3>Pedir uma corrida</h3>
      <div class="sub">Digite o endereço e selecione a sugestão do mapa. O bairro é preenchido sozinho.</div>
      <div class="banner info">Limite do baú: ${CFG.max.c}×${CFG.max.l}×${CFG.max.a} cm e ${CFG.max.peso} kg.</div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--neon);margin:4px 0 10px">Coleta</div>
      <div class="field"><label>Endereço (rua) <span class="req">*</span></label><input id="o_rua" placeholder="Comece a digitar e escolha a sugestão…" autocomplete="off"></div>
      <div class="row2"><div class="field"><label>Número <span class="req">*</span></label><input id="o_num" placeholder="nº"></div>
        <div class="field"><label>Bairro <span class="req">*</span></label><input id="o_bai"></div></div>
      <div class="row2"><div class="field"><label>Cidade <span class="req">*</span></label><input id="o_cid"></div>
        <div class="field"><label>UF <span class="req">*</span></label><input id="o_uf" maxlength="2" style="text-transform:uppercase"></div></div>
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--blue);margin:4px 0 10px">Entrega</div>
      <div class="field"><label>Endereço (rua) <span class="req">*</span></label><input id="d_rua" placeholder="Comece a digitar e escolha a sugestão…" autocomplete="off"></div>
      <div class="row2"><div class="field"><label>Número <span class="req">*</span></label><input id="d_num" placeholder="nº"></div>
        <div class="field"><label>Bairro <span class="req">*</span></label><input id="d_bai"></div></div>
      <div class="row2"><div class="field"><label>Cidade <span class="req">*</span></label><input id="d_cid"></div>
        <div class="field"><label>UF <span class="req">*</span></label><input id="d_uf" maxlength="2" style="text-transform:uppercase"></div></div>
      <hr class="sep">
      <div class="field"><label>Tipo de item <span class="req">*</span></label><select id="i_tipo">${CFG.tipos.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
      <div class="row3">
        <div class="field"><label>Compr.(cm) <span class="req">*</span></label><input id="i_c" type="number"><div class="fe" id="e_i_c"></div></div>
        <div class="field"><label>Larg.(cm) <span class="req">*</span></label><input id="i_l" type="number"><div class="fe" id="e_i_l"></div></div>
        <div class="field"><label>Alt.(cm) <span class="req">*</span></label><input id="i_a" type="number"><div class="fe" id="e_i_a"></div></div>
      </div>
      <div class="field"><label>Peso (kg) <span class="req">*</span></label><input id="i_p" type="number" step="0.1"><div class="fe" id="e_i_p"></div></div>
    </div>
    <div><div class="quote" id="quote">${quotePlaceholder()}</div></div>
  </div>`);
  ['i_c','i_l','i_a','i_p'].forEach(id=>$('#'+id).addEventListener('input',updateQuote));
  const campoMap={num:'numero',bai:'bairro',cid:'cidade',uf:'uf'};
  ['o_num','o_bai','o_cid','o_uf','d_num','d_bai','d_cid','d_uf'].forEach(id=>$('#'+id).addEventListener('input',()=>{const s=id[0]==='o'?'o':'d';ped[s][campoMap[id.slice(2)]]=$('#'+id).value;updateQuote();}));
  ['o_rua','d_rua'].forEach(id=>$('#'+id).addEventListener('input',()=>{const s=id[0]==='o'?'o':'d';ped[s].rua=$('#'+id).value;}));
  attachGeocode('o'); attachGeocode('d');           // autocomplete grátis (OpenStreetMap) — não depende do Google
  if(CFG.mapsEnabled) initPedirMap();               // mapa visual do Google (opcional)
}
/* ---- autocomplete de endereço via /api/geocode (OpenStreetMap) ---- */
function ensureAcStyles(){
  if($('#acstyles'))return;
  const st=document.createElement('style');st.id='acstyles';
  st.textContent=`.field{position:relative}
  .acbox{position:absolute;left:0;right:0;top:100%;z-index:50;background:#141414;border:1px solid #2b2b2b;border-radius:12px;margin-top:4px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.5);max-height:260px;overflow-y:auto}
  .acit{padding:10px 12px;cursor:pointer;border-bottom:1px solid #1f1f1f;font-size:13px;line-height:1.35}
  .acit:last-child{border-bottom:none}
  .acit:hover,.acit.sel{background:#1f1f1f}
  .acit .r{color:#eaeaea}.acit .m{color:#9a9a9a;font-size:11px}
  .acload{padding:10px 12px;color:#9a9a9a;font-size:12px}`;
  document.head.appendChild(st);
}
function attachGeocode(side){
  ensureAcStyles();
  const inp=$('#'+side+'_rua'); if(!inp)return;
  const field=inp.closest('.field'); let box=null, t=null, items=[], sel=-1;
  const close=()=>{if(box){box.remove();box=null;}items=[];sel=-1;};
  const choose=(s)=>{
    inp.value=s.rua||s.label;
    $('#'+side+'_bai').value=s.bairro||'';
    $('#'+side+'_cid').value=s.cidade||'';
    $('#'+side+'_uf').value=(s.uf||'').toUpperCase();
    if(s.numero)$('#'+side+'_num').value=s.numero;
    ped[side]={rua:s.rua||inp.value,numero:s.numero||$('#'+side+'_num').value,bairro:s.bairro||'',cidade:s.cidade||'',uf:(s.uf||'').toUpperCase(),lat:s.lat,lng:s.lng};
    close(); computeDist();
    if(!s.numero)setTimeout(()=>{const n=$('#'+side+'_num');if(n)n.focus();},60); // deixa só o número para o cliente
  };
  const paint=()=>{
    if(!box){box=document.createElement('div');box.className='acbox';field.appendChild(box);}
    box.innerHTML=items.map((s,i)=>`<div class="acit${i===sel?' sel':''}" data-i="${i}"><div class="r">${esc(s.rua||s.label)}${s.numero?', '+esc(s.numero):''}</div><div class="m">${esc([s.bairro,s.cidade,s.estado].filter(Boolean).join(' · '))}</div></div>`).join('');
    box.querySelectorAll('.acit').forEach(el=>el.addEventListener('mousedown',ev=>{ev.preventDefault();choose(items[+el.dataset.i]);}));
  };
  const search=async(q)=>{
    try{
      const r=await fetch('/api/geocode?q='+encodeURIComponent(q));
      const j=await r.json(); items=(j&&j.sugestoes)||[]; sel=-1;
      if(!items.length){close();return;} paint();
    }catch(e){ close(); }
  };
  inp.addEventListener('input',()=>{
    const q=inp.value.trim(); ped[side].lat=undefined; ped[side].lng=undefined;
    clearTimeout(t);
    if(q.length<3){close();return;}
    if(box)box.innerHTML='<div class="acload">Buscando endereços…</div>';
    t=setTimeout(()=>search(q),320);
  });
  inp.addEventListener('keydown',e=>{
    if(!box||!items.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();sel=(sel+1)%items.length;paint();}
    else if(e.key==='ArrowUp'){e.preventDefault();sel=(sel-1+items.length)%items.length;paint();}
    else if(e.key==='Enter'&&sel>=0){e.preventDefault();choose(items[sel]);}
    else if(e.key==='Escape'){close();}
  });
  inp.addEventListener('blur',()=>setTimeout(close,180));
}
/* distância a partir das coordenadas (sempre funciona); refina com a rota do Google se disponível */
function haversineLocal(a,b){const R=6371,r=x=>x*Math.PI/180;const dLa=r(b.lat-a.lat),dLo=r(b.lng-a.lng);const s=Math.sin(dLa/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLo/2)**2;return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));}
function computeDist(){
  if(window.google&&gmap)drawMarkers(window.google);
  if(ped.o.lat&&ped.d.lat){
    const km=Math.round(haversineLocal(ped.o,ped.d)*1.35*10)/10||1.2;
    ped._km=km; ped._min=Math.max(4,Math.round(km/22*60));
    if(window.google&&dirService)updateRoute(window.google); // refina com a rota real (se Directions estiver ativa)
  }
  updateQuote();
}
function quotePlaceholder(){return `<div class="qbadge">🏍️ LEVA Moto</div><div class="empty" style="padding:24px 0">Preencha coleta e entrega para ver o valor.</div>`;}
function initPedirMap(){
  loadMaps().then(g=>{
    gmap=new g.maps.Map($('#map'),{center:MGCENTER,zoom:14,disableDefaultUI:true,zoomControl:true,
      styles:[{elementType:'geometry',stylers:[{color:'#1a1a1a'}]},{elementType:'labels.text.stroke',stylers:[{color:'#0a0a0a'}]},{elementType:'labels.text.fill',stylers:[{color:'#9a9a9a'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#2b2b2b'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#0e1a1a'}]},{featureType:'poi',stylers:[{visibility:'off'}]}]});
    dirService=new g.maps.DirectionsService();
    dirRenderer=new g.maps.DirectionsRenderer({map:gmap,suppressMarkers:true,polylineOptions:{strokeColor:'#C6FF00',strokeWeight:5,strokeOpacity:.9}});
    if(ped.o.lat||ped.d.lat)drawMarkers(g);           // reposiciona marcadores se já havia endereços escolhidos
  }).catch(()=>{ const m=$('#map'); if(m)m.innerHTML='<div class="maptip">🗺️ Mapa indisponível no momento — o pedido e o cálculo do valor continuam funcionando normalmente.</div>'; });
}
function drawMarkers(g){
  const mk=(pos,color)=>new g.maps.Marker({position:pos,map:gmap,icon:{path:g.maps.SymbolPath.CIRCLE,scale:8,fillColor:color,fillOpacity:1,strokeColor:'#050505',strokeWeight:2}});
  if(ped.o.lat){if(mkO)mkO.setMap(null);mkO=mk({lat:ped.o.lat,lng:ped.o.lng},'#C6FF00');}
  if(ped.d.lat){if(mkD)mkD.setMap(null);mkD=mk({lat:ped.d.lat,lng:ped.d.lng},'#5BC8FF');}
  if(ped.o.lat&&ped.d.lat){const b=new g.maps.LatLngBounds();b.extend(ped.o);b.extend(ped.d);gmap.fitBounds(b,80);}
  else if(ped.o.lat)gmap.setCenter({lat:ped.o.lat,lng:ped.o.lng});
}
function updateRoute(g){
  if(!(ped.o.lat&&ped.d.lat)){updateQuote();return;}
  dirService.route({origin:{lat:ped.o.lat,lng:ped.o.lng},destination:{lat:ped.d.lat,lng:ped.d.lng},travelMode:g.maps.TravelMode.DRIVING},(r,st)=>{
    if(st==='OK'){dirRenderer.setDirections(r);const leg=r.routes[0].legs[0];ped._km=Math.round(leg.distance.value/100)/10;ped._min=Math.round(leg.duration.value/60);}
    updateQuote();
  });
}
function updateQuote(){
  const c=+($('#i_c')?.value),l=+($('#i_l')?.value),a=+($('#i_a')?.value),p=+($('#i_p')?.value);
  // distância: rota do mapa, ou estimativa simples se sem mapa
  let km=ped._km;
  if(!km&&ped.o.rua&&ped.d.rua&&!CFG.mapsEnabled){let h=0;const s=(ped.o.rua+ped.o.numero+ped.d.rua+ped.d.numero).toLowerCase();for(const ch of s)h=(h*31+ch.charCodeAt(0))>>>0;km=Math.round((1.5+(h%1000)/1000*10.5)*10)/10;ped._km=km;}
  const q=$('#quote');
  const temEnd=ped.o.rua&&ped.o.numero&&ped.o.bairro&&ped.o.cidade&&ped.d.rua&&ped.d.numero&&ped.d.bairro&&ped.d.cidade;
  if(!km||!temEnd){q.innerHTML=quotePlaceholder();return;}
  const min=ped._min||Math.max(4,Math.round(km/22*60));
  const pr=cotarLocal(km,min,p>0?p:0);
  // valor da corrida AGRUPADO (base+distância+tempo+pico); só o peso extra aparece separado
  const pesoExtra=pr.aplicouMin?0:Math.round(pr.vPeso*pr.fator*100)/100;
  const corrida=Math.round((pr.valor-pesoExtra)*100)/100;
  const lin=(nome,val)=>`<div class="lin"><span>${nome}</span><b>${brl(val)}</b></div>`;
  const cid=(e)=>e.cidade?`, ${esc(e.cidade)}${e.uf?'/'+esc(e.uf):''}`:'';
  q.innerHTML=`<div class="qbadge">🏍️ LEVA Moto</div>
    <div class="qprice">${brl(pr.valor)}</div>
    <div class="qmeta">★ 5,0 · ${min} min (${km.toFixed(1)} km) de distância</div>
    <div class="qaddr">
      <div class="qa"><span class="dotg"></span><div>${esc(ped.o.rua)}, ${esc(ped.o.numero)}<br><span class="muted small">${esc(ped.o.bairro)}${cid(ped.o)}</span></div></div>
      <div class="qa"><span class="dotb"></span><div>${esc(ped.d.rua)}, ${esc(ped.d.numero)}<br><span class="muted small">${esc(ped.d.bairro)}${cid(ped.d)}</span></div></div>
    </div>
    <div class="pricebox" style="margin-bottom:14px">
      ${lin('Corrida',corrida)}
      ${pesoExtra>0?lin('Peso extra ('+p+' kg)',pesoExtra):''}
    </div>
    <div id="itemwarn"></div>
    <button class="btn btn-neon btn-block" id="chamar">Chamar moto · ${brl(pr.valor)}</button>
    <p class="small muted" style="margin-top:10px">Valor reservado no cartão e cobrado após a entrega. Espera acima de ${CFG.pricing.esperaFreeMin} min: ${brl(CFG.pricing.esperaPorMin)}/min — somada na fatura como aditivo.</p>`;
  // aviso de limite ao vivo
  if(c>0&&l>0&&a>0&&p>0){const probs=[];if(c>CFG.max.c)probs.push('comprimento');if(l>CFG.max.l)probs.push('largura');if(a>CFG.max.a)probs.push('altura');if(p>CFG.max.peso)probs.push('peso');
    if(probs.length){$('#itemwarn').innerHTML=`<div class="banner bad" style="margin:0 0 10px"><div><b>Item acima do limite da moto</b> (${probs.join(', ')}). Não é permitido levar.</div></div>`;$('#chamar').disabled=true;}}
  $('#chamar').onclick=chamarCorrida;
}
async function chamarCorrida(){
  const c=+$('#i_c').value,l=+$('#i_l').value,a=+$('#i_a').value,p=+$('#i_p').value;
  let ok=true;const fe=(id,m)=>{const el=$('#e_'+id);if(el){el.textContent=m||'';el.className='fe'+(m?' show':'');}if(m)ok=false;};
  fe('i_c',c>0?'':'Informe');fe('i_l',l>0?'':'Informe');fe('i_a',a>0?'':'Informe');fe('i_p',p>0?'':'Informe');
  if(!ok){toast('Preencha as dimensões e o peso',1);return;}
  if(!(ped.o.rua&&ped.o.numero&&ped.o.bairro&&ped.o.cidade&&ped.d.rua&&ped.d.numero&&ped.d.bairro&&ped.d.cidade)){toast('Preencha coleta e entrega (rua, número, bairro e cidade)',1);return;}
  loading(true);
  try{
    const body={origem:ped.o,destino:ped.d,tipo:$('#i_tipo').value,dim:{c,l,a},peso:p,km:ped._km,min:ped._min};
    await api('/rides',{method:'POST',body});
    loading(false);toast('Corrida solicitada! Buscando motoboy…');viewTab='minhas';clearPoll();renderShell();renderTab();
  }catch(e){loading(false);
    if(e.data&&e.data.error==='item_grande')toast('Item acima do limite da moto',1);
    else toast('Erro ao solicitar',1);
  }
}
function cliMinhas(){ setBody('<div class="empty">Carregando…</div>'); setPoll(async()=>{try{const rides=await api('/rides/mine');renderMinhas(rides);}catch(e){}},5000); }
function renderMinhas(rides){
  if(!rides.length){setBody('<div class="card"><div class="empty">Você ainda não pediu corridas.</div></div>');return;}
  const concl=r=>r.status==='concluida'||r.status==='paga';
  setBody(`<div class="list">${rides.map(r=>{
    let acao='';
    if(r.status==='solicitada')acao='<span class="small muted">Procurando motoboy…</span>';
    else if(['aceita','a_caminho','aguardando','em_andamento'].includes(r.status))acao=`<span class="small">Motoboy: <b>${esc(r.motoboyNome||'-')}</b></span>`;
    else if(concl(r))acao=`<button class="btn btn-out btn-sm" data-rec="${r.id}">🧾 Recibo${r.avalCliente?' ★'+r.avalCliente:' / avaliar'}</button>`;
    return `<div class="item"><div class="main"><div class="t">${esc(r.tipo)} · ${brl(r.total||r.valor)}</div>
      <div class="d">${esc(r.origem.bairro)} → ${esc(r.destino.bairro)} · ${(r.km||0).toFixed(1)}km · ${new Date(r.criadaEm).toLocaleString('pt-BR')}</div></div>
      <span class="tag ${r.status}">${labelStatus(r.status)}</span><div style="min-width:150px;text-align:right">${acao}</div></div>`;
  }).join('')}</div>`);
  app().querySelectorAll('button[data-rec]').forEach(b=>b.onclick=()=>abrirRecibo(b.dataset.rec));
}

/* ================= MOTOBOY ================= */
function motoOnline(){ setBody('<div class="empty">Procurando corridas…</div>'); setPoll(async()=>{try{renderOnline(await api('/rides/available'));}catch(e){}},4000); }
function renderOnline(rides){
  const head='<div class="banner info">🔔 Corridas disponíveis em tempo real. Quem aceitar primeiro fica com ela.</div>';
  if(!rides.length){setBody(head+'<div class="card"><div class="empty">Nenhuma corrida agora.</div></div>');return;}
  setBody(head+`<div class="list">${rides.map(r=>`<div class="item"><div class="main">
    <div class="t">${esc(r.tipo)} · <span class="neon">${brl(r.valorMotoboy)}</span> <span class="small muted">(você recebe)</span></div>
    <div class="d">${esc(r.origem.rua)}, ${esc(r.origem.numero)} — ${esc(r.origem.bairro)} → ${esc(r.destino.bairro)} · ${(r.km||0).toFixed(1)}km · ${r.peso}kg</div></div>
    <button class="btn btn-neon btn-sm" data-id="${r.id}">Aceitar</button></div>`).join('')}</div>`);
  app().querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>aceitar(b.dataset.id));
}
async function aceitar(id){ loading(true);
  try{ await api('/rides/'+id+'/accept',{method:'POST'}); loading(false); toast('Corrida aceita!'); viewTab='atual'; clearPoll(); renderShell(); renderTab(); }
  catch(e){ loading(false); toast(e.status===409?'Outro motoboy aceitou primeiro.':'Erro',1); }
}
function motoAtual(){ setBody('<div class="empty">Carregando…</div>'); clearPoll(); (async()=>{try{renderAtual(await api('/rides/current'));}catch(e){setBody('<div class="card"><div class="empty">Erro ao carregar.</div></div>');}})(); }
function fotoUploaderHTML(tipo,jaTem){
  return `<div class="foto-up ${jaTem?'ok':''}" id="fup_${tipo}">
    <div id="fprev_${tipo}">${jaTem?'<div class="small ok">✓ Foto registrada</div>':''}</div>
    <label class="btn btn-out btn-sm" for="finp_${tipo}" id="flbl_${tipo}">${jaTem?'Trocar foto':'📷 Tirar / enviar foto'}</label>
    <input type="file" id="finp_${tipo}" accept="image/*" capture="environment">
    <div class="small muted" style="margin-top:6px">Obrigatória para avançar</div></div>`;
}
function wireFotoUploader(rideId,tipo,onDone){
  const inp=$('#finp_'+tipo);if(!inp)return;
  inp.onchange=async()=>{
    const f=inp.files&&inp.files[0];if(!f)return;
    const box=$('#fup_'+tipo),prev=$('#fprev_'+tipo);
    try{
      prev.innerHTML='<div class="small muted">Processando foto…</div>';
      const data=await fileParaDataURL(f);
      prev.innerHTML=`<img src="${data}" alt="prévia">`;
      loading(true);
      await api('/rides/'+rideId+'/foto',{method:'POST',body:{tipo,data}});
      loading(false);box.classList.add('ok');toast('Foto registrada');
      if(onDone)onDone();
    }catch(e){loading(false);prev.innerHTML='<div class="small" style="color:#ff6b6b">Falha ao enviar a foto</div>';toast('Erro ao enviar foto',1);}
  };
}
function renderAtual(r){
  if(!r){setBody('<div class="card"><div class="empty">Sem corrida em andamento.</div></div>');return;}
  const steps=[['aceita','A caminho da coleta','a_caminho'],['a_caminho','Cheguei na coleta','aguardando'],['aguardando','Coletei — iniciar','em_andamento'],['em_andamento','Concluir entrega','concluida']];
  const cur=steps.find(s=>s[0]===r.status);
  const end=(e)=>`${esc(e.rua)}, ${esc(e.numero)} — ${esc(e.bairro)}${e.cidade?', '+esc(e.cidade)+(e.uf?'/'+esc(e.uf):''):''}`;
  // etapa que exige foto: coleta (antes de iniciar) e entrega (antes de concluir)
  const precisaColeta=r.status==='aguardando', precisaEntrega=r.status==='em_andamento';
  const faltaFoto=(precisaColeta&&!r.temFotoColeta)||(precisaEntrega&&!r.temFotoEntrega);
  setBody(`<div class="grid g2">
    <div class="card"><h3>Corrida em andamento</h3><div class="sub">${esc(r.tipo)} · <span class="neon">${brl(r.recebe||r.valorMotoboy)}</span> para você</div>
      <div class="list"><div class="item"><div class="main"><div class="t">📍 Coleta</div><div class="d">${end(r.origem)}</div></div></div>
      <div class="item"><div class="main"><div class="t">🏁 Entrega</div><div class="d">${end(r.destino)}</div></div></div>
      <div class="item"><div class="main"><div class="t">Cliente</div><div class="d">${esc(r.clienteNome)}</div></div></div></div>
      ${precisaColeta?`<div class="rc-sec">Foto da coleta <span class="req">*</span></div><div class="sub" style="margin-top:0">Registre o item no momento da coleta.</div>${fotoUploaderHTML('coleta',r.temFotoColeta)}`:''}
      ${precisaEntrega?`<div class="rc-sec">Foto da entrega <span class="req">*</span></div><div class="sub" style="margin-top:0">Registre o item entregue ao destinatário.</div>${fotoUploaderHTML('entrega',r.temFotoEntrega)}`:''}
    </div>
    <div class="card"><h3>Status</h3><div class="sub">Atualize conforme avança</div>
      <div style="display:flex;flex-direction:column;gap:10px">${['aceita','a_caminho','aguardando','em_andamento','concluida'].map(s=>{const done=ORD[r.status]>=ORD[s];return `<div class="flex"><span style="width:12px;height:12px;border-radius:50%;background:${done?'var(--neon)':'var(--line2)'}"></span><span class="${done?'':'muted'}">${labelStatus(s)}</span></div>`;}).join('')}</div>
      ${r.status==='aguardando'?`<div class="banner warn" style="margin-top:14px">⏱️ Espera grátis ${CFG.pricing.esperaFreeMin}min; depois ${brl(CFG.pricing.esperaPorMin)}/min — somada como aditivo na fatura do cliente.</div>`:''}
      ${cur?`<button class="btn btn-neon btn-block" id="avancar" style="margin-top:14px" ${faltaFoto?'disabled':''}>${cur[1]}</button>`:''}
      ${faltaFoto?`<div class="small muted" style="margin-top:8px;text-align:center">Envie a foto ${precisaColeta?'da coleta':'da entrega'} para liberar este botão.</div>`:''}
      <button class="btn btn-ghost btn-block btn-sm" id="cancelar" style="margin-top:10px">Cancelar corrida</button></div>
  </div>`);
  if(precisaColeta)wireFotoUploader(r.id,'coleta',()=>renderTab());
  if(precisaEntrega)wireFotoUploader(r.id,'entrega',()=>renderTab());
  if(cur){const b=$('#avancar');if(b)b.onclick=async()=>{loading(true);try{await api('/rides/'+r.id+'/status',{method:'POST',body:{status:cur[2]}});loading(false);toast(cur[2]==='concluida'?'Entrega concluída! '+brl(r.recebe||r.valorMotoboy)+' na carteira.':'Status atualizado');renderTab();}catch(e){loading(false);const er=e.data&&e.data.error;toast(er==='foto_coleta_obrigatoria'?'Envie a foto da coleta':er==='foto_entrega_obrigatoria'?'Envie a foto da entrega':'Erro',1);}};}
  $('#cancelar').onclick=async()=>{if(!confirm('Cancelar? A corrida volta para a fila.'))return;loading(true);try{await api('/rides/'+r.id+'/cancel',{method:'POST'});loading(false);toast('Cancelada');viewTab='online';clearPoll();renderShell();renderTab();}catch(e){loading(false);toast('Erro',1);}};
}
function motoCarteira(){ setBody('<div class="empty">Carregando…</div>'); setPoll(async()=>{try{const [u,rides]=await Promise.all([api('/me'),api('/rides/motoboy')]);USER=u;renderCarteira(u,rides);}catch(e){}},6000); }
function renderCarteira(u,rides){
  const feitas=(rides||[]).filter(r=>r.status==='concluida'||r.status==='paga');
  const totalGanho=feitas.reduce((s,r)=>s+(r.recebe||r.valorMotoboy||0),0);
  const mediaGanho=feitas.length?totalGanho/feitas.length:0;
  setBody(`<div class="banner info">Aqui aparece <b>o que você recebe</b> por corrida — já é o valor líquido, livre de qualquer desconto.</div>
    <div class="grid g3" style="margin-bottom:16px">
    <div class="kpi hl"><div class="lab">Saldo disponível</div><div class="val">${brl(u.saldo)}</div><div class="delta">pronto para transferir</div></div>
    <div class="kpi"><div class="lab">Total recebido</div><div class="val">${brl(totalGanho)}</div><div class="delta">${feitas.length} entregas concluídas</div></div>
    <div class="kpi"><div class="lab">Média por corrida</div><div class="val">${brl(mediaGanho)}</div><div class="delta">seu ganho médio</div></div></div>
    <div class="card"><h3>Transferir para meu banco</h3><div class="sub">Sem saque — apenas transferência (PIX ou TED/DOC).</div>
      ${u.banco?`<div class="banner ok">Conta: ${esc(u.banco.tipo)} · ${esc(u.banco.chave)}</div>`:'<div class="banner warn">Cadastre uma conta para transferir.</div>'}
      <div class="row2"><div class="field"><label>Tipo</label><select id="bk_tipo"><option>PIX</option><option>TED/DOC</option></select></div>
      <div class="field"><label>Chave PIX / Conta</label><input id="bk_chave" value="${u.banco?esc(u.banco.chave):''}"></div></div>
      <div class="flex"><button class="btn btn-out btn-sm" id="salvarBanco">Salvar conta</button><div class="spacer"></div>
        <div class="field" style="margin:0;min-width:150px"><input id="bk_valor" type="number" placeholder="valor" step="0.01" max="${u.saldo}"></div>
        <button class="btn btn-neon btn-sm" id="transferir">Transferir</button></div></div>
    <div class="card"><h3>Extrato</h3><div class="sub">Valor que você recebeu em cada entrega</div>${feitas.length?`<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Corrida</th><th>Trajeto</th><th>Você recebeu</th></tr></thead><tbody>
      ${feitas.sort((a,b)=>(b.concluidaEm||'').localeCompare(a.concluidaEm||'')).map(r=>`<tr><td>${r.concluidaEm?new Date(r.concluidaEm).toLocaleDateString('pt-BR'):'-'}</td><td>${esc(r.tipo)}${r.gorjeta>0?' <span class="small" style="color:#ffd56b">+caixinha</span>':''}</td><td class="small muted">${esc(r.origem.bairro)} → ${esc(r.destino.bairro)}</td><td class="neon"><b>${brl(r.recebe||r.valorMotoboy)}</b></td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Sem entregas concluídas.</div>'}</div>`);
  $('#salvarBanco').onclick=async()=>{const chave=$('#bk_chave').value.trim();if(!chave){toast('Informe a chave',1);return;}try{USER=await api('/me/banco',{method:'POST',body:{tipo:$('#bk_tipo').value,chave}});toast('Conta salva');renderTab();}catch(e){toast('Erro',1);}};
  $('#transferir').onclick=()=>{const val=+$('#bk_valor').value;if(!u.banco){toast('Cadastre uma conta',1);return;}if(!(val>0)||val>u.saldo){toast('Valor inválido',1);return;}toast('Transferência de '+brl(val)+' solicitada (requer gateway de pagamento real).');};
}
function motoMetas(){ setBody('<div class="empty">Carregando…</div>'); (async()=>{try{USER=await api('/me');renderMetas(USER);}catch(e){}})(); }
function renderMetas(u){
  setBody(`<div class="grid g2" style="margin-bottom:16px">
    <div class="card"><h3>Meta da semana</h3><div class="sub">${u.metaSemana?brl(u.metaSemana):'— sem meta'}</div><div class="meter"><i style="width:0%"></i></div></div>
    <div class="card"><h3>Meta do dia</h3><div class="sub">${u.metaDia?brl(u.metaDia):'— sem meta'}</div><div class="meter"><i style="width:0%"></i></div></div></div>
    <div class="card"><h3>Definir metas de ganho</h3><div class="sub">Acompanhe seu progresso automaticamente.</div>
      <div class="row2"><div class="field"><label>Meta por dia (R$)</label><input id="m_dia" type="number" value="${u.metaDia||''}" placeholder="120"></div>
      <div class="field"><label>Meta por semana (R$)</label><input id="m_sem" type="number" value="${u.metaSemana||''}" placeholder="700"></div></div>
      <button class="btn btn-neon btn-sm" id="salvarMeta">Salvar metas</button></div>`);
  $('#salvarMeta').onclick=async()=>{try{USER=await api('/me/metas',{method:'POST',body:{metaDia:+$('#m_dia').value||0,metaSemana:+$('#m_sem').value||0}});toast('Metas atualizadas!');renderTab();}catch(e){toast('Erro',1);}};
}

/* ================= ADMIN ================= */
function admKpis(){ setBody('<div class="empty">Carregando indicadores…</div>'); setPoll(async()=>{try{const [users,rides]=await Promise.all([api('/admin/users'),api('/admin/rides')]);renderKpis(users,rides);}catch(e){}},6000); }
function renderKpis(users,rides){
  const clientes=users.filter(u=>u.role==='cliente').length,motoboys=users.filter(u=>u.role==='motoboy').length;
  const concl=rides.filter(r=>r.status==='concluida'||r.status==='paga');
  const canc=rides.filter(r=>r.status==='cancelada').length;
  const ativas=rides.filter(r=>['solicitada','aceita','a_caminho','aguardando','em_andamento'].includes(r.status)).length;
  const total=rides.length;
  const gmv=concl.reduce((s,r)=>s+(r.valor||0),0);              // cliente pagou (X)
  const repasse=concl.reduce((s,r)=>s+(r.valorMotoboy||0),0);   // motoboy recebeu (Y)
  const receita=concl.reduce((s,r)=>s+(r.totalRetido||0),0);    // plataforma reteve (X-Y)
  const ticket=concl.length?gmv/concl.length:0;
  const ganhoMed=concl.length?repasse/concl.length:0;
  const margem=gmv?receita/gmv*100:0;
  const pRep=gmv?Math.round(repasse/gmv*100):0, pRec=gmv?Math.round(receita/gmv*100):0;
  const bairros={};rides.forEach(r=>{if(r.origem&&r.origem.bairro)bairros[r.origem.bairro]=(bairros[r.origem.bairro]||0)+1;});
  const topB=Object.entries(bairros).sort((a,b)=>b[1]-a[1]).slice(0,6),maxB=topB[0]?topB[0][1]:1;
  setBody(`<div class="banner info">Controle financeiro completo em tempo real — você vê quanto o cliente pagou, quanto o motoboy recebeu e quanto a plataforma reteve.</div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="kpi hl"><div class="lab">GMV · Clientes pagaram</div><div class="val">${brl(gmv)}</div><div class="delta">${concl.length} corridas concluídas</div></div>
    <div class="kpi"><div class="lab">Repasse aos motoboys</div><div class="val">${brl(repasse)}</div><div class="delta">${pRep}% do GMV</div></div>
    <div class="kpi hl"><div class="lab">Receita retida (plataforma)</div><div class="val">${brl(receita)}</div><div class="delta">${pRec}% do GMV</div></div>
    <div class="kpi"><div class="lab">Margem média</div><div class="val">${margem.toFixed(1)}<small>%</small></div><div class="delta">retido ÷ GMV</div></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="kpi"><div class="lab">Ticket médio (cliente)</div><div class="val">${brl(ticket)}</div></div>
    <div class="kpi"><div class="lab">Ganho médio (motoboy)</div><div class="val">${brl(ganhoMed)}</div></div>
    <div class="kpi"><div class="lab">Corridas ativas</div><div class="val">${ativas}</div></div>
    <div class="kpi"><div class="lab">Total de corridas</div><div class="val">${total}</div></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="kpi"><div class="lab">Clientes</div><div class="val">${clientes}</div></div>
    <div class="kpi"><div class="lab">Motoboys</div><div class="val">${motoboys}</div></div>
    <div class="kpi"><div class="lab">Taxa de conclusão</div><div class="val">${total?Math.round(concl.length/total*100):0}<small>%</small></div></div>
    <div class="kpi"><div class="lab">Taxa de cancelamento</div><div class="val">${total?Math.round(canc/total*100):0}<small>%</small></div></div></div>
  <div class="grid g2">
    <div class="card"><h3>Repartição do faturamento</h3><div class="sub">Como o que o cliente paga se divide</div>
      <div style="display:flex;height:26px;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin:10px 0 14px">
        <div style="width:${pRep}%;background:var(--neon)"></div><div style="width:${pRec}%;background:var(--blue)"></div></div>
      <div class="list">
        <div class="item"><div class="main"><div class="t">Cliente pagou (GMV)</div></div><b>${brl(gmv)}</b></div>
        <div class="item"><div class="main"><div class="t"><span style="color:var(--neon)">■</span> Motoboys receberam</div></div><b>${brl(repasse)}</b></div>
        <div class="item"><div class="main"><div class="t"><span style="color:var(--blue)">■</span> Plataforma reteve</div></div><b>${brl(receita)}</b></div>
      </div></div>
    <div class="card"><h3>Demanda por bairro (coleta)</h3><div class="sub">Onde concentrar motoboys</div>
      ${topB.length?topB.map(([b,n])=>`<div style="margin-bottom:12px"><div class="flex small"><span>${esc(b)}</span><div class="spacer"></div><b>${n}</b></div><div class="meter"><i style="width:${Math.round(n/maxB*100)}%"></i></div></div>`).join(''):'<div class="empty">Sem dados.</div>'}</div>
  </div>`);
}
function admCadastros(){ setBody('<div class="empty">Carregando…</div>'); setPoll(async()=>{try{renderCadastros(await api('/admin/users'));}catch(e){}},8000); }
function renderCadastros(users){
  setBody(`<div class="card"><h3>Cadastros (${users.length})</h3><div class="sub">Todos os usuários</div><div class="tbl-wrap"><table>
    <thead><tr><th>Nome</th><th>Perfil</th><th>E-mail</th><th>Telefone</th><th>Extra</th><th>Desde</th></tr></thead><tbody>
    ${users.map(u=>`<tr><td><b>${esc(u.nome)}</b></td><td><span class="tag ${u.role}">${u.role}</span></td><td>${esc(u.email)}</td><td>${esc(u.telefone||'-')}</td><td class="small muted">${u.role==='motoboy'?esc((u.modelo||'')+' · '+(u.placa||'')):esc(u.cpf||'-')}</td><td class="small">${u.createdAt?new Date(u.createdAt).toLocaleDateString('pt-BR'):'-'}</td></tr>`).join('')}
    </tbody></table></div></div>`);
}
function admCorridas(){ setBody('<div class="empty">Carregando…</div>'); setPoll(async()=>{try{renderCorridasAdmin(await api('/admin/rides'));}catch(e){}},6000); }
function renderCorridasAdmin(rides){
  setBody(`<div class="card"><h3>Corridas (${rides.length})</h3><div class="sub">Histórico e status</div>
    ${rides.length?`<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Motoboy</th><th>Trajeto</th><th>Cliente pagou</th><th>Motoboy recebeu</th><th>Plataforma reteve</th><th>Status</th></tr></thead><tbody>
    ${rides.map(r=>`<tr><td class="small">${new Date(r.criadaEm).toLocaleString('pt-BR')}</td><td>${esc(r.clienteNome)}</td><td>${esc(r.motoboyNome||'-')}</td><td class="small">${esc(r.origem.bairro)} → ${esc(r.destino.bairro)}</td><td><b>${brl(r.valor)}</b></td><td class="neon">${brl(r.valorMotoboy)}</td><td class="muted">${brl(r.totalRetido)}</td><td><span class="tag ${r.status}">${labelStatus(r.status)}</span></td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Nenhuma corrida.</div>'}</div>`);
}

/* ================= PERFIL / AVALIAÇÃO ================= */
async function perfil(){ setBody('<div class="empty">Carregando…</div>'); try{const u=await api('/me');USER=u;
  setBody(`<div class="card"><h3>Meus dados</h3><div class="list">
    <div class="item"><div class="main"><div class="t">Nome</div><div class="d">${esc(u.nome)}</div></div></div>
    <div class="item"><div class="main"><div class="t">E-mail</div><div class="d">${esc(u.email)}</div></div></div>
    <div class="item"><div class="main"><div class="t">WhatsApp</div><div class="d">${esc(u.telefone||'-')}</div></div></div>
    <div class="item"><div class="main"><div class="t">CPF</div><div class="d">${esc(u.cpf||'-')}</div></div></div>
    ${u.role==='motoboy'?`<div class="item"><div class="main"><div class="t">Moto</div><div class="d">${esc(u.modelo||'-')} · placa ${esc(u.placa||'-')} · CNH ${esc(u.cnh||'-')}</div></div></div>`:''}
    <div class="item"><div class="main"><div class="t">Avaliação</div><div class="d">${u.ratingCount?('★'+(u.rating/u.ratingCount).toFixed(1)+' ('+u.ratingCount+')'):'Sem avaliações'}</div></div></div>
  </div></div>`);}catch(e){setBody('<div class="banner bad">Erro</div>');}}
function estrelas(host,cb){host.innerHTML=[1,2,3,4,5].map(n=>`<button data-n="${n}">★</button>`).join('');let sel=0;const paint=k=>host.querySelectorAll('button').forEach((b,i)=>b.className=i<k?'on':'');host.querySelectorAll('button').forEach(b=>{b.onmouseenter=()=>paint(+b.dataset.n);b.onmouseleave=()=>paint(sel);b.onclick=()=>{sel=+b.dataset.n;paint(sel);cb(sel);};});}
async function avaliar(id,nota){try{await api('/rides/'+id+'/rate',{method:'POST',body:{nota}});toast('Avaliação: ★'+nota);}catch(e){toast('Erro ao avaliar',1);}}

/* ================= RECIBO (estilo Uber) + AVALIAÇÃO + CAIXINHA ================= */
let leafletPromise=null;
function loadLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  if(leafletPromise)return leafletPromise;
  leafletPromise=new Promise((res,rej)=>{
    const css=document.createElement('link');css.rel='stylesheet';css.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';document.head.appendChild(css);
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';s.onload=()=>res(window.L);s.onerror=()=>rej('leaflet');document.head.appendChild(s);
  });
  return leafletPromise;
}
function initReciboMap(elId,o,d){
  if(!(o&&o.lat&&d&&d.lat))return;
  loadLeaflet().then(L=>{
    const el=document.getElementById(elId);if(!el||el._leaflet_id)return;
    const map=L.map(el,{zoomControl:false,attributionControl:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
    const a=[o.lat,o.lng],b=[d.lat,d.lng];
    L.circleMarker(a,{radius:7,color:'#0a0a0a',weight:2,fillColor:'#C6FF00',fillOpacity:1}).addTo(map);
    L.circleMarker(b,{radius:7,color:'#0a0a0a',weight:2,fillColor:'#5BC8FF',fillOpacity:1}).addTo(map);
    L.polyline([a,b],{color:'#C6FF00',weight:4,opacity:.85}).addTo(map);
    map.fitBounds([a,b],{padding:[30,30]});
    setTimeout(()=>map.invalidateSize(),150);
  }).catch(()=>{const el=document.getElementById(elId);if(el)el.innerHTML='<div style="padding:30px;text-align:center;color:#8c8c8c;font-size:12px">Mapa indisponível</div>';});
}
const dtBR=s=>s?new Date(s).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-';
const endLinha=e=>`${esc(e.rua||'')}, ${esc(e.numero||'')} — ${esc(e.bairro||'')}${e.cidade?', '+esc(e.cidade)+(e.uf?'/'+esc(e.uf):''):''}`;
function reciboValoresHTML(r){
  const corrida=Math.round(((r.valor||0)-(r.pesoExtra||0))*100)/100;
  const temExtras=(r.pesoExtra>0)||(r.espera>0)||(r.gorjeta>0);
  const lin=(n,v,ex)=>`<div class="lin ${ex?'extra':''}"><span>${n}</span><span>${brl(v)}</span></div>`;
  if(!temExtras)return `<div class="tot"><span>Total da corrida</span><span>${brl(r.total)}</span></div>`;
  let h=lin('Corrida',corrida);
  if(r.pesoExtra>0)h+=lin('+ Peso extra',r.pesoExtra,true);
  if(r.espera>0)h+=lin('+ Espera no endereço ('+r.esperaMin+' min)',r.espera,true);
  if(r.gorjeta>0)h+=lin('+ Caixinha ao entregador',r.gorjeta,true);
  h+=`<div class="tot"><span>Total</span><span>${brl(r.total)}</span></div>`;
  return h;
}
function reciboCorpoHTML(r,mapId){
  const emp=r.empresa||CFG.empresa||{nome:'LEVA Entregas'};
  const fotos=(r.fotoColeta||r.fotoEntrega)?`<div class="rc-sec">Comprovação do item</div>
    <div class="rc-fotos">
      <figure><img src="${r.fotoColeta||''}" alt="coleta">${r.fotoColeta?'':''}<figcaption>Coleta</figcaption></figure>
      <figure><img src="${r.fotoEntrega||''}" alt="entrega"><figcaption>Entrega</figcaption></figure>
    </div>`:'';
  return `<div class="rc-head">
      <div class="rc-brand">${esc(emp.nome)}<small>CNPJ ${esc(emp.cnpj||'—')}${emp.cidade?' · '+esc(emp.cidade):''}</small></div>
      <div class="rc-badge">RECIBO</div>
    </div>
    <div class="rc-map" id="${mapId}"></div>
    <div class="rc-addr"><span class="rc-dot" style="background:#C6FF00"></span><div><b>Coleta</b><br><span class="muted small">${endLinha(r.origem)}</span></div></div>
    <div class="rc-addr"><span class="rc-dot" style="background:#5BC8FF"></span><div><b>Entrega</b><br><span class="muted small">${endLinha(r.destino)}</span></div></div>
    <div style="margin-top:12px">
      <div class="rc-row"><span class="k">Corrida nº</span><span>${esc((r.id||'').toUpperCase())}</span></div>
      <div class="rc-row"><span class="k">Data/hora</span><span>${dtBR(r.concluidaEm||r.criadaEm)}</span></div>
      <div class="rc-row"><span class="k">Entregador</span><span>${esc(r.motoboyNome||'-')}</span></div>
      <div class="rc-row"><span class="k">Item</span><span>${esc(r.tipo||'-')} · ${r.peso||0} kg</span></div>
      <div class="rc-row"><span class="k">Distância</span><span>${(r.km||0).toFixed(1)} km</span></div>
    </div>
    ${fotos}
    <div class="rc-sec">Valores</div>
    <div class="rc-vals">${reciboValoresHTML(r)}</div>`;
}
async function abrirRecibo(rideId){
  let r;try{loading(true);r=await api('/rides/'+rideId);loading(false);}catch(e){loading(false);toast('Erro ao abrir recibo',1);return;}
  const mapId='rcmap_'+Date.now();
  const jaAval=!!r.avalCliente;
  const gorjs=(CFG.gorjetas||[2,5,10]);
  const corpo=reciboCorpoHTML(r,mapId);
  const avalBlock=jaAval
    ? `<div class="rc-sec">Sua avaliação</div><div class="small ok">Você avaliou o entregador com ★${r.avalCliente}.</div>`
    : `<div class="rc-sec">Avalie o entregador</div><div class="stars-big" id="rc_stars"></div>`;
  const tipBlock=`<div class="rc-sec">Caixinha para ${esc(r.motoboyNome||'o entregador')}</div>
    <div class="small muted">100% vai para o entregador. ${r.gorjeta>0?'Você já enviou '+brl(r.gorjeta)+'.':''}</div>
    <div class="tip-grid" id="rc_tips">${gorjs.map(v=>`<button data-v="${v}">${brl(v)}</button>`).join('')}<button data-v="outro">Outro</button></div>
    <div id="rc_outro" style="display:none;margin-bottom:8px"><input id="rc_outro_v" type="number" min="1" step="0.5" placeholder="Valor da caixinha (R$)" style="width:100%"></div>
    <div id="rc_tipconfirm"></div>
    <button class="btn btn-neon btn-block btn-sm" id="rc_enviar_tip">Enviar caixinha</button>`;
  modal(`<div class="rc">${corpo}
    <div style="border-top:1px solid #222;margin-top:18px;padding-top:4px">${avalBlock}${tipBlock}</div>
    <button class="btn btn-out btn-block btn-sm" id="rc_baixar" style="margin-top:16px">⬇ Baixar recibo</button>
  </div>`,{wide:true,sticky:true});
  initReciboMap(mapId,r.origem,r.destino);
  if(!jaAval){const h=$('#rc_stars');if(h)estrelas(h,async n=>{await avaliar(r.id,n);h.outerHTML='<div class="small ok">Obrigado! Você avaliou com ★'+n+'.</div>';});}
  // caixinha
  let tipSel=0;
  $('#rc_tips').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    $('#rc_tips').querySelectorAll('button').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');
    if(b.dataset.v==='outro'){$('#rc_outro').style.display='block';tipSel='outro';}
    else{$('#rc_outro').style.display='none';tipSel=+b.dataset.v;}
    $('#rc_tipconfirm').innerHTML='';
  });
  $('#rc_enviar_tip').onclick=()=>{
    let v=tipSel==='outro'?+($('#rc_outro_v').value):tipSel;
    if(!(v>0)){toast('Escolha ou digite um valor',1);return;}
    v=Math.round(v*100)/100;
    // caixa de confirmação
    $('#rc_tipconfirm').innerHTML=`<div class="banner info" style="margin:0 0 10px">Confirmar caixinha de <b>${brl(v)}</b> para ${esc(r.motoboyNome||'o entregador')}?
      <div class="flex" style="margin-top:8px;gap:8px"><button class="btn btn-neon btn-sm" id="rc_tip_ok">Confirmar</button><button class="btn btn-ghost btn-sm" id="rc_tip_no">Cancelar</button></div></div>`;
    $('#rc_tip_no').onclick=()=>{$('#rc_tipconfirm').innerHTML='';};
    $('#rc_tip_ok').onclick=async()=>{
      loading(true);try{await api('/rides/'+r.id+'/gorjeta',{method:'POST',body:{valor:v}});loading(false);
        toast('Caixinha enviada! Gerando novo comprovante…');closeModal();abrirRecibo(r.id); // novo recibo com a gorjeta
      }catch(e){loading(false);toast('Erro ao enviar caixinha',1);}
    };
  };
  $('#rc_baixar').onclick=()=>baixarRecibo(r);
}
function baixarRecibo(r){
  const emp=r.empresa||CFG.empresa||{nome:'LEVA Entregas'};
  const o=r.origem||{},d=r.destino||{};
  const corpo=reciboCorpoHTML(r,'rcmap_dl');
  const uiCss=document.getElementById('uistyles')?document.getElementById('uistyles').textContent:'';
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo ${esc(emp.nome)} · ${esc((r.id||'').toUpperCase())}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>body{margin:0;background:#0d0d0d;color:#eaeaea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif}
.req{color:#C6FF00}.muted{color:#9a9a9a}.small{font-size:12px}.ok{color:#C6FF00}.flex{display:flex;align-items:center}
.wrap{max-width:560px;margin:20px auto;background:#121212;border:1px solid #2b2b2b;border-radius:16px}
${uiCss}</style></head><body><div class="wrap"><div class="rc">${corpo}
<div class="small muted" style="margin-top:16px;text-align:center">Documento gerado por ${esc(emp.nome)} · ${esc(emp.contato||'')}</div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
<script>(function(){var o=${JSON.stringify({lat:o.lat,lng:o.lng})},d=${JSON.stringify({lat:d.lat,lng:d.lng})};
if(!(o.lat&&d.lat))return;var el=document.getElementById('rcmap_dl');var m=L.map(el,{zoomControl:false,attributionControl:false});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(m);
var a=[o.lat,o.lng],b=[d.lat,d.lng];
L.circleMarker(a,{radius:7,color:'#0a0a0a',weight:2,fillColor:'#C6FF00',fillOpacity:1}).addTo(m);
L.circleMarker(b,{radius:7,color:'#0a0a0a',weight:2,fillColor:'#5BC8FF',fillOpacity:1}).addTo(m);
L.polyline([a,b],{color:'#C6FF00',weight:4,opacity:.85}).addTo(m);
m.fitBounds([a,b],{padding:[30,30]});setTimeout(function(){m.invalidateSize();},200);})();<\/script>
</body></html>`;
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download='recibo-LEVA-'+(r.id||'corrida')+'.html';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  toast('Recibo baixado');
}
