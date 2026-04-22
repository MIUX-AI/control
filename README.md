# Freepik Kling Motion Panel — Vercel Patch

Versi patch ini ditujukan untuk jalur deploy **GitHub -> Vercel**.

Perubahan utamanya:
- auth frontend memakai **httpOnly session cookie**
- tidak lagi menyimpan access key di `localStorage`
- upload file dipindah ke **Vercel Blob client upload**
- tidak lagi memakai upload base64 JSON ke backend
- endpoint maintenance dibuat serverless-friendly untuk cron/manual run
- ditambahkan `.env.example`, `.gitignore`, dan `vercel.json`
- enkripsi dipisahkan dari `DATABASE_URL` lewat `APP_ENCRYPTION_KEY`
- dedupe API key memakai hash, bukan masker tampilan
- data task internal tidak lagi diekspos ke user biasa

## Kebutuhan environment
Lihat file `.env.example`.

Minimal untuk production:
- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `ADMIN_KEY`
- `APP_BASE_URL`
- `BLOB_READ_WRITE_TOKEN` (jika ingin upload image/video dari browser)

## Local run
```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:push
npm run dev
```

## Deploy ke Vercel
Lihat file `VERCEL_DEPLOY.md`.
