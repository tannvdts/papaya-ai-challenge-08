# Brainstorm — Medical Document Extractor

Ngày cập nhật: 19/10/2026. Tài liệu lưu phân tích, lý do lựa chọn, phương án kỹ thuật và các điểm còn mở; không phải đặc tả thay thế cho yêu cầu đã chốt.

## 1. Cách sử dụng và trạng thái quyết định

- [project-context.md](project-context.md) là nguồn chuẩn về mục tiêu, yêu cầu và quyết định nghiệp vụ đã thống nhất.
- Tài liệu này giữ phân tích làm căn cứ và những đề xuất cần đánh giá. Việc xuất hiện ở đây không có nghĩa một lựa chọn đã được phê duyệt hoặc triển khai.
- [first-implement-plan.md](../plans/first-implement-plan.md) mô tả thứ tự thực hiện, kiểm thử, nghiệm thu và ước lượng.
- [architecture.md](../diagrams/architecture.md) theo dõi kiến trúc hiện tại; Node.js/TypeScript, NestJS và MongoDB đã được người dùng chọn, không còn là câu hỏi mở.
- Khi chọn một phương án làm ràng buộc chính thức, cập nhật context và plan cùng lúc; không để brainstorm tự ghi đè context.

## 2. So sánh có và không dùng AI

Trong tài liệu này, “không dùng AI” được hiểu là không dùng LLM/vision tổng quát. OCR hiện đại có thể vẫn sử dụng machine learning; nếu loại trừ cả OCR dựa trên ML thì khả năng xử lý ảnh/scan giảm đáng kể.

| Tiêu chí | Không dùng LLM: lấy text/OCR + template/quy tắc | Dùng LLM vision |
|---|---|---|
| Ưu điểm | Dễ giải thích, tái hiện; hiệu quả với mẫu cố định; có thể xử lý nội bộ | Linh hoạt hơn trước bố cục, ngôn ngữ và nội dung tự do; giảm nhu cầu viết từng template |
| Nhược điểm | Tốn công bảo trì template; khó xử lý ngoại lệ, bảng qua trang và văn bản tự do | Có thể bịa, bỏ sót, ghép sai, tự tin sai; phụ thuộc model, API, chi phí và độ trễ |
| Độ chính xác | Có thể cao trên mẫu ổn định, chưa chứng minh được với mẫu mới | Có tiềm năng tổng quát hơn nhưng phải đo thực nghiệm; JSON đúng schema không đồng nghĩa nội dung đúng |
| Rủi ro vận hành | Tồn đọng nhập liệu; sai sót con người; mẫu mới phá vỡ quy tắc | Dữ liệu sai đi tiếp; lộ dữ liệu nhạy cảm; API lỗi; chất lượng thay đổi theo phiên bản |
| Khi phù hợp | Ít mẫu biểu, quy ước ổn định | Tài liệu đa dạng, cần đọc bố cục và ánh xạ ý nghĩa |

Kết luận đã đưa vào context: kết hợp AI đọc/trích xuất, code chuẩn hóa và kiểm tra, người xác nhận trường bắt buộc hoặc không chắc chắn. Chưa có benchmark để cam kết độ chính xác, chi phí hoặc mức tiết kiệm.

## 3. Phương án tích hợp OpenAI

Hướng triển khai đề xuất: backend gọi Responses API với model hỗ trợ PDF/ảnh và Structured Outputs. Model cụ thể lựa chọn sau benchmark; không khóa theo tên model ví dụ trong đề.

```text
File → document_scan_task → render/kiểm tra đầu vào
→ phân tách và phân loại → trích xuất theo schema
→ chuẩn hóa có căn cứ → validation + confidence + ảnh nguồn
→ lưu JSON + report HTML → người kiểm tra → dữ liệu được phép dùng tiếp
```

Đây là hướng tích hợp được đề xuất cho plan đầu tiên, chưa chốt model, phiên bản SDK hoặc số lần gọi API. Các yêu cầu bảo vệ API key, dữ liệu nguồn, xử lý lỗi, version hóa và an toàn local đã được giữ riêng trong mục 9 của context.

Cần đánh giá việc phân tách rồi trích xuất qua nhiều lần gọi so với một lần gọi cho file đơn giản. Chỉ tối ưu số lần gọi khi không làm giảm khả năng phát hiện trang/dòng bị bỏ sót.

Tài liệu kỹ thuật tham khảo đã dùng trong phân tích:

- [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)

Các đường dẫn trên được giữ từ lần phân tích trước; cần kiểm tra tài liệu hiện hành trước khi viết code hoặc lựa chọn model. Không có benchmark hoặc lời gọi API thực tế nào được xác nhận bởi tài liệu này.

## 4. Stack hiện tại và các thử nghiệm kỹ thuật

Đã chốt theo yêu cầu người dùng: Node.js/TypeScript, NestJS và MongoDB. Kiến trúc backend điều phối cố định, MCP cho công việc bằng code, AI chỉ đọc tài liệu được ghi trong [architecture.md](../diagrams/architecture.md).

