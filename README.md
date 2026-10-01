# LEVA — Plataforma de entregas por motocicleta

Sistema real (servidor + banco + site) com três perfis — **cliente**, **motoboy** e **admin** —
e integração com **Google Maps** (autocomplete de endereço, mapa, rota por ruas e distância em km).

> Diferente do protótipo em artefato, este projeto roda em um **servidor próprio**, então
> consegue chamar serviços externos (Google Maps) e usar login seguro, banco de dados e API.

---

## 1. Rodar no seu computador (desenvolvimento)

Pré-requisito: ter o **Node.js 18+** instalado (https://nodejs.org).

```bash
npm install          # instala as dependências
npm run seed         # cria as contas demo (cliente, motoboy, admin)
npm start            # inicia o servidor em http://localhost:3000
```

Abra **http://localhost:3000** no navegador.

### Contas demo
| Perfil   | E-mail             | Senha     |
|----------|--------------------|-----------|
| Cliente  | cliente@leva.com   | 123456    |
| Motoboy  | motoboy@leva.com   | 123456    |
| Admin    | admin@leva.com     | admin123  |

Sem a chave do Google Maps, o app funciona com **distância estimada**. Com a chave, o mapa,
o autocomplete e a rota por ruas passam a funcionar de verdade.

---

## 2. Criar a chave do Google Maps (passo a passo)

1. Acesse **https://console.cloud.google.com/** e entre com sua conta Google.
2. No topo, crie um **novo projeto** (ex.: "LEVA") e selecione-o.
3. Ative a **cobrança (billing)**: menu → *Faturamento* → adicionar cartão. O Google tem
   cota gratuita mensal; só cobra acima dela.
4. Menu → *APIs e serviços* → *Biblioteca* e **ative** estas 3 APIs:
   - **Maps JavaScript API** (o mapa)
   - **Places API** (autocomplete de endereços)
   - **Directions API** (rota por ruas e distância)
5. Menu → *APIs e serviços* → *Credenciais* → **Criar credenciais** → **Chave de API**.
   Copie a chave gerada.
6. **Restrinja a chave** (segurança), clicando nela:
   - *Restrições de aplicativo* → **Referenciadores HTTP** → adicione o domínio do seu site
     (ex.: `https://seu-site.com/*` e, para testar, `http://localhost:3000/*`).
   - *Restrições de API* → selecione as 3 APIs acima.
7. Guarde a chave — você vai colá-la na variável `GOOGLE_MAPS_API_KEY`.

> Dica de segurança: para a rota calculada no servidor, o ideal é criar uma **segunda chave**
> restrita por **IP** (a do servidor) e usá-la em `GOOGLE_MAPS_SERVER_KEY`.

---

## 3. Configurar as variáveis

Copie `.env.example` para `.env` e preencha:

```
JWT_SECRET=uma-frase-longa-e-aleatoria
GOOGLE_MAPS_API_KEY=suachaveaqui
```

Reinicie o servidor. No topo do log deve aparecer `maps: configurado`.

---

## 4. Colocar no ar (deploy) — exemplo com Render

1. Crie um repositório no **GitHub** com estes arquivos (o `.gitignore` já ignora `.env` e o banco).
2. Crie conta em **https://render.com** → *New* → *Web Service* → conecte o repositório.
3. Configuração:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Em *Environment* adicione as variáveis: `JWT_SECRET`, `GOOGLE_MAPS_API_KEY`,
   `NODE_ENV=production` (e `GOOGLE_MAPS_SERVER_KEY` se usar a 2ª chave).
5. (Banco) O SQLite grava em disco local. Para o banco **persistir** entre reinícios,
   adicione um **Disk** ao serviço (ex.: 1 GB) montado em `/data` e defina `DB_PATH=/data/leva.db`.
   Alternativa recomendada para produção: migrar para **Postgres** (posso fazer essa migração).
6. Depois do deploy, rode o seed uma vez (Render *Shell*): `npm run seed`.
7. Pegue a URL pública (ex.: `https://leva.onrender.com`) e **adicione-a nas restrições da
   chave do Google Maps** (passo 2.6).

---

## 5. O que já está pronto e o que falta (produção)

**Pronto:** cadastro/login seguro (senha com hash bcrypt + token JWT), "esqueci a senha" com
código de 5 min, pedido de corrida com validação e limite do baú, cotação por distância
(Google Directions no servidor), aceite pelo 1º motoboy, máquina de estados da corrida,
carteira do motoboy (líquido já com a comissão de 18%), metas, avaliações, e painel admin
com indicadores em tempo real.

**Falta para operar com dinheiro/tempo real (próximas partes):**
- **Pagamento** (reserva no cartão + repasse/caixinha): gateway como Mercado Pago, Pagar.me ou Stripe.
- **Envio de e-mail** real no "esqueci a senha": SMTP/SendGrid/Resend (hoje o código aparece na tela em dev).
- **Rastreamento ao vivo (GPS do motoboy no mapa)** e **notificação push** no celular.
- **Banco de produção** (Postgres) e backups.

## Estrutura
```
server.js        API (Express) + regras de negócio + proxy de rota do Google
db.js            Banco (SQLite) e consultas
seed.js          Cria as contas demo
public/index.html  Página + estilos
public/app.js      Aplicativo (frontend) com Google Maps
.env.example     Modelo das variáveis de ambiente
```
