(function(){
'use strict';

/* ============================================================
   CLIENTE DA API
   ============================================================ */
async function api(path, opts={}){
  const headers = {'Content-Type':'application/json'};
  if(opts.auth && state.token) headers.Authorization = 'Bearer '+state.token;
  if(opts.adminAuth && state.adminToken) headers.Authorization = 'Bearer '+state.adminToken;
  const res = await fetch(path, {
    method: opts.method||'GET',
    headers,
    body: opts.body!=null ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try{ data = await res.json(); }catch(e){}
  if(res.status===401){
    if(opts.adminAuth){ state.adminToken=null; state.isAdmin=false; localStorage.removeItem('bolerage_admin_token'); }
    if(opts.auth){ state.token=null; state.currentPlayer=null; localStorage.removeItem('bolerage_token'); localStorage.removeItem('bolerage_player'); }
  }
  if(!res.ok){
    const err = new Error((data&&data.erro) || ('Erro '+res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(str){
  return String(str==null?'':str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDataBR(dateStr){
  const [y,m,d] = dateStr.split('-');
  return d+'/'+m+'/'+y;
}

/* ============================================================
   ESTADO
   ============================================================ */
const state = {
  token: localStorage.getItem('bolerage_token') || null,
  currentPlayer: JSON.parse(localStorage.getItem('bolerage_player') || 'null'),
  adminToken: localStorage.getItem('bolerage_admin_token') || null,
  isAdmin: !!localStorage.getItem('bolerage_admin_token'),
  elenco: [],           // lista pública (sem pin): [{id,nome,posicaoPadrao,ativo}]
  elencoAdmin: null,    // {jogadores (com pin), config} — só carregado dentro do painel admin
  tab: 'inicio',
  pinBuffer: '',
  adminPinBuffer: '',
  loginError: '',
  adminLoginError: '',
  rodadaAtual: null,
  rodadasLista: [],
  rodadaVisualizadaId: null,
  rodadaVisualizada: null,
  rankingFiltro: 'linha',
  editingJogadorId: null,
  trocaPinErro: '',
  mostrouDicaPin: false,
  pollHandle: null,
};

function jogadorNome(id){ const j = state.elenco.find(x=>x.id===id); return j ? j.nome : '?'; }

/* ============================================================
   CARREGAMENTO DE DADOS
   ============================================================ */
async function refreshElenco(){
  try{ const data = await api('/api/elenco'); state.elenco = data.jogadores; }catch(e){}
}
async function refreshRodadaAtual(){
  try{
    const data = await api('/api/rodadas/atual');
    state.rodadaAtual = data.rodada;
    if(!state.rodadaVisualizadaId && state.rodadaAtual){
      state.rodadaVisualizadaId = state.rodadaAtual.id;
      state.rodadaVisualizada = state.rodadaAtual;
    }
    if(state.rodadaAtual && state.rodadaVisualizadaId === state.rodadaAtual.id){
      state.rodadaVisualizada = state.rodadaAtual;
    }
  }catch(e){}
}
async function refreshRodadasLista(){
  try{ const data = await api('/api/rodadas'); state.rodadasLista = data.rodadas; }catch(e){}
}
async function carregarRodadaVisualizada(id){
  try{
    const data = await api('/api/rodadas/'+id);
    state.rodadaVisualizadaId = id;
    state.rodadaVisualizada = data.rodada;
  }catch(e){}
}

/* ============================================================
   RENDER: TOPBAR
   ============================================================ */
function renderTopbar(){
  const topbar = document.getElementById('topbar');
  const bottomnav = document.getElementById('bottomnav');
  if(!state.currentPlayer){ topbar.style.display='none'; bottomnav.style.display='none'; return; }
  topbar.style.display='block';
  bottomnav.style.display='flex';
  document.getElementById('who-slot').innerHTML =
    escapeHtml(state.currentPlayer.nome)+
    '<button data-action="abrir-troca-pin">trocar PIN</button>'+
    '<button data-action="logout">sair</button>';
  const fase = state.rodadaAtual ? state.rodadaAtual.fase : {label:'Nenhuma rodada agendada', cor:'muted'};
  document.getElementById('phase-chip-slot').innerHTML =
    '<span class="chip '+fase.cor+'"><span class="dot"></span>'+escapeHtml(fase.label)+'</span>';

  const tabs = [
    {key:'inicio', label:'Início', icon:'<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>'},
    {key:'sorteio', label:'Sorteio', icon:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="12" cy="12" r="1.2"/>'},
    {key:'votacao', label:'Votação', icon:'<path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9z"/><path d="M4 9l3-5h10l3 5"/><path d="M9 13l2 2 4-4"/>'},
    {key:'ranking', label:'Ranking', icon:'<line x1="5" y1="20" x2="5" y2="13"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="19" y1="20" x2="19" y2="4"/>'},
    {key:'admin', label:'Admin', icon:'<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2"/>'},
  ];
  bottomnav.innerHTML = tabs.map(t=>
    '<button data-action="tab" data-tab="'+t.key+'" class="'+(state.tab===t.key?'active':'')+'">'+
    '<svg viewBox="0 0 24 24">'+t.icon+'</svg><span>'+t.label+'</span></button>'
  ).join('');
}

/* ============================================================
   RENDER: LOGIN
   ============================================================ */
function renderLogin(){
  const dots = [0,1,2,3].map(i=>'<div class="pin-dot '+(i<state.pinBuffer.length?'filled':'')+'"></div>').join('');
  const keys = ['1','2','3','4','5','6','7','8','9','','0','back'];
  const keypad = keys.map(k=>{
    if(k==='') return '<button class="ghost"></button>';
    if(k==='back') return '<button data-action="login-back">⌫</button>';
    return '<button data-action="login-digit" data-digit="'+k+'">'+k+'</button>';
  }).join('');
  document.getElementById('content').innerHTML =
    '<div id="login-screen">'+
      '<img src="/assets/logo.jpg" alt="Bolerage F.D." class="login-logo">'+
      '<h1>Bolerage F.D.</h1>'+
      '<div class="sub">Digite seu PIN de 4 dígitos</div>'+
      '<div class="pin-dots">'+dots+'</div>'+
      '<div class="keypad">'+keypad+'</div>'+
      '<div class="login-error">'+escapeHtml(state.loginError)+'</div>'+
      '<div class="login-hint">Não sabe seu PIN? Peça para o administrador do grupo. (PIN administrativo é separado e fica na aba Admin.)</div>'+
    '</div>';
}

async function handleLoginDigit(d){
  if(state.pinBuffer.length>=4) return;
  state.pinBuffer += d;
  state.loginError='';
  if(state.pinBuffer.length<4){ render(); return; }
  const pin = state.pinBuffer;
  state.pinBuffer='';
  try{
    const data = await api('/api/login', {method:'POST', body:{pin}});
    state.token = data.token;
    state.currentPlayer = data.jogador;
    localStorage.setItem('bolerage_token', data.token);
    localStorage.setItem('bolerage_player', JSON.stringify(data.jogador));
    state.tab='inicio';
    await refreshRodadaAtual();
    startPolling();
    await render();
  }catch(e){
    state.loginError = e.message || 'PIN não encontrado. Tente novamente.';
    render();
  }
}

async function handleLogout(){
  try{ await api('/api/logout', {method:'POST', auth:true}); }catch(e){}
  state.token=null; state.currentPlayer=null; state.tab='inicio'; state.mostrouDicaPin=false;
  localStorage.removeItem('bolerage_token'); localStorage.removeItem('bolerage_player');
  if(state.pollHandle){ clearInterval(state.pollHandle); state.pollHandle=null; }
  render();
}

/* ============================================================
   RENDER: TROCAR MEU PIN
   ============================================================ */
function renderTrocarPin(){
  document.getElementById('content').innerHTML =
    '<div class="card"><h2>Trocar meu PIN</h2>'+
    '<p class="small muted">Escolha um PIN de 4 dígitos que só você vai usar para entrar.</p>'+
    '<div class="field"><label>Novo PIN</label><input id="novo-pin-jogador" maxlength="4" inputmode="numeric" type="tel"></div>'+
    '<div class="field"><label>Confirmar novo PIN</label><input id="confirmar-pin-jogador" maxlength="4" inputmode="numeric" type="tel"></div>'+
    (state.trocaPinErro? '<p class="small" style="color:var(--red);">'+escapeHtml(state.trocaPinErro)+'</p>':'')+
    '<div class="btn-row"><button class="btn" data-action="salvar-meu-pin">Salvar novo PIN</button>'+
    '<button class="btn secondary" data-action="cancelar-troca-pin">Cancelar</button></div>'+
    '</div>';
}
async function handleSalvarMeuPin(){
  const novo = document.getElementById('novo-pin-jogador').value.trim();
  const confirmaPin = document.getElementById('confirmar-pin-jogador').value.trim();
  if(!/^\d{4}$/.test(novo)){ state.trocaPinErro='O PIN precisa ter exatamente 4 dígitos.'; return render(); }
  if(novo!==confirmaPin){ state.trocaPinErro='Os PINs digitados não são iguais.'; return render(); }
  try{
    await api('/api/trocar-pin', {method:'POST', auth:true, body:{novoPin:novo}});
    state.trocaPinErro=''; state.tab='inicio';
    await render();
  }catch(e){ state.trocaPinErro = e.message; render(); }
}
function handleCancelarTrocaPin(){ state.trocaPinErro=''; state.tab='inicio'; render(); }

/* ============================================================
   RENDER: TAB INÍCIO
   ============================================================ */
function renderInicio(){
  const rodada = state.rodadaAtual;
  const c = document.getElementById('content');
  let dica = '';
  if(!state.mostrouDicaPin){
    dica = '<div class="info-box">Dica: você pode trocar seu PIN quando quiser clicando em "trocar PIN" no topo da tela.</div>';
    state.mostrouDicaPin = true;
  }
  if(!rodada){
    c.innerHTML = dica+'<div class="empty">Nenhuma rodada agendada ainda.<br>Peça para o administrador criar a próxima rodada.</div>';
    return;
  }
  const fase = rodada.fase;
  const confirmadosIds = rodada.confirmados || [];
  const confirmados = confirmadosIds.map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
  const jaConfirmado = confirmadosIds.includes(state.currentPlayer.id);
  const linhaN = confirmados.filter(j=>j.posicaoPadrao==='linha').length;
  const golN = confirmados.filter(j=>j.posicaoPadrao==='goleiro').length;

  let html = '<div class="card"><h2>Rodada de '+formatDataBR(rodada.data)+'</h2>';

  if(fase.chave==='pre_confirmacao'){
    html += '<p class="muted small">A confirmação de presença ainda não abriu. Ela abre no sábado às 8h e fecha no domingo às 8h.</p>';
  }
  if(fase.chave==='confirmacao_aberta'){
    html += '<p class="small">'+linhaN+' de linha e '+golN+' goleiro(s) confirmados até agora.</p>';
    html += '<div class="btn-row">';
    html += jaConfirmado
      ? '<button class="btn danger" data-action="desconfirmar">Cancelar minha presença</button>'
      : '<button class="btn" data-action="confirmar">Confirmar presença</button>';
    html += '</div>';
  }
  if(fase.chave==='aguardando_sorteio'){
    html += '<p class="small">Confirmação encerrada: '+linhaN+' de linha e '+golN+' goleiro(s).</p>';
    html += '<p class="muted small">Aguardando o administrador realizar o sorteio.</p>';
  }
  if(fase.chave==='nao_viabilizado'){
    html += '<p class="small">Apenas '+linhaN+' jogador(es) de linha e '+golN+' goleiro(s) confirmaram. Mínimo necessário: 10 de linha + 2 goleiros, ou 12 de linha no total.</p>';
  }

  if(['aguardando_sorteio','nao_viabilizado'].includes(fase.chave) || (fase.chave==='confirmacao_aberta')){
    if(confirmados.length){
      html += '<div class="divider"></div><h3>Confirmados até agora</h3>';
      confirmados.forEach(j=>{
        html += '<div class="list-row"><span>'+escapeHtml(j.nome)+'</span>'+(j.posicaoPadrao==='goleiro'?'<span class="badge gk">goleiro</span>':'<span class="badge">linha</span>')+'</div>';
      });
    }
  }

  if(rodada.status==='sorteado'){
    const meuTime = rodada.times.times.find(t=>t.jogadores.some(j=>j.jogadorId===state.currentPlayer.id));
    html += meuTime
      ? '<p class="small">Você está no time <strong>'+meuTime.nome+'</strong>. Veja a formação completa na aba Sorteio.</p>'
      : '<p class="small muted">Você não está escalado nesta rodada (fora do sorteio ou reserva). Veja detalhes na aba Sorteio.</p>';
    if(fase.chave==='votacao_aberta'){
      const jaVotouEm = new Set(rodada.votos.filter(v=>v.avaliadorId===state.currentPlayer.id).map(v=>v.avaliadoId));
      const alvos = rodada.times.times.flatMap(t=>t.jogadores).filter(j=>j.jogadorId!==state.currentPlayer.id);
      const faltam = alvos.filter(a=>!jaVotouEm.has(a.jogadorId)).length;
      html += '<p class="small">Votação aberta até as 18h. Faltam avaliar '+faltam+' colega(s). <a href="#" data-action="tab" data-tab="votacao">Ir para votação →</a></p>';
    }
    if(fase.chave==='encerrada'){
      html += '<p class="small muted">A rodada encerrou. Veja o ranking atualizado na aba Ranking.</p>';
    }
  }
  html += '</div>';
  c.innerHTML = dica + html;
}

async function handleConfirmar(){
  try{ await api('/api/rodadas/'+state.rodadaAtual.id+'/confirmar', {method:'POST', auth:true}); await refreshRodadaAtual(); render(); }
  catch(e){ alert(e.message); }
}
async function handleDesconfirmar(){
  try{ await api('/api/rodadas/'+state.rodadaAtual.id+'/desconfirmar', {method:'POST', auth:true}); await refreshRodadaAtual(); render(); }
  catch(e){ alert(e.message); }
}

/* ============================================================
   RENDER: TAB SORTEIO
   ============================================================ */
function timeClass(nome){
  return 't-'+nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function renderSorteio(){
  const c = document.getElementById('content');
  const opcoes = [...state.rodadasLista].sort((a,b)=>a.data<b.data?1:-1)
    .map(r=>'<option value="'+r.id+'" '+(r.id===state.rodadaVisualizadaId?'selected':'')+'>'+formatDataBR(r.data)+'</option>').join('');
  let html = '<div class="field"><label>Rodada</label><select data-action="mudar-rodada-visualizada">'+opcoes+'</select></div>';

  const rod = state.rodadaVisualizada;
  if(!rod || !rod.times){
    html += '<div class="empty">Os times aparecem aqui assim que o sorteio for realizado.</div>';
    c.innerHTML = html; return;
  }
  html += '<p class="muted small">Sorteio '+(rod.times.modo==='fase2'?'equilibrado pelas notas do ranking':'aleatório (ainda sem dados suficientes para equilíbrio por nota)')+'.</p>';
  rod.times.times.forEach(t=>{
    html += '<div class="team-card '+timeClass(t.nome)+'"><h2>'+t.nome+'</h2>';
    t.jogadores.forEach(j=>{
      html += '<div class="list-row"><span>'+escapeHtml(jogadorNome(j.jogadorId))+'</span>'+(j.papel==='goleiro'?'<span class="badge gk">goleiro</span>':'<span class="badge">linha</span>')+'</div>';
    });
    html += '</div>';
  });
  if(rod.times.reservas && rod.times.reservas.length){
    html += '<div class="card"><h3>Reservas desta rodada</h3>';
    rod.times.reservas.forEach(id=> html += '<div class="list-row"><span>'+escapeHtml(jogadorNome(id))+'</span></div>');
    html += '</div>';
  }
  c.innerHTML = html;
}

/* ============================================================
   RENDER: TAB VOTAÇÃO
   ============================================================ */
function renderVotacao(){
  const c = document.getElementById('content');
  const rod = state.rodadaAtual;
  if(!rod || rod.status!=='sorteado'){
    c.innerHTML = '<div class="empty">A votação abre quando os times da semana forem sorteados.</div>'; return;
  }
  const fase = rod.fase;
  if(fase.chave!=='votacao_aberta'){
    const msg = fase.chave==='sorteado_aguardando_votacao'
      ? 'A votação abre hoje às 10h e fecha às 18h.'
      : 'A janela de votação (domingo, 10h às 18h) está fechada.';
    c.innerHTML = '<div class="empty">'+msg+'</div>'; return;
  }
  const alvos = rod.times.times.flatMap(t=>t.jogadores.map(j2=>({...j2, time:t.nome})))
    .filter(j2=>j2.jogadorId!==state.currentPlayer.id);
  const meusVotos = {};
  rod.votos.filter(v=>v.avaliadorId===state.currentPlayer.id).forEach(v=>meusVotos[v.avaliadoId]=v.nota);

  let html = '<div class="card"><p class="small">Avalie a performance de quem jogou hoje, de 0 a 5. Você pode alterar sua nota até as 18h.</p></div>';
  alvos.forEach(a=>{
    const notaAtual = meusVotos[a.jogadorId];
    html += '<div class="card"><div class="list-row" style="border:none;padding:0 0 4px 0;"><span>'+escapeHtml(jogadorNome(a.jogadorId))+' <span class="badge">'+a.time+'</span></span></div>';
    html += '<div class="vote-scale">';
    for(let n=0;n<=5;n++){
      html += '<button class="vote-btn '+(notaAtual===n?'selected':'')+'" data-action="votar" data-avaliado="'+a.jogadorId+'" data-nota="'+n+'">'+n+'</button>';
    }
    html += '</div></div>';
  });
  c.innerHTML = html;
}
async function handleVotar(avaliadoId, nota){
  try{ await api('/api/rodadas/'+state.rodadaAtual.id+'/votos', {method:'POST', auth:true, body:{avaliadoId, nota}}); await refreshRodadaAtual(); render(); }
  catch(e){ alert(e.message); }
}

/* ============================================================
   RENDER: TAB RANKING
   ============================================================ */
async function renderRanking(){
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty">Calculando ranking…</div>';
  let ranking = {};
  try{ const data = await api('/api/ranking'); ranking = data.ranking; }catch(e){}
  const papel = state.rankingFiltro;
  const linhas = state.elenco.filter(j=>j.ativo).map(j=>{
    const r = ranking[j.id];
    const dados = r ? r[papel] : {media:null,total:0};
    return {nome:j.nome, media:dados.media, total:dados.total};
  });
  const comNota = linhas.filter(l=>l.media!=null).sort((a,b)=>b.media-a.media);
  const semNota = linhas.filter(l=>l.media==null);

  let html = '<div class="tabtoggle">'+
    '<button data-action="ranking-filtro" data-filtro="linha" class="'+(papel==='linha'?'active':'')+'">Linha</button>'+
    '<button data-action="ranking-filtro" data-filtro="goleiro" class="'+(papel==='goleiro'?'active':'')+'">Goleiro</button>'+
  '</div><div class="card">';
  comNota.forEach((l,i)=>{
    html += '<div class="rank-row"><div class="rank-pos">'+(i+1)+'</div><div class="rank-name">'+escapeHtml(l.nome)+
      '<div class="rank-count">'+l.total+' avaliação(ões)</div></div><div class="rank-avg">'+l.media.toFixed(1)+'</div></div>';
  });
  if(!comNota.length) html += '<p class="muted small">Ainda não há avaliações suficientes nesta categoria.</p>';
  html += '</div>';
  if(semNota.length){
    html += '<div class="card"><h3>Ainda sem avaliações</h3>';
    semNota.forEach(l=> html += '<div class="list-row"><span>'+escapeHtml(l.nome)+'</span></div>');
    html += '</div>';
  }
  c.innerHTML = html;
}

/* ============================================================
   RENDER: TAB ADMIN
   ============================================================ */
function renderAdminGate(){
  const c = document.getElementById('content');
  const dots = [0,1,2,3].map(i=>'<div class="pin-dot '+(i<state.adminPinBuffer.length?'filled':'')+'"></div>').join('');
  const keys = ['1','2','3','4','5','6','7','8','9','','0','back'];
  const keypad = keys.map(k=>{
    if(k==='') return '<button class="ghost"></button>';
    if(k==='back') return '<button data-action="admin-login-back">⌫</button>';
    return '<button data-action="admin-login-digit" data-digit="'+k+'">'+k+'</button>';
  }).join('');
  c.innerHTML = '<div id="login-screen" style="padding-top:20px;">'+
    '<h2>Área administrativa</h2><div class="sub small">PIN administrativo</div>'+
    '<div class="pin-dots">'+dots+'</div><div class="keypad">'+keypad+'</div>'+
    '<div class="login-error">'+escapeHtml(state.adminLoginError)+'</div></div>';
}
async function handleAdminDigit(d){
  if(state.adminPinBuffer.length>=4) return;
  state.adminPinBuffer += d;
  state.adminLoginError='';
  if(state.adminPinBuffer.length<4){ render(); return; }
  const pin = state.adminPinBuffer;
  state.adminPinBuffer='';
  try{
    const data = await api('/api/admin/login', {method:'POST', body:{pin}});
    state.adminToken = data.adminToken;
    state.isAdmin = true;
    localStorage.setItem('bolerage_admin_token', data.adminToken);
    await render();
  }catch(e){
    state.adminLoginError = e.message || 'PIN administrativo incorreto.';
    render();
  }
}
async function handleAdminLogout(){
  try{ await api('/api/admin/logout', {method:'POST', adminAuth:true}); }catch(e){}
  state.adminToken=null; state.isAdmin=false;
  localStorage.removeItem('bolerage_admin_token');
  render();
}

async function renderAdmin(){
  if(!state.isAdmin){ renderAdminGate(); return; }
  const c = document.getElementById('content');
  let elencoAdmin, eventos=[];
  try{ elencoAdmin = await api('/api/admin/elenco', {adminAuth:true}); }
  catch(e){ if(e.status===401) return render(); c.innerHTML='<div class="empty">Erro ao carregar painel administrativo.</div>'; return; }
  try{ const ev = await api('/api/admin/eventos', {adminAuth:true}); eventos = ev.eventos; }catch(e){}
  state.elencoAdmin = elencoAdmin;

  const rodada = state.rodadaAtual;
  let html = '<div class="card"><div class="list-row" style="border:none;padding:0;"><h2>Painel administrativo</h2><button class="btn secondary small" data-action="admin-logout">sair do admin</button></div></div>';

  html += '<div class="card"><h3>Rodada atual</h3>';
  if(rodada){
    html += '<p class="small">'+formatDataBR(rodada.data)+' — '+rodada.fase.label+'</p>';
    const confirmados = (rodada.confirmados||[]).map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
    const linhaN = confirmados.filter(j=>j.posicaoPadrao==='linha').length;
    const golN = confirmados.filter(j=>j.posicaoPadrao==='goleiro').length;
    const podeSortear = rodada.status==='aguardando_confirmacao' && rodada.fase.chave==='aguardando_sorteio';
    html += '<p class="small muted">'+linhaN+' de linha, '+golN+' goleiro(s) confirmados.</p>';
    html += '<button class="btn" data-action="disparar-sorteio" '+(podeSortear?'':'disabled')+'>Realizar sorteio</button>';
  }else{
    html += '<p class="small muted">Nenhuma rodada agendada.</p>';
  }
  html += '<div class="divider"></div>';
  html += '<div class="field"><label>Nova rodada (domingo)</label><input type="date" id="nova-rodada-data"></div>';
  html += '<button class="btn secondary" data-action="criar-rodada">Criar rodada</button></div>';

  html += '<div class="card"><h3>Critério para ativar a fase 2 (sorteio por nota)</h3>'+
    '<div class="field"><label>Mínimo de rodadas encerradas</label><input type="number" min="1" id="cfg-min-rodadas" value="'+elencoAdmin.config.minRodadas+'"></div>'+
    '<div class="field"><label>Mínimo de votos recebidos por jogador ativo</label><input type="number" min="1" id="cfg-min-votos" value="'+elencoAdmin.config.minVotos+'"></div>'+
    '<button class="btn secondary" data-action="salvar-config">Salvar critérios</button></div>';

  html += '<div class="card"><h3>Elenco</h3>';
  elencoAdmin.jogadores.forEach(j=>{
    if(state.editingJogadorId===j.id){
      html += '<div class="list-row" style="flex-direction:column;align-items:stretch;gap:6px;">'+
        '<input id="edit-nome-'+j.id+'" value="'+escapeHtml(j.nome)+'">'+
        '<input id="edit-pin-'+j.id+'" value="'+j.pin+'" maxlength="4">'+
        '<select id="edit-pos-'+j.id+'"><option value="linha" '+(j.posicaoPadrao==='linha'?'selected':'')+'>Linha</option><option value="goleiro" '+(j.posicaoPadrao==='goleiro'?'selected':'')+'>Goleiro</option></select>'+
        '<label class="small"><input type="checkbox" id="edit-ativo-'+j.id+'" '+(j.ativo?'checked':'')+'> ativo</label>'+
        '<div class="btn-row"><button class="btn small" data-action="salvar-jogador" data-id="'+j.id+'">Salvar</button>'+
        '<button class="btn secondary small" data-action="cancelar-edicao">Cancelar</button></div></div>';
    }else{
      html += '<div class="list-row"><span>'+escapeHtml(j.nome)+' <span class="badge '+(j.posicaoPadrao==='goleiro'?'gk':'')+'">'+j.posicaoPadrao+'</span>'+(j.ativo?'':' <span class="badge">inativo</span>')+'</span>'+
        '<span><button class="btn secondary small" data-action="editar-jogador" data-id="'+j.id+'">editar</button> <button class="btn danger small" data-action="remover-jogador" data-id="'+j.id+'">remover</button></span></div>';
    }
  });
  html += '<div class="divider"></div><h3>Adicionar jogador</h3>'+
    '<div class="field"><label>Nome</label><input id="novo-nome"></div>'+
    '<div class="field"><label>PIN (4 dígitos)</label><input id="novo-pin" maxlength="4"></div>'+
    '<div class="field"><label>Posição padrão</label><select id="novo-pos"><option value="linha">Linha</option><option value="goleiro">Goleiro</option></select></div>'+
    '<button class="btn secondary" data-action="adicionar-jogador">Adicionar</button></div>';

  html += '<div class="card"><h3>PIN administrativo</h3>'+
    '<div class="field"><input id="novo-admin-pin" maxlength="4" placeholder="novo PIN"></div>'+
    '<button class="btn secondary" data-action="salvar-admin-pin">Alterar PIN</button></div>';

  html += '<div class="card"><h3>Modo de teste — simular horário</h3>'+
    '<p class="small muted">Ferramenta para testar as fases em homologação sem esperar o domingo real. Afeta o site inteiro enquanto estiver ativo — desligue antes de usar de verdade.</p>'+
    '<div class="field"><input type="datetime-local" id="sim-time" value="'+(elencoAdmin.config.simuladoNow||'')+'"></div>'+
    '<div class="btn-row"><button class="btn secondary small" data-action="aplicar-sim-time">Aplicar</button>'+
    '<button class="btn secondary small" data-action="resetar-sim-time">Usar horário real</button></div>'+
    (elencoAdmin.config.simuladoNow? '<p class="small" style="color:var(--gold);margin-top:8px;">Simulando: '+elencoAdmin.config.simuladoNow.replace('T',' ')+'</p>':'')+
    '</div>';

  html += '<div class="card"><details><summary>Registro de eventos ('+eventos.length+')</summary>';
  eventos.slice(0,20).forEach(e=>{
    html += '<div class="small muted" style="padding:4px 0;border-bottom:1px solid var(--line);">'+new Date(e.ts).toLocaleString('pt-BR')+' — '+escapeHtml(e.mensagem)+'</div>';
  });
  html += '</details></div>';

  html += '<div class="card"><h3>Zerar dados de teste</h3>'+
    '<p class="small muted">Apaga todas as rodadas, confirmações, sorteios e votos para começar do zero. O elenco e os PINs são mantidos.</p>'+
    '<button class="btn danger" data-action="resetar-dados">Apagar rodadas e votos</button></div>';

  c.innerHTML = html;
}

/* ---- ações de admin ---- */
async function handleDispararSorteio(){
  try{
    await api('/api/admin/rodadas/'+state.rodadaAtual.id+'/sortear', {method:'POST', adminAuth:true});
    await refreshRodadaAtual();
    state.rodadaVisualizadaId = state.rodadaAtual.id;
    state.rodadaVisualizada = state.rodadaAtual;
    await render();
  }catch(e){ alert(e.message); }
}
async function handleCriarRodada(){
  const val = document.getElementById('nova-rodada-data').value;
  if(!val) return;
  try{
    await api('/api/admin/rodadas', {method:'POST', adminAuth:true, body:{data:val}});
    await refreshRodadaAtual();
    await refreshRodadasLista();
    await render();
  }catch(e){ alert(e.message); }
}
async function handleSalvarConfig(){
  const minRodadas = parseInt(document.getElementById('cfg-min-rodadas').value,10) || 1;
  const minVotos = parseInt(document.getElementById('cfg-min-votos').value,10) || 1;
  try{ await api('/api/admin/config', {method:'PUT', adminAuth:true, body:{minRodadas,minVotos}}); await render(); }
  catch(e){ alert(e.message); }
}
async function handleAdicionarJogador(){
  const nome = document.getElementById('novo-nome').value.trim();
  const pin = document.getElementById('novo-pin').value.trim();
  const posicaoPadrao = document.getElementById('novo-pos').value;
  try{
    await api('/api/admin/jogadores', {method:'POST', adminAuth:true, body:{nome,pin,posicaoPadrao}});
    await refreshElenco();
    await render();
  }catch(e){ alert(e.message); }
}
async function handleSalvarJogador(id){
  const nome = document.getElementById('edit-nome-'+id).value.trim();
  const pin = document.getElementById('edit-pin-'+id).value.trim();
  const posicaoPadrao = document.getElementById('edit-pos-'+id).value;
  const ativo = document.getElementById('edit-ativo-'+id).checked;
  try{
    await api('/api/admin/jogadores/'+id, {method:'PUT', adminAuth:true, body:{nome,pin,posicaoPadrao,ativo}});
    state.editingJogadorId = null;
    await refreshElenco();
    await render();
  }catch(e){ alert(e.message); }
}
async function handleRemoverJogador(id){
  if(!confirm('Remover este jogador do elenco?')) return;
  try{ await api('/api/admin/jogadores/'+id, {method:'DELETE', adminAuth:true}); await refreshElenco(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleSalvarAdminPin(){
  const pin = document.getElementById('novo-admin-pin').value.trim();
  try{ await api('/api/admin/admin-pin', {method:'PUT', adminAuth:true, body:{pin}}); alert('PIN administrativo atualizado.'); await render(); }
  catch(e){ alert(e.message); }
}
async function handleAplicarSimTime(){
  const val = document.getElementById('sim-time').value;
  if(!val) return;
  try{ await api('/api/admin/simulado', {method:'PUT', adminAuth:true, body:{simuladoNow:val}}); await refreshRodadaAtual(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleResetarSimTime(){
  try{ await api('/api/admin/simulado', {method:'PUT', adminAuth:true, body:{simuladoNow:null}}); await refreshRodadaAtual(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleResetarDados(){
  if(!confirm('Isso apaga TODAS as rodadas, confirmações, sorteios e votos (o elenco e os PINs são mantidos). Confirmar?')) return;
  try{
    await api('/api/admin/reset', {method:'POST', adminAuth:true});
    state.rodadaVisualizadaId = null; state.rodadaVisualizada = null;
    await refreshRodadaAtual();
    await refreshRodadasLista();
    await render();
  }catch(e){ alert(e.message); }
}

/* ============================================================
   POLLING
   ============================================================ */
function startPolling(){
  if(state.pollHandle) return;
  state.pollHandle = setInterval(async ()=>{
    if(!state.currentPlayer) return;
    if(['inicio','votacao','sorteio'].includes(state.tab)){
      await refreshRodadaAtual();
      await refreshRodadasLista();
      if(state.tab==='sorteio' && state.rodadaVisualizadaId && (!state.rodadaAtual || state.rodadaVisualizadaId!==state.rodadaAtual.id)){
        await carregarRodadaVisualizada(state.rodadaVisualizadaId);
      }
      render();
    }
  }, 8000);
}

/* ============================================================
   RENDER PRINCIPAL + EVENTOS
   ============================================================ */
async function render(){
  renderTopbar();
  if(!state.currentPlayer){ renderLogin(); return; }
  if(state.tab==='inicio') renderInicio();
  else if(state.tab==='sorteio') renderSorteio();
  else if(state.tab==='votacao') renderVotacao();
  else if(state.tab==='ranking') await renderRanking();
  else if(state.tab==='admin') await renderAdmin();
  else if(state.tab==='trocarPin') renderTrocarPin();
}

document.getElementById('shell').addEventListener('click', async (e)=>{
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const action = el.dataset.action;
  e.preventDefault();

  if(action==='login-digit') return handleLoginDigit(el.dataset.digit);
  if(action==='login-back'){ state.pinBuffer = state.pinBuffer.slice(0,-1); return render(); }
  if(action==='logout') return handleLogout();
  if(action==='abrir-troca-pin'){ state.trocaPinErro=''; state.tab='trocarPin'; return render(); }
  if(action==='salvar-meu-pin') return handleSalvarMeuPin();
  if(action==='cancelar-troca-pin') return handleCancelarTrocaPin();
  if(action==='tab'){ state.tab = el.dataset.tab; state.editingJogadorId=null; return render(); }
  if(action==='confirmar') return handleConfirmar();
  if(action==='desconfirmar') return handleDesconfirmar();
  if(action==='votar') return handleVotar(el.dataset.avaliado, parseInt(el.dataset.nota,10));
  if(action==='ranking-filtro'){ state.rankingFiltro = el.dataset.filtro; return render(); }
  if(action==='disparar-sorteio') return handleDispararSorteio();
  if(action==='criar-rodada') return handleCriarRodada();
  if(action==='salvar-config') return handleSalvarConfig();
  if(action==='adicionar-jogador') return handleAdicionarJogador();
  if(action==='editar-jogador'){ state.editingJogadorId = el.dataset.id; return render(); }
  if(action==='cancelar-edicao'){ state.editingJogadorId = null; return render(); }
  if(action==='salvar-jogador') return handleSalvarJogador(el.dataset.id);
  if(action==='remover-jogador') return handleRemoverJogador(el.dataset.id);
  if(action==='salvar-admin-pin') return handleSalvarAdminPin();
  if(action==='aplicar-sim-time') return handleAplicarSimTime();
  if(action==='resetar-sim-time') return handleResetarSimTime();
  if(action==='resetar-dados') return handleResetarDados();
  if(action==='admin-logout') return handleAdminLogout();
  if(action==='admin-login-digit') return handleAdminDigit(el.dataset.digit);
  if(action==='admin-login-back'){ state.adminPinBuffer = state.adminPinBuffer.slice(0,-1); return render(); }
});

document.getElementById('shell').addEventListener('change', async (e)=>{
  if(e.target.id==='mudar-rodada-visualizada'){
    await carregarRodadaVisualizada(e.target.value);
    render();
  }
});

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  document.getElementById('content').innerHTML = '<div class="empty">Carregando…</div>';
  await refreshElenco();
  await refreshRodadaAtual();
  await refreshRodadasLista();
  if(state.currentPlayer && state.token) startPolling();
  await render();
}
boot();

})();
