# VocabUp

Ứng dụng học từ vựng với React, Express, MySQL và lịch ôn tập SRS.

## Chạy local

1. Sao chép `backend/.env.example` thành `backend/.env` và cập nhật `JWT_SECRET`.
2. Chạy MySQL bằng `docker compose up -d mysql` (schema được nạp lần đầu), hoặc cấu hình MySQL riêng.
3. Chạy `npm install`, `npm run dev`; frontend ở `http://localhost:5173`, API ở `http://localhost:4000`.
4. Nếu dùng cơ sở dữ liệu có sẵn: `npm run db:migrate`.

Frontend dùng `VITE_API_URL` (mặc định `/api`); chỉ đặt URL tuyệt đối khi API được phục vụ qua HTTPS và cập nhật `FRONTEND_URL` ở backend thành đúng origin frontend. Production cần HTTPS kết thúc tại reverse proxy; hãy cấu hình proxy chuyển tiếp trạng thái HTTPS để HSTS và cookie `Secure` hoạt động. Phiên đăng nhập dùng cookie HttpOnly, SameSite=Strict; frontend và API nên cùng site.

Build production bằng `npm run build`, sau đó chạy backend với `NODE_ENV=production npm run start` từ thư mục gốc để Express phục vụ `frontend/dist` cùng API và SPA fallback. Nếu TLS kết thúc ở đúng một reverse proxy, đặt `TRUST_PROXY=1`; không bật thiết lập này phía sau proxy không tin cậy.

Trong trang Bộ từ, dùng biểu tượng tải lên trên thẻ bộ từ hoặc nút Nhập CSV trong chi tiết bộ để chọn `.csv` hoặc `.apkg`. APKG được nhập vào bộ VocabUp đã chọn; mỗi ghi chú Anki thành một từ, thẻ đảo chiều không bị nhân đôi. Phiên âm, định nghĩa, nghĩa tiếng Việt và ví dụ được chuyển thành văn bản. Audio/hình ảnh chưa được lưu vào VocabUp. Đọc APKG v3 cần Node.js 24 trở lên; file giới hạn 50 MB và tối đa 5.000 ghi chú.

Các lệnh khác: `npm run build`, `npm test`.
