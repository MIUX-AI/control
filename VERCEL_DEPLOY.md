# Deploy ke Vercel

Patch ini sudah disesuaikan untuk model Vercel modern:
- Express berjalan sebagai satu Vercel Function
- asset statis tetap dari `public/**`
- login memakai httpOnly session cookie, bukan `localStorage`
- upload file memakai **Vercel Blob client upload**, bukan base64 JSON ke function
- maintenance/sync dibuat menjadi endpoint cron/manual (`/api/internal/maintenance`)

## 1. Push ke GitHub
Pastikan file `.env` asli **tidak ikut ter-push**. Repo patch ini sudah punya `.gitignore` dan `.env.example`.

## 2. Buat project di Vercel
Hubungkan repo GitHub Anda lalu deploy.

## 3. Tambahkan Environment Variables di Vercel
Isi minimal ini untuk **Production**:

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `ADMIN_KEY`
- `APP_BASE_URL`
- `BLOB_READ_WRITE_TOKEN` (kalau ingin upload image/video dari browser)

Opsional tapi direkomendasikan:
- `FREEPIK_WEBHOOK_SECRET`
- `CRON_SECRET`
- `SYNC_BATCH_SIZE`
- `KEY_COOLDOWN_MS`
- `REQUEST_TIMEOUT_MS`
- `RESULT_URL_TTL_MS`

Untuk **Preview**, pakai DB terpisah.

## 4. Prisma schema
Karena repo asal belum memakai migration history, jalankan:

```bash
npx prisma db push
```

Bisa dijalankan dari lokal setelah `vercel env pull`, atau dari pipeline terpisah.

## 5. Vercel Blob
Buat Blob store dari dashboard Vercel Storage. Vercel akan menambahkan `BLOB_READ_WRITE_TOKEN` ke project.

## 6. Webhook Freepik
Set `APP_BASE_URL` ke domain production final Anda supaya `webhook_url` yang dikirim ke Freepik stabil.

## 7. Cron / maintenance
Patch ini menyediakan endpoint:

```text
GET /api/internal/maintenance
Authorization: Bearer <CRON_SECRET>
```

Endpoint ini menjalankan:
- sync task aktif
- purge hasil yang kedaluwarsa
- backfill result URL dari payload yang tersimpan

### Penting soal plan Vercel
- **Hobby**: cron hanya bisa **1x per hari**
- **Pro**: bisa **1x per menit**

Kalau Anda ingin pakai cron otomatis di plan Pro, tambahkan `crons` ke `vercel.json`, misalnya:

```json
{
  "crons": [
    {
      "path": "/api/internal/maintenance",
      "schedule": "* * * * *"
    }
  ]
}
```

Untuk Hobby, jangan pakai ekspresi di atas karena deployment akan ditolak.

## 8. Local development
```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:push
npm run dev
```

Jika ingin menguji Blob callback lokal, gunakan ngrok lalu isi `VERCEL_BLOB_CALLBACK_URL`.
