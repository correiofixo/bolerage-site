/* ============================================================
   Bolerage F.D. — Site de sorteio e avaliação da pelada
   Backend Node.js + Express + SQLite (better-sqlite3)
   ============================================================ */
'use strict';

// Contador de release: soma 1 a cada deploy. A virada de "major" é automática —
// no máximo 10 releases por major (0 a 9), minor com um dígito só: 4.0 -> 4.1 ... 4.9 -> 5.0 -> 5.1 ...
// (reiniciado na versão 4.0: APP_BUILD 57 = 4.0, ciclo de 10 a partir daqui.)
const VERSAO_BASE_BUILD = 57;   // build que corresponde à versão 4.0
const APP_BUILD = 58;
function computeVersion(b){
  const n = Math.max(0, b - VERSAO_BASE_BUILD);
  return (4 + Math.floor(n / 10)) + '.' + (n % 10);
}
const APP_VERSION = computeVersion(APP_BUILD); // 57 -> "4.0", 58 -> "4.1", 66 -> "4.9", 67 -> "5.0"

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
// RIFAS: ganhador e prêmio da rifa de cada rodada (cadastrado pelo admin, exibido na aba Rifas da Resenha)
try{ db.exec("CREATE TABLE IF NOT EXISTS rifas (rodada_id TEXT PRIMARY KEY, ganhador TEXT NOT NULL DEFAULT '', premio TEXT NOT NULL DEFAULT '', atualizado_em TEXT)"); }catch(e){}
// EVENTO DE FIM DE ANO: participantes com valor e status de pagamento (Pago / Parcial / Pendente)
try{ db.exec("CREATE TABLE IF NOT EXISTS evento_participantes (id TEXT PRIMARY KEY, nome TEXT NOT NULL, valor REAL NOT NULL DEFAULT 250, valor_pago REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pendente', criado_em TEXT NOT NULL)"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN evento_valor_padrao REAL NOT NULL DEFAULT 250"); }catch(e){}
// opções por evento da agenda: exibir a lista de participantes ("Sobre o Evento") e dados para pagamento
try{ db.exec("ALTER TABLE eventos ADD COLUMN mostrar_participantes INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN pgto_ativo INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN pgto_nome TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN pgto_pix TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN pgto_valor TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN so_aba INTEGER NOT NULL DEFAULT 0"); }catch(e){}
try{ db.exec("ALTER TABLE eventos ADD COLUMN ocultar_valores INTEGER NOT NULL DEFAULT 0"); }catch(e){}   // 1 = não mostrar arrecadado / a receber no resumo
try{ db.exec("CREATE TABLE IF NOT EXISTS evento_receitas (id TEXT PRIMARY KEY, evento_id TEXT NOT NULL, origem TEXT NOT NULL, valor REAL NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '', doador TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL)"); }catch(e){}
try{ db.exec("CREATE TABLE IF NOT EXISTS evento_despesas (id TEXT PRIMARY KEY, evento_id TEXT NOT NULL, despesa TEXT NOT NULL, fornecedor TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '', valor REAL NOT NULL DEFAULT 0, criado_em TEXT NOT NULL)"); }catch(e){}   // 1 = exibir só na aba Eventos da Resenha
// acesso marketing: o jogador pode gerir os eventos (agenda, participantes e aba Evento)
try{ db.exec("ALTER TABLE jogadores ADD COLUMN marketing INTEGER NOT NULL DEFAULT 0"); }catch(e){}
// local do evento (endereço) para abrir no Waze / Google Maps / Uber
try{ db.exec("ALTER TABLE eventos ADD COLUMN local TEXT NOT NULL DEFAULT ''"); }catch(e){}
// aba "Evento" da Resenha editável pelo admin
try{ db.exec("ALTER TABLE config ADD COLUMN evento_aba_ativa INTEGER NOT NULL DEFAULT 1"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN evento_aba_titulo TEXT NOT NULL DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN evento_aba_texto TEXT NOT NULL DEFAULT ''"); }catch(e){}
// CONTROLE DE ACESSOS: cada entrada no app (login/abertura) e cada troca de tela de cada jogador
try{ db.exec("CREATE TABLE IF NOT EXISTS acessos (id TEXT PRIMARY KEY, jogador_id TEXT NOT NULL, ts TEXT NOT NULL, tipo TEXT NOT NULL, tela TEXT)"); }catch(e){}
try{ db.exec("CREATE INDEX IF NOT EXISTS idx_acessos_jog_ts ON acessos (jogador_id, ts)"); }catch(e){}
try{ db.exec("ALTER TABLE config ADD COLUMN acessos_zerado_em TEXT"); }catch(e){}   // quando a estatística de acessos foi zerada pela última vez
// TRAMPOS: vagas de emprego que os amigos indicam para o grupo
try{ db.exec("CREATE TABLE IF NOT EXISTS trampos (id TEXT PRIMARY KEY, jogador_id TEXT NOT NULL, titulo TEXT NOT NULL, empresa TEXT NOT NULL DEFAULT '', local TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', contato TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL)"); }catch(e){}
// ordem dos cards da tela inicial (chaves separadas por vírgula; vazio = ordem padrão)
try{ db.exec("ALTER TABLE config ADD COLUMN home_ordem TEXT NOT NULL DEFAULT ''"); }catch(e){}
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
  const rodadas = db.prepare("SELECT id, data FROM rodadas WHERE status='sorteado' ORDER BY data ASC").all();
  const cheia = {}, murcha = {};
  const detalhe = {cheia:{}, murcha:{}};   // por jogador: em quais rodadas (data + média) foi Bola Cheia / Murcha
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
    (detalhe.cheia[entries[0].id] = detalhe.cheia[entries[0].id] || []).push({data:r.data, media:Math.round(entries[0].media*100)/100, n:entries[0].n});
    if(entries.length >= 2){
      const pior = entries[entries.length-1];
      murcha[pior.id] = (murcha[pior.id]||0) + 1;
      (detalhe.murcha[pior.id] = detalhe.murcha[pior.id] || []).push({data:r.data, media:Math.round(pior.media*100)/100, n:pior.n});
    }
  });
  return {cheia, murcha, detalhe};
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
// Eventos (agenda, participantes, aba Evento): Super Admin, admin com a área "conteudo"
// ou jogador ATIVO com a opção "acesso marketing" (usa o token normal do jogador).
function requireEventos(req,res,next){
  const sessao = getSessao(extrairToken(req));
  if(!sessao) return res.status(401).json({erro:'Sessão inválida. Faça login novamente.'});
  if(sessao.jogador_id){
    const a = getJogadorAuth(sessao.jogador_id);
    const j = getJogadorPorId(sessao.jogador_id);
    if(a.superAdmin || (a.admin && a.perms.includes('conteudo')) || (j && j.ativo && j.marketing)){
      req.jogadorId = sessao.jogador_id; return next();
    }
    return res.status(403).json({erro:'Seu acesso não inclui a gestão de eventos.'});
  }
  if(sessao.is_admin){ req.jogadorId = null; return next(); }   // PIN administrativo legado
  return res.status(401).json({erro:'Sessão inválida.'});
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
  registrarAcesso(jogador.id, 'entrada', null);
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
    marketing: !!j.marketing,
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

// Meu Contrato (perfil): todos os campos são opcionais (vazio = limpa o campo).
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
    diasAtraso: diasEmAtraso(j), atrasoDesde: j.atraso_desde || '',
    corneta:!!j.corneta, timeCoracao:j.time_coracao||'',
    deptoMedico:!!j.depto_medico,
    marketing:!!j.marketing,
  }));
  const cfg = getConfig();
  res.json({jogadores, ultimoVencimento: ultimoVencimento(hojeSP()), permsDisponiveis:PERMS_ADMIN, config:{minRodadas:cfg.min_rodadas, minVotos:cfg.min_votos, simuladoNow:cfg.simulado_now, sorteioModo:cfg.sorteio_modo||'manual', sorteioAgendado:cfg.sorteio_agendado||'', mostrarVotos:!!cfg.mostrar_votos}});
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
    // "Sem status" = cadastrado no app, mas ainda não contratado em definitivo: fica FORA dos totais e gráficos
    return {chave:s.chave, label:s.label, contabiliza: s.chave!=='sem_status', qtd:linhas.length, total:linhas.reduce((t,l)=>t+l.valor,0), linhas};
  });
  const contratados = grupos.filter(g=>g.contabiliza);
  const qtdSemStatus = (grupos.find(g=>g.chave==='sem_status')||{qtd:0}).qtd;
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
    qtd: contratados.reduce((t,g)=>t+g.qtd,0),        // só jogadores com status (Em dia, Em atraso, Isento)
    qtdSemStatus,
    totalGeral: contratados.reduce((t,g)=>t+g.total,0),
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
  doc.largura = largura;
  // cor (opcional) = [r,g,b] de 0 a 1
  doc.texto = (x,yy,s,size,bold,align,cor)=>{
    const xx = align==='right' ? x-largura(s,size) : x;
    const pre = cor ? cor[0]+' '+cor[1]+' '+cor[2]+' rg ' : '';
    cur().push('BT '+pre+'/'+(bold?'F2':'F1')+' '+size+' Tf '+xx.toFixed(1)+' '+yy.toFixed(1)+' Td ('+esc(s)+') Tj'+(cor?' 0 g':'')+' ET');
  };
  // fatia de pizza (polígono): ângulos em radianos, a1 < a0 = sentido horário
  doc.fatia = (cx,cy,r,a0,a1,rgb)=>{
    const passos = Math.max(2, Math.ceil(Math.abs(a1-a0)/(Math.PI/36)));
    let op = rgb[0]+' '+rgb[1]+' '+rgb[2]+' rg '+cx.toFixed(1)+' '+cy.toFixed(1)+' m';
    for(let i=0;i<=passos;i++){
      const a = a0 + (a1-a0)*i/passos;
      op += ' '+(cx+r*Math.cos(a)).toFixed(1)+' '+(cy+r*Math.sin(a)).toFixed(1)+' l';
    }
    cur().push(op+' h f 0 g');
  };
  doc.cor = (x,yy,w,h,rgb)=> cur().push(rgb[0]+' '+rgb[1]+' '+rgb[2]+' rg '+x.toFixed(1)+' '+yy.toFixed(1)+' '+w.toFixed(1)+' '+h+' re f 0 g');
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
// cores por status (RGB 0-1) e percentuais
const COR_PDF = {em_dia:[0.25,0.68,0.35], em_atraso:[0.89,0.34,0.30], isenta:[0.31,0.63,1], sem_status:[0.48,0.53,0.60],
  aluguel:[0.80,0.62,0.15], higienizacao:[0.31,0.63,1], carvao:[0.45,0.45,0.50]};
