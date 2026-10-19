# Smoke và integration test strategy

Ngày cập nhật: 19/10/2026. Trạng thái: ma trận mục tiêu; đã có runners và kết quả local. Xem [implementation-status](implementation-status.md) và report thực tế, không coi testcase mô tả là bằng chứng tự động. Các subcases được thực thi nằm trong tests/run.ts; không suy rộng PASS sang mọi biến thể chưa chạy.

Tham chiếu: [yêu cầu](../context/project-context.md), [kiến trúc và ARCH decisions](../diagrams/architecture.md), [implementation plan](first-implement-plan.md), [phân tích rủi ro](../context/brainstorm.md).

## 1. Mục tiêu và phạm vi

Kiểm tra các rủi ro đã nhận diện và các quyết định khắc phục: đọc sai/bỏ sót, ghép nhầm bệnh nhân, confidence cao nhưng dữ liệu sai, chuẩn hóa âm thầm, review bị bypass, lỗi tiền, mất ảnh bằng chứng, API/MCP/DB lỗi, report hết hạn chưa được chặn và dùng AI vượt mục đích.

Mỗi test có ID, fixture, expected result, traceability, priority và bằng chứng chạy. Test có lỗi dữ liệu phải chứng minh cả dữ liệu trả về lẫn việc bị chặn đúng; không chỉ assert HTTP thành công hoặc JSON parse được.

## 2. Các tầng kiểm thử

| Suite | Thành phần thật / giả lập | Mục đích và tần suất |
|---|---|---|
| Smoke local | NestJS, MCP stdio, MongoDB replica set, render/crop/filesystem thật; Reader fake | Kiểm tra hệ thống khởi động và một luồng cơ bản; chạy sau build/thay hạ tầng, 0 OpenAI calls |
| Integration deterministic | Components nội bộ thật; fake OpenAI HTTP có kiểm soát, clock/fault injection | Xác minh nghiệp vụ, concurrency, recovery và lỗi; chạy trước nghiệm thu từng giai đoạn |
| Integration OpenAI live | Cùng pipeline với OpenAI thật; tài liệu giả lập/ẩn danh | Kiểm tra key/model/input/schema và chất lượng trích xuất; chạy chủ động với budget cấu hình |
| Report/UI end-to-end | Browser thật + server local + report offline | Kiểm tra ảnh, link, màu/nhãn, review và expiry; không dùng ảnh chụp HTML làm bằng chứng toàn pipeline đúng |

Fake Reader chỉ thay ranh giới provider. Không mock toàn bộ MCP, MongoDB và filesystem rồi gọi đó là integration. Unit tests bổ trợ các quy tắc thuần và giá trị biên; không thay thế các suite trên.

## 3. Dữ liệu kiểm thử và đáp án chuẩn

- Giữ bộ 10 tài liệu baseline: 3 receipts, 3 discharge summaries, 2 lab reports, 2 prescriptions. Tách các bản biến thể khỏi baseline để không nhầm số lượng theo đề.
- Thêm composite files: khác loại, cùng loại khác bệnh nhân, một tài liệu qua nhiều trang, nhiều tài liệu trên một trang, trang ngoài phạm vi.
- Đa ngôn ngữ đề xuất để thử: tiếng Việt, Anh, một ngôn ngữ dùng chữ ngoài Latin, và trang trộn ngôn ngữ; đây là bộ benchmark ban đầu, chưa phải cam kết hỗ trợ mọi ngôn ngữ.
- Biến thể hình ảnh: scan rõ/mờ, xoay 90/180 độ, chữ nhỏ, crop sát mép, bảng qua trang, thiếu trang và tài liệu trùng.
- Chữ viết tay: mẫu giả lập viết tay thực tế hoặc có người xác nhận; không coi font giống viết tay là đại diện đầy đủ cho chữ viết tay thật.
- Manifest mỗi fixture: ID/hash, loại file, ngôn ngữ, document boundaries, bệnh nhân giả lập, trang/vùng nguồn, raw fields, normalized value nếu xác định được, lý do mơ hồ, flags, tiền/currency, warnings/review bắt buộc và evidence mong đợi.
- Ground truth được người kiểm tra xác nhận độc lập, không dùng output cùng model làm đáp án. Với trường mơ hồ, đáp án chuẩn có thể là null/ứng viên + warning thay vì ép một giá trị.
- Bổ sung biến thể adversarial để kiểm tra bảo vệ: nội dung tài liệu có chỉ dẫn giả, HTML/script, tên file/path độc hại; không chứa dữ liệu y tế thật hoặc secret thật.
- Tách dữ liệu chỉnh prompt và holdout khác mẫu; version hóa manifest, fixture và ground truth.

## 4. Rủi ro và quyết định cần truy vết

