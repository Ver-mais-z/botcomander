# Whaticket Community - Guia de Instalação

Este guia descreve como configurar e executar o projeto **Whaticket Community** em seu ambiente local, incluindo backend, banco de dados, Redis e frontend.

## Etapa 1: Criação do Banco de Dados (MariaDB)

Crie o container do banco de dados usando Docker:

```bash
docker run -d \
  --name whaticketdb \
  -p 3306:3306 \
  -e MARIADB_ROOT_PASSWORD=strongpassword \
  -e MARIADB_DATABASE=whaticket \
  -e MARIADB_USER=whaticket \
  -e MARIADB_PASSWORD=whaticket \
  -v whaticketdb_data:/var/lib/mysql \
  --health-cmd='mysqladmin ping -pstrongpassword --silent' \
  --health-interval=10s --health-timeout=5s --health-retries=5 \
  mariadb:latest \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_bin
```

## Etapa 2: Criação do Redis

Crie o container do Redis para cache e limitação de requisições:

```bash
docker run -d \
  --name whaticketredis \
  -p 6379:6379 \
  -v whaticketredis_data:/data \
  redis:latest \
  redis-server --appendonly yes
```

## Dependências do Puppeteer

Caso nunca tenha instalado, execute o comando abaixo:

```bash
sudo apt install -y libxshmfence-dev libgbm-dev wget unzip fontconfig locales gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils
```

## Etapa 3: Configuração do Backend

Acesse a pasta `/backend` e crie um arquivo `.env` baseado no exemplo abaixo:

```env
NODE_ENV=DEVELOPMENT
BACKEND_URL=http://localhost
FRONTEND_URL=http://localhost:3000
PROXY_PORT=8080
PORT=8080
DB_HOST=127.0.0.1
DB_DIALECT=mysql
DB_USER=whaticket
DB_PASS=whaticket
DB_NAME=whaticket
JWT_SECRET=3123123213123
JWT_REFRESH_SECRET=75756756756
REDIS_URI=redis://127.0.0.1:6379
REDIS_OPT_LIMITER_MAX=1
REDIS_OPT_LIMITER_DURATION=3000
```

Rode os seguintes comandos:

```bash
npm install               # Instala as dependências
npm run build             # Compila a aplicação
npx sequelize db:migrate  # Cria as tabelas no banco
npx sequelize db:seed:all # Popula dados iniciais
```

Para iniciar o backend:

```bash
npm start
```

## Etapa 4: Configuração do Frontend

Acesse a pasta `/frontend` e crie/edite o arquivo `.env` adicionando:

```env
REACT_APP_BACKEND_URL=http://localhost:8080/
```

Instale as dependências:

```bash
npm install
```

Inicie o frontend:

```bash
export NODE_OPTIONS=--openssl-legacy-provider
npm start
```

## Credenciais Padrão

- **Usuário:** admin@whaticket.com
- **Senha:** admin

---

## Observações Importantes

- Certifique-se de que as portas 3306 (MariaDB), 6379 (Redis), 8080 (Backend) e 3000 (Frontend) estejam disponíveis
- O Redis é utilizado para cache e limitação de requisições (rate limiting)
- As configurações de limiter podem ser ajustadas através das variáveis `REDIS_OPT_LIMITER_MAX` e `REDIS_OPT_LIMITER_DURATION`
- Altere as senhas padrão em ambiente de produção