function fmtPct(v, total){ return (total>0 ? v/total*100 : 0).toFixed(1).replace('.',',')+'%'; }
// gráfico de PIZZA com percentuais nas fatias e legenda ao lado
function pizzaPdf(d, titulo, segs){
  const r = 46;
  d.garantir(2*r + 36, null);
  d.texto(d.M, d.y, titulo, 10, true); d.y -= 8;
  const total = segs.reduce((t,x)=>t+x.valor,0);
  if(total<=0){ d.texto(d.M+4, d.y-8, 'Sem dados para exibir.', 9, false); d.y -= 26; return; }
  const cx = d.M + r + 8, cy = d.y - r - 4;
  let ang = Math.PI/2;                                   // começa no topo, sentido horário
  segs.filter(x=>x.valor>0).forEach(sg=>{
    const a = sg.valor/total*2*Math.PI;
    d.fatia(cx, cy, r, ang, ang-a, sg.cor);
    if(sg.valor/total >= 0.08){
      // percentual num selo escuro, texto branco maior (mais destaque)
      const mid = ang - a/2, t = fmtPct(sg.valor,total);
      const px = cx + 0.66*r*Math.cos(mid), py = cy + 0.66*r*Math.sin(mid), tw = d.largura(t,10.5);
      d.cor(px - tw/2 - 3, py - 6.5, tw + 6, 13, [0.04,0.09,0.15]);
      d.texto(px - tw/2, py - 3.4, t, 10.5, true, 'left', [1,1,1]);
    }
    ang -= a;
  });
  const xLeg = d.M + 2*r + 28;
  let ly = cy + (segs.length*14)/2 - 4;
  segs.forEach(sg=>{
    d.cor(xLeg, ly-1, 8, 8, sg.cor);
    d.texto(xLeg+14, ly, sg.label+': '+sg.txt+'  ('+fmtPct(sg.valor,total)+')', 9, false);
    ly -= 14;
  });
  d.y = cy - r - 14;
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
  // sem filtro: só os jogadores com status (os "sem status" não são contabilizados)
  const grupos = filtro ? rel.grupos.filter(g=>g.chave===filtro) : rel.grupos.filter(g=>g.contabiliza);
  cabecalhoPdf(d, rel, 'Financeiro por Mensalidades'+(filtro && grupos[0] ? ' ('+grupos[0].label+')' : ''));
  if(!filtro){
    d.texto(d.M, d.y, 'RESUMO GR\u00C1FICO', 11, true); d.y -= 16;
    pizzaPdf(d, 'Status por craques', rel.grupos.filter(g=>g.contabiliza).map(g=>({label:g.label, valor:g.qtd, cor:COR_PDF[g.chave], txt:g.qtd+' jogador'+(g.qtd===1?'':'es')})));
    pizzaPdf(d, 'Valor por status (R$)', rel.grupos.filter(g=>g.total>0).map(g=>({label:g.label, valor:g.total, cor:COR_PDF[g.chave], txt:fmtBRL(g.total)})));
    pizzaPdf(d, 'Recebido x a receber', [
      {label:'Em dia (recebido)', valor:rel.receitas.recebido, cor:COR_PDF.em_dia, txt:fmtBRL(rel.receitas.recebido)},
      {label:'Em atraso (a receber)', valor:rel.receitas.aReceber, cor:COR_PDF.em_atraso, txt:fmtBRL(rel.receitas.aReceber)},
    ]);
    const prev = rel.receitas.total;
    d.texto(d.M, d.y, 'Recebido (Em dia): '+fmtBRL(rel.receitas.recebido)+'  =  '+fmtPct(rel.receitas.recebido, prev)+' do previsto ('+fmtBRL(prev)+').', 9, true); d.y -= 18;
    d.linha(d.M, d.y+6, d.RIGHT, d.y+6, 0.3); d.y -= 8;
  }
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
    d.texto(d.RIGHT-4, d.y, g.qtd+' jogador'+(g.qtd===1?'':'es')+(g.contabiliza ? '  ('+fmtPct(g.qtd, rel.qtd)+' do elenco)' : '  (n\u00E3o contabilizado)'), 9, false, 'right');
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
    d.texto(d.M+28, d.y-4, 'Subtotal - '+g.label+((g.contabiliza && rel.totalGeral>0) ? '  ('+fmtPct(g.total, rel.totalGeral)+' do total)' : ''), 10, true);
    d.texto(d.RIGHT-4, d.y-4, fmtBRL(g.total), 10, true, 'right');
    d.y -= 28;
  });
  if(!filtro){
    d.garantir(40, null);
    d.faixa(d.y-6, 20, 0.88);
    d.texto(d.M+4, d.y, 'TOTAL GERAL', 11, true);
    d.texto(d.M+160, d.y, rel.qtd+' jogadores contratados', 9, true);
    d.texto(d.RIGHT-4, d.y, fmtBRL(rel.totalGeral), 11, true, 'right');
    d.y -= 24;
  }
  if(!filtro && rel.qtdSemStatus>0){
    d.garantir(20, null);
    d.texto(d.M, d.y, rel.qtdSemStatus+' jogador'+(rel.qtdSemStatus===1?'':'es')+' sem status (cadastrados, ainda n\u00E3o contratados) n\u00E3o entram nos totais e gr\u00E1ficos.', 8, false); d.y -= 14;
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
  d.y -= 4;
  d.texto(d.M, d.y, 'GR\u00C1FICOS', 11, true); d.y -= 16;
  pizzaPdf(d, 'Receitas x Despesas', [
    {label:'Receitas', valor:rel.receitas.total, cor:COR_PDF.em_dia, txt:fmtBRL(rel.receitas.total)},
    {label:'Despesas', valor:rel.despesas, cor:COR_PDF.em_atraso, txt:fmtBRL(rel.despesas)},
  ]);
  d.texto(d.M, d.y, rel.despesas>0 ? 'As receitas cobrem '+fmtPct(rel.receitas.total, rel.despesas)+' das despesas.' : 'Sem despesas informadas.', 9, true); d.y -= 18;
  pizzaPdf(d, 'Composi\u00E7\u00E3o das receitas', [
    {label:'Em dia (recebido)', valor:rel.receitas.recebido, cor:COR_PDF.em_dia, txt:fmtBRL(rel.receitas.recebido)},
    {label:'Em atraso (a receber)', valor:rel.receitas.aReceber, cor:COR_PDF.em_atraso, txt:fmtBRL(rel.receitas.aReceber)},
  ]);
  pizzaPdf(d, 'Composi\u00E7\u00E3o das despesas', [
    {label:'Aluguel da Quadra', valor:rel.custos.aluguel, cor:COR_PDF.aluguel, txt:fmtBRL(rel.custos.aluguel)},
    {label:'Higieniza\u00E7\u00E3o', valor:rel.custos.higienizacao, cor:COR_PDF.higienizacao, txt:fmtBRL(rel.custos.higienizacao)},
    {label:'Carv\u00E3o', valor:rel.custos.carvao, cor:COR_PDF.carvao, txt:fmtBRL(rel.custos.carvao)},
  ]);
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
  enviarPdf(res, gerarPdfRelatorio(rel, filtro), 'financeiro-por-mensalidades-'+rel.referencia+(filtro?'-'+filtro:'')+'.pdf');
});
app.get('/api/admin/fluxo-caixa.pdf', requireAdmin, (req,res)=>{
  const rel = montarRelatorioFinanceiro();
  logEvento('Fluxo de caixa (PDF) gerado pelo administrador — referência '+rel.referencia+'.');
  enviarPdf(res, gerarPdfFluxoCaixa(rel), 'fluxo-de-caixa-'+rel.referencia+'.pdf');
});

/* ============================================================
   EXPORTAÇÃO PARA EXCEL (.xlsx) — escrito à mão, sem dependências
   ============================================================ */