| Risk ID | Rủi ro | Quyết định / vùng yêu cầu |
|---|---|---|
| R01 | Bỏ sót/trùng/ghép sai tài liệu hoặc bệnh nhân | Context 4; N results, boundaries, coverage; ARCH-005/010 |
| R02 | Sai ngày hoặc ép chuẩn hóa | Context 7.1; DD/MM, mơ hồ dưới 0.5, ảnh, review |
| R03 | Sai tiền/currency/tổng, mất chính xác | Context 7.2; raw + ảnh, Decimal128/decimal.js; ARCH-007 |
| R04 | Tự suy diễn hoặc mất thông tin cờ xét nghiệm | Context 7.3; nguyên bản, ngoài chuẩn dưới 0.5 |
| R05 | Confidence che lỗi, bypass review/export | Context 6; min và review gate; ARCH-006 |
| R06 | Thiếu/sai ảnh bằng chứng, render lệch | Context 7.4; page/bbox, fallback; ARCH-008 |
| R07 | Bịa dữ liệu, đọc sai đa ngôn ngữ/viết tay | Context 5/7; giữ nguồn, null, review; ARCH-005 |
| R08 | MCP/worker/DB lỗi, retry trùng, audit sai | ARCH-001/002/004/006/010 |
| R09 | HTML không dùng được, hết hạn vẫn truy cập được | Context 8; HTML offline/30 ngày; ARCH-009 |
| R10 | Sai env, lộ key hoặc hiểu nhầm health | ARCH-011/012 |
| R11 | Thêm AI calls không cần thiết, vượt budget/cache sai | ARCH-003/005/010/011 |
| R12 | Truy cập chéo task, injection, thao tác trái quyền | Context 9; artifact ownership, escape, actor/backend gate |

## 5. Smoke test suite

Các case smoke là P0; dùng dữ liệu cố định, timeout hữu hạn và assertion theo trạng thái hoàn thành thay vì sleep cố định. Mục tiêu chạy nhanh; đo thời gian thực tế trước khi đặt SLA.

| ID | Tình huống | Expected result | Trace |
|---|---|---|---|
| SM-01 | Khởi động bằng env hợp lệ, Reader fake chủ động | NestJS + MCP + MongoDB chạy; mode hiển thị mock, không tự nhận ready scan OpenAI thật | R08/R10 |
| SM-02 | MCP initialize/list/call | Đủ required tools; get_system_health phản hồi typed, stdout không lẫn log | R08; ARCH-004 |
| SM-03 | GET live và readiness với cấu hình openai hợp lệ nhưng chưa verify | Live 200; ready chỉ phản ánh local/config, provider là not_checked; 0 AI calls | R10; ARCH-012 |
| SM-04 | Upload một receipt PDF, fake Reader trả kết quả chuẩn | Một task, một document, raw/fields/evidence/report có thể đối chiếu | R01/R06 |
| SM-05 | Upload một ảnh prescription | Ảnh được đọc qua cùng pipeline; đủ source refs và report | R06/R07 |
| SM-06 | Composite có hai tài liệu khác loại | Một task, hai document IDs, không gộp dữ liệu | R01 |
| SM-07 | Một field có confidence 0.49 | Document/task dưới 0.5, review required, export bị chặn; JSON/report vẫn xem được | R05 |
| SM-08 | Ngày/cờ confidence cao chưa confirm | Vẫn bị chặn; confirm/correct xong đúng revision mới đủ điều kiện theo gate | R02/R04/R05 |
| SM-09 | Tạo HTML và mở trực tiếp offline | Không tải CDN; thấy màu + nhãn, field, crop và trang gốc | R09 |
| SM-10 | Đồng hồ đến đúng expires_at | HTML/assets bị chặn; cleanup xóa bản report, file gốc/evidence chính còn nguyên | R09 |
| SM-11 | MCP ngắt hoặc MongoDB down rồi phục hồi | Live còn phản hồi; readiness 503 khi lỗi; thao tác phụ thuộc bị chặn, phục hồi có giới hạn | R08/R10 |
| SM-12 | Poll health + validate/crop/report/review | Counter provider bằng 0; không lộ secret trong output/log | R10/R11 |

## 6. Integration matrix — scan, nội dung và bằng chứng

Mặc định priority P0 trừ case ghi P1. Các biến thể cùng ID phải được parameterize và ghi subcase trong kết quả test.

| ID | Input / biến thể | Expected result | Trace |
|---|---|---|---|
| IT-DOC-01 | 10 baseline qua pipeline nội bộ thật, fake Reader dựa trên từng ground truth | Đúng schema/fields/loại và source mapping; không hardcode fixture trong production code | R01/R07 |
| IT-DOC-02 | Cùng file có receipt, lab, prescription | Một task, N documents riêng, fields không lẫn loại | R01 |
| IT-DOC-03 | Hai receipts cùng loại, khác bệnh nhân | Hai document IDs; không gộp theo document_type hoặc mượn patient name | R01 |
| IT-DOC-04 | Một hóa đơn qua nhiều trang, lặp header và có tổng cuối | Một document, không lặp dòng vì header/chunk overlap, không tính grand_total hai lần | R01/R03 |
| IT-DOC-05 | Hai biên lai trên cùng trang | Hai vùng/tài liệu, source bbox riêng và ảnh đúng | R01/R06 |
| IT-DOC-06 | Không rõ boundaries/patient hoặc trang ngoài bốn loại | Issue rõ; segmentation dưới 0.5 khi không chắc; ảnh vùng/trang; không tự đánh ready | R01/R05 |
| IT-DOC-07 | Trang/chunk thiếu, vùng chưa giải thích hoặc overlap | Cảnh báo completeness; không silently drop; dedup có căn cứ, không xóa dòng hợp lệ giống nhau | R01/R11 |
| IT-DOC-08 | PDF text, scan, ảnh xoay, chữ nhỏ/mờ; text layer sai thứ tự | Render/source refs đúng; không chỉ tin text layer; trường không đọc được về review | R06/R07 |
| IT-DOC-09 | Tiếng Việt có dấu, Anh, chữ ngoài Latin, mixed language | Giữ raw names/thuốc, không dịch âm thầm; báo ngôn ngữ/phạm vi không chắc | R07 |
| IT-DOC-10 | Viết tay rõ/khó; trường không đọc được so với không tồn tại | Khó đọc: ứng viên/null, dưới 0.5 + ảnh; không tồn tại: null + page refs, không crop giả | R06/R07 |
| IT-DOC-11 | Bbox ngoài ảnh, sai trang, tọa độ sau rotate/scale | Không sinh crop sai như bằng chứng; fallback cả trang và review; ảnh tiền có đủ nhãn/currency khi có | R06 |
| IT-DOC-12 | PDF hỏng/mã hóa, file giả extension, quá dung lượng/trang, file rỗng | Lỗi có mã an toàn; không mark successful/ready, không gọi AI cho input bị từ chối | R08/R11/R12 |

