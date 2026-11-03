# VocabUp

Ứng dụng học từ vựng với React, Express, MySQL và lịch ôn tập SRS.

## Chạy local

Yêu cầu Node.js 24 trở lên, npm và MySQL 8.4 (hoặc Docker Compose). Cài dependency đúng lockfile bằng `npm ci`. Các lệnh npm bên dưới chạy từ thư mục gốc; npm workspace backend đọc `backend/.env`.

1. Sao chép `backend/.env.example` thành `backend/.env` và cập nhật `JWT_SECRET`.
2. Chạy MySQL bằng `docker compose up -d mysql` (schema được nạp lần đầu), hoặc cấu hình MySQL riêng.
3. Chạy `npm ci`, `npm run dev`; frontend ở `http://localhost:5173`, API ở `http://localhost:4000`.
4. Nếu dùng cơ sở dữ liệu có sẵn: `npm run db:migrate`.

Frontend dùng `VITE_API_URL` (mặc định `/api`); chỉ đặt URL tuyệt đối khi API được phục vụ qua HTTPS và cập nhật `FRONTEND_URL` ở backend thành đúng origin frontend. Production cần HTTPS kết thúc tại reverse proxy; hãy cấu hình proxy chuyển tiếp trạng thái HTTPS để HSTS và cookie `Secure` hoạt động. Phiên đăng nhập dùng cookie HttpOnly, SameSite=Strict; frontend và API nên cùng site.

Build production bằng `npm run build`, sau đó chạy backend với `NODE_ENV=production npm run start` từ thư mục gốc để Express phục vụ `frontend/dist` cùng API và SPA fallback. Nếu TLS kết thúc ở đúng một reverse proxy, đặt `TRUST_PROXY=1`; không bật thiết lập này phía sau proxy không tin cậy.

Trong trang Bộ từ, dùng biểu tượng tải lên trên thẻ bộ từ hoặc nút Nhập CSV trong chi tiết bộ để chọn `.csv` hoặc `.apkg`. APKG được nhập vào bộ VocabUp đã chọn; mỗi ghi chú Anki thành một từ, thẻ đảo chiều không bị nhân đôi. Phiên âm, định nghĩa, nghĩa tiếng Việt và ví dụ được chuyển thành văn bản. Audio/hình ảnh nhúng trong APKG chưa được nhập; VocabUp tự tìm ảnh minh họa riêng (xem mục dưới). Đọc APKG v3 cần Node.js 24 trở lên; APKG tối đa 200 MB, CSV tối đa 50 MB, ảnh tối đa 5 MB (đều cấu hình được), tối đa 5.000 ghi chú.

## Giới hạn upload

| Loại | Mặc định | Biến môi trường |
|---|---|---|
| APKG | 200 MB | `APKG_MAX_SIZE_MB` |
| CSV | 50 MB | `CSV_MAX_SIZE_MB` |
| Ảnh minh họa | 5 MB | `IMAGE_MAX_SIZE_MB` |

- APKG/CSV được **stream thẳng xuống file tạm trên đĩa** (không nạp cả file vào RAM), có giới hạn byte khi đang nhận, timeout xử lý và dọn thư mục tạm trong `finally`. APKG được đọc theo central directory, giải nén streaming, chặn zip bomb theo tỷ lệ nén/kích thước giải nén và giới hạn số ghi chú.
- `UPLOAD_TMP_DIR` (mặc định thư mục tạm của OS) phải ghi được và đủ chỗ; Docker production/staging đã mount volume `/var/tmp/vocabup` và `/app/uploads` vì container chạy read-only.
- `REQUEST_TIMEOUT_MS` (mặc định 600000 = 10 phút) nới thời gian nhận request cho file lớn.
- **Reverse proxy**: mẫu nginx dùng `client_max_body_size 210m` và timeout 300s. Nếu proxy/CDN phía trước vẫn chặn (ví dụ Cloudflare free plan giới hạn 100 MB), **200 MB sẽ không hoạt động** dù Express đã cho phép — phải nâng giới hạn ở proxy/CDN hoặc dùng DNS-only. Nếu đặt `APKG_MAX_SIZE_MB` lớn hơn 210, phải tăng `client_max_body_size` tương ứng.
- Frontend kiểm tra dung lượng trước khi gửi, hiển thị tên file/dung lượng/giới hạn, thanh tiến trình upload (XHR) và thông báo lỗi cụ thể từ server.

