# 🚀 Deploy Block Miner (Docker Compose + Nginx do servidor + SQLite)

## Estrutura
```
├── docker-compose.yml         # Sobe apenas a app Node (porta 3000 em localhost)
├── nginx/
│   └── nginx.conf            # Exemplo de config (se você optar por Nginx em container)
├── setup-ssl.sh              # Opcional (se usar Nginx em container)
├── .env                       # Variáveis de ambiente (nunca commitar!)
└── data/                      # SQLite DB (persiste entre restarts)
```

## Quick Start

### 1. Clonar e preparar
```bash
git clone <seu-repo>
cd Block-Miner
```

### 2. Configurar .env
```bash
cp .env.example .env
# Edite .env e preencha pelo menos:
# - JWT_SECRET (obrigatório, >= 32 chars)
# Opcional (recomendado em produção):
# - CORS_ORIGINS=https://seu-dominio.com
```

### 3. Subir containers
```bash
docker compose up -d --build
```

### 4. Configurar Nginx do servidor (reverse proxy)

1) Garanta que a app está acessível localmente no servidor:
```bash
curl -s http://127.0.0.1:3000/api/health
```

2) Crie um site no Nginx apontando para `127.0.0.1:3000` (incluindo WebSocket):

Exemplo (ajuste `server_name` e paths de cert):
```nginx
server {
	listen 80;
	server_name seu-dominio.com;
	return 301 https://$host$request_uri;
}

server {
	listen 443 ssl http2;
	server_name seu-dominio.com;

	ssl_certificate /etc/letsencrypt/live/seu-dominio.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}
}
```

### 5. Verificar
```bash
# Logs da app
docker compose logs -f --tail=200 app

# Health check
curl -s https://seu-dominio.com/api/health
```

## Comandos úteis

```bash
# Parar
docker compose down

# Rebuild (após mudanças no codigo)
docker compose up -d --build

# Ver logs em tempo real
docker compose logs -f

# Reiniciar service específico
docker compose restart app

# Acessar terminal do container
docker compose exec app sh
```

## Renovação SSL
Se você usa Let's Encrypt no servidor, a renovação normalmente é via `certbot`/systemd timer.

## Troubleshooting

**503 Bad Gateway**
- App pode estar caindo; verifique: `docker compose logs app`

**SSL certificate not found**
- Verifique os paths em `/etc/letsencrypt/live/seu-dominio.com/` e rode `sudo certbot --nginx -d seu-dominio.com`

**Porta 80/443 já em uso**
- Se você está usando Nginx do servidor, é normal ele ocupar 80/443 (não use Nginx no Compose)

**Persistência de dados perdida**
- Certificar que `./data` tem permissões: `ls -la data`

## Backup

```bash
# Backup do SQLite
cp data/blockminer.db backups/blockminer-$(date +%Y%m%d).db
```

## Performance

O Nginx do servidor:
- Termina TLS/HTTPS
- Faz reverse proxy e WebSocket

O Docker:
- Restart automático se app cair (`unless-stopped`)
- Isolamento de recursos
- Facilita updates e rollbacks

## Monitoramento

Adicione em `.env`:
```env
# Futuros monitorings
LOG_LEVEL=info
SENTRY_DSN=https://...  # Para error tracking
```

---

**Pronto!** Seu site vai estar em `https://seu-dominio.com` com SSL válido. 🎉