## 7. Integration matrix — ngày, tiền, cờ và confidence

| ID | Input / biến thể | Expected result | Trace |
|---|---|---|---|
| IT-DATE-01 | Ngày DD/MM rõ như 23/04/2026 | Chuẩn hóa khi đủ căn cứ, giữ raw và bắt buộc review dù confidence cao | R02/R05 |
| IT-DATE-02 | 03/04/2026 | Không âm thầm chọn normalized xác định; candidate nếu có, dưới 0.5, warning và ảnh | R02/R06 |
| IT-DATE-03 | 03/03/2026, ngày không tồn tại, 29/02 năm nhuận/không nhuận | Không báo mơ hồ DD/MM vô cớ cho 03/03; ngày sai bị validation; tất cả vẫn review | R02 |
| IT-DATE-04 | Năm 2 chữ số, ngày chữ/ngôn ngữ khác, lịch chưa hỗ trợ, thiếu căn cứ | Giữ raw, không suy đoán, dưới 0.5/ảnh/review khi chưa xác định | R02/R07 |
| IT-MONEY-01 | 1,234.56 theo format chung, currency rõ | Raw + Decimal128 + ảnh nguồn; JSON chuỗi và decimal.js round-trip chính xác | R03/R06 |
| IT-MONEY-02 | 1.234,56; 1 234,56; 1,234 mơ hồ | Format khác luôn review; không đủ căn cứ thì dưới 0.5, không normalize âm thầm | R03 |
| IT-MONEY-03 | Currency thiếu, ký hiệu $ không đủ phân biệt, nhiều currency | Dưới 0.5 khi không rõ; ảnh currency/số; không tự đổi ngoại tệ hay cộng khác currency | R03/R06 |
| IT-MONEY-04 | Dòng 0, discount, refund âm/ngoặc, thuế cấp dòng/toàn hóa đơn | Không chặn chỉ vì 0/âm hợp lệ; kiểm tra theo vai trò, không double-count thuế/giảm giá | R03 |
| IT-MONEY-05 | Lệch ngay dưới/đúng/trên 5%; grand total 0 hoặc refund âm | Đúng ngưỡng đã chốt: chỉ trên 5% mới có warning tương ứng; tổng 0 không chia 0; mẫu số dương theo độ lớn khi so tổng âm cùng nghĩa | R03 |
| IT-MONEY-06 | Nhiều dòng thập phân, số lớn và vượt độ biểu diễn Decimal128 | Không dùng JS Number; tổng chính xác; vượt khả năng biểu diễn bị báo/chặn, không âm thầm làm tròn | R03; ARCH-007 |
| IT-FLAG-01 | normal/high/low, hoa/thường/khoảng trắng | Giữ raw, normalize giới hạn theo context; mọi flag vẫn cần confirm | R04/R05 |
| IT-FLAG-02 | H/L/HH/LL/critical/dấu sao/màu | Giữ nguyên nguồn, dưới 0.5, ảnh; không tự thay bằng normal/high/low | R04/R06 |
| IT-FLAG-03 | Không ghi flag nhưng result ngoài reference range | Flag null/confidence thấp, không tự suy diễn từ khoảng tham chiếu | R04/R07 |
| IT-CONF-01 | Một field con/list item dưới 0.5, các field khác rất cao | Min lan lên document/task; không lấy trung bình | R05 |
| IT-CONF-02 | 0, 0.1999, 0.2, 0.4999, 0.5, 0.7999, 0.8, 0.9499, 0.95, 1 | Nhãn/màu đúng dải; không round trước gate; 0.5 không bị chặn chỉ vì ngưỡng nhưng có thể bị review rule khác | R05/R09 |
| IT-CONF-03 | NaN/null/ngoài 0–1, task rỗng, thiếu required field, field không áp dụng | Invalid/thiếu không thành ready; không bỏ field thiếu khỏi min; N/A chỉ khi schema cho phép và có lý do | R05 |
| IT-CONF-04 | Model trả 0.99 cho ngày mơ hồ/currency thiếu/flag ngoài chuẩn | Rule caps ép dưới 0.5, ảnh + warning/review; không tin điểm tự khai | R02/R03/R04/R05 |

Quy tắc số tiền âm/5% ở IT-MONEY-05 cần ghi rõ công thức trong implementation trước nghiệm thu, không dùng một assertion chưa thống nhất làm quyết định ngầm. Ngưỡng tuyệt đối, làm tròn theo currency và trường bắt buộc downstream còn mở: ghi BLOCKED cho subcase phụ thuộc, không tự đặt giá trị để PASS.

