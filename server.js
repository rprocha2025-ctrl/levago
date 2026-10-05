import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Users, Rides, Resets } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'troque-isto-em-producao';
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || '';          // chave usada no navegador (restrita por domínio)
const MAPS_SERVER_KEY = process.env.GOOGLE_MAPS_SERVER_KEY || MAPS_KEY; // chave server-side (Directions)

// ---- regras de negócio / preços ----
const CFG = {
  comissao: 0.18, base: 7.0, porKm: 2.20, kgFree: 5, kgExtra: 0.50,
  esperaFreeMin: 5, esperaPorMin: 0.50,
  max: { c: 60, l: 50, a: 50, peso: 25 },
  tipos: ['Documentos / envelopes','Pequeno volume','Alimentos','Compras / mercado','Peças / ferramentas','Outro'],
};
function cotar(km, peso) {
  let v = CFG.base + CFG.porKm * km;
  if (peso > CFG.kgFree) v += (peso - CFG.kgFree) * CFG.kgExtra;
  v = Math.round(v * 100) / 100;
  const comissao = Math.round(v * CFG.comissao * 100) / 100;
  return { valor: v, comissao, valorMotoboy: Math.round((v - comissao) * 100) / 100 };
}
function excedeLimite(d) {
  const p = [];
  if (d.c > CFG.max.c) p.push(`comprimento ${d.c}cm (máx ${CFG.max.c}cm)`);
  if (d.l > CFG.max.l) p.push(`largura ${d.l}cm (máx ${CFG.max.l}cm)`);
  if (d.a > CFG.max.a) p.push(`altura ${d.a}cm (máx ${CFG.max.a}cm)`);
  if (d.peso > CFG.max.peso) p.push(`peso ${d.peso}kg (máx ${CFG.max.peso}kg)`);
  return p;
}
// distância por ruas via Google Directions (fallback: haversine * fator)
function haversine(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
async function rotaKm(o, d) {
  if (MAPS_SERVER_KEY && o.lat && d.lat) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&mode=driving&key=${MAPS_SERVER_KEY}`;
      const r = await fetch(url);
      const j = await r.json();
      if (j.status === 'OK' && j.routes[0]) {
        const leg = j.routes[0].legs[0];
        return { km: Math.round(leg.distance.value / 100) / 10, min: Math.round(leg.duration.value / 60) };
      }
    } catch (e) { /* cai no fallback */ }
  }
  const km = Math.round(haversine(o, d) * 1.3 * 10) / 10 || 1.5;
  return { km, min: Math.max(4, Math.round(km / 22 * 60)) };
}

// ---- auth ----
const sign = u => jwt.sign({ email: u.email, role: u.role, nome: u.nome }, JWT_SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'sem_token' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'token_invalido' }); }
}
const role = r => (req, res, next) => req.user.role === r ? next() : res.status(403).json({ error: 'sem_permissao' });
const pub = u => ({ email: u.email, nome: u.nome, telefone: u.telefone, cpf: u.cpf, genero: u.genero, role: u.role,
  rating: u.rating, ratingCount: u.rating_count, ridesCount: u.rides_count, placa: u.placa, modelo: u.modelo, cnh: u.cnh,
  saldo: u.saldo, metaDia: u.meta_dia, metaSemana: u.meta_semana,
  banco: u.banco_chave ? { tipo: u.banco_tipo, chave: u.banco_chave } : null, createdAt: u.created_at });
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));
async function sendEmail(to, subject, text) {
  // Integração de e-mail real entra aqui (ex.: SMTP/SendGrid/Resend).
  console.log(`[EMAIL->${to}] ${subject}: ${text}`);
}

app.get('/api/config', (req, res) => res.json({
  mapsKey: MAPS_KEY, mapsEnabled: !!MAPS_KEY,
  pricing: { comissao: CFG.comissao, base: CFG.base, porKm: CFG.porKm, kgFree: CFG.kgFree, kgExtra: CFG.kgExtra, esperaFreeMin: CFG.esperaFreeMin, esperaPorMin: CFG.esperaPorMin },
  max: CFG.max, tipos: CFG.tipos,
}));

app.post('/api/auth/register', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const erros = {};
  if (!b.nome || String(b.nome).trim().split(' ').length < 2) erros.nome = 'Informe nome e sobrenome';
  if (!emailOk(email)) erros.email = 'E-mail inválido';
  if (!b.telefone || String(b.telefone).replace(/\D/g,'').length < 10) erros.telefone = 'Telefone inválido';
  if (!b.cpf || String(b.cpf).replace(/\D/g,'').length !== 11) erros.cpf = 'CPF deve ter 11 dígitos';
  if (!['f','m','n'].includes(b.genero)) erros.genero = 'Selecione o gênero';
  if (!b.senha || String(b.senha).length < 6) erros.senha = 'Senha mínima de 6 caracteres';
  if (!['cliente','motoboy'].includes(b.role)) erros.role = 'Perfil inválido';
  if (b.role === 'motoboy') {
    if (!b.placa) erros.placa = 'Obrigatório';
    if (!b.modelo) erros.modelo = 'Obrigatório';
    if (!b.cnh) erros.cnh = 'Obrigatório';
  }
  if (Object.keys(erros).length) return res.status(400).json({ erros });
  if (Users.get.get(email)) return res.status(409).json({ erros: { email: 'Este e-mail já está cadastrado' } });
  const senha_hash = await bcrypt.hash(String(b.senha), 10);
  Users.insert.run({
    email, nome: String(b.nome).trim(), telefone: b.telefone, cpf: b.cpf, genero: b.genero, role: b.role,
    senha_hash, placa: b.role==='motoboy'? String(b.placa).toUpperCase():null,
    modelo: b.role==='motoboy'? b.modelo:null, cnh: b.role==='motoboy'? b.cnh:null,
    created_at: new Date().toISOString(),
  });
  const u = Users.get.get(email);
  res.json({ token: sign(u), user: pub(u) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const u = Users.get.get(email);
  if (!u) return res.status(404).json({ error: 'nao_cadastrado' });      // só entra quem já tem cadastro
  if (!await bcrypt.compare(senha, u.senha_hash)) return res.status(401).json({ error: 'senha_incorreta' });
  res.json({ token: sign(u), user: pub(u) });
});

// esqueci a senha -> gera código (5 min)
app.post('/api/auth/forgot', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const u = Users.get.get(email);
  if (!u) return res.status(404).json({ error: 'nao_cadastrado' });
  const code = genCode();
  const code_hash = await bcrypt.hash(code, 8);
  Resets.set.run(email, code_hash, Date.now() + 5*60*1000, new Date().toISOString());
  await sendEmail(email, 'LEVA — código de recuperação', `Seu código é ${code}. Válido por 5 minutos.`);
  res.json({ ok: true, ...(PROD ? {} : { devCode: code }) });   // devCode só fora de produção
});
app.post('/api/auth/verify-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '');
  const r = Resets.get.get(email);
  if (!r) return res.status(400).json({ error: 'sem_codigo' });
  if (Date.now() > r.expires_at) return res.status(400).json({ error: 'expirado' });
  if (!await bcrypt.compare(code, r.code_hash)) return res.status(400).json({ error: 'codigo_incorreto' });
  res.json({ ok: true });
});
app.post('/api/auth/reset', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '');
  const senha = String(req.body?.senha || '');
  const r = Resets.get.get(email);
  if (!r || Date.now() > r.expires_at) return res.status(400).json({ error: 'expirado' });
  if (!await bcrypt.compare(code, r.code_hash)) return res.status(400).json({ error: 'codigo_incorreto' });
  if (senha.length < 6) return res.status(400).json({ error: 'senha_curta' });
  Users.updateSenha.run(await bcrypt.hash(senha, 10), email);
  Resets.del.run(email);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const u = Users.get.get(req.user.email);
  if (!u) return res.status(404).json({ error: 'nao_encontrado' });
  res.json(pub(u));
});

// ---- corridas ----
app.post('/api/rides', auth, role('cliente'), async (req, res) => {
  const b = req.body || {};
  const o = b.origem || {}, d = b.destino || {};
  if (!o.rua || !o.numero || !o.bairro || !d.rua || !d.numero || !d.bairro) return res.status(400).json({ error: 'endereco_incompleto' });
  const dim = { c: +b.dim?.c, l: +b.dim?.l, a: +b.dim?.a, peso: +b.peso };
  if (!(dim.c>0&&dim.l>0&&dim.a>0&&dim.peso>0)) return res.status(400).json({ error: 'item_invalido' });
  const probs = excedeLimite(dim);
  if (probs.length) return res.status(400).json({ error: 'item_grande', probs });
  const { km, min } = await rotaKm(o, d);                 // distância autoritativa no servidor
  const q = cotar(km, dim.peso);
  const u = Users.get.get(req.user.email);
  const ride = {
    id: 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    cliente_email: u.email, cliente_nome: u.nome,
    origem: JSON.stringify(o), destino: JSON.stringify(d),
    tipo: b.tipo || CFG.tipos[0], dim: JSON.stringify(dim), peso: dim.peso,
    km, min_est: min, valor: q.valor, comissao: q.comissao, valor_motoboy: q.valorMotoboy,
    criada_em: new Date().toISOString(),
  };
  Rides.insert.run(ride);
  res.json(rideOut(Rides.get.get(ride.id)));
});

app.get('/api/rides/mine', auth, (req, res) => res.json(Rides.mine.all(req.user.email).map(rideOut)));
app.get('/api/rides/available', auth, role('motoboy'), (req, res) => res.json(Rides.available.all().map(rideOut)));
app.get('/api/rides/current', auth, role('motoboy'), (req, res) => {
  const ativa = Rides.byMotoboy.all(req.user.email).find(r => ['aceita','a_caminho','aguardando','em_andamento'].includes(r.status));
  res.json(ativa ? rideOut(ativa) : null);
});
app.get('/api/rides/motoboy', auth, role('motoboy'), (req, res) => res.json(Rides.byMotoboy.all(req.user.email).map(rideOut)));

app.post('/api/rides/:id/accept', auth, role('motoboy'), (req, res) => {
  const u = Users.get.get(req.user.email);
  const info = Rides.accept.run(u.email, u.nome, new Date().toISOString(), req.params.id); // atômico: só a 1ª aceita vence
  if (info.changes === 0) return res.status(409).json({ error: 'indisponivel' });
  res.json(rideOut(Rides.get.get(req.params.id)));
});

app.post('/api/rides/:id/status', auth, role('motoboy'), (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r || r.motoboy_email !== req.user.email) return res.status(403).json({ error: 'nao_sua' });
  const to = req.body?.status;
  const now = new Date().toISOString();
  if (to === 'aguardando') Rides.setStamp.run('aguardando', now, null, null, null, r.id);
  else if (to === 'em_andamento') Rides.setStamp.run('em_andamento', null, now, null, null, r.id);
  else if (to === 'concluida') {
    Rides.setStamp.run('concluida', null, null, now, 1, r.id);
    Users.addSaldoRide.run(r.valor_motoboy, r.motoboy_email);   // credita carteira (líquido)
  } else if (to === 'a_caminho') Rides.setStatus.run('a_caminho', r.id);
  else return res.status(400).json({ error: 'status_invalido' });
  res.json(rideOut(Rides.get.get(r.id)));
});

app.post('/api/rides/:id/cancel', auth, (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'nao_encontrada' });
  if (req.user.role === 'motoboy' && r.motoboy_email === req.user.email) { Rides.release.run(r.id); return res.json({ ok: true }); }
  if (req.user.role === 'cliente' && r.cliente_email === req.user.email && r.status === 'solicitada') { Rides.setStatus.run('cancelada', r.id); return res.json({ ok: true }); }
  res.status(403).json({ error: 'nao_permitido' });
});

app.post('/api/rides/:id/rate', auth, (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'nao_encontrada' });
  const nota = Math.max(1, Math.min(5, +req.body?.nota || 0));
  if (req.user.role === 'cliente' && r.cliente_email === req.user.email) {
    Rides.avalCliente.run(nota, r.id); if (r.motoboy_email) Users.addRating.run(nota, r.motoboy_email);
  } else if (req.user.role === 'motoboy' && r.motoboy_email === req.user.email) {
    Rides.avalMotoboy.run(nota, r.id); Users.addRating.run(nota, r.cliente_email);
  } else return res.status(403).json({ error: 'nao_permitido' });
  res.json({ ok: true });
});

// ---- motoboy: metas e banco ----
app.post('/api/me/metas', auth, role('motoboy'), (req, res) => {
  Users.updateMetas.run(+req.body?.metaDia||0, +req.body?.metaSemana||0, req.user.email);
  res.json(pub(Users.get.get(req.user.email)));
});
app.post('/api/me/banco', auth, role('motoboy'), (req, res) => {
  if (!req.body?.chave) return res.status(400).json({ error: 'chave_obrigatoria' });
  Users.updateBanco.run(req.body.tipo || 'PIX', req.body.chave, req.user.email);
  res.json(pub(Users.get.get(req.user.email)));
});

// ---- admin ----
app.get('/api/admin/users', auth, role('admin'), (req, res) => res.json(Users.all.all().map(pub)));
app.get('/api/admin/rides', auth, role('admin'), (req, res) => res.json(Rides.all.all().map(rideOut)));

function rideOut(r) {
  if (!r) return null;
  return { id: r.id, clienteEmail: r.cliente_email, clienteNome: r.cliente_nome,
    origem: JSON.parse(r.origem||'{}'), destino: JSON.parse(r.destino||'{}'),
    tipo: r.tipo, dim: JSON.parse(r.dim||'{}'), peso: r.peso, km: r.km, minEst: r.min_est,
    valor: r.valor, comissao: r.comissao, valorMotoboy: r.valor_motoboy, status: r.status,
    motoboyEmail: r.motoboy_email, motoboyNome: r.motoboy_nome,
    criadaEm: r.criada_em, aceitaEm: r.aceita_em, chegouEm: r.chegou_em, concluidaEm: r.concluida_em,
    avalCliente: r.aval_cliente, avalMotoboy: r.aval_motoboy, paga: !!r.paga };
}

// a plataforma (login + painéis) fica em /app; a landing institucional em /
app.get(['/app','/app/*'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// cria as contas demo automaticamente se o banco estiver vazio
function seedDemoIfEmpty(){
  try{
    if(Users.all.all().length>0) return;
    const demo=[
      {email:'cliente@leva.com',senha:'123456',role:'cliente',nome:'Carla Souza',genero:'f',telefone:'(19) 99999-0001',cpf:'111.111.111-11'},
      {email:'motoboy@leva.com',senha:'123456',role:'motoboy',nome:'Motoboy Demo',genero:'m',telefone:'(19) 99999-0002',cpf:'222.222.222-22',placa:'ABC1D23',modelo:'Honda CG 160',cnh:'01234567890'},
      {email:'admin@leva.com',senha:'admin123',role:'admin',nome:'Admin LEVA',genero:'n',telefone:'(19) 99999-0003',cpf:'333.333.333-33'},
    ];
    for(const d of demo){
      Users.insert.run({email:d.email,nome:d.nome,telefone:d.telefone,cpf:d.cpf,genero:d.genero,role:d.role,
        senha_hash:bcrypt.hashSync(d.senha,10),placa:d.placa||null,modelo:d.modelo||null,cnh:d.cnh||null,
        created_at:new Date().toISOString()});
    }
    console.log('Contas demo criadas.');
  }catch(e){ console.log('seed demo falhou:', e.message); }
}
seedDemoIfEmpty();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LEVA server em http://localhost:${PORT}  (maps: ${MAPS_KEY ? 'configurado' : 'SEM CHAVE'})`));