const CRC_TABLE = (()=>{ const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; } return t; })();
function crc32(buf){ let c = 0xFFFFFFFF; for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c>>>8); return (c ^ 0xFFFFFFFF)>>>0; }
// monta um .zip (deflate) a partir de [{nome, dados:Buffer}]
function montarZip(arquivos){
  const zlib = require('zlib');
  const locais = [], centrais = [];
  let offset = 0;
  const dosTime = (12<<11), dosDate = ((2026-1980)<<9) | (1<<5) | 1;
  arquivos.forEach(a=>{
    const nome = Buffer.from(a.nome,'utf8');
    const comp = zlib.deflateRawSync(a.dados);
    const crc = crc32(a.dados);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0x0800,6); lh.writeUInt16LE(8,8);
    lh.writeUInt16LE(dosTime,10); lh.writeUInt16LE(dosDate,12); lh.writeUInt32LE(crc,14);
    lh.writeUInt32LE(comp.length,18); lh.writeUInt32LE(a.dados.length,22); lh.writeUInt16LE(nome.length,26); lh.writeUInt16LE(0,28);
    locais.push(lh, nome, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0x0800,8); ch.writeUInt16LE(8,10);
    ch.writeUInt16LE(dosTime,12); ch.writeUInt16LE(dosDate,14); ch.writeUInt32LE(crc,16);
    ch.writeUInt32LE(comp.length,20); ch.writeUInt32LE(a.dados.length,24); ch.writeUInt16LE(nome.length,28);
    ch.writeUInt16LE(0,30); ch.writeUInt16LE(0,32); ch.writeUInt16LE(0,34); ch.writeUInt16LE(0,36); ch.writeUInt32LE(0,38); ch.writeUInt32LE(offset,42);
    centrais.push(ch, nome);
    offset += lh.length + nome.length + comp.length;
  });
  const cd = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(0,4); eocd.writeUInt16LE(0,6);
  eocd.writeUInt16LE(arquivos.length,8); eocd.writeUInt16LE(arquivos.length,10);
  eocd.writeUInt32LE(cd.length,12); eocd.writeUInt32LE(offset,16); eocd.writeUInt16LE(0,20);
  return Buffer.concat([...locais, cd, eocd]);
}
const xmlEsc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
// estilos: 0 normal | 1 negrito | 2 título | 3 cabeçalho | 4 R$ | 5 R$ negrito | 6 % | 7 % negrito
const XL = {N:0, B:1, T:2, H:3, M:4, MB:5, P:6, PB:7};
function xlsxLetra(i){ let s=''; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); } return s; }
// linhas: array de arrays; célula = valor | {v, s}. Números viram células numéricas (o Excel soma/formata).
function xlsxPlanilha(linhas, larguras){
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  xml += '<cols>'+(larguras||[]).map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols>';
  xml += '<sheetData>';
  linhas.forEach((cels,r)=>{
    xml += '<row r="'+(r+1)+'">';
    (cels||[]).forEach((c,i)=>{
      if(c==null || c==='') return;
      const obj = (typeof c==='object') ? c : {v:c};
      const ref = xlsxLetra(i)+(r+1);
      const st = obj.s ? ' s="'+obj.s+'"' : '';
      if(typeof obj.v==='number' && Number.isFinite(obj.v)) xml += '<c r="'+ref+'"'+st+'><v>'+obj.v+'</v></c>';
      else xml += '<c r="'+ref+'"'+st+' t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(obj.v)+'</t></is></c>';
    });
    xml += '</row>';
  });
  return xml + '</sheetData></worksheet>';
}
function gerarXlsxRelatorio(rel){
  const [ano, mes] = rel.referencia.split('-');
  const g = rel.geradoEm;
  const cab = (titulo)=>[
    [{v:'Bolerage F.D. — '+titulo, s:XL.T}],
    ['Referência', mes+'/'+ano],
    ['Valor da mensalidade (padrão)', rel.valorUnitario==null ? 'não definido' : {v:rel.valorUnitario, s:XL.M}],
    ['Gerado em', g.slice(8,10)+'/'+g.slice(5,7)+'/'+g.slice(0,4)+' '+g.slice(11,16)],
    [],
  ];
  const grupo = k => rel.grupos.find(x=>x.chave===k);
  const pct = (v,t)=> t>0 ? v/t : 0;

  // 1) DRE — Demonstrativo de Resultados (fluxo de caixa)
  const s1 = [...cab('DRE — Demonstrativo de Resultados (Fluxo de Caixa)'),
    [{v:'Item',s:XL.H},{v:'Valor (R$)',s:XL.H}],
    ['Saldo em caixa (conta corrente)', {v:rel.saldoCaixa,s:XL.M}],
    ['Receitas — Em dia (recebido)', {v:rel.receitas.recebido,s:XL.M}],
    ['Receitas — Em atraso (a receber)', {v:rel.receitas.aReceber,s:XL.M}],
    [{v:'Total de receitas',s:XL.B}, {v:rel.receitas.total,s:XL.MB}],
    ['Despesas — Aluguel da Quadra', {v:rel.custos.aluguel,s:XL.M}],
    ['Despesas — Higienização', {v:rel.custos.higienizacao,s:XL.M}],
    ['Despesas — Carvão', {v:rel.custos.carvao,s:XL.M}],
    [{v:'Total de despesas',s:XL.B}, {v:rel.despesas,s:XL.MB}],
    [{v:'Resultado do mês (receitas − despesas)',s:XL.B}, {v:rel.resultadoMes,s:XL.MB}],
    [{v:'SALDO PREVISTO (saldo em caixa + receitas − despesas)',s:XL.B}, {v:rel.saldoPrevisto,s:XL.MB}],
  ];

  // 2) Status por craques (agrupado, com subtotais; "sem status" fora dos totais)
  const s2 = [...cab('Status por Craques'), [{v:'Jogador',s:XL.H},{v:'Status',s:XL.H},{v:'Dias em atraso',s:XL.H},{v:'Valor individual?',s:XL.H},{v:'Valor (R$)',s:XL.H}]];
  rel.grupos.filter(x=>x.contabiliza).forEach(gr=>{
    gr.linhas.forEach(l=> s2.push([l.nome, gr.label, l.diasAtraso==null ? '' : l.diasAtraso, l.valorIndividual!=null ? 'sim' : '', {v:l.valor,s:XL.M}]));
    s2.push([{v:'Subtotal — '+gr.label+' ('+gr.qtd+')',s:XL.B}, '', '', '', {v:gr.total,s:XL.MB}]);
    s2.push([]);
  });
  s2.push([{v:'TOTAL GERAL ('+rel.qtd+' jogadores)',s:XL.B}, '', '', '', {v:rel.totalGeral,s:XL.MB}]);
  if(rel.qtdSemStatus>0) s2.push([rel.qtdSemStatus+' jogador(es) sem status (ainda não contratados) não entram nos totais.']);
  s2.push([]);
  s2.push([{v:'Resumo por status',s:XL.B}]);
  s2.push([{v:'Status',s:XL.H},{v:'Jogadores',s:XL.H},{v:'% do elenco',s:XL.H},{v:'Valor (R$)',s:XL.H},{v:'% do total',s:XL.H}]);
  rel.grupos.filter(x=>x.contabiliza).forEach(gr=> s2.push([gr.label, gr.qtd, {v:pct(gr.qtd,rel.qtd),s:XL.P}, {v:gr.total,s:XL.M}, {v:pct(gr.total,rel.totalGeral),s:XL.P}]));

  // 3) Receitas x Despesas
  const s3 = [...cab('Receitas x Despesas'),
    [{v:'Receitas',s:XL.H},{v:'Valor (R$)',s:XL.H},{v:'% das receitas',s:XL.H}],
    ['Em dia (recebido)', {v:rel.receitas.recebido,s:XL.M}, {v:pct(rel.receitas.recebido,rel.receitas.total),s:XL.P}],
    ['Em atraso (a receber)', {v:rel.receitas.aReceber,s:XL.M}, {v:pct(rel.receitas.aReceber,rel.receitas.total),s:XL.P}],
    [{v:'Total de receitas',s:XL.B}, {v:rel.receitas.total,s:XL.MB}, {v:rel.receitas.total>0?1:0,s:XL.PB}],
    [],
    [{v:'Despesas',s:XL.H},{v:'Valor (R$)',s:XL.H},{v:'% das despesas',s:XL.H}],
    ['Aluguel da Quadra', {v:rel.custos.aluguel,s:XL.M}, {v:pct(rel.custos.aluguel,rel.despesas),s:XL.P}],
    ['Higienização', {v:rel.custos.higienizacao,s:XL.M}, {v:pct(rel.custos.higienizacao,rel.despesas),s:XL.P}],
    ['Carvão', {v:rel.custos.carvao,s:XL.M}, {v:pct(rel.custos.carvao,rel.despesas),s:XL.P}],
    [{v:'Total de despesas',s:XL.B}, {v:rel.despesas,s:XL.MB}, {v:rel.despesas>0?1:0,s:XL.PB}],
    [],
    [{v:'As receitas cobrem (% das despesas)',s:XL.B}, '', {v:rel.despesas>0 ? rel.receitas.total/rel.despesas : 0, s:XL.PB}],
    [{v:'Resultado do mês',s:XL.B}, {v:rel.resultadoMes,s:XL.MB}],
  ];

  // 4) Saldo em caixa
  const s4 = [...cab('Saldo em Caixa'),
    [{v:'Item',s:XL.H},{v:'Valor (R$)',s:XL.H}],
    ['Saldo atual em caixa (conta corrente)', {v:rel.saldoCaixa,s:XL.M}],
    ['Resultado do mês (receitas − despesas)', {v:rel.resultadoMes,s:XL.M}],
    [{v:'SALDO PREVISTO',s:XL.B}, {v:rel.saldoPrevisto,s:XL.MB}],
  ];

  // 5) Custos da quadra
  const s5 = [...cab('Custos da Quadra'),
    [{v:'Custo',s:XL.H},{v:'Valor (R$)',s:XL.H},{v:'% do total',s:XL.H}],
    ['Aluguel da Quadra', {v:rel.custos.aluguel,s:XL.M}, {v:pct(rel.custos.aluguel,rel.despesas),s:XL.P}],
    ['Higienização', {v:rel.custos.higienizacao,s:XL.M}, {v:pct(rel.custos.higienizacao,rel.despesas),s:XL.P}],
    ['Carvão', {v:rel.custos.carvao,s:XL.M}, {v:pct(rel.custos.carvao,rel.despesas),s:XL.P}],
    [{v:'Total de custos',s:XL.B}, {v:rel.despesas,s:XL.MB}],
  ];

  const abas = [
    {nome:'DRE',                    xml:xlsxPlanilha(s1,[52,18])},
    {nome:'Status por Craques',    xml:xlsxPlanilha(s2,[34,16,16,18,16])},
    {nome:'Receitas x Despesas',   xml:xlsxPlanilha(s3,[40,18,16])},
    {nome:'Saldo em Caixa',        xml:xlsxPlanilha(s4,[44,18])},
    {nome:'Custos da Quadra',      xml:xlsxPlanilha(s5,[34,18,14])},
  ];
  return montarXlsx(abas);
}
function montarXlsx(abas){
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const arquivos = [
    {nome:'[Content_Types].xml', dados:Buffer.from(H+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      abas.map((a,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
      '</Types>','utf8')},
    {nome:'_rels/.rels', dados:Buffer.from(H+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','utf8')},
    {nome:'xl/workbook.xml', dados:Buffer.from(H+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+
      abas.map((a,i)=>'<sheet name="'+xmlEsc(a.nome)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>','utf8')},
    {nome:'xl/_rels/workbook.xml.rels', dados:Buffer.from(H+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      abas.map((a,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
      '<Relationship Id="rId'+(abas.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>','utf8')},
    {nome:'xl/styles.xml', dados:Buffer.from(H+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>'+
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'+
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="8">'+
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'+
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'+
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'+
        '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'+
      '</cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>','utf8')},
    ...abas.map((a,i)=>({nome:'xl/worksheets/sheet'+(i+1)+'.xml', dados:Buffer.from(a.xml,'utf8')})),
  ];
  return montarZip(arquivos);
}
app.get('/api/admin/relatorio-financeiro.xlsx', requireAdmin, (req,res)=>{
  const rel = montarRelatorioFinanceiro();
  logEvento('Relatórios financeiros exportados para Excel pelo administrador — referência '+rel.referencia+'.');
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="relatorios-financeiros-'+rel.referencia+'.xlsx"');
  res.send(gerarXlsxRelatorio(rel));
});

/* ============================================================
   DRE DO EVENTO (despesas + receitas dos participantes) — JSON, PDF e Excel
   ============================================================ */
function despesasDoEvento(id){
  return db.prepare("SELECT id,despesa,fornecedor,data,valor FROM evento_despesas WHERE evento_id=? ORDER BY CASE WHEN data='' THEN 1 ELSE 0 END, data ASC, criado_em ASC").all(id)
    .map(x=>({id:x.id, despesa:x.despesa, fornecedor:x.fornecedor||'', data:x.data||'', valor:x.valor}));
}
function validarDespesas(arr){
  if(!Array.isArray(arr)) return {lista:null};
  if(arr.length>300) return {erro:'Lista de despesas grande demais.'};
  const lista = [];
  for(const it of arr){
    const despesa = String((it && it.despesa) || '').trim().slice(0,80);
    if(despesa.length<2) return {erro:'Informe o nome da despesa.'};
    const fornecedor = String((it && it.fornecedor) || '').trim().slice(0,80);
    const data = String((it && it.data) || '').trim();
    if(data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return {erro:'Data inválida na despesa "'+despesa+'".'};
    const v = parseValorBR(it && it.valor);
    if(v==null || v<0 || v>100000000) return {erro:'Valor inválido na despesa "'+despesa+'".'};
    lista.push({despesa, fornecedor, data, valor:Math.round(v*100)/100});
  }
  return {lista};
}
function gravarDespesas(evId, lista){
  db.prepare('DELETE FROM evento_despesas WHERE evento_id=?').run(evId);
  lista.forEach(x=>db.prepare('INSERT INTO evento_despesas (id,evento_id,despesa,fornecedor,data,valor,criado_em) VALUES (?,?,?,?,?,?,?)').run(idGen('ed'), evId, x.despesa, x.fornecedor, x.data, x.valor, nowISO()));
}
// ---- Outras receitas do evento (origem, valor, data, doador): somam no DRE e nos gráficos
function receitasDoEvento(id){
  return db.prepare("SELECT id,origem,valor,data,doador FROM evento_receitas WHERE evento_id=? ORDER BY CASE WHEN data='' THEN 1 ELSE 0 END, data ASC, criado_em ASC").all(id)
    .map(x=>({id:x.id, origem:x.origem, valor:x.valor, data:x.data||'', doador:x.doador||''}));
}
function validarReceitas(arr){
  if(!Array.isArray(arr)) return {lista:null};
  if(arr.length>300) return {erro:'Lista de receitas grande demais.'};
  const lista = [];
  for(const it of arr){
    const origem = String((it && it.origem) || '').trim().slice(0,80);
    if(origem.length<2) return {erro:'Informe a origem da receita.'};
    const doador = String((it && it.doador) || '').trim().slice(0,80);
    const data = String((it && it.data) || '').trim();
    if(data && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data)) return {erro:'Data inválida na receita "'+origem+'".'};
    const v = parseValorBR(it && it.valor);
    if(v==null || v<0 || v>100000000) return {erro:'Valor inválido na receita "'+origem+'".'};
    lista.push({origem, doador, data, valor:Math.round(v*100)/100});
  }
  return {lista};
}
function gravarReceitas(evId, lista){
  db.prepare('DELETE FROM evento_receitas WHERE evento_id=?').run(evId);
  lista.forEach(x=>db.prepare('INSERT INTO evento_receitas (id,evento_id,origem,valor,data,doador,criado_em) VALUES (?,?,?,?,?,?,?)').run(idGen('er'), evId, x.origem, x.valor, x.data, x.doador, nowISO()));
}
const r2 = n => Math.round((Number(n)||0)*100)/100;
function montarDreEvento(ev){
  const lista = ev.mostrar_participantes ? montarEventoLista().participantes : [];
  const por = {pago:{qtd:0,valor:0,recebido:0}, parcial:{qtd:0,valor:0,recebido:0}, pendente:{qtd:0,valor:0,recebido:0}};
  lista.forEach(p=>{ const g = por[p.status] || por.pendente; g.qtd++; g.valor += p.valor; g.recebido += p.valorPago; });
  Object.keys(por).forEach(k=>{ por[k].valor = r2(por[k].valor); por[k].recebido = r2(por[k].recebido); });
  const previsto = r2(lista.reduce((t,p)=>t+p.valor,0));
  const recebido = r2(lista.reduce((t,p)=>t+p.valorPago,0));
  const itens = despesasDoEvento(ev.id);
  const totalDesp = r2(itens.reduce((t,x)=>t+x.valor,0));
  const itensRec = receitasDoEvento(ev.id);
  const totalOutras = r2(itensRec.reduce((t,x)=>t+x.valor,0));
  return {
    evento:{id:ev.id, nome:ev.nome, data:ev.data, responsavel:ev.responsavel||'', local:ev.local||''},
    geradoEm: spWallClockNow(),
    qtd: lista.length,
    receitas:{previsto, recebido, aReceber:r2(Math.max(0, previsto-recebido)), porStatus:por, outras:{itens:itensRec, total:totalOutras}, total:r2(previsto+totalOutras)},
    despesas:{itens, total:totalDesp},
    saldoCaixa: r2(recebido+totalOutras-totalDesp),          // recebido dos participantes + outras receitas - despesas
    resultadoPrevisto: r2(previsto+totalOutras-totalDesp),   // total previsto de receitas - despesas
  };
}
// quem pode ver/exportar o DRE: gestão de eventos (super, admin com conteúdo, marketing) ou o GESTOR do próprio evento
function dreEventoAcesso(req, res){
  const sessao = getSessao(extrairToken(req));
  if(!sessao){ res.status(401).json({erro:'Sessão inválida. Faça login novamente.'}); return null; }
  const ev = db.prepare('SELECT * FROM eventos WHERE id=?').get(req.params.id);
  if(!ev){ res.status(404).json({erro:'Evento não encontrado.'}); return null; }
  let ok = false;
  if(sessao.jogador_id){
    const a = getJogadorAuth(sessao.jogador_id), j = getJogadorPorId(sessao.jogador_id);
    ok = a.superAdmin || (a.admin && a.perms.includes('conteudo')) || !!(j && j.ativo && j.marketing) || !!(j && j.ativo && ev.responsavel && j.nome===ev.responsavel);
  }else ok = !!sessao.is_admin;
  if(!ok){ res.status(403).json({erro:'Só o gestor do evento ou a gestão de eventos acessa o DRE.'}); return null; }
  return ev;
}
const semEmoji = s => String(s==null?'':s).replace(/[^\x20-\xFF]/g,'').replace(/\s+/g,' ').trim();
const dataBRs = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')) ? s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4) : '';
const slugArq = s => (semEmoji(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'evento');
const COR_PDF_EV = {pago:[0.25,0.68,0.35], parcial:[0.94,0.56,0.18], pendente:[0.89,0.34,0.30]};
function gerarPdfDreEvento(dre){
  const d = novoPdf();
  const gestor = semEmoji(dre.evento.responsavel);
  d.texto(d.M, d.y, 'Bolerage F.D.', 18, true); d.y -= 20;
  d.texto(d.M, d.y, 'DRE do Evento - Demonstrativo de Resultados', 13, true); d.y -= 18;
  d.texto(d.M, d.y, semEmoji(dre.evento.nome), 11, true); d.y -= 14;
  d.texto(d.M, d.y, 'Data do evento: '+dataBRs(dre.evento.data)+(gestor ? '     Gestor: '+gestor : ''), 10, false); d.y -= 14;
  d.texto(d.M, d.y, 'Gerado em '+dataHoraBR(dre.geradoEm)+' (horário de São Paulo)', 9, false); d.y -= 8;
  d.linha(d.M, d.y, d.RIGHT, d.y, 0.5); d.y -= 18;
  const secao = t=>{ d.garantir(40, null); d.faixa(d.y-5, 18, 0.80); d.texto(d.M+4, d.y, t, 11, true); d.y -= 22; };
  const item = (rot, val, neg)=>{ d.garantir(20, null); d.texto(d.M+10, d.y, rot, 10, !!neg); d.texto(d.RIGHT-4, d.y, fmtBRL(val), 10, !!neg, 'right'); d.y -= 16; };
  const r = dre.receitas, ps = r.porStatus;
  secao('RECEITAS');
  item('Pago Total ('+ps.pago.qtd+') - recebido', ps.pago.recebido);
  item('Pago Parcial ('+ps.parcial.qtd+') - recebido', ps.parcial.recebido);
  item('A receber (saldo dos parciais + pendentes '+ps.pendente.qtd+')', r.aReceber);
  d.linha(d.M, d.y+11, d.RIGHT, d.y+11, 0.4);
  item('Participantes (previsto) - '+dre.qtd+' participante'+(dre.qtd===1?'':'s'), r.previsto, true);
  d.y -= 4;
  d.garantir(40, null);
  d.texto(d.M+4, d.y, 'Outras receitas', 10, true); d.y -= 16;
  const cabR = ()=>{ d.faixa(d.y-4, 16, 0.92); d.texto(d.M+4, d.y, 'Origem', 9, true); d.texto(215, d.y, 'Doador', 9, true); d.texto(395, d.y, 'Data', 9, true); d.texto(d.RIGHT-4, d.y, 'Valor', 9, true, 'right'); d.y -= 18; };
  if(r.outras.itens.length){
    cabR();
    r.outras.itens.forEach((x,i)=>{
      d.garantir(18, ()=>{ d.texto(d.M, d.y, 'Outras receitas (continuação)', 10, true); d.y -= 16; cabR(); });
      if(i%2===1) d.faixa(d.y-4, 15, 0.96);
      d.texto(d.M+4, d.y, semEmoji(x.origem).slice(0,28), 10, false);
      d.texto(215, d.y, semEmoji(x.doador).slice(0,30), 10, false);
      d.texto(395, d.y, dataBRs(x.data), 10, false);
      d.texto(d.RIGHT-4, d.y, fmtBRL(x.valor), 10, false, 'right');
      d.y -= 15;
    });
  }else{ d.texto(d.M+10, d.y, 'Nenhuma outra receita cadastrada.', 9, false); d.y -= 16; }
  item('Total de outras receitas', r.outras.total, true);
  d.linha(d.M, d.y+11, d.RIGHT, d.y+11, 0.4);
  item('TOTAL DE RECEITAS (participantes + outras)', r.total, true);
  d.y -= 10;
  secao('DESPESAS (do evento)');
  const cab = ()=>{ d.faixa(d.y-4, 16, 0.92); d.texto(d.M+4, d.y, 'Despesa', 9, true); d.texto(215, d.y, 'Fornecedor', 9, true); d.texto(395, d.y, 'Data', 9, true); d.texto(d.RIGHT-4, d.y, 'Valor', 9, true, 'right'); d.y -= 18; };
  if(dre.despesas.itens.length){
    cab();
    dre.despesas.itens.forEach((x,i)=>{
      d.garantir(18, ()=>{ d.texto(d.M, d.y, 'Despesas (continuação)', 10, true); d.y -= 16; cab(); });
      if(i%2===1) d.faixa(d.y-4, 15, 0.96);
      d.texto(d.M+4, d.y, semEmoji(x.despesa).slice(0,28), 10, false);
      d.texto(215, d.y, semEmoji(x.fornecedor).slice(0,30), 10, false);
      d.texto(395, d.y, dataBRs(x.data), 10, false);
      d.texto(d.RIGHT-4, d.y, fmtBRL(x.valor), 10, false, 'right');
      d.y -= 15;
    });
  }else{ d.texto(d.M+10, d.y, 'Nenhuma despesa cadastrada.', 9, false); d.y -= 16; }
  d.linha(d.M, d.y+11, d.RIGHT, d.y+11, 0.4);
  item('Total de despesas', dre.despesas.total, true);
  d.y -= 10;
  secao('SALDO EM CAIXA (recebido + outras receitas - despesas)');
  item('Saldo em caixa do evento', dre.saldoCaixa, true);
  d.y -= 6;
  d.garantir(50, null);
  d.faixa(d.y-10, 30, dre.resultadoPrevisto<0 ? 0.85 : 0.88);
  d.texto(d.M+8, d.y, 'SALDO PREVISTO', 12, true);
  d.texto(d.RIGHT-8, d.y, fmtBRL(dre.resultadoPrevisto), 14, true, 'right');
  d.y -= 40;
  d.texto(d.M, d.y, 'GR\u00C1FICOS', 11, true); d.y -= 16;
  pizzaPdf(d, 'Composicao das receitas (R$)', [
    {label:'Pago Total', valor:ps.pago.valor, cor:COR_PDF_EV.pago, txt:fmtBRL(ps.pago.valor)},
    {label:'Pago Parcial', valor:ps.parcial.valor, cor:COR_PDF_EV.parcial, txt:fmtBRL(ps.parcial.valor)},
    {label:'Pendente', valor:ps.pendente.valor, cor:COR_PDF_EV.pendente, txt:fmtBRL(ps.pendente.valor)},
    {label:'Outras receitas', valor:r.outras.total, cor:[0.31,0.63,1], txt:fmtBRL(r.outras.total)},
  ]);
  pizzaPdf(d, 'Receitas x Despesas', [
    {label:'Receitas (participantes + outras)', valor:r.total, cor:COR_PDF.em_dia, txt:fmtBRL(r.total)},
    {label:'Despesas', valor:dre.despesas.total, cor:COR_PDF.em_atraso, txt:fmtBRL(dre.despesas.total)},
  ]);
  d.texto(d.M, d.y, 'Saldo em caixa = recebido dos participantes + outras receitas - despesas. Saldo previsto = receitas previstas (participantes + outras) - despesas.', 8, false);
  return d.build();
}
function gerarXlsxDreEvento(dre){
  const g = dre.geradoEm, r = dre.receitas, ps = r.porStatus;
  const cab = t=>[
    [{v:'Bolerage F.D. — '+t, s:XL.T}],
    ['Evento', String(dre.evento.nome)],
    ['Data do evento', dataBRs(dre.evento.data)],
    ['Gestor', dre.evento.responsavel||''],
    ['Gerado em', g.slice(8,10)+'/'+g.slice(5,7)+'/'+g.slice(0,4)+' '+g.slice(11,16)],
    [],
  ];
  const s1 = [...cab('DRE do Evento — Demonstrativo de Resultados'),
    [{v:'Item',s:XL.H},{v:'Valor (R$)',s:XL.H}],
    ['Receitas — Pago Total ('+ps.pago.qtd+') recebido', {v:ps.pago.recebido,s:XL.M}],
    ['Receitas — Pago Parcial ('+ps.parcial.qtd+') recebido', {v:ps.parcial.recebido,s:XL.M}],
    ['Receitas — A receber (saldo dos parciais + pendentes)', {v:r.aReceber,s:XL.M}],
    ['Receitas — Outras receitas ('+r.outras.itens.length+')', {v:r.outras.total,s:XL.M}],
    [{v:'Total de receitas (participantes previsto + outras)',s:XL.B}, {v:r.total,s:XL.MB}],
    [{v:'Total de despesas',s:XL.B}, {v:dre.despesas.total,s:XL.MB}],
    [{v:'SALDO EM CAIXA (recebido + outras receitas − despesas)',s:XL.B}, {v:dre.saldoCaixa,s:XL.MB}],
    [{v:'SALDO PREVISTO (receitas previstas − despesas)',s:XL.B}, {v:dre.resultadoPrevisto,s:XL.MB}],
    [],
    [{v:'Composição das receitas',s:XL.B}],
    [{v:'Origem',s:XL.H},{v:'Quantidade',s:XL.H},{v:'Valor (R$)',s:XL.H},{v:'% do total',s:XL.H}],
    ['Pago Total', ps.pago.qtd, {v:ps.pago.valor,s:XL.M}, {v:r.total>0?ps.pago.valor/r.total:0,s:XL.P}],
    ['Pago Parcial', ps.parcial.qtd, {v:ps.parcial.valor,s:XL.M}, {v:r.total>0?ps.parcial.valor/r.total:0,s:XL.P}],
    ['Pendente', ps.pendente.qtd, {v:ps.pendente.valor,s:XL.M}, {v:r.total>0?ps.pendente.valor/r.total:0,s:XL.P}],
    ['Outras receitas', r.outras.itens.length, {v:r.outras.total,s:XL.M}, {v:r.total>0?r.outras.total/r.total:0,s:XL.P}],
  ];
  const s4 = [...cab('Outras Receitas do Evento'),
    [{v:'Origem da receita',s:XL.H},{v:'Doador',s:XL.H},{v:'Data',s:XL.H},{v:'Valor (R$)',s:XL.H}],
    ...r.outras.itens.map(x=>[x.origem, x.doador, dataBRs(x.data), {v:x.valor,s:XL.M}]),
    [{v:'Total de outras receitas',s:XL.B}, '', '', {v:r.outras.total,s:XL.MB}],
  ];
  const s2 = [...cab('Despesas do Evento'),
    [{v:'Despesa',s:XL.H},{v:'Fornecedor',s:XL.H},{v:'Data',s:XL.H},{v:'Valor (R$)',s:XL.H}],
    ...dre.despesas.itens.map(x=>[x.despesa, x.fornecedor, dataBRs(x.data), {v:x.valor,s:XL.M}]),
    [{v:'Total de despesas',s:XL.B}, '', '', {v:dre.despesas.total,s:XL.MB}],
  ];
  const lista = dre.evento && db.prepare('SELECT mostrar_participantes FROM eventos WHERE id=?').get(dre.evento.id);
  const parts = (lista && lista.mostrar_participantes) ? montarEventoLista().participantes : [];
  const rot = {pago:'Pago Total', parcial:'Pago Parcial', pendente:'Pendente'};
  const s3 = [...cab('Participantes do Evento'),
    [{v:'Participante',s:XL.H},{v:'Status',s:XL.H},{v:'Valor (R$)',s:XL.H},{v:'Valor pago (R$)',s:XL.H}],
    ...parts.map(p=>[p.nome, rot[p.status]||p.status, {v:p.valor,s:XL.M}, {v:p.valorPago,s:XL.M}]),
    [{v:'Total ('+parts.length+')',s:XL.B}, '', {v:r.previsto,s:XL.MB}, {v:r.recebido,s:XL.MB}],
  ];
  return montarXlsx([
    {nome:'DRE', xml:xlsxPlanilha(s1,[52,16,18,14])},
    {nome:'Outras Receitas', xml:xlsxPlanilha(s4,[34,30,14,18])},
    {nome:'Despesas', xml:xlsxPlanilha(s2,[34,30,14,18])},
    {nome:'Participantes', xml:xlsxPlanilha(s3,[40,16,16,18])},
  ]);
}
app.get('/api/evento-dre/:id', (req,res)=>{ const ev = dreEventoAcesso(req,res); if(!ev) return; res.json(montarDreEvento(ev)); });
app.get('/api/evento-dre/:id/pdf', (req,res)=>{
  const ev = dreEventoAcesso(req,res); if(!ev) return;
  logEvento('DRE do evento "'+ev.nome+'" exportado em PDF.');
  enviarPdf(res, gerarPdfDreEvento(montarDreEvento(ev)), 'dre-evento-'+slugArq(ev.nome)+'.pdf');
});
app.get('/api/evento-dre/:id/xlsx', (req,res)=>{
  const ev = dreEventoAcesso(req,res); if(!ev) return;
  logEvento('DRE do evento "'+ev.nome+'" exportado em Excel.');
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="dre-evento-'+slugArq(ev.nome)+'.xlsx"');
  res.send(gerarXlsxDreEvento(montarDreEvento(ev)));
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
  const marketing = req.body.marketing!=null ? (req.body.marketing?1:0) : (j.marketing||0);
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
  db.prepare('UPDATE jogadores SET nome=?,pin=?,posicao_padrao=?,ativo=?,admin=?,admin_perms=?,telefone=?,corneta=?,time_coracao=?,depto_medico=?,valor_mensalidade=?,marketing=? WHERE id=?')
    .run(nome,pin,posicaoPadrao,ativo,admin,adminPerms,telefone,corneta,timeCoracao,deptoMedico,valorMens,marketing,j.id);
  aplicarMensalidade(j.id, mensalidade);
  // início do atraso (só para quem está EM ATRASO)
  if(mensalidade==='em_atraso' && req.body.atrasoDesde){
    const d = String(req.body.atrasoDesde).trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({erro:'Data de início do atraso inválida.'});
    if(d > hojeSP()) return res.status(400).json({erro:'A data de início do atraso não pode ser futura.'});
    db.prepare('UPDATE jogadores SET atraso_desde=? WHERE id=?').run(d, j.id);
  }
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
// Votos dos Jogadores > filtro por jogador: as notas que o jogador LOGADO recebeu de um votante específico, rodada a rodada.
// Só funciona com a aba "Votos dos Jogadores" habilitada pelo admin (mesma regra de privacidade da aba).
app.get('/api/votos-recebidos', requireAuth, (req,res)=>{
  if(!getConfig().mostrar_votos) return res.status(403).json({erro:'A consulta de votos não está habilitada.'});
  const de = String(req.query.de||'');
  if(!getJogadorPorId(de)) return res.status(404).json({erro:'Jogador não encontrado.'});
  if(de===req.jogadorId) return res.status(400).json({erro:'Escolha outro jogador.'});
  const votos = db.prepare("SELECT r.data AS data, v.nota AS nota FROM votos v JOIN rodadas r ON r.id=v.rodada_id WHERE v.jogador_avaliado_id=? AND v.jogador_avaliador_id=? AND r.status='sorteado' ORDER BY r.data DESC").all(req.jogadorId, de);
  const geral = db.prepare("SELECT AVG(v.nota) AS m, COUNT(*) AS n FROM votos v JOIN rodadas r ON r.id=v.rodada_id WHERE v.jogador_avaliado_id=? AND r.status='sorteado'").get(req.jogadorId);
  const distribuicao = {1:0,2:0,3:0,4:0,5:0};
  votos.forEach(v=>{ distribuicao[v.nota] = (distribuicao[v.nota]||0) + 1; });
  const soma = votos.reduce((t,v)=>t+v.nota,0);
  res.json({de:{id:de}, votos:votos.map(v=>({data:v.data, nota:v.nota})), total:votos.length,
    media: votos.length ? Math.round(soma/votos.length*100)/100 : null, distribuicao,
    mediaGeral: (geral && geral.n) ? Math.round(geral.m*100)/100 : null, totalGeral: geral ? geral.n : 0});
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

/* ---- EVENTO DE FIM DE ANO (participantes) ---- */
const STATUS_EVENTO = ['pago','parcial','pendente'];
function montarEventoLista(){
  const cfg = getConfig() || {};
  const linhas = db.prepare('SELECT * FROM evento_participantes ORDER BY nome COLLATE NOCASE ASC').all();
  const participantes = linhas.map(p=>({
    id:p.id, nome:p.nome, valor:p.valor, status:p.status,
    valorPago: p.status==='pago' ? p.valor : (p.status==='pendente' ? 0 : Math.min(p.valor_pago, p.valor)),
  }));
  const previsto = participantes.reduce((t,p)=>t+p.valor,0);
  const arrecadado = participantes.reduce((t,p)=>t+p.valorPago,0);
  const ev = db.prepare('SELECT nome, data FROM eventos WHERE mostrar_participantes=1 AND ativo=1 LIMIT 1').get();
  return {
    valorPadrao: Number(cfg.evento_valor_padrao)||250,
    eventoNome: ev ? ev.nome : '', eventoData: ev ? ev.data : '',
    participantes, aba: abaEvento(),
    totais: {qtd:participantes.length, previsto, arrecadado, aReceber: Math.max(0, previsto-arrecadado),
      pctPago: previsto>0 ? Math.round(arrecadado/previsto*1000)/10 : 0,
      pagos: participantes.filter(p=>p.status==='pago').length, parciais: participantes.filter(p=>p.status==='parcial').length, pendentes: participantes.filter(p=>p.status==='pendente').length},
  };
}
function lerParticipante(b, atual){
  const nome = String(b.nome==null ? (atual?atual.nome:'') : b.nome).trim().slice(0,80);
  if(nome.length<2) return {erro:'Informe o nome do participante.'};
  let valor = atual ? atual.valor : (Number(getConfig().evento_valor_padrao)||250);
  if(b.valor!==undefined && String(b.valor).trim()!==''){
    const v = parseValorBR(b.valor);
    if(v==null || v<0 || v>100000) return {erro:'Valor inválido.'};
    valor = Math.round(v*100)/100;
  }
  const status = b.status===undefined ? (atual?atual.status:'pendente') : String(b.status);
  if(!STATUS_EVENTO.includes(status)) return {erro:'Status inválido (use Pago Total, Pago Parcial ou Pendente).'};
  let pago = atual ? atual.valor_pago : 0;
  if(b.valorPago!==undefined && String(b.valorPago).trim()!==''){
    const v = parseValorBR(b.valorPago);
    if(v==null || v<0 || v>100000) return {erro:'Valor pago inválido.'};
    pago = Math.round(v*100)/100;
  }
  if(status==='pago') pago = valor;
  else if(status==='pendente') pago = 0;
  else if(pago>=valor) return {erro:'No status Pago Parcial o valor pago precisa ser menor que o valor total.'};
  return {nome, valor, status, pago};
}
// valida a lista inteira de participantes enviada junto com o evento (substitui a lista atual)
function validarParticipantes(arr){
  if(!Array.isArray(arr)) return {lista:null};
  if(arr.length>300) return {erro:'Lista de participantes grande demais.'};
  const vistos = new Set(), lista = [];
  for(const it of arr){
    const r = lerParticipante(it||{}, null);
    if(r.erro) return {erro:((it && it.nome) ? String(it.nome).trim()+': ' : '')+r.erro};
    const k = r.nome.toLowerCase();
    if(vistos.has(k)) return {erro:'Participante repetido: '+r.nome};
    vistos.add(k); lista.push(r);
  }
  return {lista};
}
function gravarParticipantes(lista){
  db.prepare('DELETE FROM evento_participantes').run();
  lista.forEach(r=>db.prepare('INSERT INTO evento_participantes (id,nome,valor,valor_pago,status,criado_em) VALUES (?,?,?,?,?,?)').run(idGen('ep'), r.nome, r.valor, r.pago, r.status, nowISO()));
}
function abaEvento(){
  const cfg = getConfig() || {};
  return {ativa: cfg.evento_aba_ativa!==0, titulo: cfg.evento_aba_titulo||'', texto: cfg.evento_aba_texto||''};
}
app.put('/api/admin/evento-aba', requireEventos, (req,res)=>{
  const b = req.body || {};
  db.prepare('UPDATE config SET evento_aba_ativa=?, evento_aba_titulo=?, evento_aba_texto=? WHERE id=1')
    .run(b.ativa===false ? 0 : 1, String(b.titulo||'').trim().slice(0,80), String(b.texto||'').trim().slice(0,500));
  logEvento('Aba Evento da Resenha atualizada.');
  res.json({ok:true});
});
// lista visível para qualquer jogador logado (aba Evento da Resenha)
app.get('/api/evento', requireAuth, (req,res)=>{ res.json(montarEventoLista()); });
app.post('/api/admin/evento-participantes', requireEventos, (req,res)=>{
  const r = lerParticipante(req.body||{}, null);
  if(r.erro) return res.status(400).json({erro:r.erro});
  if(db.prepare('SELECT 1 FROM evento_participantes WHERE lower(nome)=lower(?)').get(r.nome)) return res.status(409).json({erro:'Esse participante já está na lista.'});
  db.prepare('INSERT INTO evento_participantes (id,nome,valor,valor_pago,status,criado_em) VALUES (?,?,?,?,?,?)').run(idGen('ep'), r.nome, r.valor, r.pago, r.status, nowISO());
  res.json({ok:true});
});
app.put('/api/admin/evento-participantes/:id', requireEventos, (req,res)=>{
  const p = db.prepare('SELECT * FROM evento_participantes WHERE id=?').get(req.params.id);
  if(!p) return res.status(404).json({erro:'Participante não encontrado.'});
  const r = lerParticipante(req.body||{}, p);
  if(r.erro) return res.status(400).json({erro:r.erro});
  const dup = db.prepare('SELECT id FROM evento_participantes WHERE lower(nome)=lower(?) AND id<>?').get(r.nome, p.id);
  if(dup) return res.status(409).json({erro:'Já existe outro participante com esse nome.'});
  db.prepare('UPDATE evento_participantes SET nome=?, valor=?, valor_pago=?, status=? WHERE id=?').run(r.nome, r.valor, r.pago, r.status, p.id);
  res.json({ok:true});
});
app.delete('/api/admin/evento-participantes/:id', requireEventos, (req,res)=>{
  db.prepare('DELETE FROM evento_participantes WHERE id=?').run(req.params.id);
  res.json({ok:true});
});
// adiciona todos os jogadores ativos que ainda não estão na lista (valor padrão, status Pendente)
app.post('/api/admin/evento-participantes-todos', requireEventos, (req,res)=>{
  const valor = Number(getConfig().evento_valor_padrao)||250;
  const ja = new Set(db.prepare('SELECT lower(nome) n FROM evento_participantes').all().map(r=>r.n));
  let n = 0;
  getJogadores().filter(j=>j.ativo).forEach(j=>{
    if(ja.has(j.nome.toLowerCase())) return;
    db.prepare('INSERT INTO evento_participantes (id,nome,valor,valor_pago,status,criado_em) VALUES (?,?,?,?,?,?)').run(idGen('ep'), j.nome, valor, 0, 'pendente', nowISO()); n++;
  });
  logEvento('Evento de fim de ano: '+n+' jogador(es) adicionados à lista de participantes.');
  res.json({ok:true, adicionados:n});
});
app.put('/api/admin/evento-valor-padrao', requireEventos, (req,res)=>{
  const v = parseValorBR((req.body||{}).valor);
  if(v==null || v<0 || v>100000) return res.status(400).json({erro:'Valor inválido.'});
  db.prepare('UPDATE config SET evento_valor_padrao=? WHERE id=1').run(Math.round(v*100)/100);
  res.json({ok:true});
});

/* ---- rifas ---- */
// últimas rifas com ganhador cadastrado (mais recente primeiro) — tela Resenha > Rifas
app.get('/api/rifas', (req,res)=>{
  const rifas = db.prepare("SELECT r.id AS rodadaId, r.data AS data, f.ganhador AS ganhador, f.premio AS premio FROM rifas f JOIN rodadas r ON r.id=f.rodada_id WHERE f.ganhador<>'' ORDER BY r.data DESC LIMIT 12").all();
  res.json({rifas});
});
// todas as rifas cadastradas (admin) — para editar/remover por data
app.get('/api/admin/rifas', requirePerm('conteudo'), (req,res)=>{
  const rifas = db.prepare("SELECT r.id AS rodadaId, r.data AS data, f.ganhador AS ganhador, f.premio AS premio FROM rifas f JOIN rodadas r ON r.id=f.rodada_id ORDER BY r.data DESC").all();
  res.json({rifas});
});
// cadastra/atualiza (ou limpa, se ganhador e prêmio vierem vazios) a rifa de uma rodada
app.put('/api/admin/rifas', requirePerm('conteudo'), (req,res)=>{
  const rodada = getRodadaPorId(String((req.body||{}).rodadaId||''));
  if(!rodada) return res.status(404).json({erro:'Rodada não encontrada.'});
  const ganhador = String((req.body||{}).ganhador||'').trim().slice(0,60);
  const premio = String((req.body||{}).premio||'').trim().slice(0,120);
  if(!ganhador && !premio){
    db.prepare('DELETE FROM rifas WHERE rodada_id=?').run(rodada.id);
    logEvento('Rifa da rodada de '+rodada.data+' removida.');
    return res.json({ok:true, removida:true});
  }
  if(!ganhador) return res.status(400).json({erro:'Informe o nome do ganhador.'});
  db.prepare('INSERT INTO rifas (rodada_id, ganhador, premio, atualizado_em) VALUES (?,?,?,?) ON CONFLICT(rodada_id) DO UPDATE SET ganhador=excluded.ganhador, premio=excluded.premio, atualizado_em=excluded.atualizado_em')
    .run(rodada.id, ganhador, premio, nowISO());
  logEvento('Rifa da rodada de '+rodada.data+': ganhador "'+ganhador+'"'+(premio?', prêmio "'+premio+'"':'')+'.');
  res.json({ok:true});
});

/* ---- CONTROLE DE ACESSOS ---- */
const TELAS_ACESSO = ['inicio','sorteio','votacao','resenha','ranking','trocarPin','admin'];
const NOMES_TELAS = {inicio:'Início', sorteio:'Sorteio', votacao:'Votação', resenha:'Resenha', ranking:'Ranking', trocarPin:'Meu Contrato', admin:'Admin'};
// 'entrada' (PIN) e 'abertura' (app aberto com a sessão ativa) contam como UMA visita se vierem em menos de 20 min
function registrarAcesso(jogadorId, tipo, tela){
  try{
    if(tipo==='entrada' || tipo==='abertura'){
      const ult = db.prepare("SELECT ts FROM acessos WHERE jogador_id=? AND tipo IN ('entrada','abertura') ORDER BY ts DESC LIMIT 1").get(jogadorId);
      if(ult && (Date.now() - Date.parse(ult.ts)) < 20*60*1000) return;
    }
    db.prepare('INSERT INTO acessos (id, jogador_id, ts, tipo, tela) VALUES (?,?,?,?,?)').run(idGen('ac'), jogadorId, nowISO(), tipo, tela||null);
  }catch(e){ console.error('Erro ao registrar acesso:', e); }
}
app.post('/api/acesso', requireAuth, (req,res)=>{
  const tipo = String((req.body||{}).tipo||'');
  const tela = String((req.body||{}).tela||'');
  if(tipo==='abertura') registrarAcesso(req.jogadorId, 'abertura', null);
  else if(tipo==='tela' && TELAS_ACESSO.includes(tela)) registrarAcesso(req.jogadorId, 'tela', tela);
  else return res.status(400).json({erro:'Registro de acesso inválido.'});
  res.json({ok:true});
});
const FMT_SP = new Intl.DateTimeFormat('en-US', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short'});
const DOW_IDX = {Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6};
function spPartes(iso){
  const p = {}; FMT_SP.formatToParts(new Date(iso)).forEach(x=>{ p[x.type] = x.value; });
  return {data:p.year+'-'+p.month+'-'+p.day, hora:parseInt(p.hour,10), min:p.minute, dow:DOW_IDX[p.weekday], hm:p.hour+':'+p.minute};
}
// Relatório de acessos por jogador (Super Admin). dias = 7, 30, 90 ou 0 (tudo)
app.get('/api/admin/acessos', requireSuper, (req,res)=>{
  const dias = [7,30,90,0].includes(parseInt(req.query.dias,10)) ? parseInt(req.query.dias,10) : 30;
  const corte = dias ? new Date(Date.now() - dias*86400000).toISOString() : null;
  const linhas = corte
    ? db.prepare('SELECT jogador_id, ts, tipo, tela FROM acessos WHERE ts>=? ORDER BY ts ASC').all(corte)
    : db.prepare('SELECT jogador_id, ts, tipo, tela FROM acessos ORDER BY ts ASC').all();
  const ativos = getJogadores().filter(j=>j.ativo);
  const por = {};
  ativos.forEach(j=>{ por[j.id] = {id:j.id, nome:j.nome, entradas:0, dias:new Set(), telas:{}, horas:Array(24).fill(0), dow:Array(7).fill(0), ultimos:[], ultimoTs:null, porDia:{}}; });
  const heat = Array.from({length:7}, ()=>Array(24).fill(0));
  const telasGeral = {}, hojeSP = spPartes(nowISO()).data;
  let totalEntradas = 0, primeiro = null;
  linhas.forEach(r=>{
    const j = por[r.jogador_id]; if(!j) return;
    const p = spPartes(r.ts);
    if(r.tipo==='tela'){
      j.telas[r.tela] = (j.telas[r.tela]||0)+1; telasGeral[r.tela] = (telasGeral[r.tela]||0)+1;
    }else{
      j.entradas++; totalEntradas++; j.dias.add(p.data); j.horas[p.hora]++; j.dow[p.dow]++; heat[p.dow][p.hora]++;
      j.porDia[p.data] = (j.porDia[p.data]||0)+1; j.ultimoTs = r.ts;
      j.ultimos.push({data:p.data.slice(8,10)+'/'+p.data.slice(5,7), dow:p.dow, hm:p.hm});
      if(!primeiro) primeiro = r.ts;
    }
  });
  // últimos 14 dias (horário de SP), do mais antigo ao mais recente
  const ult14 = [];
  for(let i=13;i>=0;i--) ult14.push(spPartes(new Date(Date.now()-i*86400000).toISOString()).data);
  const topo = arr => { let b = 0; arr.forEach((v,i)=>{ if(v>arr[b]) b = i; }); return arr[b]>0 ? b : null; };
  const semanas = dias ? dias/7 : Math.max(1, (Date.now() - Date.parse(primeiro||nowISO()))/(7*86400000));
  const jogadores = Object.values(por).map(j=>{
    const telaFav = Object.keys(j.telas).sort((a,b)=>j.telas[b]-j.telas[a])[0] || null;
    return {
      id:j.id, nome:j.nome, entradas:j.entradas, diasAtivos:j.dias.size,
      mediaSemanal: Math.round(j.entradas/semanas*10)/10,
      ultimoAcesso: j.ultimoTs, diasSemAcesso: j.ultimoTs ? Math.max(0, diasEntreDatas(spPartes(j.ultimoTs).data, hojeSP)) : null,
      horaPreferida: topo(j.horas), diaPreferido: topo(j.dow), telaFavorita: telaFav,
      telas: j.telas, porDia14: ult14.map(d=>j.porDia[d]||0), ultimos: j.ultimos.slice(-12).reverse(),
    };
  }).sort((a,b)=> (b.entradas-a.entradas) || a.nome.localeCompare(b.nome,'pt-BR'));
  const ativosN = jogadores.filter(j=>j.entradas>0).length;
  res.json({
    dias, geradoEm: spWallClockNow(), nomesTelas: NOMES_TELAS, zeradoEm: (getConfig()||{}).acessos_zerado_em || null,
    totais: {entradas:totalEntradas, jogadoresAtivos:ativosN, totalJogadores:jogadores.length,
      mediaPorJogador: ativosN ? Math.round(totalEntradas/ativosN*10)/10 : 0,
      horaPico: topo(heat.reduce((acc,l)=>acc.map((v,i)=>v+l[i]), Array(24).fill(0))),
      diaPico: topo(heat.map(l=>l.reduce((a,b)=>a+b,0))), telas: telasGeral},
    heat, jogadores,
  });
});

// Zera a estatística de acessos (backlog): apaga todo o histórico de visitas/telas. Só o Super Admin.
app.delete('/api/admin/acessos', requireSuper, (req,res)=>{
  const n = db.prepare('SELECT COUNT(*) c FROM acessos').get().c;
  db.prepare('DELETE FROM acessos').run();
  db.prepare('UPDATE config SET acessos_zerado_em=? WHERE id=1').run(spWallClockNow());
  logEvento('Estatística de acessos zerada pelo Super Admin ('+n+' registros apagados).');
  res.json({ok:true, apagados:n});
});

/* ---- TRAMPOS (vagas indicadas pelos amigos) ---- */
function limparTexto(v, max){ return String(v==null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0, max); }
app.get('/api/trampos', requireAuth, (req,res)=>{
  const souAdmin = jogadorEhAdmin(req.jogadorId);
  const linhas = db.prepare('SELECT t.*, j.nome AS autor_nome, j.apelido AS autor_apelido, j.usar_apelido AS autor_usar FROM trampos t LEFT JOIN jogadores j ON j.id=t.jogador_id ORDER BY t.criado_em DESC LIMIT 60').all();
  res.json({trampos: linhas.map(t=>({
    id:t.id, titulo:t.titulo, empresa:t.empresa, local:t.local, descricao:t.descricao, contato:t.contato, link:t.link,
    criadoEm:t.criado_em, autor: (t.autor_usar && t.autor_apelido) ? t.autor_apelido : (t.autor_nome||'?'),
    posso_remover: t.jogador_id===req.jogadorId || souAdmin,
  }))});
});
app.post('/api/trampos', requireAuth, (req,res)=>{
  const b = req.body || {};
  const titulo = limparTexto(b.titulo, 80);
  if(titulo.length < 3) return res.status(400).json({erro:'Informe o título da vaga (mínimo 3 letras).'});
  let link = limparTexto(b.link, 250);
  if(link && !/^https?:\/\/[^\s]+$/i.test(link)) return res.status(400).json({erro:'O link da vaga precisa começar com http:// ou https://'});
  const minhas = db.prepare('SELECT COUNT(*) c FROM trampos WHERE jogador_id=?').get(req.jogadorId).c;
  if(minhas >= 10) return res.status(400).json({erro:'Você já tem 10 vagas publicadas. Remova alguma antes de publicar outra.'});
  const id = idGen('tr');
  db.prepare('INSERT INTO trampos (id,jogador_id,titulo,empresa,local,descricao,contato,link,criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.jogadorId, titulo, limparTexto(b.empresa,60), limparTexto(b.local,60), limparTexto(b.descricao,700), limparTexto(b.contato,80), link, nowISO());
  logEvento('Vaga de trampo publicada: "'+titulo+'" por '+getJogadorPorId(req.jogadorId).nome+'.');
  res.json({ok:true, id});
});
app.delete('/api/trampos/:id', requireAuth, (req,res)=>{
  const t = db.prepare('SELECT * FROM trampos WHERE id=?').get(req.params.id);
  if(!t) return res.status(404).json({erro:'Vaga não encontrada.'});
  if(t.jogador_id !== req.jogadorId && !jogadorEhAdmin(req.jogadorId)) return res.status(403).json({erro:'Só quem publicou (ou um admin) pode remover a vaga.'});
  db.prepare('DELETE FROM trampos WHERE id=?').run(t.id);
  logEvento('Vaga de trampo removida: "'+t.titulo+'".');
  res.json({ok:true});
});

/* ---- ordem dos cards da tela inicial ---- */
const HOME_CARDS = ['rodada','status_carreira','se_liga','departamento_medico','eventos','pagamento','gestao'];
// usa só chaves conhecidas, sem repetir, e acrescenta no fim as que faltarem
function normalizarOrdemHome(lista){
  const out = [];
  (Array.isArray(lista) ? lista : String(lista||'').split(',')).map(x=>String(x).trim()).forEach(k=>{ if(HOME_CARDS.includes(k) && !out.includes(k)) out.push(k); });
  HOME_CARDS.forEach(k=>{ if(!out.includes(k)) out.push(k); });
  return out;
}
app.put('/api/admin/home-ordem', requirePerm('conteudo'), (req,res)=>{
  const b = req.body || {};
  const ordem = b.padrao ? [...HOME_CARDS] : normalizarOrdemHome(b.ordem);
  db.prepare('UPDATE config SET home_ordem=? WHERE id=1').run(b.padrao ? '' : ordem.join(','));
  logEvento('Ordem dos cards da tela inicial '+(b.padrao ? 'restaurada ao padrão' : 'atualizada')+'.');
  res.json({ok:true, ordem});
});

/* ---- extras da tela inicial: eventos, notícia, aluguel da quadra ---- */
app.get('/api/home-extras', (req,res)=>{
  const telDoNome = nm => { if(!nm) return ''; const j = db.prepare('SELECT telefone FROM jogadores WHERE nome=? AND ativo=1').get(nm); return (j && j.telefone) ? j.telefone : ''; };
  const eventos = db.prepare('SELECT id,nome,data,descricao,responsavel,local,mostrar_participantes,so_aba,ocultar_valores,pgto_ativo,pgto_nome,pgto_pix,pgto_valor FROM eventos WHERE ativo=1 ORDER BY data ASC').all()
    .map(e=>({id:e.id, nome:e.nome, data:e.data, descricao:e.descricao||'', responsavel:e.responsavel||'', responsavelTel: telDoNome(e.responsavel), local:e.local||'',
      mostrarParticipantes:!!e.mostrar_participantes, soAba:!!e.so_aba, ocultarValores:!!e.ocultar_valores,
      pagamento: e.pgto_ativo ? {nome:e.pgto_nome||'', chavePix:e.pgto_pix||'', valor:e.pgto_valor||''} : null}));
  const algumComLista = eventos.some(e=>e.mostrarParticipantes);
  const noticiaRow = db.prepare('SELECT descricao,ativo FROM noticia WHERE id=1').get();
  const aluguelRow = db.prepare('SELECT nome,chave_pix,valor_mensalidade,ativo FROM aluguel_quadra WHERE id=1').get();
  const gestaoRow = db.prepare('SELECT presidente,vice_presidente,ativo FROM gestao WHERE id=1').get();
  res.json({
    eventos,
    noticia: (noticiaRow && noticiaRow.ativo) ? {descricao: noticiaRow.descricao} : null,
    aluguel: (aluguelRow && aluguelRow.ativo) ? {nome:aluguelRow.nome, chavePix:aluguelRow.chave_pix, valorMensalidade:aluguelRow.valor_mensalidade} : null,
    gestao: (gestaoRow && gestaoRow.ativo) ? {presidente:gestaoRow.presidente, vicePresidente:gestaoRow.vice_presidente, presidenteTel:telDoNome(gestaoRow.presidente), viceTel:telDoNome(gestaoRow.vice_presidente)} : null,
    ordem: normalizarOrdemHome((getConfig()||{}).home_ordem),
    eventoLista: algumComLista ? montarEventoLista() : null,
    eventoAba: abaEvento(),
  });
});

// salva as opções extras de um evento (lista de participantes + dados para pagamento), se vierem no corpo
function aplicarExtrasEvento(id, b){
  if(b.local!==undefined) db.prepare('UPDATE eventos SET local=? WHERE id=?').run(String(b.local).trim().slice(0,200), id);
  if(b.mostrarParticipantes!==undefined){
    const v = b.mostrarParticipantes ? 1 : 0;
    if(v) db.prepare('UPDATE eventos SET mostrar_participantes=0').run();     // só um evento exibe a lista
    db.prepare('UPDATE eventos SET mostrar_participantes=? WHERE id=?').run(v, id);
  }
  if(b.soAba!==undefined) db.prepare('UPDATE eventos SET so_aba=? WHERE id=?').run(b.soAba?1:0, id);
  if(b.ocultarValores!==undefined) db.prepare('UPDATE eventos SET ocultar_valores=? WHERE id=?').run(b.ocultarValores?1:0, id);
  if(b.pgtoAtivo!==undefined) db.prepare('UPDATE eventos SET pgto_ativo=? WHERE id=?').run(b.pgtoAtivo?1:0, id);
  if(b.pgtoNome!==undefined)  db.prepare('UPDATE eventos SET pgto_nome=? WHERE id=?').run(String(b.pgtoNome).trim().slice(0,80), id);
  if(b.pgtoPix!==undefined)   db.prepare('UPDATE eventos SET pgto_pix=? WHERE id=?').run(String(b.pgtoPix).trim().slice(0,120), id);
  if(b.pgtoValor!==undefined) db.prepare('UPDATE eventos SET pgto_valor=? WHERE id=?').run(String(b.pgtoValor).trim().slice(0,40), id);
}
app.get('/api/admin/agenda', requireEventos, (req,res)=>{
  res.json({eventos: db.prepare('SELECT * FROM eventos ORDER BY data ASC').all().map(e=>({id:e.id,nome:e.nome,data:e.data,ativo:!!e.ativo,descricao:e.descricao||'',responsavel:e.responsavel||'',
    local:e.local||'', despesas:despesasDoEvento(e.id), receitas:receitasDoEvento(e.id), mostrarParticipantes:!!e.mostrar_participantes, soAba:!!e.so_aba, ocultarValores:!!e.ocultar_valores, pgtoAtivo:!!e.pgto_ativo, pgtoNome:e.pgto_nome||'', pgtoPix:e.pgto_pix||'', pgtoValor:e.pgto_valor||''}))});
});
app.post('/api/admin/agenda', requireEventos, (req,res)=>{
  const nome = String(req.body.nome||'').trim();
  const data = String(req.body.data||'').trim();
  if(!nome || !data) return res.status(400).json({erro:'Informe nome e data do evento.'});
  const descricao = String(req.body.descricao||'');
  const responsavel = String(req.body.responsavel||'');
  const vp = validarParticipantes(req.body.participantes);
  if(vp.erro) return res.status(400).json({erro:vp.erro});
  const vd = validarDespesas(req.body.despesas);
  if(vd.erro) return res.status(400).json({erro:vd.erro});
  const vr = validarReceitas(req.body.receitas);
  if(vr.erro) return res.status(400).json({erro:vr.erro});
  const id = idGen('ev');
  db.prepare('INSERT INTO eventos (id,nome,data,ativo,descricao,responsavel) VALUES (?,?,?,1,?,?)').run(id, nome, data, descricao, responsavel);
  aplicarExtrasEvento(id, req.body);
  if(vp.lista) gravarParticipantes(vp.lista);
  if(vd.lista) gravarDespesas(id, vd.lista);
  if(vr.lista) gravarReceitas(id, vr.lista);
  res.json({ok:true, id});
});
app.put('/api/admin/agenda/:id', requireEventos, (req,res)=>{
  const ev = db.prepare('SELECT * FROM eventos WHERE id=?').get(req.params.id);
  if(!ev) return res.status(404).json({erro:'Evento não encontrado.'});
  const vp = validarParticipantes(req.body.participantes);
  if(vp.erro) return res.status(400).json({erro:vp.erro});
  const vd = validarDespesas(req.body.despesas);
  if(vd.erro) return res.status(400).json({erro:vd.erro});
  const vr = validarReceitas(req.body.receitas);
  if(vr.erro) return res.status(400).json({erro:vr.erro});
  const nome = req.body.nome!=null ? String(req.body.nome) : ev.nome;
  const data = req.body.data!=null ? String(req.body.data) : ev.data;
  const ativo = req.body.ativo!=null ? (req.body.ativo?1:0) : ev.ativo;
  const descricao = req.body.descricao!=null ? String(req.body.descricao) : (ev.descricao||'');
  const responsavel = req.body.responsavel!=null ? String(req.body.responsavel) : (ev.responsavel||'');
  db.prepare('UPDATE eventos SET nome=?,data=?,ativo=?,descricao=?,responsavel=? WHERE id=?').run(nome,data,ativo,descricao,responsavel,ev.id);
  aplicarExtrasEvento(ev.id, req.body);
  if(vp.lista) gravarParticipantes(vp.lista);
  if(vd.lista) gravarDespesas(ev.id, vd.lista);
  if(vr.lista) gravarReceitas(ev.id, vr.lista);
  res.json({ok:true});
});
app.delete('/api/admin/agenda/:id', requireEventos, (req,res)=>{
  db.prepare('DELETE FROM evento_despesas WHERE evento_id=?').run(req.params.id);
  db.prepare('DELETE FROM evento_receitas WHERE evento_id=?').run(req.params.id);
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
