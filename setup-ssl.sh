#!/bin/bash

# Setup SSL com Let's Encrypt para Block Miner
# Uso: ./setup-ssl.sh seu-dominio.com seu-email@example.com

DOMAIN=${1:-"seusite.com"}
EMAIL=${2:-"admin@seusite.com"}

echo "🔒 Configurando SSL para: $DOMAIN"
echo "📧 Email para renovação: $EMAIL"

# Criar pasta de certificados
mkdir -p nginx/certs

# Parar containers se estiverem rodando
echo "⏹️  Parando containers..."
docker-compose down || true

# Gerar certificado com Certbot
echo "🔑 Obtendo certificado Let's Encrypt..."
docker run --rm -it \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -p 80:80 \
  certbot/certbot certonly \
  --standalone \
  --agree-tos \
  -n \
  -m "$EMAIL" \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  -d "admin.$DOMAIN"

# Copiar certificados para o projeto
echo "📁 Copiando certificados..."
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem nginx/certs/cert.pem
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem nginx/certs/key.pem
sudo chown $USER:$USER nginx/certs/*

# Atualizar .env com domínio correto
echo "⚙️  Atualizando .env com domínio..."
sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN,https://admin.$DOMAIN,https://www.$DOMAIN|g" .env

# Subir containers novamente
echo "🚀 Iniciando containers..."
docker-compose up -d

echo "✅ SSL configurado com sucesso!"
echo "🌐 Seu site está em: https://$DOMAIN"
echo ""
echo "📌 Próxima renovação do certificado em 3 meses"
echo "   Para renovar: certbot renew --quiet && docker-compose restart nginx"
