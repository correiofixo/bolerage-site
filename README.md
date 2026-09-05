# Bolerage F.D. — Site de sorteio e avaliação da pelada

Aplicação web com banco de dados próprio (Node.js + Express + SQLite) para:
confirmação de presença, sorteio dos times (Brasil, Argentina, Alemanha, Itália, Holanda),
votação de performance e ranking histórico, com PIN de 4 dígitos por jogador.

## Estrutura do projeto

```
bolerage-fd/
  server.js          # backend (Express + SQLite) — API + serve o front-end
  package.json
  .env.example
  data/               # banco SQLite (criado sozinho na primeira execução; não vai pro Git)
  public/
    index.html
    styles.css
    app.js
    assets/
      logo.jpg
      favicon.png
```

## Rodando localmente

Requer Node.js 18 ou mais recente.

```bash
npm install
npm start
```

Acesse http://localhost:3000. Na primeira execução o sistema já cria:
- 25 jogadores de exemplo (PINs `1001`–`1022` para linha, `2001`–`2003` para goleiros) — **troque nomes e PINs reais na aba Admin antes de usar com o grupo**.
- PIN administrativo inicial `9999` — **troque antes de publicar**.
- A próxima rodada (domingo mais próximo) já agendada.

## Publicando no GitHub

```bash
cd bolerage-fd
git init
git add .
git commit -m "Bolerage F.D. — versão inicial"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/bolerage-fd.git
git push -u origin main
```

O arquivo `.gitignore` já exclui `node_modules/`, `data/` (o banco) e `.env` — o banco de dados
**não deve ir para o repositório**, ele é gerado no próprio servidor.

## Publicando no DigitalOcean

Duas opções — recomendo a primeira pela simplicidade (bate com o critério de "menor
complexidade operável" que guiou as escolhas técnicas deste projeto).

### Opção A — App Platform (recomendado)

1. No painel da DigitalOcean, **Create → Apps** → conecte sua conta do GitHub e escolha o
   repositório `bolerage-fd`.
2. A App Platform detecta automaticamente que é uma app Node (`npm install` + `npm start`).
3. Em **Settings → App-Level Environment Variables**, não é necessário definir `PORT`
   (a plataforma injeta sozinha). Se quiser trocar o caminho do banco, defina `DB_PATH`.
4. **Importante:** por padrão, o App Platform recria o container a cada deploy, o que apagaria
   o banco SQLite. Em **Settings → seu componente → Storage**, adicione um **Volume persistente**
   montado, por exemplo, em `/workspace/data`, e defina a env var `DB_PATH=/workspace/data/bolerage.db`.
   Alternativamente, use a Opção B (Droplet) se preferir controlar o disco diretamente.
5. Em **Settings → Domains**, adicione `www.bolerage.com.br` (e `bolerage.com.br` com redirect).
   A DigitalOcean mostra um registro **CNAME** (para `www`) ou **A** (para o domínio raiz) —
   configure isso no painel DNS onde você registrou o domínio.
6. O certificado HTTPS é emitido e renovado automaticamente pela plataforma.

### Opção B — Droplet (mais controle, um pouco mais de manutenção)

1. Crie um Droplet Ubuntu (o menor plano já é suficiente para esse uso).
2. Instale Node.js, Git e o `build-essential` (necessário para compilar dependências nativas
   como o SQLite, caso não exista binário pré-compilado para a versão do Droplet):
   ```bash
   sudo apt update && sudo apt install -y nodejs npm git build-essential python3
   ```
3. Clone o repositório e instale:
   ```bash
   git clone https://github.com/SEU_USUARIO/bolerage-fd.git
   cd bolerage-fd
   npm install --production
   ```
4. Rode com PM2 para manter o processo vivo e reiniciar sozinho:
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name bolerage
   pm2 save
   pm2 startup   # siga a instrução impressa para iniciar com o servidor
   ```
5. Instale Nginx como proxy reverso (porta 80/443 → porta 3000 do Node) e Certbot para HTTPS:
   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```
   Configure um site em `/etc/nginx/sites-available/bolerage` apontando `server_name
   bolerage.com.br www.bolerage.com.br;` para `proxy_pass http://localhost:3000;`, ative com
   `ln -s` em `sites-enabled`, depois rode `sudo certbot --nginx` para emitir o HTTPS.
6. No DNS do domínio, aponte um registro **A** de `bolerage.com.br` e `www.bolerage.com.br`
   para o IP do Droplet.
7. Faça backup do arquivo `data/bolerage.db` periodicamente (é o banco inteiro em um único
   arquivo — copiar já é o backup).

## Segurança — leia antes de publicar

- O login por PIN de 4 dígitos é intencionalmente simples (sem e-mail, sem senha), conforme
  pedido na especificação original. Isso é adequado para uso interno de um grupo, mas é fraco
  contra tentativa de adivinhação por força bruta. Já incluí um limite de 20 tentativas de
  login a cada 5 minutos por IP; ainda assim, trate isso como um sistema de baixa segurança
  para uso casual — não reaproveite esses PINs em nada sensível.
- Troque o PIN administrativo padrão (`9999`) assim que publicar.
- O "modo de teste — simular horário" no painel Admin agora afeta **o site inteiro** (não só
  quem está testando), porque o horário simulado fica salvo no banco do servidor. Use-o só em
  homologação e clique em "Usar horário real" antes de liberar para o grupo de verdade.

## Diferenças em relação ao protótipo anterior

A versão anterior era um artefato do Claude.ai (armazenamento via `window.storage`, que só
funciona dentro do Claude.ai). Esta versão é uma aplicação Node.js + SQLite independente,
publicável em qualquer host — as janelas de horário e as regras de confirmação/sorteio/votação
agora são validadas no servidor (não só escondidas na interface), o que é necessário para um
site público de verdade.
