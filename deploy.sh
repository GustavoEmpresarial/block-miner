#!/bin/bash

# ============================================================================
# BlockMiner - Deploy Script for blockminer.space
# ============================================================================

set -e  # Exit on error

echo "🚀 BlockMiner Deployment Script"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found!${NC}"
    echo ""
    echo "Options:"
    echo "  1. Copy from .env.production template"
    echo "  2. Copy from .env.example template"
    echo "  3. Exit and create manually"
    echo ""
    read -p "Choose option (1-3): " choice
    
    case $choice in
        1)
            if [ -f .env.production ]; then
                cp .env.production .env
                echo -e "${GREEN}✅ Copied .env from .env.production${NC}"
            else
                echo -e "${RED}❌ .env.production not found!${NC}"
                exit 1
            fi
            ;;
        2)
            if [ -f .env.example ]; then
                cp .env.example .env
                echo -e "${GREEN}✅ Copied .env from .env.example${NC}"
            else
                echo -e "${RED}❌ .env.example not found!${NC}"
                exit 1
            fi
            ;;
        3)
            echo -e "${YELLOW}Exiting...${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            exit 1
            ;;
    esac
    
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT: Edit .env and update:${NC}"
    echo "  - JWT_SECRET (generate with: openssl rand -hex 64)"
    echo "  - ADMIN_EMAIL"
    echo "  - ADMIN_SECURITY_CODE"
    echo "  - WITHDRAWAL_PRIVATE_KEY"
    echo "  - ZERADS_CALLBACK_PASSWORD"
    echo ""
    read -p "Press Enter after editing .env..."
fi

# Verify critical env vars
echo "🔍 Checking environment variables..."
source .env

if [ "$JWT_SECRET" = "ALTERE_ISSO_GERE_UM_NOVO_SECRET_USANDO_OPENSSL_RAND_HEX_64" ]; then
    echo -e "${RED}❌ JWT_SECRET not set! Generate one with: openssl rand -hex 64${NC}"
    exit 1
fi

if [ "$ADMIN_SECURITY_CODE" = "ALTERE_ISSO_SENHA_FORTE_ADMIN" ]; then
    echo -e "${RED}❌ ADMIN_SECURITY_CODE not set!${NC}"
    exit 1
fi

if [ "$WITHDRAWAL_PRIVATE_KEY" = "ALTERE_ISSO_PRIVATE_KEY_DA_HOT_WALLET" ]; then
    echo -e "${YELLOW}⚠️  WITHDRAWAL_PRIVATE_KEY not set (withdrawals will not work)${NC}"
    read -p "Continue anyway? (y/n): " continue
    if [ "$continue" != "y" ]; then
        exit 1
    fi
fi

if [ -z "$CORS_ORIGINS" ]; then
    echo -e "${YELLOW}⚠️  CORS_ORIGINS is empty (will use localhost only)${NC}"
    echo "For production, set: CORS_ORIGINS=https://blockminer.space,https://www.blockminer.space"
    read -p "Continue anyway? (y/n): " continue
    if [ "$continue" != "y" ]; then
        exit 1
    fi
fi

if [ -z "$ZERADS_CALLBACK_PASSWORD" ] || [ "$ZERADS_CALLBACK_PASSWORD" = "password" ]; then
    echo -e "${YELLOW}⚠️  ZERADS_CALLBACK_PASSWORD is default/empty (callbacks can fail or be insecure)${NC}"
    read -p "Continue anyway? (y/n): " continue
    if [ "$continue" != "y" ]; then
        exit 1
    fi
fi

if [ -z "$ZERADS_PTC_EXCHANGE_RATE" ] || [ "$ZERADS_PTC_EXCHANGE_RATE" = "0" ]; then
    echo -e "${YELLOW}⚠️  ZERADS_PTC_EXCHANGE_RATE is 0 (USDC rewards will stay 0.00000000)${NC}"
    read -p "Continue anyway? (y/n): " continue
    if [ "$continue" != "y" ]; then
        exit 1
    fi
