# Project context — Medical Document Extractor

Ngày cập nhật: 19/10/2026. Tài liệu này tổng hợp đề bài gốc và các quyết định đã thống nhất trong cuộc trao đổi. Đây là nguồn chuẩn về yêu cầu và quyết định đã chốt; kết quả triển khai/kiểm thử được theo dõi riêng trong [implementation-status](../plans/implementation-status.md).

Phân tích so sánh, rủi ro, phương án kỹ thuật và câu hỏi chưa chốt nằm trong [brainstorm.md](brainstorm.md). Thứ tự thực hiện, kiểm thử, nghiệm thu và ước lượng nằm trong [first-implement-plan.md](../plans/first-implement-plan.md). Kiến trúc hiện tại được theo dõi tại [architecture.md](../diagrams/architecture.md). Đề xuất chưa được chốt trong brainstorm/plan không tự thay đổi yêu cầu của tài liệu này.

## 1. Nguồn và mục tiêu

Đề bài: [AI Challenge 08 — Medical Document Extractor](https://github.com/papaya-insurtech/pumpkin/blob/main/Hiring/AI_Engineering_Challenges/AI_Challenge_08.md).

Xây pipeline nhận PDF hoặc ảnh tài liệu y tế, phân loại, trích xuất dữ liệu thành JSON, cung cấp confidence và kiểm tra tính hợp lệ. Mục tiêu nghiệp vụ là giảm nhập liệu thủ công trong xử lý hồ sơ bồi thường. Phạm vi là phản ánh nội dung tài liệu; không tự chẩn đoán, tư vấn điều trị, quyết định bồi thường hay kết luận gian lận.

## 2. Yêu cầu ban đầu từ đề bài

- Sử dụng công cụ AI hỗ trợ lập trình; dùng LLM có vision, API key riêng hoặc free tier.
- Đề nghị ứng viên ước lượng timeline; thời lượng tham khảo 4–6 giờ, độ khó Advanced.
- Chuẩn bị 10 tài liệu, có thể tạo giả lập bằng HTML → PDF: 3 hóa đơn/biên lai, 3 giấy ra viện, 2 kết quả xét nghiệm, 2 đơn thuốc.
- Tự phân loại thành `receipt`, `discharge_summary`, `lab_report`, `prescription`, kèm confidence.
- Trích xuất các trường sau:

| Loại | Các trường |
|---|---|
| `receipt` | `hospital_name`, `patient_name`, `date`, `items[{description, quantity, unit_price, total}]`, `grand_total`, `payment_method` |
| `discharge_summary` | `hospital_name`, `patient_name`, `admission_date`, `discharge_date`, `diagnosis` gồm primary và secondary, `procedures_performed`, `attending_physician`, `discharge_instructions` |
| `lab_report` | `lab_name`, `patient_name`, `date`, `tests[{test_name, result, unit, reference_range, flag}]` |
| `prescription` | `doctor_name`, `patient_name`, `date`, `medications[{name, dosage, frequency, duration, quantity}]` |

- Output gốc có `document_type`, `confidence`, `fields` với `value` và `confidence` của từng trường, `validation_errors`.
- Kiểm tra ngày hợp lệ; số tiền dương; cảnh báo nếu tổng chi tiết lệch `grand_total` trên 5%; confidence trong khoảng 0–1.
- Không bịa dữ liệu: trường không nhìn thấy trả `null` với confidence thấp.
- Đánh giá phân loại đúng 10 tài liệu, trích xuất khớp nguồn, confidence có ý nghĩa, validation phát hiện lỗi và pipeline không hardcode theo mẫu thử.
- Bài nộp: GitHub repository, 10 tài liệu và kết quả, writeup về prompt engineering.

Các quyết định bên dưới mở rộng đề bài. Riêng quy tắc số tiền dương được thay thế bởi kiểm tra theo loại giao dịch, vì có số 0, giảm giá và hoàn tiền hợp lệ.

## 3. Hướng xử lý đã chốt

Kết hợp AI đọc/trích xuất, code chuẩn hóa và kiểm tra, người xác nhận trường bắt buộc hoặc không chắc chắn. Không cam kết độ chính xác, chi phí hoặc mức tiết kiệm khi chưa có benchmark.

Quyết định kỹ thuật bổ sung: hệ sinh thái Node.js/TypeScript, backend NestJS và database MongoDB. AI dùng để đọc/hiểu tài liệu; công việc xử lý được bằng code cung cấp qua MCP tools, backend điều phối cố định để giảm lượt AI. Chi tiết trong [architecture.md](../diagrams/architecture.md).

Lý do: cần xử lý tài liệu đa dạng nhưng vẫn kiểm soát suy diễn sai và dữ liệu không chắc chắn. So sánh chi tiết hai cách tiếp cận được chuyển sang mục 2 của [brainstorm.md](brainstorm.md).

## 4. Đơn vị xử lý và phân tách tài liệu

- Mỗi lần tiếp nhận một file để xử lý tạo một `document_scan_task`, định danh bằng `scan_task_id`.
- Một task có N kết quả tài liệu. Phân tách theo tài liệu nghiệp vụ, sau đó gán `document_type`; không nhóm gộp chỉ vì cùng loại.
- Hai hóa đơn cùng loại trong một file phải là hai kết quả. Một hóa đơn qua nhiều trang phải giữ thành một kết quả.
- Hỗ trợ một trang chứa nhiều tài liệu bằng vùng nguồn; một trang có thể được tham chiếu bởi nhiều document.
- Không tự ghép thông tin của các bệnh nhân/tài liệu khác nhau.
- Không rõ ranh giới tài liệu hoặc bệnh nhân: confidence phân tách `<0.5`, yêu cầu kiểm tra và lưu ảnh các vùng/trang liên quan.
- Trang ngoài bốn loại không bị ép phân loại: giữ trạng thái không hỗ trợ/cần kiểm tra ở cấp task; không âm thầm bỏ qua.
- Theo dõi trang/vùng đã xử lý để phát hiện bỏ sót và xử lý trùng. Confidence cao của một phần không chứng minh đã đọc đủ toàn file.

## 5. Đa ngôn ngữ và dữ liệu nguồn

- AI cần đọc tài liệu nhiều ngôn ngữ, kể cả trộn ngôn ngữ trong cùng tài liệu.
- Giữ nguyên tên bệnh nhân, thuốc, dịch vụ và nội dung gốc; không dịch/phiên âm âm thầm. Nếu bổ sung bản dịch, lưu riêng và không thay thế nguồn.
- Không giả định chất lượng đồng đều trên mọi ngôn ngữ. Ghi nhận ngôn ngữ khi có thể và kiểm thử riêng; nếu không đọc đáng tin cậy thì trả `null` hoặc ứng viên với confidence thấp, chuyển kiểm tra.
- Tách `raw_value`, giá trị chuẩn hóa và giá trị ứng viên. Chỉ chuẩn hóa khi có đủ căn cứ; giữ lý do và quy tắc đã áp dụng.

## 6. Confidence và điều kiện sử dụng tiếp

### 6.1. Thang điểm

Tên chuẩn là `confidence`, giá trị từ 0 đến 1. Đây là điểm phục vụ kiểm soát/xét duyệt, chưa phải xác suất đúng đã được hiệu chuẩn.

| Khoảng | Ý nghĩa | Màu báo cáo |
|---|---|---|
| `0.00–0.19` | Không đủ bằng chứng hoặc không thể đọc đáng tin cậy | Đỏ đậm |
| `0.20–0.49` | Có ứng viên nhưng mơ hồ, thiếu căn cứ hoặc có vấn đề | Đỏ |
| `0.50–0.79` | Đọc được nhưng bằng chứng/ánh xạ còn hạn chế | Cam |
| `0.80–0.94` | Nguồn rõ, ánh xạ hợp lý, chưa thấy mâu thuẫn | Xanh lá nhạt |
| `0.95–1.00` | Bằng chứng rất rõ, kiểm tra liên quan đạt | Xanh lá đậm |

Các khoảng triển khai là `[0,0.2)`, `[0.2,0.5)`, `[0.5,0.8)`, `[0.8,0.95)`, `[0.95,1]`; không làm tròn trước khi so ngưỡng. Ví dụ 0.4999 vẫn bị chặn. Giá trị không hợp lệ/thiếu không được coi là đạt.

### 6.2. Tổng hợp

```text
document.confidence = min(
  confidence phân tách,
  confidence phân loại,
  confidence từng trường và từng trường con trong danh sách
)
task.confidence = min(confidence tất cả document, confidence bao phủ/phân tách toàn file)
```

- Một thành phần `<0.5` → confidence document/task liên quan `<0.5`. Không lấy trung bình.
- Trường cần lấy nhưng thiếu/không đọc được phải tham gia phép tính với confidence `<0.5`; không bỏ khỏi phép tính để tăng điểm.
- Trường không áp dụng theo schema có thể loại khỏi phép tính nhưng cần ghi rõ lý do. Việc này không được do model tùy ý quyết định để né trường bị thiếu.
- Task không có kết quả, còn vùng chưa xử lý hoặc còn phần không hỗ trợ không được tự coi là thành công.

### 6.3. Kiểm tra thủ công và chặn dữ liệu

- Mọi trường ngày tháng và cờ xét nghiệm bắt buộc xác nhận, kể cả khi confidence cao.
- Tiền có format khác quy ước `000,000,000.00`, chữ viết tay khó đọc và các tình huống thiếu căn cứ phải được kiểm tra.
- Có `requires_review`, lý do và trạng thái `pending`, `confirmed`, `corrected` ở mức phù hợp.
- Trả JSON/report để người dùng xem ngay cả khi bị chặn; “chặn” là không cho dữ liệu được sử dụng ở bước nghiệp vụ tiếp theo.
- Backend chỉ cho sử dụng tiếp khi không còn confidence hiệu lực `<0.5`, mọi kiểm tra bắt buộc đã hoàn tất và không còn lỗi validation chặn.
- Giữ nguyên `extraction_confidence` và kết quả AI ban đầu để đánh giá. Điểm hiệu lực sau review lưu riêng; quy ước 1.0 sau xác nhận chỉ biểu thị “đã xác nhận”, không biểu thị AI đúng 100%.
- Người xác nhận phải xử lý giá trị và lý do cảnh báo, không chỉ bấm bỏ qua. Trường thiếu có thể được xác nhận là thiếu khi nghiệp vụ cho phép; trường bắt buộc cho bước sau vẫn chặn nếu chưa có giá trị.
- Lưu người xác nhận, thời điểm, giá trị trước/sau và lý do. Chạy lại AI tạo revision mới; không tự kế thừa approve cho dữ liệu/nguồn đã thay đổi.
- Quy tắc min chỉ bảo đảm dữ liệu bị đánh dấu thiếu tin cậy sẽ bị chặn; không bảo đảm phát hiện mọi lỗi.

## 7. Quy tắc theo nhóm trường và ảnh bằng chứng

| Tình huống | Xử lý | Bằng chứng |
|---|---|---|
| Ngày nhiều cách diễn giải hoặc thiếu căn cứ chuyển đổi | Confidence `<0.5`; giữ chuỗi gốc; không ép chuẩn hóa | Bắt buộc lưu ảnh nguồn |
| Không rõ đơn vị tiền tệ | Confidence `<0.5`; yêu cầu chỉnh sửa/approve | Chuỗi gốc và ảnh nguồn |
| Cờ xét nghiệm ngoài `normal/high/low` | Giữ nguyên giá trị gốc, confidence `<0.5` | Bắt buộc lưu ảnh nguồn |
| Chữ viết tay khó nhận diện | Confidence `<0.5`; ứng viên hoặc `null`; bắt buộc kiểm tra | Bắt buộc lưu ảnh nguồn |
| Không rõ ranh giới tài liệu/bệnh nhân | Confidence phân tách `<0.5`; kiểm tra | Ảnh vùng/trang liên quan |
| Có vùng dữ liệu nhưng không đọc được | `null`, confidence `<0.5` | Bắt buộc lưu ảnh nguồn |
| Không tìm thấy trường cần lấy | `null`, confidence `<0.5` | Tham chiếu các trang đã kiểm tra; không tạo vùng cắt giả |

### 7.1. Ngày

- Mặc định DD/MM/YYYY nhưng chỉ chuyển đổi khi đủ căn cứ.
- Với `03/04/2026`, có thể lưu ứng viên theo mặc định nhưng không trình bày như giá trị đã xác định; confidence `<0.5`, ảnh nguồn và cảnh báo bắt buộc.
- Hai thành phần trong 1–12 và khác nhau có thể tạo hai cách hiểu DD/MM và MM/DD. `03/03/2026` không mơ hồ theo cách này nhưng vẫn thuộc diện xác nhận ngày.
- Năm hai chữ số, ngày viết bằng chữ, lịch khác hoặc quy ước tài liệu chưa rõ phải được xử lý minh bạch; không âm thầm suy đoán.

### 7.2. Tiền

- Có thuế, giảm giá, hoàn tiền và dòng bằng 0. Kiểm tra dấu và giá trị theo vai trò khoản tiền/loại giao dịch.
- Mọi trường tiền giữ chuỗi gốc và ảnh vùng chứa chuỗi gốc; ghi đơn vị tiền và căn cứ chuẩn hóa.
- Dựa trên đơn vị tiền tệ và quy ước định dạng có bằng chứng để dựng giá trị. Đơn vị tiền riêng lẻ chưa đủ phân giải mọi dấu phân cách, ví dụ `1,234`.
- Không rõ đơn vị tiền hoặc còn mơ hồ cách đọc: confidence `<0.5`, không coi giá trị chuẩn hóa là đã xác định.
- Format khác `000,000,000.00` phải kiểm tra dựa trên chuỗi gốc, kể cả sau khi chuẩn hóa được.
- Không tự quy đổi tiền tệ; không cộng các khoản khác tiền tệ.
- Dùng số thập phân chính xác; tính tổng dựa trên ý nghĩa thuế/giảm giá/hoàn tiền, tránh cộng hai lần các khoản đã bao gồm trong dòng.
- Giữ cảnh báo chênh lệch tương đối trên 5% của đề gốc khi có thể so sánh. Tổng bằng 0 xử lý riêng, không chia cho 0. Ngưỡng tuyệt đối và quy tắc làm tròn theo tiền tệ là cấu hình cần hoàn thiện, không tự đặt như quyết định nghiệp vụ đã chốt.

### 7.3. Cờ xét nghiệm

- Chỉ lấy cờ từ bản gốc; không suy ra từ kết quả/khoảng tham chiếu.
- Lưu `flag_raw`. Chỉ điền giá trị chuẩn `normal/high/low` khi bản gốc thuộc các giá trị này, có thể chuẩn hóa hoa/thường và khoảng trắng nhưng vẫn giữ nguồn.
- `H`, `L`, `HH`, `LL`, dấu sao, màu sắc hoặc giá trị khác không tự ánh xạ mất thông tin: giữ nguồn, confidence `<0.5`, ảnh và yêu cầu kiểm tra.
- Không thấy cờ thì `null`, confidence thấp; không tự điền `normal`.

### 7.4. Quản lý ảnh

- Ảnh từng trang và vùng cắt được quản lý theo `scan_task_id`, liên kết đến `document_id`, field path, số trang và tọa độ.
- Không tin tuyệt đối tọa độ do AI cung cấp: xác nhận giới hạn ảnh, hệ tọa độ, trang nguồn; vùng không đáng tin phải có ảnh cả trang và yêu cầu kiểm tra.
- Giữ ảnh đủ ngữ cảnh để kiểm tra nhãn, đơn vị tiền, tên bệnh nhân hoặc tiêu đề cột; tránh crop chỉ một con số mất nghĩa.

## 8. Output và báo cáo HTML local

### Trang manual test tương tác

- Có một trang local cho người dùng upload PDF/ảnh, theo dõi scan_task và xem N document results ngay trong trang.
- Hiển thị file/ảnh nguồn, loại tài liệu, raw/candidate/normalized values, confidence AI ban đầu và confidence cuối, warnings, validation và trạng thái review từng trường/document/task.
- Cho phép approve giá trị hiện tại hoặc sửa giá trị rồi lưu/xác nhận. Có thể xác nhận một document nhưng backend phải kiểm tra từng trường bắt buộc và lỗi còn lại, không approve blanket để bỏ qua gate.
- `final_value` là giá trị hiện được sử dụng sau review; `final_confidence` là tên hiển thị/API cho effective confidence, không phải một điểm thứ ba được nhập độc lập. Trước review, final confidence bằng điểm trích xuất đã áp rule caps.
- Approve hợp lệ: field `confirmed`; sửa và xác nhận hợp lệ: field `corrected`; final confidence theo quy ước review là 1.0. Giữ nguyên giá trị AI gốc, confidence ban đầu và ảnh nguồn; 1.0 biểu thị người dùng đã xác nhận, không chứng minh AI chính xác.
- Sửa nhưng chưa xác nhận: field `pending`, không kế thừa approve/điểm final 1.0 trước đó. Không cho người dùng gõ số confidence tùy ý để vượt gate.
- Backend validate và tính lại trạng thái/final confidence theo min cho document/task, gồm các thành phần phân tách/phân loại/coverage. Nếu các thành phần này chưa chắc, trang phải cho review xác nhận/sửa liên kết nguồn hoặc giữ trạng thái chặn; field approve không tự nâng confidence phân tách.
- Task `ready` chỉ khi gate thực sự đạt. Còn bất kỳ pending bắt buộc/lỗi chặn thì vẫn `awaiting_review`; sửa dữ liệu không hợp lệ không được tính là đã duyệt.
- Lưu người duyệt, thời điểm, lý do, trước/sau và revision; reload vẫn giữ kết quả đã commit. Không gọi AI khi sửa/approve hoặc polling trạng thái; rerun là thao tác riêng.
- Manual page cần backend đang chạy. HTML scan report và test report là bản xem chỉ đọc; thao tác manual không tự chuyển testcase FAIL thành PASS hoặc sửa ground truth.

### JSON và báo cáo scan

Mapping schema implementation v1 được ghi trong [output-contract.md](output-contract.md); không thay đổi các quy tắc nghiệp vụ đã chốt.


- Output gồm `scan_task_id`, confidence tổng, trạng thái review, N `documents`, lỗi/cảnh báo và `report`.
- `report` có link `url`, thời điểm tạo và `expires_at`. Link thực tế do ứng dụng local dựng, không hardcode hostname/port giả.
- Mỗi task có báo cáo HTML, mở bằng trình duyệt từ link local khi ứng dụng chạy; có `index.html` mở trực tiếp với assets tương đối.
- Báo cáo tổng hợp theo từng document; hiển thị tất cả fields và phần tử danh sách, raw/normalized/candidate value, confidence, warnings, validation và trạng thái review.
- Hiển thị confidence phân tách/phân loại; tổng quan task có tên file, thời gian, số tài liệu và số trường cần kiểm tra.
- Áp dụng màu ở mục 6; luôn có điểm số và nhãn chữ, không dựa riêng vào màu. Trường bắt buộc xác nhận có nhãn độc lập.
- Ảnh nguồn nếu có được hiển thị tại trường; click phóng to hoặc xem trang gốc. Nội dung phải hoạt động offline, không dùng CDN.
- HTML là snapshot chỉ đọc. Approve/correct thực hiện trong ứng dụng/backend, sau đó tạo lại snapshot cùng revision phù hợp; báo cáo ghi revision và thời điểm để tránh hiểu nhầm bản cũ là hiện trạng.

### Thời hạn 30 ngày

- HTML và các bản ảnh tạo riêng cho report được lưu 30 ngày tính từ lần tạo report ban đầu; việc xem hoặc tái tạo sau review không tự gia hạn.
- Hết hạn xóa HTML và report assets. Không ngầm áp dụng thời hạn này cho file gốc, ảnh bằng chứng chính hoặc dữ liệu nghiệp vụ; chính sách lưu các dữ liệu đó cần quyết định riêng.
- Report assets thuộc task nhưng tách bản lưu khỏi bằng chứng chính để dọn report không phá dữ liệu review.
- Kiểm tra hết hạn khi khởi động, định kỳ khi đang chạy và trước khi phục vụ report/assets; link hết hạn trả thông báo rõ ràng.
- HTML không tự xóa. Nếu máy/ứng dụng tắt thì xóa vật lý ở lần chạy tiếp theo. Muốn xóa đúng hạn khi ứng dụng đóng cần tác vụ nền hệ điều hành; chưa được coi là đã triển khai.
- Không thể thu hồi bản người dùng đã copy hoặc xuất ra ngoài vùng quản lý.

## 9. Ràng buộc tích hợp và kiểm soát kỹ thuật

Các kiểm soát sau cần được duy trì khi lựa chọn giải pháp tích hợp. Phương án OpenAI Responses API, pipeline và nguồn tham khảo nằm trong mục 3 của [brainstorm.md](brainstorm.md); model cụ thể chưa chốt.

- API key chỉ ở backend, không ghi vào repo/report/log.
- Tích hợp OpenAI qua env: đổi key/model/cấu hình được hỗ trợ và restart, không sửa source; cấu hình được validate, có `.env.example` không chứa secret. Không đồng nghĩa mọi model/provider tương thích.
- Bổ sung healthcheck để theo dõi ứng dụng và dependency; phân biệt cấu hình OpenAI hợp lệ với kết nối/khả năng provider đã được kiểm chứng. Polling health không gọi model; chi tiết triển khai theo plan/architecture.
- Tài liệu là dữ liệu không đáng tin, không phải chỉ dẫn; không cấp công cụ thực thi cho model chỉ vì nội dung file yêu cầu.
- Structured Outputs kiểm soát cấu trúc; code và người dùng kiểm soát nội dung. Xử lý riêng refusal, timeout, rate limit và phản hồi chưa hoàn tất.
- Giới hạn dung lượng, trang, số lần gọi và retry; chunk tài liệu dài nhưng giữ liên kết qua trang và phát hiện trùng/thiếu.
- Version hóa model, prompt, schema và kết quả; đánh giá lại trước thay đổi. Không âm thầm fallback sang model khác.
- Dùng dữ liệu giả lập/ẩn danh cho bài nộp. Không đưa hồ sơ y tế thật lên GitHub.
- Local server chỉ bind loopback theo mặc định; chặn path traversal/truy cập chéo task; escape nội dung tài liệu trong HTML để tránh thực thi mã.
- Áp dụng cùng quyền truy cập cho ảnh và file nguồn; tránh log toàn bộ nội dung y tế.
- API không dùng dữ liệu huấn luyện theo mặc định không đồng nghĩa không lưu dữ liệu. `store: false` không thay thế Zero Data Retention; file upload cần quản lý vòng đời riêng. Kiểm tra chính sách và tính phù hợp trước dùng dữ liệu thật.

## 10. Tiêu chí đầu ra và đánh giá

- Phản ánh đúng nội dung tài liệu, không hardcode theo bộ mẫu; báo rõ phạm vi ngôn ngữ/bố cục đã kiểm thử, không tuyên bố hỗ trợ tuyệt đối khi chưa có bằng chứng.
- Kiểm tra phân loại, độ chính xác trường, độ đầy đủ danh sách/trang và hallucination; không chỉ kiểm tra JSON hợp lệ.
- Đo riêng chất lượng AI trước review và dữ liệu cuối sau review; điểm sau xác nhận không phải bằng chứng AI chính xác.
- Đo lỗi còn lọt ở dữ liệu được phép dùng tiếp, thời gian, chi phí và tỷ lệ cần review.
- Giữ bộ 10 mẫu theo đề và có dữ liệu kiểm tra khác mẫu chỉnh prompt để đánh giá khả năng tổng quát hóa. Không suy rộng kết quả 10 mẫu thành chất lượng production.
- Có JSON, ảnh bằng chứng theo task, report HTML local và cơ chế chặn thực sự theo các mục 4–9.
- Báo cáo test gồm một trang HTML chung cho smoke, integration và OpenAI thật; OpenAI thật kiểm tra riêng đủ 10 documents baseline (3 receipts, 3 discharge summaries, 2 labs, 2 prescriptions), hiển thị kết quả từng tài liệu kể cả chưa chạy/bị chặn.
- Smoke và integration cần bộ testcase đa dạng, truy vết từng rủi ro/quyết định và kết quả mong đợi; tách kiểm thử AI giả lập khỏi OpenAI thật. Ma trận thực thi trong [test-strategy.md](../plans/test-strategy.md); testcase chưa chạy không được tính là đã chứng minh chất lượng.

Giới hạn của phép đo, rủi ro chưa loại bỏ và các cấu hình chưa quyết định được lưu tại mục 5 và 7 của [brainstorm.md](brainstorm.md).

## 11. Phạm vi phiên bản đầu

Ưu tiên pipeline local có thể kiểm tra được, report HTML, dữ liệu giả lập và review gate thực sự ở backend. Yêu cầu hiện tại không bắt buộc RAG, vector database, fine-tuning hoặc hạ tầng cloud.

Node.js/TypeScript, NestJS và MongoDB đã được chốt. Cấu trúc AI/MCP và tracking kiến trúc nằm trong [architecture.md](../diagrams/architecture.md); model và thư viện hỗ trợ còn cần benchmark/spike được ghi trong [brainstorm.md](brainstorm.md). Ước lượng và thứ tự thực hiện nằm trong [first-implement-plan.md](../plans/first-implement-plan.md); khung 4–6 giờ trong đề gốc không phải cam kết hoàn thành phạm vi mở rộng.
