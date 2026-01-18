# Railway.app Deployment Guide for LibreChat with A4F

This guide walks you through deploying LibreChat with A4F integration to Railway.app.

## Prerequisites

- GitHub account (Railway uses GitHub for authentication)
- A4F API key from https://a4f.co

## Step 1: Sign Up for Railway

1. Go to https://railway.app
2. Click "Login" and sign in with GitHub
3. **No credit card required** for the free tier ($5/month credit)

## Step 2: Create a New Project

1. Click "New Project" in Railway dashboard
2. Select "Deploy from GitHub repo"
3. Connect your GitHub account if not already connected
4. Fork this repository to your GitHub account first, then select it

## Step 3: Add Required Services

Railway needs multiple services. Add them in this order:

### 3.1 Add MongoDB

1. In your project, click "New" → "Database" → "Add MongoDB"
2. Railway will create a MongoDB instance
3. Copy the `MONGO_URI` from the MongoDB service variables

### 3.2 Add MeiliSearch (Optional but recommended)

1. Click "New" → "Template" → Search for "MeiliSearch"
2. Or deploy from Docker image: `getmeili/meilisearch:v1.12.3`
3. Set environment variable: `MEILI_MASTER_KEY=your-secure-key`

### 3.3 Add PostgreSQL for RAG (Optional)

1. Click "New" → "Database" → "Add PostgreSQL"
2. This is needed for the RAG/vector search feature

## Step 4: Configure LibreChat Service

1. Click on your LibreChat service
2. Go to "Variables" tab
3. Add the following environment variables:

### Required Variables

```
# Server Configuration
HOST=0.0.0.0
PORT=3080
NODE_ENV=production

# MongoDB (copy from MongoDB service)
MONGO_URI=${{MongoDB.MONGO_URL}}

# A4F Integration
A4F_API_KEY=your_a4f_api_key_here

# Security - GENERATE NEW VALUES!
# Use: openssl rand -hex 32
JWT_SECRET=<generate-64-char-hex>
JWT_REFRESH_SECRET=<generate-64-char-hex>
CREDS_KEY=<generate-64-char-hex>
CREDS_IV=<generate-32-char-hex>

# Session
SESSION_EXPIRY=1000 * 60 * 15
REFRESH_TOKEN_EXPIRY=(1000 * 60 * 60 * 24) * 7

# Registration
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
ALLOW_SOCIAL_REGISTRATION=false

# MeiliSearch (if added)
MEILI_HOST=http://${{MeiliSearch.RAILWAY_PRIVATE_DOMAIN}}:7700
MEILI_MASTER_KEY=your-meili-master-key

# RAG (if PostgreSQL added)
RAG_API_URL=http://rag_api:8000
```

### Generate Secrets

Run these commands locally to generate secure secrets:

```bash
# JWT_SECRET
openssl rand -hex 32

# JWT_REFRESH_SECRET  
openssl rand -hex 32

# CREDS_KEY
openssl rand -hex 32

# CREDS_IV
openssl rand -hex 16

# MEILI_MASTER_KEY
openssl rand -hex 16
```

## Step 5: Add librechat.yaml Configuration

Railway doesn't support file mounts easily, so we need to embed the config.

### Option A: Use Environment Variable (Recommended)

Add this to your Railway variables:

```
LIBRECHAT_CONFIG_PATH=/app/librechat.yaml
```

Then ensure your `librechat.yaml` is committed to your repository.

### Option B: Use Config Service

Create a separate service that serves the config file.

## Step 6: Deploy

1. Railway will automatically deploy when you push to GitHub
2. Or click "Deploy" manually in the Railway dashboard
3. Wait for the build to complete (5-10 minutes)

## Step 7: Access Your App

1. Go to your LibreChat service in Railway
2. Click "Settings" → "Networking"
3. Click "Generate Domain" to get a public URL
4. Your app will be available at `https://your-app.up.railway.app`

## Step 8: Create Your Account

1. Visit your Railway URL
2. Click "Sign Up" to create an account
3. After creating your admin account, set `ALLOW_REGISTRATION=false` in Railway variables

## Troubleshooting

### App won't start
- Check the "Logs" tab in Railway
- Ensure all required environment variables are set
- Verify MongoDB connection string is correct

### A4F not appearing
- Verify `A4F_API_KEY` is set correctly
- Check that `librechat.yaml` is in the repository root
- Restart the service after adding variables

### Database connection errors
- Use Railway's internal URLs for service-to-service communication
- Format: `${{ServiceName.VARIABLE_NAME}}`

## Cost Estimation

Railway Free Tier: $5/month credit

| Service | Estimated Cost |
|---------|---------------|
| LibreChat API | ~$3-5/month |
| MongoDB | ~$2-3/month |
| MeiliSearch | ~$2-3/month |
| PostgreSQL | ~$2-3/month |

**Total: ~$9-14/month** (exceeds free tier, but good for testing)

For production, consider:
- Railway Pro plan ($20/month)
- Or use MongoDB Atlas free tier + Railway for just the API

## Alternative: Simplified Deployment

If cost is a concern, deploy only the essential services:

1. **LibreChat API** on Railway
2. **MongoDB Atlas** (free tier - 512MB)
3. Skip MeiliSearch and RAG for now

This keeps you within the free tier limits.

## Support

- Railway Docs: https://docs.railway.app
- LibreChat Docs: https://docs.librechat.ai
- LibreChat Discord: https://discord.gg/librechat