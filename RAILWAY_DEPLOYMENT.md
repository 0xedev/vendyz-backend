# Deploying Vendyz Backend to Railway

## Prerequisites

- Railway account (sign up at https://railway.app)
- GitHub repository pushed with latest backend code

## Deployment Steps

### 1. Create New Project on Railway

1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository: `Vendyz-vending`
5. Railway will detect the monorepo structure

### 2. Configure Root Directory

Since this is a monorepo, you need to tell Railway to use the `backend` folder:

1. In your Railway project, click on your service
2. Go to "Settings" tab
3. Under "Build & Deploy", set:
   - **Root Directory**: `backend`
   - **Start Command**: `node src/index.js` (Railway should auto-detect this)

### 3. Add Environment Variables

In the "Variables" tab, add all these environment variables:

**Important Notes:**

- Railway will expose a `PORT` environment variable automatically - the backend will use this if `API_PORT` is not set
- Update `FRONTEND_URL` once you deploy your frontend to Vercel
- All sensitive keys are included above for convenience during deployment

### 4. Deploy

1. Railway will automatically deploy when you push to your GitHub repo
2. Or click "Deploy" in the Railway dashboard

### 5. Get Your Backend URL

After deployment:

1. Go to "Settings" tab
2. Under "Networking", click "Generate Domain"
3. Railway will give you a URL like: `https://your-app-name.up.railway.app`
4. Copy this URL - you'll need it for your frontend's `NEXT_PUBLIC_API_URL`

### 6. Test Your Deployment

Once deployed, test the health endpoint:

```bash
curl https://your-app-name.up.railway.app/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2025-11-26T...",
  "service": "Vendyz Backend API"
}
```

### 7. Update Frontend Environment Variables

In your Vercel deployment (or local `.env.local`), add:

```bash
NEXT_PUBLIC_API_URL=https://your-app-name.up.railway.app
```

### 8. Configure CORS (if needed)

If you get CORS errors, update the `FRONTEND_URL` environment variable in Railway to match your actual frontend URL.

## Monitoring

### View Logs

1. Go to your Railway project
2. Click on your service
3. Go to "Deployments" tab
4. Click on the latest deployment
5. View real-time logs

### Check Status

- Railway Dashboard shows service status (running/stopped)
- Health endpoint: `https://your-app-name.up.railway.app/health`
- Stats endpoint: `https://your-app-name.up.railway.app/api/stats`

## Auto-Deploy on Git Push

Railway automatically deploys when you push to your main branch:

```bash
git add .
git commit -m "Deploy backend to Railway"
git push origin main
```

## Cost

Railway offers:

- **Free Trial**: $5 credit (enough for testing)
- **Hobby Plan**: $5/month for basic usage
- **Pro Plan**: $20/month for production apps

## Troubleshooting

### Build Fails

- Check the build logs in Railway dashboard
- Ensure `package.json` has correct `type: "module"` for ES modules
- Verify all dependencies are in `package.json`

### Service Crashes

- Check logs for error messages
- Verify all environment variables are set correctly
- Check Supabase connection string is correct
- Ensure `ENCRYPTION_KEY` is set

### Cannot Connect to Backend

- Verify the domain is generated under Settings > Networking
- Check if service is running (should show green status)
- Test health endpoint with curl

### Database Connection Issues

- Verify `DATABASE_URL` is correct
- Check Supabase is allowing connections from Railway IPs (should be allowed by default)
- Ensure `SUPABASE_SERVICE_KEY` is set correctly

## Next Steps

1. ✅ Deploy backend to Railway
2. ✅ Get Railway URL
3. Update frontend `NEXT_PUBLIC_API_URL` in Vercel
4. Test end-to-end flow from frontend to backend
5. Monitor logs for any errors

## Security Notes

⚠️ **Important**: The environment variables shown above contain real API keys and should be kept secure. In production:

1. Rotate the `BACKEND_PRIVATE_KEY` if this is a production deployment
2. Use Railway's secret management to hide sensitive variables
3. Enable Railway's environment variable locking
4. Regularly rotate API keys and encryption keys
