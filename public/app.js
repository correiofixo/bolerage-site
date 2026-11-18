(function(){
'use strict';

/* ============================================================
   CLIENTE DA API
   ============================================================ */
async function api(path, opts={}){
  const headers = {'Content-Type':'application/json'};
  if(opts.auth && state.token) headers.Authorization = 'Bearer '+state.token;
  const usouTokenJogador = !!(opts.adminAuth && !state.adminToken && state.token);
  if(opts.adminAuth && state.adminToken) headers.Authorization = 'Bearer '+state.adminToken;
  else if(usouTokenJogador) headers.Authorization = 'Bearer '+state.token;
  const res = await fetch(path, {
    method: opts.method||'GET',
    headers,
    body: opts.body!=null ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try{ data = await res.json(); }catch(e){}
  if(res.status===401){
    if(opts.adminAuth){ state.adminToken=null; state.isAdmin=false; localStorage.removeItem('bolerage_admin_token'); }
    if(opts.auth || usouTokenJogador){ state.token=null; state.currentPlayer=null; localStorage.removeItem('bolerage_token'); localStorage.removeItem('bolerage_player'); }
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

let toastTimer = null;
function showToast(msg){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 2200);
}
async function handleCopiarPix(pix){
  if(!pix) return;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(pix);
    }else{
      // fallback para navegadores/contextos sem Clipboard API (ex.: http sem TLS)
      const ta = document.createElement('textarea');
      ta.value = pix; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast('Código copiado para pagamento');
  }catch(e){
    showToast('Não foi possível copiar. Copie manualmente.');
  }
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

// time do coração do jogador -> escudo exibido ao lado do nome (imagem pequena,
// fundo recortado, em public/assets/times/).
const TIME_CORACAO_INFO = {
  saopaulo:   {lbl:'São Paulo',   img:'/assets/times/saopaulo.png'},
  santos:     {lbl:'Santos',      img:'/assets/times/santos.png'},
  corinthians:{lbl:'Corinthians', img:'/assets/times/corinthians.png'},
  palmeiras:  {lbl:'Palmeiras',   img:'/assets/times/palmeiras.png'},
};
const TIME_CORACAO_OPCOES = [['','— nenhum —'],['saopaulo','São Paulo'],['santos','Santos'],['corinthians','Corinthians'],['palmeiras','Palmeiras']];
function timeCoracaoOptionsHtml(atual){
  return TIME_CORACAO_OPCOES.map(([v,l])=>'<option value="'+v+'" '+((atual||'')===v?'selected':'')+'>'+l+'</option>').join('');
}
// Retorna HTML (não escapado!) — sempre concatenar DEPOIS do escapeHtml(nome),
// nunca por dentro, senão a tag <img> vira texto escapado na tela.
function timeCoracaoSuffix(timeCoracao){
  const info = TIME_CORACAO_INFO[timeCoracao];
  // width/height fixos + decoding="async": evita que o navegador fique
  // recalculando layout/decodificando a imagem de novo a cada re-render
  // (era isso que fazia os escudos "piscarem" ao rolar a tela).
  return info ? ' <img class="time-coracao-badge" src="'+info.img+'" width="22" height="22" decoding="async" alt="'+info.lbl+'" title="'+info.lbl+'">' : '';
}
// idem, mas a partir do id do jogador (resolve o time do coração do próprio
// jogador, ou do "dono" quando id é um convidado "conv:<hostId>").
function timeCoracaoSuffixDoId(id){
  if(!id) return '';
  const realId = String(id).startsWith('conv:') ? id.slice(5) : id;
  const j = state.elenco.find(x=>x.id===realId);
  return j ? timeCoracaoSuffix(j.timeCoracao) : '';
}
function saudacao(){
  const h = new Date().getHours();
  return h < 12 ? 'Bom Dia' : h < 18 ? 'Boa Tarde' : 'Boa Noite';
}
// link wa.me a partir de um telefone digitado livremente (assume Brasil se sem código de país)
function waLink(tel){
  const d = String(tel||'').replace(/\D/g,'');
  if(d.length < 10) return '';
  return 'https://wa.me/' + (d.length <= 11 ? '55'+d : d);
}
const WA_ICON = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.09c-.24.68-1.42 1.31-1.96 1.36-.5.05-.99.24-3.37-.7-2.85-1.12-4.66-4.03-4.8-4.22-.14-.19-1.15-1.53-1.15-2.92s.73-2.07.99-2.35c.26-.28.57-.35.76-.35h.55c.18 0 .42-.07.65.5.24.58.81 2 .88 2.15.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.17.28.74 1.22 1.59 1.98 1.1.98 2.02 1.28 2.3 1.42.28.14.45.12.61-.07.17-.19.71-.83.9-1.11.19-.28.38-.24.64-.14.26.09 1.66.78 1.94.93.28.14.47.21.54.32.07.12.07.68-.17 1.36z"/></svg>';

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
  editingJogadorId: null,
  editingEventoId: null,
  adminWhats: '',
  trocaPinErro: '',
  mostrouDicaPin: false,
  pollHandle: null,
  appVersion: null,
  ranking: {},
  rankingBola: {cheia:{}, murcha:{}},
  rankingAba: 'geral',
  votacaoAba: 'votar',
  elencoAba: 'jogadores',
  gestaoFiltro: 'todos',
  gestaoSub: 'dre',
  rifasAdmin: [],
  resenhaAba: 'resenha',
  trampos: [],
  eventoLista: null,
  eventoEditId: null,
  eventoPartAberto: null,
  despDraft: null, despDirty: false,
  eventoDre: null, eventoDreAberto: null,
  eventoSobreAberto: false,
  eventoLocalAberto: false,
  trampoFormAberto: false,
  acessosPeriodo: 30,
  acessos: null,
  acessoAberto: null,
  rifas: [],
  rifaRodadaId: null,
  editandoMensId: null,
  relatorioFin: null,
  homeExtras: null,
  eventoAbertoId: null,  // id do evento (card "Eventos") aberto agora, sobrevive aos re-renders do polling
  eventoAbertoExp: 0,    // timestamp (Date.now()) até quando ele deve continuar aberto
  inatividadeTimer: null,
};

// nome de EXIBIÇÃO do jogador logado (apelido, se ele escolheu usar no Meu Contrato)
function nomeExibicaoMeu(){
  const p = state.currentPlayer || {};
  return (p.usarApelido && p.apelido) ? p.apelido : p.nome;
}
// nome de cadastro (texto salvo em Gestão/Eventos) -> nome de exibição atual
function nomeExibicaoPorNomeReal(nomeReal){
  const j = (state.elenco||[]).find(x=>x.nomeReal===nomeReal);
  return j ? j.nome : nomeReal;
}
// IMC = peso / altura². Classificação OMS para adultos (18+).
function calcIMC(peso, alturaCm){
  const p = Number(peso), a = Number(alturaCm)/100;
  if(!p || !a) return null;
  return p/(a*a);
}
function classificarIMC(imc){
  if(imc < 18.5) return {rotulo:'Abaixo do peso', cor:'#4EA1FF'};
  if(imc < 25)   return {rotulo:'Peso normal', cor:'#3FAE58'};
  if(imc < 30)   return {rotulo:'Sobrepeso', cor:'#E4C158'};
  if(imc < 35)   return {rotulo:'Obesidade grau I', cor:'#F0902E'};
  if(imc < 40)   return {rotulo:'Obesidade grau II', cor:'#E2574C'};
  return {rotulo:'Obesidade grau III', cor:'#C93A3A'};
}
// card "Saúde do Craque": só aparece quando idade, peso e altura estão preenchidos no perfil
// "Minha posição" no Ranking Geral — mesmo destaque do card de estrelas e pontuação
function renderMinhaPosicao(){
  const p = posicaoNoRankingGeral(state.currentPlayer.id);
  if(!p){
    return '<div class="meu-score-box meu-posicao"><div class="meu-posicao-vazio">Sem posição no ranking ainda — você aparece aqui depois de receber avaliações.</div></div>';
  }
  const ROT = {top5:'🏆 As Lendas (Top 5)', top10:'⭐ Os Craques (Top 10)', under5:'⚠️ Zona da Degola', meio:'⚔️ A briga dos Guerreiros'};
  const medalha = p.pos===1 ? '🥇' : p.pos===2 ? '🥈' : p.pos===3 ? '🥉' : '';
  return '<div class="meu-score-box meu-posicao posicao-'+p.zona+'" data-action="tab" data-tab="ranking">'+
    '<div class="meu-posicao-num">'+(medalha ? '<span class="meu-posicao-medalha">'+medalha+'</span>' : '')+p.pos+'º</div>'+
    '<div class="meu-posicao-txt"><strong>Posição no Ranking Geral</strong><span>de '+p.total+' jogadores • '+ROT[p.zona]+'</span></div>'+
  '</div>';
}
function renderCardSaude(){
  const p = state.currentPlayer;
  if(!p || !p.idade || !p.peso || !p.altura) return '';
  const imc = calcIMC(p.peso, p.altura);
  if(imc==null) return '';
  const menor = Number(p.idade) < 18;
  const cl = classificarIMC(imc);
  const pct = Math.max(0, Math.min(100, (imc-15)/(40-15)*100));
  const valorFmt = imc.toFixed(1).replace('.',',');
  return '<div class="card hz hz-vermelho"><h3>🩺 Departamento Médico:</h3>'+
    '<div class="imc-box">'+
      '<div class="imc-linha"><span class="imc-sigla">IMC</span><span class="imc-valor"'+(menor?'':' style="color:'+cl.cor+'"')+'>'+valorFmt+'</span></div>'+
      (menor
        ? '<div class="imc-class muted">Classificação por idade (menores de 18 anos) deve ser feita por um profissional</div>'
        : '<div class="imc-class" style="color:'+cl.cor+'">'+cl.rotulo+'</div>')+
      '<div class="imc-bar"><span class="imc-marker" style="left:'+pct.toFixed(1)+'%"></span></div>'+
      '<div class="imc-escala small muted"><span style="left:0">15</span><span style="left:14%">18,5</span><span style="left:40%">25</span><span style="left:60%">30</span><span style="left:80%">35</span><span style="left:100%">40</span></div>'+
    '</div>'+
    '<p class="small muted" style="margin-top:8px;">'+Number(p.idade)+' anos • '+String(p.peso).replace('.',',')+' kg • '+p.altura+' cm. IMC = peso ÷ altura². Referência geral da OMS — não substitui avaliação médica.</p>'+
  '</div>';
}

function jogadorNome(id){ const j = state.elenco.find(x=>x.id===id); return j ? j.nome : '?'; }
// "2026-11-15T08:05" -> "15/11/2026 às 08:05"
function formatAgendamento(str){
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(str||'');
  return m ? (m[3]+'/'+m[2]+'/'+m[1]+' às '+m[4]+':'+m[5]) : '';
}
// texto sobre QUANDO o sorteio acontece (manual pelo admin ou automático agendado)
function textoQuandoSorteio(rod){
  const cfg = rod && rod.sorteioConfig;
  if(cfg && cfg.modo==='automatico' && cfg.agendadoEm){
    return 'O sorteio dos times será realizado automaticamente em '+formatAgendamento(cfg.agendadoEm)+'.';
  }
  return 'O sorteio dos times é realizado pelo administrador, após o encerramento da confirmação de presença.';
}
// bloco fixo de informações da tela Votação
function infoVotacaoHtml(){
  return '<p style="color:var(--text);font-weight:700;margin-bottom:4px;">📅 Quando posso votar ?</p>'+
    '<p>A votação estará liberada a partir das 10hrs e será encerrada automaticamente às 13hrs do domingo da rodada.</p>'+
    '<p style="color:var(--text);font-weight:700;margin-top:16px;margin-bottom:4px;">🤔 Qual critério para o Ranking ?</p>'+
    '<p style="margin-bottom:0;">O ranking considera a votação acumulada e recorrente dos jogadores a cada rodada. Os jogadores AUSENTES perdem automaticamente 10% de seus pontos acumulados no RANKING GERAL.</p>';
}
function nomeParaExibicao(id){
  if(id && id.startsWith('conv:')){
    return 'Convidado de '+jogadorNome(id.slice(5));
  }
  return jogadorNome(id);
}
function mediaDoJogador(jogadorId, papel){
  const r = state.ranking && state.ranking[jogadorId];
  if(!r || !r[papel] || r[papel].media==null) return null;
  // desconto de 10% por rodada ausente (em cascata), igual ao Ranking Geral
  return r[papel].media * Math.pow(0.9, (state.ausencias||{})[jogadorId] || 0);
}
function starsHtml(media, grande, extraClass){
  if(media==null) return '<span class="stars-empty small muted">sem avaliações</span>';
  const pct = Math.max(0, Math.min(100, media/5*100));
  return '<span class="stars'+(grande?' stars-lg':'')+(extraClass?' '+extraClass:'')+'" title="'+media.toFixed(1)+' de 5">'+
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
async function refreshVersion(){ try{ const data = await api('/api/version'); state.appVersion = data.version; state.adminWhats = data.adminWhats||''; }catch(e){} }
async function refreshMe(){
  if(!state.token) return;
  try{
    const j = await api('/api/me', {auth:true});
    state.currentPlayer = Object.assign({}, state.currentPlayer, j);
    localStorage.setItem('bolerage_player', JSON.stringify(state.currentPlayer));
  }catch(e){}
}
async function refreshRanking(){ try{ const data = await api('/api/ranking'); state.ranking = data.ranking; state.ausencias = data.ausencias || {}; }catch(e){} }
async function refreshRankingBola(){ try{ state.rankingBola = await api('/api/ranking-bola'); }catch(e){} }
async function refreshHomeExtras(){ try{ state.homeExtras = await api('/api/home-extras'); }catch(e){} }
async function refreshRodadaAtual(){
  try{
    const data = await api('/api/rodadas/atual', {auth:true});
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
    const data = await api('/api/rodadas/'+id, {auth:true});
    state.rodadaVisualizadaId = id;
    state.rodadaVisualizada = data.rodada;
  }catch(e){}
}
// usado ao entrar nas abas Sorteio/Resenha: sempre volta a mostrar a rodada mais
// recente primeiro, em vez de continuar numa rodada antiga que ficou selecionada
// de uma navegação anterior.
async function irParaRodadaMaisRecente(){
  const maisRecente = state.rodadaAtual || [...state.rodadasLista].sort((a,b)=>a.data<b.data?1:-1)[0];
  if(!maisRecente) return;
  if(state.rodadaAtual && maisRecente.id===state.rodadaAtual.id){
    state.rodadaVisualizadaId = state.rodadaAtual.id;
    state.rodadaVisualizada = state.rodadaAtual;
  }else{
    await carregarRodadaVisualizada(maisRecente.id);
  }
}

/* ============================================================
   RENDER: TOPBAR
   ============================================================ */
function renderTopbar(){
  const topbar = document.getElementById('topbar');
  const bottomnav = document.getElementById('bottomnav');
  document.body.classList.toggle('na-tela-login', !state.currentPlayer);   // login ocupa a tela toda, centralizado
  if(!state.currentPlayer){ topbar.style.display='none'; bottomnav.style.display='none'; return; }
  topbar.style.display='block';
  bottomnav.style.display='flex';
  document.getElementById('pin-action-slot').innerHTML =
    '<button data-action="abrir-troca-pin">Meu Contrato</button>';
  document.getElementById('admin-action-slot').innerHTML =
    ((state.currentPlayer.admin || state.currentPlayer.marketing) ? '<button data-action="abrir-admin">'+(state.currentPlayer.admin ? 'Admin' : 'Eventos')+'</button>' : '')+
    '<button data-action="logout">Sair</button>';
  const m = MENS_INFO[state.currentPlayer.mensalidade];
  const mensLine = m
    ? '<div class="who-mens-line ml-'+m.cls+'">Craque, sua mensalidade está&nbsp;&nbsp;<span class="who-mens '+m.cls+'">'+m.lbl+' '+m.emoji+'</span>'+
        ((state.currentPlayer.mensalidade==='em_atraso' && state.currentPlayer.diasAtraso!=null) ? '<span class="who-atraso">&nbsp;('+state.currentPlayer.diasAtraso+' dia'+(state.currentPlayer.diasAtraso===1?'':'s')+')</span>' : '')+'</div>'
    : '';
  const whoHtml = '<div class="who-row1">'+
      '<span class="who-name">'+saudacao()+', '+escapeHtml(nomeExibicaoMeu())+' !&nbsp;&nbsp;'+timeCoracaoSuffix(state.currentPlayer.timeCoracao)+
        (state.currentPlayer.deptoMedico ? ' 🚑' : '')+'</span>'+
    '</div>'+
    mensLine;
  // só escreve no DOM se o conteúdo realmente mudou — render() roda a cada clique
  // no app inteiro, e recriar a <img> do escudo toda hora fazia ela "piscar".
  if(state._lastWhoHtml !== whoHtml){
    document.getElementById('who-slot').innerHTML = whoHtml;
    state._lastWhoHtml = whoHtml;
  }
  const fase = state.rodadaAtual ? state.rodadaAtual.fase : {label:'Nenhuma rodada agendada', cor:'muted'};
  document.getElementById('phase-chip-slot').innerHTML =
    '<span class="chip '+fase.cor+'"><span class="dot"></span>'+escapeHtml(fase.label)+'</span>';

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
  // a tela já está montada (só trocando dígito) — atualiza só os pontos e o erro,
  // sem recriar a <img> do logo (recriá-la a cada tecla fazia o logo "piscar").
  const existing = document.getElementById('login-screen');
  if(existing){
    // os pontos são só marcados/desmarcados (não recriados), para não piscar a cada tecla
    [...existing.querySelectorAll('.pin-dot')].forEach((el,i)=> el.classList.toggle('filled', i < state.pinBuffer.length));
    const erroEl = existing.querySelector('.login-error');
    if(erroEl.textContent !== state.loginError) erroEl.textContent = state.loginError;
    return;
  }
  const keys = ['1','2','3','4','5','6','7','8','9','','0','back'];
  const keypad = keys.map(k=>{
    if(k==='') return '<button class="ghost"></button>';
    if(k==='back') return '<button data-action="login-back">⌫</button>';
    return '<button data-action="login-digit" data-digit="'+k+'">'+k+'</button>';
  }).join('');
  document.getElementById('content').innerHTML =
    '<div id="login-screen">'+
      '<div class="login-halo"><img src="/assets/logo.jpg" alt="Bolerage F.D." class="login-logo"></div>'+
      '<div class="sub login-sub">Digite seu PIN de 4 dígitos</div>'+
      '<div class="pin-dots">'+dots+'</div>'+
      '<div class="keypad">'+keypad+'</div>'+
      '<div class="login-error">'+escapeHtml(state.loginError)+'</div>'+
      '<div class="login-hint">Caso ainda não tenha um PIN, solicite ao administrador do grupo Bolerage'+
        ' <a class="wa-link wa-link-destaque" href="whatsapp://" title="Abrir o WhatsApp">'+WA_ICON+'</a>'+
      '</div>'+
      (state.appVersion ? '<div class="login-versao"><span class="login-versao-num">V'+escapeHtml(state.appVersion)+'</span></div>' : '')+

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
    // descarta qualquer token de admin de uma sessão anterior (de outro jogador) neste navegador
    state.adminToken=null; state.isAdmin=false;
    localStorage.removeItem('bolerage_admin_token');
    state.tab='inicio';
    await refreshRodadaAtual();
    startPolling();
    resetInatividade();
    await render();
  }catch(e){
    state.loginError = e.message || 'PIN não encontrado. Tente novamente.';
    render();
  }
}

async function handleLogout(){
  try{ await api('/api/logout', {method:'POST', auth:true}); }catch(e){}
  state.token=null; state.currentPlayer=null; state.tab='inicio'; state.mostrouDicaPin=false; state.eventoDre=null; state.eventoDreAberto=null; state.despDraft=null; state.despDirty=false; state.partDraft=null; state.partDirty=false; state.editingEventoId=null;
  localStorage.removeItem('bolerage_token'); localStorage.removeItem('bolerage_player');
  // encerra também a sessão de admin: ela não pode sobreviver à troca de jogador neste navegador
  state.adminToken=null; state.isAdmin=false;
  localStorage.removeItem('bolerage_admin_token');
  if(state.pollHandle){ clearInterval(state.pollHandle); state.pollHandle=null; }
  pararInatividade();
  render();
}

/* ============================================================
   RENDER: MEU PERFIL (+ trocar PIN)
   ============================================================ */
function renderTrocarPin(){
  const p = state.currentPlayer || {};
  const v = x => escapeHtml(x==null ? '' : String(x));
  document.getElementById('content').innerHTML =
    '<div class="card"><h2>Meu Contrato</h2>'+
    (p.mensalidade==='em_atraso'
      ? '<div class="aviso-atraso">⚠️ Sua mensalidade está <strong>EM ATRASO</strong>'+(p.diasAtraso!=null ? ' há <strong>'+p.diasAtraso+' dia'+(p.diasAtraso===1?'':'s')+'</strong>' : '')+'. Procure o administrador para regularizar.</div>'
      : '')+
    '<p class="small muted">Todos os campos são opcionais — preencha só o que quiser.</p>'+
    '<div class="field"><label>Apelido</label><input id="perfil-apelido" maxlength="30" value="'+v(p.apelido)+'" placeholder="Como o pessoal te chama"></div>'+
    '<label class="small perfil-check"><input type="checkbox" id="perfil-usar-apelido" '+(p.usarApelido?'checked':'')+'> Exibir meu APELIDO em todo o app (no lugar do meu nome)</label>'+
    '<p class="small muted" style="margin:2px 0 10px;">Seu nome de cadastro'+(p.nome?' (<strong style="color:var(--text)">'+v(p.nome)+'</strong>)':'')+' continua ligado ao seu PIN e não pode ser alterado. Só vale se você preencher o apelido.</p>'+
    '<div class="field"><label>E-mail</label><input id="perfil-email" type="email" inputmode="email" autocapitalize="none" maxlength="120" value="'+v(p.email)+'" placeholder="seu@email.com"></div>'+
    '<div class="field"><label>Celular (WhatsApp, com DDD)</label><input id="perfil-telefone" type="tel" inputmode="tel" maxlength="30" value="'+v(p.telefone)+'" placeholder="(11) 91234-5678"></div>'+
    '<div class="field"><label>Time do coração</label><select id="perfil-time">'+timeCoracaoOptionsHtml(p.timeCoracao)+'</select></div>'+
    '<div class="field"><label>Idade</label><input id="perfil-idade" type="number" inputmode="numeric" min="5" max="99" value="'+v(p.idade)+'"></div>'+
    '<div class="field"><label>Peso (kg)</label><input id="perfil-peso" type="number" inputmode="decimal" step="0.1" min="20" max="250" value="'+v(p.peso)+'"></div>'+
    '<div class="field"><label>Altura (cm)</label><input id="perfil-altura" type="number" inputmode="numeric" min="100" max="230" value="'+v(p.altura)+'" placeholder="Ex.: 178"></div>'+
    '<p class="small" id="perfil-msg" style="color:var(--red);min-height:1em;"></p>'+
    '<div class="btn-row"><button class="btn" data-action="salvar-perfil">Salvar perfil</button>'+
    '<button class="btn secondary" data-action="cancelar-troca-pin">Voltar</button></div>'+
    '</div>'+
    '<div class="card"><h3>Trocar meu PIN</h3>'+
    '<p class="small muted">Escolha um PIN de 4 dígitos que só você vai usar para entrar.</p>'+
    '<div class="field"><label>Novo PIN</label><input id="novo-pin-jogador" maxlength="4" inputmode="numeric" type="tel"></div>'+
    '<div class="field"><label>Confirmar novo PIN</label><input id="confirmar-pin-jogador" maxlength="4" inputmode="numeric" type="tel"></div>'+
    (state.trocaPinErro? '<p class="small" style="color:var(--red);">'+escapeHtml(state.trocaPinErro)+'</p>':'')+
    '<div class="btn-row"><button class="btn secondary" data-action="salvar-meu-pin">Salvar novo PIN</button></div>'+
    '</div>';
}
async function handleSalvarPerfil(){
  const g = id => document.getElementById(id).value;
  const msg = document.getElementById('perfil-msg');
  if(msg) msg.textContent = '';
  try{
    const r = await api('/api/me/perfil', {method:'PUT', auth:true, body:{
      apelido: g('perfil-apelido'), email: g('perfil-email'), telefone: g('perfil-telefone'), timeCoracao: g('perfil-time'),
      idade: g('perfil-idade'), peso: g('perfil-peso'), altura: g('perfil-altura'),
      usarApelido: document.getElementById('perfil-usar-apelido').checked,
    }});
    state.currentPlayer = Object.assign({}, state.currentPlayer, r.jogador);
    localStorage.setItem('bolerage_player', JSON.stringify(state.currentPlayer));
    state._lastWhoHtml = null;
    await refreshElenco();
    renderTopbar();
    renderTrocarPin();
    showToast('Perfil salvo!');
  }catch(e){ if(msg) msg.textContent = e.message; }
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

// Posição do jogador no Ranking Geral (mesma regra da tela Ranking: média geral com o
// desconto de 10% por ausência; só jogadores ativos com avaliação entram na lista).
function posicaoNoRankingGeral(jogadorId){
  const ranking = state.ranking || {};
  const mediaGeral = id => {
    const r = ranking[id];
    if(!r) return null;
    const total = r.linha.total + r.goleiro.total;
    if(!total) return null;
    const soma = (r.linha.media!=null ? r.linha.media*r.linha.total : 0) + (r.goleiro.media!=null ? r.goleiro.media*r.goleiro.total : 0);
    return (soma/total) * Math.pow(0.9, (state.ausencias||{})[id] || 0);
  };
  const lista = (state.elenco||[]).filter(j=>j.ativo).map(j=>({id:j.id, media:mediaGeral(j.id)}))
    .filter(x=>x.media!=null).sort((a,b)=>b.media-a.media);
  const i = lista.findIndex(x=>x.id===jogadorId);
  if(i<0) return null;
  const n = lista.length;
  const zona = i<5 ? 'top5' : i<10 ? 'top10' : (n>10 && i>=Math.max(10, n-5)) ? 'under5' : 'meio';
  return {pos:i+1, total:n, zona};
}
// cada card da tela inicial é uma "parte"; a ordem de exibição é escolhida pelo admin
const ORDEM_INICIO_PADRAO = ['rodada','status_carreira','se_liga','departamento_medico','eventos','pagamento','gestao'];
const NOMES_CARDS_INICIO = {
  rodada:'Rodada do Próximo Domingão', status_carreira:'Minha Temporada', se_liga:'Se Liga - Craque',
  departamento_medico:'Departamento Médico', eventos:'Eventos', pagamento:'Dados para Pagamento do Aluguel da Quadra', gestao:'Gestão Atual',
};
function ordemCardsInicio(){
  const salva = (state.homeExtras && state.homeExtras.ordem) || [];
  const out = [];
  salva.forEach(k=>{ if(ORDEM_INICIO_PADRAO.includes(k) && !out.includes(k)) out.push(k); });
  ORDEM_INICIO_PADRAO.forEach(k=>{ if(!out.includes(k)) out.push(k); });
  return out;
}
function montarCardsInicio(partes){ return ordemCardsInicio().map(k=>partes[k]||'').join(''); }
function renderExtrasIniciais(){
  const ex = state.homeExtras || {};
  const p = {};
  if(ex.noticia && ex.noticia.descricao){
    p.se_liga = '<div class="card hz hz-laranja"><h3>📣 Se Liga - Craque:</h3><p class="small avisos-text">'+escapeHtml(ex.noticia.descricao)+'</p></div>';
  }
  // Minha Temporada (tocar nas estrelas abre a Performance) e Departamento Médico
  if(state.currentPlayer){
    const minhaMedia = mediaDoJogador(state.currentPlayer.id, state.currentPlayer.posicaoPadrao);
    p.status_carreira = '<div class="card hz hz-dourado"><h3>Minha Temporada em '+(new Date().getFullYear())+':</h3>'+
      '<div class="meu-score-box meu-score-click" data-action="ranking-jogador" data-id="'+state.currentPlayer.id+'" title="Toque para ver sua Performance">'+starsHtml(minhaMedia, true, 'stars-xl')+'</div>'+
      '<p class="small muted" style="text-align:center;margin:6px 0 0;">Toque nas estrelas para ver sua Performance</p>'+
      renderMinhaPosicao()+
      '</div>';
    p.departamento_medico = renderCardSaude();
  }
  const eventosHome = (ex.eventos || []).filter(e=>!e.soAba);
  if(eventosHome.length){
    let html = '<div class="card hz hz-roxo"><h3>📅 Eventos:</h3>';
    eventosHome.forEach(e=>{
      const desc = (e.descricao||'').trim();
      const resp = (e.responsavel||'').trim();
      if(desc || resp || e.mostrarParticipantes || e.pagamento || e.local){
        const wa = waLink(e.responsavelTel);
        const aberto = state.eventoAbertoId===String(e.id) && Date.now() < state.eventoAbertoExp;
        html += '<details class="evento-item" data-evento-id="'+e.id+'"'+(aberto?' open':'')+'>'+
          '<summary><span>'+escapeHtml(e.nome)+'</span><span class="badge">'+formatDataBR(e.data)+'</span></summary>'+
          (desc ? '<p class="small avisos-text" style="margin-top:8px;">'+escapeHtml(desc)+'</p>' : '')+
          (resp ? '<div class="list-row"><span>Gestor do Evento</span><span class="row-right">'+escapeHtml(nomeExibicaoPorNomeReal(resp))+
            (wa ? '<a class="wa-link" href="'+wa+'" target="_blank" rel="noopener" title="Falar no WhatsApp">'+WA_ICON+'</a>' : '')+'</span></div>' : '')+
        localEventoHtml(e)+
        sobreEventoHtml(e, ex.eventoLista)+
        '</details>';
      }else{
        html += '<div class="list-row"><span>'+escapeHtml(e.nome)+'</span><span class="badge">'+formatDataBR(e.data)+'</span></div>';
      }
    });
    html += '</div>';
    p.eventos = html;
  }
  if(ex.aluguel){
    p.pagamento = '<div class="card hz hz-verde"><h3 class="titulo-uma-linha">💳 Dados para Pagamento do Aluguel da Quadra:</h3>'+
      '<div class="list-row"><span>Nome</span><span>'+escapeHtml(ex.aluguel.nome)+'</span></div>'+
      '<div class="list-row"><span>Chave PIX</span><span class="row-right"><span class="pix-code">'+escapeHtml(ex.aluguel.chavePix)+'</span>'+
        (ex.aluguel.chavePix ? '<button class="btn small" data-action="copiar-pix" data-pix="'+escapeHtml(ex.aluguel.chavePix)+'">Copiar</button>' : '')+
        '</span></div>'+
      '<div class="list-row"><span>Mensalidade</span><span>'+escapeHtml(ex.aluguel.valorMensalidade)+'</span></div>'+
      '</div>';
  }
  if(ex.gestao){
    const linhaG = (cargo, nome, tel) => {
      const link = waLink(tel);
      return '<div class="list-row"><span>'+cargo+'</span><span class="row-right">'+escapeHtml(nome||'—')+
        (link ? '<a class="wa-link" href="'+link+'" target="_blank" rel="noopener" title="Falar no WhatsApp">'+WA_ICON+'</a>' : '')+
      '</span></div>';
    };
    p.gestao = '<div class="card hz hz-ciano"><h3>🏛️ Gestão Atual:</h3>'+
      linhaG('Presidente', nomeExibicaoPorNomeReal(ex.gestao.presidente), ex.gestao.presidenteTel)+
      linhaG('Vice-Presidente', nomeExibicaoPorNomeReal(ex.gestao.vicePresidente), ex.gestao.viceTel)+
      '</div>';
  }
  return p;
}

function linhaListaPresenca(j, ehConvidado){
  const media = mediaDoJogador(j.id, j.posicaoPadrao);
  return '<div class="list-row"><span>'+escapeHtml(j.nome)+timeCoracaoSuffix(j.timeCoracao)+'</span>'+
    '<span class="row-right">'+starsHtml(media, true)+(j.posicaoPadrao==='goleiro'?'<span class="badge gk">goleiro</span>':(j.corneta?'<span class="badge">🎺 corneta</span>':'<span class="badge">linha</span>'))+'</span></div>'+
    (ehConvidado ? '<div class="convidado-row"><span class="conv-txt">Convidado de '+escapeHtml(j.nome)+'</span><span class="badge conv-badge">convidado</span></div>' : '');
}

function renderInicio(){
  const rodada = state.rodadaAtual;
  const c = document.getElementById('content');
  let dica = '';
  if(!state.mostrouDicaPin){
    dica = '<div class="info-box">Dica: em "Meu Contrato" (no topo da tela) você troca seu PIN e completa seus dados: celular, time do coração, apelido, idade, peso e altura.</div>';
    state.mostrouDicaPin = true;
  }
  const partes = renderExtrasIniciais();
  if(!rodada){
    partes.rodada = '<div class="empty">Nenhuma rodada agendada ainda.<br>Peça para o administrador criar a próxima rodada.</div>';
    c.innerHTML = dica + montarCardsInicio(partes);
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
  // cornetas fazem check-in mas não jogam: não entram na contagem de jogadores de linha
  const linhaN = presentes.filter(j=>j.posicaoPadrao==='linha' && !j.corneta).length + convidadosDeIds.size;
  const golN = presentes.filter(j=>j.posicaoPadrao==='goleiro').length;

  let html = '<div class="card hz hz-azul"><h2>Rodada do Próximo Domingão - '+formatDataBR(rodada.data)+'</h2>';

  if(fase.chave==='pre_confirmacao'){
    html += '<p class="muted small">A confirmação de presença ainda não foi aberta. Ela abre no sábado às 8hrs e fecha no domingo às 8hrs.</p>';
  }
  if(fase.chave==='confirmacao_aberta'){
    html += renderMedidorConfirmacao(linhaN, golN);
    const souCorneta = !!state.currentPlayer.corneta;
    html += renderTogglePresenca(meuStatus, souCorneta);
    if(souCorneta){
      html += '<p class="small" style="padding:8px 2px;color:var(--text-muted);">🎺 Você é <strong style="color:var(--text)">Corneta</strong>: pode fazer o check-in, mas <strong style="color:var(--text)">não participa do sorteio dos times</strong>. Na votação você vota normalmente nos jogadores.'+(meuStatus==='presente'?' Se quiser levar um amigo para jogar, marque Convidado abaixo.':'')+'</p>';
    }
    if(meuStatus==='presente') html += renderToggleConvidado(euTrouxeConvidado);
    if(meuStatus==='presente') html += renderToggleResenha((rodada.resenha||[]).includes(state.currentPlayer.id));
  }
  if(fase.chave==='aguardando_sorteio'){
    html += renderMedidorConfirmacao(linhaN, golN);
    html += '<p class="muted small">Aguardando o sorteio dos times. '+textoQuandoSorteio(rodada)+'</p>';
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
    const souAlternante = meuTime && meuTime.nome==='Alternantes'; // rodadas antigas
    const souGoleiroPresente = (rodada.goleirosPresentes||[]).includes(state.currentPlayer.id);
    const souCornetaPresente = !!state.currentPlayer.corneta && (rodada.confirmados||[]).includes(state.currentPlayer.id);
    html += souAlternante
      ? '<p class="small">Você ficou como <strong>Alternar Jogador</strong> nesta rodada — reveza com os times completos. Veja na aba Sorteio.</p>'
      : meuTime
      ? '<p class="small">Você está no time <strong>'+meuTime.nome+'</strong>. Veja a formação completa na aba Sorteio.</p>'
      : souCornetaPresente
        ? '<p class="small">🎺 Você fez check-in como <strong>corneta</strong>: não entrou no sorteio dos times, mas pode votar normalmente nos jogadores.</p>'
      : souGoleiroPresente
        ? '<p class="small">Você está como <strong>goleiro presente</strong> nesta rodada (fixo, fora do sorteio). Pode votar e receber votos normalmente.</p>'
      : souReserva
        ? '<p class="small">Você ficou como <strong>reserva</strong> nesta rodada, mas pode votar e receber votos normalmente.</p>'
        : '<p class="small muted">Você não participou desta rodada.</p>';
    if(fase.chave==='votacao_aberta' && (meuTime || souReserva || souGoleiroPresente || souCornetaPresente)){
      const jaVotouEm = new Set(rodada.votos.filter(v=>v.avaliadorId===state.currentPlayer.id).map(v=>v.avaliadoId));
      const alvos = [...new Set([...rodada.times.times.flatMap(t=>t.jogadores.map(j=>j.jogadorId)), ...rodada.times.reservas, ...(rodada.goleirosPresentes||[])])]
        .filter(id=>id!==state.currentPlayer.id && !id.startsWith('conv:'));
      const faltam = alvos.filter(a=>!jaVotouEm.has(a)).length;
      html += '<p class="small">Votação aberta até as 13h. Faltam avaliar '+faltam+' colega(s). <a href="#" data-action="tab" data-tab="votacao">Ir para votação →</a></p>';
    }
    if(fase.chave==='encerrada'){
      html += '<p class="small muted">A rodada encerrou. Veja o ranking atualizado na aba Ranking.</p>';
    }
  }
  html += '</div>';
  partes.rodada = html;
  c.innerHTML = dica + montarCardsInicio(partes);
}

function renderTogglePresenca(meuStatus, souCorneta){
  const ligado = meuStatus==='presente';
  const desligado = meuStatus==='ausente';
  const classe = ligado ? 'is-on' : (desligado ? 'is-off' : 'is-pending');
  const label = ligado
    ? '<strong style="color:var(--green)">Presente</strong> — '+(souCorneta ? 'check-in feito' : 'vou jogar')
    : desligado
      ? '<strong style="color:var(--red)">Ausente</strong> — '+(souCorneta ? 'sem check-in' : 'não vou jogar')
      : '<span class="muted">Toque para fazer o '+(souCorneta ? 'check-in' : 'check-in e dizer que vai jogar')+'</span>';
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
async function handleToggleVinho(atual){
  const novo = atual!=='sim';
  try{
    await api('/api/rodadas/'+state.rodadaAtual.id+'/vinho', {method:'POST', auth:true, body:{vinho:novo}});
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
// ---- EVENTO DE FIM DE ANO: lista de participantes (valor pago e status)
async function refreshEvento(){ try{ state.eventoLista = await api('/api/evento', {auth:true}); }catch(e){} }
const ST_EVENTO = {pago:{rot:'Pago Total', cls:'st-pago', ico:'✅'}, parcial:{rot:'Pago Parcial', cls:'st-parcial', ico:'🟠'}, pendente:{rot:'Pendente', cls:'st-pendente', ico:'⏳'}};
function statusEventoPill(st){ const x = ST_EVENTO[st] || ST_EVENTO.pendente; return '<span class="st-pill '+x.cls+'">'+x.ico+' '+x.rot+'</span>'; }
function eventoLinhaHtml(p, i){
  return '<div class="fin-row evt-row"><span class="fin-pos">'+(i+1)+'</span><span class="fin-nome">'+escapeHtml(p.nome)+'</span>'+statusEventoPill(p.status)+'</div>';
}
function eventoTotaisHtml(t){
  return '<div class="kpi-grid">'+
    '<div class="kpi kpi-sm kpi-azul kpi-full"><div class="kpi-num">'+t.qtd+' <span class="kpi-un">participante'+(t.qtd===1?'':'s')+'</span></div><div class="kpi-rot kpi-uma">'+t.pagos+' pago total · '+t.parciais+' pago parcial · '+t.pendentes+' pendente'+(t.pendentes===1?'':'s')+'</div></div>'+
    '<div class="kpi kpi-sm kpi-verde"><div class="kpi-num">'+fmtBRLfront(t.arrecadado)+'</div><div class="kpi-rot">arrecadado</div></div>'+
    '<div class="kpi kpi-sm kpi-vermelho"><div class="kpi-num">'+fmtBRLfront(t.aReceber)+'</div><div class="kpi-rot">a receber</div></div>'+
    '<div class="kpi kpi-sm kpi-dourado kpi-full kpi-centro"><div class="kpi-num">'+String(t.pctPago).replace('.',',')+'%</div><div class="kpi-rot">do total já pago</div></div>'+
  '</div>';
}
function pagamentoEventoHtml(pg){
  if(!pg || (!pg.nome && !pg.chavePix && !pg.valor)) return '';
  // cada valor recebe --n (nº de caracteres): a fonte se ajusta à largura do card, sem quebrar linha
  const n = s => Math.max(6, String(s).length);
  return '<div class="evt-pgto"><div class="evt-pgto-tit">💳 Dados para pagamento do evento</div>'+
    (pg.nome ? '<div class="pg-row"><span class="pg-rot">Responsável</span><span class="pg-val" style="--n:'+n(pg.nome)+'">'+escapeHtml(pg.nome)+'</span></div>' : '')+
    (pg.chavePix ? '<div class="pg-row pg-pix"><span class="pg-rot">Chave PIX</span><span class="pg-pixv"><span class="pg-chave" style="--n:'+n(pg.chavePix)+'">'+escapeHtml(pg.chavePix)+'</span>'+
      '<button class="btn small" data-action="copiar-pix" data-pix="'+escapeHtml(pg.chavePix)+'">Copiar</button></span></div>' : '')+
    (pg.valor ? '<div class="pg-row"><span class="pg-rot">Valor</span><span class="pg-val" style="--n:'+n(pg.valor)+'">'+escapeHtml(pg.valor)+'</span></div>' : '')+
  '</div>';
}
// local do evento: toque para abrir no Waze, Google Maps ou Uber
function localEventoHtml(e){
  if(!e.local) return '';
  const q = encodeURIComponent(e.local);
  return '<details class="evento-local" data-evento-id="'+e.id+'"'+(state.eventoLocalAberto?' open':'')+'><summary>📍 '+escapeHtml(e.local)+' <small>• toque para ir</small></summary>'+
    '<div class="local-btns">'+
      '<a class="btn small local-btn local-waze" href="https://waze.com/ul?q='+q+'&navigate=yes" target="_blank" rel="noopener">🚗 Waze</a>'+
      '<a class="btn small local-btn local-maps" href="https://www.google.com/maps/search/?api=1&query='+q+'" target="_blank" rel="noopener">🗺️ Maps</a>'+
      '<a class="btn small local-btn local-uber" href="https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D='+q+'" target="_blank" rel="noopener">🚕 Uber</a>'+
    '</div></details>';
}
// nota "Sobre o Evento" (tela inicial): dados para pagamento + lista de participantes
function sobreEventoHtml(e, lista){
  if(!e.mostrarParticipantes && !e.pagamento) return '';
  let corpo = pagamentoEventoHtml(e.pagamento);
  if(e.mostrarParticipantes){
    if(lista && lista.participantes && lista.participantes.length){
      corpo += eventoTotaisHtml(lista.totais)+lista.participantes.map(eventoLinhaHtml).join('');
    }else{
      corpo += '<p class="small muted">A lista de participantes ainda não foi cadastrada.</p>';
    }
  }
  return '<details class="evento-sobre" data-evento-id="'+e.id+'"'+(state.eventoSobreAberto?' open':'')+'><summary>ℹ️ Sobre o Evento</summary><div class="evt-sobre-corpo">'+corpo+'</div></details>';
}
// botões do local do evento (Waze / Google Maps / Uber), sempre visíveis
function localBotoesHtml(e){
  if(!e.local) return '';
  const q = encodeURIComponent(e.local);
  return '<div class="evt-local"><div class="evt-local-end">📍 '+escapeHtml(e.local)+'</div><div class="local-btns" style="padding:6px 0 0;">'+
    '<a class="btn small local-btn local-waze" href="https://waze.com/ul?q='+q+'&navigate=yes" target="_blank" rel="noopener">🚗 Waze</a>'+
    '<a class="btn small local-btn local-maps" href="https://www.google.com/maps/search/?api=1&query='+q+'" target="_blank" rel="noopener">🗺️ Maps</a>'+
    '<a class="btn small local-btn local-uber" href="https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D='+q+'" target="_blank" rel="noopener">🚕 Uber</a></div></div>';
}
function participantesBlocoHtml(l){
  const t = l.totais;
  // Card 4: resumo (centralizado) + gráfico; Card 5: lista de participantes
  return '<div class="card hz hz-dourado evt-resumo"><div class="stack-tit">Resumo dos participantes</div>'+eventoTotaisHtml(t)+
    pizzaHtml('', [
      {label:'Pago Total', valor:t.pagos, cor:'#3FAE58', txt:t.pagos+' participante'+(t.pagos===1?'':'s')},
      {label:'Pago Parcial', valor:t.parciais, cor:'#F0902E', txt:t.parciais+' participante'+(t.parciais===1?'':'s')},
      {label:'Pendente', valor:t.pendentes, cor:'#E2574C', txt:t.pendentes+' participante'+(t.pendentes===1?'':'s')},
    ])+'</div>'+
    [['pago','verde','✅ PAGO TOTAL'],['parcial','laranja','🟠 PAGO PARCIAL'],['pendente','vermelho','⏳ PENDENTE']].map(g=>{
      const arr = l.participantes.filter(p=>p.status===g[0]);
      if(!arr.length) return '';
      return finZona(g[1], g[2], arr.length+' participante'+(arr.length===1?'':'s')+' • '+fmtPctFront(arr.length, t.qtd)+' da lista', arr.map(eventoLinhaGrupoHtml).join(''));
    }).join('');
}
// linha de participante dentro do grupo de status (o status já é o título do grupo)
function eventoLinhaGrupoHtml(p, i){
  return '<div class="fin-row evt-row evt-row-g"><span class="fin-pos">'+(i+1)+'</span><span class="fin-nome">'+escapeHtml(p.nome)+'</span></div>';
}
function souGestorDoEvento(e){
  const me = state.currentPlayer && (state.elenco||[]).find(x=>x.id===state.currentPlayer.id);
  return !!(me && e.responsavel && me.nomeReal===e.responsavel);
}
// DRE do evento (mesma linguagem do DRE do painel Gestão): receitas, despesas, saldo em caixa, saldo previsto e pizza por status
function dreEventoPainelHtml(d){
  const r = d.receitas, ps = r.porStatus, desp = d.despesas;
  const saldoCor = d.resultadoPrevisto < 0 ? 'vermelho' : 'verde';
  const corTxt = d.resultadoPrevisto < 0 ? 'var(--red)' : 'var(--green)';
  const itens = desp.itens.length ? desp.itens.map(x=>
    '<div class="dre-desp"><div class="dre-desp-l1"><span>'+escapeHtml(x.despesa)+'</span><strong>'+fmtBRLfront(x.valor)+'</strong></div>'+
    ((x.fornecedor||x.data) ? '<div class="dre-desp-l2">'+(x.fornecedor?'🏷️ '+escapeHtml(x.fornecedor):'')+(x.fornecedor&&x.data?' • ':'')+(x.data?'📅 '+formatDataBR(x.data):'')+'</div>' : '')+'</div>').join('')
    : '<p class="small muted" style="margin:6px 0;">Nenhuma despesa cadastrada.</p>';
  return '<div class="evt-dre"><div class="stack-tit">DRE — '+escapeHtml(d.evento.nome)+'</div>'+
    '<div class="btn-row evt-dre-exp"><button type="button" class="btn secondary" data-action="baixar-evento-dre" data-id="'+d.evento.id+'" data-fmt="pdf">📄 Exportar PDF</button>'+
    '<button type="button" class="btn secondary" data-action="baixar-evento-dre" data-id="'+d.evento.id+'" data-fmt="xlsx">📊 Exportar Excel</button></div>'+
    finZona('verde', '💰 RECEITAS', 'Participantes do evento',
      relLinhaHtml('Pago Total <span class="rel-obs">(recebido)</span>', fmtBRLfront(ps.pago.recebido), 'rel-item')+
      relLinhaHtml('Pago Parcial <span class="rel-obs">(recebido)</span>', fmtBRLfront(ps.parcial.recebido), 'rel-item')+
      relLinhaHtml('A receber <span class="rel-obs">(parcial + pendentes)</span>', fmtBRLfront(r.aReceber), 'rel-item')+
      relLinhaHtml('Total de receitas', fmtBRLfront(r.previsto), 'rel-sub'))+
    finZona('vermelho', '💸 DESPESAS', 'Despesas do evento', itens+relLinhaHtml('Total de despesas', fmtBRLfront(desp.total), 'rel-sub'))+
    finZona('dourado', '🏦 SALDO EM CAIXA', 'Recebido − despesas', relLinhaHtml('Saldo em caixa do evento', fmtBRLfront(d.saldoCaixa), 'rel-sub'))+
    finZona(saldoCor, '📊 SALDO PREVISTO', 'Receitas previstas − despesas',
      '<div class="rel-linha rel-total"><span class="rel-rot">SALDO PREVISTO</span><strong class="rel-val" style="color:'+corTxt+';">'+fmtBRLfront(d.resultadoPrevisto)+'</strong></div>')+
    finZona('azul', '🥧 VALOR POR STATUS', 'Participação de cada status na receita',
      pizzaHtml('', [
        {label:'Pago Total', valor:ps.pago.valor, cor:'#3FAE58', txt:fmtBRLfront(ps.pago.valor)},
        {label:'Pago Parcial', valor:ps.parcial.valor, cor:'#F0902E', txt:fmtBRLfront(ps.parcial.valor)},
        {label:'Pendente', valor:ps.pendente.valor, cor:'#E2574C', txt:fmtBRLfront(ps.pendente.valor)},
      ].filter(x=>x.valor>0)))+
  '</div>';
}
async function handleEventoDreToggle(id){
  if(state.eventoDreAberto===id){ state.eventoDreAberto = null; state.eventoDre = null; return render(); }
  try{
    state.eventoDre = await api('/api/evento-dre/'+id, {adminAuth:true});
    state.eventoDreAberto = id;
    await render();
  }catch(e){ alert(e.message); }
}
async function handleBaixarEventoDre(id, fmt){
  try{
    const res = await fetch('/api/evento-dre/'+id+'/'+fmt, {headers:{Authorization:'Bearer '+(state.adminToken || state.token)}});
    if(!res.ok){ let msg = 'Não foi possível gerar o arquivo.'; try{ msg = (await res.json()).erro || msg; }catch(e){} alert(msg); return; }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = m ? m[1] : ('dre-evento.'+fmt); a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(href), 60000);
  }catch(e){ alert('Erro ao gerar o arquivo: '+e.message); }
}
// aba "Eventos" da Resenha: todos os eventos da agenda (data, local, pagamento) e a lista de participantes do evento marcado
function renderEventoAbaHtml(){
  const l = state.eventoLista;
  const eventos = (state.homeExtras && state.homeExtras.eventos) || [];
  if(!eventos.length) return '<div class="empty">Nenhum evento cadastrado ainda.</div>';
  let h = '';
  eventos.forEach(e=>{
    const wa = waLink(e.responsavelTel);
    // Card 1: nome, data e descrição
    h += '<div class="card hz hz-roxo evt-c1"><h3 class="evt-card-nome">'+escapeHtml(e.nome)+'</h3><div class="evt-data">'+formatDataBR(e.data)+'</div>'+
      (e.descricao ? '<p class="small avisos-text evt-desc">'+escapeHtml(e.descricao)+'</p>' : '')+'</div>';
    // Card 2: gestor (com WhatsApp quando há telefone)
    if(e.responsavel){
      h += '<div class="card hz hz-azul evt-c2"><div class="evt-gestor">👤 Gestor: <strong>'+escapeHtml(nomeExibicaoPorNomeReal(e.responsavel))+'</strong>'+
        (wa ? '<a class="wa-link" href="'+wa+'" target="_blank" rel="noopener" title="Falar no WhatsApp">'+WA_ICON+'</a>' : '')+'</div></div>';
    }
    // Card 3: local (Waze / Maps / Uber)
    if(e.local) h += '<div class="card hz hz-ciano evt-c3">'+localBotoesHtml(e)+'</div>';
    // dados para pagamento do evento
    if(e.pagamento && (e.pagamento.nome || e.pagamento.chavePix || e.pagamento.valor)) h += '<div class="card hz hz-verde evt-c-pgto">'+pagamentoEventoHtml(e.pagamento)+'</div>';
    // Cards 4 e 5: resumo + lista de participantes
    if(e.mostrarParticipantes){
      h += (l && l.participantes.length) ? participantesBlocoHtml(l) : '<div class="card hz hz-dourado"><p class="small muted" style="margin:0;text-align:center;">A lista de participantes ainda não foi cadastrada.</p></div>';
    }
    // DRE do evento: só o gestor do evento
    if(souGestorDoEvento(e)){
      const aberto = state.eventoDreAberto===e.id && state.eventoDre;
      h += '<div class="card hz hz-dourado evt-c-dre"><button type="button" class="btn'+(aberto?' secondary':'')+'" data-action="evento-dre-toggle" data-id="'+e.id+'">📊 DRE do evento '+(aberto?'▲':'▼')+'</button>'+(aberto ? dreEventoPainelHtml(state.eventoDre) : '')+'</div>';
    }
  });
  return h;
}

// ---- REDES SOCIAIS (aba da Resenha)
const LINK_SPOTIFY = 'https://open.spotify.com/playlist/5yrAcmZ6MYoaUUAT18IFOY?si=33d454bc5e824902';
const LINK_INSTAGRAM = 'https://www.instagram.com/boleragefd/';
function renderRedesHtml(){
  return '<div class="card hz hz-verde rede-card"><div class="rede-ico">🎧</div><h3>Spotify Bolerage</h3>'+
      '<p class="small muted" style="text-align:center;">A playlist oficial da resenha. Dá o play e bora pro churrasco!</p>'+
      '<a class="btn rede-btn rede-spotify" href="'+LINK_SPOTIFY+'" target="_blank" rel="noopener">▶ Ouvir a playlist</a></div>'+
    '<div class="card hz hz-roxo rede-card"><div class="rede-ico">📸</div><h3>Instagram Bolerage</h3>'+
      '<p class="small muted" style="text-align:center;">Fotos, vídeos e resenhas do grupo. Segue lá: <strong style="color:var(--text)">@boleragefd</strong></p>'+
      '<a class="btn rede-btn rede-insta" href="'+LINK_INSTAGRAM+'" target="_blank" rel="noopener">📷 Seguir no Instagram</a></div>';
}

// ---- TRAMPOS (aba da Resenha): vagas que os amigos indicam para o grupo
async function refreshTrampos(){ try{ state.trampos = (await api('/api/trampos', {auth:true})).trampos || []; }catch(e){} }
function linkWhatsApp(contato){
  const dig = String(contato||'').replace(/\D/g,'');
  return dig.length>=10 && dig.length<=13 && /^[\d\s()+\-]+$/.test(String(contato).trim()) ? 'https://wa.me/'+(dig.length<=11?'55':'')+dig : '';
}
function renderTramposHtml(){
  const lista = state.trampos || [];
  let h = '<div class="card hz hz-ciano" style="text-align:center;"><div class="rede-ico">💼</div><h3>Trampos</h3>'+
    '<p class="small muted">Sabe de uma vaga? Divulgue aqui para ajudar os amigos do grupo — e confira as indicações dos outros craques.</p>'+
    (state.trampoFormAberto ? '' : '<button class="btn" data-action="trampo-abrir">➕ Divulgar uma vaga</button>')+'</div>';
  if(state.trampoFormAberto){
    h += '<div class="card"><h3>Nova vaga</h3>'+
      '<div class="field"><label>Título da vaga *</label><input id="tr-titulo" maxlength="80" placeholder="Ex.: Auxiliar administrativo"></div>'+
      '<div class="field"><label>Empresa</label><input id="tr-empresa" maxlength="60"></div>'+
      '<div class="field"><label>Local / modelo (presencial, remoto...)</label><input id="tr-local" maxlength="60"></div>'+
      '<div class="field"><label>Contato (WhatsApp ou e-mail)</label><input id="tr-contato" maxlength="80" inputmode="email" placeholder="(11) 91234-5678 ou rh@empresa.com"></div>'+
      '<div class="field"><label>Link da vaga</label><input id="tr-link" maxlength="250" inputmode="url" placeholder="https://..."></div>'+
      '<div class="field"><label>Descrição</label><textarea id="tr-descricao" maxlength="700" rows="4" style="width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg-elevated-2);color:var(--text);font-family:var(--font-body);font-size:14.5px;"></textarea></div>'+
      '<div class="btn-row"><button class="btn" data-action="trampo-publicar">Publicar vaga</button><button class="btn secondary" data-action="trampo-cancelar">Cancelar</button></div></div>';
  }
  if(!lista.length){
    h += '<div class="empty">Nenhuma vaga divulgada ainda. Seja o primeiro a indicar!</div>';
  }else{
    lista.forEach(t=>{
      const wa = linkWhatsApp(t.contato);
      const data = new Date(t.criadoEm); const dtxt = isNaN(data) ? '' : data.toLocaleDateString('pt-BR');
      h += '<div class="card hz hz-verde trampo-card"><h3 class="trampo-titulo">'+escapeHtml(t.titulo)+'</h3>'+
        '<div class="trampo-chips">'+(t.empresa?'<span class="badge">🏢 '+escapeHtml(t.empresa)+'</span>':'')+(t.local?'<span class="badge">📍 '+escapeHtml(t.local)+'</span>':'')+'</div>'+
        (t.descricao ? '<p class="small avisos-text" style="margin:8px 0;">'+escapeHtml(t.descricao)+'</p>' : '')+
        '<div class="trampo-acoes">'+
          (t.link ? '<a class="btn small" href="'+escapeHtml(t.link)+'" target="_blank" rel="noopener noreferrer">🔗 Ver vaga</a>' : '')+
          (wa ? '<a class="btn small" href="'+wa+'" target="_blank" rel="noopener">💬 WhatsApp</a>' : (t.contato ? '<span class="badge">📞 '+escapeHtml(t.contato)+'</span>' : ''))+
        '</div>'+
        '<div class="trampo-rodape"><span class="small muted">Indicada por <strong style="color:var(--text)">'+escapeHtml(t.autor)+'</strong>'+(dtxt?' • '+dtxt:'')+'</span>'+
          (t.posso_remover ? '<button class="btn danger small" data-action="trampo-remover" data-id="'+t.id+'">remover</button>' : '')+'</div></div>';
    });
  }
  return h;
}
async function handlePublicarTrampo(){
  const g = id => document.getElementById(id).value;
  try{
    await api('/api/trampos', {method:'POST', auth:true, body:{titulo:g('tr-titulo'), empresa:g('tr-empresa'), local:g('tr-local'), contato:g('tr-contato'), link:g('tr-link'), descricao:g('tr-descricao')}});
    state.trampoFormAberto = false; await refreshTrampos(); state._lastContentKey = null; render(); showToast('Vaga publicada!');
  }catch(e){ alert(e.message); }
}
async function handleRemoverTrampo(id){
  if(!confirm('Remover esta vaga?')) return;
  try{ await api('/api/trampos/'+id, {method:'DELETE', auth:true}); await refreshTrampos(); render(); }
  catch(e){ alert(e.message); }
}

// ---- RIFAS (aba da Resenha): ganhador e prêmio da rifa da rodada
async function refreshRifasAdmin(){ try{ state.rifasAdmin = (await api('/api/admin/rifas', {adminAuth:true})).rifas || []; }catch(e){} }
async function refreshRifas(){ try{ state.rifas = (await api('/api/rifas')).rifas || []; }catch(e){} }
function renderRifasHtml(){
  const rifas = state.rifas || [];
  if(!rifas.length){
    return '<div class="card rifa-card"><div class="rifa-trofeu">🎟️</div><h2 class="titulo-centralizado">Rifa da Rodada</h2>'+
      '<p class="small muted" style="text-align:center;">O ganhador e o prêmio da rifa serão exibidos aqui assim que o administrador cadastrar.</p></div>';
  }
  const atual = rifas[0];
  let h = '<div class="card rifa-card"><div class="rifa-trofeu">🏆</div><h2 class="titulo-centralizado" style="margin-bottom:0;">Ganhador da Rifa</h2>'+
    '<p class="rodada-sub">Rodada '+formatDataBR(atual.data)+'</p>'+
    '<div class="rifa-ganhador">'+escapeHtml(nomeExibicaoPorNomeReal(atual.ganhador))+'</div>'+
    (atual.premio ? '<div class="rifa-premio"><span class="rifa-premio-rot">🎁 Prêmio</span><strong>'+escapeHtml(atual.premio)+'</strong></div>' : '')+
  '</div>';
  if(rifas.length>1){
    // Hall dos Sortudos: destaque dourado + selo "🔥 N× ganhador" para quem ganhou mais de uma vez
    const vit = {};
    rifas.forEach(r=>{ const k = String(r.ganhador).trim().toLowerCase(); vit[k] = (vit[k]||0)+1; });
    h += '<div class="rifa-hall"><div class="rifa-hall-tit">🍀 HALL DOS SORTUDOS</div><div class="rifa-hall-sub">Ganhadores anteriores</div>';
    rifas.slice(1).forEach(r=>{
      const n = vit[String(r.ganhador).trim().toLowerCase()];
      h += '<div class="rifa-hall-item'+(n>1?' rifa-hall-repete':'')+'"><div class="rifa-hall-trofeu">'+(n>1?'👑':'🏆')+'</div>'+
        '<div class="rifa-hall-info"><div class="rifa-hall-nome">'+escapeHtml(nomeExibicaoPorNomeReal(r.ganhador))+(n>1?' <span class="rifa-hall-x">🔥 '+n+'× ganhador</span>':'')+'</div>'+
        '<div class="rifa-hall-premio">🎁 '+escapeHtml(r.premio||'sem prêmio informado')+'</div></div>'+
        '<span class="rifa-hall-data">'+formatDataBR(r.data)+'</span></div>';
    });
    h += '</div>';
  }
  return h;
}
function renderResenha(){
  const rodAtual = state.rodadaAtual;
  if(!rodAtual){
    setContent('<div class="empty">Nenhuma rodada agendada ainda.</div>', 'resenha'); return;
  }
  const meuId = state.currentPlayer.id;
  const idsResenhaAtual = rodAtual.resenha || [];
  const euNaResenha = idsResenhaAtual.includes(meuId);
  const euNoVinho = (rodAtual.vinho || []).includes(meuId);

  const abaEventoAtiva = !(state.homeExtras && state.homeExtras.eventoAba && state.homeExtras.eventoAba.ativa===false);
  let ab = state.resenhaAba || 'resenha';
  if(ab==='evento' && !abaEventoAtiva) ab = 'resenha';
  const abasResenha = '<div class="tabtoggle tabtoggle-grid">'+
      '<button data-action="resenha-aba" data-aba="resenha" class="'+(ab==='resenha'?'active':'')+'">Resenha</button>'+
      '<button data-action="resenha-aba" data-aba="rifas" class="'+(ab==='rifas'?'active':'')+'">🎟️ Rifas</button>'+
      '<button data-action="resenha-aba" data-aba="redes" class="'+(ab==='redes'?'active':'')+'">📲 Redes Sociais</button>'+
      '<button data-action="resenha-aba" data-aba="trampos" class="'+(ab==='trampos'?'active':'')+'">💼 Trampos</button>'+
      (abaEventoAtiva ? '<button data-action="resenha-aba" data-aba="evento" class="'+(ab==='evento'?'active':'')+'">🎉 Eventos</button>' : '')+
    '</div>';
  if(ab==='rifas'){ setContent(abasResenha + renderRifasHtml(), 'resenha-rifas'); return; }
  if(ab==='redes'){ setContent(abasResenha + renderRedesHtml(), 'resenha-redes'); return; }
  if(ab==='trampos'){ setContent(abasResenha + renderTramposHtml(), 'resenha-trampos'); return; }
  if(ab==='evento'){ setContent(abasResenha + renderEventoAbaHtml(), 'resenha-evento'); return; }

  let html = abasResenha + '<div class="card">'+
    '<h2 class="titulo-centralizado">Resenha com Churrasco do Próximo Domingão</h2>'+
    '<p class="rodada-sub">Rodada '+formatDataBR(rodAtual.data)+'</p>'+
    '<p class="small muted">Craque, se tivermos mais de 6 confirmados na resenha com churrasco, já conseguimos adiantar as compras e levar só o equivalente no domingo !!! \u{1F60E}</p>'+
  '</div>';

  // Check-in da resenha: disponível de sábado 8h até domingo 11h. Sempre vale pra
  // rodada ATUAL, mesmo se o histórico abaixo estiver mostrando uma rodada passada.
  if(rodAtual.resenhaCheckinAberto){
    html += '<div class="card"><h3>Sua resenha</h3>'+
      '<div class="presence-toggle-wrap">'+
        '<button class="presence-toggle '+(euNaResenha?'is-on':'is-off')+'" data-action="toggle-resenha" data-atual="'+(euNaResenha?'sim':'nao')+'"><span class="presence-toggle-knob"></span></button>'+
        '<div class="presence-toggle-label">'+(euNaResenha
          ? '<strong style="color:var(--green)">Você está na resenha</strong>'
          : '<span class="muted">Você não está na resenha</span>')+'</div>'+
      '</div>'+
      (euNaResenha ? '<div class="presence-toggle-wrap" style="margin-top:10px;">'+
        '<button class="presence-toggle '+(euNoVinho?'is-on':'is-off')+'" data-action="toggle-vinho" data-atual="'+(euNoVinho?'sim':'nao')+'"><span class="presence-toggle-knob"></span></button>'+
        '<div class="presence-toggle-label">'+(euNoVinho
          ? '<strong style="color:var(--green)">🍷 Vinho — Vou levar uma garrafa</strong>'
          : '<span class="muted">🍷 Vinho — Vou levar uma garrafa</span>')+'</div>'+
      '</div>' : '')+
    '</div>';
  }else{
    html += '<p class="small muted" style="padding:0 2px;">O check-in da resenha fica disponível de sábado às 8h até domingo às 11h.</p>';
  }

  // Confirmados na resenha da rodada atual (o histórico Bola Cheia x Bola Murcha foi para a tela Votação)
  const rod = rodAtual;
  const idsVinho = new Set(rod.vinho || []);
  const gente = (rod.resenha || []).map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
  const contagemCls = 'contagem-resenha'+(gente.length>6?' contagem-verde':'');
  html += '<div class="card"><h3 class="titulo-centralizado" style="margin-bottom:2px;">Confirmados na Resenha com Churrasco</h3>'+
    '<div class="resenha-total"><span class="'+contagemCls+'">'+gente.length+'</span><span class="resenha-total-rot">jogador'+(gente.length===1?'':'es')+' com check-in</span></div>';
  if(gente.length){
    gente.forEach(j=> html += '<div class="list-row"><span>'+escapeHtml(j.nome)+timeCoracaoSuffix(j.timeCoracao)+'</span><span class="row-right"><span class="badge ok-destaque">OK</span>'+(idsVinho.has(j.id)?'<span class="badge badge-vinho">🍷</span>':'')+'</span></div>');
  }else{
    html += '<p class="small muted" style="text-align:center;">Ninguém na resenha nessa rodada.</p>';
  }
  html += '</div>';
  setContent(html, 'resenha');
}

/* ============================================================
   RENDER: TAB SORTEIO
   ============================================================ */
function timeClass(nome){
  return 't-'+nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function timeFlag(nome){
  const k = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return {brasil:'\ud83c\udde7\ud83c\uddf7', argentina:'\ud83c\udde6\ud83c\uddf7', alemanha:'\ud83c\udde9\ud83c\uddea', italia:'\ud83c\uddee\ud83c\uddf9', holanda:'\ud83c\uddf3\ud83c\uddf1'}[k] || '';
}
// t\u00e1tica do time sorteado (5 jogadores de linha): defesa-meio-ataque, "aleat\u00f3ria"
// mas est\u00e1vel \u2014 sempre a mesma pra um mesmo time numa mesma rodada.
const FORMACOES_TIME = [[2,1,2],[2,2,1],[1,2,2]];
function hashStr(s){
  let h = 0;
  for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function renderSorteio(){
  const opcoes = [...state.rodadasLista].sort((a,b)=>a.data<b.data?1:-1)
    .map(r=>'<option value="'+r.id+'" '+(r.id===state.rodadaVisualizadaId?'selected':'')+'>'+formatDataBR(r.data)+'</option>').join('');
  let html = '<div class="field"><label>Rodada</label><select data-action="mudar-rodada-visualizada">'+opcoes+'</select></div>';

  const rod = state.rodadaVisualizada;
  if(!rod || !rod.times){
    html += '<div class="empty">'+
      '<p style="color:var(--text);font-weight:700;margin-bottom:4px;">🚨 AVISO IMPORTANTE:</p>'+
      '<p>Os times serão exibidos aqui assim que o sorteio for realizado.</p>'+
      '<p style="color:var(--text);font-weight:700;margin-top:16px;margin-bottom:4px;">📅 Quando acontece o sorteio ?</p>'+
      '<p>'+textoQuandoSorteio(rod)+'</p>'+
      '<p style="color:var(--text);font-weight:700;margin-top:16px;margin-bottom:4px;">🤔 Qual o critério do sorteio ?</p>'+
      '<p style="margin-bottom:0;">O app considera a média do ranking a fim de sortear times equilibrados.</p>'+
    '</div>';
    setContent(html, 'sorteio'); return;
  }
  html += '<p class="muted small">Sorteio '+(rod.times.modo==='fase2'?'equilibrado pelas notas do ranking':'aleatório (ainda sem dados suficientes para equilíbrio por nota)')+'.</p>';

  const golsPres = (rod.goleirosPresentes||[]);
  html += '<div class="gk-banner"><span class="gk-banner-label">🧤 Goleiros Presentes:</span> <strong class="gk-banner-nomes">'+
    (golsPres.length ? golsPres.map(id=>escapeHtml(nomeParaExibicao(id))+timeCoracaoSuffixDoId(id)).join(', ') : '<span class="muted">nenhum goleiro confirmado</span>')+
  '</strong></div>';

  const pitchChip = j => {
    const isConv = String(j.jogadorId).indexOf('conv:')===0;
    const isAlternar = j.papel==='alternar';
    // "Alternar Jogador" não é um papel de verdade — usa a posição padrão do
    // jogador só pra buscar a média certa no ranking (linha ou goleiro).
    const jr = isAlternar && !isConv ? state.elenco.find(x=>x.id===j.jogadorId) : null;
    const papelMedia = isAlternar ? (jr ? jr.posicaoPadrao : 'linha') : j.papel;
    const media = isConv ? null : mediaDoJogador(j.jogadorId, papelMedia);
    return '<div class="pitch-player'+(j.papel==='goleiro'?' pitch-player-gk':'')+'">'+
      '<span class="pitch-player-name">'+escapeHtml(nomeParaExibicao(j.jogadorId))+timeCoracaoSuffixDoId(j.jogadorId)+'</span>'+
      (isConv ? '<span class="small muted">convidado</span>' : starsHtml(media))+
    '</div>';
  };

  rod.times.times.forEach(t=>{
    const fl = timeFlag(t.nome);
    const golPlayers = t.jogadores.filter(j=>j.papel==='goleiro');
    const linhaPlayers = t.jogadores.filter(j=>j.papel==='linha');
    const alternarPlayers = t.jogadores.filter(j=>j.papel==='alternar');

    // tática do time: 2-1-2 / 2-2-1 / 1-2-2 (defesa-meio-ataque), sorteada — mas
    // fixa por time/rodada (hash do id da rodada + nome do time), pra não mudar
    // sozinha a cada atualização da tela.
    let formLabel = '', linhaAtaque=[], linhaMeio=[], linhaDefesa=[];
    if(linhaPlayers.length===5){
      const formacao = FORMACOES_TIME[hashStr(rod.id+'|'+t.nome) % FORMACOES_TIME.length];
      formLabel = formacao.join('-');
      linhaDefesa = linhaPlayers.slice(0, formacao[0]);
      linhaMeio = linhaPlayers.slice(formacao[0], formacao[0]+formacao[1]);
      linhaAtaque = linhaPlayers.slice(formacao[0]+formacao[1]);
    }else{
      const meio2 = Math.ceil(linhaPlayers.length/2);
      linhaAtaque = linhaPlayers.slice(0, meio2);
      linhaDefesa = linhaPlayers.slice(meio2);
    }

    // score do time: média das notas do ranking de quem está escalado (ignora
    // convidados e quem ainda não tem avaliação).
    const mediasTime = t.jogadores.filter(j=>String(j.jogadorId).indexOf('conv:')!==0).map(j=>{
      const isAlt = j.papel==='alternar';
      const jr = isAlt ? state.elenco.find(x=>x.id===j.jogadorId) : null;
      const papelMedia = isAlt ? (jr ? jr.posicaoPadrao : 'linha') : j.papel;
      return mediaDoJogador(j.jogadorId, papelMedia);
    }).filter(m=>m!=null);
    const mediaTime = mediasTime.length ? mediasTime.reduce((a,b)=>a+b,0)/mediasTime.length : null;

    // craque destaque do time: quem tem a maior média no Ranking Geral entre os
    // escalados (ignora convidados).
    let craqueDestaque = null;
    t.jogadores.filter(j=>String(j.jogadorId).indexOf('conv:')!==0).forEach(j=>{
      const isAlt = j.papel==='alternar';
      const jr = isAlt ? state.elenco.find(x=>x.id===j.jogadorId) : null;
      const papelMedia = isAlt ? (jr ? jr.posicaoPadrao : 'linha') : j.papel;
      const media = mediaDoJogador(j.jogadorId, papelMedia);
      if(media!=null && (!craqueDestaque || media>craqueDestaque.media)) craqueDestaque = {jogadorId:j.jogadorId, media};
    });

    html += '<div class="team-card '+timeClass(t.nome)+'">'+
      '<div class="team-header">'+
        '<h2>'+(fl?'<span class="team-flag">'+fl+'</span>':'')+t.nome+'</h2>'+
        '<div class="team-score">'+starsHtml(mediaTime, true)+'</div>'+
      '</div>';
    html += '<div class="pitch">'+
      '<div class="pitch-halfway"></div><div class="pitch-box pitch-box-top"></div><div class="pitch-box pitch-box-bottom"></div>';
    if(linhaAtaque.length) html += '<div class="pitch-row">'+linhaAtaque.map(pitchChip).join('')+'</div>';
    if(linhaMeio.length) html += '<div class="pitch-row">'+linhaMeio.map(pitchChip).join('')+'</div>';
    if(linhaDefesa.length) html += '<div class="pitch-row">'+linhaDefesa.map(pitchChip).join('')+'</div>';
    if(golPlayers.length) html += '<div class="pitch-row pitch-row-gk">'+golPlayers.map(pitchChip).join('')+'</div>';
    html += '</div>';
    if(formLabel || craqueDestaque){
      html += '<div class="team-footer">'+
        (formLabel ? '<p class="team-footer-line"><span class="team-footer-label">Plano Tático = </span><strong class="team-footer-valor">'+formLabel+'</strong></p>' : '')+
        (craqueDestaque ? '<p class="team-footer-line"><span class="team-footer-label">Destaque = </span><strong class="team-footer-valor">'+escapeHtml(nomeParaExibicao(craqueDestaque.jogadorId))+timeCoracaoSuffixDoId(craqueDestaque.jogadorId)+'</strong> '+starsHtml(craqueDestaque.media, true)+'</p>' : '')+
      '</div>';
    }
    if(alternarPlayers.length){
      html += '<div class="pitch-bench"><h4>🔄 Alternar Jogador (revezam durante a partida)</h4><div class="pitch-row">'+alternarPlayers.map(pitchChip).join('')+'</div></div>';
    }
    html += '</div>';
  });
  if(rod.times.reservas && rod.times.reservas.length){
    html += '<div class="card"><h3>Reservas desta rodada</h3>';
    rod.times.reservas.forEach(id=>{
      const isConv = String(id).indexOf('conv:')===0;
      const jr = state.elenco.find(x=>x.id===id);
      const media = (isConv || !jr) ? null : mediaDoJogador(id, jr.posicaoPadrao);
      html += '<div class="list-row"><span>'+escapeHtml(nomeParaExibicao(id))+timeCoracaoSuffixDoId(id)+'</span>'+
        ((isConv||!jr)?'':'<span class="row-right">'+starsHtml(media, true)+'</span>')+'</div>';
    });
    html += '</div>';
  }
  setContent(html, 'sorteio');
}

/* ============================================================
   RENDER: TAB VOTAÇÃO
   ============================================================ */
function seletorRodadaVisualizadaHtml(rotulo){
  const ops = [...state.rodadasLista].sort((a,b)=>a.data<b.data?1:-1)
    .map(r=>'<option value="'+r.id+'" '+(r.id===state.rodadaVisualizadaId?'selected':'')+'>'+formatDataBR(r.data)+'</option>').join('');
  return '<div class="field"><label>'+rotulo+'</label><select data-action="mudar-rodada-visualizada">'+ops+'</select></div>';
}
// Tela VOTAÇÃO > aba "Votos dos Jogadores" (só aparece se o ADMIN habilitou no painel)
function renderVotosDosJogadores(abasHtml){
  const rodV = state.rodadaVisualizada || state.rodadaAtual;
  let h = abasHtml + seletorRodadaVisualizadaHtml('Rodada dos votos');
  if(!rodV){ setContent(h+'<div class="empty">Ainda sem votos.</div>', 'votacao-votos'); return; }
    const porAvaliador = {};
    (rodV.votos||[]).forEach(v=>{
      if(!v.avaliadorId || !v.avaliadoId || v.avaliadoId.indexOf('conv:')===0) return;
      (porAvaliador[v.avaliadorId] = porAvaliador[v.avaliadorId] || []).push(v);
    });
    const nomeJ = id => { const j = state.elenco.find(x=>x.id===id); return j ? j.nome : '?'; };
    const ids = Object.keys(porAvaliador).sort((a,b)=>nomeJ(a).localeCompare(nomeJ(b),'pt-BR'));
    h += finZona('azul', '🗳️ VOTOS DOS JOGADORES', 'Rodada '+formatDataBR(rodV.data)+' • o voto que cada jogador atribuiu aos colegas', '');
    if(!ids.length){
      h += '<div class="empty">Ainda sem votos nesta rodada.</div>';
    }else{
      ids.forEach(idAv=>{
        const lista = porAvaliador[idAv].slice().sort((a,b)=> (b.nota-a.nota) || nomeJ(a.avaliadoId).localeCompare(nomeJ(b.avaliadoId),'pt-BR'));
        // botão CORNETA: abre o WhatsApp de quem votou (só se ele cadastrou o celular)
        const tel = (rodV.telefonesVotantes||{})[idAv];
        const primeiroNome = nomeJ(idAv).split(' ')[0];
        const btnCorneta = tel
          ? '<a class="btn small corneta-btn" href="https://wa.me/'+tel+'?text='+encodeURIComponent('Opa, '+primeiroNome+' !!! Notei seu voto no BolerApp e gostaria de falar sobre o assunto, craque !!! :)')+'" target="_blank" rel="noopener">🎺 CORNETA</a>'
          : '';
        // cor do bloco pela média que o votante deu: generoso (verde) ... rigoroso (vermelho)
        const med = lista.reduce((t,v)=>t+v.nota,0)/lista.length;
        const corV = med>=4 ? 'verde' : med>=3 ? 'dourado' : med>=2 ? 'laranja' : 'vermelho';
        let corpo = '<div class="voter-topo"><h3 class="voter-name">'+escapeHtml(nomeJ(idAv))+timeCoracaoSuffixDoId(idAv)+'</h3>'+
            (tel ? '<div class="voter-sac"><span class="sac-rot">SAC =</span>'+btnCorneta+'</div>' : '')+'</div>'+
          '<div class="fin-zona-sub">votou em '+lista.length+' jogador'+(lista.length>1?'es':'')+' • média dada '+med.toFixed(1).replace('.',',')+'</div>';
        lista.forEach((v,i)=>{
          corpo += '<div class="fin-row"><span class="fin-pos">'+(i+1)+'</span><span class="fin-nome">'+escapeHtml(nomeJ(v.avaliadoId))+timeCoracaoSuffixDoId(v.avaliadoId)+'</span><span class="voto-nota n'+v.nota+'">'+v.nota+' ★</span></div>';
        });
        h += '<div class="fin-zona fz-'+corV+'">'+corpo+'</div>';
      });
    }
  setContent(h, 'votacao-votos');
}
// Tela VOTAÇÃO > "Histórico Bola Cheia x Bola Murcha": quem foi Bola Cheia/Murcha em cada rodada
function renderHistoricoBola(abasHtml){
  const rod = state.rodadaVisualizada || state.rodadaAtual;
  let html = abasHtml + seletorRodadaVisualizadaHtml('Histórico Bola Cheia x Bola Murcha — escolha a rodada');
  if(!rod){ setContent(html+'<div class="empty">Nenhuma rodada agendada ainda.</div>', 'votacao-historico'); return; }
  // só com os votos DA RODADA ESCOLHIDA (ignora o ranking geral)
  const aggRod = {};
  (rod.votos || []).forEach(v=>{
    if(!v.avaliadoId || v.avaliadoId.indexOf('conv:')===0) return;
    const a = aggRod[v.avaliadoId] || (aggRod[v.avaliadoId] = {soma:0, n:0});
    a.soma += v.nota; a.n += 1;
  });
  const rankRod = Object.keys(aggRod)
    .map(id=>({id, media:aggRod[id].soma/aggRod[id].n, n:aggRod[id].n}))
    .sort((x,y)=> (y.media - x.media) || (y.n - x.n));
  const nomeDe = id => { const j = state.elenco.find(x=>x.id===id); return j ? j.nome : '?'; };
  const cartaoBola = (icone, id, media, n) =>
    '<div class="hist-bola"><div class="hist-bola-ico">'+icone+'</div><div class="hist-bola-info"><div class="hist-bola-nome">'+escapeHtml(nomeDe(id))+timeCoracaoSuffixDoId(id)+'</div>'+
    '<div class="hist-bola-sub">média da rodada em '+n+' voto'+(n===1?'':'s')+'</div></div><div class="hist-bola-stars">'+starsHtml(media, true)+'</div></div>';
  html += finZona('azul', '⚽ BOLA CHEIA x BOLA MURCHA', 'Rodada '+formatDataBR(rod.data)+' • considera só os votos desta rodada', '');
  if(rankRod.length){
    const cheia = rankRod[0];
    const murcha = rankRod.length >= 2 ? rankRod[rankRod.length-1] : null;
    html += finZona('verde', '🏆 BOLA CHEIA', 'A melhor média da rodada', cartaoBola('🏆', cheia.id, cheia.media, cheia.n));
    if(murcha) html += finZona('vermelho', '📉 BOLA MURCHA', 'A pior média da rodada', cartaoBola('🏈', murcha.id, murcha.media, murcha.n));
    // classificação completa da rodada
    let lista = '';
    rankRod.forEach((r,i)=>{
      const cls = i===0 ? 'hist-top' : (i===rankRod.length-1 && rankRod.length>=2) ? 'hist-ultimo' : '';
      lista += '<div class="fin-row '+cls+'"><span class="fin-pos">'+(i+1)+'</span><span class="fin-nome">'+escapeHtml(nomeDe(r.id))+timeCoracaoSuffixDoId(r.id)+'</span><span class="fin-valor">'+starsHtml(r.media)+'</span></div>';
    });
    html += finZona('dourado', '📋 CLASSIFICAÇÃO DA RODADA', rankRod.length+' jogador'+(rankRod.length===1?'':'es')+' avaliado'+(rankRod.length===1?'':'s'), lista);
  }else{
    html += finZona('cinza', '🕐 SEM VOTOS', 'Ainda sem votos nesta rodada', '');
  }
  setContent(html, 'votacao-historico');
}
function renderVotacao(){
  const c = document.getElementById('content');
  const rod = state.rodadaAtual;
  const mostrarAbaVotos = !!(rod && rod.mostrarVotos);
  let abaVot = state.votacaoAba || 'votar';
  if(abaVot==='votos' && !mostrarAbaVotos) abaVot = 'votar';
  const abasVot = '<div class="tabtoggle tabtoggle-wrap">'+
      '<button data-action="votacao-aba" data-aba="votar" class="'+(abaVot==='votar'?'active':'')+'">Votação</button>'+
      '<button data-action="votacao-aba" data-aba="historico" class="'+(abaVot==='historico'?'active':'')+'">Histórico Bola Cheia x Bola Murcha</button>'+
      (mostrarAbaVotos ? '<button data-action="votacao-aba" data-aba="votos" class="'+(abaVot==='votos'?'active':'')+'">Votos dos Jogadores</button>' : '')+
    '</div>';
  if(abaVot==='votos'){ renderVotosDosJogadores(abasVot); return; }
  if(abaVot==='historico'){ renderHistoricoBola(abasVot); return; }
  if(!rod || rod.status!=='sorteado'){
    c.innerHTML = abasVot+'<div class="empty">'+
      '<p style="color:var(--text);font-weight:700;margin-bottom:4px;">🚨 AVISO IMPORTANTE:</p>'+
      '<p>Os nomes dos craques serão exibidos aqui quando os times da semana forem sorteados.</p>'+
      '<div style="margin-top:16px;">'+infoVotacaoHtml()+'</div>'+
    '</div>'; return;
  }
  const fase = rod.fase;
  if(fase.chave!=='votacao_aberta'){
    const msg = fase.chave==='sorteado_aguardando_votacao'
      ? 'A votação abre hoje às 10h e fecha às 13h.'
      : 'A janela de votação (domingo, 10h às 13h) está fechada.';
    c.innerHTML = abasVot+'<div class="empty"><p style="color:var(--text);font-weight:700;margin-bottom:12px;">'+msg+'</p>'+infoVotacaoHtml()+'</div>'; return;
  }
  const meuId = state.currentPlayer.id;
  const participei = rod.times.times.some(t=>t.jogadores.some(j=>j.jogadorId===meuId)) || rod.times.reservas.includes(meuId) || (rod.goleirosPresentes||[]).includes(meuId)
    || (!!state.currentPlayer.corneta && (rod.confirmados||[]).includes(meuId));
  if(!participei){
    c.innerHTML = abasVot+'<div class="empty">Você não participou desta rodada (nem escalado, nem reserva) e por isso não pode votar.</div>'; return;
  }
  const alvosTimes = rod.times.times.flatMap(t=>t.jogadores.map(j2=>({jogadorId:j2.jogadorId, time:t.nome})));
  const alvosReservas = rod.times.reservas.map(id=>({jogadorId:id, time:'Reserva'}));
  const alvosGoleiros = (rod.goleirosPresentes||[]).filter(id=>!alvosTimes.some(a=>a.jogadorId===id)).map(id=>({jogadorId:id, time:'Goleiro'}));
  const alvos = [...alvosTimes, ...alvosGoleiros, ...alvosReservas].filter(a=>a.jogadorId!==meuId && !a.jogadorId.startsWith('conv:'));
  const meusVotos = {};
  rod.votos.filter(v=>v.avaliadorId===meuId).forEach(v=>meusVotos[v.avaliadoId]={nota:v.nota, edicoes:v.edicoes||0});

  let html = '<div class="card"><p class="small">Avalie a performance de quem jogou hoje, de 1 a 5 estrelas. Você pode mudar de ideia uma vez — depois disso o voto fica definitivo.</p></div>';
  alvos.forEach(a=>{
    const meuVoto = meusVotos[a.jogadorId];
    const notaAtual = meuVoto ? meuVoto.nota : null;
    const jaAlterou = meuVoto ? meuVoto.edicoes>=1 : false;
    const travado = notaAtual!=null && jaAlterou;
    html += '<div class="card"><div class="list-row" style="border:none;padding:0 0 4px 0;"><span>'+escapeHtml(nomeParaExibicao(a.jogadorId))+timeCoracaoSuffixDoId(a.jogadorId)+' <span class="badge">'+a.time+'</span></span></div>';
    html += '<div class="vote-scale">';
    for(let n=1;n<=5;n++){
      html += '<button class="vote-btn star-vote-btn '+(notaAtual!=null && n<=notaAtual?'selected':'')+'" '+(travado?'disabled':'')+' data-action="votar" data-avaliado="'+a.jogadorId+'" data-nota="'+n+'">★</button>';
    }
    html += '</div>'+(travado
      ? '<p class="small muted" style="margin-top:6px;">Voto salvo: '+notaAtual+' estrela(s) — não pode ser alterado.</p>'
      : notaAtual!=null
        ? '<p class="small" style="margin-top:6px;color:var(--gold);">Voto salvo: '+notaAtual+' estrela(s). Você ainda tem mais 1 possibilidade de alterar o voto.</p>'
        : '')+'</div>';
  });
  c.innerHTML = abasVot + html;
}
async function handleVotar(avaliadoId, nota){
  try{ await api('/api/rodadas/'+state.rodadaAtual.id+'/votos', {method:'POST', auth:true, body:{avaliadoId, nota}}); await refreshRodadaAtual(); render(); }
  catch(e){ alert(e.message); }
}

/* ============================================================
   GRÁFICO DE DESEMPENHO (clique no jogador, na tela Ranking)
   ============================================================ */
function perfChartSvg(serie){
  const W = 340, H = 210, L = 30, R = 12, T = 14, B = 34;
  const iw = W-L-R, ih = H-T-B;
  const n = serie.length;
  const x = i => n===1 ? L+iw/2 : L + iw*i/(n-1);
  const y = v => T + ih*(1 - Math.max(0, Math.min(5, v))/5);
  let g = '';
  for(let v=0; v<=5; v++){
    g += '<line x1="'+L+'" y1="'+y(v).toFixed(1)+'" x2="'+(W-R)+'" y2="'+y(v).toFixed(1)+'" class="perf-grid"/>'+
         '<text x="'+(L-6)+'" y="'+(y(v)+3).toFixed(1)+'" class="perf-axis" text-anchor="end">'+v+'</text>';
  }
  const passo = Math.max(1, Math.ceil(n/6));
  serie.forEach((p,i)=>{
    if(i%passo!==0 && i!==n-1) return;
    const d = p.data.slice(8,10)+'/'+p.data.slice(5,7);
    g += '<text x="'+x(i).toFixed(1)+'" y="'+(H-14)+'" class="perf-axis" text-anchor="middle">'+d+'</text>';
  });
  // média acumulada (com o desconto por ausência) = linha dourada
  const pts = serie.map((p,i)=> p.acumulada==null ? null : [x(i), y(p.acumulada)]).filter(Boolean);
  if(pts.length>1) g += '<polyline class="perf-line" points="'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+'"/>';
  pts.forEach(p=>{ g += '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3" class="perf-dot-acum"/>'; });
  // nota da rodada = pontos azuis; ausência = marca vermelha no eixo
  serie.forEach((p,i)=>{
    if(p.media!=null) g += '<circle cx="'+x(i).toFixed(1)+'" cy="'+y(p.media).toFixed(1)+'" r="4.5" class="perf-dot-rod"><title>'+p.data.slice(8,10)+'/'+p.data.slice(5,7)+': '+p.media.toFixed(1)+' ('+p.n+' voto(s))</title></circle>';
    else if(!p.presente) g += '<text x="'+x(i).toFixed(1)+'" y="'+(y(0)-4).toFixed(1)+'" class="perf-aus" text-anchor="middle">✕</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" class="perf-svg" role="img" aria-label="Desempenho do jogador por rodada">'+g+'</svg>';
}
function fecharPerformance(){
  const m = document.getElementById('perf-modal');
  if(m) m.remove();
}
async function abrirPerformance(jogadorId){
  fecharPerformance();
  const nome = jogadorNome(jogadorId);
  const m = document.createElement('div');
  m.id = 'perf-modal';
  m.className = 'perf-backdrop';
  m.setAttribute('data-action','fechar-performance');
  m.innerHTML = '<div class="perf-card" role="dialog" aria-modal="true" data-action="noop">'+
    '<button class="perf-close" data-action="fechar-performance" aria-label="Fechar">×</button>'+
    '<h2 class="perf-nome">'+escapeHtml(nome)+timeCoracaoSuffixDoId(jogadorId)+'</h2>'+
    '<p class="perf-sub">Performance</p>'+
    '<div id="perf-body"><div class="empty">Carregando…</div></div></div>';
  document.getElementById('shell').appendChild(m);
  let data;
  try{ data = await api('/api/ranking/jogador/'+encodeURIComponent(jogadorId)); }
  catch(e){ const b = document.getElementById('perf-body'); if(b) b.innerHTML = '<div class="empty">'+escapeHtml(e.message)+'</div>'; return; }
  const body = document.getElementById('perf-body');
  if(!body) return; // fechou enquanto carregava
  const serie = data.serie || [];
  const comVoto = serie.filter(p=>p.media!=null);
  if(!serie.length || !comVoto.length){
    body.innerHTML = '<div class="empty">Ainda não há votos suficientes para montar o gráfico.</div>'; return;
  }
  const ultimo = [...serie].reverse().find(p=>p.acumulada!=null);
  const melhor = comVoto.reduce((a,p)=> p.media>a.media ? p : a, comVoto[0]);
  const pior = comVoto.reduce((a,p)=> p.media<a.media ? p : a, comVoto[0]);
  const aus = serie.length ? serie[serie.length-1].ausencias : 0;
  const fd = d => d.slice(8,10)+'/'+d.slice(5,7);
  const pos = posicaoNoRankingGeral(jogadorId);
  const ROT = {top5:'As Lendas', top10:'Os Craques', under5:'Zona da Degola', meio:'A briga dos Guerreiros'};
  const KCOR = {top5:'dourado', top10:'azul', under5:'vermelho', meio:'laranja'};
  const medalhas = ['🥇','🥈','🥉'];
  const tiles = [];
  tiles.push('<div class="kpi kpi-sm kpi-dourado"><div class="kpi-num">'+(ultimo && ultimo.acumulada!=null ? ultimo.acumulada.toFixed(1).replace('.',',')+' ★' : '—')+'</div><div class="kpi-rot">média atual no ranking</div></div>');
  if(pos) tiles.push('<div class="kpi kpi-sm kpi-'+KCOR[pos.zona]+'"><div class="kpi-num">'+(pos.pos<=3 ? medalhas[pos.pos-1]+' ' : '')+pos.pos+'º</div><div class="kpi-rot">de '+pos.total+' • '+ROT[pos.zona]+'</div></div>');
  tiles.push('<div class="kpi kpi-sm kpi-verde"><div class="kpi-num">'+melhor.media.toFixed(1).replace('.',',')+' ★</div><div class="kpi-rot">melhor rodada ('+fd(melhor.data)+')</div></div>');
  tiles.push('<div class="kpi kpi-sm kpi-vermelho"><div class="kpi-num">'+pior.media.toFixed(1).replace('.',',')+' ★</div><div class="kpi-rot">pior rodada ('+fd(pior.data)+')</div></div>');
  tiles.push('<div class="kpi kpi-sm kpi-roxo"><div class="kpi-num">'+comVoto.length+'<small>/'+serie.length+'</small></div><div class="kpi-rot">rodadas avaliadas</div></div>');
  if(aus) tiles.push('<div class="kpi kpi-sm kpi-laranja"><div class="kpi-num">'+aus+'</div><div class="kpi-rot">ausência'+(aus>1?'s':'')+' (−'+Math.round((1-Math.pow(0.9,aus))*100)+'% nos pontos)</div></div>');
  body.innerHTML = '<div class="fin-zona fz-azul perf-zona"><div class="fin-zona-tit">📈 EVOLUÇÃO POR RODADA</div>'+
      perfChartSvg(serie)+
      '<div class="perf-legenda small muted">'+
        '<span><i class="perf-key perf-key-acum"></i> Média acumulada (ranking)</span>'+
        '<span><i class="perf-key perf-key-rod"></i> Nota da rodada</span>'+
        '<span><b class="perf-aus">✕</b> Ausente</span>'+
      '</div></div>'+
    '<div class="kpi-grid">'+tiles.join('')+'</div>';
}

/* ============================================================
   RENDER: TAB RANKING
   ============================================================ */
async function renderRanking(){
  const c = document.getElementById('content');
  c.innerHTML = '<div class="empty">Calculando ranking…</div>';
  await refreshRanking();
  await refreshRankingBola();
  const ranking = state.ranking;
  // média geral de um jogador (linha + goleiro juntos, combinando os votos recebidos
  // em qualquer papel) — usada no Ranking Geral e também nos rankings Bola Cheia/Murcha.
  const mediaGeral = id => {
    const r = ranking[id];
    if(!r) return null;
    const total = r.linha.total + r.goleiro.total;
    if(!total) return null;
    const somaPontos = (r.linha.media!=null ? r.linha.media*r.linha.total : 0) + (r.goleiro.media!=null ? r.goleiro.media*r.goleiro.total : 0);
    return somaPontos/total;
  };
  // AUSENTES perdem 10% dos pontos por rodada ausente, em cascata (média × 0,9^ausências).
  const ausenciasDe = id => (state.ausencias||{})[id] || 0;
  const fatorAusencia = id => Math.pow(0.9, ausenciasDe(id));
  const mediaRanking = id => { const m = mediaGeral(id); return m==null ? null : m*fatorAusencia(id); };
  const textoAusencias = id => {
    const k = ausenciasDe(id);
    if(!k) return '';
    return ' &bull; <span class="rank-ausencia">'+k+' ausência'+(k>1?'s':'')+' (−'+Math.round((1-fatorAusencia(id))*100)+'%)</span>';
  };
  const totalVotosDe = id => { const r = ranking[id]; return r ? (r.linha.total+r.goleiro.total) : 0; };
  const nomeDe = id => { const j = state.elenco.find(x=>x.id===id); return j ? j.nome : '?'; };

  const aba = state.rankingAba || 'geral';
  let html = '<div class="tabtoggle">'+
    '<button data-action="ranking-aba" data-aba="geral" class="'+(aba==='geral'?'active':'')+'">Ranking Geral</button>'+
    '<button data-action="ranking-aba" data-aba="cheia" class="'+(aba==='cheia'?'active':'')+'">Bola Cheia</button>'+
    '<button data-action="ranking-aba" data-aba="murcha" class="'+(aba==='murcha'?'active':'')+'">Bola Murcha</button>'+
  '</div>';

  if(aba==='geral'){
    const linhas = state.elenco.filter(j=>j.ativo).map(j=>({id:j.id, nome:j.nome, media:mediaRanking(j.id), total:totalVotosDe(j.id)}));
    const comNota = linhas.filter(l=>l.media!=null).sort((a,b)=>b.media-a.media);
    const semNota = linhas.filter(l=>l.media==null);
    const n = comNota.length;
    // zonas: 1º ao 5º = As Lendas (Top 5); 6º ao 10º = Os Craques (Top 10); os 5 últimos (se houver mais de 10) = Zona da Degola
    const zonaDe = i => i<5 ? 'top5' : i<10 ? 'top10' : (n>10 && i>=Math.max(10, n-5)) ? 'under5' : 'meio';
    const ZONAS = {
      top5:   {tit:'🏆 TOP 5 — AS LENDAS', sub:'A briga pela liderança é aqui. Cada décimo conta!'},
      top10:  {tit:'⭐ TOP 10 — OS CRAQUES', sub:'Mais uma boa rodada e você entra no Top 5!'},
      meio:   {tit:'⚔️ A BRIGA DOS GUERREIROS', sub:'A tabela vira a cada rodada — todo guerreiro pode subir!'},
      under5: {tit:'⚠️ ZONA DA DEGOLA — PRECISAM MELHORAR ESSAS FERAS', sub:'Zona de alerta (rebaixamento só na brincadeira 😄). Uma boa rodada te tira daqui!'},
    };
    const d2 = v => v.toFixed(2).replace('.',',');
    // texto de incentivo em NÚMEROS INTEIROS: 1 ponto = 0,1 estrela (a mesma casa decimal exibida
    // nas estrelas). Ex.: 4,4 e 4,2 exibidos = 2 pontos — ninguém precisa fazer conta.
    const dec = v => Math.round(v*10);
    const pts = k => k+' ponto'+(k===1?'':'s');
    const gapTxt = i => {
      const m = comNota[i].media, z = zonaDe(i);
      if(i===0){
        if(n<2) return '👑 Líder';
        const dif = dec(m)-dec(comNota[1].media);
        return dif<=0 ? '👑 Líder — empatado com o 2º no placar' : '👑 Líder • '+pts(dif)+' de vantagem sobre o 2º';
      }
      if(z==='under5'){
        const dif = dec(comNota[Math.max(0, n-6)].media) - dec(m);   // até o 1º jogador fora da zona
        return dif<=0 ? 'Empatado com a saída da zona — um voto resolve!' : 'A '+pts(dif)+' de sair da zona';
      }
      if(i===5){ const dif = dec(comNota[4].media)-dec(m); return dif<=0 ? 'Empatado com o Top 5 — falta pouco!' : 'A '+pts(dif)+' de entrar no Top 5'; }
      if(i>=1 && (z==='top5' || z==='top10')){ const dif = dec(comNota[i-1].media)-dec(m); return dif<=0 ? '▲ Empatado com o posto acima' : '▲ A '+pts(dif)+' do posto acima'; }
      if(n>10 && i===Math.max(10, n-5)-1){ const dif = dec(m)-dec(comNota[Math.max(10,n-5)].media); return dif<=0 ? '🔥 Colado na zona: empatado com o 1º da zona' : '🔥 Colado na zona: '+pts(dif)+' de vantagem'; }
      return '';
    };
    const posHtml = i => i===0 ? '<span class="rank-medalha">🥇</span>' : i===1 ? '<span class="rank-medalha">🥈</span>' : i===2 ? '<span class="rank-medalha">🥉</span>' : String(i+1);
    if(!n){
      html += '<div class="card"><p class="muted small">Ainda não há avaliações suficientes.</p></div>';
    }else{
      html += '<div class="rank-legenda">'+
        '<span class="rank-chip chip-top5">🏆 As Lendas</span>'+
        '<span class="rank-chip chip-top10">⭐ Os Craques</span>'+
        (n>10 ? '<span class="rank-chip chip-meio">⚔️ A briga dos Guerreiros</span>' : '')+
        (n>10 ? '<span class="rank-chip chip-under5">⚠️ Zona da Degola</span>' : '')+
      '</div>';
      let zonaAtual = null;
      comNota.forEach((l,i)=>{
        const z = zonaDe(i);
        if(z!==zonaAtual){
          if(zonaAtual!==null) html += '</div>';
          html += '<div class="card rank-zona zona-'+z+'"><div class="rank-zona-tit">'+ZONAS[z].tit+'</div><div class="rank-zona-sub">'+ZONAS[z].sub+'</div>';
          zonaAtual = z;
        }
        const gap = gapTxt(i);
        html += '<div class="rank-row rank-row-click rank-z-'+z+(i===0?' rank-lider':'')+'" data-action="ranking-jogador" data-id="'+l.id+'"><div class="rank-pos">'+posHtml(i)+'</div><div class="rank-name">'+escapeHtml(l.nome)+timeCoracaoSuffixDoId(l.id)+
          '<div class="rank-count">'+l.total+' avaliação(ões)'+textoAusencias(l.id)+'</div>'+
          (gap ? '<div class="rank-gap">'+gap+'</div>' : '')+
          '</div><div class="rank-avg">'+starsHtml(l.media, true)+'</div></div>';
      });
      html += '</div>';
      html += '<p class="small muted" style="margin:6px 2px 0;">Toque em um jogador para ver o gráfico de desempenho dele. <strong style="color:var(--text)">1 ponto = 0,1 estrela</strong> (ex.: 4,4 → 4,2 = 2 pontos).</p>';
    }
    html += '<p class="small muted" style="margin:10px 2px 0;">Jogadores AUSENTES perdem 10% dos pontos acumulados a cada rodada em que não estiverem presentes.</p>';
    if(semNota.length){
      html += '<div class="card"><h3>Ainda sem avaliações</h3>';
      semNota.forEach(l=> html += '<div class="list-row"><span>'+escapeHtml(l.nome)+timeCoracaoSuffixDoId(l.id)+'</span></div>');
      html += '</div>';
    }
  }else{
    // Ranking Bola Cheia / Bola Murcha: quantas vezes cada jogador já foi o Craque Bola
    // Cheia/Murcha de uma rodada (histórico completo — ver a lógica por rodada na aba
    // Resenha), com a média geral do jogador em estrelas ao lado.
    const isMurcha = aba==='murcha';
    const obj = isMurcha ? (state.rankingBola.murcha||{}) : (state.rankingBola.cheia||{});
    const lista = Object.keys(obj).map(id=>({id, nome:nomeDe(id), n:obj[id], media:mediaRanking(id)})).sort((a,b)=>b.n-a.n);
    const rotulo = isMurcha ? 'Bola Murcha' : 'Bola Cheia';
    const n = lista.length;
    // mesmas zonas do Ranking Geral (As Lendas / Os Craques / A briga dos Guerreiros); aqui não há Zona da Degola
    const zonaDe = i => i<5 ? 'top5' : i<10 ? 'top10' : 'meio';
    const ZB = isMurcha ? {
      top5:  {tit:'🏈 TOP 5 — BOLA MURCHA', sub:'Quem mais levou a Bola Murcha. Hora de reagir e sair dessa lista!'},
      top10: {tit:'⚠️ TOP 10 — NA MIRA', sub:'Cuidado: mais uma rodada ruim e você sobe nessa lista!'},
      meio:  {tit:'⚽ POR AQUI, TUDO BEM', sub:'Mantenha o nível e fique longe da Bola Murcha.'},
    } : {
      top5:  {tit:'🏆 TOP 5 — AS LENDAS DA BOLA CHEIA', sub:'Os maiores craques das rodadas. A briga pela liderança é aqui!'},
      top10: {tit:'⭐ TOP 10 — OS CRAQUES', sub:'Mais uma rodada brilhante e você entra no Top 5!'},
      meio:  {tit:'⚔️ A BRIGA DOS GUERREIROS', sub:'Uma grande rodada e você entra para a lista dos craques.'},
    };
    const vezes = k => k+' vez'+(k===1?'':'es');
    const gapB = i => {
      if(i===0) return isMurcha ? '😬 Líder da Bola Murcha — hora de reagir!' : (n>1 ? (lista[0].n===lista[1].n ? '👑 Líder — empatado com o 2º' : '👑 Líder • '+vezes(lista[0].n-lista[1].n)+' de vantagem sobre o 2º') : '👑 Líder');
      if(i===5){ const dif = lista[4].n-lista[i].n; return dif===0 ? 'Empatado com o Top 5 — falta pouco!' : 'A '+vezes(dif)+' de entrar no Top 5'; }
      const dif = lista[i-1].n-lista[i].n;
      return dif===0 ? '▲ Empatado com o posto acima' : '▲ A '+vezes(dif)+' do posto acima';
    };
    const posB = i => (i<3) ? '<span class="rank-medalha">'+(isMurcha ? '🏈' : ['🥇','🥈','🥉'][i])+'</span>' : String(i+1);
    if(!n){
      html += '<div class="card"><p class="muted small">Ainda sem rodadas com votos suficientes.</p></div>';
    }else{
      html += '<div class="rank-legenda">'+
        '<span class="rank-chip '+(isMurcha?'chip-murcha5':'chip-top5')+'">'+(isMurcha?'🏈 Top 5 Bola Murcha':'🏆 As Lendas')+'</span>'+
        '<span class="rank-chip '+(isMurcha?'chip-murcha10':'chip-top10')+'">'+(isMurcha?'⚠️ Top 10 Na Mira':'⭐ Os Craques')+'</span>'+
      '</div>';
      let zonaAtual = null;
      lista.forEach((l,i)=>{
        const z = zonaDe(i);
        if(z!==zonaAtual){
          if(zonaAtual!==null) html += '</div>';
          html += '<div class="card rank-zona zona-'+z+(isMurcha?' murcha':'')+'"><div class="rank-zona-tit">'+ZB[z].tit+'</div><div class="rank-zona-sub">'+ZB[z].sub+'</div>';
          zonaAtual = z;
        }
        html += '<div class="rank-row rank-row-click rank-z-'+z+(i===0?' rank-lider':'')+'" data-action="ranking-jogador" data-id="'+l.id+'"><div class="rank-pos">'+posB(i)+'</div><div class="rank-name">'+escapeHtml(l.nome)+timeCoracaoSuffixDoId(l.id)+
          '<div class="rank-count rank-count-bola'+(isMurcha?' rank-count-murcha':' rank-count-cheia')+'">'+l.n+'&#215; '+rotulo+'</div>'+
          '<div class="rank-gap">'+gapB(i)+'</div></div><div class="rank-avg'+(isMurcha?' rank-avg-murcha':'')+'">'+starsHtml(l.media, true)+'</div></div>';
      });
      html += '</div>';
    }
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
  if(!state.currentPlayer || (!state.currentPlayer.admin && !state.currentPlayer.marketing)){
    c.innerHTML = '<div class="empty">Área restrita à administração.</div>'; return;
  }
  if(!state.isAdmin && state.currentPlayer.admin){
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
  // acesso marketing: gere só os eventos (agenda, participantes e aba Evento)
  const marketing = !!state.currentPlayer.marketing;
  const soEventos = marketing && !can('conteudo');
  const permLabel = p => p==='conteudo' ? 'Conteúdo da tela inicial' : p==='mensalidades' ? 'Mensalidades' : p;
  const on401 = e => { if(e && e.status===401){ state.isAdmin=false; state.adminToken=null; localStorage.removeItem('bolerage_admin_token'); render(); return true; } return false; };

  let elencoAdmin=null, eventos=[], permsDisp=['conteudo','mensalidades'];
  let agenda=[], noticia={descricao:'',ativo:false}, aluguel={nome:'',chavePix:'',valorMensalidade:'',ativo:false}, gestao={presidente:'',vicePresidente:'',ativo:false};
  let mensalPlayers=[], mensalMeta={valorPadrao:null, ultimoVencimento:''};
  if(isSuper){
    try{ elencoAdmin = await api('/api/admin/elenco', {adminAuth:true}); permsDisp = elencoAdmin.permsDisponiveis || permsDisp; }
    catch(e){ if(on401(e)) return; c.innerHTML='<div class="empty">Erro ao carregar o elenco.</div>'; return; }
    try{ eventos = (await api('/api/admin/eventos', {adminAuth:true})).eventos; }catch(e){ if(on401(e)) return; }
    try{ state.acessos = await api('/api/admin/acessos?dias='+state.acessosPeriodo, {adminAuth:true}); }catch(e){ if(on401(e)) return; state.acessos = null; }
    if(state.elencoAba==='gestao'){
      try{ state.relatorioFin = await api('/api/admin/relatorio-financeiro', {adminAuth:true}); }catch(e){ if(on401(e)) return; state.relatorioFin = null; }
    }
  }
  if(!isSuper && !soEventos){
    // Admin (não super) também visualiza a Gestão (relatório financeiro e fluxo de caixa)
    try{ state.relatorioFin = await api('/api/admin/relatorio-financeiro', {adminAuth:true}); }catch(e){ if(on401(e)) return; state.relatorioFin = null; }
  }
  if(can('conteudo') || marketing){
    try{ agenda = (await api('/api/admin/agenda', {adminAuth:true})).eventos; }catch(e){ if(on401(e)) return; }
    if(soEventos){
      await refreshHomeExtras(); await refreshEvento();
    }else{
      try{ noticia = await api('/api/admin/noticia', {adminAuth:true}); }catch(e){ if(on401(e)) return; }
      await refreshRifas(); await refreshRifasAdmin(); await refreshRodadasLista(); await refreshHomeExtras(); await refreshEvento();
      try{ aluguel = await api('/api/admin/aluguel', {adminAuth:true}); }catch(e){ if(on401(e)) return; }
      try{ gestao = await api('/api/admin/gestao', {adminAuth:true}); }catch(e){ if(on401(e)) return; }
    }
  }
  if(can('mensalidades')){
    try{ const rm = await api('/api/admin/mensalidades', {adminAuth:true}); mensalPlayers = rm.jogadores; mensalMeta = rm; state._mensalPadrao = rm.valorPadrao; }catch(e){ if(on401(e)) return; }
  }
  if(elencoAdmin) state.elencoAdmin = elencoAdmin;

  const rodada = state.rodadaAtual;
  const papelLabel = soEventos ? 'Acesso marketing — gestão de eventos' : isSuper ? 'Super Admin' : ('Admin — '+(permsMe.length ? permsMe.map(permLabel).join(', ') : 'sem áreas atribuídas'));
  let html = '<div class="card"><div class="list-row" style="border:none;padding:0;"><span><h2 style="margin:0;">Painel administrativo</h2><span class="small muted">'+escapeHtml(papelLabel)+'</span></span>'+(soEventos ? '<button class="btn secondary small" data-action="tab" data-tab="inicio">voltar</button>' : '<button class="btn secondary small" data-action="admin-logout">sair do admin</button>')+'</div></div>';

  if(isSuper){
  html += '<div class="card"><h3>Rodada atual</h3>';
  if(rodada){
    html += '<p class="small">'+formatDataBR(rodada.data)+' — '+rodada.fase.label+'</p>';
    const confirmados = (rodada.confirmados||[]).map(id=>state.elenco.find(j=>j.id===id)).filter(Boolean);
    const linhaN = confirmados.filter(j=>j.posicaoPadrao==='linha' && !j.corneta).length;
    const golN = confirmados.filter(j=>j.posicaoPadrao==='goleiro').length;
    const podeSortear = (rodada.status==='aguardando_confirmacao' && rodada.fase.chave==='aguardando_sorteio') || rodada.status==='sorteio_desfeito';
    html += '<p class="small muted">'+linhaN+' de linha, '+golN+' goleiro(s) confirmados.</p>';
    html += '<button class="btn" data-action="disparar-sorteio" '+(podeSortear?'':'disabled')+'>Realizar sorteio</button>';
    // sorteio MANUAL: o admin marca como RESERVA quem fez check-in mas não está presente na hora
    if(podeSortear && elencoAdmin.config.sorteioModo!=='automatico'){
      const marcados = new Set(rodada.reservasMarcadas||[]);
      const candidatos = confirmados.filter(j=>j.posicaoPadrao==='linha' && !j.corneta);
      html += '<div class="divider"></div><h4 style="margin:0 0 4px;">Reservas do sorteio (modo manual)</h4>'+
        '<p class="small muted">Marque como Reserva quem fez check-in mas não está presente na hora do sorteio. Reservas e convidados formam os últimos times; o jogador marcado continua podendo votar normalmente.</p>';
      if(candidatos.length){
        candidatos.forEach(j=>{
          const on = marcados.has(j.id);
          html += '<div class="list-row"><span>'+escapeHtml(j.nome)+timeCoracaoSuffix(j.timeCoracao)+'</span>'+
            '<span class="row-right"><button class="btn small '+(on?'':'secondary')+'" data-action="toggle-reserva" data-id="'+j.id+'" data-atual="'+(on?'sim':'nao')+'">'+(on?'✔ Reserva':'Marcar reserva')+'</button></span></div>';
        });
      }else{
        html += '<p class="small muted">Ninguém confirmou presença ainda.</p>';
      }
    }
    if(rodada.status==='sorteado'){
      html += '<button class="btn danger small" style="margin-top:8px;" data-action="desfazer-sorteio" data-id="'+rodada.id+'">Desfazer sorteio</button>';
    }
    const ehHistorico = rodada.fase.chave==='encerrada' || rodada.status==='nao_viabilizado';
    html += '<button class="btn danger" style="margin-top:8px;" data-action="remover-rodada" data-id="'+rodada.id+'" data-data="'+rodada.data+'" data-fase="'+escapeHtml(rodada.fase.label)+'" data-hist="'+(ehHistorico?'1':'0')+'">Remover esta rodada'+(ehHistorico?' (histórico)':'')+'</button>';
  }else{
    html += '<p class="small muted">Nenhuma rodada agendada.</p>';
  }
  html += '<div class="divider"></div>';
  html += '<div class="field"><label>Nova rodada (domingo)</label><input type="date" id="nova-rodada-data"></div>';
  html += '<button class="btn secondary" data-action="criar-rodada">Criar rodada</button></div>';

  const cfgA = elencoAdmin.config;
  html += '<div class="card"><h3>Sorteio dos times</h3>'+
    '<div class="field"><label>Como o sorteio será realizado</label><select id="sorteio-modo">'+
      '<option value="manual" '+(cfgA.sorteioModo!=='automatico'?'selected':'')+'>Manual (admin realiza)</option>'+
      '<option value="automatico" '+(cfgA.sorteioModo==='automatico'?'selected':'')+'>Automático (data e hora)</option>'+
    '</select></div>'+
    '<div class="field"><label>Data e horário do sorteio automático (só vale no modo automático)</label><input type="datetime-local" id="sorteio-agendado" value="'+(cfgA.sorteioAgendado||'')+'"></div>'+
    '<p class="small muted">O botão "Realizar sorteio" continua ativo nos dois modos. O sorteio automático acontece uma única vez; depois o modo volta para manual.</p>'+
    (cfgA.sorteioModo==='automatico' && cfgA.sorteioAgendado ? '<p class="small" style="color:var(--gold);">Agendado: '+formatAgendamento(cfgA.sorteioAgendado)+'</p>' : '<p class="small muted">Modo atual: manual.</p>')+
    '<button class="btn secondary" data-action="salvar-sorteio-agenda">Salvar sorteio</button></div>';

  html += '<div class="card"><h3>Votação — Votos dos Jogadores</h3>'+
    '<p class="small muted">Liga ou desliga a aba "Votos dos Jogadores" na tela Votação (mostra o voto que cada jogador deu aos outros). A mudança vale na hora, sem precisar salvar.</p>'+
    '<div class="presence-toggle-wrap">'+
      '<button class="presence-toggle '+(cfgA.mostrarVotos?'is-on':'is-off')+'" data-action="alternar-mostrar-votos" data-atual="'+(cfgA.mostrarVotos?'sim':'nao')+'"><span class="presence-toggle-knob"></span></button>'+
      '<div class="presence-toggle-label">'+(cfgA.mostrarVotos
        ? '<strong style="color:var(--green)">Aba HABILITADA</strong> — os jogadores veem os votos'
        : '<span class="muted">Aba OCULTA</span> — toque para habilitar')+'</div>'+
    '</div></div>';

  html += '<div class="card"><h3>Critério para ativar a fase 2 (sorteio por nota)</h3>'+
    '<div class="field"><label>Mínimo de rodadas encerradas</label><input type="number" min="1" id="cfg-min-rodadas" value="'+elencoAdmin.config.minRodadas+'"></div>'+
    '<div class="field"><label>Mínimo de votos recebidos por jogador ativo</label><input type="number" min="1" id="cfg-min-votos" value="'+elencoAdmin.config.minVotos+'"></div>'+
    '<button class="btn secondary" data-action="salvar-config">Salvar critérios</button></div>';

  const abaElenco = state.elencoAba==='gestao' ? 'gestao' : 'jogadores';
  html += '<div class="card"><h3>Elenco</h3>'+
    '<div class="tabtoggle">'+
      '<button data-action="elenco-aba" data-aba="jogadores" class="'+(abaElenco==='jogadores'?'active':'')+'">Jogadores</button>'+
      '<button data-action="elenco-aba" data-aba="gestao" class="'+(abaElenco==='gestao'?'active':'')+'">Gestão</button>'+
    '</div>';
  if(abaElenco==='gestao'){
    html += renderRelatorioFinanceiroHtml(state.relatorioFin, true) + '</div>';
  }else{
  elencoAdmin.jogadores.forEach(j=>{
    if(state.editingJogadorId===j.id){
      html += '<div class="list-row" style="flex-direction:column;align-items:stretch;gap:6px;">'+
        '<input id="edit-nome-'+j.id+'" value="'+escapeHtml(j.nome)+'">'+
        '<input id="edit-pin-'+j.id+'" value="'+j.pin+'" maxlength="4">'+
        '<input id="edit-tel-'+j.id+'" value="'+escapeHtml(j.telefone||'')+'" placeholder="Telefone / WhatsApp (com DDD)" inputmode="tel">'+
        '<select id="edit-pos-'+j.id+'"><option value="linha" '+(j.posicaoPadrao==='linha'?'selected':'')+'>Linha</option><option value="goleiro" '+(j.posicaoPadrao==='goleiro'?'selected':'')+'>Goleiro</option></select>'+
        '<label class="small"><input type="checkbox" id="edit-ativo-'+j.id+'" '+(j.ativo?'checked':'')+'> ativo</label>'+
        '<label class="small"><input type="checkbox" id="edit-corneta-'+j.id+'" '+(j.corneta?'checked':'')+'> Corneta (faz check-in e vota, mas não entra no sorteio dos times)</label>'+
        '<label class="small"><input type="checkbox" id="edit-depto-medico-'+j.id+'" '+(j.deptoMedico?'checked':'')+'> Depto. Médico (mostra 🚑 ao lado do nome na tela inicial)</label>'+
        '<label class="small"><input type="checkbox" id="edit-marketing-'+j.id+'" '+(j.marketing?'checked':'')+'> Acesso marketing (pode gerir os eventos: agenda, participantes e aba Evento)</label>'+
        (j.superAdmin
          ? '<div class="small muted">Super Admin — acesso total, não editável aqui.</div>'
          : '<label class="small"><input type="checkbox" id="edit-admin-'+j.id+'" '+(j.admin?'checked':'')+'> acesso admin</label>'+
            '<div class="small muted" style="margin-top:2px;">Áreas do acesso admin:</div>'+
            permsDisp.map(p=>'<label class="small" style="margin-left:12px;"><input type="checkbox" id="edit-perm-'+p+'-'+j.id+'" '+((j.adminPerms||[]).includes(p)?'checked':'')+'> '+permLabel(p)+'</label>').join(''))+
        '<label class="small">Mensalidade: <select id="edit-mens-'+j.id+'">'+mensOptionsHtml(j.mensalidade)+'</select></label>'+
        '<label class="small">Valor da mensalidade deste jogador (R$): <input id="edit-valor-'+j.id+'" inputmode="decimal" value="'+inputValorBRL(j.valorMensalidade)+'" placeholder="vazio = valor padrão (Aluguel da quadra)"></label>'+
        '<label class="small">Time do coração: <select id="edit-time-'+j.id+'">'+timeCoracaoOptionsHtml(j.timeCoracao)+'</select></label>'+
        '<div class="btn-row"><button class="btn small" data-action="salvar-jogador" data-id="'+j.id+'">Salvar</button>'+
        '<button class="btn secondary small" data-action="cancelar-edicao">Cancelar</button></div></div>';
    }else{
      html += '<div class="list-row"><span>'+escapeHtml(j.nome)+timeCoracaoSuffix(j.timeCoracao)+' <span class="badge '+(j.posicaoPadrao==='goleiro'?'gk':'')+'">'+j.posicaoPadrao+'</span>'+
        (j.superAdmin?' <span class="badge gk">super</span>':(j.admin?' <span class="badge gk">admin</span>':''))+
        (j.corneta?' <span class="badge">🎺🥜 corneta</span>':'')+
        (j.deptoMedico?' <span class="badge">🚑 depto. médico</span>':'')+
        (j.marketing?' <span class="badge">📣 marketing</span>':'')+
        (MENS_INFO[j.mensalidade]?' <span class="badge mens-'+MENS_INFO[j.mensalidade].cls+'">'+MENS_INFO[j.mensalidade].emoji+' '+MENS_INFO[j.mensalidade].lbl+((j.mensalidade==='em_atraso' && j.diasAtraso!=null)?' • '+j.diasAtraso+' dia'+(j.diasAtraso===1?'':'s'):'')+'</span>':'')+
        (j.valorMensalidade!==''?' <span class="badge">'+fmtBRLfront(Number(j.valorMensalidade))+'</span>':'')+
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
  } /* fim aba Jogadores */
  } /* fim isSuper (rodada / critérios / elenco) */

  if(!isSuper && !soEventos){
    html += '<div class="card"><h3>Gestão</h3>'+renderRelatorioFinanceiroHtml(state.relatorioFin, false)+'</div>';
  }

  if(can('conteudo') || marketing){
  const respOpc = sel => '<option value="">— sem responsável —</option>'+
    state.elenco.filter(j=>j.ativo).map(j=>'<option value="'+escapeHtml(j.nomeReal||j.nome)+'" '+((j.nomeReal||j.nome)===sel?'selected':'')+'>'+escapeHtml(j.nomeReal||j.nome)+'</option>').join('');
  const taStyle = 'width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg-elevated-2);color:var(--text);font-family:var(--font-body);font-size:14.5px;';
  if(!soEventos){
  if(isSuper) html += renderAcessosHtml(state.acessos);
  // card ORDEM: escolhe a sequência dos cards da tela inicial
  {
    const ordem = ordemCardsInicio();
    html += '<div class="card"><h3>Ordem dos cards da tela inicial</h3>'+
      '<p class="small muted">Use as setas para escolher a sequência em que os cards aparecem na tela inicial de todos os jogadores. A mudança vale na hora.</p>'+
      ordem.map((k,i)=>'<div class="ordem-item"><span class="ordem-num">'+(i+1)+'</span><span class="ordem-nome">'+escapeHtml(NOMES_CARDS_INICIO[k]||k)+'</span>'+
        '<span class="ordem-btns"><button class="btn secondary small" data-action="home-ordem-subir" data-k="'+k+'" '+(i===0?'disabled':'')+' aria-label="Subir">▲</button>'+
        '<button class="btn secondary small" data-action="home-ordem-descer" data-k="'+k+'" '+(i===ordem.length-1?'disabled':'')+' aria-label="Descer">▼</button></span></div>').join('')+
      '<button class="btn secondary" style="margin-top:10px;" data-action="home-ordem-padrao">Restaurar ordem padrão</button></div>';
  }
  // card RIFAS: cadastra o ganhador e o prêmio da rifa de uma rodada (aparece em Resenha > Rifas)
  {
    const rodsOrd = [...(state.rodadasLista||[])].sort((a,b)=>a.data<b.data?1:-1);
    const rodSel = (rodsOrd.find(r=>r.id===state.rifaRodadaId) || (state.rodadaAtual && rodsOrd.find(r=>r.id===state.rodadaAtual.id)) || rodsOrd[0] || null);
    if(rodSel) state.rifaRodadaId = rodSel.id;
    const rifaAtual = rodSel ? (state.rifasAdmin||[]).find(r=>r.rodadaId===rodSel.id) : null;
    html += '<div class="card"><h3>RIFAS</h3>'+
      '<p class="small muted">Cadastre o ganhador e o prêmio da rifa. Aparece para todos em Resenha &gt; Rifas.</p>'+
      '<div class="field"><label>Rodada</label><select data-action="rifa-rodada">'+rodsOrd.map(r=>'<option value="'+r.id+'" '+(rodSel && r.id===rodSel.id?'selected':'')+'>'+formatDataBR(r.data)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Nome do ganhador</label><input id="rifa-ganhador" maxlength="60" list="rifa-jogadores" value="'+escapeHtml(rifaAtual?rifaAtual.ganhador:'')+'" placeholder="Digite ou escolha um jogador">'+
        '<datalist id="rifa-jogadores">'+state.elenco.filter(j=>j.ativo).map(j=>'<option value="'+escapeHtml(j.nomeReal||j.nome)+'"></option>').join('')+'</datalist></div>'+
      '<div class="field"><label>Prêmio</label><input id="rifa-premio" maxlength="120" value="'+escapeHtml(rifaAtual?rifaAtual.premio:'')+'" placeholder="Ex.: Uma garrafa de vinho 🍷"></div>'+
      '<div class="btn-row"><button class="btn" data-action="salvar-rifa">Salvar rifa</button>'+
      '<button class="btn secondary" data-action="limpar-rifa">Limpar</button></div>'+
      '<div class="divider"></div><h4 style="margin:0 0 6px;">Rifas cadastradas</h4>'+
      ((state.rifasAdmin||[]).length
        ? (state.rifasAdmin||[]).map(r=>'<div class="rifa-adm-item'+(rodSel && r.rodadaId===rodSel.id?' editando':'')+'">'+
            '<div class="rifa-adm-info"><span class="badge">'+formatDataBR(r.data)+'</span> <strong>'+escapeHtml(r.ganhador)+'</strong><div class="small muted">'+escapeHtml(r.premio||'— sem prêmio —')+'</div></div>'+
            '<div class="rifa-adm-acoes"><button class="btn secondary small" data-action="rifa-editar" data-id="'+r.rodadaId+'">editar</button> '+
            '<button class="btn danger small" data-action="rifa-remover" data-id="'+r.rodadaId+'">remover</button></div></div>').join('')
        : '<p class="small muted">Nenhuma rifa cadastrada ainda.</p>')+
      '</div>';
  }
  } /* fim !soEventos (acessos/ordem/rifas) */
  html += renderAgendaAdminHtml(agenda, respOpc);


  if(!soEventos){
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

  const gestaoOpc = sel => '<option value="">—</option>'+
    state.elenco.filter(j=>j.ativo).map(j=>'<option value="'+escapeHtml(j.nomeReal||j.nome)+'" '+((j.nomeReal||j.nome)===sel?'selected':'')+'>'+escapeHtml(j.nomeReal||j.nome)+'</option>').join('');
  html += '<div class="card"><h3>Gestão (tela inicial)</h3>'+
    '<p class="small muted">O telefone do WhatsApp vem do cadastro do jogador (aba Elenco).</p>'+
    '<div class="field"><label>Presidente</label><select id="gestao-presidente">'+gestaoOpc(gestao.presidente)+'</select></div>'+
    '<div class="field"><label>Vice-Presidente</label><select id="gestao-vice">'+gestaoOpc(gestao.vicePresidente)+'</select></div>'+
    '<label class="small"><input type="checkbox" id="gestao-ativo" '+(gestao.ativo?'checked':'')+'> exibir na tela inicial</label>'+
    '<button class="btn secondary" style="margin-top:10px;" data-action="salvar-gestao">Salvar gestão</button></div>';
  } /* fim !soEventos (notícia/aluguel/gestão) */
  } /* fim can(conteudo) */

  if(can('mensalidades')){
    const padraoTxt = mensalMeta.valorPadrao==null ? 'não definido' : fmtBRLfront(mensalMeta.valorPadrao);
    const cntM = {em_dia:0, em_atraso:0, isenta:0, sem_status:0};
    mensalPlayers.forEach(j=>{ cntM[(j.mensalidade in cntM) ? j.mensalidade : 'sem_status']++; });
    html += '<div class="card hz hz-dourado"><h3>💳 MENSALIDADES</h3>'+
      '<div class="mens-resumo">'+
        '<span class="mens-chip mc-em_dia">✅ Em dia <b>'+cntM.em_dia+'</b></span>'+
        '<span class="mens-chip mc-em_atraso">⚠️ Em atraso <b>'+cntM.em_atraso+'</b></span>'+
        '<span class="mens-chip mc-isenta">🆓 Isento <b>'+cntM.isenta+'</b></span>'+
        '<span class="mens-chip mc-sem_status">⏳ Sem status <b>'+cntM.sem_status+'</b></span>'+
      '</div>'+
      '<p class="small muted">Marque o status de cada jogador. Aparece na tela Início de cada um como selo verde (OK) ou vermelho (Atrasada).</p>'+
      '<p class="small muted">O valor de cada jogador vem preenchido com o valor da mensalidade do card Aluguel da quadra (<strong style="color:var(--text)">'+padraoTxt+'</strong>). Se o jogador paga um valor diferente, toque em <strong style="color:var(--text)">editar</strong>.</p>';
    mensalPlayers.forEach(j=>{
      const atrasado = j.mensalidade==='em_atraso';
      const individual = j.valorMensalidade!=='';
      const valorEf = individual ? Number(j.valorMensalidade) : mensalMeta.valorPadrao;   // individual ou o padrão do Aluguel da quadra
      const editando = state.editandoMensId===j.id;
      html += '<div class="mens-item ms-'+(j.mensalidade ? j.mensalidade : 'sem_status')+'">'+
        '<div class="list-row" style="border:none;padding-bottom:4px;"><span>'+escapeHtml(j.nome)+
          (atrasado && j.diasAtraso!=null ? ' <span class="atraso-dias">'+j.diasAtraso+' dia'+(j.diasAtraso===1?'':'s')+'</span>' : '')+'</span>'+
          '<select data-action="salvar-mensalidade" data-id="'+j.id+'">'+mensOptionsHtml(j.mensalidade)+'</select></div>'+
        // valor: preenchido automaticamente com o padrão (Aluguel da quadra); "editar" abre o campo
        '<div class="mens-valor-linha">'+
          '<span class="small muted">Valor: <strong style="color:var(--text)">'+(valorEf==null?'não definido':fmtBRLfront(valorEf))+'</strong>'+
            (individual ? ' <span class="badge">individual</span>' : ' <span class="small muted">(padrão)</span>')+'</span>'+
          '<button class="btn secondary small" data-action="mens-editar" data-id="'+j.id+'">'+(editando?'fechar':'editar')+'</button>'+
        '</div>'+
        (editando
          ? '<div class="mens-extra">'+
              '<label class="small">Valor (R$) <input id="mens-valor-'+j.id+'" inputmode="decimal" value="'+inputValorBRL(valorEf)+'"></label>'+
              '<button type="button" class="btn secondary small" data-action="mens-usar-padrao" data-id="'+j.id+'" data-valor="'+inputValorBRL(mensalMeta.valorPadrao)+'">Usar padrão</button>'+
              '<button class="btn small" data-action="mens-salvar-valor" data-id="'+j.id+'">Salvar</button>'+
            '</div>'
          : '')+
        // status EM ATRASO: início do atraso (2º domingo) — como estava
        (atrasado
          ? '<div class="mens-extra">'+
              '<label class="small">Em atraso desde <input type="date" id="mens-desde-'+j.id+'" value="'+(j.atrasoDesde||'')+'"></label>'+
              (mensalMeta.ultimoVencimento ? '<button type="button" class="btn secondary small" data-action="mens-usar-vencimento" data-id="'+j.id+'" data-data="'+mensalMeta.ultimoVencimento+'" title="2º domingo do mês">Vencimento '+mensalMeta.ultimoVencimento.slice(8,10)+'/'+mensalMeta.ultimoVencimento.slice(5,7)+'</button>' : '')+
              '<button class="btn small" data-action="mens-salvar-atraso" data-id="'+j.id+'">Salvar</button>'+
            '</div>'
          : '')+
        '</div>';
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
    html += '<div class="small muted" style="padding:4px 0;border-bottom:1px solid var(--line);">'+new Date(e.ts).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})+' — '+escapeHtml(e.mensagem)+'</div>';
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
async function handleDesfazerSorteio(id){
  if(!confirm('Desfazer o sorteio desta rodada?\n\nIsso apaga os times, reservas e TODOS os votos já registrados nela. As confirmações de presença são mantidas — depois é só clicar em "Realizar sorteio" de novo.')) return;
  try{
    await api('/api/admin/rodadas/'+id+'/desfazer-sorteio', {method:'POST', adminAuth:true});
    state.rodadaVisualizadaId = null; state.rodadaVisualizada = null;
    await refreshRodadaAtual();
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
// Aba GESTÃO do card Elenco: relatório financeiro (agrupado por status) + custos + fluxo de caixa
function fmtBRLfront(n){
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return (n<0?'-':'')+'R$ '+int.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+dec;
}
const COR_FIN = {em_dia:'#3FAE58', em_atraso:'#E2574C', isenta:'#4EA1FF', sem_status:'#7A8699', aluguel:'#CCA02A', higienizacao:'#4EA1FF', carvao:'#8A8A99'};
function fmtPctFront(v, total){ return (total>0 ? v/total*100 : 0).toFixed(1).replace('.',',')+'%'; }
// gráfico de PIZZA com percentuais nas fatias + legenda. segs: [{label, valor, cor, txt}]
function pizzaHtml(titulo, segs){
  const total = segs.reduce((t,x)=>t+x.valor,0);
  const tit = titulo ? '<div class="stack-tit">'+titulo+'</div>' : '';
  if(total<=0) return '<div class="pizza-bloco">'+tit+'<p class="small muted" style="margin:4px 0;">Sem dados para exibir.</p></div>';
  const R = 46, CX = 50, CY = 50;
  const pt = a => [CX + R*Math.cos(a), CY + R*Math.sin(a)];
  let ang = -Math.PI/2, fatias = '', rotulos = '';
  const vis = segs.filter(x=>x.valor>0);
  vis.forEach(x=>{
    const frac = x.valor/total, a2 = ang + frac*2*Math.PI;
    if(vis.length===1){
      fatias += '<circle cx="'+CX+'" cy="'+CY+'" r="'+R+'" fill="'+x.cor+'"/>';
    }else{
      const [x0,y0] = pt(ang), [x1,y1] = pt(a2);
      fatias += '<path d="M'+CX+' '+CY+' L'+x0.toFixed(2)+' '+y0.toFixed(2)+' A'+R+' '+R+' 0 '+(frac>0.5?1:0)+' 1 '+x1.toFixed(2)+' '+y1.toFixed(2)+' Z" fill="'+x.cor+'" stroke="rgba(10,22,38,.9)" stroke-width="1"><title>'+escapeHtml(x.label)+': '+fmtPctFront(x.valor,total)+'</title></path>';
    }
    if(frac>=0.08){
      // percentual dentro da fatia, num selo escuro com texto branco e grande (alto contraste)
      const m = ang + frac*Math.PI, t = fmtPctFront(x.valor,total);
      const px = CX+R*0.64*Math.cos(m), py = CY+R*0.64*Math.sin(m), w = t.length*4.9+5;
      rotulos += '<g class="pizza-selo"><rect x="'+(px-w/2).toFixed(2)+'" y="'+(py-5.4).toFixed(2)+'" width="'+w.toFixed(2)+'" height="10.8" rx="5.4"/>'+
        '<text x="'+px.toFixed(2)+'" y="'+(py+3.2).toFixed(2)+'" text-anchor="middle" class="pizza-pct">'+t+'</text></g>';
    }
    ang = a2;
  });
  return '<div class="pizza-bloco">'+tit+'<div class="pizza-wrap"><svg viewBox="0 0 100 100" class="pizza-svg" role="img" aria-label="Gráfico de pizza">'+fatias+rotulos+'</svg>'+
    '<div class="pizza-leg">'+segs.map(x=>
      '<div class="pizza-leg-item"><span class="pizza-leg-rot"><i style="background:'+x.cor+'"></i>'+x.label+'</span><span class="pizza-leg-val">'+x.txt+' <strong>'+fmtPctFront(x.valor,total)+'</strong></span></div>'
    ).join('')+'</div></div></div>';
}
function inputValorBRL(n){ return n ? Number(n).toFixed(2).replace('.',',') : ''; }
// ---------- GESTÃO (Painel Admin): sub-abas, gráficos de PIZZA e cores por zona ----------
const GESTAO_SUBS = [
  ['dre','DRE'],
  ['jogadores','Status por Craques'],
  ['recdes','Receitas x Despesas'],
  ['saldo','Saldo em Caixa'],
  ['custos','Custos da Quadra'],
  ['relatorios','Relatórios'],
];
// linha de total sem quebra de linha: rótulo corta com "…" se faltar espaço, valor nunca quebra
function relLinhaHtml(rotulo, valor, cls){
  return '<div class="rel-linha'+(cls?' '+cls:'')+'"><span class="rel-rot">'+rotulo+'</span><strong class="rel-val">'+valor+'</strong></div>';
}
// bloco colorido (mesma linguagem visual das zonas do Ranking)
function finZona(cor, titulo, sub, corpo){
  return '<div class="fin-zona fz-'+cor+'"><div class="fin-zona-tit">'+titulo+'</div>'+(sub?'<div class="fin-zona-sub">'+sub+'</div>':'')+corpo+'</div>';
}
const FIN_ZONA_STATUS = {
  em_dia:     {cor:'verde',    tit:'✅ EM DIA'},
  em_atraso:  {cor:'vermelho', tit:'⚠️ EM ATRASO'},
  isenta:     {cor:'azul',     tit:'🆓 ISENTO'},
  sem_status: {cor:'cinza',    tit:'⏳ SEM STATUS'},
};
function renderRelatorioFinanceiroHtml(rel, podeEditarCustos){
  if(!rel) return '<p class="small muted">Não foi possível carregar o relatório.</p>';
  const sub = GESTAO_SUBS.some(x=>x[0]===state.gestaoSub) ? state.gestaoSub : 'dre';
  const [ano, mes] = rel.referencia.split('-');
  const g = rel.geradoEm;
  const contab = rel.grupos.filter(x=>x.contabiliza);
  const c = rel.custos;
  const saldoCor = rel.saldoPrevisto < 0 ? 'vermelho' : 'verde';
  const corSaldoTxt = rel.saldoPrevisto < 0 ? 'var(--red)' : 'var(--green)';

  let h = '<div class="rel-topo">'+
    '<div><span class="small muted">Referência</span><div class="rel-destaque">'+mes+'/'+ano+'</div></div>'+
    '<div style="text-align:right;"><span class="small muted">Valor da mensalidade</span><div class="rel-destaque">'+(rel.valorUnitario==null?'—':fmtBRLfront(rel.valorUnitario))+'</div></div>'+
  '</div>';
  if(rel.aviso) h += '<p class="small" style="color:var(--gold);">⚠️ '+escapeHtml(rel.aviso)+'</p>';
  // sub-abas em grade (sem barra de rolagem)
  h += '<div class="subtabs">'+GESTAO_SUBS.map(x=>'<button data-action="gestao-sub" data-sub="'+x[0]+'" class="'+(sub===x[0]?'active':'')+'">'+x[1]+'</button>').join('')+'</div>';
  h += '<p class="small muted" style="margin:0 0 4px;">Jogadores <strong style="color:var(--text)">sem status</strong> (cadastrados, ainda não contratados) não entram nos totais e gráficos. Gerado em '+g.slice(8,10)+'/'+g.slice(5,7)+'/'+g.slice(0,4)+' às '+g.slice(11,16)+'.</p>';

  if(sub==='dre'){
    // ---- DRE: demonstrativo de resultados (fluxo de caixa)
    h += finZona('verde', '💰 RECEITAS', 'Mensalidades',
        relLinhaHtml('Em dia <span class="rel-obs">(recebido)</span>', fmtBRLfront(rel.receitas.recebido), 'rel-item')+
        relLinhaHtml('Em atraso <span class="rel-obs">(a receber)</span>', fmtBRLfront(rel.receitas.aReceber), 'rel-item')+
        relLinhaHtml('Total de receitas', fmtBRLfront(rel.receitas.total), 'rel-sub'))+
      finZona('vermelho', '💸 DESPESAS', 'Custos da quadra',
        relLinhaHtml('Aluguel da Quadra', fmtBRLfront(c.aluguel), 'rel-item')+
        relLinhaHtml('Higienização', fmtBRLfront(c.higienizacao), 'rel-item')+
        relLinhaHtml('Carvão', fmtBRLfront(c.carvao), 'rel-item')+
        relLinhaHtml('Total de despesas', fmtBRLfront(rel.despesas), 'rel-sub'))+
      finZona('dourado', '🏦 SALDO EM CAIXA', 'Conta corrente do time',
        relLinhaHtml('Saldo atual em caixa', fmtBRLfront(rel.saldoCaixa), 'rel-sub'))+
      finZona(saldoCor, '📊 SALDO PREVISTO', 'Saldo em caixa + receitas − despesas',
        relLinhaHtml('Resultado do mês <span class="rel-obs">(receitas − despesas)</span>', fmtBRLfront(rel.resultadoMes), 'rel-item')+
        '<div class="rel-linha rel-total"><span class="rel-rot">SALDO PREVISTO</span><strong class="rel-val" style="color:'+corSaldoTxt+';">'+fmtBRLfront(rel.saldoPrevisto)+'</strong></div>')+
      finZona('azul', '🥧 VALOR POR STATUS', 'Participação de cada status na receita',
        pizzaHtml('', contab.filter(x=>x.total>0).map(x=>({label:x.label, valor:x.total, cor:COR_FIN[x.chave], txt:fmtBRLfront(x.total)}))));
  }
  else if(sub==='jogadores'){
    // ---- Status por craques (agrupado, com subtotal)
    const filtro = (state.gestaoFiltro==='todos' || rel.grupos.some(x=>x.chave===state.gestaoFiltro)) ? (state.gestaoFiltro||'todos') : 'todos';
    const gruposVis = filtro==='todos' ? contab : rel.grupos.filter(x=>x.chave===filtro);
    h += finZona('azul', '👥 STATUS POR CRAQUES', 'Somente jogadores contratados',
        pizzaHtml('', contab.map(x=>({label:x.label, valor:x.qtd, cor:COR_FIN[x.chave], txt:x.qtd+' jogador'+(x.qtd===1?'':'es')}))))+
      '<div class="filtros-fin">'+
        '<button data-action="gestao-filtro" data-f="todos" class="'+(filtro==='todos'?'active':'')+'">Todos</button>'+
        rel.grupos.map(x=>'<button data-action="gestao-filtro" data-f="'+x.chave+'" class="'+(filtro===x.chave?'active':'')+'">'+x.label+' <span class="muted">('+x.qtd+')</span></button>').join('')+
      '</div>';
    gruposVis.forEach(gr=>{
      const z = FIN_ZONA_STATUS[gr.chave];
      let corpo = '';
      if(gr.linhas.length){
        gr.linhas.forEach((l,i)=>{
          const individual = l.valorIndividual!=null;
          corpo += '<div class="fin-row"><span class="fin-pos">'+(i+1)+'</span><span class="fin-nome">'+escapeHtml(l.nome)+(individual?' <span class="badge" title="Valor de mensalidade individual">individual</span>':'')+
            (gr.chave==='em_atraso' && l.diasAtraso!=null ? ' <span class="atraso-dias">'+l.diasAtraso+' dia'+(l.diasAtraso===1?'':'s')+'</span>' : '')+'</span>'+
            '<span class="fin-valor">'+fmtBRLfront(l.valor)+'</span></div>';
        });
      }else{
        corpo += '<p class="small muted" style="margin:6px 0;">Nenhum jogador neste status.</p>';
      }
      if(gr.contabiliza) corpo += relLinhaHtml('Subtotal'+(rel.totalGeral>0 ? ' <span class="rel-obs">('+fmtPctFront(gr.total, rel.totalGeral)+')</span>' : ''), fmtBRLfront(gr.total), 'rel-sub');
      h += finZona(z.cor, z.tit, gr.qtd+' jogador'+(gr.qtd===1?'':'es')+(gr.contabiliza ? ' • '+fmtPctFront(gr.qtd, rel.qtd)+' do elenco' : ' • não contabilizado'), corpo);
    });
    if(filtro==='todos'){
      h += finZona('dourado', '🏁 TOTAL GERAL', rel.qtd+' jogadores contratados',
        '<div class="rel-linha rel-total"><span class="rel-rot">TOTAL GERAL</span><strong class="rel-val">'+fmtBRLfront(rel.totalGeral)+'</strong></div>');
      if(rel.qtdSemStatus>0) h += '<p class="small muted" style="margin:6px 2px 0;">'+rel.qtdSemStatus+' jogador'+(rel.qtdSemStatus===1?'':'es')+' sem status não contabilizado'+(rel.qtdSemStatus===1?'':'s')+' (use o filtro "Sem status" para ver).</p>';
    }else if(gruposVis[0] && gruposVis[0].contabiliza){
      h += finZona('dourado', '🏁 SOMA — '+gruposVis[0].label.toUpperCase(), null,
        '<div class="rel-linha rel-total"><span class="rel-rot">SOMA</span><strong class="rel-val">'+fmtBRLfront(gruposVis[0].total)+'</strong></div>');
    }
  }
  else if(sub==='recdes'){
    // ---- Receitas x Despesas
    h += finZona('verde', '📈 RECEITAS', 'Composição das receitas',
        pizzaHtml('', [{label:'Em dia (recebido)', valor:rel.receitas.recebido, cor:COR_FIN.em_dia, txt:fmtBRLfront(rel.receitas.recebido)}, {label:'Em atraso (a receber)', valor:rel.receitas.aReceber, cor:COR_FIN.em_atraso, txt:fmtBRLfront(rel.receitas.aReceber)}])+
        relLinhaHtml('Total de receitas', fmtBRLfront(rel.receitas.total), 'rel-sub'))+
      finZona('vermelho', '📉 DESPESAS', 'Composição das despesas',
        pizzaHtml('', [{label:'Aluguel da Quadra', valor:c.aluguel, cor:COR_FIN.aluguel, txt:fmtBRLfront(c.aluguel)}, {label:'Higienização', valor:c.higienizacao, cor:COR_FIN.higienizacao, txt:fmtBRLfront(c.higienizacao)}, {label:'Carvão', valor:c.carvao, cor:COR_FIN.carvao, txt:fmtBRLfront(c.carvao)}])+
        relLinhaHtml('Total de despesas', fmtBRLfront(rel.despesas), 'rel-sub'))+
      finZona(rel.resultadoMes<0 ? 'vermelho' : 'azul', '⚖️ RECEITAS x DESPESAS', rel.despesas>0 ? 'As receitas cobrem '+fmtPctFront(rel.receitas.total, rel.despesas)+' das despesas' : 'Sem despesas informadas',
        pizzaHtml('', [{label:'Receitas', valor:rel.receitas.total, cor:COR_FIN.em_dia, txt:fmtBRLfront(rel.receitas.total)}, {label:'Despesas', valor:rel.despesas, cor:COR_FIN.em_atraso, txt:fmtBRLfront(rel.despesas)}])+
        '<div class="rel-linha rel-total"><span class="rel-rot">RESULTADO DO MÊS</span><strong class="rel-val" style="color:'+(rel.resultadoMes<0?'var(--red)':'var(--green)')+';">'+fmtBRLfront(rel.resultadoMes)+'</strong></div>');
  }
  else if(sub==='saldo'){
    // ---- Saldo em caixa (qualquer admin atualiza)
    h += finZona('dourado', '🏦 SALDO EM CAIXA', 'Saldo atual da conta corrente do time',
        '<p class="small muted">Informe o saldo atualizado. Ele entra no cálculo do fluxo de caixa. Aceita negativo (ex.: -150,00).</p>'+
        '<div class="field"><label>Saldo em caixa (R$)</label><input id="saldo-caixa" inputmode="decimal" value="'+inputValorBRL(rel.saldoCaixa)+'" placeholder="0,00"></div>'+
        '<button class="btn secondary" data-action="salvar-saldo-caixa">Salvar saldo em caixa</button>'+
        '<div style="margin-top:10px;">'+relLinhaHtml('Saldo atual em caixa', fmtBRLfront(rel.saldoCaixa), 'rel-sub')+'</div>')+
      finZona(saldoCor, '📊 SALDO PREVISTO', 'Saldo em caixa + receitas − despesas',
        relLinhaHtml('Resultado do mês <span class="rel-obs">(receitas − despesas)</span>', fmtBRLfront(rel.resultadoMes), 'rel-item')+
        '<div class="rel-linha rel-total"><span class="rel-rot">SALDO PREVISTO</span><strong class="rel-val" style="color:'+corSaldoTxt+';">'+fmtBRLfront(rel.saldoPrevisto)+'</strong></div>');
  }
  else if(sub==='custos'){
    // ---- Custos da quadra (só o Super Admin edita)
    let corpo = '';
    if(podeEditarCustos){
      corpo += '<p class="small muted">Informe os custos do mês (despesas). Aceita formatos como 1.250,50.</p>'+
        '<div class="field"><label>Aluguel da Quadra (R$)</label><input id="custo-aluguel" inputmode="decimal" value="'+inputValorBRL(c.aluguel)+'" placeholder="0,00"></div>'+
        '<div class="field"><label>Higienização (R$)</label><input id="custo-higienizacao" inputmode="decimal" value="'+inputValorBRL(c.higienizacao)+'" placeholder="0,00"></div>'+
        '<div class="field"><label>Carvão (R$)</label><input id="custo-carvao" inputmode="decimal" value="'+inputValorBRL(c.carvao)+'" placeholder="0,00"></div>'+
        '<button class="btn secondary" data-action="salvar-custos">Salvar custos</button>';
    }else{
      corpo += relLinhaHtml('Aluguel da Quadra', fmtBRLfront(c.aluguel), 'rel-item')+relLinhaHtml('Higienização', fmtBRLfront(c.higienizacao), 'rel-item')+relLinhaHtml('Carvão', fmtBRLfront(c.carvao), 'rel-item');
    }
    corpo += '<div style="margin-top:10px;">'+relLinhaHtml('TOTAL DE CUSTOS', fmtBRLfront(rel.despesas), 'rel-total')+'</div>';
    h += finZona('laranja', '🧾 CUSTOS DA QUADRA', 'Despesas do mês', corpo);
  }
  else{
    // ---- Relatórios (PDF e Excel)
    h += finZona('azul', '📄 FINANCEIRO POR MENSALIDADES', 'PDF com jogadores agrupados por status, subtotais e gráficos de pizza',
        '<div class="field"><label>Status</label><select id="rel-pdf-status">'+
          '<option value="todos">Todos os status</option>'+rel.grupos.map(x=>'<option value="'+x.chave+'">'+x.label+'</option>').join('')+'</select></div>'+
        '<button class="btn" data-action="baixar-pdf-fin">📄 PDF Financeiro por Mensalidades</button>')+
      finZona('verde', '📄 FLUXO DE CAIXA', 'PDF com saldo em caixa, receitas, despesas, saldo previsto e gráficos de pizza',
        '<button class="btn" data-action="baixar-pdf" data-url="/api/admin/fluxo-caixa.pdf" data-arq="fluxo-de-caixa-'+rel.referencia+'.pdf">📄 PDF Fluxo de Caixa</button>')+
      finZona('dourado', '📊 EXCEL', 'Planilha com 5 abas: DRE, Status por Craques, Receitas x Despesas, Saldo em Caixa e Custos da Quadra',
        '<button class="btn secondary" data-action="baixar-pdf" data-url="/api/admin/relatorio-financeiro.xlsx" data-arq="relatorios-financeiros-'+rel.referencia+'.xlsx">📊 Exportar para Excel</button>');
  }
  return h;
}
// salva o valor da mensalidade do jogador (igual ao padrão => volta a usar o padrão)
async function handleMoverCardInicio(chave, delta){
  const ordem = ordemCardsInicio();
  const i = ordem.indexOf(chave), j = i + delta;
  if(i<0 || j<0 || j>=ordem.length) return;
  [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  try{
    await api('/api/admin/home-ordem', {method:'PUT', adminAuth:true, body:{ordem}});
    await refreshHomeExtras(); await render();
  }catch(e){ alert(e.message); }
}
async function handleOrdemPadraoInicio(){
  try{
    await api('/api/admin/home-ordem', {method:'PUT', adminAuth:true, body:{padrao:true}});
    await refreshHomeExtras(); await render(); showToast('Ordem padrão restaurada');
  }catch(e){ alert(e.message); }
}
async function evtApi(metodo, caminho, corpo, msg){
  try{ await api(caminho, {method:metodo, adminAuth:true, body:corpo}); await refreshEvento(); await refreshHomeExtras(); await render(); if(msg) showToast(msg); }
  catch(e){ alert(e.message); }
}
function handleEvtAdicionar(){
  const g = id => document.getElementById(id).value;
  return evtApi('POST', '/api/admin/evento-participantes', {nome:g('evt-nome'), valor:g('evt-valor'), status:g('evt-status'), valorPago:g('evt-pago')}, 'Participante adicionado');
}
function handleEvtSalvar(id){
  const g = x => document.getElementById(x+id).value;
  state.eventoEditId = null;
  return evtApi('PUT', '/api/admin/evento-participantes/'+id, {nome:g('evt-e-nome-'), valor:g('evt-e-valor-'), status:g('evt-e-status-'), valorPago:g('evt-e-pago-')}, 'Salvo!');
}
async function handleEvtStatus(id, status){
  // "Parcial" precisa do valor pago: abre a edição depois de trocar
  try{
    await api('/api/admin/evento-participantes/'+id, {method:'PUT', adminAuth:true, body:{status}});
    if(status==='parcial') state.eventoEditId = id;
    await refreshEvento(); await refreshHomeExtras(); await render();
  }catch(e){ alert(e.message); await render(); }
}
async function handleEvtRemover(id){ if(confirm('Remover este participante da lista?')) return evtApi('DELETE', '/api/admin/evento-participantes/'+id, undefined, 'Removido'); }
function handleEvtValorPadrao(){ return evtApi('PUT', '/api/admin/evento-valor-padrao', {valor: document.getElementById('evt-valor-padrao').value}, 'Valor padrão salvo'); }
function handleEvtAbaSalvar(){
  return evtApi('PUT', '/api/admin/evento-aba', {ativa: document.getElementById('evt-aba-ativa').checked, titulo: document.getElementById('evt-aba-titulo').value, texto: document.getElementById('evt-aba-texto').value}, 'Aba Eventos salva');
}
async function handleEvtTodos(){
  if(!confirm('Adicionar todos os jogadores ativos que ainda não estão na lista (valor padrão, status Pendente)?')) return;
  try{ const r = await api('/api/admin/evento-participantes-todos', {method:'POST', adminAuth:true}); await refreshEvento(); await render(); showToast(r.adicionados+' jogador(es) adicionados'); }
  catch(e){ alert(e.message); }
}
async function handleSalvarRifa(limpar, rodadaId){
  const rid = rodadaId || state.rifaRodadaId;
  if(!rid){ alert('Nenhuma rodada selecionada.'); return; }
  const ganhador = limpar ? '' : document.getElementById('rifa-ganhador').value;
  const premio = limpar ? '' : document.getElementById('rifa-premio').value;
  try{
    await api('/api/admin/rifas', {method:'PUT', adminAuth:true, body:{rodadaId:rid, ganhador, premio}});
    await refreshRifas(); await refreshRifasAdmin();
    await render();
    showToast(limpar ? 'Rifa removida' : 'Rifa salva!');
  }catch(e){ alert(e.message); }
}
async function handleSalvarMensalidadeValor(id){
  let bruto = document.getElementById('mens-valor-'+id).value.trim();
  const padrao = state._mensalPadrao;
  const n = Number(bruto.replace(/\./g,'').replace(',','.'));
  if(bruto!=='' && padrao!=null && Number.isFinite(n) && Math.abs(n-padrao)<0.005) bruto = '';
  try{
    await api('/api/admin/jogadores/'+id+'/financeiro', {method:'PUT', adminAuth:true, body:{valor: bruto}});
    state.editandoMensId = null;
    await render();
    showToast('Mensalidade salva!');
  }catch(e){ alert(e.message); }
}
// salva só a data de início do atraso
async function handleSalvarAtrasoDesde(id){
  const desde = document.getElementById('mens-desde-'+id);
  if(!desde || !desde.value){ alert('Informe a data de início do atraso.'); return; }
  try{
    await api('/api/admin/jogadores/'+id+'/financeiro', {method:'PUT', adminAuth:true, body:{atrasoDesde: desde.value}});
    await render();
    showToast('Atraso atualizado!');
  }catch(e){ alert(e.message); }
}
// ---------- CONTROLE DE ACESSOS (Super Admin) ----------
const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_SEMANA_LONGO = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const COR_TELAS = {inicio:'#4EA1FF', sorteio:'#F0902E', votacao:'#3FAE58', resenha:'#A77BFF', ranking:'#E4C158', trocarPin:'#35C8D8', admin:'#E2574C'};
function textoUltimoAcesso(j){
  if(j.diasSemAcesso==null) return 'nunca acessou';
  return j.diasSemAcesso===0 ? 'hoje' : (j.diasSemAcesso===1 ? 'ontem' : 'há '+j.diasSemAcesso+' dias');
}
function renderAcessosHtml(d){
  if(!d) return '<div class="card"><h3>📊 Controle de acessos</h3><p class="small muted">Não foi possível carregar os acessos.</p></div>';
  const T = d.totais, nomes = d.nomesTelas || {};
  const periodos = [[7,'7 dias'],[30,'30 dias'],[90,'90 dias'],[0,'Tudo']];
  let h = '<div class="card"><h3>📊 Controle de acessos</h3>'+
    '<p class="small muted">Quem entra no app, quando e quais telas usa. Considera cada visita (PIN ou app reaberto), horário de São Paulo.</p>'+
    '<div class="filtros-fin">'+periodos.map(p=>'<button data-action="acessos-periodo" data-d="'+p[0]+'" class="'+(d.dias===p[0]?'active':'')+'">'+p[1]+'</button>').join('')+'</div>';

  // KPIs
  h += '<div class="kpi-grid">'+
    '<div class="kpi kpi-azul"><div class="kpi-num">'+T.entradas+'</div><div class="kpi-rot">visitas ao app</div></div>'+
    '<div class="kpi kpi-verde"><div class="kpi-num">'+T.jogadoresAtivos+'<small>/'+T.totalJogadores+'</small></div><div class="kpi-rot">jogadores que entraram</div></div>'+
    '<div class="kpi kpi-dourado"><div class="kpi-num">'+String(T.mediaPorJogador).replace('.',',')+'</div><div class="kpi-rot">visitas por jogador ativo</div></div>'+
    '<div class="kpi kpi-roxo"><div class="kpi-num">'+(T.horaPico==null?'—':T.horaPico+'h')+'</div><div class="kpi-rot">'+(T.diaPico==null?'horário de pico':'pico: '+DIAS_SEMANA_LONGO[T.diaPico])+'</div></div>'+
  '</div>';

  // mapa de calor dia da semana x hora
  const maxHeat = Math.max(1, ...d.heat.map(l=>Math.max(...l)));
  let heat = '<div class="heat"><div class="heat-linha heat-cab"><span></span>'+[...Array(24).keys()].map(hh=>'<span>'+(hh%3===0?hh:'')+'</span>').join('')+'</div>';
  d.heat.forEach((linha,dow)=>{
    heat += '<div class="heat-linha"><span class="heat-dia">'+DIAS_SEMANA[dow]+'</span>'+linha.map((v,hh)=>{
      const a = v ? (0.18 + 0.82*v/maxHeat).toFixed(2) : 0.05;
      return '<span class="heat-cel" style="background:rgba(240,144,46,'+a+')" title="'+DIAS_SEMANA[dow]+' '+hh+'h: '+v+' visita'+(v===1?'':'s')+'"></span>';
    }).join('')+'</div>';
  });
  heat += '</div><p class="small muted" style="margin:4px 0 0;">Quanto mais forte a cor, mais visitas naquele dia e horário (colunas = hora do dia).</p>';
  h += finZona('laranja', '🔥 MAPA DE CALOR', 'Dia da semana x horário das visitas', heat);

  // telas mais acessadas (pizza)
  const segsTelas = Object.keys(T.telas).sort((a,b)=>T.telas[b]-T.telas[a]).map(k=>({label:nomes[k]||k, valor:T.telas[k], cor:COR_TELAS[k]||'#8A8A99', txt:T.telas[k]+' acesso'+(T.telas[k]===1?'':'s')}));
  h += finZona('roxo', '📱 TELAS MAIS ACESSADAS', 'Onde os jogadores mais entram', pizzaHtml('', segsTelas));

  // ranking de uso por jogador (toque para ver o detalhe)
  const maxEnt = Math.max(1, ...d.jogadores.map(j=>j.entradas));
  let rank = '';
  d.jogadores.filter(j=>j.entradas>0).forEach((j,i)=>{
    const aberto = state.acessoAberto===j.id;
    const medalha = i===0?'🥇':i===1?'🥈':i===2?'🥉':String(i+1);
    rank += '<div class="ac-item'+(aberto?' aberto':'')+'"><div class="ac-linha" data-action="acesso-abrir" data-id="'+j.id+'">'+
      '<span class="ac-pos">'+medalha+'</span>'+
      '<span class="ac-info"><span class="ac-nome">'+escapeHtml(j.nome)+'</span><span class="ac-barra"><i style="width:'+Math.max(4, j.entradas/maxEnt*100).toFixed(0)+'%"></i></span>'+
        '<span class="ac-sub">último acesso '+textoUltimoAcesso(j)+'</span></span>'+
      '<span class="ac-num"><strong>'+j.entradas+'</strong><small>visita'+(j.entradas===1?'':'s')+'</small></span></div>';
    if(aberto){
      const maxD = Math.max(1, ...j.porDia14);
      const telasJ = Object.keys(j.telas).sort((a,b)=>j.telas[b]-j.telas[a]);
      rank += '<div class="ac-detalhe">'+
        '<div class="ac-stats">'+
          '<div><b>'+j.diasAtivos+'</b><span>dias com acesso</span></div>'+
          '<div><b>'+String(j.mediaSemanal).replace('.',',')+'</b><span>visitas por semana</span></div>'+
          '<div><b>'+(j.horaPreferida==null?'—':j.horaPreferida+'h')+'</b><span>horário preferido</span></div>'+
          '<div><b>'+(j.diaPreferido==null?'—':DIAS_SEMANA[j.diaPreferido])+'</b><span>dia preferido</span></div>'+
        '</div>'+
        '<div class="stack-tit" style="margin-top:8px;">Últimos 14 dias</div>'+
        '<div class="mini-bars">'+j.porDia14.map((v,k)=>'<span class="mini-col" title="'+v+' visita'+(v===1?'':'s')+'"><i style="height:'+(v?Math.max(12, v/maxD*100):4)+'%;'+(v?'':'opacity:.25;')+'"></i></span>').join('')+'</div>'+
        '<div class="stack-tit" style="margin-top:8px;">Telas que mais usa</div>'+
        (telasJ.length ? telasJ.slice(0,4).map(k=>'<div class="ac-tela"><span>'+(nomes[k]||k)+'</span><span class="ac-tela-barra"><i style="width:'+(j.telas[k]/j.telas[telasJ[0]]*100).toFixed(0)+'%;background:'+(COR_TELAS[k]||'#8A8A99')+'"></i></span><b>'+j.telas[k]+'</b></div>').join('') : '<p class="small muted">Sem telas registradas.</p>')+
        '<div class="stack-tit" style="margin-top:8px;">Últimas visitas (dia e horário)</div>'+
        '<div class="ac-ultimos">'+j.ultimos.map(u=>'<span class="badge">'+DIAS_SEMANA[u.dow]+' '+u.data+' • '+u.hm+'</span>').join('')+'</div>'+
      '</div>';
    }
    rank += '</div>';
  });
  if(!rank) rank = '<p class="small muted">Nenhum acesso registrado neste período.</p>';
  h += finZona('dourado', '🏆 QUEM MAIS USA O APP', 'Toque em um jogador para ver o detalhe (dias, horários e telas)', rank);

  // sem acesso
  const sumidos = d.jogadores.filter(j=>j.entradas===0);
  h += finZona(sumidos.length?'vermelho':'verde', '🕵️ SEM ACESSO NO PERÍODO', sumidos.length ? sumidos.length+' jogador'+(sumidos.length===1?'':'es')+' não entrou'+(sumidos.length===1?'':'ram')+' no app' : 'Todo mundo entrou pelo menos uma vez!',
    sumidos.length ? '<div class="ac-sumidos">'+sumidos.map(j=>'<span class="badge">'+escapeHtml(j.nome)+'</span>').join('')+'</div>' : '');
  h += '<p class="small muted" style="margin-top:6px;">Os acessos passam a ser contados a partir desta versão do app.</p></div>';
  return h;
}
async function handleSalvarSaldoCaixa(){
  try{
    await api('/api/admin/saldo-caixa', {method:'PUT', adminAuth:true, body:{saldo: document.getElementById('saldo-caixa').value}});
    await render();
    showToast('Saldo em caixa salvo!');
  }catch(e){ alert(e.message); }
}
async function handleSalvarCustos(){
  const g = id => document.getElementById(id).value;
  try{
    await api('/api/admin/custos', {method:'PUT', adminAuth:true, body:{aluguel:g('custo-aluguel'), higienizacao:g('custo-higienizacao'), carvao:g('custo-carvao')}});
    await render();
    showToast('Custos salvos!');
  }catch(e){ alert(e.message); }
}
async function handleBaixarPdf(url, nomeArq){
  try{
    const res = await fetch(url, {headers:{Authorization:'Bearer '+state.adminToken}});
    if(!res.ok){
      let msg = 'Não foi possível gerar o PDF.';
      try{ msg = (await res.json()).erro || msg; }catch(e){}
      alert(msg); return;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = nomeArq || 'relatorio.pdf'; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(href), 60000);
  }catch(e){ alert('Erro ao gerar o PDF: '+e.message); }
}

async function handleToggleReserva(jogadorId, atual){
  if(!state.rodadaAtual) return;
  try{
    await api('/api/admin/rodadas/'+state.rodadaAtual.id+'/reserva', {method:'PUT', adminAuth:true, body:{jogadorId, reserva: atual!=='sim'}});
    await refreshRodadaAtual(); await render();
  }catch(e){ alert(e.message); }
}
async function handleSalvarSorteioAgenda(){
  const modo = document.getElementById('sorteio-modo').value;
  const agendadoEm = document.getElementById('sorteio-agendado').value;
  if(modo==='automatico' && !agendadoEm){ alert('Informe a data e o horário do sorteio automático.'); return; }
  try{ await api('/api/admin/sorteio-agenda', {method:'PUT', adminAuth:true, body:{modo, agendadoEm}}); await refreshRodadaAtual(); await render(); }
  catch(e){ alert(e.message); }
}
async function handleSalvarMostrarVotos(atual){
  const mostrar = atual!=='sim';
  try{
    const r = await api('/api/admin/mostrar-votos', {method:'PUT', adminAuth:true, body:{mostrar}});
    await refreshRodadaAtual();
    await render();
    showToast(r && r.mostrarVotos ? 'Aba "Votos dos Jogadores" HABILITADA' : 'Aba "Votos dos Jogadores" OCULTA');
  }
  catch(e){ alert(e.message); }
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
  const corneta = document.getElementById('edit-corneta-'+id).checked;
  const deptoMedico = document.getElementById('edit-depto-medico-'+id).checked;
  const marketing = document.getElementById('edit-marketing-'+id).checked;
  const body = {nome,pin,posicaoPadrao,ativo,corneta,deptoMedico,marketing};
  const valorEl = document.getElementById('edit-valor-'+id);
  if(valorEl) body.valorMensalidade = valorEl.value;
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
  const timeEl = document.getElementById('edit-time-'+id);
  if(timeEl) body.timeCoracao = timeEl.value;
  const telEl = document.getElementById('edit-tel-'+id);
  if(telEl) body.telefone = telEl.value.trim();
  try{
    await api('/api/admin/jogadores/'+id, {method:'PUT', adminAuth:true, body});
    state.editingJogadorId = null;
    await refreshElenco();
    await render();
  }catch(e){ alert(e.message); }
}
async function handleSalvarMensalidade(id, valor){
  try{ await api('/api/admin/jogadores/'+id+'/mensalidade', {method:'PUT', adminAuth:true, body:{mensalidade:valor}}); await render(); }
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
// ---- participantes do evento: rascunho dentro do cadastro do evento (gravado junto com o evento)
function pdNum(s){
  const t = String(s==null ? '' : s).replace(/[^\d.,]/g, '');
  if(!t) return 0;
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
}
function pdTotais(){
  const L = state.partDraft || [];
  let prev = 0, arr = 0, pg = 0, pa = 0, pe = 0;
  L.forEach(p=>{
    const v = pdNum(p.valor); prev += v;
    if(p.status==='pago'){ arr += v; pg++; }
    else if(p.status==='parcial'){ arr += Math.min(pdNum(p.pago), v); pa++; }
    else pe++;
  });
  return {qtd:L.length, previsto:prev, arrecadado:arr, aReceber:Math.max(0, prev-arr), pctPago: prev>0 ? Math.round(arr/prev*1000)/10 : 0, pagos:pg, parciais:pa, pendentes:pe};
}
function pdOpcoesStatus(sel){
  return ['pendente','parcial','pago'].map(st=>'<option value="'+st+'" '+(sel===st?'selected':'')+'>'+ST_EVENTO[st].rot+'</option>').join('');
}
function partDraftListaHtml(){
  const L = state.partDraft || [];
  if(!L.length) return '<p class="small muted" style="margin:8px 0 0;">Nenhum participante na lista ainda.</p>';
  return eventoTotaisHtml(pdTotais()) + L.map((p,i)=>
    '<div class="pd-row"><div class="pd-l1"><span class="pd-n">'+(i+1)+'. '+escapeHtml(p.nome)+'</span><button type="button" class="btn danger small" data-action="pd-del" data-i="'+i+'">remover</button></div>'+
    '<div class="pd-l2"><input inputmode="decimal" data-pd="valor" data-i="'+i+'" value="'+escapeHtml(p.valor)+'" aria-label="Valor (R$)" placeholder="Valor"><select data-pd="status" data-i="'+i+'" aria-label="Status">'+pdOpcoesStatus(p.status)+'</select></div>'+
    (p.status==='parcial' ? '<div class="pd-l3"><label>Valor pago (R$)</label><input inputmode="decimal" data-pd="pago" data-i="'+i+'" value="'+escapeHtml(p.pago)+'" placeholder="0,00"></div>' : '')+
    '</div>').join('');
}
function partDraftHtml(e){
  const l = state.eventoLista;
  if(state.partDraft == null){
    state.partDraft = (e && e.mostrarParticipantes && l) ? l.participantes.map(p=>({nome:p.nome, valor:inputValorBRL(p.valor), status:p.status, pago:inputValorBRL(p.status==='parcial' ? p.valorPago : 0)})) : [];
    state.partDirty = false;
  }
  const valorPad = inputValorBRL(pdNum(e && e.pgtoValor) || (l && l.valorPadrao) || 250);
  return '<div class="evt-novo pd-add"><div class="stack-tit">Adicionar participante</div>'+
    '<div class="field"><label>Nome</label><input id="pd-nome" maxlength="80" list="pd-jogadores" placeholder="Digite ou escolha um jogador"><datalist id="pd-jogadores">'+state.elenco.filter(j=>j.ativo).map(j=>'<option value="'+escapeHtml(j.nomeReal||j.nome)+'"></option>').join('')+'</datalist></div>'+
    '<div class="pd-l2"><div class="field"><label>Valor (R$)</label><input id="pd-valor" inputmode="decimal" value="'+valorPad+'"></div>'+
    '<div class="field"><label>Status</label><select id="pd-status">'+pdOpcoesStatus('pendente')+'</select></div></div>'+
    '<div class="field" id="pd-pago-campo" hidden><label>Valor pago (R$)</label><input id="pd-pago" inputmode="decimal" placeholder="0,00"></div>'+
    '<div class="btn-row"><button type="button" class="btn" data-action="pd-add">Adicionar</button><button type="button" class="btn secondary" data-action="pd-todos">Adicionar todos os jogadores</button></div></div>'+
    '<div id="pd-lista">'+partDraftListaHtml()+'</div>';
}
function pdRerender(){ const el = document.getElementById('pd-lista'); if(el) el.innerHTML = partDraftListaHtml(); }
function pdAdicionar(){
  const g = id => document.getElementById(id);
  const nome = g('pd-nome').value.trim();
  if(nome.length < 2){ alert('Informe o nome do participante.'); return; }
  if(state.partDraft.some(p=>p.nome.toLowerCase()===nome.toLowerCase())){ alert('Esse participante já está na lista.'); return; }
  const status = g('pd-status').value;
  state.partDraft.push({nome, valor:g('pd-valor').value.trim(), status, pago: status==='parcial' ? g('pd-pago').value.trim() : ''});
  state.partDirty = true;
  g('pd-nome').value = ''; g('pd-pago').value = '';
  pdRerender(); g('pd-nome').focus();
}
function pdTodos(){
  const valor = document.getElementById('pd-valor').value.trim();
  const ja = new Set(state.partDraft.map(p=>p.nome.toLowerCase()));
  let n = 0;
  state.elenco.filter(j=>j.ativo).forEach(j=>{
    const nm = j.nomeReal || j.nome;
    if(ja.has(nm.toLowerCase())) return;
    state.partDraft.push({nome:nm, valor, status:'pendente', pago:''}); n++;
  });
  if(n) state.partDirty = true;
  pdRerender(); showToast(n+' jogador(es) adicionados à lista');
}

// ---- despesas do evento: rascunho dentro do cadastro do evento (gravado junto com o evento)
function ddTotal(){ return (state.despDraft||[]).reduce((t,x)=>t+pdNum(x.valor), 0); }
function despesasDraftListaHtml(){
  const L = state.despDraft || [];
  if(!L.length) return '<p class="small muted" style="margin:8px 0 0;">Nenhuma despesa cadastrada ainda.</p>';
  return L.map((x,i)=>
    '<div class="pd-row"><div class="pd-l1"><span class="pd-n">'+(i+1)+'. Despesa</span><button type="button" class="btn danger small" data-action="dd-del" data-i="'+i+'">remover</button></div>'+
    '<div class="field"><input data-dd="despesa" data-i="'+i+'" maxlength="80" value="'+escapeHtml(x.despesa)+'" placeholder="Despesa"></div>'+
    '<div class="field"><input data-dd="fornecedor" data-i="'+i+'" maxlength="80" value="'+escapeHtml(x.fornecedor)+'" placeholder="Fornecedor"></div>'+
    '<div class="pd-l2"><input type="date" data-dd="data" data-i="'+i+'" value="'+escapeHtml(x.data)+'" aria-label="Data"><input inputmode="decimal" data-dd="valor" data-i="'+i+'" value="'+escapeHtml(x.valor)+'" placeholder="Valor (R$)" aria-label="Valor"></div></div>'
  ).join('') + relLinhaHtml('Total de despesas', fmtBRLfront(ddTotal()), 'rel-sub');
}
function despesasDraftHtml(e){
  if(state.despDraft == null){
    state.despDraft = ((e && e.despesas) || []).map(x=>({despesa:x.despesa, fornecedor:x.fornecedor||'', data:x.data||'', valor:inputValorBRL(x.valor)}));
    state.despDirty = false;
  }
  return '<div class="evt-novo pd-add"><div class="stack-tit">Adicionar despesa</div>'+
    '<div class="field"><label>Despesa</label><input id="dd-desp" maxlength="80" placeholder="Ex.: Aluguel do salão"></div>'+
    '<div class="field"><label>Fornecedor</label><input id="dd-forn" maxlength="80" placeholder="Ex.: Kanja\'s Resort"></div>'+
    '<div class="pd-l2"><div class="field"><label>Data</label><input type="date" id="dd-data"></div>'+
    '<div class="field"><label>Valor (R$)</label><input id="dd-valor" inputmode="decimal" placeholder="0,00"></div></div>'+
    '<div class="btn-row"><button type="button" class="btn" data-action="dd-add">Adicionar despesa</button></div></div>'+
    '<div id="dd-lista">'+despesasDraftListaHtml()+'</div>';
}
function ddRerender(){ const el = document.getElementById('dd-lista'); if(el) el.innerHTML = despesasDraftListaHtml(); }
function ddAdicionar(){
  const g = id => document.getElementById(id);
  const despesa = g('dd-desp').value.trim();
  if(despesa.length < 2){ alert('Informe o nome da despesa.'); return; }
  if(!g('dd-valor').value.trim()){ alert('Informe o valor da despesa.'); return; }
  state.despDraft.push({despesa, fornecedor:g('dd-forn').value.trim(), data:g('dd-data').value, valor:g('dd-valor').value.trim()});
  state.despDirty = true;
  g('dd-desp').value = ''; g('dd-forn').value = ''; g('dd-valor').value = '';
  ddRerender(); g('dd-desp').focus();
}
// ---- AGENDA DE EVENTOS (painel admin): lista + editor organizado em seções
function eventoSecao(cor, titulo, sub, corpo){
  return '<div class="fin-zona fz-'+cor+' evt-secao"><div class="fin-zona-tit">'+titulo+'</div>'+(sub?'<div class="fin-zona-sub">'+sub+'</div>':'')+corpo+'</div>';
}
function eventoEditorHtml(key, e, respOpc){
  const novo = key==='novo';
  e = e || {};
  const taStyle = 'width:100%;padding:9px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg-elevated-2);color:var(--text);font-family:var(--font-body);font-size:14.5px;box-sizing:border-box;';
  return '<div class="evt-editor"><div class="evt-editor-tit">'+(novo ? '➕ NOVO EVENTO' : '✏️ EDITANDO: '+escapeHtml(e.nome||''))+'</div>'+
    eventoSecao('azul', '📌 DADOS DO EVENTO', 'Nome, data, local e descrição',
      '<div class="field"><label>Nome do evento *</label><input id="ev-nome-'+key+'" value="'+escapeHtml(e.nome||'')+'" maxlength="100"></div>'+
      '<div class="field"><label>Data *</label><input type="date" id="ev-data-'+key+'" value="'+escapeHtml(e.data||'')+'"></div>'+
      '<div class="field"><label>Local (endereço) — abre no Waze, Google Maps ou Uber</label><input id="ev-local-'+key+'" maxlength="200" value="'+escapeHtml(e.local||'')+'" placeholder="Ex.: Sítio Boa Vista, Estrada do Sol, 1500 - Cotia"></div>'+
      '<div class="field"><label>Descrição</label><textarea id="ev-desc-'+key+'" rows="3" style="'+taStyle+'">'+escapeHtml(e.descricao||'')+'</textarea></div>'+
      '<div class="field"><label>Onde exibir</label><select id="ev-exib-'+key+'">'+
        [['ambos','🏠 Tela inicial e aba Eventos (Resenha)'],['aba','🎉 Somente na aba Eventos (Resenha)'],['oculto','🚫 Não exibir (inativo)']].map(o=>'<option value="'+o[0]+'" '+(o[0]===((novo||e.ativo)?(e.soAba?'aba':'ambos'):'oculto')?'selected':'')+'>'+o[1]+'</option>').join('')+'</select></div>')+
    eventoSecao('roxo', '👤 RESPONSÁVEIS', 'Quem gere o evento e quem recebe o pagamento',
      '<div class="field"><label>Gestor do Evento</label><select id="ev-resp-'+key+'">'+respOpc(e.responsavel||'')+'</select></div>'+
      '<div class="field"><label>Responsável pelo pagamento</label><input id="ev-pg-nome-'+key+'" value="'+escapeHtml(e.pgtoNome||'')+'" maxlength="80" placeholder="Nome de quem recebe"></div>')+
    eventoSecao('verde', '💳 DADOS PARA PAGAMENTO', 'Chave PIX e valor do evento',
      '<label class="small"><input type="checkbox" id="ev-pg-ativo-'+key+'" '+(e.pgtoAtivo?'checked':'')+'> Exibir dados para pagamento do evento</label>'+
      '<div class="field"><label>Chave PIX</label><input id="ev-pg-pix-'+key+'" value="'+escapeHtml(e.pgtoPix||'')+'" maxlength="120"></div>'+
      '<div class="field"><label>Valor do evento</label><input id="ev-pg-valor-'+key+'" value="'+escapeHtml(e.pgtoValor||'')+'" maxlength="40" placeholder="Ex.: R$ 250,00"></div>')+
    eventoSecao('ciano', '👥 PARTICIPANTES', 'Quem vai, valor e status do pagamento',
      '<label class="small"><input type="checkbox" id="ev-lista-'+key+'" '+(e.mostrarParticipantes?'checked':'')+'> Exibir a lista de participantes (nome e status) em "Sobre o Evento" e na aba Eventos</label>'+
      '<p class="small muted" style="margin:4px 0 8px;">Só um evento por vez exibe a lista. Os participantes são gravados ao tocar em "'+(novo?'Criar evento':'Salvar alterações')+'".</p>'+
      partDraftHtml(e))+
    eventoSecao('vermelho', '💸 DESPESAS', 'Despesa, fornecedor, data e valor (alimentam o DRE do evento)', despesasDraftHtml(e))+
    '<div class="btn-row"><button class="btn" data-action="salvar-evento" data-id="'+key+'">'+(novo?'Criar evento':'Salvar alterações')+'</button>'+
    '<button class="btn secondary" data-action="cancelar-edicao-evento">Cancelar</button></div></div>';
}
function renderAgendaAdminHtml(agenda, respOpc){
  let h = '<div class="card hz hz-verde"><h3>📅 AGENDA DE EVENTOS</h3>'+
    '<p class="small muted">Inclua, altere e remova eventos. Em cada evento você define onde ele aparece, o local, os responsáveis, o pagamento e a lista de participantes (que fica dentro do próprio evento).</p>';
  // bloco 1: incluir novo evento (destacado)
  h += '<div class="evt-bloco-novo"><div class="evt-bloco-tit">➕ INCLUIR NOVO EVENTO</div>';
  if(state.editingEventoId==='novo'){
    h += eventoEditorHtml('novo', {mostrarParticipantes: !agenda.some(x=>x.mostrarParticipantes)}, respOpc);
  }else{
    h += '<button class="btn" data-action="evento-novo">➕ Novo evento</button>';
  }
  h += '</div>';
  // divisor + bloco 2: eventos já cadastrados
  h += '<div class="evt-divisor"><span>📋 EVENTOS CADASTRADOS ('+agenda.length+')</span></div>';
  if(!agenda.length){
    h += '<p class="small muted" style="margin:6px 0 0;text-align:center;">Nenhum evento cadastrado.</p>';
  }
  agenda.forEach(e=>{
    if(state.editingEventoId===e.id){
      h += eventoEditorHtml(e.id, e, respOpc);
    }else{
      h += '<div class="evt-item evt-cad"><div class="evt-item-info"><div class="evt-item-nome">'+escapeHtml(e.nome)+'</div>'+
        '<div class="evt-item-badges"><span class="badge">'+formatDataBR(e.data)+'</span>'+(e.ativo?'':'<span class="badge">inativo</span>')+
          (e.local?'<span class="badge">📍 local</span>':'')+(e.responsavel?'<span class="badge">👤 '+escapeHtml(e.responsavel)+'</span>':'')+
          (!e.ativo?'':(e.soAba?'<span class="badge">🎉 só na aba Eventos</span>':'<span class="badge">🏠 início + aba</span>'))+
          (e.mostrarParticipantes?'<span class="badge">📋 lista</span>':'')+(e.pgtoAtivo?'<span class="badge">💳 pagamento</span>':'')+
          (e.mostrarParticipantes?'<button type="button" class="badge badge-btn" data-action="editar-evento" data-id="'+e.id+'">👥 participantes'+(state.eventoLista?' ('+state.eventoLista.participantes.length+')':'')+'</button>':'')+
          '<button type="button" class="badge badge-btn'+(state.eventoDreAberto===e.id?' ativo':'')+'" data-action="evento-dre-toggle" data-id="'+e.id+'">📊 DRE '+(state.eventoDreAberto===e.id?'▲':'▼')+'</button>'+
          ((e.despesas&&e.despesas.length)?'<span class="badge">💸 '+e.despesas.length+' despesa'+(e.despesas.length===1?'':'s')+'</span>':'')+'</div></div>'+
        '<div class="evt-item-acoes"><button class="btn secondary small" data-action="editar-evento" data-id="'+e.id+'">editar</button>'+
        '<button class="btn danger small" data-action="remover-evento" data-id="'+e.id+'">remover</button></div></div>';
      if(state.eventoDreAberto===e.id && state.eventoDre) h += '<div class="evt-dre-box">'+dreEventoPainelHtml(state.eventoDre)+'</div>';
    }
  });
  if(agenda.length && !agenda.some(e=>e.mostrarParticipantes)){
    h += '<p class="small muted" style="margin-top:10px;">Nenhum evento exibe a lista de participantes. Edite um evento e marque "Exibir a lista de participantes" para cadastrar os participantes.</p>';
  }
  return h + '</div>';
}
// campos extras do evento: lista de participantes ("Sobre o Evento") e dados para pagamento
function lerEventoExtras(key){
  const g = id => document.getElementById(id+key);
  return {local:g('ev-local-').value, mostrarParticipantes:g('ev-lista-').checked, pgtoAtivo:g('ev-pg-ativo-').checked, pgtoNome:g('ev-pg-nome-').value, pgtoPix:g('ev-pg-pix-').value, pgtoValor:g('ev-pg-valor-').value};
}
async function handleSalvarEvento(key){
  const g = x => document.getElementById(x+'-'+key);
  const nome = g('ev-nome').value.trim();
  const data = g('ev-data').value;
  if(!nome || !data){ alert('Informe nome e data.'); return; }
  const corpo = {nome, data, descricao:g('ev-desc').value, responsavel:g('ev-resp').value, ativo:g('ev-exib').value!=='oculto', soAba:g('ev-exib').value==='aba', ...lerEventoExtras(key)};
  if(state.despDirty) corpo.despesas = (state.despDraft||[]).map(x=>({despesa:x.despesa, fornecedor:x.fornecedor, data:x.data, valor:x.valor}));
  if(state.partDirty) corpo.participantes = (state.partDraft||[]).map(p=>({nome:p.nome, valor:p.valor, status:p.status, valorPago:p.pago}));
  try{
    if(key==='novo') await api('/api/admin/agenda', {method:'POST', adminAuth:true, body:corpo});
    else await api('/api/admin/agenda/'+key, {method:'PUT', adminAuth:true, body:corpo});
    state.editingEventoId = null; state.partDraft = null; state.partDirty = false; state.despDraft = null; state.despDirty = false; state.eventoDre = null; state.eventoDreAberto = null;
    await refreshEvento();
    await refreshHomeExtras();
    await render();
    showToast(key==='novo' ? 'Evento criado!' : 'Evento salvo!');
  }catch(e){ alert(e.message); }
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
      if(state.tab==='resenha' && state.resenhaAba==='rifas') await refreshRifas();
      if(state.tab==='resenha' && state.resenhaAba==='trampos' && !state.trampoFormAberto) await refreshTrampos();
      if(state.tab==='resenha' && state.resenhaAba==='evento'){ await refreshEvento(); await refreshHomeExtras(); }
      if((state.tab==='sorteio' || (state.tab==='votacao' && (state.votacaoAba==='votos' || state.votacaoAba==='historico'))) && state.rodadaVisualizadaId && (!state.rodadaAtual || state.rodadaVisualizadaId!==state.rodadaAtual.id)){
        await carregarRodadaVisualizada(state.rodadaVisualizadaId);
      }
      render();
    }
  }, 8000);
}

// Escreve em #content só se o HTML realmente mudou desde a última vez que ESSA
// tela (key) foi quem escreveu lá — evita recriar <img> (escudos) sem necessidade
// a cada re-render (clique ou polling) e é o que fazia elas "piscarem" no Sorteio
// e na Resenha. Troca de aba sempre escreve (key diferente do que está lá).
function setContent(html, key){
  if(state._lastContentKey === key && state._lastContentHtml === html) return;
  document.getElementById('content').innerHTML = html;
  state._lastContentKey = key;
  state._lastContentHtml = html;
}

/* ============================================================
   RENDER PRINCIPAL + EVENTOS
   ============================================================ */
async function render(){
  renderTopbar();
  if(!state.currentPlayer){ renderLogin(); return; }
  // toda troca de aba força o #content a ser reescrito, mesmo que a próxima tela
  // use setContent() e o HTML dela não tenha mudado — outras telas escrevem em
  // #content por fora do cache, então "voltar" pra uma aba com cache podia deixar
  // o conteúdo antigo (de outra aba) na tela sem reescrever nada.
  if(state._lastRenderedTab !== state.tab){
    state._lastContentKey = null;
    state._lastRenderedTab = state.tab;
    registrarTela(state.tab);
  }
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
  if(action==='salvar-perfil') return handleSalvarPerfil();
  if(action==='cancelar-troca-pin') return handleCancelarTrocaPin();
  if(action==='tab'){
    state.tab = el.dataset.tab; state.editingJogadorId=null; state.editingEventoId=null; state.partDraft=null; state.partDirty=false; state.despDraft=null; state.despDirty=false; state.eventoDre=null; state.eventoDreAberto=null;
    if(['sorteio','resenha','votacao'].includes(state.tab)) await irParaRodadaMaisRecente();
    return render();
  }
  if(action==='toggle-presenca') return handleTogglePresenca(el.dataset.atual);
  if(action==='toggle-convidado') return handleToggleConvidado(el.dataset.atual);
  if(action==='toggle-resenha') return handleToggleResenha(el.dataset.atual);
  if(action==='toggle-vinho') return handleToggleVinho(el.dataset.atual);
  if(action==='abrir-admin'){ state.tab='admin'; state.editingJogadorId=null; state.editingEventoId=null; return render(); }
  if(action==='copiar-pix') return handleCopiarPix(el.dataset.pix);
  if(action==='resenha-aba'){ state.resenhaAba = el.dataset.aba; state._lastContentKey = null; if(state.resenhaAba==='rifas') await refreshRifas(); if(state.resenhaAba==='trampos') await refreshTrampos(); if(state.resenhaAba==='evento'){ await refreshEvento(); await refreshHomeExtras(); } return render(); }
  if(action==='trampo-abrir'){ state.trampoFormAberto = true; state._lastContentKey = null; return render(); }
  if(action==='trampo-cancelar'){ state.trampoFormAberto = false; state._lastContentKey = null; return render(); }
  if(action==='trampo-publicar') return handlePublicarTrampo();
  if(action==='trampo-remover') return handleRemoverTrampo(el.dataset.id);
  if(action==='votacao-aba'){ state.votacaoAba = el.dataset.aba; state._lastContentKey = null; if(state.votacaoAba==='votos' || state.votacaoAba==='historico') await irParaRodadaMaisRecente(); return render(); }
  if(action==='ranking-jogador') return abrirPerformance(el.dataset.id);
  if(action==='fechar-performance') return fecharPerformance();
  if(action==='noop') return;
  if(action==='ranking-aba'){ state.rankingAba = el.dataset.aba; return render(); }
  if(action==='votar') return handleVotar(el.dataset.avaliado, parseInt(el.dataset.nota,10));
  if(action==='disparar-sorteio') return handleDispararSorteio();
  if(action==='desfazer-sorteio') return handleDesfazerSorteio(el.dataset.id);
  if(action==='criar-rodada') return handleCriarRodada();
  if(action==='remover-rodada') return handleRemoverRodada(el.dataset.id, el.dataset.data, el.dataset.fase, el.dataset.hist==='1');
  if(action==='salvar-config') return handleSalvarConfig();
  if(action==='salvar-sorteio-agenda') return handleSalvarSorteioAgenda();
  if(action==='elenco-aba'){ state.elencoAba = el.dataset.aba; return render(); }
  if(action==='baixar-pdf') return handleBaixarPdf(el.dataset.url, el.dataset.arq);
  if(action==='gestao-filtro'){ state.gestaoFiltro = el.dataset.f; return render(); }
  if(action==='home-ordem-subir') return handleMoverCardInicio(el.dataset.k, -1);
  if(action==='home-ordem-descer') return handleMoverCardInicio(el.dataset.k, 1);
  if(action==='home-ordem-padrao') return handleOrdemPadraoInicio();
  if(action==='evt-adicionar') return handleEvtAdicionar();
  if(action==='evt-salvar') return handleEvtSalvar(el.dataset.id);
  if(action==='evt-editar'){ state.eventoEditId = (state.eventoEditId===el.dataset.id) ? null : el.dataset.id; return render(); }
  if(action==='evt-remover') return handleEvtRemover(el.dataset.id);
  if(action==='evt-valor-padrao') return handleEvtValorPadrao();
  if(action==='evt-todos') return handleEvtTodos();
  if(action==='evt-aba-salvar') return handleEvtAbaSalvar();
  if(action==='salvar-rifa') return handleSalvarRifa(false);
  if(action==='rifa-editar'){
    state.rifaRodadaId = el.dataset.id; await render();
    const campo = document.getElementById('rifa-ganhador');
    if(campo && campo.scrollIntoView) campo.scrollIntoView({block:'center'});
    return;
  }
  if(action==='rifa-remover'){ if(confirm('Remover o ganhador e o prêmio desta rifa?')) return handleSalvarRifa(true, el.dataset.id); return; }
  if(action==='limpar-rifa'){ if(confirm('Remover o ganhador e o prêmio desta rodada?')) return handleSalvarRifa(true); return; }
  if(action==='acessos-periodo'){ state.acessosPeriodo = parseInt(el.dataset.d,10); return render(); }
  if(action==='acesso-abrir'){ state.acessoAberto = (state.acessoAberto===el.dataset.id) ? null : el.dataset.id; return render(); }
  if(action==='gestao-sub'){ state.gestaoSub = el.dataset.sub; return render(); }
  if(action==='baixar-pdf-fin'){
    const sel = document.getElementById('rel-pdf-status');
    const st = sel ? sel.value : 'todos';
    const ref = (state.relatorioFin && state.relatorioFin.referencia) || 'mensalidades';
    return handleBaixarPdf('/api/admin/relatorio-financeiro.pdf'+(st==='todos'?'':'?status='+st), 'financeiro-por-mensalidades-'+ref+(st==='todos'?'':'-'+st)+'.pdf');
  }
  if(action==='salvar-custos') return handleSalvarCustos();
  if(action==='salvar-saldo-caixa') return handleSalvarSaldoCaixa();
  if(action==='mens-editar'){ state.editandoMensId = (state.editandoMensId===el.dataset.id) ? null : el.dataset.id; return render(); }
  if(action==='mens-usar-padrao'){ const inp = document.getElementById('mens-valor-'+el.dataset.id); if(inp) inp.value = el.dataset.valor; return; }
  if(action==='mens-salvar-valor') return handleSalvarMensalidadeValor(el.dataset.id);
  if(action==='mens-salvar-atraso') return handleSalvarAtrasoDesde(el.dataset.id);
  if(action==='mens-usar-vencimento'){ const inp = document.getElementById('mens-desde-'+el.dataset.id); if(inp) inp.value = el.dataset.data; return; }
  if(action==='toggle-reserva') return handleToggleReserva(el.dataset.id, el.dataset.atual);
  if(action==='alternar-mostrar-votos') return handleSalvarMostrarVotos(el.dataset.atual);
  if(action==='adicionar-jogador') return handleAdicionarJogador();
  if(action==='editar-jogador'){ state.editingJogadorId = el.dataset.id; return render(); }
  if(action==='cancelar-edicao'){ state.editingJogadorId = null; return render(); }
  if(action==='salvar-jogador') return handleSalvarJogador(el.dataset.id);
  if(action==='remover-jogador') return handleRemoverJogador(el.dataset.id);
  if(action==='salvar-admin-pin') return handleSalvarAdminPin();
  if(action==='pd-add') return pdAdicionar();
  if(action==='pd-todos') return pdTodos();
  if(action==='pd-del'){ state.partDraft.splice(Number(el.dataset.i), 1); state.partDirty = true; return pdRerender(); }
  if(action==='dd-add') return ddAdicionar();
  if(action==='dd-del'){ state.despDraft.splice(Number(el.dataset.i), 1); state.despDirty = true; return ddRerender(); }
  if(action==='evento-dre-toggle') return handleEventoDreToggle(el.dataset.id);
  if(action==='baixar-evento-dre') return handleBaixarEventoDre(el.dataset.id, el.dataset.fmt);
  if(action==='evento-novo'){ state.editingEventoId = 'novo'; state.partDraft = null; state.partDirty = false; state.despDraft = null; state.despDirty = false; return render(); }
  if(action==='editar-evento'){ state.editingEventoId = el.dataset.id; state.partDraft = null; state.partDirty = false; state.despDraft = null; state.despDirty = false; return render(); }
  if(action==='cancelar-edicao-evento'){ state.editingEventoId = null; state.partDraft = null; state.partDirty = false; state.despDraft = null; state.despDirty = false; return render(); }
  if(action==='salvar-evento') return handleSalvarEvento(el.dataset.id);
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

document.getElementById('shell').addEventListener('input', (e)=>{
  const t = e.target;
  if(t && t.dataset && t.dataset.dd && state.despDraft && state.despDraft[Number(t.dataset.i)]){ state.despDraft[Number(t.dataset.i)][t.dataset.dd] = t.value; state.despDirty = true; }
  if(t && t.dataset && t.dataset.pd && state.partDraft && state.partDraft[Number(t.dataset.i)]){ state.partDraft[Number(t.dataset.i)][t.dataset.pd] = t.value; state.partDirty = true; }
});
document.getElementById('shell').addEventListener('change', async (e)=>{
  if(e.target.dataset && e.target.dataset.dd && state.despDraft && state.despDraft[Number(e.target.dataset.i)]){
    state.despDraft[Number(e.target.dataset.i)][e.target.dataset.dd] = e.target.value; state.despDirty = true;
    if(e.target.dataset.dd==='valor') ddRerender();
    return;
  }
  if(e.target.id==='pd-status'){ const c = document.getElementById('pd-pago-campo'); if(c) c.hidden = e.target.value!=='parcial'; return; }
  if(e.target.dataset && e.target.dataset.pd && state.partDraft && state.partDraft[Number(e.target.dataset.i)]){
    state.partDraft[Number(e.target.dataset.i)][e.target.dataset.pd] = e.target.value; state.partDirty = true; pdRerender(); return;
  }
  if(e.target.dataset.action==='mudar-rodada-visualizada'){
    await carregarRodadaVisualizada(e.target.value);
    render();
  }
  if(e.target.dataset.action==='rifa-rodada'){
    state.rifaRodadaId = e.target.value;
    render();
  }
  if(e.target.dataset.action==='evt-status'){
    await handleEvtStatus(e.target.dataset.id, e.target.value);
  }
  if(e.target.dataset.action==='salvar-mensalidade'){
    await handleSalvarMensalidade(e.target.dataset.id, e.target.value);
  }
});

/* eventos da tela inicial: fica aberto por até 30s mesmo com o polling redesenhando a tela,
   e recolhe sozinho se o usuário não fechar antes disso. */
document.getElementById('shell').addEventListener('toggle', (e)=>{
  const d = e.target;
  if(d && d.classList && d.classList.contains('evento-sobre')){ state.eventoSobreAberto = !!d.open; return; }
  if(d && d.classList && d.classList.contains('evento-local')){ state.eventoLocalAberto = !!d.open; return; }
  if(!d || !d.classList || !d.classList.contains('evento-item')) return;
  const id = d.dataset.eventoId || '';
  if(d._autoCloseTimer){ clearTimeout(d._autoCloseTimer); d._autoCloseTimer = null; }
  if(d.open){
    state.eventoAbertoId = id;
    state.eventoAbertoExp = Date.now() + 30000;
    d._autoCloseTimer = setTimeout(()=>{
      d.open = false;
      if(state.eventoAbertoId===id){ state.eventoAbertoId=null; state.eventoAbertoExp=0; }
    }, 30000);
  }else if(state.eventoAbertoId===id){
    state.eventoAbertoId = null; state.eventoAbertoExp = 0;
  }
}, true);

/* ============================================================
   LOGOUT POR INATIVIDADE (10 minutos sem interação)
   ============================================================ */
const INATIVIDADE_MS = 10*60*1000;
function pararInatividade(){
  if(state.inatividadeTimer){ clearTimeout(state.inatividadeTimer); state.inatividadeTimer = null; }
}
function resetInatividade(){
  if(!state.currentPlayer) return;
  pararInatividade();
  state.inatividadeTimer = setTimeout(()=>{
    if(state.currentPlayer) handleLogout();
  }, INATIVIDADE_MS);
}
['click','touchstart','keydown','scroll'].forEach(evt=>{
  window.addEventListener(evt, resetInatividade, {passive:true});
});

/* ============================================================
   BOOT
   ============================================================ */
// controle de acessos: registra a troca de tela e a abertura do app (silencioso, nunca atrapalha)
function registrarTela(tela){
  if(!state.token || !state.currentPlayer) return;
  api('/api/acesso', {method:'POST', auth:true, body:{tipo:'tela', tela}}).catch(()=>{});
}
async function boot(){
  document.getElementById('content').innerHTML = '<div class="empty">Carregando…</div>';
  await refreshVersion();
  await refreshMe();
  await refreshElenco();
  await refreshRodadaAtual();
  await refreshRodadasLista();
  await refreshRanking();
  await refreshHomeExtras();
  if(state.currentPlayer && state.token){
    startPolling(); resetInatividade();
    api('/api/acesso', {method:'POST', auth:true, body:{tipo:'abertura'}}).catch(()=>{});
  }
  await render();
}
boot();

})();
