# Push ke GitHub dan lanjut deploy ke Vercel

Folder ini sudah disiapkan agar aman dipush:
- `.env` **tidak** ikut repo
- `.env.example` sudah tersedia
- `.gitignore` sudah ada
- `package-lock.json` sudah ada
- `vercel.json` sudah ada

## 1) Buat repo GitHub kosong
Buat repo kosong baru di akun GitHub Anda. Saran nama:

- `klingprojek-vercel`

Jangan centang **Add a README**, **.gitignore**, atau **license** supaya remote tetap kosong.

## 2) Push folder ini
Dari dalam folder ini jalankan:

```bash
bash push_to_github.sh https://github.com/USERNAME/klingprojek-vercel.git
```

Atau manual:

```bash
git init -b main
git add .
git commit -m "Initial Vercel-ready import"
git remote add origin https://github.com/USERNAME/klingprojek-vercel.git
git push -u origin main
```

## 3) Import ke Vercel
Setelah repo ter-push, buka Vercel lalu import repo GitHub tersebut.

## 4) Isi Environment Variables di Vercel
Minimal:
- `DATABASE_URL`
- `APP_ENCRYPTION_KEY`
- `SESSION_SECRET`
- `ADMIN_KEY`

Direkomendasikan untuk production:
- `APP_BASE_URL`
- `FREEPIK_WEBHOOK_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`

Lihat juga:
- `.env.example`
- `VERCEL_DEPLOY.md`