Phương án triển khai hiện tại: MCP TypeScript SDK qua stdio; OpenAI Node SDK; Zod; Mongoose/`@nestjs/mongoose`; decimal.js + Decimal128; PDF.js + canvas tương thích Node; sharp; Handlebars; Jest/Supertest.

Cần spike trước khi khóa dependency: PDF render đa ngôn ngữ/tọa độ/crop trên Node, schema Zod tương thích provider, MongoDB local replica set/transaction và tiền round-trip không mất chính xác. Model AI, giới hạn tài liệu và ngân sách vẫn chưa chốt.

Phương án trước đây (Python, FastAPI, Pydantic, PyMuPDF/Pillow, SQLite, Jinja2, pytest) đã được thay thế bởi quyết định Node/NestJS/MongoDB; chỉ giữ dòng lịch sử này để giải thích thay đổi, không dùng làm stack triển khai hiện tại.

MCP không tự giảm chi phí AI nếu model phải điều phối từng tool. Backend gọi tools bằng code; AI chỉ nhận nội dung cần đọc. Không cam kết một lượt AI cho mọi file và không mặc định gọi lại khi confidence thấp.

## 5. Giới hạn, rủi ro còn lại và hướng khắc phục

- Chưa chứng minh hỗ trợ mọi ngôn ngữ, chữ viết tay hoặc bố cục. Phải báo phạm vi thực nghiệm, không hứa tổng quát tuyệt đối.
- Confidence do model tự khai có thể sai; dùng rule caps bắt buộc `<0.5`, đối chiếu nguồn và đánh giá calibration trên tập lớn hơn.
- 10 tài liệu là bộ demo, không đủ khẳng định chất lượng production. Cần tập riêng gồm mẫu chưa dùng chỉnh prompt.
- Đo classification, field accuracy, độ đầy đủ danh sách, hallucination, lỗi bị lọt ở dữ liệu được phép dùng tiếp, thời gian, chi phí và tỷ lệ cần review.
- Đặc biệt kiểm tra bỏ sót dòng/trang: confidence cao của các trường đã trích xuất không phát hiện được phần model bỏ quên.
- Local deletion phụ thuộc ứng dụng/máy chạy; thời hạn report không bảo đảm mọi bản sao dữ liệu đã bị xóa.
- Các điểm cần cấu hình/hoàn thiện khi triển khai: tập ngôn ngữ benchmark, model/API budget, giới hạn file, ngưỡng tiền tuyệt đối/làm tròn, dữ liệu bắt buộc cho nghiệp vụ downstream, thời hạn lưu dữ liệu chính và danh tính reviewer.

Các biện pháp đã trở thành yêu cầu như confidence min, bắt buộc ảnh nguồn, review gate và TTL report được đặc tả trong context. Phân tích ở đây không làm giảm hoặc miễn các yêu cầu đó.

## 6. Phạm vi và đánh đổi của bản đầu

Ưu tiên pipeline local có thể kiểm tra được, report HTML, dữ liệu giả lập và review gate thực sự ở backend. Không mặc định cần RAG, vector database, fine-tuning hoặc hạ tầng cloud. Khung 4–6 giờ của đề chỉ phù hợp prototype phạm vi hẹp; các yêu cầu mở rộng ở đây cần ước lượng riêng sau bước khảo sát.

## 7. Các câu hỏi và cấu hình chưa chốt

| Điểm còn mở | Cách xử lý trong plan đầu | Thời điểm cần quyết định |
|---|---|---|
| Model, API key, ngân sách, giới hạn file/trang | Cấu hình riêng; benchmark trước khi chọn | Trước chạy API thật và chốt cấu hình sử dụng |
| Tập ngôn ngữ và mức độ khó chữ viết tay | Tạo manifest benchmark, báo giới hạn theo dữ liệu đã thử | Khi chuẩn bị dữ liệu và đánh giá |
| Ngưỡng chênh lệch tiền tuyệt đối và làm tròn | Giữ quy tắc 5% đã có; xử lý tổng 0 riêng; không tự đặt ngưỡng nghiệp vụ | Trước nghiệm thu logic tiền hoàn chỉnh |
| Trường bắt buộc cho downstream | Giữ gate bảo thủ; không coi approve trường thiếu là tự đủ dữ liệu | Trước cho phép dùng dữ liệu vào nghiệp vụ |
| TTL file gốc và bằng chứng chính | Tách khỏi report 30 ngày; không tự xóa theo TTL report | Trước dùng dữ liệu thật |
| Danh tính và xác thực reviewer | Đề xuất cấu hình danh tính rõ ràng cho bản local; không tuyên bố có xác thực nhiều người | Khi dựng luồng review; đánh giá lại trước mở rộng người dùng |
| Xóa đúng hạn khi ứng dụng đóng | Dọn khi chạy lại; tác vụ nền hệ điều hành chưa thuộc bản đầu | Nếu cần bảo đảm xóa vật lý đúng hạn |
| Chia sẻ report ngoài máy | Giữ local theo yêu cầu hiện tại | Chỉ mở rộng khi có yêu cầu riêng |

Ước lượng thực hiện và các mốc điều chỉnh được quản lý trong plan, không phải cam kết hoặc kết quả thực nghiệm trong context.
