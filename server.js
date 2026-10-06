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
const MGCENTER = { lat: -22.3716, lng: -46.9426 };              // centro de Mogi Guaçu (viés da busca)

// ---- regras de negócio / preços ----
const CFG = {
  // tarifa cobrada do cliente (inspirada em Uber/Loggi)
  base: 5.00, porKm: 2.20, porMin: 0.30, kgFree: 5, kgExtra: 0.50,
  tarifaMinima: 9.90,
  picoFator: 1.2, picoHoras: [[11,14],[18,21]],   // tarifa dinâmica (pico)
  esperaFreeMin: 5, esperaPorMin: 0.50,
  // taxas da plataforma (NÃO expostas ao motoboy — só admin)
  taxaServico: 2.00, comissaoPct: 0.12,
  max: { c: 60, l: 50, a: 50, peso: 25 },
  tipos: ['Documentos / envelopes','Pequeno volume','Alimentos','Compras / mercado','Peças / ferramentas','Outro'],
  // valores sugeridos de caixinha (gorjeta) para o motoboy
  gorjetas: [2, 5, 10],
};
// Dados fiscais da empresa (aparecem no recibo). ⚠️ Troque pelo CNPJ/razão social reais.
const EMPRESA = {
  nome: process.env.EMPRESA_NOME || 'LEVA Entregas',
  cnpj: process.env.EMPRESA_CNPJ || '00.000.000/0001-00',
  cidade: process.env.EMPRESA_CIDADE || 'Mogi Guaçu/SP',
  contato: process.env.EMPRESA_CONTATO || 'contato@leva.app',
};
// mapa de nome de estado -> UF (para normalizar o retorno do geocoder)
const UF = { 'Acre':'AC','Alagoas':'AL','Amapá':'AP','Amazonas':'AM','Bahia':'BA','Ceará':'CE','Distrito Federal':'DF','Espírito Santo':'ES','Goiás':'GO','Maranhão':'MA','Mato Grosso':'MT','Mato Grosso do Sul':'MS','Minas Gerais':'MG','Pará':'PA','Paraíba':'PB','Paraná':'PR','Pernambuco':'PE','Piauí':'PI','Rio de Janeiro':'RJ','Rio Grande do Norte':'RN','Rio Grande do Sul':'RS','Rondônia':'RO','Roraima':'RR','Santa Catarina':'SC','São Paulo':'SP','Sergipe':'SE','Tocantins':'TO' };
const toUF = s => { if(!s) return ''; if(/^[A-Z]{2}$/.test(s)) return s; const m=String(s).match(/BR-([A-Z]{2})/); if(m) return m[1]; return UF[s] || ''; };
function fatorPico(dt = new Date()) {
  const h = (dt.getUTCHours() - 3 + 24) % 24;        // horário de Brasília (UTC-3)
  return CFG.picoHoras.some(([a, b]) => h >= a && h < b) ? CFG.picoFator : 1.0;
}
// Retorna a decomposição completa. valor = o que o CLIENTE paga (X);
// valorMotoboy = X menos todas as taxas da plataforma (Y).
function cotar(km, min, peso) {
  const pesoBase = peso > CFG.kgFree ? (peso - CFG.kgFree) * CFG.kgExtra : 0;
  let sub = CFG.base + CFG.porKm * km + CFG.porMin * (min || 0) + pesoBase;
  const aplicouMin = sub < CFG.tarifaMinima;
  sub = Math.max(sub, CFG.tarifaMinima);
  const fator = fatorPico();
  const valor = Math.round(sub * fator * 100) / 100;            // X (cliente)
  // componente de peso extra efetivamente cobrado (para itemizar no recibo); 0 se caiu na tarifa mínima
  const pesoExtra = aplicouMin ? 0 : Math.round(pesoBase * fator * 100) / 100;
  const taxaServico = CFG.taxaServico;                          // taxa fixa da plataforma
  const comissao = Math.round((valor - taxaServico) * CFG.comissaoPct * 100) / 100;
  const totalRetido = Math.round((taxaServico + comissao) * 100) / 100;
  const valorMotoboy = Math.round((valor - totalRetido) * 100) / 100;  // Y (motoboy)
  return { valor, subtotal: Math.round(sub*100)/100, fator, pesoExtra, taxaServico, comissao, totalRetido, valorMotoboy };
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
  banco: u.banco_chave ? { tipo: u.banco_tipo, chave: u.banco_chave } : null,
  endereco: u.endereco ? JSON.parse(u.endereco) : null, createdAt: u.created_at });
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const genCode = () => String(Math.floor(100000 + Math.random() * 900000));
async function sendEmail(to, subject, text) {
  // Integração de e-mail real entra aqui (ex.: SMTP/SendGrid/Resend).
  console.log(`[EMAIL->${to}] ${subject}: ${text}`);
}

