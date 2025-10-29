# Google Cloud Deployment Guide

This guide explains how to deploy CryptoSentinel to Google Cloud Platform.

## Prerequisites

1. **Google Cloud Account**: Sign up at [cloud.google.com](https://cloud.google.com)
2. **gcloud CLI**: Install from [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install)
3. **Docker** (for Cloud Run): Install from [docker.com](https://www.docker.com/products/docker-desktop)
4. **Billing Enabled**: Enable billing on your Google Cloud project

## Quick Start

```bash
# 1. Authenticate
gcloud auth login

# 2. Set your project
gcloud config set project YOUR_PROJECT_ID

# 3. Enable required APIs
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable sql-component.googleapis.com

# 4. Run deployment script
./deploy-to-gcloud.sh
```

## Deployment Options

### Option 1: Cloud Run (Recommended)

Cloud Run is serverless and scales automatically. Best for production.

**Steps:**
1. Build and push Docker image
2. Deploy to Cloud Run
3. Configure environment variables

**Manual deployment:**
```bash
# Build
docker build -t gcr.io/YOUR_PROJECT_ID/cryptosentinel-proxy:latest .

# Push
docker push gcr.io/YOUR_PROJECT_ID/cryptosentinel-proxy:latest

# Deploy
gcloud run deploy cryptosentinel-proxy \
    --image gcr.io/YOUR_PROJECT_ID/cryptosentinel-proxy:latest \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --port 3003
```

### Option 2: App Engine

Traditional PaaS deployment option.

**Steps:**
```bash
gcloud app deploy app.yaml
```

### Option 3: Cloud Build (CI/CD)

Automated builds and deployments from Git.

**Steps:**
1. Connect your GitHub repository to Cloud Build
2. Configure build triggers
3. Push to trigger automatic deployment

## Database Setup

### Cloud SQL PostgreSQL

```bash
# Create Cloud SQL instance
gcloud sql instances create cryptosentinel-db \
    --database-version=POSTGRES_14 \
    --tier=db-f1-micro \
    --region=us-central1

# Create database
gcloud sql databases create cryptosentinel --instance=cryptosentinel-db

# Create user
gcloud sql users create cryptouser \
    --instance=cryptosentinel-db \
    --password=YOUR_SECURE_PASSWORD
```

### Environment Variables

Set these in Cloud Run/App Engine:

```bash
DB_HOST=<cloud-sql-connection-name>
DB_NAME=cryptosentinel
DB_USER=cryptouser
DB_PASSWORD=<secret>
DB_PORT=5432
```

## Storage Setup

The application uses local file storage by default. For production, consider:

1. **Cloud Storage**: Upload storage files to Cloud Storage bucket
2. **Cloud SQL**: Store all data in database (recommended)

## Security

1. **API Keys**: Store Binance API keys in Secret Manager
2. **Database**: Use Cloud SQL Auth Proxy or Private IP
3. **CORS**: Configure CORS in Cloud Run settings
4. **Authentication**: Consider adding IAM authentication

## Monitoring

- **Cloud Logging**: Automatic logs in Cloud Console
- **Cloud Monitoring**: Set up alerts for errors
- **Error Reporting**: Enable for production debugging

## Cost Estimation

- **Cloud Run**: Pay per request (~$0.40 per million requests)
- **Cloud SQL**: ~$10-30/month for small instance
- **Storage**: Minimal cost for file storage

## Troubleshooting

### Connection Issues
```bash
# Check Cloud SQL connection
gcloud sql connect cryptosentinel-db --user=cryptouser
```

### Logs
```bash
# View Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision" --limit 50
```

### Environment Variables
```bash
# Update environment variables
gcloud run services update cryptosentinel-proxy \
    --update-env-vars "KEY=VALUE"
```

## Frontend Deployment

For the React frontend, deploy to:

1. **Firebase Hosting**
2. **Cloud Storage + Cloud CDN**
3. **App Engine Static Files**

## Support

For issues:
1. Check Cloud Console logs
2. Verify database connectivity
3. Check environment variables
4. Review Cloud Run metrics

## References

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Documentation](https://cloud.google.com/sql/docs)
- [Cloud Build Documentation](https://cloud.google.com/build/docs)

