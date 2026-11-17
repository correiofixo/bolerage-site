/* ============================================================
   Bolerage F.D. — Site de sorteio e avaliação da pelada
   Backend Node.js + Express + SQLite (better-sqlite3)
   ============================================================ */
'use strict';

// Contador de release: soma 1 a cada deploy. A virada de "major" é automática —
// no máximo 9 releases por major (0 a 9), minor com um dígito só: 2.0 -> 2.1 ... 2.9 -> 3.0 -> 3.1 ...
// (reiniciado nesta versão: build 0 = 2.0, ciclo de 10 a partir daqui.)
const APP_BUILD = 20;
function computeVersion(b){
  const minor = b % 10;
  const major = 2 + Math.floor(b / 10);
  return major + '.' + minor;
}
const APP_VERSION = computeVersion(APP_BUILD); // ex.: 0 -> "2.0", 9 -> "2.9", 10 -> "3.0"

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
try{ db.exec("ALTER TABLE jogadores ADD COLUMN telefone TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN descricao TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN responsavel TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE votos ADD COLUMN edicoes INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN corneta INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN time_coracao TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN depto_medico INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE confirmacoes ADD COLUMN vinho INTEGER NOT NULL DEFAULT 0"); }catch(e){}
// sorteio dos times: 'manual' (admin clica em "Realizar sorteio") ou 'automatico'
// (roda sozinho na data/hora em sorteio_agendado, "YYYY-MM-DDTHH:MM", horário de SP).
try{ db.exec("ALTER TABLE config ADD COLUMN sorteio_modo TEXT NOT NULL DEFAULT 'manual'"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN sorteio_agendado TEXT"); }catch(e){}
// 1 = a aba "Votos dos Jogadores" (Resenha) mostra quem votou em quem; 0 = oculta.
try{ db.exec("ALTER TABLE config ADD COLUMN mostrar_votos INTEGER NOT NULL DEFAULT 0"); }catch(e){}
// admin marca jogador presente como RESERVA antes do sorteio manual (1 = reserva).
try{ db.exec("ALTER TABLE confirmacoes ADD COLUMN reserva INTEGER NOT NULL DEFAULT 0"); }catch(e){}
// perfil do jogador (todos opcionais)
try{ db.exec("ALTER TABLE jogadores ADD COLUMN apelido TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN idade INTEGER"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN peso REAL"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN altura INTEGER"); }catch(e){}
// 1 = o jogador quer que o APELIDO seja exibido no lugar do nome em todo o app
try{ db.exec("ALTER TABLE jogadores ADD COLUMN usar_apelido INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE jogadores ADD COLUMN email TEXT NOT NULL DEFAULT ''"); }catch(e){}
// mês (YYYY-MM) em que a mensalidade foi zerada pela última vez
try{ db.exec("ALTER TABLE config ADD COLUMN mensalidade_ref TEXT"); }catch(e){}
// custos da quadra (fluxo de caixa)
try{ db.exec("ALTER TABLE config ADD COLUMN custo_aluguel REAL NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN custo_higienizacao REAL NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN custo_carvao REAL NOT NULL DEFAULT 0"); }catch(e){}
// saldo em caixa = saldo atual da conta corrente do time (entra no fluxo de caixa)
try{ db.exec("ALTER TABLE config ADD COLUMN saldo_caixa REAL NOT NULL DEFAULT 0"); }catch(e){}
// valor de mensalidade INDIVIDUAL do jogador (NULL = usa o valor do card Aluguel da quadra)
try{ db.exec("ALTER TABLE jogadores ADD COLUMN valor_mensalidade REAL"); }catch(e){}
// data (YYYY-MM-DD) em que o jogador passou a estar EM ATRASO (para contar os dias)
try{ db.exec("ALTER TABLE jogadores ADD COLUMN atraso_desde TEXT"); }catch(e){}

// permissões concedíveis a um sub-admin (o Super Admin tem tudo, sempre).
const PERMS_ADMIN = ['conteudo','mensalidades'];
const MENSALIDADE_VALORES = ['', 'em_dia', 'em_atraso', 'isenta'];
const TIMES_CORACAO = ['', 'saopaulo', 'santos', 'corinthians', 'palmeiras'];

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
    voteClose:    rodadaData+'T13:00:00',
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
  if(rodada.status==='sorteio_desfeito') return {chave:'sorteio_desfeito', label:'Sorteio desfeito — aguardando novo sorteio manual', cor:'gold'};
  if(rodada.status==='sorteado'){
    if(now < j.voteOpen) return {chave:'sorteado_aguardando_votacao', label:'Times sorteados — votação abre domingo às 10h', cor:'gold'};
    if(now < j.voteClose) return {chave:'votacao_aberta', label:'Votação aberta até as 13h', cor:'green'};
    return {chave:'encerrada', label:'Rodada encerrada', cor:'muted'};
  }
  if(now < j.confirmOpen) return {chave:'pre_confirmacao', label:'Confirmação abre sábado às 8hrs', cor:'muted'};
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
  const linha = confirmados.filter(j=>j.posicao_padrao==='linha' && !j.corneta).length + contarConvidados(rodadaId);
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
           CASE WHEN t.papel_na_partida IS NULL OR t.papel_na_partida='alternar' THEN j.posicao_padrao ELSE t.papel_na_partida END as papel,
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

// Ranking Bola Cheia / Bola Murcha: pra cada rodada já sorteada, quem teve a MELHOR e a
// PIOR média de votos naquele domingo ganha um ponto no respectivo ranking — a mesma
// lógica de "Craque Bola Cheia x Craque Bola Murcha" da aba Resenha, só que somada
// rodada a rodada (histórico completo, não é a média geral do jogador).
function calcularRankingBola(){
  const rodadas = db.prepare("SELECT id FROM rodadas WHERE status='sorteado'").all();
  const cheia = {}, murcha = {};
  rodadas.forEach(r=>{
    const votos = db.prepare("SELECT jogador_avaliado_id as id, nota FROM votos WHERE rodada_id=?").all(r.id)
      .filter(v=>v.id && v.id.indexOf('conv:')!==0);
    if(!votos.length) return;
    const agg = {};
    votos.forEach(v=>{
      const a = agg[v.id] || (agg[v.id] = {soma:0, n:0});
      a.soma += v.nota; a.n += 1;
    });
    const entries = Object.keys(agg).map(id=>({id, media:agg[id].soma/agg[id].n, n:agg[id].n}))
      .sort((a,b)=> (b.media-a.media) || (b.n-a.n));
    cheia[entries[0].id] = (cheia[entries[0].id]||0) + 1;
    if(entries.length >= 2){
      const pior = entries[entries.length-1];
      murcha[pior.id] = (murcha[pior.id]||0) + 1;
    }
  });
  return {cheia, murcha};
}

function mediaGlobalDoPapel(ranking, papel){
  const vals = Object.values(ranking).map(r=>r[papel] && r[papel].media).filter(v=>v!=null);
  if(!vals.length) return 2.5;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}
// média do jogador já com o desconto de 10% por rodada ausente (média × 0,9^ausências)
function mediaOuFallback(ranking, jogadorId, papel, mediaGlobal, ausencias){
  const r = ranking[jogadorId];
  if(r && r[papel] && r[papel].media!=null) return r[papel].media * Math.pow(0.9, (ausencias && ausencias[jogadorId]) || 0);
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
// quando sobram exatamente 3 reservas, viram um time extra em vez de ficarem parados —
// entram na lista já marcados como "Alternar Jogador" (revezam com os times completos).
const NOME_TIME_ALTERNANTES = 'Alternantes';
const PAPEL_ALTERNAR = 'alternar';

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

// Ordena os 5 nomes de time por quão recentemente cada um foi sorteado (o
// "Alternantes" não conta) — quem nunca jogou, ou jogou há mais rodadas, vem
// primeiro. Assim, times que saíram nas últimas semanas (ex.: Brasil e
// Argentina) só voltam a ser usados se não sobrar mais nenhum nome "descansado".
function nomesTimesPriorizados(){
  const rows = db.prepare(`
    SELECT r.data as data, t.nome_time as nomeTime
    FROM times_sorteados t
    JOIN rodadas r ON r.id = t.rodada_id
    WHERE t.nome_time <> ?
    ORDER BY r.data DESC
  `).all(NOME_TIME_ALTERNANTES);
  const recenciaPorNome = {}; // nome -> 0 (rodada mais recente encontrada), 1, 2...
  let indiceRodada = -1;
  let dataAnterior = null;
  rows.forEach(r=>{
    if(r.data !== dataAnterior){ indiceRodada++; dataAnterior = r.data; }
    if(!(r.nomeTime in recenciaPorNome)) recenciaPorNome[r.nomeTime] = indiceRodada;
  });
  // nunca usado = prioridade máxima (Infinity); entre os já usados, quanto maior
  // o índice (mais rodadas atrás), maior a prioridade.
  return [...NOMES_TIMES].sort((a,b)=>{
    const ra = recenciaPorNome[a] ?? Infinity;
    const rb = recenciaPorNome[b] ?? Infinity;
    return rb - ra;
  });
}

// Distribui `items` (já na ordem de prioridade) em baldes com capacidades `caps`.
// snake=true: "serpentina" (1..n, n..1, ...) pulando balde cheio; snake=false: rodízio simples.
function distribuirPorCapacidade(items, caps, snake){
  const n = caps.length;
  const buckets = Array.from({length:n},()=>[]);
  let idx = 0, round = 0;
  while(idx < items.length){
    const order = (snake && round%2===1)
      ? Array.from({length:n},(_,k)=>n-1-k)
      : Array.from({length:n},(_,k)=>k);
    let colocouAlgum = false;
    for(const pos of order){
      if(idx >= items.length) break;
      if(buckets[pos].length < caps[pos]){ buckets[pos].push(items[idx++]); colocouAlgum = true; }
    }
    if(!colocouAlgum) break; // todos cheios
    round++;
  }
  return {buckets, sobras: items.slice(idx)};
}

function realizarSorteio(rodadaId){
  const rodada = getRodadaPorId(rodadaId);
  if(!rodada) return {ok:false, erro:'Rodada não encontrada.'};
  const j = janelas(rodada.data);
  if(!['aguardando_confirmacao','sorteio_desfeito'].includes(rodada.status)) return {ok:false, erro:'Esta rodada já foi sorteada ou não está mais aguardando confirmação.'};
  if(nowSP() < j.confirmClose) return {ok:false, erro:'A janela de confirmação ainda está aberta.'};
  const v = calcViabilidade(rodadaId);
  if(!v.viavel) return {ok:false, erro:'Jogo não viabilizado: confirmações insuficientes.'};

  // Goleiros NÃO entram no sorteio: ficam fixos na tela como "Goleiros Presentes".
  // Cornetas também ficam de fora (só votam) — mas o convidado deles entra normalmente.
  const confirmados = getPorStatus(rodadaId, 'presente');
  const info = {};
  db.prepare("SELECT jogador_id, confirmado_em, trouxe_convidado, reserva FROM confirmacoes WHERE rodada_id=? AND status='presente'")
    .all(rodadaId).forEach(r=>{ info[r.jogador_id] = r; });
  const porCheckin = (a,b)=> String((info[a.hostId||a.id]||{}).confirmado_em||'').localeCompare(String((info[b.hostId||b.id]||{}).confirmado_em||''));
  const linhaReal = confirmados.filter(x=>x.posicao_padrao==='linha' && !x.corneta);
  // 1) cadastrados no app, na ordem de check-in (quem confirmou mais cedo tem prioridade)
  const prioritarios = linhaReal.filter(x=>!info[x.id].reserva).sort(porCheckin);
  // 2) prioridade baixa: reservas marcados pelo admin (sorteio manual) + convidados.
  //    Eles formam os últimos times; só jogam se sobrar vaga.
  const reservasMarcadas = linhaReal.filter(x=>info[x.id].reserva).sort(porCheckin);
  const guestPool = Object.values(info).filter(r=>r.trouxe_convidado===1)
    .map(r=>({id:'conv:'+r.jogador_id, posicao_padrao:'linha', isGuest:true, hostId:r.jogador_id}))
    .sort(porCheckin);
  const baixa = [...reservasMarcadas, ...guestPool];
  const baixaSet = new Set(baixa);

  // times de 5 jogadores de linha (máx. 5 times). Se sobrarem 3 ou 4, formam mais um
  // time menor (ex.: 18 → 5+5+5+3); sobrando 1 ou 2 (ou além de 5 times) viram reservas.
  const L = prioritarios.length + baixa.length;
  const cheios = Math.min(5, Math.floor(L/5));
  const sobraBruta = L - cheios*5;
  const caps = Array.from({length:cheios},()=>5);
  if(cheios < 5 && sobraBruta >= 3) caps.push(sobraBruta);
  if(caps.length < 2) return {ok:false, erro:'Jogadores insuficientes para formar dois times.'};

  const ranking = calcularRanking();
  const usarFase2 = fase2Atingida(ranking);
  const ausencias = calcularAusencias();

  // quem entra em campo: segue a ordem de prioridade (cadastrados por check-in, depois
  // reservas marcados e convidados). Quem passar do total de vagas vira reserva.
  const ordemGeral = [...prioritarios, ...baixa];
  const totalVagas = caps.reduce((a,b)=>a+b,0);
  const campo = ordemGeral.slice(0, totalVagas);
  const bancoReserva = ordemGeral.slice(totalVagas);
  const campoBaixa = campo.filter(x=>baixaSet.has(x));
  let campoPrior = campo.filter(x=>!baixaSet.has(x));

  // convidados/reservas marcados vão juntos para o(s) ÚLTIMO(S) time(s): com 18 de linha
  // (15 cadastrados + 3 convidados) sai um time só de convidados.
  const preenchido = caps.map(()=>[]);
  let iBaixa = 0;
  for(let t=caps.length-1; t>=0 && iBaixa<campoBaixa.length; t--){
    const n = Math.min(caps[t], campoBaixa.length-iBaixa);
    preenchido[t] = campoBaixa.slice(iBaixa, iBaixa+n);
    iBaixa += n;
  }
  const capsRestantes = caps.map((c,t)=>c-preenchido[t].length);

  // os cadastrados em campo são distribuídos nas vagas restantes (equilibrado pela nota
  // quando a fase 2 está ativa, aleatório antes disso)
  if(usarFase2){
    const mgLinha = mediaGlobalDoPapel(ranking,'linha');
    campoPrior = [...campoPrior].sort((a,b)=> mediaOuFallback(ranking,b.id,'linha',mgLinha,ausencias) - mediaOuFallback(ranking,a.id,'linha',mgLinha,ausencias));
  }else{
    campoPrior = shuffle(campoPrior);
  }
  const dist = distribuirPorCapacidade(campoPrior, capsRestantes, usarFase2);
  const linhaBuckets = dist.buckets.map((b,t)=>[...b, ...preenchido[t]]);
  const linhaReserva = [...dist.sobras, ...bancoReserva];

  const insertTime = db.prepare('INSERT INTO times_sorteados (id,rodada_id,nome_time,jogador_id,papel_na_partida) VALUES (?,?,?,?,?)');
  const insertReserva = db.prepare('INSERT INTO reservas (id,rodada_id,jogador_id) VALUES (?,?,?)');
  // nomes dos times desta rodada: prioriza quem não jogou (ou jogou há mais tempo)
  // nas rodadas anteriores.
  const nomesDaSemana = nomesTimesPriorizados();
  const tx = db.transaction(()=>{
    for(let i=0;i<caps.length;i++){
      linhaBuckets[i].forEach(jg=> insertTime.run(idGen('t'), rodadaId, nomesDaSemana[i], jg.id, 'linha'));
    }
    linhaReserva.forEach(jg=> insertReserva.run(idGen('rv'), rodadaId, jg.id));
    db.prepare('INSERT OR REPLACE INTO rodada_meta (rodada_id, modo_sorteio) VALUES (?,?)').run(rodadaId, usarFase2?'fase2':'fase1');
    db.prepare('UPDATE rodadas SET status=? WHERE id=?').run('sorteado', rodadaId);
  });
  tx();
  logEvento('Sorteio realizado para a rodada de '+rodada.data+' ('+(usarFase2?'ponderado por nota':'aleatório')+'): '+caps.length+' time(s) ['+caps.join('+')+'], '+linhaReserva.length+' reserva(s), '+confirmados.filter(x=>x.posicao_padrao==='goleiro').length+' goleiro(s) presente(s), '+reservasMarcadas.length+' reserva(s) marcado(s), '+guestPool.length+' convidado(s).');
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
app.get('/api/version', (req,res)=>{
  const a = db.prepare("SELECT telefone FROM jogadores WHERE super_admin=1 AND ativo=1 AND telefone<>'' LIMIT 1").get()
         || db.prepare("SELECT telefone FROM jogadores WHERE admin=1 AND ativo=1 AND telefone<>'' LIMIT 1").get();
  res.json({version: APP_VERSION, adminWhats: (a && a.telefone) ? a.telefone : ''});
});

/* ---- autenticação ---- */
app.post('/api/login', loginLimiter, (req,res)=>{
  const pin = String(req.body.pin||'');
  const jogador = db.prepare('SELECT * FROM jogadores WHERE pin=? AND ativo=1').get(pin);
  if(!jogador) return res.status(401).json({erro:'PIN não encontrado.'});
  const token = criarSessao(jogador.id, false);
  res.json({token, jogador:jogadorPublico(jogador)});
});

/* ---- mensalidade: valor individual e dias em atraso ---- */
function hojeSP(){ return spWallClockNow().slice(0,10); }
function diasEntreDatas(de, ate){
  const [y1,m1,d1] = de.split('-').map(Number), [y2,m2,d2] = ate.split('-').map(Number);
  return Math.round((Date.UTC(y2,m2-1,d2) - Date.UTC(y1,m1-1,d1)) / 86400000);
}
// dias em atraso (só para quem está EM ATRASO e tem a data de início registrada)
function diasEmAtraso(j){
  if(!j || j.mensalidade!=='em_atraso' || !j.atraso_desde) return null;
  return Math.max(0, diasEntreDatas(j.atraso_desde, hojeSP()));
}
// Vencimento da mensalidade = 2º DOMINGO de cada mês. O atraso conta sempre a partir dele.
function segundoDomingo(ano, mes){            // mes: 1-12 -> 'YYYY-MM-DD'
  const dow = new Date(Date.UTC(ano, mes-1, 1)).getUTCDay();   // 0 = domingo
  const dia = 1 + ((7 - dow) % 7) + 7;
  return ano+'-'+pad(mes)+'-'+pad(dia);
}
// vencimento mais recente (2º domingo) que já passou — ou é hoje
function ultimoVencimento(hoje){
  const [y, m] = hoje.split('-').map(Number);
  const deste = segundoDomingo(y, m);
  if(deste <= hoje) return deste;
  return m===1 ? segundoDomingo(y-1, 12) : segundoDomingo(y, m-1);
}
// troca o status de mensalidade mantendo a data de início do atraso coerente
function aplicarMensalidade(jogadorId, novo){
  const j = getJogadorPorId(jogadorId);
  if(!j) return;
  let desde = null;
  if(novo === 'em_atraso') desde = (j.mensalidade==='em_atraso' && j.atraso_desde) ? j.atraso_desde : ultimoVencimento(hojeSP());
  db.prepare('UPDATE jogadores SET mensalidade=?, atraso_desde=? WHERE id=?').run(novo, desde, jogadorId);
}
// jogadores que já estavam em atraso sem data registrada: conta a partir do último 2º domingo
function garantirDatasDeAtraso(){
  try{ db.prepare("UPDATE jogadores SET atraso_desde=? WHERE mensalidade='em_atraso' AND (atraso_desde IS NULL OR atraso_desde='')").run(ultimoVencimento(hojeSP())); }catch(e){}
}

function jogadorPublico(j){
  return {
    id:j.id, nome:j.nome, posicaoPadrao:j.posicao_padrao,
    admin:!!j.admin, superAdmin:!!j.super_admin,
    perms: (j.admin_perms||'').split(',').filter(Boolean),
    mensalidade: j.mensalidade || '',
    diasAtraso: diasEmAtraso(j),
    corneta: !!j.corneta,
    timeCoracao: j.time_coracao || '',
    deptoMedico: !!j.depto_medico,
    telefone: j.telefone || '',
    email: j.email || '',
    apelido: j.apelido || '',
    usarApelido: !!(j.usar_apelido && j.apelido),
    idade: j.idade==null ? '' : j.idade,
    peso: j.peso==null ? '' : j.peso,
    altura: j.altura==null ? '' : j.altura,
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

// Meu Perfil: todos os campos são opcionais (vazio = limpa o campo).
app.put('/api/me/perfil', requireAuth, (req,res)=>{
  const j = getJogadorPorId(req.jogadorId);
  if(!j) return res.status(401).json({erro:'Sessão inválida.'});
  const b = req.body || {};
  const telefone = String(b.telefone==null ? (j.telefone||'') : b.telefone).replace(/[^\d+()\-\s]/g,'').slice(0,30);
  let timeCoracao = j.time_coracao || '';
  if(b.timeCoracao!=null){
    if(!TIMES_CORACAO.includes(String(b.timeCoracao))) return res.status(400).json({erro:'Time do coração inválido.'});
    timeCoracao = String(b.timeCoracao);
  }
  const apelido = String(b.apelido==null ? (j.apelido||'') : b.apelido).trim().slice(0,30);
  const email = String(b.email==null ? (j.email||'') : b.email).trim().toLowerCase();
  if(email && (email.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({erro:'E-mail inválido.'});
  const numOuNull = (v, min, max, rotulo, inteiro)=>{
    if(v==null || String(v).trim()==='') return null;
    const n = Number(String(v).replace(',','.'));
    if(!Number.isFinite(n) || n<min || n>max) throw new Error(rotulo+' inválido(a) (use um valor entre '+min+' e '+max+').');
    return inteiro ? Math.round(n) : Math.round(n*10)/10;
  };
  let idade, peso, altura;
  try{
    idade  = b.idade===undefined  ? j.idade  : numOuNull(b.idade, 5, 99, 'Idade', true);
    peso   = b.peso===undefined   ? j.peso   : numOuNull(b.peso, 20, 250, 'Peso', false);
    altura = b.altura===undefined ? j.altura : numOuNull(b.altura, 100, 230, 'Altura', true);
  }catch(e){ return res.status(400).json({erro:e.message}); }
  // só dá para exibir o apelido se ele existir
  const usarApelido = apelido && (b.usarApelido===undefined ? !!j.usar_apelido : !!b.usarApelido) ? 1 : 0;
  db.prepare('UPDATE jogadores SET telefone=?, time_coracao=?, apelido=?, idade=?, peso=?, altura=?, usar_apelido=?, email=? WHERE id=?')
    .run(telefone, timeCoracao, apelido, idade, peso, altura, usarApelido, email, j.id);
  res.json({ok:true, jogador: jogadorPublico(getJogadorPorId(j.id))});
});

/* ---- elenco ---- */
app.get('/api/elenco', (req,res)=>{
  // 'nome' = nome de EXIBIÇÃO (apelido, se o jogador escolheu usar); 'nomeReal' = cadastro (PIN)
  const jogadores = getJogadores().map(j=>({id:j.id, nome:(j.usar_apelido && j.apelido) ? j.apelido : j.nome, nomeReal:j.nome, posicaoPadrao:j.posicao_padrao, ativo:!!j.ativo, timeCoracao:j.time_coracao||'', corneta:!!j.corneta}));
  res.json({jogadores});
});
app.get('/api/admin/elenco', requireSuper, (req,res)=>{
  const jogadores = getJogadores().map(j=>({
    id:j.id, nome:j.nome, pin:j.pin, posicaoPadrao:j.posicao_padrao, ativo:!!j.ativo,
    admin:!!j.admin, superAdmin:!!j.super_admin,
    adminPerms:(j.admin_perms||'').split(',').filter(Boolean),
    mensalidade:j.mensalidade||'', telefone:j.telefone||'',
    valorMensalidade: j.valor_mensalidade==null ? '' : j.valor_mensalidade,
    diasAtraso: diasEmAtraso(j),
    corneta:!!j.corneta, timeCoracao:j.time_coracao||'',
    deptoMedico:!!j.depto_medico,
  }));
  const cfg = getConfig();
  res.json({jogadores, permsDisponiveis:PERMS_ADMIN, config:{minRodadas:cfg.min_rodadas, minVotos:cfg.min_votos, simuladoNow:cfg.simulado_now, sorteioModo:cfg.sorteio_modo||'manual', sorteioAgendado:cfg.sorteio_agendado||'', mostrarVotos:!!cfg.mostrar_votos}});
});
/* ============================================================
   RELATÓRIO FINANCEIRO (Painel Admin > Elenco > Gestão)
   ============================================================ */
// "R$ 1.234,50" / "50" / "50,00" / "1.500" -> número (ou null se não der pra entender)
function parseValorBR(str){
  let t = String(str||'').replace(/[^\d.,]/g,'');
  if(!t) return null;
  if(t.includes(',')) t = t.replace(/\./g,'').replace(',','.');
  else if((t.match(/\./g)||[]).length>1) t = t.replace(/\./g,'');
  else if(/\.\d{3}$/.test(t)) t = t.replace('.','');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
function fmtBRL(n){
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return (n<0?'-':'')+'R$ '+int.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+dec;
}
// ordem de exibição dos grupos (chave 'sem_status' = jogador sem status de mensalidade)
const STATUS_FIN = [
  {chave:'em_dia',     campo:'em_dia',    label:'Em dia'},
  {chave:'em_atraso',  campo:'em_atraso', label:'Em atraso'},
  {chave:'isenta',     campo:'isenta',    label:'Isento'},
  {chave:'sem_status', campo:'',          label:'Sem status'},
];
// Valor da mensalidade vem do card "Aluguel da quadra" (campo Valor da mensalidade).
// Só EM DIA e EM ATRASO têm valor; ISENTO e SEM STATUS contam R$ 0,00. Só ativos entram.
function montarRelatorioFinanceiro(){
  const a = db.prepare('SELECT valor_mensalidade FROM aluguel_quadra WHERE id=1').get();
  const valorTexto = (a && a.valor_mensalidade) || '';
  const valorUnit = parseValorBR(valorTexto);
  const agora = spWallClockNow();
  const cfg = getConfig() || {};
  const jogadores = getJogadores().filter(j=>j.ativo).sort((x,y)=>x.nome.localeCompare(y.nome,'pt-BR'));
  const grupos = STATUS_FIN.map(s=>{
    const linhas = jogadores.filter(j=>{
      const st = ['em_dia','em_atraso','isenta'].includes(j.mensalidade) ? j.mensalidade : '';
      return st === s.campo;
    }).map(j=>{
      const cobra = (s.chave==='em_dia' || s.chave==='em_atraso');
      const individual = j.valor_mensalidade!=null;
      return {
        id:j.id, nome:j.nome,
        valor: cobra ? (individual ? j.valor_mensalidade : (valorUnit||0)) : 0,
        valorIndividual: individual ? j.valor_mensalidade : null,   // valor cadastrado no jogador (ou null = padrão)
        diasAtraso: s.chave==='em_atraso' ? diasEmAtraso(j) : null,
        atrasoDesde: s.chave==='em_atraso' ? (j.atraso_desde||null) : null,
      };
    });
    return {chave:s.chave, label:s.label, qtd:linhas.length, total:linhas.reduce((t,l)=>t+l.valor,0), linhas};
  });
  const tot = k => (grupos.find(g=>g.chave===k)||{total:0}).total;
  const custos = {
    aluguel: Number(cfg.custo_aluguel)||0,
    higienizacao: Number(cfg.custo_higienizacao)||0,
    carvao: Number(cfg.custo_carvao)||0,
  };
  const despesas = custos.aluguel + custos.higienizacao + custos.carvao;
  const receitas = {recebido: tot('em_dia'), aReceber: tot('em_atraso')};
  receitas.total = receitas.recebido + receitas.aReceber;
  const saldoCaixa = Number(cfg.saldo_caixa)||0;
  const resultadoMes = receitas.total - despesas;
  return {
    referencia: agora.slice(0,7),
    geradoEm: agora,
    valorTexto, valorUnitario: valorUnit,
    ultimoVencimento: ultimoVencimento(hojeSP()),
    aviso: valorUnit==null ? 'Defina o "Valor da mensalidade" no card Aluguel da quadra para calcular os valores.' : '',
    grupos,
    qtd: jogadores.length,
    totalGeral: grupos.reduce((t,g)=>t+g.total,0),
    saldoCaixa, custos, despesas, receitas, resultadoMes,
    // saldo previsto = saldo em caixa (conta corrente) + receitas - despesas
    saldoPrevisto: saldoCaixa + resultadoMes,
  };
}
app.get('/api/admin/relatorio-financeiro', requireAdmin, (req,res)=>{
  res.json(montarRelatorioFinanceiro());
});
// Custos da quadra (valores mensais informados pelo admin) para o fluxo de caixa.
app.put('/api/admin/custos', requireSuper, (req,res)=>{
  const b = req.body || {};
  const lerValor = (v, rotulo)=>{
    if(v==null || String(v).trim()==='') return 0;
    const n = parseValorBR(v);
    if(n==null || n<0 || n>1000000) throw new Error(rotulo+' inválido.');
    return Math.round(n*100)/100;
  };
  let aluguel, higienizacao, carvao;
  try{
    aluguel = lerValor(b.aluguel, 'Aluguel da Quadra');
    higienizacao = lerValor(b.higienizacao, 'Higienização');
    carvao = lerValor(b.carvao, 'Carvão');
  }catch(e){ return res.status(400).json({erro:e.message}); }
  db.prepare('UPDATE config SET custo_aluguel=?, custo_higienizacao=?, custo_carvao=? WHERE id=1').run(aluguel, higienizacao, carvao);
  logEvento('Custos da quadra atualizados: aluguel '+fmtBRL(aluguel)+', higienização '+fmtBRL(higienizacao)+', carvão '+fmtBRL(carvao)+'.');
  res.json({ok:true});
});

// Gestão: valor de mensalidade individual e (se EM ATRASO) a data de início do atraso.
// Disponível para qualquer usuário com status ADMIN.
app.put('/api/admin/jogadores/:id/financeiro', requireAdmin, (req,res)=>{
  const j = getJogadorPorId(req.params.id);
  if(!j) return res.status(404).json({erro:'Jogador não encontrado.'});
  const b = req.body || {};
  if(b.valor !== undefined){
    const bruto = String(b.valor==null ? '' : b.valor).trim();
    let v = null;
    if(bruto !== ''){
      const n = parseValorBR(bruto);
      if(n==null || n<0 || n>100000) return res.status(400).json({erro:'Valor de mensalidade inválido.'});
      v = Math.round(n*100)/100;
    }
    db.prepare('UPDATE jogadores SET valor_mensalidade=? WHERE id=?').run(v, j.id);
  }
  if(b.atrasoDesde !== undefined && j.mensalidade === 'em_atraso'){
    const d = String(b.atrasoDesde||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({erro:'Data de início do atraso inválida.'});
    if(d > hojeSP()) return res.status(400).json({erro:'A data de início do atraso não pode ser futura.'});
    db.prepare('UPDATE jogadores SET atraso_desde=? WHERE id=?').run(d, j.id);
  }
  logEvento('Financeiro do jogador "'+j.nome+'" atualizado (valor individual / início do atraso).');
  res.json({ok:true});
});

// Saldo em caixa: valor atualizado do saldo em conta corrente do time (aceita negativo).
app.put('/api/admin/saldo-caixa', requireAdmin, (req,res)=>{
  const bruto = String((req.body||{}).saldo==null ? '' : req.body.saldo).trim();
  let saldo = 0;
  if(bruto!==''){
    const n = parseValorBR(bruto);
    if(n==null || n>100000000) return res.status(400).json({erro:'Saldo em caixa inválido.'});
    saldo = Math.round(((/^\s*(-|\()/.test(bruto)) ? -n : n)*100)/100;
  }
  db.prepare('UPDATE config SET saldo_caixa=? WHERE id=1').run(saldo);
  logEvento('Saldo em caixa atualizado para '+fmtBRL(saldo)+'.');
  res.json({ok:true, saldoCaixa:saldo});
});

// PDF simples escrito à mão (sem dependências): A4, Helvetica, páginas numeradas.
function novoPdf(){
  const W = 595, H = 842, M = 40, RIGHT = W-M;
  const pages = [[]];
  const doc = {W, H, M, RIGHT, y: H-M};
  const cur = ()=>pages[pages.length-1];
  const esc = s => String(s).replace(/[^ -ÿ]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const largura = (s,size)=>{ let w=0; for(const ch of String(s)) w += /\d/.test(ch)?0.556 : (ch===','||ch==='.'||ch===' ')?0.278 : ch==='R'?0.722 : ch==='$'?0.556 : ch==='-'?0.333 : 0.56; return w*size; };
  doc.texto = (x,yy,s,size,bold,align)=>{
    const xx = align==='right' ? x-largura(s,size) : x;
    cur().push('BT /'+(bold?'F2':'F1')+' '+size+' Tf '+xx.toFixed(1)+' '+yy.toFixed(1)+' Td ('+esc(s)+') Tj ET');
  };
  doc.linha = (x1,y1,x2,y2,g)=> cur().push((g!=null?g+' G ':'')+'0.6 w '+x1+' '+y1.toFixed(1)+' m '+x2+' '+y2.toFixed(1)+' l S 0 G');
  doc.faixa = (yy,h,g)=> cur().push(g+' g '+M+' '+yy.toFixed(1)+' '+(W-2*M)+' '+h+' re f 0 g');
  // garante espaço de h pontos; se faltar, abre nova página e executa cab() (cabeçalho opcional)
  doc.garantir = (h, cab)=>{ if(doc.y-h < 60){ pages.push([]); doc.y = H-M; if(cab) cab(); } };
  doc.build = ()=>{
    pages.forEach((p,i)=>{ p.push('BT /F1 8 Tf '+(W/2-30)+' 24 Td (Página '+(i+1)+' de '+pages.length+') Tj ET'); });
    const objs = [];
    const add = s => { objs.push(Buffer.from(s,'latin1')); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    const nP = pages.length;
    const kids = pages.map((_,i)=> (5+i*2)+' 0 R').join(' ');
    add('<< /Type /Pages /Kids ['+kids+'] /Count '+nP+' >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    pages.forEach((p,i)=>{
      add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+(6+i*2)+' 0 R >>');
      const stream = Buffer.from(p.join('\n'),'latin1');
      objs.push(Buffer.concat([Buffer.from('<< /Length '+stream.length+' >>\nstream\n','latin1'), stream, Buffer.from('\nendstream','latin1')]));
    });
    const partes = [Buffer.from('%PDF-1.4\n','latin1')];
    const offsets = [];
    let pos = partes[0].length;
    objs.forEach((o,i)=>{
      offsets.push(pos);
      const b = Buffer.concat([Buffer.from((i+1)+' 0 obj\n','latin1'), o, Buffer.from('\nendobj\n','latin1')]);
      partes.push(b); pos += b.length;
    });
    let xref = 'xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n';
    offsets.forEach(o=>{ xref += String(o).padStart(10,'0')+' 00000 n \n'; });
    xref += 'trailer\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\nstartxref\n'+pos+'\n%%EOF\n';
    partes.push(Buffer.from(xref,'latin1'));
    return Buffer.concat(partes);
  };
  return doc;
}
function dataHoraBR(g){ return g.slice(8,10)+'/'+g.slice(5,7)+'/'+g.slice(0,4)+' às '+g.slice(11,16); }
function cabecalhoPdf(d, rel, subtitulo){
  const [ano, mes] = rel.referencia.split('-');
  d.texto(d.M, d.y, 'Bolerage F.D.', 18, true); d.y -= 20;
  d.texto(d.M, d.y, subtitulo, 13, true); d.y -= 18;
  d.texto(d.M, d.y, 'Referência: '+mes+'/'+ano+'     Valor da mensalidade: '+(rel.valorUnitario==null?'não definido':fmtBRL(rel.valorUnitario)), 10, false); d.y -= 14;
  d.texto(d.M, d.y, 'Gerado em '+dataHoraBR(rel.geradoEm)+' (horário de São Paulo)', 9, false); d.y -= 8;
  d.linha(d.M, d.y, d.RIGHT, d.y, 0.5); d.y -= 18;
}

// PDF 1: mensalidades AGRUPADAS POR STATUS, com subtotal de cada grupo e total geral.
// filtro (opcional) = chave de um grupo -> só aquele grupo.
function gerarPdfRelatorio(rel, filtro){
  const d = novoPdf();
  const grupos = filtro ? rel.grupos.filter(g=>g.chave===filtro) : rel.grupos;
  cabecalhoPdf(d, rel, 'Relatório Financeiro - Mensalidades'+(filtro && grupos[0] ? ' ('+grupos[0].label+')' : ''));
  const cabTabela = ()=>{
    d.faixa(d.y-4, 16, 0.88);
    d.texto(d.M+4, d.y, '#', 9, true); d.texto(d.M+28, d.y, 'Jogador', 9, true); d.texto(d.RIGHT-4, d.y, 'Valor', 9, true, 'right');
    d.y -= 18;
  };
  grupos.forEach(g=>{
    d.garantir(70, null);
    // título do grupo
    d.faixa(d.y-5, 18, 0.80);
    d.texto(d.M+4, d.y, g.label.toUpperCase(), 11, true);
    d.texto(d.RIGHT-4, d.y, g.qtd+' jogador'+(g.qtd===1?'':'es'), 9, false, 'right');
    d.y -= 20;
    g.linhas.forEach((l,i)=>{
      d.garantir(18, ()=>{ d.texto(d.M, d.y, g.label+' (continuação)', 10, true); d.y -= 16; });
      if(i%2===1) d.faixa(d.y-4, 15, 0.96);
      d.texto(d.M+4, d.y, String(i+1), 9, false);
      d.texto(d.M+28, d.y, l.nome + (l.valorIndividual!=null ? ' *' : ''), 10, false);
      if(g.chave==='em_atraso' && l.diasAtraso!=null) d.texto(330, d.y, l.diasAtraso+' dia'+(l.diasAtraso===1?'':'s')+' em atraso', 9, false);
      d.texto(d.RIGHT-4, d.y, fmtBRL(l.valor), 10, false, 'right');
      d.y -= 15;
    });
    if(!g.linhas.length){ d.texto(d.M+4, d.y, 'Nenhum jogador neste status.', 9, false); d.y -= 15; }
    d.linha(d.M, d.y+9, d.RIGHT, d.y+9, 0.4);
    d.texto(d.M+28, d.y-4, 'Subtotal - '+g.label, 10, true);
    d.texto(d.RIGHT-4, d.y-4, fmtBRL(g.total), 10, true, 'right');
    d.y -= 28;
  });
  if(!filtro){
    d.garantir(40, null);
    d.faixa(d.y-6, 20, 0.88);
    d.texto(d.M+4, d.y, 'TOTAL GERAL', 11, true);
    d.texto(d.M+160, d.y, rel.qtd+' jogadores', 9, true);
    d.texto(d.RIGHT-4, d.y, fmtBRL(rel.totalGeral), 11, true, 'right');
    d.y -= 24;
  }
  if(grupos.some(g=>g.linhas.some(l=>l.valorIndividual!=null))){
    d.garantir(20, null);
    d.texto(d.M, d.y, '* valor de mensalidade individual do jogador (os demais usam o valor padr\u00E3o).', 8, false); d.y -= 14;
  }
  if(rel.aviso){ d.garantir(20, null); d.texto(d.M, d.y, 'Atenção: defina o valor da mensalidade no card Aluguel da quadra.', 9, false); }
  return d.build();
}

// PDF 2: fluxo de caixa = RECEITAS (mensalidades) - DESPESAS (custos da quadra) = SALDO PREVISTO.
function gerarPdfFluxoCaixa(rel){
  const d = novoPdf();
  cabecalhoPdf(d, rel, 'Fluxo de Caixa');
  const secao = (titulo)=>{
    d.faixa(d.y-5, 18, 0.80); d.texto(d.M+4, d.y, titulo, 11, true); d.y -= 22;
  };
  const item = (rotulo, valor, negrito)=>{
    d.texto(d.M+10, d.y, rotulo, 10, !!negrito); d.texto(d.RIGHT-4, d.y, fmtBRL(valor), 10, !!negrito, 'right'); d.y -= 16;
  };
  secao('SALDO EM CAIXA (conta corrente)');
  item('Saldo atual em caixa', rel.saldoCaixa, true);
  d.y -= 10;
  secao('RECEITAS (mensalidades)');
  const g = k => rel.grupos.find(x=>x.chave===k);
  item('Em dia ('+g('em_dia').qtd+' jogador'+(g('em_dia').qtd===1?'':'es')+') - já recebido', rel.receitas.recebido);
  item('Em atraso ('+g('em_atraso').qtd+' jogador'+(g('em_atraso').qtd===1?'':'es')+') - a receber', rel.receitas.aReceber);
  d.linha(d.M, d.y+11, d.RIGHT, d.y+11, 0.4);
  item('Total de receitas', rel.receitas.total, true);
  d.y -= 10;
  secao('DESPESAS (custos da quadra)');
  item('Aluguel da Quadra', rel.custos.aluguel);
  item('Higienização', rel.custos.higienizacao);
  item('Carvão', rel.custos.carvao);
  d.linha(d.M, d.y+11, d.RIGHT, d.y+11, 0.4);
  item('Total de despesas', rel.despesas, true);
  d.y -= 6;
  item('Resultado do mês (receitas - despesas)', rel.resultadoMes, true);
  d.y -= 10;
  d.faixa(d.y-10, 30, rel.saldoPrevisto<0 ? 0.85 : 0.88);
  d.texto(d.M+8, d.y, 'SALDO PREVISTO', 12, true);
  d.texto(d.RIGHT-8, d.y, fmtBRL(rel.saldoPrevisto), 14, true, 'right');
  d.y -= 36;
  d.texto(d.M, d.y, 'Saldo previsto = saldo em caixa + receitas - despesas.', 8, false); d.y -= 11;
  d.texto(d.M, d.y, 'Receitas = mensalidades Em dia + Em atraso. Isentos e jogadores sem status contam R$ 0,00.', 8, false);
  if(rel.aviso){ d.y -= 12; d.texto(d.M, d.y, 'Atenção: defina o valor da mensalidade no card Aluguel da quadra.', 8, false); }
  return d.build();
}
function enviarPdf(res, pdf, nome){
  res.set('Content-Type','application/pdf');
  res.set('Content-Disposition','attachment; filename="'+nome+'"');
  res.send(pdf);
}
app.get('/api/admin/relatorio-financeiro.pdf', requireAdmin, (req,res)=>{
  const rel = montarRelatorioFinanceiro();
  const filtro = STATUS_FIN.some(s=>s.chave===req.query.status) ? String(req.query.status) : null;
  logEvento('Relatório financeiro (PDF) gerado pelo administrador — referência '+rel.referencia+(filtro?' — filtro '+filtro:'')+'.');
  enviarPdf(res, gerarPdfRelatorio(rel, filtro), 'relatorio-financeiro-'+rel.referencia+(filtro?'-'+filtro:'')+'.pdf');
});
app.get('/api/admin/fluxo-caixa.pdf', requireAdmin, (req,res)=>{
  const rel = montarRelatorioFinanceiro();
  logEvento('Fluxo de caixa (PDF) gerado pelo administrador — referência '+rel.referencia+'.');
  enviarPdf(res, gerarPdfFluxoCaixa(rel), 'fluxo-de-caixa-'+rel.referencia+'.pdf');
});

// lista enxuta p/ sub-admin com permissão de mensalidades (sem PIN, sem dados de admin)
app.get('/api/admin/mensalidades', requirePerm('mensalidades'), (req,res)=>{
  const jogadores = getJogadores().filter(j=>j.ativo).map(j=>({
    id:j.id, nome:j.nome, mensalidade:j.mensalidade||'',
    valorMensalidade: j.valor_mensalidade==null ? '' : j.valor_mensalidade,   // '' = usa o valor padrão
    diasAtraso: diasEmAtraso(j), atrasoDesde: j.atraso_desde || '',
  }));
  const a = db.prepare('SELECT valor_mensalidade FROM aluguel_quadra WHERE id=1').get();
  const padrao = parseValorBR((a && a.valor_mensalidade) || '');
  res.json({jogadores, valorPadrao: padrao, ultimoVencimento: ultimoVencimento(hojeSP())});
});
app.put('/api/admin/jogadores/:id/mensalidade', requirePerm('mensalidades'), (req,res)=>{
  const j = getJogadorPorId(req.params.id);
  if(!j) return res.status(404).json({erro:'Jogador não encontrado.'});
  const val = String(req.body.mensalidade||'');
  if(!MENSALIDADE_VALORES.includes(val)) return res.status(400).json({erro:'Valor de mensalidade inválido.'});
  aplicarMensalidade(j.id, val);
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
  let telefone = j.telefone || '';
  if(req.body.telefone!=null) telefone = String(req.body.telefone).slice(0,30);
  const corneta = req.body.corneta!=null ? (req.body.corneta?1:0) : (j.corneta||0);
  let timeCoracao = j.time_coracao || '';
  if(req.body.timeCoracao!=null && TIMES_CORACAO.includes(String(req.body.timeCoracao))){
    timeCoracao = String(req.body.timeCoracao);
  }
  const deptoMedico = req.body.deptoMedico!=null ? (req.body.deptoMedico?1:0) : (j.depto_medico||0);
  // valor de mensalidade individual ('' = volta ao valor padrão do card Aluguel da quadra)
  let valorMens = j.valor_mensalidade==null ? null : j.valor_mensalidade;
  if(req.body.valorMensalidade!==undefined){
    const bruto = String(req.body.valorMensalidade==null ? '' : req.body.valorMensalidade).trim();
    if(bruto===''){ valorMens = null; }
    else{
      const n = parseValorBR(bruto);
      if(n==null || n<0 || n>100000) return res.status(400).json({erro:'Valor de mensalidade inválido.'});
      valorMens = Math.round(n*100)/100;
    }
  }
  db.prepare('UPDATE jogadores SET nome=?,pin=?,posicao_padrao=?,ativo=?,admin=?,admin_perms=?,telefone=?,corneta=?,time_coracao=?,depto_medico=?,valor_mensalidade=? WHERE id=?')
    .run(nome,pin,posicaoPadrao,ativo,admin,adminPerms,telefone,corneta,timeCoracao,deptoMedico,valorMens,j.id);
  aplicarMensalidade(j.id, mensalidade);
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

// Sorteio dos times: manual (padrão) ou automático (data/hora agendada pelo ADMIN).
app.put('/api/admin/sorteio-agenda', requireSuper, (req,res)=>{
  const modo = req.body.modo;
  if(!['manual','automatico'].includes(modo)) return res.status(400).json({erro:'Modo inválido.'});
  if(modo==='manual'){
    db.prepare("UPDATE config SET sorteio_modo='manual', sorteio_agendado=NULL WHERE id=1").run();
    logEvento('Sorteio dos times definido como MANUAL.');
    return res.json({ok:true});
  }
  const quando = String(req.body.agendadoEm||'');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(quando)) return res.status(400).json({erro:'Informe a data e o horário do sorteio automático.'});
  if(quando+':00' <= nowSP()) return res.status(400).json({erro:'A data/horário do sorteio precisa estar no futuro.'});
  const rodada = getRodadaAtual();
  if(rodada && ['aguardando_confirmacao','sorteio_desfeito'].includes(rodada.status)){
    const j = janelas(rodada.data);
    if(quando+':00' < j.confirmClose) return res.status(400).json({erro:'O sorteio automático só pode ser agendado após o fim da confirmação (domingo às 8h).'});
  }
  db.prepare("UPDATE config SET sorteio_modo='automatico', sorteio_agendado=? WHERE id=1").run(quando);
  logEvento('Sorteio dos times AUTOMÁTICO agendado para '+quando.replace('T',' às ')+'.');
  res.json({ok:true});
});
// Sorteio MANUAL: o admin marca como RESERVA quem fez check-in mas não está presente na hora
// do sorteio. Reservas + convidados formam os últimos times (prioridade baixa) e o jogador
// continua podendo votar normalmente.
app.put('/api/admin/rodadas/:id/reserva', requireSuper, (req,res)=>{
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  if(!['aguardando_confirmacao','sorteio_desfeito'].includes(rodada.status)) return res.status(400).json({erro:'Só é possível marcar reservas antes do sorteio.'});
  if((getConfig().sorteio_modo||'manual')!=='manual') return res.status(400).json({erro:'Marcar reservas só está disponível no modo de sorteio MANUAL.'});
  const jogadorId = String(req.body.jogadorId||'');
  const conf = db.prepare('SELECT * FROM confirmacoes WHERE rodada_id=? AND jogador_id=?').get(rodada.id, jogadorId);
  if(!conf || conf.status!=='presente') return res.status(400).json({erro:'Esse jogador não fez check-in como presente.'});
  const jg = getJogadorPorId(jogadorId);
  if(!jg || jg.posicao_padrao!=='linha' || jg.corneta) return res.status(400).json({erro:'Apenas jogadores de linha podem ser marcados como reserva.'});
  const v = req.body.reserva ? 1 : 0;
  db.prepare('UPDATE confirmacoes SET reserva=? WHERE id=?').run(v, conf.id);
  logEvento('Jogador "'+jg.nome+'" '+(v?'marcado como RESERVA':'desmarcado de reserva')+' para o sorteio de '+rodada.data+'.');
  res.json({ok:true});
});
// Exibe (ou não) a aba "Votos dos Jogadores" na Resenha.
app.put('/api/admin/mostrar-votos', requireSuper, (req,res)=>{
  const v = req.body.mostrar ? 1 : 0;
  db.prepare('UPDATE config SET mostrar_votos=? WHERE id=1').run(v);
  logEvento('Aba "Votos dos Jogadores" '+(v?'habilitada':'ocultada')+' pelo admin.');
  // devolve o valor realmente gravado (lido de volta do banco)
  res.json({ok:true, mostrarVotos: !!getConfig().mostrar_votos});
});

/* ---- rodadas ---- */
function serializarRodada(rodada, viewerId){
  rodada = atualizarStatusSeNecessario(rodada);
  const fase = computeFase(rodada);
  const confirmados = getPorStatus(rodada.id, 'presente').map(j=>j.id);
  // ausente é o padrão: todo jogador ativo que não confirmou presença conta como ausente,
  // tenha ele marcado isso explicitamente ou simplesmente não mexido em nada.
  const ausentes = getJogadores().filter(j=>j.ativo && !confirmados.includes(j.id)).map(j=>j.id);
  const convidados = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND status='presente' AND trouxe_convidado=1").all(rodada.id).map(r=>r.jogador_id);
  const resenha = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND resenha=1").all(rodada.id).map(r=>r.jogador_id);
  const vinho = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND resenha=1 AND vinho=1").all(rodada.id).map(r=>r.jogador_id);
  const _jr = janelas(rodada.data), _nr = nowSP();
  const resenhaEdicaoConfirmacao = _nr >= _jr.confirmOpen && _nr < _jr.confirmClose;
  const resenhaEdicaoLivre = _nr >= _jr.resenhaLivreOpen && _nr < _jr.resenhaLivreClose;
  // check-in da resenha: só fica disponível de sábado 8h até domingo 11h (janela única,
  // cobre a confirmação inteira + a última hora de ajuste antes do jogo).
  const resenhaCheckinAberto = _nr >= _jr.confirmOpen && _nr < _jr.resenhaLivreClose;
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
  const votos = db.prepare('SELECT jogador_avaliado_id as avaliadoId, jogador_avaliador_id as avaliadorId, nota, edicoes FROM votos WHERE rodada_id=?').all(rodada.id);
  const cfg = getConfig();
  const mostrarVotos = !!cfg.mostrar_votos;
  // com a aba desligada, ninguém vê quem votou em quem (só os próprios votos de cada um)
  const votosOut = mostrarVotos ? votos : votos.map(v=> (viewerId && v.avaliadorId===viewerId) ? v : {...v, avaliadorId:null});
  // goleiros presentes: não entram no sorteio, ficam fixos na tela dos times
  const goleirosPresentes = getPorStatus(rodada.id, 'presente').filter(j=>j.posicao_padrao==='goleiro').map(j=>j.id);
  const sorteioConfig = {modo: cfg.sorteio_modo||'manual', agendadoEm: cfg.sorteio_agendado||null};
  const reservasMarcadas = db.prepare("SELECT jogador_id FROM confirmacoes WHERE rodada_id=? AND status='presente' AND reserva=1").all(rodada.id).map(r=>r.jogador_id);
  // botão CORNETA (WhatsApp) na aba Votos dos Jogadores: só com a aba habilitada e para
  // jogador logado — e só dos votantes que cadastraram telefone.
  let telefonesVotantes = {};
  if(mostrarVotos && viewerId){
    const idsVot = [...new Set(votos.map(v=>v.avaliadorId).filter(Boolean))];
    idsVot.forEach(id=>{
      const jg = getJogadorPorId(id);
      const dig = jg && jg.telefone ? String(jg.telefone).replace(/\D/g,'') : '';
      if(dig.length>=10) telefonesVotantes[id] = (dig.length<=11 ? '55' : '')+dig;
    });
  }
  return {id:rodada.id, data:rodada.data, status:rodada.status, fase, confirmados, ausentes, convidados, resenha, vinho, resenhaEdicaoConfirmacao, resenhaEdicaoLivre, resenhaCheckinAberto, times, votos:votosOut, goleirosPresentes, mostrarVotos, sorteioConfig, reservasMarcadas, telefonesVotantes};
}

function viewerIdDe(req){ const s = getSessao(extrairToken(req)); return (s && s.jogador_id) || null; }
app.get('/api/rodadas', (req,res)=>{
  res.json({rodadas: getRodadas().map(r=>({id:r.id, data:r.data, status:r.status}))});
});
app.get('/api/rodadas/atual', (req,res)=>{
  const rodada = getRodadaAtual();
  if(!rodada) return res.json({rodada:null});
  res.json({rodada: serializarRodada(rodada, viewerIdDe(req))});
});
app.get('/api/rodadas/:id', (req,res)=>{
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  res.json({rodada: serializarRodada(rodada, viewerIdDe(req))});
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
  // resenha não depende mais da presença na partida — não é limpa ao marcar ausente.
  const resenhaFlag = existente ? existente.resenha : 0;
  if(existente){
    // reconfirmar estando já presente não muda o horário do check-in (a prioridade é de quem confirmou primeiro)
    const mantemHora = status==='presente' && existente.status==='presente' && existente.confirmado_em;
    db.prepare('UPDATE confirmacoes SET status=?, confirmado_em=?, trouxe_convidado=?, resenha=?, reserva=? WHERE id=?').run(status, mantemHora ? existente.confirmado_em : nowISO(), convidadoFlag, resenhaFlag, status==='presente' ? existente.reserva : 0, existente.id);
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

// Check-in da resenha: disponível para qualquer jogador (inclusive Corneta, que não pode
// confirmar presença na partida — ver /presenca abaixo), só que apenas dentro da janela
// única de sábado 8h até domingo 11h.
app.post('/api/rodadas/:id/resenha', requireAuth, (req,res)=>{
  const vaiResenha = !!req.body.resenha;
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const j = janelas(rodada.data);
  const n = nowSP();
  if(n < j.confirmOpen || n >= j.resenhaLivreClose) return res.status(403).json({erro:'O check-in da resenha só fica disponível de sábado às 8h até domingo às 11h.'});
  const existente = db.prepare('SELECT * FROM confirmacoes WHERE rodada_id=? AND jogador_id=?').get(rodada.id, req.jogadorId);
  // sair da resenha também derruba o "vou levar vinho" — não faz sentido manter.
  const vinhoFlag = vaiResenha ? (existente ? existente.vinho : 0) : 0;
  if(existente){
    db.prepare('UPDATE confirmacoes SET resenha=?, vinho=? WHERE id=?').run(vaiResenha?1:0, vinhoFlag, existente.id);
  }else{
    db.prepare('INSERT INTO confirmacoes (id,rodada_id,jogador_id,confirmado_em,status,trouxe_convidado,resenha,vinho) VALUES (?,?,?,?,?,?,?,?)')
      .run(idGen('c'), rodada.id, req.jogadorId, nowISO(), 'ausente', 0, vaiResenha?1:0, 0);
  }
  res.json({ok:true});
});

// "Vou levar uma garrafa de vinho" — só quem já está na resenha pode marcar, e só
// dentro da mesma janela de check-in da resenha.
app.post('/api/rodadas/:id/vinho', requireAuth, (req,res)=>{
  const vaiVinho = !!req.body.vinho;
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const j = janelas(rodada.data);
  const n = nowSP();
  if(n < j.confirmOpen || n >= j.resenhaLivreClose) return res.status(403).json({erro:'O check-in da resenha só fica disponível de sábado às 8h até domingo às 11h.'});
  const existente = db.prepare('SELECT * FROM confirmacoes WHERE rodada_id=? AND jogador_id=?').get(rodada.id, req.jogadorId);
  if(!existente || !existente.resenha) return res.status(400).json({erro:'Ative a resenha antes de indicar se vai levar vinho.'});
  db.prepare('UPDATE confirmacoes SET vinho=? WHERE id=?').run(vaiVinho?1:0, existente.id);
  res.json({ok:true});
});

app.post('/api/admin/rodadas/:id/sortear', requireSuper, (req,res)=>{
  const resultado = realizarSorteio(req.params.id);
  if(!resultado.ok) return res.status(400).json({erro: resultado.erro});
  res.json({ok:true});
});

// Desfaz um sorteio já feito: apaga times, reservas e votos dessa rodada e deixa a
// rodada pronta para um novo sorteio manual (as confirmações de presença são mantidas).
app.post('/api/admin/rodadas/:id/desfazer-sorteio', requireSuper, (req,res)=>{
  const rodada = getRodadaPorId(req.params.id);
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  if(rodada.status !== 'sorteado') return res.status(400).json({erro:'Esta rodada não tem um sorteio ativo para desfazer.'});
  const tx = db.transaction(()=>{
    db.prepare('DELETE FROM votos WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM times_sorteados WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM reservas WHERE rodada_id=?').run(rodada.id);
    db.prepare('DELETE FROM rodada_meta WHERE rodada_id=?').run(rodada.id);
    db.prepare('UPDATE rodadas SET status=? WHERE id=?').run('sorteio_desfeito', rodada.id);
  });
  tx();
  logEvento('Sorteio da rodada de '+rodada.data+' desfeito pelo Super Admin (times, reservas e votos apagados). Aguardando novo sorteio manual.');
  res.json({ok:true});
});

// pode ser AVALIADO: jogou (time ou reserva do sorteio) ou é goleiro presente.
function votavelNaRodada(rodadaId, jogadorId){
  const emTime = db.prepare('SELECT 1 FROM times_sorteados WHERE rodada_id=? AND jogador_id=?').get(rodadaId, jogadorId);
  if(emTime) return true;
  const emReserva = db.prepare('SELECT 1 FROM reservas WHERE rodada_id=? AND jogador_id=?').get(rodadaId, jogadorId);
  if(emReserva) return true;
  // goleiros presentes não entram no sorteio, mas participam da rodada (votam e são votados)
  const gol = db.prepare("SELECT 1 FROM confirmacoes c JOIN jogadores j ON j.id=c.jogador_id WHERE c.rodada_id=? AND c.jogador_id=? AND c.status='presente' AND j.posicao_padrao='goleiro'").get(rodadaId, jogadorId);
  return !!gol;
}
// pode VOTAR: quem pode ser avaliado + cornetas que fizeram check-in (votam, mas não jogam).
function participouDaRodada(rodadaId, jogadorId){
  if(votavelNaRodada(rodadaId, jogadorId)) return true;
  const corneta = db.prepare("SELECT 1 FROM confirmacoes c JOIN jogadores j ON j.id=c.jogador_id WHERE c.rodada_id=? AND c.jogador_id=? AND c.status='presente' AND j.corneta=1").get(rodadaId, jogadorId);
  return !!corneta;
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
  if(!participouDaRodada(rodada.id, req.jogadorId)) return res.status(403).json({erro:'Você só pode votar se fez check-in nesta rodada (escalado, reserva, goleiro ou corneta).'});
  if(!votavelNaRodada(rodada.id, avaliadoId)) return res.status(400).json({erro:'Esse jogador não fez parte desta rodada.'});
  const existente = db.prepare('SELECT * FROM votos WHERE rodada_id=? AND jogador_avaliado_id=? AND jogador_avaliador_id=?')
    .get(rodada.id, avaliadoId, req.jogadorId);
  // cada jogador pode votar e, uma única vez, mudar de ideia — a 2ª alteração já não é permitida.
  if(existente){
    if(nota === existente.nota) return res.json({ok:true, edicoesRestantes: existente.edicoes>=1?0:1});
    if(existente.edicoes >= 1) return res.status(409).json({erro:'Esse voto já foi alterado uma vez — não é possível alterar de novo.'});
    db.prepare('UPDATE votos SET nota=?, edicoes=edicoes+1, criado_em=? WHERE id=?').run(nota, nowISO(), existente.id);
    return res.json({ok:true, edicoesRestantes:0});
  }
  db.prepare('INSERT INTO votos (id,rodada_id,jogador_avaliado_id,jogador_avaliador_id,nota,edicoes,criado_em) VALUES (?,?,?,?,?,0,?)')
    .run(idGen('v'), rodada.id, avaliadoId, req.jogadorId, nota, nowISO());
  res.json({ok:true, edicoesRestantes:1});
});

// Ausências acumuladas por jogador (cornetas incluídos): em cada rodada já sorteada (após a 1ª presença do
// jogador) em que ele NÃO esteve presente, conta 1 ausência. No Ranking Geral cada
// ausência tira 10% dos pontos acumulados, em cascata (média × 0,9^ausências).
function calcularAusencias(){
  const rodadas = db.prepare("SELECT id FROM rodadas WHERE status='sorteado' ORDER BY data ASC").all();
  const jogadores = db.prepare('SELECT id FROM jogadores WHERE ativo=1').all(); // inclui cornetas
  const presentes = db.prepare("SELECT rodada_id, jogador_id FROM confirmacoes WHERE status='presente'").all();
  const setPres = new Set(presentes.map(p=>p.rodada_id+'|'+p.jogador_id));
  const out = {};
  jogadores.forEach(jg=>{
    let jaJogou = false, k = 0;
    rodadas.forEach(r=>{
      if(setPres.has(r.id+'|'+jg.id)) jaJogou = true;
      else if(jaJogou) k++;
    });
    if(k>0) out[jg.id] = k;
  });
  return out;
}
app.get('/api/ranking', (req,res)=>{
  res.json({ranking: calcularRanking(), ausencias: calcularAusencias()});
});
// Desempenho do jogador ao longo do tempo (gráfico do Ranking): por rodada sorteada, a média
// recebida na rodada e a média acumulada — já com o desconto de 10% por ausência.
function calcularSerieJogador(jogadorId){
  const rodadas = db.prepare("SELECT id, data FROM rodadas WHERE status='sorteado' ORDER BY data ASC").all();
  const votos = db.prepare('SELECT rodada_id, nota FROM votos WHERE jogador_avaliado_id=?').all(jogadorId);
  const pres = new Set(db.prepare("SELECT rodada_id FROM confirmacoes WHERE jogador_id=? AND status='presente'").all(jogadorId).map(r=>r.rodada_id));
  let somaAc = 0, nAc = 0, jaJogou = false, k = 0;
  return rodadas.map(r=>{
    const presente = pres.has(r.id);
    if(presente) jaJogou = true; else if(jaJogou) k++;
    const vs = votos.filter(v=>v.rodada_id===r.id);
    const soma = vs.reduce((a,v)=>a+v.nota, 0);
    somaAc += soma; nAc += vs.length;
    return {
      data: r.data, presente, n: vs.length,
      media: vs.length ? Math.round(soma/vs.length*100)/100 : null,
      acumulada: nAc ? Math.round(somaAc/nAc*Math.pow(0.9,k)*100)/100 : null,
      ausencias: k,
    };
  });
}
app.get('/api/ranking/jogador/:id', (req,res)=>{
  const j = getJogadorPorId(req.params.id);
  if(!j) return res.status(404).json({erro:'Jogador não encontrado.'});
  res.json({id:j.id, nome:j.nome, serie: calcularSerieJogador(j.id)});
});
app.get('/api/ranking-bola', (req,res)=>{
  res.json(calcularRankingBola());
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
  const telDoNome = nm => { if(!nm) return ''; const j = db.prepare('SELECT telefone FROM jogadores WHERE nome=? AND ativo=1').get(nm); return (j && j.telefone) ? j.telefone : ''; };
  const eventos = db.prepare('SELECT id,nome,data,descricao,responsavel FROM eventos WHERE ativo=1 ORDER BY data ASC').all()
    .map(e=>({id:e.id, nome:e.nome, data:e.data, descricao:e.descricao||'', responsavel:e.responsavel||'', responsavelTel: telDoNome(e.responsavel)}));
  const noticiaRow = db.prepare('SELECT descricao,ativo FROM noticia WHERE id=1').get();
  const aluguelRow = db.prepare('SELECT nome,chave_pix,valor_mensalidade,ativo FROM aluguel_quadra WHERE id=1').get();
  const gestaoRow = db.prepare('SELECT presidente,vice_presidente,ativo FROM gestao WHERE id=1').get();
  res.json({
    eventos,
    noticia: (noticiaRow && noticiaRow.ativo) ? {descricao: noticiaRow.descricao} : null,
    aluguel: (aluguelRow && aluguelRow.ativo) ? {nome:aluguelRow.nome, chavePix:aluguelRow.chave_pix, valorMensalidade:aluguelRow.valor_mensalidade} : null,
    gestao: (gestaoRow && gestaoRow.ativo) ? {presidente:gestaoRow.presidente, vicePresidente:gestaoRow.vice_presidente, presidenteTel:telDoNome(gestaoRow.presidente), viceTel:telDoNome(gestaoRow.vice_presidente)} : null,
  });
});

app.get('/api/admin/agenda', requirePerm('conteudo'), (req,res)=>{
  res.json({eventos: db.prepare('SELECT * FROM eventos ORDER BY data ASC').all().map(e=>({id:e.id,nome:e.nome,data:e.data,ativo:!!e.ativo,descricao:e.descricao||'',responsavel:e.responsavel||''}))});
});
app.post('/api/admin/agenda', requirePerm('conteudo'), (req,res)=>{
  const nome = String(req.body.nome||'').trim();
  const data = String(req.body.data||'').trim();
  if(!nome || !data) return res.status(400).json({erro:'Informe nome e data do evento.'});
  const descricao = String(req.body.descricao||'');
  const responsavel = String(req.body.responsavel||'');
  const id = idGen('ev');
  db.prepare('INSERT INTO eventos (id,nome,data,ativo,descricao,responsavel) VALUES (?,?,?,1,?,?)').run(id, nome, data, descricao, responsavel);
  res.json({ok:true, id});
});
app.put('/api/admin/agenda/:id', requirePerm('conteudo'), (req,res)=>{
  const ev = db.prepare('SELECT * FROM eventos WHERE id=?').get(req.params.id);
  if(!ev) return res.status(404).json({erro:'Evento não encontrado.'});
  const nome = req.body.nome!=null ? String(req.body.nome) : ev.nome;
  const data = req.body.data!=null ? String(req.body.data) : ev.data;
  const ativo = req.body.ativo!=null ? (req.body.ativo?1:0) : ev.ativo;
  const descricao = req.body.descricao!=null ? String(req.body.descricao) : (ev.descricao||'');
  const responsavel = req.body.responsavel!=null ? String(req.body.responsavel) : (ev.responsavel||'');
  db.prepare('UPDATE eventos SET nome=?,data=?,ativo=?,descricao=?,responsavel=? WHERE id=?').run(nome,data,ativo,descricao,responsavel,ev.id);
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

/* ---- sorteio automático (opcional: o ADMIN agenda data e hora no painel) ---- */
// Modo padrão = manual (botão "Realizar sorteio"). No modo automático o sorteio roda
// UMA vez, quando o relógio de São Paulo alcança config.sorteio_agendado; depois o
// sistema volta sozinho para o modo manual.
function checarSorteioAutomatico(){
  try{
    const cfg = getConfig();
    if(!cfg || cfg.sorteio_modo!=='automatico' || !cfg.sorteio_agendado) return;
    if(nowSP() < cfg.sorteio_agendado+':00') return;
    const rodada = getRodadaAtual();
    let msg;
    if(!rodada){
      msg = 'nenhuma rodada encontrada.';
    }else{
      const atualizada = atualizarStatusSeNecessario(rodada);
      if(atualizada.status==='aguardando_confirmacao'){
        const resultado = realizarSorteio(atualizada.id);
        msg = resultado.ok ? 'sorteio realizado para a rodada de '+atualizada.data+'.' : 'não foi possível sortear ('+resultado.erro+')';
      }else{
        msg = 'a rodada de '+atualizada.data+' não está aguardando sorteio (status: '+atualizada.status+').';
      }
    }
    db.prepare("UPDATE config SET sorteio_modo='manual', sorteio_agendado=NULL WHERE id=1").run();
    logEvento('Sorteio automático agendado para '+cfg.sorteio_agendado.replace('T',' às ')+': '+msg+' Modo voltou para manual.');
  }catch(e){ console.error('Erro no sorteio automático:', e); }
}
setInterval(checarSorteioAutomatico, 60*1000);
checarSorteioAutomatico();

/* ---- mensalidade: todo dia 1º o status é zerado ---- */
// No primeiro minuto de cada mês (horário real de São Paulo) o status de mensalidade de
// todos os jogadores é removido, EXCETO "em atraso" (que continua até o admin atualizar) e
// "isenta" (isenção não é um status mensal). Usa o relógio REAL — a data simulada do admin
// não dispara o reset. Na 1ª execução após o deploy só registra o mês atual (não zera nada).
function resetMensalidadeMensalSeNecessario(){
  try{
    const mesAtual = spWallClockNow().slice(0,7);
    const cfg = getConfig();
    if(!cfg) return;
    if(!cfg.mensalidade_ref){
      db.prepare('UPDATE config SET mensalidade_ref=? WHERE id=1').run(mesAtual);
      return;
    }
    if(cfg.mensalidade_ref === mesAtual) return;
    const r = db.prepare("UPDATE jogadores SET mensalidade='' WHERE mensalidade IN ('em_dia')").run();
    db.prepare('UPDATE config SET mensalidade_ref=? WHERE id=1').run(mesAtual);
    logEvento('Virada de mês ('+mesAtual+'): status de mensalidade zerado para '+r.changes+' jogador(es); "em atraso" e "isenta" foram mantidos.');
  }catch(e){ console.error('Erro ao zerar mensalidades:', e); }
}
setInterval(resetMensalidadeMensalSeNecessario, 60*1000);
resetMensalidadeMensalSeNecessario();
garantirDatasDeAtraso();

app.listen(PORT, ()=>{
  console.log('Bolerage F.D. rodando na porta ' + PORT);
});
