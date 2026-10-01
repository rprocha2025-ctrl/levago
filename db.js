// Camada de banco de dados (SQLite para desenvolvimento).
// Em produção pode-se migrar para Postgres mantendo as mesmas funções.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'leva.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  cpf TEXT,
  genero TEXT,
  role TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  status TEXT DEFAULT 'ativo',
  rating REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  rides_count INTEGER DEFAULT 0,
  placa TEXT, modelo TEXT, cnh TEXT,
  saldo REAL DEFAULT 0,
  meta_dia REAL DEFAULT 0,
  meta_semana REAL DEFAULT 0,
  banco_tipo TEXT, banco_chave TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY,
  cliente_email TEXT NOT NULL,
  cliente_nome TEXT,
  origem TEXT, destino TEXT,
  tipo TEXT, dim TEXT, peso REAL,
  km REAL, min_est INTEGER,
  valor REAL, comissao REAL, valor_motoboy REAL,
  extras REAL DEFAULT 0, espera REAL DEFAULT 0,
  status TEXT NOT NULL,
  motoboy_email TEXT, motoboy_nome TEXT,
  criada_em TEXT, aceita_em TEXT, chegou_em TEXT, iniciada_em TEXT, concluida_em TEXT,
  aval_cliente INTEGER, aval_motoboy INTEGER,
  paga INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resets (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`);

export default db;

// ---- usuários ----
export const Users = {
  get: db.prepare('SELECT * FROM users WHERE email = ?'),
  insert: db.prepare(`INSERT INTO users
    (email,nome,telefone,cpf,genero,role,senha_hash,status,rating,rating_count,rides_count,placa,modelo,cnh,saldo,meta_dia,meta_semana,banco_tipo,banco_chave,created_at)
    VALUES (@email,@nome,@telefone,@cpf,@genero,@role,@senha_hash,'ativo',0,0,0,@placa,@modelo,@cnh,0,0,0,NULL,NULL,@created_at)`),
  all: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),
  updateSenha: db.prepare('UPDATE users SET senha_hash=? WHERE email=?'),
  updateMetas: db.prepare('UPDATE users SET meta_dia=?, meta_semana=? WHERE email=?'),
  updateBanco: db.prepare('UPDATE users SET banco_tipo=?, banco_chave=? WHERE email=?'),
  addSaldoRide: db.prepare('UPDATE users SET saldo = saldo + ?, rides_count = rides_count + 1 WHERE email=?'),
  addRating: db.prepare('UPDATE users SET rating = rating + ?, rating_count = rating_count + 1 WHERE email=?'),
};

// ---- corridas ----
export const Rides = {
  insert: db.prepare(`INSERT INTO rides
    (id,cliente_email,cliente_nome,origem,destino,tipo,dim,peso,km,min_est,valor,comissao,valor_motoboy,extras,espera,status,criada_em,paga)
    VALUES (@id,@cliente_email,@cliente_nome,@origem,@destino,@tipo,@dim,@peso,@km,@min_est,@valor,@comissao,@valor_motoboy,0,0,'solicitada',@criada_em,0)`),
  get: db.prepare('SELECT * FROM rides WHERE id = ?'),
  mine: db.prepare('SELECT * FROM rides WHERE cliente_email = ? ORDER BY criada_em DESC'),
  available: db.prepare("SELECT * FROM rides WHERE status = 'solicitada' ORDER BY criada_em ASC"),
  byMotoboy: db.prepare('SELECT * FROM rides WHERE motoboy_email = ? ORDER BY criada_em DESC'),
  all: db.prepare('SELECT * FROM rides ORDER BY criada_em DESC'),
  accept: db.prepare("UPDATE rides SET status='aceita', motoboy_email=?, motoboy_nome=?, aceita_em=? WHERE id=? AND status='solicitada'"),
  setStatus: db.prepare('UPDATE rides SET status=? WHERE id=?'),
  setStamp: db.prepare('UPDATE rides SET status=?, chegou_em=COALESCE(?,chegou_em), iniciada_em=COALESCE(?,iniciada_em), concluida_em=COALESCE(?,concluida_em), paga=COALESCE(?,paga) WHERE id=?'),
  release: db.prepare("UPDATE rides SET status='solicitada', motoboy_email=NULL, motoboy_nome=NULL, aceita_em=NULL WHERE id=?"),
  avalCliente: db.prepare('UPDATE rides SET aval_cliente=? WHERE id=?'),
  avalMotoboy: db.prepare('UPDATE rides SET aval_motoboy=? WHERE id=?'),
};

// ---- recuperação de senha ----
export const Resets = {
  set: db.prepare(`INSERT INTO resets (email,code_hash,expires_at,created_at) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, created_at=excluded.created_at`),
  get: db.prepare('SELECT * FROM resets WHERE email = ?'),
  del: db.prepare('DELETE FROM resets WHERE email = ?'),
};
