# Setup SSL com Let's Encrypt

## Pré-requisitos
- Docker e Docker Compose instalados
- Um domínio apontando para o servidor
- Portas 80 e 443 abertas no firewall

## Passos

### 1. Criar pasta para certificados
```bash
mkdir -p nginx/certs
```

### 2. Obter certificado Let's Encrypt (primeiro uso)

**Opção A: Local (antes de fazer deploy)**
```bash
# Instalar certbot
sudo apt-get install certbot python3-certbot-nginx  # Linux
# ou
brew install certbot  # macOS

# Gerar certificado auto-assinado temporário pro teste local
openssl req -x509 -newkey rsa:4096 -nodes -out nginx/certs/cert.pem -keyout nginx/certs/key.pem -days 365 \
  -subj "/CN=localhost"
```

**Opção B: No servidor em produção**

1. Subir o Docker Compose SEM os certificados (vai dar erro no Nginx):
```bash
docker-compose up -d
```

2. Rodar Certbot dentro/fora do container:
```bash
# Fora do Docker (deve estar instalado)
sudo certbot certonly --standalone \
  -d seu-dominio.com \
  -d admin.seu-dominio.com \
  --agree-tos -n --email seu-email@exemplo.com
```

3. Copiar certificados para `nginx/certs/`:
```bash
sudo cp /etc/letsencrypt/live/seu-dominio.com/fullchain.pem nginx/certs/cert.pem
sudo cp /etc/letsencrypt/live/seu-dominio.com/privkey.pem nginx/certs/key.pem
sudo chown $USER:$USER nginx/certs/*
```

### 3. Subir os containers
```bash
docker-compose up -d
```

### 4. Renovar certificado (automático com Certbot, mas manual aqui)
```bash
# A cada 3 meses
sudo certbot renew --quiet
sudo cp /etc/letsencrypt/live/seu-dominio.com/fullchain.pem nginx/certs/cert.pem
sudo cp /etc/letsencrypt/live/seu-dominio.com/privkey.pem nginx/certs/key.pem
docker-compose restart nginx
```

## Ou: Automático com Traefik (alternativa)
Se preferir automatizar tudo, use Traefik ao invés de Nginx — ele já vem com Let's Encrypt integrado.

## Verificar setup
```bash
# Testar HTTPS
curl -k https://seu-dominio.com

# Ver logs do Nginx
docker-compose logs nginx

# Ver logs da app
docker-compose logs app
```
