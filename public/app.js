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

// estados de mensalidade (valor no banco -> rótulo / emoji / classe de cor)
const MENS_INFO = {
  em_dia:    {lbl:'Em Dia',    emoji:'✅', cls:'ok'},
  em_atraso: {lbl:'Em Atraso', emoji:'⚠️', cls:'atrasada'},
  isenta:    {lbl:'Isenta',    emoji:'🆓', cls:'isenta'},
};
const MENS_OPCOES = [['','—'],['em_dia','Em Dia'],['em_atraso','Em Atraso'],['isenta','Isenta']];
function mensOptionsHtml(atual){
  return MENS_OPCOES.map(([v,l])=>'<option value="'+v+'" '+((atual||'')===v?'selected':'')+'>'+l+'</option>').join('');
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
  appVersion: null,
  ranking: {},
  homeExtras: null,
};

function jogadorNome(id){ const j = state.elenco.find(x=>x.id===id); return j ? j.nome : '?'; }
function nomeParaExibicao(id){
  if(id && id.startsWith('conv:')){
    return 'Convidado de '+jogadorNome(id.slice(5));
  }
  return jogadorNome(id);
}
function mediaDoJogador(jogadorId, papel){
  const r = state.ranking && state.ranking[jogadorId];
  return (r && r[papel]) ? r[papel].media : null;
}
function starsHtml(media, grande){
  if(media==null) return '<span class="stars-empty small muted">sem avaliações</span>';
  const pct = Math.max(0, Math.min(100, media/5*100));
  return '<span class="stars'+(grande?' stars-lg':'')+'" title="'+media.toFixed(1)+' de 5">'+
    '<span class="stars-track">'+
      '<span class="stars-bg">★★★★★</span>'+
      '<span class="stars-fg" style="width:'+pct.toFixed(1)+'%">★★★★★</span>'+
    '</span>'+
    '<span class="stars-num">'+media.toFixed(1)+'</span></span>';
}

/* ============================================================
   CARREGAMENTO DE DADOS
   ============================================================ */
