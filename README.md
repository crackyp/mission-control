# Mission Control

Mission Control is a Next.js dashboard for tasks, goals, agent status, cron jobs, memory files, Twitter queue, and WordPress content.

## Safe GitHub Setup (no secrets committed)

1. Copy environment template:

```bash
cp .env.example .env.local
```

2. Edit `.env.local` for your machine paths and channel ids.

3. Install + run:

```bash
npm install
npm run dev
```

4. Open <http://localhost:3000>

## Production build

```bash
npm run build
npm start
```

## Notes

- Secrets/credentials should stay outside git (in `.env.local` or external files you reference via env vars).
- Default behavior uses sensible local defaults; set `.env.local` for your own paths and channels.
