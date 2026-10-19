# Output contract v1

## Hai mức output

Mỗi task trả task_id (đồng nghĩa scan_task_id), status/revision, confidence AI tổng, final_confidence, documents và report URL/expiry. Mỗi document có document_type, classification_confidence, segmentation_confidence, confidence, final_confidence, fields và validation_errors.

- `fields.<scalar>.value`: giá trị extraction sau chuẩn hóa có căn cứ; ambiguous/unreadable null. `raw_value` giữ nguyên nguồn, `candidate_value` giữ ứng viên.
- `fields.<list>.value`: danh sách các objects; mỗi leaf là object value/confidence như scalar. `diagnosis.value` chứa primary/secondary leaf objects. Confidence container lấy min.
- `fields_by_path`: map leaf path ổn định (items.0.total, tests.0.flag…), tiện API review. `field_list` là cùng dữ liệu leaf kèm metadata; không phải ba bản lưu độc lập.
- `final_value`, `final_confidence`: giá trị hiện tại và effective confidence sau review; trước review từ extraction/caps. Người xác nhận hợp lệ đưa điểm final lên 1.0, không đổi confidence AI.
- Tiền được tính decimal.js precision 50, giới hạn lưu Decimal128 34 significant digits, JSON là chuỗi thập phân. Dữ liệu vượt khả năng biểu diễn bị báo lỗi; không đi qua JS Number.
- Cờ ngoài normal/high/low: value null, raw_value giữ HH/H/*…, candidate giữ giá trị nguồn, confidence thấp. Người review có thể xác nhận giá trị nguồn vào final_value; không tự ánh xạ mất nghĩa.
- Missing fields được thêm null và score 0. Review missing cần lý do; không chứng minh thông tin không có trên nguồn thành đã được AI trích xuất. Chưa có chính sách downstream bắt buộc theo từng nghiệp vụ, không được coi ready là quyết định bồi thường.

## Đối chiếu tổng tiền

Phiên bản đầu: expected = sum(items.total) + explicit tax - abs(discount) - abs(refund). Prompt chỉ cho điều chỉnh explicit ngoài item totals. Với grand_total khác 0, mismatch = abs(expected - grand_total)/abs(grand_total) > 0.05. Với tổng 0, expected khác 0 là mismatch. Không cộng khác tiền tệ hoặc chuẩn hóa chuỗi không đủ căn cứ. Ngưỡng tuyệt đối và quy tắc làm tròn nghiệp vụ chưa được chốt.

## Ngày và review

Ngày DD/MM rõ hoặc ISO có căn cứ được chuẩn hóa ISO; DD/MM có ngày/tháng 1–12 khác nhau giữ null/candidate và warning. Approve ngày mơ hồ chưa resolve không tự vượt gate; người dùng phải sửa/xác nhận một ngày ISO hợp lệ. Mọi ngày và flag luôn cần review. Save draft không giữ approve/điểm final 1.0 cũ.

Đây là contract implementation mở rộng; khác biệt với ví dụ đề gốc là task envelope chứa N results, tiền dạng chuỗi, metadata raw/evidence/review và quy tắc 0/refund. Chi tiết nghiệm thu trong test strategy; không khẳng định tương thích JSON nguyên trạng với mọi evaluator của đề gốc.


## Metadata hỗ trợ review table

Snapshot field có `review_reasons` (danh sách mã, bổ sung tương thích); ngày rõ có `DATE_REVIEW_REQUIRED` mà không cần warning lỗi/giảm điểm giả. Document có `requires_structure_review` suy ra từ confidence phân loại/phân tách và trạng thái đã xác nhận. Lỗi blocking theo path được phản ánh vào nhu cầu xử lý field. `requires_review` và `review_status` phải xét cùng nhau: pending không đồng nghĩa bắt buộc.

API từ chối approve/correct ngoài vòng review pending hợp lệ (`REVIEW_NOT_REQUIRED`); field không bắt buộc/đã xác nhận có thể mở lại review bằng draft. Duplicate cùng operation ID vẫn idempotent. JSON giữ final_confidence hiệu lực hiện hành; UI chỉ hiển thị điểm “Sau kiểm tra” khi confirmed/corrected, nếu chưa thì `—`. UI không tự tính lại hoặc ghi confidence.