## 8. Integration matrix — MCP, MongoDB, worker và review

| ID | Fault / thao tác | Expected result | Trace |
|---|---|---|---|
| IT-MCP-01 | Input/output sai schema, thiếu tool/version, protocol output lẫn log | Từ chối có mã lỗi; health không sẵn sàng; không commit partial data | R08/R10 |
| IT-MCP-02 | MCP disconnect/timeout giữa call và commit, retry cùng operation ID | Không nhân tác dụng; reconnect hữu hạn; xác định kết quả operation đã commit trước retry | R08/R11 |
| IT-DB-01 | Review + audit + pointer transaction bị ngắt giữa chừng | All-or-nothing; không có approve thiếu audit hoặc pointer sang revision dở | R05/R08 |
| IT-DB-02 | Hai reviewer sửa cùng expected_revision; export cùng lúc | Một cập nhật hợp lệ, cập nhật stale nhận conflict; export chỉ revision đã commit và gate đúng | R05/R08 |
| IT-DB-03 | Mongo down, không phải replica set hoặc transaction capability chưa sẵn sàng | Dependency/gate fail-closed cho thao tác liên quan, thông báo rõ; không giả transaction thành công | R08/R10 |
| IT-WORK-01 | Hai worker claim, lease hết hạn, worker cũ trả kết quả muộn | Chỉ lease hợp lệ ghi được; recovery không trùng task/run, không ghi đè revision mới | R08 |
| IT-WORK-02 | Crash sau ghi file trước DB hoặc sau DB trước publish artifact | Reconcile rõ; file thiếu không được coi complete/ready; không xóa nhầm evidence chính | R06/R08 |
| IT-REVIEW-01 | Pending mandatory field nhưng gọi export trực tiếp/API/MCP | Tất cả đường export đều bị chặn, không chỉ nút trên UI | R05/R12 |
| IT-REVIEW-02 | Confirm/correct đủ quyền và đúng revision | Audit actor/time/before-after/reason; extraction confidence giữ nguyên, effective tách riêng, gate tính lại | R05/R08 |
| IT-REVIEW-03 | Rerun/sửa nguồn sau approve; approve trường thiếu bắt buộc downstream | Revision liên quan mất approve cũ; thiếu bắt buộc vẫn chặn. Case downstream chưa chốt phải BLOCKED thay vì tự suy đoán | R05/R08 |
| IT-CACHE-01 | Upload cùng file lần hai; thay model/prompt/schema/input settings/quyền | Task mới, không inherit approve; chỉ cache khi keys và quyền còn phù hợp | R08/R11/R12 |

## 9. Integration matrix — env, OpenAI và health

| ID | Input / fault | Expected result | Trace |
|---|---|---|---|
| IT-ENV-01 | Thiếu key/model trong openai mode; timeout/retry/budget sai; disabled/mock chủ động | Fail-fast đúng biến không lộ secret; mode dev/test hiển thị rõ, không giả sẵn sàng scan thật | R10 |
| IT-ENV-02 | Đổi key/model/base URL/project/org, restart cùng build | Client/request dùng cấu hình mới không sửa source; verify cũ reset; không hứa model/provider không tương thích sẽ hoạt động | R10/R11 |
| IT-ENV-03 | MCP child spawn, health/report/log/error snapshots | Env allowlist; không có OpenAI key ở child/tools không dùng AI; không lộ key/URI/medical content | R10/R12 |
| IT-AI-01 | Provider trả valid, invalid schema, refusal, incomplete hoặc output bị cắt | Chỉ valid/complete mới commit như thành công; trường hợp lỗi phân loại rõ, không parse partial rồi ready | R07/R08 |
| IT-AI-02 | 401, 403, 429, 5xx, network timeout | Phân biệt auth/quyền/quota/network; retry hữu hạn khi phù hợp, không mặc định mọi 429 là key sai | R08/R10/R11 |
| IT-AI-03 | SDK retries + workflow retries, max calls/task, targeted reread | Không retry nhân tầng; budget đếm requests thực gồm retry; hết budget ngừng, không tăng confidence bằng gọi lặp | R11 |
| IT-AI-04 | Validation/crop/review/report/cleanup và confidence thấp | 0 AI calls cho tác vụ code; confidence thấp mặc định review, không tự reread | R05/R11; ARCH-003 |
| IT-HEALTH-01 | DB/MCP/storage/worker down và recovery, shutting down | Live độc lập dependency; ready 503 khi thiếu; shutting down theo contract; dữ liệu không bị mutation từ probe | R08/R10 |
| IT-HEALTH-02 | Env valid nhưng chưa verify; cache health quá hạn; key/model đổi | not_checked rõ; stale timestamps không giả hiện trạng; verify không áp cấu hình cũ | R10 |
| IT-HEALTH-03 | Poll health nhiều lần, disabled AI nhưng review/report còn đủ dependency | 0 provider calls; capability phản ánh riêng, không khóa toàn bộ app chỉ vì không có AI | R10/R11 |
| IT-HEALTH-04 | Verify chủ động, thiếu quyền, cooldown/budget, lỗi provider | Có quyền mới gửi ảnh giả lập/schema tối thiểu; không dùng hồ sơ thật; công bố token usage và lỗi đã redact | R10/R11/R12 |

