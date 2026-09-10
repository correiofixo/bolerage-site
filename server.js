/* ============================================================
   Bolerage F.D. — Site de sorteio e avaliação da pelada
   Backend Node.js + Express + SQLite (better-sqlite3)
   ============================================================ */
'use strict';

// Fonte única de verdade da versão do app. Atualize aqui a cada release
// (aparece na tela do jogador e ajuda a confirmar que um deploy realmente aplicou).
const APP_VERSION = '1.0.11';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bolerage.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/* ============================================================
   ESQUEMA DO BANCO
   ============================================================ */
db.exec(`
CREATE TABLE IF NOT EXISTS jogadores (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  pin TEXT NOT NULL,
  posicao_padrao TEXT NOT NULL CHECK(posicao_padrao IN ('linha','goleiro')),
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_pin TEXT NOT NULL,
  min_rodadas INTEGER NOT NULL DEFAULT 4,
  min_votos INTEGER NOT NULL DEFAULT 3,
  simulado_now TEXT
);

CREATE TABLE IF NOT EXISTS rodadas (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aguardando_confirmacao'
);

CREATE TABLE IF NOT EXISTS confirmacoes (
  id TEXT PRIMARY KEY,
  rodada_id TEXT NOT NULL,
  jogador_id TEXT NOT NULL,
  confirmado_em TEXT,
  desconfirmado_em TEXT,
  UNIQUE(rodada_id, jogador_id)
);

CREATE TABLE IF NOT EXISTS times_sorteados (
  id TEXT PRIMARY KEY,
  rodada_id TEXT NOT NULL,
  nome_time TEXT NOT NULL,
  jogador_id TEXT NOT NULL,
  papel_na_partida TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservas (
  id TEXT PRIMARY KEY,
  rodada_id TEXT NOT NULL,
  jogador_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rodada_meta (
  rodada_id TEXT PRIMARY KEY,
  modo_sorteio TEXT
);

CREATE TABLE IF NOT EXISTS votos (
  id TEXT PRIMARY KEY,
  rodada_id TEXT NOT NULL,
  jogador_avaliado_id TEXT NOT NULL,
  jogador_avaliador_id TEXT NOT NULL,
  nota INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE(rodada_id, jogador_avaliado_id, jogador_avaliador_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  jogador_id TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventos_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  mensagem TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  data TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS noticia (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  descricao TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS aluguel_quadra (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nome TEXT NOT NULL DEFAULT '',
  chave_pix TEXT NOT NULL DEFAULT '',
  valor_mensalidade TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gestao (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  presidente TEXT NOT NULL DEFAULT '',
  vice_presidente TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 0
);
`);

// migração: coluna 'status' (presente/ausente) na tabela confirmacoes.
// usa try/catch porque ALTER TABLE falha se a coluna já existir (idempotente entre reinícios).
try{ db.exec("ALTER TABLE confirmacoes ADD COLUMN status TEXT"); }catch(e){}
try{ db.exec("ALTER TABLE confirmacoes ADD COLUMN trouxe_convidado INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE confirmacoes ADD COLUMN resenha INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN admin INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN admin_perms TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN mensalidade TEXT NOT NULL DEFAULT ''"); }catch(e){}

// permissões concedíveis a um sub-admin (o Super Admin tem tudo, sempre).
const PERMS_ADMIN = ['conteudo','mensalidades'];
const MENSALIDADE_VALORES = ['', 'em_dia', 'em_atraso', 'isenta'];

function seedExtrasSeNecessario(){
  const n = db.prepare('SELECT * FROM noticia WHERE id=1').get();
  if(!n) db.prepare('INSERT INTO noticia (id,descricao,ativo) VALUES (1,\'\',0)').run();
  const a = db.prepare('SELECT * FROM aluguel_quadra WHERE id=1').get();
  if(!a) db.prepare('INSERT INTO aluguel_quadra (id,nome,chave_pix,valor_mensalidade,ativo) VALUES (1,\'\',\'\',\'\',0)').run();
  const g = db.prepare('SELECT * FROM gestao WHERE id=1').get();
  if(!g) db.prepare('INSERT INTO gestao (id,presidente,vice_presidente,ativo) VALUES (1,\'\',\'\',0)').run();
  // acesso administrativo agora é por jogador (coluna admin). Se ninguém for admin
  // ainda, promove o Josué pelo nome — feito uma única vez.
  const temAdmin = db.prepare('SELECT 1 FROM jogadores WHERE admin=1').get();
  if(!temAdmin) db.prepare("UPDATE jogadores SET admin=1 WHERE nome='Josué'").run();
  // Josué é o Super Admin — sempre. Se ninguém for super ainda, promove pelo nome.
  const temSuper = db.prepare('SELECT 1 FROM jogadores WHERE super_admin=1').get();
  if(!temSuper) db.prepare("UPDATE jogadores SET super_admin=1, admin=1 WHERE nome='Josué'").run();
  // migração dos rótulos antigos de mensalidade (v1.0.7/1.0.8 -> v1.0.9) — idempotente.
  try{ db.prepare("UPDATE jogadores SET mensalidade='em_dia' WHERE mensalidade='ok'").run(); }catch(e){}
  try{ db.prepare("UPDATE jogadores SET mensalidade='em_atraso' WHERE mensalidade='atrasada'").run(); }catch(e){}
}
seedExtrasSeNecessario();

/* ============================================================
   SEED INICIAL
   ============================================================ */
function idGen(prefix){ return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function nowISO(){ return new Date().toISOString(); }

function logEvento(msg){
  db.prepare('INSERT INTO eventos_log (id, ts, mensagem) VALUES (?,?,?)').run(idGen('e'), nowISO(), msg);
}

function seedSeNecessario(){
  const totalJogadores = db.prepare('SELECT COUNT(*) c FROM jogadores').get().c;
  if(totalJogadores === 0){
    const insert = db.prepare('INSERT INTO jogadores (id,nome,pin,posicao_padrao,ativo) VALUES (?,?,?,?,1)');
    for(let i=1;i<=22;i++) insert.run('j'+String(i).padStart(2,'0'), 'Jogador '+String(i).padStart(2,'0'), String(1000+i), 'linha');
    for(let i=1;i<=3;i++) insert.run('g'+String(i).padStart(2,'0'), 'Goleiro '+String(i).padStart(2,'0'), String(2000+i), 'goleiro');
    logEvento('Elenco inicial de exemplo criado (25 jogadores).');
  }
  const cfg = db.prepare('SELECT * FROM config WHERE id=1').get();
  if(!cfg){
    db.prepare('INSERT INTO config (id, admin_pin, min_rodadas, min_votos, simulado_now) VALUES (1,?,4,3,NULL)').run('9999');
    logEvento('PIN administrativo inicial definido como 9999 — troque antes de usar com o grupo.');
  }
  const totalRodadas = db.prepare('SELECT COUNT(*) c FROM rodadas').get().c;
  if(totalRodadas === 0){
    const data = nextSundayFrom(todaySPDateStr());
    const id = idGen('r');
    db.prepare('INSERT INTO rodadas (id,data,status) VALUES (?,?,?)').run(id, data, 'aguardando_confirmacao');
    logEvento('Primeira rodada criada automaticamente para ' + data + '.');
  }
}

/* ============================================================
   DATA / FUSO HORÁRIO (America/Sao_Paulo, seguro p/ horário de verão)
   ============================================================ */
function pad(n){ return String(n).padStart(2,'0'); }

function spWallClockNow(){
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).formatToParts(new Date());
  const g = t => parts.find(p=>p.type===t).value;
  return g('year')+'-'+g('month')+'-'+g('day')+'T'+g('hour')+':'+g('minute')+':'+g('second');
}

