# Leila API Gateway

AI-powered home service platform API with monitoring and documentation.

## 🚀 Live API

- **Base URL**: https://leila-api.onrender.com
- **API Docs**: https://leila-api.onrender.com/api-docs
- **Postman Collection**: https://leila-api.onrender.com/postman.json
- **Status**: https://leila-api.onrender.com/api/stats

## 📚 Documentation

### Interactive Swagger UI
Visit `/api-docs` for interactive API documentation with try-it-out functionality.

### Postman Collection
1. Download: https://leila-api.onrender.com/postman.json
2. Import into Postman
3. Set variables:
   - `base_url`: https://leila-api.onrender.com
   - `api_key`: Your API key (optional)

### Quick Start

```bash
# Health check
curl https://leila-api.onrender.com

# Create a booking
curl -X POST https://leila-api.onrender.com/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "555-1234",
    "serviceName": "Plumbing",
    "preferredDate": "2025-06-25",
    "preferredTime": "10:00",
    "address": "123 Main St",
    "notes": "Leaky faucet"
  }'
```

## 🔑 API Keys

Generate an API key for monitoring and higher rate limits:

```bash
curl -X POST https://leila-api.onrender.com/api/keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App",
    "email": "dev@example.com"
  }'
```

Use the API key in requests:
```bash
curl https://leila-api.onrender.com/api/bookings \
  -H "X-API-Key: your-api-key"
```

## 📊 Endpoints

### General
- `GET /` - Health check
- `GET /api/stats` - API statistics
- `GET /api-docs` - Swagger documentation
- `GET /postman.json` - Postman collection

### Bookings
- `POST /api/bookings` - Create booking
- `GET /api/bookings` - List bookings

### Contractors
- `POST /api/contractors/signup` - Contractor signup
- `POST /api/auth/login` - Contractor login
- `GET /api/contractors` - List active contractors

### Jobs
- `GET /api/jobs/available` - Available jobs
- `POST /api/jobs/accept` - Accept a job

### API Keys
- `POST /api/keys` - Generate API key

## 🛡️ Rate Limiting

- Default: 100 requests per 15 minutes per IP
- With API key: Higher limits available

## 🔧 Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Run tests
npm test
```

## 🚢 Deployment

Deployed on Render with automatic builds from GitHub:
https://github.com/pure-justin/leila-api