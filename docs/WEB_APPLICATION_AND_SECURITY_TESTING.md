# Ứng dụng web VocabUp và kiểm thử bảo mật

## 1. Giới thiệu website VocabUp

VocabUp là website hỗ trợ người dùng tạo bộ từ vựng, lưu thông tin từ và học tập, ôn lại theo lịch. Mỗi thẻ có thể chứa từ hoặc cụm từ, phần giải thích, phiên âm, nghĩa tiếng Việt và câu ví dụ. Dữ liệu bộ từ và tiến độ được gắn với tài khoản người dùng.

Theo mã nguồn dự án, giao diện được xây dựng bằng **React**, **Vite** và **TypeScript**. Backend sử dụng **Express** và **TypeScript** để cung cấp API; dữ liệu được lưu trong **MySQL**. Cấu trúc bảng trong migration gồm tài khoản, bộ từ, thẻ từ và lịch sử ôn tập.

Ở mức tổng quan, trình duyệt tải ứng dụng React; giao diện gửi các yêu cầu HTTP đến API Express. API xác thực phiên người dùng, kiểm tra dữ liệu và quyền sở hữu tài nguyên trước khi truy vấn hoặc cập nhật MySQL. Phản hồi API được giao diện dùng để hiển thị bộ từ, thẻ, phiên học và số liệu thống kê. Trong cấu hình production, Express cũng có thể phục vụ bản build của frontend.

## 2. Các chức năng chính

1. **Tài khoản:** Người dùng có thể đăng ký bằng tên, email và mật khẩu, đăng nhập và đăng xuất. Backend lưu mật khẩu dưới dạng băm và phiên đăng nhập được truyền bằng cookie HttpOnly.
2. **Tổng quan và bộ từ:** Dashboard hiển thị thông tin học tập; người dùng có thể tạo, xem và xóa bộ từ, chỉnh giới hạn số từ mới mỗi ngày. Bộ từ có số lượng thẻ và số thẻ đến hạn.
3. **Quản lý thẻ:** Trong bộ từ, người dùng có thể thêm, sửa, xóa và tra cứu thẻ bằng ô tìm kiếm. Thẻ hỗ trợ từ/cụm từ, nghĩa hoặc giải thích, phiên âm, nghĩa tiếng Việt và ví dụ.
4. **Học và ôn tập SRS:** Người dùng mở thẻ để xem đáp án rồi đánh giá mức độ nhớ. Hệ thống xếp lịch ôn tiếp theo theo lựa chọn đánh giá và lịch sử lặp lại. SRS (Spaced Repetition System – hệ thống lặp lại ngắt quãng) ưu tiên đưa nội dung trở lại vào thời điểm phù hợp để ôn.
5. **Thống kê:** Trang thống kê hiển thị số bộ từ, số thẻ, số thẻ đến hạn, số lượt ôn trong ngày và hoạt động ôn tập trong 7 ngày gần nhất.
6. **Nhập và xuất:** Mã nguồn có chức năng nhập CSV và APKG vào bộ từ, cùng xuất bộ từ ra CSV. Phần hướng dẫn dự án ghi rõ khi nhập APKG, âm thanh và hình ảnh chưa được lưu vào VocabUp; việc đọc APKG phiên bản mới có yêu cầu phiên bản Node.js tương ứng.

## 3. Kiểm thử bảo mật bằng OWASP ZAP

OWASP ZAP (Zed Attack Proxy) là công cụ hỗ trợ kiểm thử bảo mật ứng dụng web. Công cụ quan sát và phân tích các yêu cầu, phản hồi HTTP để đưa ra cảnh báo về những cấu hình hoặc hành vi có thể gây rủi ro. Khi kiểm thử VocabUp, có thể cấu hình ZAP truy cập website trong môi trường được phép, duyệt các luồng chức năng, thu thập cảnh báo và xem xét bằng chứng, URL, tham số cùng phản hồi liên quan.

