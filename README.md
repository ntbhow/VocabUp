# VocabUp

Ứng dụng học từ vựng với React, Express, MySQL và lịch ôn tập SRS.

## Chạy local

1. Sao chép `backend/.env.example` thành `backend/.env` và cập nhật `JWT_SECRET`.
2. Chạy MySQL bằng `docker compose up -d mysql` (schema được nạp lần đầu), hoặc cấu hình MySQL riêng.
3. Chạy `npm install`, `npm run dev`; frontend ở `http://localhost:5173`, API ở `http://localhost:4000`.
4. Nếu dùng cơ sở dữ liệu có sẵn: `npm run db:migrate`.

Các lệnh khác: `npm run build`, `npm test`.
