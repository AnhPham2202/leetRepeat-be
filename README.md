# Leet Repeat (MVP)

## Structure

- `app/`: Backend Express JSON API only
- `app/web/`: React + Tailwind frontend (Vite)
- `extension/`: Chrome extension (content script)

## Run in development

```bash
cd app
npm install
npm run dev
```

- Backend API: `http://localhost:3000`
- Frontend dev: `http://localhost:5173` (proxy `/api` to backend)

## Build

```bash
cd app
npm run build
```

This builds:
- backend (`app/dist`)
- frontend static files (`app/web/dist`)

Run backend only:

```bash
cd app
npm start
```

## Load extension

1. Open Chrome `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked** and select `extension/`
4. Open a LeetCode problem page, solve to Accepted, click **Add to Repetition**

## API

- `GET /api/health`
- `POST /api/problems`
- `GET /api/due`
- `POST /api/review`
- `GET /api/config`
- `POST /api/config`

## Database

Data is in `app/db.json` with:

- `problems`
- `repetitions`
- `config`