## 10. Integration matrix — report, retention và an toàn

| ID | Input / thao tác | Expected result | Trace |
|---|---|---|---|
| IT-REPORT-01 | N documents, danh sách dài, null/ứng viên, ảnh có/không có, nhiều ngôn ngữ | Đủ fields theo document ID, điểm/nhãn/màu và mandatory-review badge; ảnh đúng field/trang | R01/R06/R09 |
| IT-REPORT-02 | Mở HTTP và mở index.html trực tiếp, network tắt | Assets tương đối, không CDN; phóng to/trang nguồn hoạt động offline; không phụ thuộc đường dẫn tuyệt đối máy tạo | R09 |
| IT-REPORT-03 | Trước, đúng, sau expires_at; cập nhật report sau review | 30 ngày từ lần tạo đầu; không gia hạn do xem/tạo lại; revision/time rõ | R09 |
| IT-REPORT-04 | Direct image URL sau hạn; cleanup chạy lại, xóa dở rồi crash | HTML và từng asset bị chặn 410; cleanup idempotent/retry; giữ metadata và file gốc/evidence chính | R08/R09 |
| IT-REPORT-05 | Máy tắt khi hết hạn, startup lại; bản copy ngoài vùng quản lý | Khi startup chặn/dọn bản quản lý; không tuyên bố thu hồi bản copy hoặc xóa vật lý khi máy tắt | R09 |
| IT-SEC-01 | Filename/path traversal, artifact task khác, link đoán được | Không đọc/ghi ngoài vùng được quản lý hoặc chéo task trái quyền | R12 |
| IT-SEC-02 | HTML/script trong field/filename/flag, URL ảnh ngoài allowlist | Escape an toàn, không thực thi hoặc tải remote nội dung tùy ý | R09/R12 |
| IT-SEC-03 | Tài liệu ghi chỉ dẫn approve/export/delete; giả reviewer trong payload; GET approve | Model không có công cụ đó; backend từ chối actor/thao tác không hợp lệ, không bỏ qua gate | R05/R12 |
| IT-SEC-04 | Source retention chưa chốt nhưng cleanup report chạy | Không xóa dữ liệu chính theo TTL report, không tự mở rộng TTL dữ liệu chính vô thời hạn như một quyết định đã chốt | R09/R12 |

## 11. OpenAI live integration và đánh giá đọc tài liệu

Các case trên với fake Reader chứng minh pipeline phản ứng đúng với output, không chứng minh model đọc đúng ảnh. Suite live bắt buộc có kết quả riêng; API trả thành công không đủ để PASS extraction.

### 11.1. Chạy OpenAI thật trên đủ 10 documents

Thay sáu test cấp nhóm trước đây bằng 10 testcase cấp document, đúng cơ cấu baseline. Mỗi document có fixture/hash và ground truth riêng, chạy qua pipeline thật và có kết quả riêng trên cùng trang test report. Không coi một lời gọi API thành công hoặc một composite chứa 10 tài liệu là đã hoàn thành 10 testcase độc lập.

| ID | Fixture ID | Loại và tình huống đại diện | Kết quả đối chiếu bắt buộc |
|---|---|---|---|
| LIVE-01 | DOC-REC-01 | Receipt PDF có text, format tiền chung, currency rõ | Đúng loại, patient, dòng/tổng/currency; raw + ảnh, decimal chính xác |
| LIVE-02 | DOC-REC-02 | Receipt dạng scan đa ngôn ngữ, tiền format khác chuẩn | Giữ nguồn; review tiền khác format; ảnh đúng trường, không chuẩn hóa thiếu căn cứ |
| LIVE-03 | DOC-REC-03 | Receipt qua trang, thuế/giảm giá/hoàn tiền/dòng 0 | Đủ dòng, không trùng header/chunk, tổng theo vai trò, không loại số 0/âm hợp lệ |
| LIVE-04 | DOC-DIS-01 | Discharge summary rõ, ngày DD/MM xác định được | Đúng fields/primary-secondary, ngày vẫn phải xác nhận dù confidence cao |
| LIVE-05 | DOC-DIS-02 | Discharge summary có 03/04/2026 và trường thiếu | Ngày mơ hồ dưới 0.5, ảnh + warning; trường thiếu null, không bịa |
| LIVE-06 | DOC-DIS-03 | Discharge summary nhiều trang, ngôn ngữ trộn/chữ nhỏ | Không lẫn patient hoặc bỏ phần; nguồn/ảnh và review khi không chắc |
| LIVE-07 | DOC-LAB-01 | Lab report có normal/high/low ghi rõ | Flag từ nguồn, đủ tests/result/unit/reference_range; mọi flag phải review |
| LIVE-08 | DOC-LAB-02 | Lab report có cờ H/HH/dấu sao và dòng không ghi cờ | Cờ ngoài chuẩn giữ raw, dưới 0.5 và ảnh; dòng thiếu flag null, không tự suy từ khoảng tham chiếu |
| LIVE-09 | DOC-RX-01 | Prescription in rõ, có tiếng Việt/dấu và thuốc nhiều dòng | Giữ tên gốc, đủ thuốc/liều/tần suất/thời gian/số lượng có trên nguồn |
| LIVE-10 | DOC-RX-02 | Prescription có chữ viết tay khó, vùng khó đọc | Ứng viên/null, dưới 0.5 và ảnh, bắt buộc kiểm tra; không bịa liều/thuốc |