function nowSP(){
  const cfg = db.prepare('SELECT simulado_now FROM config WHERE id=1').get();
  if(cfg && cfg.simulado_now) return cfg.simulado_now + ':00';
  return spWallClockNow();
}

function addDaysToDateStr(dateStr, days){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate()+days);
  return dt.getUTCFullYear()+'-'+pad(dt.getUTCMonth()+1)+'-'+pad(dt.getUTCDate());
}
function weekdayOf(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).getUTCDay();
}
function nextSundayFrom(dateStr){
  let d = dateStr;
  while(weekdayOf(d)!==0){ d = addDaysToDateStr(d,1); }
  return d;
}
function todaySPDateStr(){ return nowSP().slice(0,10); }

function janelas(rodadaData){
  return {
    confirmOpen:  addDaysToDateStr(rodadaData,-1)+'T08:00:00',
    confirmClose: rodadaData+'T08:00:00',
    voteOpen:     rodadaData+'T10:00:00',
    voteClose:    rodadaData+'T18:00:00',
    // janela de "última hora" da resenha: domingo 10h → 11h
    resenhaLivreOpen:  rodadaData+'T10:00:00',
    resenhaLivreClose: rodadaData+'T11:00:00',
  };
}

function computeFase(rodada){
  if(!rodada) return {chave:'sem_rodada', label:'Nenhuma rodada agendada', cor:'muted'};
  const now = nowSP();
  const j = janelas(rodada.data);
  if(rodada.status==='nao_viabilizado') return {chave:'nao_viabilizado', label:'Racha não viabilizado nesta semana', cor:'red'};
  if(rodada.status==='sorteado'){
    if(now < j.voteOpen) return {chave:'sorteado_aguardando_votacao', label:'Times sorteados — votação abre domingo às 10h', cor:'gold'};
    if(now < j.voteClose) return {chave:'votacao_aberta', label:'Votação aberta até as 18h', cor:'green'};
    return {chave:'encerrada', label:'Rodada encerrada', cor:'muted'};
  }
  if(now < j.confirmOpen) return {chave:'pre_confirmacao', label:'Confirmação abre sábado às 8h', cor:'muted'};
  if(now < j.confirmClose) return {chave:'confirmacao_aberta', label:'Confirmação aberta até domingo às 8h', cor:'green'};
  return {chave:'aguardando_sorteio', label:'Confirmação encerrada — aguardando sorteio', cor:'gold'};
}

/* ============================================================
   CONSULTAS AUXILIARES
   ============================================================ */
function getJogadores(){ return db.prepare('SELECT * FROM jogadores').all(); }
function getJogadorPorId(id){ return db.prepare('SELECT * FROM jogadores WHERE id=?').get(id); }
function getConfig(){ return db.prepare('SELECT * FROM config WHERE id=1').get(); }
function getRodadas(){ return db.prepare('SELECT * FROM rodadas ORDER BY data DESC').all(); }
function getRodadaPorId(id){ return db.prepare('SELECT * FROM rodadas WHERE id=?').get(id); }
function getRodadaAtual(){
  // "rodada atual" = a mais antiga que ainda não está finalizada (encerrada ou não viabilizada).
  // Isso evita que criar a rodada da próxima semana "esconda" uma rodada ainda em andamento
  // (ex.: votação aberta) na semana corrente.
  const rows = db.prepare('SELECT * FROM rodadas ORDER BY data ASC').all();
  if(!rows.length) return null;
  for(const r of rows){
    atualizarStatusSeNecessario(r);
    const fase = computeFase(r);
    if(fase.chave!=='encerrada' && fase.chave!=='nao_viabilizado') return r;
  }
  return rows[rows.length-1]; // todas finalizadas: mostra a mais recente
}
function getPorStatus(rodadaId, status){
  return db.prepare(`
    SELECT j.* FROM confirmacoes c
    JOIN jogadores j ON j.id = c.jogador_id
    WHERE c.rodada_id = ? AND c.status = ?
  `).all(rodadaId, status);
}
function contarConvidados(rodadaId){
  return db.prepare("SELECT COUNT(*) c FROM confirmacoes WHERE rodada_id=? AND status='presente' AND trouxe_convidado=1").get(rodadaId).c;
}
function calcViabilidade(rodadaId){
  const confirmados = getPorStatus(rodadaId, 'presente');
  const linha = confirmados.filter(j=>j.posicao_padrao==='linha').length + contarConvidados(rodadaId);
  const goleiro = confirmados.filter(j=>j.posicao_padrao==='goleiro').length;
  const viaPadrao = linha>=10 && goleiro>=2;
  const viaConversao = linha>=12;
  return {viavel: viaPadrao||viaConversao, linha, goleiro, viaConversao: !viaPadrao && viaConversao};
}

// verifica/marca automaticamente como não viabilizado quando a janela fechou
function atualizarStatusSeNecessario(rodada){
  if(rodada.status === 'aguardando_confirmacao'){
    const j = janelas(rodada.data);
    if(nowSP() >= j.confirmClose){
      const v = calcViabilidade(rodada.id);
      if(!v.viavel){
        db.prepare('UPDATE rodadas SET status=? WHERE id=?').run('nao_viabilizado', rodada.id);
        logEvento('Rodada de '+rodada.data+' marcada como não viabilizada automaticamente ('+v.linha+' linha, '+v.goleiro+' goleiros).');
        rodada.status = 'nao_viabilizado';
      }
    }
  }
  return rodada;
}

/* ============================================================
   RANKING
   ============================================================ */
