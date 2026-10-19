# Prompt engineering — Document Reader

Runtime prompt: [document-reader.txt](document-reader.txt). Schema nguồn: [contracts](../packages/contracts/index.ts). Adapter: [AI Reader](../packages/ai-reader/index.ts).

## Phạm vi AI

AI chỉ đọc các ảnh trang theo thứ tự nguồn, hiểu ranh giới tài liệu và trích xuất. Không cấp MCP tools, web search hoặc quyền approve/export/delete cho model. Validation, normalization, confidence caps, ảnh, review, HTML và cleanup đều chạy bằng code.

## Thiết kế prompt/schema

- Tách system instruction khỏi nội dung tài liệu, coi chỉ dẫn trong tài liệu là untrusted data.
- Model trả các leaf paths như items.0.total để lưu confidence và source page/bbox từng trường; code kiểm tra path theo allowlist, bổ sung trường thiếu và dựng output fields có value/confidence.
- Giữ raw text/ngôn ngữ; không dịch tên/thuốc, tự đoán currency, chuẩn hóa ngày mơ hồ hoặc suy ra cờ xét nghiệm từ khoảng tham chiếu.
- Không chắc tọa độ thì bbox null, ảnh bằng chứng fallback cả trang; không giả vờ có crop chính xác.
- Trường thiếu/unreadable null, confidence thấp. Model confidence chỉ là tín hiệu; code caps ngày mơ hồ/currency/flag/handwriting và lấy min. Điểm AI ban đầu không bị manual review sửa lại.
- Refund, 0 và điều chỉnh thuế/discount là mở rộng đã chọn so với đề gốc. Chỉ trích xuất tax/discount/refund riêng khi chúng thực sự là điều chỉnh ngoài tổng dòng; tránh double-count.
- Structured Outputs ràng buộc cấu trúc, không chứng minh nội dung đúng. Incomplete/refusal/schema invalid không được commit như extraction thành công.

## Cấu hình và giới hạn hiện tại

Model không hardcode; cấu hình OPENAI_MODEL và key qua env. SDK retries tắt; adapter quản lý retry hữu hạn theo budget. Ảnh đầu vào được render scale 1.7; file tối đa theo MAX_PAGES/MAX_UPLOAD_MB. Bản đầu gửi các trang được chấp nhận trong một request; chưa có chunk/merge ngữ nghĩa cho file vượt giới hạn. Không tự retry confidence thấp.

Cache chỉ giữ output extraction trước review trong 24 giờ, key gồm hash file, provider/mode, model, endpoint, credential fingerprint, prompt/schema và render version. Mỗi upload vẫn là task mới, không kế thừa approve. File cache thuộc môi trường local tin cậy; chưa có multi-user authorization.

## Bằng chứng và thử nghiệm

Đã có unit/integration assertions cho null/caps, date/currency/flag, cấu trúc/path, provider fake trả lỗi/schema sai, retry và chi phí gọi ngoài Reader bằng 0. Báo cáo ghi mọi attempts, cả những lần thất bại trước khi sửa.

Chưa có benchmark OpenAI thật vì môi trường chưa có OPENAI_API_KEY/OPENAI_MODEL. Các cases LIVE-01–10 phải ghi SKIPPED nếu chưa có cấu hình, không được diễn giải test fake là model đọc đúng. Ground truth hiện được khai báo độc lập với model output trong script tạo fixtures; vẫn cần người kiểm tra xác nhận từng tài liệu. Fixture thiếu dosage chưa đại diện handwriting thật.

Khi chạy thật, giữ model/prompt/schema version, raw output, usage và diff với ground truth. Các thay đổi prompt cần đánh giá lại cùng dataset và holdout, không chỉ chọn lần có kết quả đẹp. Tiếp tục bổ sung đa layout/chữ ngoài Latin/handwriting thật và chunked documents trước khi kết luận chất lượng rộng hơn baseline.
