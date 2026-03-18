#!/bin/bash
set -e

# ============================================
# LYRA DEPLOYMENT SCRIPT FOR HETZNER VPS
# ============================================
# Usage: ./scripts/deploy-to-hetzner.sh <VPS_IP> <SSH_USER>

VPS_IP=${1:-}
SSH_USER=${2:-root}

if [ -z "$VPS_IP" ]; then
    echo "Usage: ./scripts/deploy-to-hetzner.sh <VPS_IP> <SSH_USER>"
    echo "Example: ./scripts/deploy-to-hetzner.sh 192.168.1.100 root"
    exit 1
fi

echo "📦 Deploying Lyra Agent to Hetzner VPS..."
echo "VPS: $VPS_IP | User: $SSH_USER"

# 1. Connect and install dependencies
echo "🔧 Installing Docker and dependencies..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    set -e
    apt-get update
    apt-get install -y docker.io docker-compose curl git wget rsync ufw

    # Start Docker service
    systemctl start docker
    systemctl enable docker

    # Create openclaw directory
    mkdir -p /opt/lyra-agent
    cd /opt/lyra-agent
EOF

# 2. Copy code to VPS — SECURITY: use rsync with excludes instead of scp -r .
echo "📤 Syncing code to VPS (excluding secrets, .git, node_modules)..."
rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='!.env.example' \
    --exclude='secrets.json' \
    --exclude='logs/' \
    --exclude='evals/results/' \
    --exclude='.DS_Store' \
    . "$SSH_USER@$VPS_IP:/opt/lyra-agent/"

# 3. Create .env file on VPS
echo "📝 Creating .env file (you'll need to fill in secrets)..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    cd /opt/lyra-agent
    if [ ! -f .env ]; then
        cp .env.example .env
        echo "⚠️  You need to fill in your secrets in .env"
        echo "Edit with: nano .env"
    else
        echo "✅ .env already exists (not overwriting)"
    fi
EOF

# 4. Build and start containers
echo "🚀 Building and starting Docker containers..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    cd /opt/lyra-agent
    docker-compose build
    docker-compose up -d

    echo "✅ Containers started!"
    docker-compose ps
EOF

# 5. Set up firewall — SECURITY: only allow SSH and gateway
echo "🔒 Setting up firewall..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    # UFW firewall: only allow SSH + OpenClaw gateway
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment "SSH"
    ufw allow 18789/tcp comment "OpenClaw Gateway"
    # Postgres (5432) and Evolution API (9000) are NOT allowed from outside
    # They are bound to 127.0.0.1 in docker-compose.yml
    echo "y" | ufw enable
    ufw status verbose
    echo "✅ Firewall configured — only SSH (22) and Gateway (18789) open"
EOF

# 6. Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    cd /opt/lyra-agent

    # Wait for Evolution API (localhost only)
    for i in {1..30}; do
        if curl -f http://localhost:9000/api/v1/health &>/dev/null; then
            echo "✅ Evolution API is healthy"
            break
        fi
        echo "Waiting for Evolution API... ($i/30)"
        sleep 2
    done

    # Wait for OpenClaw
    for i in {1..30}; do
        if curl -f http://localhost:18789/api/v1/health &>/dev/null; then
            echo "✅ OpenClaw agent is healthy"
            break
        fi
        echo "Waiting for OpenClaw... ($i/30)"
        sleep 2
    done
EOF

# 7. Set up systemd service for auto-restart
echo "⚙️  Setting up systemd service..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    cat > /etc/systemd/system/lyra-agent.service << 'SYSTEMD'
[Unit]
Description=Lyra AI Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/lyra-agent
ExecStart=/usr/bin/docker-compose up
ExecStop=/usr/bin/docker-compose down
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
SYSTEMD

    systemctl daemon-reload
    systemctl enable lyra-agent
    echo "✅ Systemd service installed"
EOF

# 8. Set up health check monitoring
echo "📊 Setting up health checks..."
ssh "$SSH_USER@$VPS_IP" << 'EOF'
    mkdir -p /opt/lyra-agent/scripts

    cat > /opt/lyra-agent/scripts/health-check.sh << 'HEALTH'
#!/bin/bash
OPENCLAW_URL="http://localhost:18789/api/v1/health"
EVOLUTION_URL="http://localhost:9000/api/v1/health"

openclaw_status=$(curl -s -o /dev/null -w "%{http_code}" "$OPENCLAW_URL")
evolution_status=$(curl -s -o /dev/null -w "%{http_code}" "$EVOLUTION_URL")

if [ "$openclaw_status" != "200" ] || [ "$evolution_status" != "200" ]; then
    echo "❌ Health check failed - OpenClaw: $openclaw_status, Evolution: $evolution_status"
    docker-compose -f /opt/lyra-agent/docker-compose.yml restart
    exit 1
else
    echo "✅ All services healthy"
    exit 0
fi
HEALTH

    chmod +x /opt/lyra-agent/scripts/health-check.sh

    # Add cron job for health checks every 15 minutes
    echo "*/15 * * * * /opt/lyra-agent/scripts/health-check.sh" | crontab -

    # Setup 4 AM UTC daily eval cron (idempotent)
    if [ -f /root/lyra-ai/scripts/setup-eval-cron.sh ]; then
        bash /root/lyra-ai/scripts/setup-eval-cron.sh
    fi
EOF

echo ""
echo "✅ DEPLOYMENT COMPLETE!"
echo ""
echo "📋 NEXT STEPS:"
echo "1. SSH into your VPS: ssh $SSH_USER@$VPS_IP"
echo "2. Edit .env with your secrets: nano /opt/lyra-agent/.env"
echo "3. Restart containers: docker-compose -f /opt/lyra-agent/docker-compose.yml restart"
echo "4. Check logs: docker-compose -f /opt/lyra-agent/docker-compose.yml logs -f"
echo "5. Scan WhatsApp QR code: curl http://localhost:9000/api/v1/messages/qrcode?instance=lyra-whatsapp"
echo ""
echo "🔒 Security:"
echo "   Firewall: Only SSH (22) and Gateway (18789) open"
echo "   Postgres: localhost only (127.0.0.1:5432)"
echo "   Evolution API: localhost only (127.0.0.1:9000)"
echo "   OpenClaw Gateway: http://$VPS_IP:18789 (token auth required)"
echo ""
echo "⚠️  IMPORTANT: Set up TLS with Caddy for production:"
echo "   apt install caddy"
echo "   caddy reverse-proxy --from lyra.yourdomain.com --to localhost:18789"
echo ""