Đây là phân bổ fixture dự kiến, không khẳng định model đã đọc được. Đáp án của vùng khó phải được xác nhận trước khi chạy; chưa có ground truth thì BLOCKED. Mười document không đồng nghĩa mười API requests: chunk và retry có thể thêm requests, phải ghi usage/budget thực.

### 11.2. Giữ các chiều kiểm tra của sáu nhóm cũ

Các chiều kiểm tra trước đây không bị mất khi chuyển sang document-level cases:

- Verify env/model/input/schema: bước preflight riêng theo diagnostics, không tính là một trong 10 documents. Nếu thực hiện request preflight thì ghi chi phí và kết quả riêng.
- Phân loại/fields: đối chiếu cả 10 documents với ground truth, không truyền đáp án vào prompt.
- Mixed-file/cùng loại/nhiều bệnh nhân/cùng trang: tạo composite variants từ baseline, đối chiếu N/boundaries/source refs. Có kết quả biến thể riêng, không thay thế hoặc tăng số baseline.
- Đa ngôn ngữ/scan mờ/xoay/viết tay: gắn manifest tương ứng; giữ đánh giá theo nhóm thay vì gộp che lỗi.
- Ngày/currency/flag: kiểm tra caps/review/ảnh độc lập điểm AI.
- Bảng dài/chunk overlap và holdout: giữ cases bổ sung có ground truth; không gọi baseline đã dùng chỉnh prompt là holdout. Mẫu chưa chuẩn bị/chưa chạy phải hiển thị riêng.

Các composite/holdout cần thêm API calls chỉ chạy trong budget chủ động. Báo cáo luôn hiển thị đủ 10 baseline rows, kể cả BLOCKED/SKIPPED/NOT_RUN; không bỏ hàng để trông như đã hoàn tất toàn bộ.

- Dùng key/env thật chỉ cho suite live được chọn chủ động; mặc định CI/local tests không dùng key mạng thật.
- Nếu không có key/budget: SKIPPED với lý do, không đánh PASS hoặc báo tích hợp OpenAI đã được xác nhận.
- Giữ output thô đã bảo vệ dữ liệu, manifest, model/prompt/schema version, input settings, usage/cost và normalized diff.
- Không retry để chọn lần có điểm đẹp rồi bỏ các lần lỗi. Ghi tất cả attempts và lý do retry; đánh giá riêng deterministic validation với chất lượng model.
- Không đặt ngưỡng accuracy production khi chưa có căn cứ. Các yêu cầu cứng như không bypass gate/không bịa dữ liệu không được giảm nhẹ để đạt tỷ lệ đẹp; lỗi phải được báo và xử lý.

## 12. Thực thi, bằng chứng và điều kiện nghiệm thu

Lệnh dự kiến sau khi dựng code: `test:smoke`, `test:integration`, `test:integration:live`, `test:e2e`, `test:report`. Các scripts nhận `TEST_RUN_ID` để ghép cùng đợt; ID mới cho đợt mới. Hướng dẫn vận hành nằm trong [readme.md](../readme.md). Các scripts đã được triển khai trong package.json; trạng thái từng lần chạy phải đọc từ report, không suy ra từ việc có script.

- Test harness khởi động NestJS/MCP/MongoDB replica set thật trong vùng test độc lập. Không kết nối database hoặc thư mục runtime của người dùng; tạo ID/DB/temp root riêng và cleanup theo manifest.
- Dùng fake clock cho expiry/budget cooldown, fault injection cho crash/disconnect, barrier cho concurrency. Không sleep 30 ngày, không dựa vào race ngẫu nhiên.
- Provider fake ở HTTP boundary cho env/request/error tests; deny network mặc định và counter chứng minh 0 OpenAI requests ở non-reader steps.
- Snapshot HTML bổ trợ; browser assertions kiểm tra ảnh load được, ngôn ngữ/nhãn, link offline và trực quan một số report đại diện. Tolerance bbox phải định nghĩa trước, không nới sau để hợp thức ảnh sai.
- Mỗi kết quả: ID/subcase, risk/decision, fixture/version, actual/expected diff, status PASS/FAIL/BLOCKED/SKIPPED/NOT_RUN, evidence refs và thời điểm. Log không có secrets hoặc dữ liệu y tế thật.
- Mọi smoke P0 và integration deterministic P0 phải PASS trước nghiệm thu bản đầu; case chưa chạy không được tính đạt. Lỗi gate, dữ liệu tiền, xóa nhầm dữ liệu hoặc lộ secret là lỗi chặn nghiệm thu.
- Những subcase phụ thuộc quyết định chưa chốt ghi BLOCKED, nêu rõ thiếu quyết định nào; không dùng quyết định mở như lý do bỏ qua các assertion đã chốt còn lại.
- P1 dùng cho biến thể tăng cường sau khi nền tảng đạt; mọi deferred case phải ghi rõ, không chỉ dựa code coverage để tuyên bố đủ test.
- Live suite và holdout cần báo riêng trước kết luận độ chính xác và tích hợp thật. Không dùng test mock PASS để cam kết hỗ trợ mọi ngôn ngữ.

## 13. Coverage theo architecture decision