async function refreshElenco(){
  try{ const data = await api('/api/elenco'); state.elenco = data.jogadores; }catch(e){}
}
async function refreshVersion(){ try{ const data = await api('/api/version'); state.appVersion = data.version; }catch(e){} }
async function refreshMe(){
  if(!state.token) return;
  try{
    const j = await api('/api/me', {auth:true});
    state.currentPlayer = Object.assign({}, state.currentPlayer, j);
    localStorage.setItem('bolerage_player', JSON.stringify(state.currentPlayer));
  }catch(e){}
}
async function refreshRanking(){ try{ const data = await api('/api/ranking'); state.ranking = data.ranking; }catch(e){} }
async function refreshHomeExtras(){ try{ state.homeExtras = await api('/api/home-extras'); }catch(e){} }
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
  document.getElementById('version-slot').textContent = '';
  const m = MENS_INFO[state.currentPlayer.mensalidade];
  const mensHtml = m
    ? '<span class="who-mens '+m.cls+'"> , sua mensalidade está = '+m.emoji+' '+m.lbl+'</span>'
    : '';
  document.getElementById('who-slot').innerHTML =
    '<span class="who-name">Olá, '+escapeHtml(state.currentPlayer.nome)+'</span>'+
    mensHtml+
    '<button data-action="abrir-troca-pin">trocar PIN</button>'+
    (state.currentPlayer.admin ? '<button data-action="abrir-admin">Admin</button>' : '')+
    '<button data-action="logout">sair</button>';
  const fase = state.rodadaAtual ? state.rodadaAtual.fase : {label:'Nenhuma rodada agendada', cor:'muted'};
  document.getElementById('phase-chip-slot').innerHTML =
    '<span class="chip '+fase.cor+'"><span class="dot"></span>'+escapeHtml(fase.label)+'</span>'+
    '<span class="app-version phase-version">'+(state.appVersion ? ('v'+state.appVersion) : '')+'</span>';

  const tabs = [
    {key:'inicio', label:'Início', icon:'<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>'},
    {key:'sorteio', label:'Sorteio', icon:'<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="12" cy="12" r="1.2"/>'},
    {key:'votacao', label:'Votação', icon:'<path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9z"/><path d="M4 9l3-5h10l3 5"/><path d="M9 13l2 2 4-4"/>'},
    {key:'ranking', label:'Ranking', icon:'<line x1="5" y1="20" x2="5" y2="13"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="19" y1="20" x2="19" y2="4"/>'},
    {key:'resenha', label:'Resenha', icon:'<path d="M20 4H8a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v4l4-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="10" y1="9" x2="16" y2="9"/>'},
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
      '<div class="sub">Digite seu PIN de 4 dígitos</div>'+
      '<div class="pin-dots">'+dots+'</div>'+
      '<div class="keypad">'+keypad+'</div>'+
      '<div class="login-error">'+escapeHtml(state.loginError)+'</div>'+
      '<div class="login-hint">Não sabe seu PIN? Peça para o administrador do grupo.</div>'+
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
function calcProgressoConfirmacao(linhaN, golN){
  // dois caminhos possíveis pra viabilizar: (10 linha + 2 goleiro) ou (12 linha no total)
  const progressoA = Math.min(linhaN/10, 1, golN/2, 1);
  const progressoB = Math.min(linhaN/12, 1);
  const progresso = Math.max(progressoA, progressoB);
  const hue = Math.round(progresso*120); // 0=vermelho, 60=amarelo, 120=verde
  return {
    progresso,
    corTexto: 'hsl('+hue+', 75%, 60%)',
    corFundo: 'hsl('+hue+', 65%, 45%)',
    viavel: progresso>=1,
  };
}
function renderMedidorConfirmacao(linhaN, golN){
  const total = linhaN+golN;
  const p = calcProgressoConfirmacao(linhaN, golN);
  return '<div class="confirm-meter">'+
    '<div class="confirm-meter-num" style="color:'+p.corTexto+'">'+total+'</div>'+
    '<div class="confirm-meter-info">'+
      '<div class="confirm-meter-track"><div class="confirm-meter-fill" style="width:'+Math.round(p.progresso*100)+'%;background:'+p.corFundo+'"></div></div>'+
      '<div class="confirm-meter-label small muted">'+linhaN+' de linha \u2022 '+golN+' goleiro(s)'+(p.viavel?' \u2014 jogo viabilizado':'')+'</div>'+
    '</div>'+
  '</div>';
}

function renderExtrasIniciais(){
  const ex = state.homeExtras;
  if(!ex) return '';
  let html = '';
  if(ex.noticia && ex.noticia.descricao){
    html += '<div class="card accent-gold"><h3>\u{1F4E2} Se Liga - Craque</h3><p class="small avisos-text">'+escapeHtml(ex.noticia.descricao)+'</p></div>';
  }
  if(ex.eventos && ex.eventos.length){
    html += '<div class="card accent-green"><h3>\u26BD Eventos</h3>';
    ex.eventos.forEach(e=>{
      html += '<div class="list-row"><span>'+escapeHtml(e.nome)+'</span><span class="badge">'+formatDataBR(e.data)+'</span></div>';
    });
    html += '</div>';
  }
  if(ex.aluguel){
    html += '<div class="card accent-orange"><h3>Dados de Pagamento - (Aluguel)</h3>'+
      '<div class="list-row"><span>Nome</span><span>'+escapeHtml(ex.aluguel.nome)+'</span></div>'+
      '<div class="list-row"><span>Chave PIX</span><span>'+escapeHtml(ex.aluguel.chavePix)+'</span></div>'+
      '<div class="list-row"><span>Mensalidade</span><span>'+escapeHtml(ex.aluguel.valorMensalidade)+'</span></div>'+
      '</div>';
  }
  if(ex.gestao){
    html += '<div class="card accent-cyan"><h3>Gestão</h3>'+
      '<div class="list-row"><span>Presidente</span><span>'+escapeHtml(ex.gestao.presidente)+'</span></div>'+
      '<div class="list-row"><span>Vice-Presidente</span><span>'+escapeHtml(ex.gestao.vicePresidente)+'</span></div>'+
      '</div>';
  }
  return html;
}

function linhaListaPresenca(j, ehConvidado){
  const media = mediaDoJogador(j.id, j.posicaoPadrao);
  return '<div class="list-row"><span>'+escapeHtml(j.nome)+'</span>'+
    '<span class="row-right">'+starsHtml(media, true)+(j.posicaoPadrao==='goleiro'?'<span class="badge gk">goleiro</span>':'<span class="badge">linha</span>')+'</span></div>'+
    (ehConvidado ? '<div class="list-row convidado-row"><span>↳ Convidado de '+escapeHtml(j.nome)+'</span></div>' : '');
}

function renderInicio(){
  const rodada = state.rodadaAtual;
  const c = document.getElementById('content');
  let dica = '';
  if(!state.mostrouDicaPin){
    dica = '<div class="info-box">Dica: você pode trocar seu PIN quando quiser clicando em "trocar PIN" no topo da tela.</div>';
    state.mostrouDicaPin = true;
  }
  const extrasHtml = renderExtrasIniciais();
  if(!rodada){
    c.innerHTML = dica+'<div class="empty">Nenhuma rodada agendada ainda.<br>Peça para o administrador criar a próxima rodada.</div>'+extrasHtml;
    return;
  }
  const fase = rodada.fase;
  const presentesIds = rodada.confirmados || [];
  const ausentesIds = rodada.ausentes || [];
  const convidadosDeIds = new Set(rodada.convidados || []);
  const presentes = presentesIds.map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
  const ausentes = ausentesIds.map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
  const meuStatus = presentesIds.includes(state.currentPlayer.id) ? 'presente'
    : ausentesIds.includes(state.currentPlayer.id) ? 'ausente' : null;
  const euTrouxeConvidado = convidadosDeIds.has(state.currentPlayer.id);
  const linhaN = presentes.filter(j=>j.posicaoPadrao==='linha').length + convidadosDeIds.size;
  const golN = presentes.filter(j=>j.posicaoPadrao==='goleiro').length;

  let html = '<div class="card accent-blue"><h2>Rodada de '+formatDataBR(rodada.data)+'</h2>';

  if(fase.chave==='pre_confirmacao'){
    html += '<p class="muted small">A confirmação de presença ainda não foi aberta. Ela abre no sábado às 8hrs e fecha no domingo às 8hrs.</p>';
  }
  if(fase.chave==='confirmacao_aberta'){
    html += renderMedidorConfirmacao(linhaN, golN);
    html += renderTogglePresenca(meuStatus);
    if(meuStatus==='presente') html += renderToggleConvidado(euTrouxeConvidado);
    if(meuStatus==='presente') html += renderToggleResenha((rodada.resenha||[]).includes(state.currentPlayer.id));
  }
  if(fase.chave==='aguardando_sorteio'){
    html += renderMedidorConfirmacao(linhaN, golN);
    html += '<p class="muted small">Aguardando o administrador realizar o sorteio (automático às 8h05, ou manual pelo admin).</p>';
  }
  if(fase.chave==='nao_viabilizado'){
    html += '<p class="small">Apenas '+linhaN+' jogador(es) de linha (incluindo convidados) e '+golN+' goleiro(s) confirmaram presença. Mínimo necessário: 10 de linha + 2 goleiros, ou 12 de linha no total.</p>';
  }

  if(['aguardando_sorteio','nao_viabilizado'].includes(fase.chave) || (fase.chave==='confirmacao_aberta')){
    html += '<div class="divider"></div>';
    html += '<h3>Presentes ('+(presentes.length+convidadosDeIds.size)+')</h3>';
    if(presentes.length){
      presentes.forEach(j=> html += linhaListaPresenca(j, convidadosDeIds.has(j.id)));
    }else{
      html += '<p class="small muted">Ninguém confirmou presença ainda.</p>';
    }
    html += '<h3 style="margin-top:14px;">Ausentes ('+ausentes.length+')</h3>';
    if(ausentes.length){
      ausentes.forEach(j=> html += linhaListaPresenca(j, false));
    }else{
      html += '<p class="small muted">Ninguém marcou ausência ainda.</p>';
    }
  }

  if(rodada.status==='sorteado'){
    const meuTime = rodada.times.times.find(t=>t.jogadores.some(j=>j.jogadorId===state.currentPlayer.id));
    const souReserva = rodada.times.reservas.includes(state.currentPlayer.id);
    html += meuTime
      ? '<p class="small">Você está no time <strong>'+meuTime.nome+'</strong>. Veja a formação completa na aba Sorteio.</p>'
      : souReserva
        ? '<p class="small">Você ficou como <strong>reserva</strong> nesta rodada, mas pode votar e receber votos normalmente.</p>'
        : '<p class="small muted">Você não participou desta rodada.</p>';
    if(fase.chave==='votacao_aberta' && (meuTime || souReserva)){
      const jaVotouEm = new Set(rodada.votos.filter(v=>v.avaliadorId===state.currentPlayer.id).map(v=>v.avaliadoId));
      const alvos = [...rodada.times.times.flatMap(t=>t.jogadores.map(j=>j.jogadorId)), ...rodada.times.reservas]
        .filter(id=>id!==state.currentPlayer.id && !id.startsWith('conv:'));
      const faltam = alvos.filter(a=>!jaVotouEm.has(a)).length;
      html += '<p class="small">Votação aberta até as 18h. Faltam avaliar '+faltam+' colega(s). <a href="#" data-action="tab" data-tab="votacao">Ir para votação →</a></p>';
    }
    if(fase.chave==='encerrada'){
      html += '<p class="small muted">A rodada encerrou. Veja o ranking atualizado na aba Ranking.</p>';
    }
  }
  html += '</div>';
  c.innerHTML = dica + html + extrasHtml;
}

function renderTogglePresenca(meuStatus){
  const ligado = meuStatus==='presente';
  const desligado = meuStatus==='ausente';
  const classe = ligado ? 'is-on' : (desligado ? 'is-off' : 'is-pending');
  const label = ligado
    ? '<strong style="color:var(--green)">Presente</strong> — vou jogar'
    : desligado
      ? '<strong style="color:var(--red)">Ausente</strong> — não vou jogar'
      : '<span class="muted">Toque para dizer se você vai jogar</span>';
  return '<div class="presence-toggle-wrap">'+
    '<button class="presence-toggle '+classe+'" data-action="toggle-presenca" data-atual="'+(meuStatus||'')+'"><span class="presence-toggle-knob"></span></button>'+
    '<div class="presence-toggle-label">'+label+'</div>'+
  '</div>';
}

function renderToggleConvidado(euTrouxeConvidado){
  return '<div class="presence-toggle-wrap" style="margin-top:10px;">'+
    '<button class="presence-toggle '+(euTrouxeConvidado?'is-on':'is-off')+'" data-action="toggle-convidado" data-atual="'+(euTrouxeConvidado?'sim':'nao')+'"><span class="presence-toggle-knob"></span></button>'+
    '<div class="presence-toggle-label">'+(euTrouxeConvidado
      ? '<strong style="color:var(--green)">Convidado: sim</strong> — vou levar alguém'
      : '<span class="muted">Convidado: não</span> — vou sozinho')+'</div>'+
  '</div>';
}
async function handleToggleConvidado(atual){
  const novo = atual!=='sim';
  try{
    await api('/api/rodadas/'+state.rodadaAtual.id+'/convidado', {method:'POST', auth:true, body:{trouxeConvidado:novo}});
    await refreshRodadaAtual();
    render();
  }catch(e){ alert(e.message); }
}

function renderToggleResenha(euResenha){
  return '<div class="presence-toggle-wrap" style="margin-top:10px;">'+
    '<button class="presence-toggle '+(euResenha?'is-on':'is-off')+'" data-action="toggle-resenha" data-atual="'+(euResenha?'sim':'nao')+'"><span class="presence-toggle-knob"></span></button>'+
    '<div class="presence-toggle-label">'+(euResenha
      ? '<strong style="color:var(--green)">Resenha: sim</strong> — vou ficar pra resenha'
      : '<span class="muted">Resenha: não</span> — não vou ficar')+'</div>'+
  '</div>';
}
async function handleToggleResenha(atual){
  const novo = atual!=='sim';
  try{
    await api('/api/rodadas/'+state.rodadaAtual.id+'/resenha', {method:'POST', auth:true, body:{resenha:novo}});
    await refreshRodadaAtual();
    render();
  }catch(e){ alert(e.message); }
}

async function handleTogglePresenca(atual){
  const novo = atual==='presente' ? 'ausente' : 'presente';
  try{
    await api('/api/rodadas/'+state.rodadaAtual.id+'/presenca', {method:'POST', auth:true, body:{status:novo}});
    await refreshRodadaAtual();
    render();
  }catch(e){ alert(e.message); }
}

/* ============================================================
   RENDER: TAB RESENHA
   ============================================================ */
function renderResenha(){
  const c = document.getElementById('content');
  const rod = state.rodadaAtual;
  if(!rod){
    c.innerHTML = '<div class="empty">Nenhuma rodada agendada ainda.</div>'; return;
  }
  const meuId = state.currentPlayer.id;
  const idsResenha = rod.resenha || [];
  const gente = idsResenha.map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
  const euNaResenha = idsResenha.includes(meuId);
  const souPresente = (rod.confirmados||[]).includes(meuId);
  const janelaLivre = !!rod.resenhaEdicaoLivre;
  const rachaAconteceu = rod.status==='sorteado';
  const podeEditar = janelaLivre && (souPresente || rachaAconteceu);

  let aviso;
  if(janelaLivre){
    aviso = souPresente
      ? 'Você pode ajustar sua presença na resenha com churras agora, até as 11h.'
      : (rachaAconteceu
          ? 'A resenha com churras está aberta para entrada de última hora, até as 11h.'
          : 'Entrada de última hora só vale para rodada que teve jogo.');
  }else{
    aviso = 'O flag da resenha fica em modo leitura durante todo o período da confirmação de sábado 8hrs até domingo 8hrs, quando você ativa pela tela de início. Das 10hrs às 11hrs do domingo o status fica liberado para movimentação por esta tela.';
  }

  let html = '<div class="card"><h2>Resenha com Churras — '+formatDataBR(rod.data)+'</h2>'+
    '<p class="small muted">'+aviso+'</p></div>';

  html += '<div class="card"><h3>Sua resenha</h3>'+
    '<div class="presence-toggle-wrap">'+
      '<button class="presence-toggle '+(euNaResenha?'is-on':'is-off')+'" '+(podeEditar?'':'disabled')+' data-action="toggle-resenha" data-atual="'+(euNaResenha?'sim':'nao')+'"><span class="presence-toggle-knob"></span></button>'+
      '<div class="presence-toggle-label">'+(euNaResenha
        ? '<strong style="color:var(--green)">Você está na resenha</strong>'
        : '<span class="muted">Você não está na resenha</span>')+'</div>'+
    '</div>'+
    (podeEditar ? '' : '<p class="small muted" style="margin-top:6px;">Somente leitura no momento.</p>')+
  '</div>';

  html += '<div class="card"><h3>Confirmados na resenha com churras ('+gente.length+')</h3>';
  if(gente.length){
    gente.forEach(j=> html += '<div class="list-row"><span>'+escapeHtml(j.nome)+'</span><span class="badge" style="color:var(--green);border-color:#2c6b3c;">ON</span></div>');
  }else{
    html += '<p class="small muted">Ninguém na resenha ainda.</p>';
  }
  html += '</div>';
  c.innerHTML = html;
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
      html += '<div class="list-row"><span>'+escapeHtml(nomeParaExibicao(j.jogadorId))+'</span>'+(j.papel==='goleiro'?'<span class="badge gk">goleiro</span>':'<span class="badge">linha</span>')+'</div>';
    });
    html += '</div>';
  });
  if(rod.times.reservas && rod.times.reservas.length){
    html += '<div class="card"><h3>Reservas desta rodada</h3>';
    rod.times.reservas.forEach(id=> html += '<div class="list-row"><span>'+escapeHtml(nomeParaExibicao(id))+'</span></div>');
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
  const meuId = state.currentPlayer.id;
  const participei = rod.times.times.some(t=>t.jogadores.some(j=>j.jogadorId===meuId)) || rod.times.reservas.includes(meuId);
  if(!participei){
    c.innerHTML = '<div class="empty">Você não participou desta rodada (nem escalado, nem reserva) e por isso não pode votar.</div>'; return;
  }
  const alvosTimes = rod.times.times.flatMap(t=>t.jogadores.map(j2=>({jogadorId:j2.jogadorId, time:t.nome})));
  const alvosReservas = rod.times.reservas.map(id=>({jogadorId:id, time:'Reserva'}));
  const alvos = [...alvosTimes, ...alvosReservas].filter(a=>a.jogadorId!==meuId && !a.jogadorId.startsWith('conv:'));
  const meusVotos = {};
  rod.votos.filter(v=>v.avaliadorId===meuId).forEach(v=>meusVotos[v.avaliadoId]=v.nota);

  let html = '<div class="card"><p class="small">Avalie a performance de quem jogou hoje, de 1 a 5 estrelas. O voto é definitivo assim que salvo.</p></div>';
  alvos.forEach(a=>{
    const notaAtual = meusVotos[a.jogadorId];
    const travado = notaAtual!=null;
    html += '<div class="card"><div class="list-row" style="border:none;padding:0 0 4px 0;"><span>'+escapeHtml(nomeParaExibicao(a.jogadorId))+' <span class="badge">'+a.time+'</span></span></div>';
    html += '<div class="vote-scale">';
    for(let n=1;n<=5;n++){
      html += '<button class="vote-btn star-vote-btn '+(travado && n<=notaAtual?'selected':'')+'" '+(travado?'disabled':'')+' data-action="votar" data-avaliado="'+a.jogadorId+'" data-nota="'+n+'">★</button>';
    }
    html += '</div>'+(travado?'<p class="small muted" style="margin-top:6px;">Voto salvo: '+notaAtual+' estrela(s) — não pode ser alterado.</p>':'')+'</div>';
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
  await refreshRanking();
  const ranking = state.ranking;
  const papel = state.rankingFiltro;
  const linhas = state.elenco.filter(j=>j.ativo && j.posicaoPadrao===papel).map(j=>{
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
      '<div class="rank-count">'+l.total+' avaliação(ões)</div></div><div class="rank-avg">'+starsHtml(l.media, true)+'</div></div>';
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
  state.tab='inicio';
  render();
}

async function renderAdmin(){
  const c = document.getElementById('content');
  if(!state.currentPlayer || !state.currentPlayer.admin){
    c.innerHTML = '<div class="empty">Área restrita à administração.</div>'; return;
  }
  if(!state.isAdmin){
    try{
      const data = await api('/api/admin/enter', {method:'POST', auth:true});
      state.adminToken = data.adminToken; state.isAdmin = true;
      localStorage.setItem('bolerage_admin_token', data.adminToken);
    }catch(e){
      c.innerHTML = '<div class="empty">Não foi possível abrir o painel: '+escapeHtml(e.message||'')+'</div>'; return;
    }
  }
  const isSuper = !!state.currentPlayer.superAdmin;
  const permsMe = state.currentPlayer.perms || [];
  const can = p => isSuper || permsMe.includes(p);
  const permLabel = p => p==='conteudo' ? 'Conteúdo da tela inicial' : p==='mensalidades' ? 'Mensalidades' : p;
  const on401 = e => { if(e && e.status===401){ state.isAdmin=false; state.adminToken=null; localStorage.removeItem('bolerage_admin_token'); render(); return true; } return false; };

  let elencoAdmin=null, eventos=[], permsDisp=['conteudo','mensalidades'];
  let agenda=[], noticia={descricao:'',ativo:false}, aluguel={nome:'',chavePix:'',valorMensalidade:'',ativo:false}, gestao={presidente:'',vicePresidente:'',ativo:false};
  let mensalPlayers=[];
  if(isSuper){
    try{ elencoAdmin = await api('/api/admin/elenco', {adminAuth:true}); permsDisp = elencoAdmin.permsDisponiveis || permsDisp; }
    catch(e){ if(on401(e)) return; c.innerHTML='<div class="empty">Erro ao carregar o elenco.</div>'; return; }
    try{ eventos = (await api('/api/admin/eventos', {adminAuth:true})).eventos; }catch(e){ if(on401(e)) return; }
  }
  if(can('conteudo')){
    try{ agenda = (await api('/api/admin/agenda', {adminAuth:true})).eventos; }catch(e){ if(on401(e)) return; }
    try{ noticia = await api('/api/admin/noticia', {adminAuth:true}); }catch(e){ if(on401(e)) return; }
    try{ aluguel = await api('/api/admin/aluguel', {adminAuth:true}); }catch(e){ if(on401(e)) return; }
    try{ gestao = await api('/api/admin/gestao', {adminAuth:true}); }catch(e){ if(on401(e)) return; }
  }
  if(can('mensalidades') && !isSuper){
    try{ mensalPlayers = (await api('/api/admin/mensalidades', {adminAuth:true})).jogadores; }catch(e){ if(on401(e)) return; }
  }
  if(elencoAdmin) state.elencoAdmin = elencoAdmin;

  const rodada = state.rodadaAtual;
  const papelLabel = isSuper ? 'Super Admin' : ('Admin — '+(permsMe.length ? permsMe.map(permLabel).join(', ') : 'sem áreas atribuídas'));
  let html = '<div class="card"><div class="list-row" style="border:none;padding:0;"><span><h2 style="margin:0;">Painel administrativo</h2><span class="small muted">'+escapeHtml(papelLabel)+'</span></span><button class="btn secondary small" data-action="admin-logout">sair do admin</button></div></div>';

  if(isSuper){
  html += '<div class="card"><h3>Rodada atual</h3>';
  if(rodada){
    html += '<p class="small">'+formatDataBR(rodada.data)+' — '+rodada.fase.label+'</p>';
    const confirmados = (rodada.confirmados||[]).map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
    const linhaN = confirmados.filter(j=>j.posicaoPadrao==='linha').length;
    const golN = confirmados.filter(j=>j.posicaoPadrao==='goleiro').length;
    const podeSortear = rodada.status==='aguardando_confirmacao' && rodada.fase.chave==='aguardando_sorteio';
    html += '<p class="small muted">'+linhaN+' de linha, '+golN+' goleiro(s) confirmados.</p>';
    html += '<button class="btn" data-action="disparar-sorteio" '+(podeSortear?'':'disabled')+'>Realizar sorteio</button>';
    const ehHistorico = rodada.fase.chave==='encerrada' || rodada.status==='nao_viabilizado';
    html += '<button class="btn danger" style="margin-top:8px;" data-action="remover-rodada" data-id="'+rodada.id+'" data-data="'+rodada.data+'" data-fase="'+escapeHtml(rodada.fase.label)+'" data-hist="'+(ehHistorico?'1':'0')+'">Remover esta rodada'+(ehHistorico?' (histórico)':'')+'</button>';
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
        (j.superAdmin
          ? '<div class="small muted">Super Admin — acesso total, não editável aqui.</div>'
          : '<label class="small"><input type="checkbox" id="edit-admin-'+j.id+'" '+(j.admin?'checked':'')+'> acesso admin</label>'+
            '<div class="small muted" style="margin-top:2px;">Áreas do acesso admin:</div>'+
            permsDisp.map(p=>'<label class="small" style="margin-left:12px;"><input type="checkbox" id="edit-perm-'+p+'-'+j.id+'" '+((j.adminPerms||[]).includes(p)?'checked':'')+'> '+permLabel(p)+'</label>').join(''))+
        '<label class="small">Mensalidade: <select id="edit-mens-'+j.id+'">'+mensOptionsHtml(j.mensalidade)+'</select></label>'+
        '<div class="btn-row"><button class="btn small" data-action="salvar-jogador" data-id="'+j.id+'">Salvar</button>'+
        '<button class="btn secondary small" data-action="cancelar-edicao">Cancelar</button></div></div>';
    }else{
      html += '<div class="list-row"><span>'+escapeHtml(j.nome)+' <span class="badge '+(j.posicaoPadrao==='goleiro'?'gk':'')+'">'+j.posicaoPadrao+'</span>'+
        (j.superAdmin?' <span class="badge gk">super</span>':(j.admin?' <span class="badge gk">admin</span>':''))+
        (MENS_INFO[j.mensalidade]?' <span class="badge mens-'+MENS_INFO[j.mensalidade].cls+'">'+MENS_INFO[j.mensalidade].emoji+' '+MENS_INFO[j.mensalidade].lbl+'</span>':'')+
        (j.ativo?'':' <span class="badge">inativo</span>')+'</span>'+
        '<span><button class="btn secondary small" data-action="editar-jogador" data-id="'+j.id+'">editar</button> '+
        (j.superAdmin?'':'<button class="btn danger small" data-action="remover-jogador" data-id="'+j.id+'">remover</button>')+'</span></div>';
    }
  });
  html += '<div class="divider"></div><h3>Adicionar jogador</h3>'+
    '<div class="field"><label>Nome</label><input id="novo-nome"></div>'+
    '<div class="field"><label>PIN (4 dígitos)</label><input id="novo-pin" maxlength="4"></div>'+
    '<div class="field"><label>Posição padrão</label><select id="novo-pos"><option value="linha">Linha</option><option value="goleiro">Goleiro</option></select></div>'+
    '<button class="btn secondary" data-action="adicionar-jogador">Adicionar</button></div>';
  } /* fim isSuper (rodada / critérios / elenco) */

  if(can('conteudo')){
  html += '<div class="card"><h3>Agenda de eventos (tela inicial)</h3>';
  agenda.forEach(e=>{
    html += '<div class="list-row"><span>'+escapeHtml(e.nome)+' <span class="badge">'+formatDataBR(e.data)+'</span>'+(e.ativo?'':' <span class="badge">inativo</span>')+'</span>'+
      '<span><button class="btn secondary small" data-action="toggle-evento-ativo" data-id="'+e.id+'" data-ativo="'+(e.ativo?'1':'0')+'">'+(e.ativo?'desativar':'ativar')+'</button> '+
      '<button class="btn danger small" data-action="remover-evento" data-id="'+e.id+'">remover</button></span></div>';
  });
  html += '<div class="divider"></div>'+
    '<div class="field"><label>Nome do evento</label><input id="novo-evento-nome"></div>'+
    '<div class="field"><label>Data</label><input type="date" id="novo-evento-data"></div>'+
    '<button class="btn secondary" data-action="adicionar-evento">Adicionar evento</button></div>';

  html += '<div class="card"><h3>Notícia (tela inicial)</h3>'+
    '<div class="field"><label>Descrição</label><textarea id="noticia-descricao" rows="3" style="width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg-elevated-2);color:var(--text);font-family:var(--font-body);font-size:14.5px;">'+escapeHtml(noticia.descricao)+'</textarea></div>'+
    '<label class="small"><input type="checkbox" id="noticia-ativo" '+(noticia.ativo?'checked':'')+'> exibir na tela inicial</label>'+
    '<button class="btn secondary" style="margin-top:10px;" data-action="salvar-noticia">Salvar notícia</button></div>';

  html += '<div class="card"><h3>Aluguel da quadra (tela inicial)</h3>'+
    '<div class="field"><label>Responsável</label><input id="aluguel-nome" value="'+escapeHtml(aluguel.nome)+'"></div>'+
    '<div class="field"><label>Chave PIX</label><input id="aluguel-pix" value="'+escapeHtml(aluguel.chavePix)+'"></div>'+
    '<div class="field"><label>Valor da mensalidade</label><input id="aluguel-valor" value="'+escapeHtml(aluguel.valorMensalidade)+'"></div>'+
    '<label class="small"><input type="checkbox" id="aluguel-ativo" '+(aluguel.ativo?'checked':'')+'> exibir na tela inicial</label>'+
    '<button class="btn secondary" style="margin-top:10px;" data-action="salvar-aluguel">Salvar aluguel</button></div>';

  html += '<div class="card"><h3>Gestão (tela inicial)</h3>'+
    '<div class="field"><label>Presidente</label><input id="gestao-presidente" value="'+escapeHtml(gestao.presidente)+'"></div>'+
    '<div class="field"><label>Vice-Presidente</label><input id="gestao-vice" value="'+escapeHtml(gestao.vicePresidente)+'"></div>'+
    '<label class="small"><input type="checkbox" id="gestao-ativo" '+(gestao.ativo?'checked':'')+'> exibir na tela inicial</label>'+
    '<button class="btn secondary" style="margin-top:10px;" data-action="salvar-gestao">Salvar gestão</button></div>';
  } /* fim can(conteudo) */

  if(can('mensalidades') && !isSuper){
    html += '<div class="card"><h3>Mensalidades</h3>'+
      '<p class="small muted">Marque cada jogador. Aparece na tela Início de cada um como selo verde (OK) ou vermelho (Atrasada).</p>';
    mensalPlayers.forEach(j=>{
      html += '<div class="list-row"><span>'+escapeHtml(j.nome)+'</span>'+
        '<select data-action="salvar-mensalidade" data-id="'+j.id+'">'+mensOptionsHtml(j.mensalidade)+'</select></div>';
    });
    html += '</div>';
  }

  if(isSuper){
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

  html += '<div class="card"><h3>Zerar rodada de teste</h3>'+
    '<p class="small muted">Apaga confirmações, sorteio e votos de rodadas que AINDA NÃO ENCERRARAM (em teste ou em andamento). Rodadas já encerradas ficam intocadas — o histórico real nunca é apagado por aqui. O elenco e os PINs também são mantidos.</p>'+
    '<button class="btn danger" data-action="resetar-dados">Apagar rodada em teste</button></div>';
  } /* fim isSuper (modo teste / log / zerar) */

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
async function handleRemoverRodada(id, dataStr, faseLabel, ehHistorico){
  if(!confirm('Remover a rodada de '+formatDataBR(dataStr)+' ('+faseLabel+')?\n\nIsso apaga em definitivo as confirmações, o sorteio e os votos dessa rodada.')) return;
  if(ehHistorico && !confirm('ATENÇÃO: essa rodada já é HISTÓRICO.\nRemover apaga PARA SEMPRE os votos e o sorteio desse domingo, e ele deixa de contar no ranking. Não dá para desfazer.\n\nConfirmar mesmo assim?')) return;
  try{
    await api('/api/admin/rodadas/'+id, {method:'DELETE', adminAuth:true, body:{confirmarHistorico:!!ehHistorico}});
    state.rodadaVisualizadaId = null; state.rodadaVisualizada = null;
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
  const body = {nome,pin,posicaoPadrao,ativo};
  const adminEl = document.getElementById('edit-admin-'+id);
  if(adminEl){
    body.admin = adminEl.checked;
    body.adminPerms = ['conteudo','mensalidades'].filter(p=>{
      const el = document.getElementById('edit-perm-'+p+'-'+id);
      return el && el.checked;
    });
  }
  const mensEl = document.getElementById('edit-mens-'+id);
  if(mensEl) body.mensalidade = mensEl.value;
  try{
    await api('/api/admin/jogadores/'+id, {method:'PUT', adminAuth:true, body});
    state.editingJogadorId = null;
    await refreshElenco();
    await render();
  }catch(e){ alert(e.message); }
}
async function handleSalvarMensalidade(id, valor){
  try{ await api('/api/admin/jogadores/'+id+'/mensalidade', {method:'PUT', adminAuth:true, body:{mensalidade:valor}}); }
  catch(e){ alert(e.message); }
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
async function handleAdicionarEvento(){
  const nome = document.getElementById('novo-evento-nome').value.trim();
  const data = document.getElementById('novo-evento-data').value;
  if(!nome || !data){ alert('Informe nome e data.'); return; }
  try{ await api('/api/admin/agenda', {method:'POST', adminAuth:true, body:{nome,data}}); await refreshHomeExtras(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleToggleEventoAtivo(id, ativoAtual){
  try{ await api('/api/admin/agenda/'+id, {method:'PUT', adminAuth:true, body:{ativo: ativoAtual!=='1'}}); await refreshHomeExtras(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleRemoverEvento(id){
  if(!confirm('Remover este evento?')) return;
  try{ await api('/api/admin/agenda/'+id, {method:'DELETE', adminAuth:true}); await refreshHomeExtras(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleSalvarNoticia(){
  const descricao = document.getElementById('noticia-descricao').value;
  const ativo = document.getElementById('noticia-ativo').checked;
  try{ await api('/api/admin/noticia', {method:'PUT', adminAuth:true, body:{descricao,ativo}}); await refreshHomeExtras(); alert('Notícia salva.'); await render(); }
  catch(e){ alert(e.message); }
}
async function handleSalvarGestao(){
  const presidente = document.getElementById('gestao-presidente').value;
  const vicePresidente = document.getElementById('gestao-vice').value;
  const ativo = document.getElementById('gestao-ativo').checked;
  try{ await api('/api/admin/gestao', {method:'PUT', adminAuth:true, body:{presidente,vicePresidente,ativo}}); await refreshHomeExtras(); alert('Gestão salva.'); await render(); }
  catch(e){ alert(e.message); }
}
async function handleSalvarAluguel(){
  const nome = document.getElementById('aluguel-nome').value;
  const chavePix = document.getElementById('aluguel-pix').value;
  const valorMensalidade = document.getElementById('aluguel-valor').value;
  const ativo = document.getElementById('aluguel-ativo').checked;
  try{ await api('/api/admin/aluguel', {method:'PUT', adminAuth:true, body:{nome,chavePix,valorMensalidade,ativo}}); await refreshHomeExtras(); alert('Aluguel da quadra salvo.'); await render(); }
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
  if(!confirm('Isso apaga confirmações, sorteio e votos de rodadas AINDA NÃO ENCERRADAS (elenco, PINs e histórico de rodadas já encerradas são mantidos). Confirmar?')) return;
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
    if(['inicio','votacao','sorteio','resenha'].includes(state.tab)){
      await refreshRodadaAtual();
      await refreshRodadasLista();
      if(state.tab==='inicio'){ await refreshRanking(); await refreshHomeExtras(); }
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
  else if(state.tab==='resenha') renderResenha();
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
  if(action==='toggle-presenca') return handleTogglePresenca(el.dataset.atual);
  if(action==='toggle-convidado') return handleToggleConvidado(el.dataset.atual);
  if(action==='toggle-resenha') return handleToggleResenha(el.dataset.atual);
  if(action==='abrir-admin'){ state.tab='admin'; state.editingJogadorId=null; return render(); }
  if(action==='votar') return handleVotar(el.dataset.avaliado, parseInt(el.dataset.nota,10));
  if(action==='ranking-filtro'){ state.rankingFiltro = el.dataset.filtro; return render(); }
  if(action==='disparar-sorteio') return handleDispararSorteio();
  if(action==='criar-rodada') return handleCriarRodada();
  if(action==='remover-rodada') return handleRemoverRodada(el.dataset.id, el.dataset.data, el.dataset.fase, el.dataset.hist==='1');
  if(action==='salvar-config') return handleSalvarConfig();
  if(action==='adicionar-jogador') return handleAdicionarJogador();
  if(action==='editar-jogador'){ state.editingJogadorId = el.dataset.id; return render(); }
  if(action==='cancelar-edicao'){ state.editingJogadorId = null; return render(); }
  if(action==='salvar-jogador') return handleSalvarJogador(el.dataset.id);
  if(action==='remover-jogador') return handleRemoverJogador(el.dataset.id);
  if(action==='salvar-admin-pin') return handleSalvarAdminPin();
  if(action==='adicionar-evento') return handleAdicionarEvento();
  if(action==='toggle-evento-ativo') return handleToggleEventoAtivo(el.dataset.id, el.dataset.ativo);
  if(action==='remover-evento') return handleRemoverEvento(el.dataset.id);
  if(action==='salvar-noticia') return handleSalvarNoticia();
  if(action==='salvar-aluguel') return handleSalvarAluguel();
  if(action==='salvar-gestao') return handleSalvarGestao();
  if(action==='aplicar-sim-time') return handleAplicarSimTime();
  if(action==='resetar-sim-time') return handleResetarSimTime();
  if(action==='resetar-dados') return handleResetarDados();
  if(action==='admin-logout') return handleAdminLogout();
  if(action==='admin-login-digit') return handleAdminDigit(el.dataset.digit);
  if(action==='admin-login-back'){ state.adminPinBuffer = state.adminPinBuffer.slice(0,-1); return render(); }
});

document.getElementById('shell').addEventListener('change', async (e)=>{
  if(e.target.dataset.action==='mudar-rodada-visualizada'){
    await carregarRodadaVisualizada(e.target.value);
    render();
  }
  if(e.target.dataset.action==='salvar-mensalidade'){
    await handleSalvarMensalidade(e.target.dataset.id, e.target.value);
  }
});

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  document.getElementById('content').innerHTML = '<div class="empty">Carregando…</div>';
  await refreshVersion();
  await refreshMe();
  await refreshElenco();
  await refreshRodadaAtual();
  await refreshRodadasLista();
  await refreshRanking();
  await refreshHomeExtras();
  if(state.currentPlayer && state.token) startPolling();
  await render();
}
boot();

})();