app.get('/api/config', (req, res) => res.json({
  mapsKey: MAPS_KEY, mapsEnabled: !!MAPS_KEY,
  // só a tarifa que o cliente enxerga (sem as taxas internas da plataforma)
  pricing: { base: CFG.base, porKm: CFG.porKm, porMin: CFG.porMin, kgFree: CFG.kgFree, kgExtra: CFG.kgExtra, tarifaMinima: CFG.tarifaMinima, picoFator: CFG.picoFator, picoHoras: CFG.picoHoras, esperaFreeMin: CFG.esperaFreeMin, esperaPorMin: CFG.esperaPorMin },
  max: CFG.max, tipos: CFG.tipos, gorjetas: CFG.gorjetas, empresa: EMPRESA,
}));

// ---- autocomplete de endereço (OpenStreetMap — grátis, sem chave) ----
// Usa Photon (ótimo para autocomplete) e cai no Nominatim se vier vazio (melhor cobertura estruturada).
function labelDe(s) {
  const parts = [];
  if (s.rua) parts.push(s.rua + (s.numero ? ', ' + s.numero : ''));
  if (s.bairro) parts.push(s.bairro);
  if (s.cidade) parts.push(s.cidade + (s.uf ? '/' + s.uf : ''));
  return parts.join(' · ') || s.rua || '';
}
// região de Mogi Guaçu — usada só como PREFERÊNCIA (desempate), NÃO como limite. A busca é nível Brasil.
const BBOX = { minLon: -47.25, minLat: -22.70, maxLon: -46.55, maxLat: -22.00 };
// troca vírgula por espaço (assim "rua X, cidade Y" vira texto livre e a cidade AJUDA a achar o endereço)
const limpaQ = q => String(q).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
async function fetchT(url, ms = 2600) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'LEVA-motofrete/1.0 (contato@leva.app)' } }); }
  finally { clearTimeout(t); }
}
async function viaPhoton(q) {
  // busca nível Brasil, ordenada por relevância/importância (sem viés de região)
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=default&limit=10`;
  const r = await fetchT(url);
  const j = await r.json();
  return ((j && j.features) || [])
    .filter(f => ((f.properties && f.properties.countrycode) || 'BR') === 'BR')
    .map(f => {
      const p = f.properties || {}, g = (f.geometry && f.geometry.coordinates) || [];
      const estado = p.state || '';
      const s = { rua: p.street || p.name || '', numero: p.housenumber || '',
        bairro: p.district || p.suburb || p.neighbourhood || p.locality || p.quarter || '',
        cidade: p.city || p.town || p.village || p.municipality || p.county || '',
        estado, uf: toUF(estado), lat: g[1], lng: g[0], tipo: p.osm_value || p.type || '' };
      s.label = labelDe(s); return s;
    })
    .filter(s => s.rua && s.lat != null);
}
async function viaNominatim(q) {
  // busca nível Brasil inteiro (countrycodes=br), sem restrição de região
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=10&addressdetails=1&countrycodes=br&accept-language=pt-BR`;
  const r = await fetchT(url);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map(it => {
    const a = it.address || {};
    const estado = a.state || '';
    const s = { rua: a.road || a.pedestrian || a.cycleway || a.footway || it.name || '',
      numero: a.house_number || '',
      bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || a.hamlet || '',
      cidade: a.city || a.town || a.village || a.municipality || a.county || '',
      estado, uf: toUF(a['ISO3166-2-lvl4'] || estado),
      lat: +it.lat, lng: +it.lon };
    s.label = labelDe(s); return s;
  }).filter(s => s.rua && !isNaN(s.lat));
}
// ordena por relevância: ruas cujo nome realmente contém as palavras digitadas vêm primeiro
function ranquear(sug, termo) {
  const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const palavras = norm(termo).split(/\s+/).filter(w => w.length > 1);
  const score = s => { const r = norm(s.rua); let n = 0; for (const w of palavras) if (r.includes(w)) n++; return n; };
  return sug.map(s => ({ s, n: score(s) })).sort((a, b) => b.n - a.n).map(x => x.s);
}
// cache simples em memória (60s) para respostas instantâneas em re-digitação
const geoCache = new Map();
app.get('/api/geocode', async (req, res) => {
  const q = limpaQ(req.query.q || '');
  if (q.length < 3) return res.json({ sugestoes: [] });
  const key = q.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.t < 60000) return res.json({ sugestoes: hit.v });
  let sug = [];
  try { sug = await viaPhoton(q); } catch (e) { /* tenta fallback */ }
  if (!sug.length) { try { sug = await viaNominatim(q); } catch (e) { /* vazio */ } }
  // remove duplicados (mesma rua+bairro) e ranqueia pela relevância do texto digitado
  const vistos = new Set();
  sug = ranquear(sug, q).filter(s => { const k = (s.rua + '|' + s.bairro).toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
  const out = sug.slice(0, 6);
  geoCache.set(key, { t: Date.now(), v: out });
  res.json({ sugestoes: out });
});

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
  // endereço-base do cliente (usado no mapa de visualização)
  let endereco = null;
  if (b.role === 'cliente') {
    const e = b.endereco || {};
    if (!e.rua || !e.numero || !e.bairro || !e.cidade) erros.endereco = 'Informe seu endereço (rua, número, bairro e cidade)';
    else endereco = JSON.stringify({ rua: e.rua, numero: e.numero, bairro: e.bairro, cidade: e.cidade, uf: e.uf || '', lat: e.lat, lng: e.lng });
  }
  if (Object.keys(erros).length) return res.status(400).json({ erros });
  if (Users.get.get(email)) return res.status(409).json({ erros: { email: 'Este e-mail já está cadastrado' } });
  const senha_hash = await bcrypt.hash(String(b.senha), 10);
  Users.insert.run({
    email, nome: String(b.nome).trim(), telefone: b.telefone, cpf: b.cpf, genero: b.genero, role: b.role,
    senha_hash, placa: b.role==='motoboy'? String(b.placa).toUpperCase():null,
    modelo: b.role==='motoboy'? b.modelo:null, cnh: b.role==='motoboy'? b.cnh:null,
    endereco,
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
  // distância: usa a rota que o cliente viu no mapa (Google Directions), com trava
  // de segurança contra manipulação — precisa estar entre 0,8x e 3,5x a linha reta.
  let km, min;
  const cKm = Number(b.km), cMin = Number(b.min);
  if (o.lat && o.lng && d.lat && d.lng && cKm > 0) {
    const hv = haversine({lat:+o.lat,lng:+o.lng},{lat:+d.lat,lng:+d.lng});
    if (hv > 0 && cKm >= hv*0.8 && cKm <= hv*3.5) {
      km = Math.round(cKm*10)/10;
      min = (cMin > 0) ? Math.round(cMin) : Math.max(4, Math.round(km/22*60));
    }
  }
  if (km == null) { const r = await rotaKm(o, d); km = r.km; min = r.min; }  // fallback
  const q = cotar(km, min, dim.peso);
  const u = Users.get.get(req.user.email);
  const ride = {
    id: 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    cliente_email: u.email, cliente_nome: u.nome,
    origem: JSON.stringify(o), destino: JSON.stringify(d),
    tipo: b.tipo || CFG.tipos[0], dim: JSON.stringify(dim), peso: dim.peso,
    km, min_est: min, valor: q.valor, comissao: q.comissao, valor_motoboy: q.valorMotoboy,
    precos: JSON.stringify({ subtotal: q.subtotal, fator: q.fator, pesoExtra: q.pesoExtra, taxaServico: q.taxaServico, comissao: q.comissao, totalRetido: q.totalRetido }),
    criada_em: new Date().toISOString(),
  };
  Rides.insert.run(ride);
  res.json(rideOut(Rides.get.get(ride.id), 'cliente'));
});

app.get('/api/rides/mine', auth, (req, res) => res.json(Rides.mine.all(req.user.email).map(r => rideOut(r, 'cliente'))));
app.get('/api/rides/available', auth, role('motoboy'), (req, res) => res.json(Rides.available.all().map(r => rideOut(r, 'motoboy'))));
app.get('/api/rides/current', auth, role('motoboy'), (req, res) => {
  const ativa = Rides.byMotoboy.all(req.user.email).find(r => ['aceita','a_caminho','aguardando','em_andamento'].includes(r.status));
  res.json(ativa ? rideOut(ativa, 'motoboy') : null);
});
app.get('/api/rides/motoboy', auth, role('motoboy'), (req, res) => res.json(Rides.byMotoboy.all(req.user.email).map(r => rideOut(r, 'motoboy'))));

// corrida completa (com fotos) — para o recibo e a prévia do motoboy
app.get('/api/rides/:id', auth, (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'nao_encontrada' });
  const u = req.user;
  let view = null;
  if (u.role === 'admin') view = 'admin';
  else if (u.role === 'cliente' && r.cliente_email === u.email) view = 'cliente';
  else if (u.role === 'motoboy' && r.motoboy_email === u.email) view = 'motoboy';
  if (!view) return res.status(403).json({ error: 'nao_permitido' });
  res.json(rideOut(r, view, true));
});

