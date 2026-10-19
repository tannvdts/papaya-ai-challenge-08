# Manual test samples

14 PDF scan dùng dữ liệu giả, 4 document_type; không có lớp text ẩn. Mở [catalog](index.html) để xem preview và kỳ vọng từng mẫu. Upload file PDF vào http://127.0.0.1:4000/manual-test với AI_MODE=openai. Mock reader chỉ đọc lớp text trong mock-samples/ nên không đọc được bộ này. Không upload JSON, README hoặc ảnh preview.

## Cách kiểm tra

1. Upload từng PDF và kiểm tra một scan_task được tạo.
2. Đối chiếu số tài liệu, bệnh nhân, các giá trị nhìn thấy trên scan với expected/*.json. Với phần bị mất/che/mờ, sidecar không phải bằng chứng để AI suy ra giá trị.
3. Kiểm tra raw_value, giá trị ứng viên/null, warning, confidence, crop ảnh nguồn. Mọi ngày, cờ xét nghiệm và giá trị tiền khác chuẩn cần review theo decision của project.
4. Mọi thành phần confidence <0.5 phải kéo tổng <0.5; kết quả chưa review không được export/dùng tiếp.
5. Thử approve, sửa giá trị và lưu draft; kiểm tra trạng thái, final confidence, report và audit sau review.

## Lưu ý

Mờ, lệch góc, nhạt, bóng đổ, mất trường, chữ gạch đè là chủ đích. Dữ liệu và tên thuốc giả, không có giá trị y tế. Mẫu chữ viết tay MT-10 do imagegen tạo, chưa phải chữ người viết thực hoặc ground truth đã xác minh độc lập. Mẫu khác dựng layout rồi raster hóa bằng code; chất lượng được biến đổi cố định để tái lập. Không thay thế holdout từ scan thực tế.

MT-08: 2 tài liệu trên 1 trang có ranh giới/danh tính bị che một phần; chấp nhận bất định kèm review thay vì ép đúng số document. MT-11: có thể không phân loại được; bắt buộc không bịa dữ liệu. MT-12: ngày/tổng tiền bị xóa khỏi ảnh; không được lấy từ số cộng hay metadata.

Chưa chạy OpenAI trên 14 mẫu này; catalog ghi kỳ vọng, không ghi PASS giả.

## Tái tạo

Chạy npm run manual-test-samples:generate sau khi chuyển bộ hiện tại sang thư mục phiên bản khác. Script chủ động từ chối ghi đè manifest. Giữ assets/handwritten-prescription.png làm nguồn chữ viết tay, chạy trên macOS có Arial Unicode hoặc Linux có DejaVu Sans. Đầu ra PDF chứa ảnh, expected JSON là oracle cho người đối chiếu, không nạp vào reader.

- [MT-01-clean-receipt](MT-01-clean-receipt.pdf): Baseline: hóa đơn rõ, thuế/giảm giá/hoàn tiền/dòng 0
- [MT-02-faded-vietnamese](MT-02-faded-vietnamese.pdf): Scan nhạt, tiếng Việt, ngày mơ hồ
- [MT-03-european-money](MT-03-european-money.pdf): Tiếng Pháp, định dạng tiền khác chuẩn
- [MT-04-unknown-currency](MT-04-unknown-currency.pdf): Ký hiệu $ không xác định đơn vị tiền
- [MT-05-skewed-lab-flags](MT-05-skewed-lab-flags.pdf): Xét nghiệm lệch góc, cờ HH và L
- [MT-06-fax-missing-flag](MT-06-fax-missing-flag.pdf): Bản fax, thiếu cờ sodium
- [MT-07-discharge-two-pages](MT-07-discharge-two-pages.pdf): Giấy ra viện hai trang, Việt/Anh
- [MT-08-uncertain-boundary-patients](MT-08-uncertain-boundary-patients.pdf): Hai tài liệu trên một trang, che một phần danh tính
- [MT-09-mixed-bundle](MT-09-mixed-bundle.pdf): Một file: hóa đơn + xét nghiệm + đơn thuốc, khác bệnh nhân
- [MT-10-handwritten-prescription](MT-10-handwritten-prescription.pdf): Đơn thuốc có chữ viết tay và dòng bị gạch đè
- [MT-11-unreadable-scan](MT-11-unreadable-scan.pdf): Scan hỏng/mờ nghiêm trọng
- [MT-12-missing-date-and-total](MT-12-missing-date-and-total.pdf): Ngày và tổng tiền bị mất khỏi bản scan
- [MT-13-total-mismatch](MT-13-total-mismatch.pdf): Tổng tiền không khớp chi tiết trên 5%
- [MT-14-french-prescription-photo](MT-14-french-prescription-photo.pdf): Đơn thuốc tiếng Pháp, bóng đổ và nhiễu
