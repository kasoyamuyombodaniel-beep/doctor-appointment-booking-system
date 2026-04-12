# Deployment Guide

This project is split into 3 parts:

1. `frontend/`: static HTML, CSS, and JavaScript
2. `backend/`: Flask API
3. MySQL database

## Recommended setup

The simplest deployment path for this codebase is:

1. Frontend on Netlify
2. Backend on Render or Railway
3. MySQL on Railway, Aiven, or another hosted MySQL provider

## 1. Deploy the database

Create a hosted MySQL database and keep these values:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

Then run the SQL schema from [backend/schema.sql](backend/schema.sql).

## 2. Deploy the Flask backend

Use `backend/` as the backend service root.

Install command:

```bash
pip install -r requirements.txt gunicorn
```

Start command:

```bash
gunicorn -w 2 -b 0.0.0.0:$PORT app:app
```

Required environment variables:

```env
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=your-mysql-user
DB_PASSWORD=your-mysql-password
DB_NAME=doctor_booking_db
SECRET_KEY=replace-with-a-long-random-secret
FRONTEND_URL=https://your-frontend-domain.netlify.app
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.netlify.app
FLASK_DEBUG=false
```

Optional variables if you use email or SMS:

```env
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USE_TLS=true
MAIL_USE_SSL=false
MAIL_USERNAME=your-email
MAIL_PASSWORD=your-app-password
MAIL_DEFAULT_SENDER=your-email
MAIL_SENDER_NAME=Wisdom Hospital
RESEND_API_KEY=your-resend-api-key
RESEND_FROM_EMAIL=notifications@your-domain.com
RESEND_FROM_NAME=Wisdom Hospital
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
DEFAULT_PHONE_COUNTRY_CODE=+243
TWILIO_STATUS_CALLBACK_URL=https://your-backend-domain.onrender.com/...
```

After deploy, test:

- `GET /` should return `Backend is running`
- login, registration, appointment routes should answer from the hosted domain

## 3. Deploy the frontend

Publish the `frontend/` folder as a static site.

Before publishing, update [frontend/config.js](frontend/config.js) with your real backend URL:

```js
window.APP_CONFIG.API_URL = "https://your-backend-domain.onrender.com";
```

Then deploy the full `frontend/` folder to Netlify.

## 4. Important checks after deployment

- The frontend must call the hosted backend URL, not `127.0.0.1`
- `CORS_ALLOWED_ORIGINS` must match your frontend domain exactly
- The database must accept connections from the backend host
- If reset-password emails are enabled, `FRONTEND_URL` must point to the live frontend
- On Render free, prefer `RESEND_API_KEY` + `RESEND_FROM_EMAIL` over SMTP because SMTP ports may be blocked

## Fastest low-friction path

If you want the easiest first deployment:

1. Put backend on Render
2. Put database on Railway MySQL
3. Put frontend on Netlify
4. Update `frontend/config.js`
5. Add backend env vars in the Render dashboard