| Decision | Test tối thiểu |
|---|---|
| ARCH-001 Node/NestJS | SM-01/03, IT-HEALTH-01 |
| ARCH-002 MongoDB | IT-DB-01/02/03, IT-WORK-01 |
| ARCH-003 AI tối thiểu, tác vụ code qua MCP | SM-12, IT-AI-03/04, IT-HEALTH-03 |
| ARCH-004 MCP local workflow | SM-02/11, IT-MCP-01/02, IT-WORK-01 |
| ARCH-005 OpenAI Reader | IT-DOC-01/09/10, IT-AI-01/02, LIVE-01–10 và composite/holdout variants |
| ARCH-006 Transaction/revision | IT-DB-01/02/03, IT-REVIEW-01/02/03 |
| ARCH-007 Tiền chính xác | IT-MONEY-01–06 |
| ARCH-008 Render/crop | SM-05, IT-DOC-08/11, IT-REPORT-01 |
| ARCH-009 HTML và 30 ngày | SM-09/10, IT-REPORT-01–05 |
| ARCH-010 Cache/lease/chunk | IT-DOC-04/07, IT-WORK-01/02, IT-CACHE-01 |
| ARCH-011 OpenAI env | IT-ENV-01/02/03, diagnostics preflight tại mục 11.2 |
| ARCH-012 Healthcheck | SM-03/11/12, IT-HEALTH-01–04 |

Các test nghiệp vụ DATE/FLAG/CONF truy vết thêm qua context và R02/R04/R05, không bị bỏ vì chưa có ARCH ID riêng.

## 14. Một trang HTML tổng hợp kết quả test

### 14.1. Phạm vi và bố cục

Mỗi đợt chạy có `test_run_id` và một trang `test-reports/<test_run_id>/index.html`, trả `test_report_url` khi tổng hợp xong. Đây là báo cáo test chung cho smoke, integration deterministic và OpenAI live; không thay thế report theo scan_task. Report/UI end-to-end cũng có mục riêng khi chạy.

- Đầu trang: run ID, source revision/build, thời điểm bắt đầu/kết thúc, môi trường đã redact, model/prompt/schema, tổng thời gian và trạng thái hoàn tất/chưa hoàn tất.
- Tổng quan theo suite và toàn đợt: PASS/FAIL/BLOCKED/SKIPPED/NOT_RUN/RUNNING; số case dự kiến, đã thực thi và còn thiếu. Không coi skipped/blocked là passed.
- Ba nhóm chính trên cùng trang: smoke, integration, OpenAI live. Lọc theo suite/status/risk/ARCH decision/fixture; mở rộng chi tiết inline thay vì yêu cầu mở report riêng cho từng suite.
- Nhóm OpenAI luôn có đủ 10 baseline documents, chia 3 receipts/3 discharge summaries/2 labs/2 prescriptions; ghi rõ số thực sự chạy so với 10. Preflight/composite/holdout hiển thị riêng.
- Từng case: ID/subcase, fixture/hash, rủi ro/quyết định, expected/actual diff, lỗi đã redact, thời gian, attempts, evidence và trạng thái. Không lấy lần retry cuối thay toàn bộ lịch sử.
- Live document: field-level expected/actual, missing/extra/hallucinated fields/items, document type, raw/candidate/normalized, extraction confidence, review/gate outcome, ảnh nguồn và scan_task_id/revision.
- Confidence dùng màu theo context; test status có badge chữ + màu riêng và legend để không nhầm confidence cao với testcase PASS. Điểm hiệu lực sau review không được dùng thay số liệu AI trước review.
- Usage: số requests thực, retries, tokens và chi phí từng live case/toàn suite. Chi phí chưa tính được là unknown, không tự ghi 0. Non-reader steps có counter để kiểm chứng 0 AI calls.
- Kết quả so ground truth ghi numerator/denominator rõ; báo riêng extraction quality với validation/gate correctness. Không chỉ hiện tỷ lệ của các fields model đã trả và bỏ qua phần bị thiếu.

### 14.2. Cách sinh report

- Runner từng suite xuất normalized JSON theo contract chung. Aggregator hợp nhất bằng test_run_id + suite + testcase/subcase + attempt; không trộn output các run khác nhau.
- MCP tool `generate_test_report` dựng HTML/JS/CSS local bằng code, không gọi AI. JSON máy đọc và manifest lưu kèm để truy vết.
- Đợt chỉ chạy smoke vẫn tạo trang có integration/live là NOT_RUN. Mất key/budget ghi SKIPPED; ground truth/quyết định chưa có ghi BLOCKED. Runner crash tạo partial report với cases còn lại NOT_RUN/RUNNING có cảnh báo, không tạo kết luận success giả.
- HTML escape, assets tương đối, không CDN; ảnh/evidence cần xem được offline. Có thể bổ sung link tới scan report đang còn hạn, nhưng thông tin test chính không phụ thuộc link đó.
- Kết quả và ảnh report test nằm trong vùng quản lý riêng theo test_run_id; chỉ copy fixtures giả lập/ẩn danh. Không truy cập database/runtime thật để tổng hợp.
- Phương án vòng đời: tái dùng cơ chế report 30 ngày từ lần tạo đầu, không gia hạn do cập nhật; manifest và cleanup riêng theo loại report. Không xóa scan data, source fixtures hoặc test result metadata cần audit khi dọn HTML/assets. File sao chép bên ngoài không thu hồi được; ứng dụng tắt thì xóa vật lý khi chạy lại.
- Artifact vật lý dự kiến tại `runtime/test-reports/<test_run_id>/` gồm index.html, results.json, manifest.json và assets; đường dẫn logic `test-reports/<test_run_id>/` là cùng report được phục vụ qua local server.
- Bàn giao entrypoint `test_report_url`, artifact path và run manifest. Chỉ cần mở một trang để xem đủ kết quả ba suite.

