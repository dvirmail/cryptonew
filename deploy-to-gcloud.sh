#!/bin/bash
# Google Cloud deployment script for CryptoSentinel

set -e

echo "🚀 CryptoSentinel Google Cloud Deployment"
echo "=========================================="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "📦 Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Error: Not authenticated with gcloud"
    echo "🔐 Run: gcloud auth login"
    exit 1
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Error: No Google Cloud project set"
    echo "📝 Set it with: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "📋 Project: $PROJECT_ID"
echo ""

# Ask for deployment method
echo "Select deployment method:"
echo "1) Cloud Run (Recommended for serverless)"
echo "2) App Engine"
echo "3) Cloud Build (Automated CI/CD)"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🔨 Building Docker image..."
        docker build -t gcr.io/$PROJECT_ID/cryptosentinel-proxy:latest .
        
        echo ""
        echo "📤 Pushing to Container Registry..."
        docker push gcr.io/$PROJECT_ID/cryptosentinel-proxy:latest
        
        echo ""
        echo "🚀 Deploying to Cloud Run..."
        gcloud run deploy cryptosentinel-proxy \
            --image gcr.io/$PROJECT_ID/cryptosentinel-proxy:latest \
            --platform managed \
            --region us-central1 \
            --allow-unauthenticated \
            --port 3003 \
            --memory 512Mi \
            --cpu 1 \
            --min-instances 0 \
            --max-instances 10 \
            --set-env-vars "DB_HOST=$DB_HOST,DB_NAME=$DB_NAME,DB_USER=$DB_USER,DB_PORT=$DB_PORT" \
            --set-secrets "DB_PASSWORD=db-password:latest"
        
        echo ""
        echo "✅ Deployment complete!"
        echo "🌐 Service URL:"
        gcloud run services describe cryptosentinel-proxy --region us-central1 --format="value(status.url)"
        ;;
    
    2)
        echo ""
        echo "🚀 Deploying to App Engine..."
        gcloud app deploy app.yaml --project=$PROJECT_ID
        
        echo ""
        echo "✅ Deployment complete!"
        echo "🌐 App URL:"
        gcloud app browse
        ;;
    
    3)
        echo ""
        echo "🔨 Triggering Cloud Build..."
        gcloud builds submit --config cloudbuild.yaml
        
        echo ""
        echo "✅ Build triggered! Check status at:"
        echo "https://console.cloud.google.com/cloud-build/builds?project=$PROJECT_ID"
        ;;
    
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "📝 Next steps:"
echo "1. Set up Cloud SQL database and configure connection"
echo "2. Update frontend API endpoint to point to deployed backend"
echo "3. Set up Cloud Storage for persistent file storage (optional)"
echo "4. Configure environment variables in Cloud Run/App Engine"