function calcularRanking(){
  const rows = db.prepare(`
    SELECT v.jogador_avaliado_id as jogadorId,
           COALESCE(t.papel_na_partida, j.posicao_padrao) as papel,
           v.nota as nota
    FROM votos v
    JOIN jogadores j ON j.id = v.jogador_avaliado_id
    LEFT JOIN times_sorteados t ON t.rodada_id = v.rodada_id AND t.jogador_id = v.jogador_avaliado_id
  `).all();
  const acc = {};
  rows.forEach(r=>{
    acc[r.jogadorId] = acc[r.jogadorId] || {linha:{soma:0,total:0}, goleiro:{soma:0,total:0}};
    acc[r.jogadorId][r.papel].soma += r.nota;
    acc[r.jogadorId][r.papel].total += 1;
  });
  const result = {};
  Object.keys(acc).forEach(id=>{
    result[id] = {
      linha:{media: acc[id].linha.total? acc[id].linha.soma/acc[id].linha.total : null, total: acc[id].linha.total},
      goleiro:{media: acc[id].goleiro.total? acc[id].goleiro.soma/acc[id].goleiro.total : null, total: acc[id].goleiro.total},
    };
  });
  return result;
}

function mediaGlobalDoPapel(ranking, papel){
  const vals = Object.values(ranking).map(r=>r[papel] && r[papel].media).filter(v=>v!=null);
  if(!vals.length) return 2.5;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
function mediaOuFallback(ranking, jogadorId, papel, mediaGlobal){
  const r = ranking[jogadorId];
  if(r && r[papel] && r[papel].media!=null) return r[papel].media;
  return mediaGlobal;
}

function fase2Atingida(ranking){
  const cfg = getConfig();
  const rodadasSorteadas = db.prepare("SELECT * FROM rodadas WHERE status='sorteado'").all();
  let rodadasEncerradas = 0;
  const jogaramAlgumaVez = new Set();
  rodadasSorteadas.forEach(r=>{
    const j = janelas(r.data);
    if(nowSP() >= j.voteClose){
      rodadasEncerradas++;
      db.prepare('SELECT DISTINCT jogador_id FROM times_sorteados WHERE rodada_id=?').all(r.id)
        .forEach(row=>jogaramAlgumaVez.add(row.jogador_id));
    }
  });
  if(rodadasEncerradas < cfg.min_rodadas) return false;
  for(const id of jogaramAlgumaVez){
    const jogador = getJogadorPorId(id);
    if(!jogador || !jogador.ativo) continue;
    const r = ranking[id];
    const totalVotos = (r? r.linha.total:0) + (r? r.goleiro.total:0);
    if(totalVotos < cfg.min_votos) return false;
  }
  return true;
}

/* ============================================================
   SORTEIO
   ============================================================ */
const NOMES_TIMES = ['Brasil','Argentina','Alemanha','Itália','Holanda'];

function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const k=Math.floor(Math.random()*(i+1));
    [a[i],a[k]]=[a[k],a[i]];
  }
  return a;
}
function snakeDraft(sortedDesc, n){
  const buckets = Array.from({length:n},()=>[]);
  sortedDesc.forEach((item,i)=>{
    const round = Math.floor(i/n);
    const pos = round%2===0 ? (i%n) : (n-1-(i%n));
    buckets[pos].push(item);
  });
  return buckets;
}

function realizarSorteio(rodadaId){
  const rodada = getRodadaPorId(rodadaId);
  if(!rodada) return {ok:false, erro:'Rodada não encontrada.'};
  const j = janelas(rodada.data);
  if(rodada.status !== 'aguardando_confirmacao') return {ok:false, erro:'Esta rodada já foi sorteada ou não está mais aguardando confirmação.'};
  if(nowSP() < j.confirmClose) return {ok:false, erro:'A janela de confirmação ainda está aberta.'};
  const v = calcViabilidade(rodadaId);
  if(!v.viavel) return {ok:false, erro:'Jogo não viabilizado: confirmações insuficientes.'};

  const confirmados = getPorStatus(rodadaId, 'presente');
  const linhaPoolReal = confirmados.filter(x=>x.posicao_padrao==='linha');
  const goleiroPool = confirmados.filter(x=>x.posicao_padrao==='goleiro');
  const guestRows = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND status='presente' AND trouxe_convidado=1").all(rodadaId);
  const guestPool = guestRows.map(g=>({id:'conv:'+g.jogador_id, posicao_padrao:'linha', isGuest:true, hostId:g.jogador_id}));
  const linhaPool = [...linhaPoolReal, ...guestPool];

  let n = 0;
  for(let cand=5; cand>=1; cand--){
    const conv = Math.max(0, cand-goleiroPool.length);
    if(linhaPool.length >= cand*5+conv){ n=cand; break; }
  }
  if(n===0) return {ok:false, erro:'Jogadores insuficientes para formar um time.'};

  const conversoesNecessarias = Math.max(0, n-goleiroPool.length);
  const golDesignados = goleiroPool.slice(0,n);
  const golReserva = goleiroPool.slice(n);

  const ranking = calcularRanking();
  const usarFase2 = fase2Atingida(ranking);

  let linhaOrdenada, golOrdenado;
  if(usarFase2){
    const mgLinha = mediaGlobalDoPapel(ranking,'linha');
    const mgGol = mediaGlobalDoPapel(ranking,'goleiro');
    linhaOrdenada = [...linhaPool].sort((a,b)=> mediaOuFallback(ranking,b.id,'linha',mgLinha) - mediaOuFallback(ranking,a.id,'linha',mgLinha));
    golOrdenado = [...golDesignados].sort((a,b)=> mediaOuFallback(ranking,b.id,'goleiro',mgGol) - mediaOuFallback(ranking,a.id,'goleiro',mgGol));
  }else{
    linhaOrdenada = shuffle(linhaPool);
    golOrdenado = shuffle(golDesignados);
  }
  // convidados sempre priorizados como reserva: reordena mantendo jogadores cadastrados
  // primeiro (na ordem já calculada) e convidados sempre por último.
  linhaOrdenada = [...linhaOrdenada.filter(x=>!x.isGuest), ...linhaOrdenada.filter(x=>x.isGuest)];

  const linhaEmCampo = linhaOrdenada.slice(0, n*5);
  const remainder = linhaOrdenada.slice(n*5);
  const remainderNaoGuest = remainder.filter(x=>!x.isGuest);
  const remainderGuest = remainder.filter(x=>x.isGuest);
  // convidado nunca é convertido em goleiro (sempre joga de linha ou fica de reserva)
  const convertidos = remainderNaoGuest.slice(0, conversoesNecessarias);
  const linhaReserva = [...remainderNaoGuest.slice(conversoesNecessarias), ...remainderGuest];

  const linhaBuckets = usarFase2
    ? snakeDraft(linhaEmCampo, n)
    : (()=>{ const b=Array.from({length:n},()=>[]); linhaEmCampo.forEach((jg,i)=>b[i%n].push(jg)); return b; })();

  const golCandidatos = [...golOrdenado, ...convertidos];
  const golBuckets = usarFase2
    ? snakeDraft(
        golCandidatos.sort((a,b)=>{
          const pa = golOrdenado.includes(a) ? mediaOuFallback(ranking,a.id,'goleiro',mediaGlobalDoPapel(ranking,'goleiro')) : mediaOuFallback(ranking,a.id,'linha',mediaGlobalDoPapel(ranking,'linha'));
          const pb = golOrdenado.includes(b) ? mediaOuFallback(ranking,b.id,'goleiro',mediaGlobalDoPapel(ranking,'goleiro')) : mediaOuFallback(ranking,b.id,'linha',mediaGlobalDoPapel(ranking,'linha'));
          return pb-pa;
        }), n)
    : (()=>{ const b=Array.from({length:n},()=>[]); shuffle(golCandidatos).forEach((jg,i)=>b[i%n].push(jg)); return b; })();

  const insertTime = db.prepare('INSERT INTO times_sorteados (id,rodada_id,nome_time,jogador_id,papel_na_partida) VALUES (?,?,?,?,?)');
  const insertReserva = db.prepare('INSERT INTO reservas (id,rodada_id,jogador_id) VALUES (?,?,?)');
  const tx = db.transaction(()=>{
    for(let i=0;i<n;i++){
      linhaBuckets[i].forEach(jg=> insertTime.run(idGen('t'), rodadaId, NOMES_TIMES[i], jg.id, 'linha'));
      golBuckets[i].forEach(jg=> insertTime.run(idGen('t'), rodadaId, NOMES_TIMES[i], jg.id, 'goleiro'));
    }
    [...linhaReserva, ...golReserva].forEach(jg=> insertReserva.run(idGen('rv'), rodadaId, jg.id));
    db.prepare('INSERT OR REPLACE INTO rodada_meta (rodada_id, modo_sorteio) VALUES (?,?)').run(rodadaId, usarFase2?'fase2':'fase1');
    db.prepare('UPDATE rodadas SET status=? WHERE id=?').run('sorteado', rodadaId);
  });
  tx();
  logEvento('Sorteio realizado para a rodada de '+rodada.data+' ('+(usarFase2?'ponderado por nota':'aleatório')+'), '+n+' time(s).');
  return {ok:true};
}