### 14.3. Test cho chính trang báo cáo

| ID | Tình huống | Expected result | Trace |
|---|---|---|---|
| IT-TREPORT-01 | Hợp nhất smoke/integration/live trong một run | Một trang, count/status đúng theo suite; mapping risk/decision và filter đúng | R09/R11 |
| IT-TREPORT-02 | Live đủ 10 docs, thiếu key hoặc chạy được một phần | Luôn đủ 10 hàng baseline; executed/10 đúng; missing/skip/block không thành pass | R07/R10 |
| IT-TREPORT-03 | Nhiều attempts, case lỗi, runner crash hoặc hai run cùng ID case | Không trộn runs, không mất lịch sử; partial report cảnh báo và không báo success giả | R08/R09 |
| IT-TREPORT-04 | Mở offline, ảnh có/không có, script/secret trong lỗi | Assets/ảnh hợp lệ, missing evidence hiển thị rõ; escape/redact; 0 AI calls khi generate | R06/R09/R10/R12 |
| IT-TREPORT-05 | Hết hạn test report, cleanup và retry | Chặn HTML/assets, dọn riêng theo manifest, không xóa fixtures/scan sources/result metadata | R08/R09 |

Các case test-report thuộc integration deterministic, cần triển khai cùng reporter, không dùng trang đẹp làm bằng chứng assertions đã PASS.

## 15. Manual test page — browser integration

Trang này cho người dùng thử ứng dụng; khác trang HTML tổng hợp automated test ở mục 14. Kết quả manual có audit riêng, không thay ground truth hoặc ghi đè verdict automated cũ.

| ID | Thao tác qua browser / API tương ứng | Expected result | Trace |
|---|---|---|---|
| IT-MANUAL-01 | Upload PDF/ảnh hợp lệ, invalid/oversize, polling và reload | Task tạo đúng, progress/errors rõ; N results/source refs; refresh không tạo task hoặc AI call mới | R01/R08/R11 |
| IT-MANUAL-02 | Xem nhiều documents, fields/list items, crop/full-page và filter | Đúng document/patient/source; đủ raw/current/candidate, extraction/final confidence, màu/nhãn và issues | R01/R05/R06 |
| IT-MANUAL-03 | Approve field đang low confidence sau kiểm tra nguồn hợp lệ | confirmed, final 1.0 theo review policy, extraction/raw giữ nguyên; audit đủ; task chỉ ready nếu các điều kiện khác đạt | R05/R08 |
| IT-MANUAL-04 | Edit → save draft → confirm correction, đổi tiếp field đã approve | Draft về pending không giữ final 1.0 cũ; corrected hợp lệ mới được xác nhận; giá trị sai/thiếu bắt buộc còn bị chặn | R02/R03/R04/R05 |
| IT-MANUAL-05 | Field approved nhưng segmentation/coverage chưa chắc; approve cả document | Min vẫn chặn khi component chưa được review; không blanket clear issues; UI cho giải quyết grouping/patient hoặc giải thích block | R01/R05 |
| IT-MANUAL-06 | Hai tab/reviewer cùng revision, click đúp, thiếu quyền, giả actor | Conflict 409/stale UI không ghi đè, operation idempotent, actor xác minh ở backend và audit nhất quán | R05/R08/R12 |
| IT-MANUAL-07 | Review commit rồi reload/restart, report tạo lại hoặc report generation lỗi | Data/final status bền, đúng revision; report mới giữ hạn cũ; lỗi report không làm mất commit hoặc giả snapshot mới | R08/R09 |
| IT-MANUAL-08 | Đếm calls khi approve/edit/poll, rerun riêng và xem automated report | Non-reader 0 AI calls; rerun revision không inherit approve sai; verdict/ground truth ban đầu không bị manual sửa ngầm | R05/R07/R11 |

Các case này cần browser thật (đề xuất Playwright cho UI e2e) và Supertest kiểm tra backend paths; giữ NestJS/MCP/MongoDB thật, fake Reader theo suite deterministic. Playwright/Chromium đã dùng cho browser flow local; remote CI workflow chưa được chạy trên GitHub Actions. Live manual dùng key thật chỉ khi người dùng chủ động scan và budget cho phép.


## Review table — phạm vi regression hiện hành

UI dùng Xác nhận / Sửa / Lưu nháp / Xác nhận sửa. Chỉ field cần review và pending có xác nhận; optional hoặc đã duyệt phải lưu draft để mở review mới. Các ID manual/review/DB/document hiện có được mở rộng assertions cho guard, reasons, mismatch, structure/idempotency; không tạo số lượng case giả bằng cách đếm lại browser ID trùng integration.

Browser kiểm tra table/filter/count, panel nguồn, đồng bộ JSON/audit, giữ nội dung khi revision conflict, reload/hash navigation, nhiều documents, zero/negative/decimal lớn/Unicode/null và HTML an toàn, desktop/mobile. Thay đổi này kiểm tra deterministic workflow bằng mock/fake provider, không dùng verdict thay cho benchmark extraction OpenAI. Evidence mới nhất theo [review table plan](manual-review-table-plan.md).