fi

echo -e "${GREEN}✅ Environment variables OK${NC}"
echo ""

# Check if SSL certificates exist
echo "🔐 Checking SSL certificates..."
if [ ! -f nginx/certs/cert.pem ] || [ ! -f nginx/certs/key.pem ]; then
    echo -e "${YELLOW}⚠️  SSL certificates not found!${NC}"
    echo ""
    echo "You need SSL certificates for HTTPS. Options:"
    echo "  1. Generate with Let's Encrypt (recommended)"
    echo "  2. Use self-signed certificate (for testing only)"
    echo "  3. Skip and configure later"
    echo ""
    read -p "Choose option (1-3): " cert_choice
    
    case $cert_choice in
        1)
            echo ""
            echo "Run this command on your server:"
            echo ""
            echo -e "${GREEN}sudo certbot certonly --standalone -d blockminer.space -d www.blockminer.space${NC}"
            echo ""
            echo "Then copy certificates:"
            echo -e "${GREEN}sudo cp /etc/letsencrypt/live/blockminer.space/fullchain.pem nginx/certs/cert.pem${NC}"
            echo -e "${GREEN}sudo cp /etc/letsencrypt/live/blockminer.space/privkey.pem nginx/certs/key.pem${NC}"
            echo -e "${GREEN}sudo chmod 644 nginx/certs/cert.pem${NC}"
            echo -e "${GREEN}sudo chmod 600 nginx/certs/key.pem${NC}"
            echo ""
            read -p "Press Enter after setting up certificates..."
            ;;
        2)
            echo "Generating self-signed certificate..."
            mkdir -p nginx/certs
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
                -keyout nginx/certs/key.pem \
                -out nginx/certs/cert.pem \
                -subj "/C=US/ST=State/L=City/O=BlockMiner/CN=blockminer.space"
            chmod 644 nginx/certs/cert.pem
            chmod 600 nginx/certs/key.pem
            echo -e "${GREEN}✅ Self-signed certificate generated${NC}"
            ;;
        3)
            echo -e "${YELLOW}⚠️  Skipping SSL setup. HTTPS will not work!${NC}"
            ;;
    esac
else
    echo -e "${GREEN}✅ SSL certificates found${NC}"
fi

echo ""

# Check Docker
echo "🐳 Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found! Install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ docker-compose not found! Install docker-compose first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker OK${NC}"
echo ""

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p data
mkdir -p logs
mkdir -p backups
mkdir -p nginx/certs
echo -e "${GREEN}✅ Directories created${NC}"
echo ""

# Build and start
echo "🔨 Building Docker images..."
docker-compose build

echo ""
echo "🚀 Starting services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

# Check if services are running
echo ""
echo "🔍 Checking services..."
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✅ Services are running!${NC}"
else
    echo -e "${RED}❌ Services failed to start!${NC}"
    echo ""
    echo "Check logs with:"
    echo "  docker-compose logs -f"
    exit 1
fi

echo ""
echo "================================================"
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo "================================================"
echo ""
echo "📊 Service Status:"
docker-compose ps
echo ""
echo "🌐 Access your app:"
echo "  - Local: http://localhost:3000"
echo "  - Production: https://blockminer.space"
echo ""
echo "📝 Useful commands:"
echo "  - View logs: docker-compose logs -f"
echo "  - View app logs: docker-compose logs -f app"
echo "  - View nginx logs: docker-compose logs -f nginx"
echo "  - Restart: docker-compose restart"
echo "  - Stop: docker-compose down"
echo "  - Rebuild: docker-compose up -d --build"
echo ""
echo "🔐 Admin Access:"
echo "  - URL: https://blockminer.space/admin/login.html"
echo "  - Email: $ADMIN_EMAIL"
echo "  - Security Code: (check your .env file)"
echo ""
echo "📖 For more info, read DOMAIN_SETUP.md"
echo ""