/* ============================================================
   SESSÕES
   ============================================================ */
function criarSessao(jogadorId, isAdmin){
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,jogador_id,is_admin,criado_em) VALUES (?,?,?,?)')
    .run(token, jogadorId||null, isAdmin?1:0, nowISO());
  return token;
}
function getSessao(token){
  if(!token) return null;
  return db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
}
function extrairToken(req){
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function requireAuth(req,res,next){
  const sessao = getSessao(extrairToken(req));
  if(!sessao || !sessao.jogador_id) return res.status(401).json({erro:'Sessão inválida. Faça login novamente.'});
  req.jogadorId = sessao.jogador_id;
  next();
}
function getJogadorAuth(jogadorId){
  const j = jogadorId ? db.prepare('SELECT admin,super_admin,admin_perms FROM jogadores WHERE id=? AND ativo=1').get(jogadorId) : null;
  const perms = (j && j.admin_perms) ? j.admin_perms.split(',').filter(Boolean) : [];
  return { admin: !!(j && j.admin), superAdmin: !!(j && j.super_admin), perms };
}
function jogadorEhAdmin(jogadorId){
  return getJogadorAuth(jogadorId).admin;
}
function requireAdmin(req,res,next){
  const sessao = getSessao(extrairToken(req));
  if(!sessao) return res.status(401).json({erro:'Sessão administrativa inválida.'});
  if(sessao.jogador_id){
    const a = getJogadorAuth(sessao.jogador_id);
    if(a.admin || sessao.is_admin){
      req.jogadorId = sessao.jogador_id;
      req.auth = a.admin ? a : { admin:true, superAdmin:true, perms:PERMS_ADMIN.slice() };
      return next();
    }
  }else if(sessao.is_admin){
    // token do PIN administrativo legado = acesso total (Super).
    req.auth = { admin:true, superAdmin:true, perms:PERMS_ADMIN.slice() };
    return next();
  }
  return res.status(401).json({erro:'Sessão administrativa inválida.'});
}
function requireSuper(req,res,next){
  requireAdmin(req,res,()=>{
    if(req.auth && req.auth.superAdmin) return next();
    return res.status(403).json({erro:'Ação restrita ao Super Admin.'});
  });
}
function requirePerm(perm){
  return (req,res,next)=>requireAdmin(req,res,()=>{
    if(req.auth && (req.auth.superAdmin || req.auth.perms.includes(perm))) return next();
    return res.status(403).json({erro:'Seu acesso não inclui essa área.'});
  });
}

/* ============================================================
   EXPRESS APP
   ============================================================ */
seedSeNecessario();
const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.set('trust proxy', 1);
app.disable('etag');
app.use('/api', (req,res,next)=>{ res.set('Cache-Control', 'no-store'); next(); });

const loginLimiter = rateLimit({
  windowMs: 5*60*1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: {erro:'Muitas tentativas. Aguarde alguns minutos e tente de novo.'}
});

app.get('/api/health', (req,res)=> res.json({ok:true}));
app.get('/api/version', (req,res)=> res.json({version: APP_VERSION}));

/* ---- autenticação ---- */
app.post('/api/login', loginLimiter, (req,res)=>{
  const pin = String(req.body.pin||'');
  const jogador = db.prepare('SELECT * FROM jogadores WHERE pin=? AND ativo=1').get(pin);
  if(!jogador) return res.status(401).json({erro:'PIN não encontrado.'});
  const token = criarSessao(jogador.id, false);
  res.json({token, jogador:jogadorPublico(jogador)});
});

function jogadorPublico(j){
  return {
    id:j.id, nome:j.nome, posicaoPadrao:j.posicao_padrao,
    admin:!!j.admin, superAdmin:!!j.super_admin,
    perms: (j.admin_perms||'').split(',').filter(Boolean),
    mensalidade: j.mensalidade || '',
  };
}

app.get('/api/me', requireAuth, (req,res)=>{
  const j = getJogadorPorId(req.jogadorId);
  if(!j) return res.status(401).json({erro:'Sessão inválida.'});
  res.json(jogadorPublico(j));
});

app.post('/api/admin/login', loginLimiter, (req,res)=>{
  const pin = String(req.body.pin||'');
  const cfg = getConfig();
  if(pin !== cfg.admin_pin) return res.status(401).json({erro:'PIN administrativo incorreto.'});
  const token = criarSessao(null, true);
  res.json({adminToken: token});
});

// entra no painel admin sem PIN: só funciona para um jogador marcado como admin.
app.post('/api/admin/enter', requireAuth, (req,res)=>{
  if(!jogadorEhAdmin(req.jogadorId)) return res.status(403).json({erro:'Seu acesso não tem permissão administrativa.'});
  const token = criarSessao(req.jogadorId, true);
  res.json({adminToken: token});
});

app.post('/api/logout', requireAuth, (req,res)=>{
  db.prepare('DELETE FROM sessions WHERE token=?').run(extrairToken(req));
  res.json({ok:true});
});
app.post('/api/admin/logout', requireAdmin, (req,res)=>{
  db.prepare('DELETE FROM sessions WHERE token=?').run(extrairToken(req));
  res.json({ok:true});
});

app.post('/api/trocar-pin', requireAuth, (req,res)=>{
  const novo = String(req.body.novoPin||'');
  if(!/^\d{4}$/.test(novo)) return res.status(400).json({erro:'O PIN precisa ter 4 dígitos.'});
  const emUso = db.prepare('SELECT 1 FROM jogadores WHERE pin=? AND id<>? AND ativo=1').get(novo, req.jogadorId);
  if(emUso) return res.status(409).json({erro:'Esse PIN já está em uso por outro jogador.'});
  db.prepare('UPDATE jogadores SET pin=? WHERE id=?').run(novo, req.jogadorId);
  const jogador = getJogadorPorId(req.jogadorId);
  logEvento('Jogador "'+jogador.nome+'" trocou o próprio PIN.');
  res.json({ok:true});
});

/* ---- elenco ---- */
app.get('/api/elenco', (req,res)=>{
  const jogadores = getJogadores().map(j=>({id:j.id, nome:j.nome, posicaoPadrao:j.posicao_padrao, ativo:!!j.ativo}));
  res.json({jogadores});
});
app.get('/api/admin/elenco', requireSuper, (req,res)=>{
  const jogadores = getJogadores().map(j=>({
    id:j.id, nome:j.nome, pin:j.pin, posicaoPadrao:j.posicao_padrao, ativo:!!j.ativo,
    admin:!!j.admin, superAdmin:!!j.super_admin,
    adminPerms:(j.admin_perms||'').split(',').filter(Boolean),
    mensalidade:j.mensalidade||'',
  }));
  const cfg = getConfig();
  res.json({jogadores, permsDisponiveis:PERMS_ADMIN, config:{minRodadas:cfg.min_rodadas, minVotos:cfg.min_votos, simuladoNow:cfg.simulado_now}});
});
// lista enxuta p/ sub-admin com permissão de mensalidades (sem PIN, sem dados de admin)
app.get('/api/admin/mensalidades', requirePerm('mensalidades'), (req,res)=>{
  const jogadores = getJogadores().filter(j=>j.ativo).map(j=>({id:j.id, nome:j.nome, mensalidade:j.mensalidade||''}));
  res.json({jogadores});
});
app.put('/api/admin/jogadores/:id/mensalidade', requirePerm('mensalidades'), (req,res)=>{
  const j = getJogadorPorId(req.params.id);
  if(!j) return res.status(404).json({erro:'Jogador não encontrado.'});
  const val = String(req.body.mensalidade||'');
  if(!MENSALIDADE_VALORES.includes(val)) return res.status(400).json({erro:'Valor de mensalidade inválido.'});
  db.prepare('UPDATE jogadores SET mensalidade=? WHERE id=?').run(val, j.id);
  res.json({ok:true});
});
app.post('/api/admin/jogadores', requireSuper, (req,res)=>{
  const {nome, pin, posicaoPadrao} = req.body;
  if(!nome || !/^\d{4}$/.test(String(pin||'')) || !['linha','goleiro'].includes(posicaoPadrao)){
    return res.status(400).json({erro:'Informe nome, PIN de 4 dígitos e posição válida.'});
  }
  const id = idGen('p');
  db.prepare('INSERT INTO jogadores (id,nome,pin,posicao_padrao,ativo) VALUES (?,?,?,?,1)').run(id, nome, String(pin), posicaoPadrao);
  logEvento('Jogador "'+nome+'" adicionado ao elenco.');
  res.json({ok:true, id});
});
app.put('/api/admin/jogadores/:id', requireSuper, (req,res)=>{
  const j = getJogadorPorId(req.params.id);
  if(!j) return res.status(404).json({erro:'Jogador não encontrado.'});
  const nome = req.body.nome!=null ? String(req.body.nome) : j.nome;
  const pin = req.body.pin!=null && /^\d{4}$/.test(String(req.body.pin)) ? String(req.body.pin) : j.pin;
  const posicaoPadrao = ['linha','goleiro'].includes(req.body.posicaoPadrao) ? req.body.posicaoPadrao : j.posicao_padrao;
  const ativo = req.body.ativo!=null ? (req.body.ativo?1:0) : j.ativo;
  // o Super Admin nunca perde o acesso admin
  let admin = req.body.admin!=null ? (req.body.admin?1:0) : (j.admin||0);
  if(j.super_admin) admin = 1;
  // permissões concedidas (só valem se admin e não super)
  let permsArr;
  if(req.body.adminPerms!=null){
    const raw = Array.isArray(req.body.adminPerms) ? req.body.adminPerms : String(req.body.adminPerms).split(',');
    permsArr = raw.map(p=>String(p).trim()).filter(p=>PERMS_ADMIN.includes(p));
  }else{
    permsArr = (j.admin_perms||'').split(',').filter(Boolean);
  }
  const adminPerms = admin ? permsArr.join(',') : '';
  // mensalidade
  let mensalidade = j.mensalidade || '';
  if(req.body.mensalidade!=null && MENSALIDADE_VALORES.includes(String(req.body.mensalidade))){
    mensalidade = String(req.body.mensalidade);
  }
  db.prepare('UPDATE jogadores SET nome=?,pin=?,posicao_padrao=?,ativo=?,admin=?,admin_perms=?,mensalidade=? WHERE id=?')
    .run(nome,pin,posicaoPadrao,ativo,admin,adminPerms,mensalidade,j.id);
  res.json({ok:true});
});
app.delete('/api/admin/jogadores/:id', requireSuper, (req,res)=>{
  db.prepare('DELETE FROM jogadores WHERE id=?').run(req.params.id);
  res.json({ok:true});
});
app.put('/api/admin/config', requireSuper, (req,res)=>{
  const minRodadas = Math.max(1, parseInt(req.body.minRodadas,10)||4);
  const minVotos = Math.max(1, parseInt(req.body.minVotos,10)||3);
  db.prepare('UPDATE config SET min_rodadas=?, min_votos=? WHERE id=1').run(minRodadas, minVotos);
  logEvento('Critérios da fase 2 atualizados: '+minRodadas+' rodadas / '+minVotos+' votos.');
  res.json({ok:true});
});
app.put('/api/admin/admin-pin', requireSuper, (req,res)=>{
  const pin = String(req.body.pin||'');
  if(!/^\d{4}$/.test(pin)) return res.status(400).json({erro:'O PIN deve ter 4 dígitos.'});
  db.prepare('UPDATE config SET admin_pin=? WHERE id=1').run(pin);
  res.json({ok:true});
});
app.put('/api/admin/simulado', requireSuper, (req,res)=>{
  const val = req.body.simuladoNow || null;
  db.prepare('UPDATE config SET simulado_now=? WHERE id=1').run(val);
  res.json({ok:true});
});

/* ---- rodadas ---- */
function serializarRodada(rodada){
  rodada = atualizarStatusSeNecessario(rodada);
  const fase = computeFase(rodada);
  const confirmados = getPorStatus(rodada.id, 'presente').map(j=>j.id);
  const ausentes = getPorStatus(rodada.id, 'ausente').map(j=>j.id);
  const convidados = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND status='presente' AND trouxe_convidado=1").all(rodada.id).map(r=>r.jogador_id);
  const resenha = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND resenha=1").all(rodada.id).map(r=>r.jogador_id);
  const _jr = janelas(rodada.data), _nr = nowSP();
  const resenhaEdicaoConfirmacao = _nr >= _jr.confirmOpen && _nr < _jr.confirmClose;
  const resenhaEdicaoLivre = _nr >= _jr.resenhaLivreOpen && _nr < _jr.resenhaLivreClose;
  let times = null;
  if(rodada.status==='sorteado'){
    const linhas = db.prepare('SELECT nome_time, jogador_id, papel_na_partida FROM times_sorteados WHERE rodada_id=?').all(rodada.id);
    const meta = db.prepare('SELECT modo_sorteio FROM rodada_meta WHERE rodada_id=?').get(rodada.id);
    const porTime = {};
    NOMES_TIMES.forEach(n=>{});
    linhas.forEach(l=>{
      porTime[l.nome_time] = porTime[l.nome_time] || [];
      porTime[l.nome_time].push({jogadorId:l.jogador_id, papel:l.papel_na_partida});
    });
    const reservas = db.prepare('SELECT jogador_id FROM reservas WHERE rodada_id=?').all(rodada.id).map(r=>r.jogador_id);
    times = {
      times: Object.keys(porTime).map(nome=>({nome, jogadores:porTime[nome]})),
      reservas,
      modo: meta ? meta.modo_sorteio : 'fase1'
    };
  }
  const votos = db.prepare('SELECT jogador_avaliado_id as avaliadoId, jogador_avaliador_id as avaliadorId, nota FROM votos WHERE rodada_id=?').all(rodada.id);
  return {id:rodada.id, data:rodada.data, status:rodada.status, fase, confirmados, ausentes, convidados, resenha, resenhaEdicaoConfirmacao, resenhaEdicaoLivre, times, votos};
}

app.get('/api/rodadas', (req,res)=>{
  res.json({rodadas: getRodadas().map(r=>({id:r.id, data:r.data, status:r.status}))});
});
app.get('/api/rodadas/atual', (req,res)=>{
  const rodada = getRodadaAtual();
  if(!rodada) return res.json({rodada:null});
  res.json({rodada: serializarRodada(rodada)});
});
app.get('/api/rodadas/:id', (req,res)=>{
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  res.json({rodada: serializarRodada(rodada)});
});

app.post('/api/admin/rodadas', requireSuper, (req,res)=>{
  const data = String(req.body.data||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({erro:'Data inválida.'});
  const id = idGen('r');
  db.prepare('INSERT INTO rodadas (id,data,status) VALUES (?,?,?)').run(id, data, 'aguardando_confirmacao');
  logEvento('Nova rodada criada para '+data+'.');
  res.json({ok:true, id});
});

// Remove UMA rodada e tudo ligado a ela. Diferente do /reset, aqui o admin
// pode remover inclusive rodada já encerrada/histórico — mas só com
// confirmarHistorico=true no corpo (trava contra clique acidental).
app.delete('/api/admin/rodadas/:id', requireSuper, (req,res)=>{
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const fase = computeFase(rodada);
  const ehHistorico = fase.chave === 'encerrada' || rodada.status === 'nao_viabilizado';
  if(ehHistorico && !req.body.confirmarHistorico){
    return res.status(409).json({erro:'Essa rodada já é histórico. Reenvie com confirmação explícita para remover.'});
  }
  const tx = db.transaction(()=>{
    db.prepare('DELETE FROM votos WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM times_sorteados WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM reservas WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM rodada_meta WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM confirmacoes WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM rodadas WHERE id=?').run(rodada.id);
  });
  tx();
  logEvento('Rodada de '+rodada.data+' ('+fase.chave+') removida pelo administrador'+(ehHistorico ? ' — HISTÓRICO apagado com confirmação explícita.' : '.'));
  res.json({ok:true});
});

app.post('/api/rodadas/:id/presenca', requireAuth, (req,res)=>{
  const status = String(req.body.status||'');
  if(!['presente','ausente'].includes(status)) return res.status(400).json({erro:"Status inválido (use 'presente' ou 'ausente')."});
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const j = janelas(rodada.data);
  const n = nowSP();
  if(n < j.confirmOpen || n >= j.confirmClose) return res.status(403).json({erro:'A janela de confirmação está fechada.'});
  const existente = db.prepare('SELECT * FROM confirmacoes WHERE rodada_id=? AND jogador_id=?').get(rodada.id, req.jogadorId);
  const convidadoFlag = status==='ausente' ? 0 : (existente ? existente.trouxe_convidado : 0);
  const resenhaFlag = status==='ausente' ? 0 : (existente ? existente.resenha : 0);
  if(existente){
    db.prepare('UPDATE confirmacoes SET status=?, confirmado_em=?, trouxe_convidado=?, resenha=? WHERE id=?').run(status, nowISO(), convidadoFlag, resenhaFlag, existente.id);
  }else{
    db.prepare('INSERT INTO confirmacoes (id,rodada_id,jogador_id,confirmado_em,status,trouxe_convidado,resenha) VALUES (?,?,?,?,?,?,?)')
      .run(idGen('c'), rodada.id, req.jogadorId, nowISO(), status, convidadoFlag, resenhaFlag);
  }
  res.json({ok:true});
});

app.post('/api/rodadas/:id/convidado', requireAuth, (req,res)=>{
  const trouxeConvidado = !!req.body.trouxeConvidado;
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const j = janelas(rodada.data);
  const n = nowSP();
  if(n < j.confirmOpen || n >= j.confirmClose) return res.status(403).json({erro:'A janela de confirmação está fechada.'});
  const existente = db.prepare('SELECT * FROM confirmacoes WHERE rodada_id=? AND jogador_id=?').get(rodada.id, req.jogadorId);
  if(!existente || existente.status!=='presente') return res.status(400).json({erro:'Marque presença antes de indicar se vai levar convidado.'});
  db.prepare('UPDATE confirmacoes SET trouxe_convidado=? WHERE id=?').run(trouxeConvidado?1:0, existente.id);
  res.json({ok:true});
});

app.post('/api/rodadas/:id/resenha', requireAuth, (req,res)=>{
  const vaiResenha = !!req.body.resenha;
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const j = janelas(rodada.data);
  const n = nowSP();
  const existente = db.prepare('SELECT * FROM confirmacoes WHERE rodada_id=? AND jogador_id=?').get(rodada.id, req.jogadorId);
  const emJanelaConfirmacao = n >= j.confirmOpen && n < j.confirmClose;
  const emJanelaLivre = n >= j.resenhaLivreOpen && n < j.resenhaLivreClose;

  // Janela normal (sáb 8h → dom 8h): só quem marcou presença, ajusta pela tela Início.
  if(emJanelaConfirmacao){
    if(!existente || existente.status!=='presente') return res.status(400).json({erro:'Marque presença antes de entrar na resenha.'});
    db.prepare('UPDATE confirmacoes SET resenha=? WHERE id=?').run(vaiResenha?1:0, existente.id);
    return res.json({ok:true});
  }

  // Janela de última hora (dom 10h → 11h): editável pela tela Resenha.
  if(emJanelaLivre){
    if(existente && existente.status==='presente'){
      // quem confirmou presença pode sair (ou voltar) da resenha
      db.prepare('UPDATE confirmacoes SET resenha=? WHERE id=?').run(vaiResenha?1:0, existente.id);
      return res.json({ok:true});
    }
    // quem NÃO confirmou presença só entra na resenha se o racha aconteceu
    if(rodada.status !== 'sorteado') return res.status(400).json({erro:'A resenha só aceita entradas de última hora se o racha foi sorteado.'});
    if(existente){
      db.prepare('UPDATE confirmacoes SET resenha=? WHERE id=?').run(vaiResenha?1:0, existente.id);
    }else{
      db.prepare('INSERT INTO confirmacoes (id,rodada_id,jogador_id,confirmado_em,status,trouxe_convidado,resenha) VALUES (?,?,?,?,?,?,?)')
        .run(idGen('c'), rodada.id, req.jogadorId, nowISO(), 'ausente', 0, vaiResenha?1:0);
    }
    return res.json({ok:true});
  }

  return res.status(403).json({erro:'Fora da janela de ajuste da resenha (domingo, das 10h às 11h).'});
});

app.post('/api/admin/rodadas/:id/sortear', requireSuper, (req,res)=>{
  const resultado = realizarSorteio(req.params.id);
  if(!resultado.ok) return res.status(400).json({erro: resultado.erro});
  res.json({ok:true});
});

function participouDaRodada(rodadaId, jogadorId){
  const emTime = db.prepare('SELECT 1 FROM times_sorteados WHERE rodada_id=? AND jogador_id=?').get(rodadaId, jogadorId);
  if(emTime) return true;
  const emReserva = db.prepare('SELECT 1 FROM reservas WHERE rodada_id=? AND jogador_id=?').get(rodadaId, jogadorId);
  return !!emReserva;
}

app.post('/api/rodadas/:id/votos', requireAuth, (req,res)=>{
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada || rodada.status!=='sorteado') return res.status(400).json({erro:'Esta rodada não está com times sorteados.'});
  const j = janelas(rodada.data);
  const n = nowSP();
  if(n < j.voteOpen || n >= j.voteClose) return res.status(403).json({erro:'A janela de votação está fechada.'});
  const avaliadoId = String(req.body.avaliadoId||'');
  const nota = parseInt(req.body.nota,10);
  if(Number.isNaN(nota) || nota<1 || nota>5) return res.status(400).json({erro:'Nota inválida (use de 1 a 5 estrelas).'});
  if(avaliadoId === req.jogadorId) return res.status(400).json({erro:'Não é permitido avaliar a si mesmo.'});
  if(avaliadoId.startsWith('conv:')) return res.status(400).json({erro:'Convidados não podem ser avaliados.'});
  if(!participouDaRodada(rodada.id, req.jogadorId)) return res.status(403).json({erro:'Você só pode votar se esteve presente nesta rodada (escalado ou reserva).'});
  if(!participouDaRodada(rodada.id, avaliadoId)) return res.status(400).json({erro:'Esse jogador não fez parte desta rodada.'});
  const existente = db.prepare('SELECT * FROM votos WHERE rodada_id=? AND jogador_avaliado_id=? AND jogador_avaliador_id=?')
    .get(rodada.id, avaliadoId, req.jogadorId);
  if(existente) return res.status(409).json({erro:'Voto já registrado — não é possível alterar depois de salvo.'});
  db.prepare('INSERT INTO votos (id,rodada_id,jogador_avaliado_id,jogador_avaliador_id,nota,criado_em) VALUES (?,?,?,?,?,?)')
    .run(idGen('v'), rodada.id, avaliadoId, req.jogadorId, nota, nowISO());
  res.json({ok:true});
});

app.get('/api/ranking', (req,res)=>{
  res.json({ranking: calcularRanking()});
});

app.get('/api/admin/eventos', requireSuper, (req,res)=>{
  const eventos = db.prepare('SELECT ts, mensagem FROM eventos_log ORDER BY ts DESC LIMIT 50').all();
  res.json({eventos});
});

app.post('/api/admin/reset', requireSuper, (req,res)=>{
  // Segurança: só apaga rodadas que AINDA NÃO terminaram (aguardando confirmação, ou
  // sorteadas mas dentro da janela de votação). Rodadas 'encerradas' ou 'não viabilizadas'
  // são histórico real e nunca são tocadas por este botão.
  const todasRodadas = db.prepare('SELECT * FROM rodadas').all();
  const idsParaApagar = todasRodadas
    .filter(r => computeFase(r).chave !== 'encerrada' && r.status !== 'nao_viabilizado')
    .map(r => r.id);
  const tx = db.transaction(()=>{
    idsParaApagar.forEach(id=>{
      db.prepare('DELETE FROM votos WHERE rodada_id=?').run(id);
      db.prepare('DELETE FROM times_sorteados WHERE rodada_id=?').run(id);
      db.prepare('DELETE FROM reservas WHERE rodada_id=?').run(id);
      db.prepare('DELETE FROM rodada_meta WHERE rodada_id=?').run(id);
      db.prepare('DELETE FROM confirmacoes WHERE rodada_id=?').run(id);
      db.prepare('DELETE FROM rodadas WHERE id=?').run(id);
    });
    const restantes = db.prepare('SELECT * FROM rodadas').all();
    const temPendente = restantes.some(r => computeFase(r).chave !== 'encerrada' && r.status !== 'nao_viabilizado');
    const data = nextSundayFrom(todaySPDateStr());
    const dataJaExiste = restantes.some(r => r.data === data);
    if(!temPendente && !dataJaExiste){
      db.prepare('INSERT INTO rodadas (id,data,status) VALUES (?,?,?)').run(idGen('r'), data, 'aguardando_confirmacao');
    }
  });
  tx();
  logEvento('Rodadas de teste (ainda não encerradas) zeradas pelo administrador. Histórico de rodadas encerradas preservado.');
  res.json({ok:true});
});

/* ---- extras da tela inicial: eventos, notícia, aluguel da quadra ---- */
app.get('/api/home-extras', (req,res)=>{
  const eventos = db.prepare('SELECT id,nome,data FROM eventos WHERE ativo=1 ORDER BY data ASC').all();
  const noticiaRow = db.prepare('SELECT descricao,ativo FROM noticia WHERE id=1').get();
  const aluguelRow = db.prepare('SELECT nome,chave_pix,valor_mensalidade,ativo FROM aluguel_quadra WHERE id=1').get();
  const gestaoRow = db.prepare('SELECT presidente,vice_presidente,ativo FROM gestao WHERE id=1').get();
  res.json({
    eventos,
    noticia: (noticiaRow && noticiaRow.ativo) ? {descricao: noticiaRow.descricao} : null,
    aluguel: (aluguelRow && aluguelRow.ativo) ? {nome:aluguelRow.nome, chavePix:aluguelRow.chave_pix, valorMensalidade:aluguelRow.valor_mensalidade} : null,
    gestao: (gestaoRow && gestaoRow.ativo) ? {presidente:gestaoRow.presidente, vicePresidente:gestaoRow.vice_presidente} : null,
  });
});

app.get('/api/admin/agenda', requirePerm('conteudo'), (req,res)=>{
  res.json({eventos: db.prepare('SELECT * FROM eventos ORDER BY data ASC').all().map(e=>({id:e.id,nome:e.nome,data:e.data,ativo:!!e.ativo}))});
});
app.post('/api/admin/agenda', requirePerm('conteudo'), (req,res)=>{
  const nome = String(req.body.nome||'').trim();
  const data = String(req.body.data||'').trim();
  if(!nome || !data) return res.status(400).json({erro:'Informe nome e data do evento.'});
  const id = idGen('ev');
  db.prepare('INSERT INTO eventos (id,nome,data,ativo) VALUES (?,?,?,1)').run(id, nome, data);
  res.json({ok:true, id});
});
app.put('/api/admin/agenda/:id', requirePerm('conteudo'), (req,res)=>{
  const ev = db.prepare('SELECT * FROM eventos WHERE id=?').get(req.params.id);
  if(!ev) return res.status(404).json({erro:'Evento não encontrado.'});
  const nome = req.body.nome!=null ? String(req.body.nome) : ev.nome;
  const data = req.body.data!=null ? String(req.body.data) : ev.data;
  const ativo = req.body.ativo!=null ? (req.body.ativo?1:0) : ev.ativo;
  db.prepare('UPDATE eventos SET nome=?,data=?,ativo=? WHERE id=?').run(nome,data,ativo,ev.id);
  res.json({ok:true});
});
app.delete('/api/admin/agenda/:id', requirePerm('conteudo'), (req,res)=>{
  db.prepare('DELETE FROM eventos WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.get('/api/admin/noticia', requirePerm('conteudo'), (req,res)=>{
  const n = db.prepare('SELECT descricao,ativo FROM noticia WHERE id=1').get();
  res.json({descricao:n.descricao, ativo:!!n.ativo});
});
app.put('/api/admin/noticia', requirePerm('conteudo'), (req,res)=>{
  const descricao = String(req.body.descricao||'');
  const ativo = req.body.ativo?1:0;
  db.prepare('UPDATE noticia SET descricao=?,ativo=? WHERE id=1').run(descricao, ativo);
  res.json({ok:true});
});

app.get('/api/admin/aluguel', requirePerm('conteudo'), (req,res)=>{
  const a = db.prepare('SELECT nome,chave_pix,valor_mensalidade,ativo FROM aluguel_quadra WHERE id=1').get();
  res.json({nome:a.nome, chavePix:a.chave_pix, valorMensalidade:a.valor_mensalidade, ativo:!!a.ativo});
});
app.put('/api/admin/aluguel', requirePerm('conteudo'), (req,res)=>{
  const nome = String(req.body.nome||'');
  const chavePix = String(req.body.chavePix||'');
  const valorMensalidade = String(req.body.valorMensalidade||'');
  const ativo = req.body.ativo?1:0;
  db.prepare('UPDATE aluguel_quadra SET nome=?,chave_pix=?,valor_mensalidade=?,ativo=? WHERE id=1').run(nome,chavePix,valorMensalidade,ativo);
  res.json({ok:true});
});

app.get('/api/admin/gestao', requirePerm('conteudo'), (req,res)=>{
  const g = db.prepare('SELECT presidente,vice_presidente,ativo FROM gestao WHERE id=1').get();
  res.json({presidente:g.presidente, vicePresidente:g.vice_presidente, ativo:!!g.ativo});
});
app.put('/api/admin/gestao', requirePerm('conteudo'), (req,res)=>{
  const presidente = String(req.body.presidente||'');
  const vicePresidente = String(req.body.vicePresidente||'');
  const ativo = req.body.ativo?1:0;
  db.prepare('UPDATE gestao SET presidente=?,vice_presidente=?,ativo=? WHERE id=1').run(presidente,vicePresidente,ativo);
  res.json({ok:true});
});

/* ---- arquivos estáticos (frontend) ---- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({erro:'Rota não encontrada.'});
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---- sorteio automático (todo domingo às 8h05) ---- */
function checarSorteioAutomatico(){
  try{
    const pendentes = db.prepare("SELECT * FROM rodadas WHERE status='aguardando_confirmacao'").all();
    pendentes.forEach(r=>{
      const gatilho = r.data+'T08:05:00';
      if(nowSP() < gatilho) return;
      const atualizada = atualizarStatusSeNecessario(r);
      if(atualizada.status==='aguardando_confirmacao'){
        const resultado = realizarSorteio(atualizada.id);
        if(resultado.ok) logEvento('Sorteio automático disparado às 8h05 para a rodada de '+atualizada.data+'.');
      }
    });
  }catch(e){ console.error('Erro no sorteio automático:', e); }
}
setInterval(checarSorteioAutomatico, 60*1000);
checarSorteioAutomatico();

app.listen(PORT, ()=>{
  console.log('Bolerage F.D. rodando na porta ' + PORT);
});