Trong phạm vi source code được rà soát, không có báo cáo hoặc dữ liệu phiên quét ZAP để đối chiếu. Vì vậy, các mục dưới đây là những loại cảnh báo cần được phân tích nếu xuất hiện trong kết quả quét; chúng không khẳng định website đã mắc lỗi. Cảnh báo tự động cần được xác minh thủ công và đánh giá theo ngữ cảnh.

1. **Path Traversal (duyệt đường dẫn):** Lỗi này xảy ra khi đầu vào bị thao túng để ứng dụng truy cập tệp hoặc thư mục ngoài phạm vi được phép. Nếu khai thác được, dữ liệu cấu hình hoặc tệp nội bộ có thể bị lộ. Với VocabUp, rủi ro đối với việc học phụ thuộc vào điểm có thể truy cập: nếu đường dẫn ảnh hưởng đến dữ liệu lưu trữ bộ từ, nội dung thẻ hoặc cấu hình dịch vụ, thông tin học tập có thể bị xem hoặc làm gián đoạn; cần kiểm tra phạm vi thực tế.
2. **Cross-Site Scripting – XSS (tấn công chèn mã kịch bản liên trang):** Lỗi phát sinh khi dữ liệu không đáng tin cậy được xử lý hoặc hiển thị không an toàn, khiến trình duyệt có thể thực thi JavaScript do kẻ tấn công cung cấp. Trên VocabUp, nội dung độc hại trong tên bộ hoặc dữ liệu thẻ (nếu đường hiển thị bị ảnh hưởng) có thể xuất hiện khi người học mở thư viện hay lật thẻ; mã chạy trong trình duyệt có thể tác động đến phiên đăng nhập hoặc dụ người dùng thực hiện thao tác ngoài ý muốn. Mức ảnh hưởng cần xác minh theo vị trí dữ liệu và cách giao diện hiển thị.
3. **Information Disclosure – Sensitive Information in URL (lộ thông tin nhạy cảm trong URL):** Thông tin nhạy cảm đặt trong URL có thể bị lưu trong lịch sử trình duyệt, nhật ký máy chủ hoặc được gửi qua các cơ chế truyền URL như tiêu đề giới thiệu. Điều này làm tăng khả năng lộ thông tin; cần kiểm tra dữ liệu cụ thể để xác định tính nhạy cảm và mức độ ảnh hưởng. Nếu URL của VocabUp chứa thông tin phiên hoặc dữ liệu riêng tư, người khác có thể thu được thông tin liên quan đến tài khoản hay hoạt động học, từ đó ảnh hưởng đến riêng tư và an toàn khi quản lý bộ thẻ; không nên suy ra điều này nếu URL thực tế không chứa dữ liệu nhạy cảm.
4. **Missing Anti-clickjacking Header (thiếu tiêu đề chống clickjacking):** Nếu phản hồi thiếu `X-Frame-Options` hoặc chính sách CSP `frame-ancestors` phù hợp, trang có thể bị nhúng vào website khác. Kẻ tấn công có thể lợi dụng giao diện bị che phủ để dụ người dùng nhấn vào thao tác ngoài ý muốn. Nếu thao tác quản lý bộ từ hoặc thẻ bị ảnh hưởng, người học có thể vô tình tạo, sửa hoặc xóa dữ liệu, hay thay đổi cài đặt học tập. Cần đối chiếu cảnh báo với header thực tế và cấu hình áp dụng cho phản hồi bị nêu.

## 4. Kết luận

Kiểm thử bảo mật giúp phát hiện sớm các điểm cần xem xét và cải thiện trong quá trình phát triển website. Kết quả OWASP ZAP là đầu mối phân tích, không phải bằng chứng tự động rằng đã có lỗ hổng; từng cảnh báo cần được kiểm tra, xác minh thêm để xác định khả năng khai thác và mức ảnh hưởng thực tế.