## Hình ảnh minh họa cho từ vựng

Mỗi từ có thể có một ảnh minh họa lấy từ **Pixabay, Unsplash, Pexels, Wikimedia Commons, Openverse hoặc Flickr**. Cấu hình khóa trong `backend/.env` (khóa chỉ được đọc ở backend, không bao giờ gửi xuống trình duyệt):

```bash
# Các nguồn cần khóa:
PIXABAY_API_KEY=...
# UNSPLASH_ACCESS_KEY=...
# PEXELS_API_KEY=...
# FLICKR_API_KEY=...

# Wikimedia Commons và Openverse hoạt động miễn phí, không cần khóa.
# Tùy chọn: chỉ dùng một số nguồn
# IMAGE_PROVIDERS=pixabay,unsplash,wikimedia
# Tùy chọn: tắt nguồn không cần khóa
# IMAGE_DISABLE_WIKIMEDIA=1
# IMAGE_DISABLE_OPENVERSE=1

# Tùy chọn: giãn cách giữa các request lên provider (mặc định 650 ms)
IMAGE_REQUEST_DELAY_MS=650
# Tùy chọn: thư mục lưu ảnh tải lên (mặc định backend/uploads)
# UPLOAD_DIR=
```

Nếu chưa cấu hình khóa, Wikimedia/Openverse vẫn chạy; nếu tự tắt hết nguồn, giao diện hiển thị hướng dẫn cấu hình thay vì lỗi, từ vẫn được tạo/import, và người dùng có thể tải ảnh lên thủ công.

Ảnh được tìm theo **nghĩa của thẻ**, không phải từ tiếng Anh trần: engine đọc nghĩa tiếng Việt (`translation`, hoặc `back` nếu là tiếng Việt), câu ví dụ, loại từ và định nghĩa tiếng Anh. Nghĩa tiếng Việt được ưu tiên, câu ví dụ chỉ bổ sung ngữ cảnh, từ tiếng Anh chỉ là phương án cuối. Ví dụ `Bank` + `Bờ sông` + “He sat on the river bank” → `river bank landscape water`, còn `Bank` + `Ngân hàng` → `bank building finance money`. Mỗi sense có 3-5 truy vấn; engine tìm **song song trên tất cả provider đã cấu hình**, gộp/khử trùng kết quả, chấm điểm theo nghĩa + ngữ cảnh + độ phân giải + license và chọn ảnh tốt nhất. Nếu ảnh không đủ khớp (ngưỡng tin cậy), hệ thống để trống ảnh thay vì gắn ảnh sai. Provider lỗi/hết quota **không** bị coi là “không tìm thấy”: các nguồn khác vẫn tiếp tục, chỉ báo lỗi khi tất cả nguồn đều lỗi.

Ảnh thắng được **tải về máy chủ** vào `/uploads/images/...` (không hotlink URL provider), kiểm tra magic bytes và giới hạn `IMAGE_MAX_SIZE_MB` trong lúc đọc stream; DB chỉ lưu URL same-origin. Mỗi redirect phải thuộc danh sách host provider được phép, tối đa 5 redirect. Nếu ảnh full lỗi, thử thumbnail; nếu vẫn lỗi, thẻ để trống để người dùng thử lại. Job có thể mở rộng truy vấn bằng từ đồng nghĩa, nghĩa tiếng Việt đã dịch, definition và example (`expandImageQueries`). Khi gỡ/đổi ảnh, file còn được thẻ khác tham chiếu được giữ lại.

Ảnh có thể để trống nếu không có kết quả phù hợp. Phiên bản hiện tại không chạy backfill ảnh khi khởi động và không tự ghi lại các thẻ đang có. Người dùng có thể chủ động chạy tìm ảnh hoặc tải ảnh lên.

Cách hoạt động:

- Tạo từ mới: backend thử tìm ảnh trong tối đa 3,5 giây; tìm được thì lưu, không tìm được thì từ vẫn được tạo.
- Import CSV/APKG: sau khi phân tích file, bước xác nhận hiển thị từng từ với **nghĩa tiếng Việt** và **ảnh đề xuất** (tìm theo nghĩa). Không bắt buộc duyệt: ảnh đề xuất của trang đang xem được gắn khi import, các từ còn lại chạy job nền tự động. Người dùng vẫn có thể xem ảnh lớn, đổi ảnh, bỏ chọn từng từ hoặc chọn “Chỉ import”. Ảnh tự động được tải về local; từ đã có ảnh bị khóa và giữ nguyên.
- Job tìm ảnh chạy theo yêu cầu người dùng. Các biến `IMAGE_RETRY_*` đã có khai báo nhưng chưa được nối vào một worker chạy định kỳ trong entrypoint hiện tại.
- Tiến trình tìm ảnh chạy nền trên server, tuần tự (không gửi hàng loạt request đồng thời), có thể thu nhỏ và tiếp tục dùng ứng dụng; panel hiển thị số ảnh đã tìm thấy, đang xử lý, không tìm thấy và lỗi. Từ lỗi/không tìm thấy có thể được chạy lại bằng **Tìm ảnh minh họa** trên thẻ bộ từ hoặc **Tìm ảnh còn thiếu cho toàn bộ từ vựng** trong Cài đặt.
- Trong chi tiết từ: tự động tìm lại, chọn từ kết quả của provider, tải ảnh lên (JPEG/PNG/WebP/GIF, tối đa 5 MB, kiểm tra magic bytes) hoặc xóa ảnh. Ảnh đã chọn thủ công được giữ nguyên khi chạy lại tìm ảnh tự động.
- Ảnh và metadata (nguồn, tác giả, link nguồn, **giấy phép**, **truy vấn đã dùng**, thời gian cập nhật, trạng thái) nằm trên bảng `cards`; ảnh tải lên lưu trên đĩa (không lưu Base64 trong MySQL); kết quả tìm kiếm được cache trong bảng `image_search_cache` theo truy vấn ngữ nghĩa để tránh gọi provider lặp lại (cùng từ + cùng nghĩa dùng chung cache; khác nghĩa dùng truy vấn/ảnh riêng).
- Migration không phá dữ liệu: thêm `image_license`, `image_license_url`, `image_query` vào `cards` (chạy `node dist/migrate.js` sau khi build, như các migration trước).

API chính: `GET /api/images/status` (trả cả danh sách provider), `GET|POST|DELETE /api/cards/:id/image*`, `POST /api/decks/:id/images/auto`, `POST /api/images/auto`, `GET /api/images/jobs/:id`, `POST /api/images/suggest`, `POST /api/images/candidates`, `POST /api/decks/:id/import/preview.csv|apkg`, `POST /api/decks/:id/import/commit`. Mọi endpoint đều kiểm tra quyền sở hữu bộ từ/từ; người dùng khác nhận **404**. Job ảnh lưu trong bộ nhớ server: khởi động lại server sẽ mất tiến trình đang chạy, nhưng ảnh đã lưu vẫn còn và có thể chạy lại phần còn thiếu.

**Giới hạn**: engine chọn ảnh dựa trên metadata/alt-text của provider + mô hình ngữ nghĩa + ngưỡng an toàn, **chưa tích hợp Vision AI** để nhìn trực tiếp nội dung ảnh; một số từ trừu tượng/ít gặp có thể không tìm được ảnh đủ khớp và sẽ để trống thay vì gắn ảnh sai. Pexels/Flickr cần khóa; Openverse/Wikimedia cần kết nối mạng; provider hết quota sẽ được bỏ qua nhưng không làm hỏng import.

Các lệnh khác: `npm run build`, `npm test`.

## Kiểm chứng và triển khai an toàn