app.post('/api/rides/:id/accept', auth, role('motoboy'), (req, res) => {
  const u = Users.get.get(req.user.email);
  const info = Rides.accept.run(u.email, u.nome, new Date().toISOString(), req.params.id); // atômico: só a 1ª aceita vence
  if (info.changes === 0) return res.status(409).json({ error: 'indisponivel' });
  res.json(rideOut(Rides.get.get(req.params.id), 'motoboy'));
});

app.post('/api/rides/:id/status', auth, role('motoboy'), (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r || r.motoboy_email !== req.user.email) return res.status(403).json({ error: 'nao_sua' });
  const to = req.body?.status;
  const now = new Date().toISOString();
  if (to === 'a_caminho') Rides.setStatus.run('a_caminho', r.id);
  else if (to === 'aguardando') { Rides.setStamp.run('aguardando', now, null, null, null, r.id); Rides.setAguardou.run(now, r.id); }
  else if (to === 'em_andamento') {
    if (!r.foto_coleta) return res.status(400).json({ error: 'foto_coleta_obrigatoria' });
    // calcula a espera (tempo no endereço acima do tempo grátis)
    if (r.aguardou_em) {
      const minWait = Math.max(0, Math.round((Date.now() - new Date(r.aguardou_em).getTime()) / 60000));
      const cobravel = Math.max(0, minWait - CFG.esperaFreeMin);
      const espera = Math.round(cobravel * CFG.esperaPorMin * 100) / 100;
      if (espera > 0) Rides.setEspera.run(espera, minWait, r.id);
    }
    Rides.setStamp.run('em_andamento', null, now, null, null, r.id);
  } else if (to === 'concluida') {
    if (!r.foto_entrega) return res.status(400).json({ error: 'foto_entrega_obrigatoria' });
    Rides.setStamp.run('concluida', null, null, now, 1, r.id);
    const cur = Rides.get.get(r.id);
    Users.addSaldoRide.run((cur.valor_motoboy || 0) + (cur.espera || 0), r.motoboy_email); // líquido + espera (100% do motoboy)
  } else return res.status(400).json({ error: 'status_invalido' });
  res.json(rideOut(Rides.get.get(r.id), 'motoboy'));
});