- `npm test`: unit test và HTTP regression test với database mock. Các test MySQL mặc định được bỏ qua.
- `npm run build`: kiểm tra TypeScript backend/frontend và tạo production bundle. Repository hiện chưa cấu hình script lint.
- `npm audit --audit-level=high`: kiểm tra dependency qua npm registry.
- Integration/E2E chỉ dùng database riêng tên `vocabup_test`, không trỏ tới database development hoặc production. Có thể tạo MySQL test bằng `docker compose -f docker-compose.integration.yml up -d` sau khi đặt hai mật khẩu dùng riêng cho test: `TEST_DB_PASSWORD`, `TEST_MYSQL_ROOT_PASSWORD`. Cổng mặc định là 3308; user là `vocabup_test_app`.
- Trên database test mới, chạy migration bằng tài khoản quản trị của **database test** (runtime user không có quyền đổi schema). Đặt rõ `DB_HOST=127.0.0.1`, `DB_PORT=3308`, `DB_NAME=vocabup_test` và credential test; sau đó `npm run db:migrate`. Không chạy migration trên database thật trong quá trình kiểm thử.
- API integration: giữ các biến kết nối test trên, đặt `NODE_ENV=test`, `RUN_API_INTEGRATION=1`, rồi chạy `npm run test:integration -w backend`.
- Browser E2E: đặt `E2E_DB_HOST=127.0.0.1`, `E2E_DB_PORT=3308`, `E2E_DB_NAME=vocabup_test`, `E2E_DB_USER=vocabup_test_app`, `E2E_DB_PASSWORD` bằng mật khẩu test; chạy `npx playwright install chromium`, rồi `npm run test:e2e`. Playwright tự mở dev server và từ chối dùng database tên khác.

Production Compose dùng `docker-compose.production.yml` với file môi trường riêng dựa trên `production.env.example`: `docker compose --env-file production.env -f docker-compose.production.yml up -d --build`. Điền secret ngẫu nhiên riêng, HTTPS origin và `TRUST_PROXY` phù hợp trước khi chạy. Lưu bền MySQL và thư mục upload; reverse proxy tham khảo `deploy/nginx-vocabup.conf.template`. Với database hiện có, sao lưu và duyệt migration trước khi người vận hành áp dụng; không seed/reset dữ liệu khi nâng cấp. Build/run ứng dụng không tự chạy migration.

Không commit file môi trường thật, backup hoặc dữ liệu người dùng. `.env.example` chỉ chứa giá trị mẫu. Các file SQL chỉ được cho phép trong thư mục migration và cấu hình quyền MySQL.

## Quản trị hệ thống (Admin)

VocabUp dùng RBAC với hai vai trò `user` và `admin`. Tài khoản đăng ký mới luôn là `user`; quyền quản trị chỉ được cấp bằng CLI chạy trực tiếp trên server (không hardcode mật khẩu, không cho phép tự nâng quyền qua API):

```bash
ADMIN_EMAIL=admin@example.com \
ADMIN_NAME="Quản trị viên" \
ADMIN_PASSWORD='<mật-khẩu-mạnh-từ-12-ký-tự>' \
npm run admin:create -w backend
```

- Script đọc `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` từ môi trường, băm bằng bcrypt và **không ghi mật khẩu ra log**. Nếu email đã tồn tại, tài khoản được nâng quyền admin và đặt lại mật khẩu; ngược lại tạo tài khoản mới.
- Chạy `npm run db:migrate` trước để thêm cột `role`/`status`/`last_active_at`, cột `is_public` và bảng `admin_activity_logs`.
- Đăng nhập ở `/login`; tài khoản admin được chuyển tới `/admin`.
- Giao diện: `/admin` (tổng quan), `/admin/users`, `/admin/users/:id`, `/admin/decks`, `/admin/statistics`, `/admin/activity`, `/admin/settings`.
- Toàn bộ API `/api/admin/*` được bảo vệ phía máy chủ: **401** nếu chưa đăng nhập, **403** nếu không phải admin. Vai trò và trạng thái được đọc lại từ MySQL trên mỗi request, nên khóa tài khoản có hiệu lực ngay với token cũ.
- Không thể khóa, hạ quyền hoặc xóa quản trị viên cuối cùng; admin không thể tự xóa tài khoản của mình.
- Nhật ký hoạt động không lưu mật khẩu, JWT hay token; metadata được lọc trước khi ghi.