// motoboy registra a foto da coleta / entrega (obrigatórias)
app.post('/api/rides/:id/foto', auth, role('motoboy'), (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r || r.motoboy_email !== req.user.email) return res.status(403).json({ error: 'nao_sua' });
  const { tipo, data } = req.body || {};
  if (!data || !/^data:image\//.test(String(data)) || String(data).length > 1600000) return res.status(400).json({ error: 'foto_invalida' });
  if (tipo === 'coleta') Rides.setFotoColeta.run(data, r.id);
  else if (tipo === 'entrega') Rides.setFotoEntrega.run(data, r.id);
  else return res.status(400).json({ error: 'tipo_invalido' });
  res.json(rideOut(Rides.get.get(r.id), 'motoboy'));
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

// cliente adiciona caixinha (gorjeta) ao motoboy — 100% repassado
app.post('/api/rides/:id/gorjeta', auth, role('cliente'), (req, res) => {
  const r = Rides.get.get(req.params.id);
  if (!r || r.cliente_email !== req.user.email) return res.status(403).json({ error: 'nao_sua' });
  if (!(r.status === 'concluida' || r.paga)) return res.status(400).json({ error: 'corrida_nao_concluida' });
  const v = Math.round(Math.max(0, Math.min(500, +req.body?.valor || 0)) * 100) / 100;
  if (!(v > 0)) return res.status(400).json({ error: 'valor_invalido' });
  const novo = Math.round(((r.gorjeta || 0) + v) * 100) / 100;
  Rides.setGorjeta.run(novo, r.id);
  if (r.motoboy_email) Users.addSaldo.run(v, r.motoboy_email);
  res.json(rideOut(Rides.get.get(r.id), 'cliente'));
});

// cliente atualiza o endereço-base (mapa de visualização)
app.post('/api/me/endereco', auth, (req, res) => {
  const e = req.body || {};
  if (!e.rua || !e.numero || !e.bairro || !e.cidade) return res.status(400).json({ error: 'endereco_incompleto' });
  const endereco = JSON.stringify({ rua: e.rua, numero: e.numero, bairro: e.bairro, cidade: e.cidade, uf: e.uf || '', lat: e.lat, lng: e.lng });
  Users.updateEndereco.run(endereco, req.user.email);
  res.json(pub(Users.get.get(req.user.email)));
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
app.get('/api/admin/rides', auth, role('admin'), (req, res) => res.json(Rides.all.all().map(r => rideOut(r, 'admin'))));

// Serialização por perfil:
//  - motoboy: só vê o que RECEBE (valorMotoboy). Nunca o valor do cliente nem as taxas.
//  - cliente: vê o total que paga (valor) e o detalhamento da tarifa.
//  - admin: vê tudo (cliente pagou, motoboy recebeu, taxas retidas).
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
function rideOut(r, view = 'admin', full = false) {
  if (!r) return null;
  const espera = r.espera || 0, esperaMin = r.espera_min || 0, gorjeta = r.gorjeta || 0;
  const b = { id: r.id, clienteNome: r.cliente_nome,
    origem: JSON.parse(r.origem||'{}'), destino: JSON.parse(r.destino||'{}'),
    tipo: r.tipo, dim: JSON.parse(r.dim||'{}'), peso: r.peso, km: r.km, minEst: r.min_est,
    status: r.status, motoboyEmail: r.motoboy_email, motoboyNome: r.motoboy_nome,
    criadaEm: r.criada_em, aceitaEm: r.aceita_em, chegouEm: r.chegou_em, aguardouEm: r.aguardou_em,
    iniciadaEm: r.iniciada_em, concluidaEm: r.concluida_em,
    avalCliente: r.aval_cliente, avalMotoboy: r.aval_motoboy, paga: !!r.paga,
    espera, esperaMin, gorjeta,
    temFotoColeta: !!r.foto_coleta, temFotoEntrega: !!r.foto_entrega };
  if (full) { b.fotoColeta = r.foto_coleta || null; b.fotoEntrega = r.foto_entrega || null; }
  if (view === 'motoboy') return { ...b, valorMotoboy: r.valor_motoboy, recebe: r2((r.valor_motoboy||0) + espera + gorjeta) };
  const p = JSON.parse(r.precos || '{}');
  const total = r2((r.valor||0) + espera + gorjeta);
  if (view === 'cliente') return { ...b, clienteEmail: r.cliente_email, valor: r.valor, fator: p.fator || 1, subtotal: p.subtotal, pesoExtra: p.pesoExtra || 0, total, empresa: EMPRESA };
  // admin — decomposição completa
  return { ...b, clienteEmail: r.cliente_email, valor: r.valor, valorCliente: r.valor, total,
    subtotal: p.subtotal, fator: p.fator || 1, pesoExtra: p.pesoExtra || 0, taxaServico: p.taxaServico, comissao: r.comissao,
    totalRetido: p.totalRetido, valorMotoboy: r.valor_motoboy };
}

// a plataforma (login + painéis) fica em /app; a landing institucional em /
app.get(['/app','/app/*'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// cria as contas demo automaticamente se o banco estiver vazio
function seedDemoIfEmpty(){
  try{
    if(Users.all.all().length>0) return;
    const demo=[
      {email:'cliente@leva.com',senha:'123456',role:'cliente',nome:'Carla Souza',genero:'f',telefone:'(19) 99999-0001',cpf:'111.111.111-11',endereco:{rua:'Avenida Bandeirantes',numero:'500',bairro:'Vila Pinheiro',cidade:'Mogi Guaçu',uf:'SP',lat:-22.3553508,lng:-46.9446673}},
      {email:'motoboy@leva.com',senha:'123456',role:'motoboy',nome:'Motoboy Demo',genero:'m',telefone:'(19) 99999-0002',cpf:'222.222.222-22',placa:'ABC1D23',modelo:'Honda CG 160',cnh:'01234567890'},
      {email:'admin@leva.com',senha:'admin123',role:'admin',nome:'Admin LEVA',genero:'n',telefone:'(19) 99999-0003',cpf:'333.333.333-33'},
    ];
    for(const d of demo){
      Users.insert.run({email:d.email,nome:d.nome,telefone:d.telefone,cpf:d.cpf,genero:d.genero,role:d.role,
        senha_hash:bcrypt.hashSync(d.senha,10),placa:d.placa||null,modelo:d.modelo||null,cnh:d.cnh||null,
        endereco:d.endereco?JSON.stringify(d.endereco):null,
        created_at:new Date().toISOString()});
    }
    console.log('Contas demo criadas.');
  }catch(e){ console.log('seed demo falhou:', e.message); }
}
seedDemoIfEmpty();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LEVA server em http://localhost:${PORT}  (maps: ${MAPS_KEY ? 'configurado' : 'SEM CHAVE'})`));
