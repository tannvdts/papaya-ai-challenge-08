# Post-implementation enhancement plan

Cập nhật: **19/10/2026**. Phạm vi: các sửa lỗi và cải tiến sau bản implementation đầu tiên, tổng hợp theo **trạng thái cuối cùng đang có trong code**. Đây là plan tracking: `[x]` đã triển khai, `[ ]` còn cần thực hiện hoặc nghiệm thu. Không dùng các tên thư mục trung gian làm hướng dẫn hiện hành.

Plan này bổ sung cho [first implementation plan](first-implement-plan.md). [Implementation status](implementation-status.md) giữ lịch sử và bằng chứng theo từng đợt; [README](../readme.md) là hướng dẫn vận hành cho người sử dụng.

## 1. Mục tiêu và cấu hình hiện hành

- Ứng dụng chạy mặc định tại **http://127.0.0.1:4000/manual-test**.
- Hệ sinh thái Node.js/TypeScript, backend NestJS, MongoDB replica set, MCP tools cho tác vụ xác định; OpenAI đọc/phân loại/trích xuất tài liệu.
- `.env` điều khiển chế độ AI, key/model, port và giới hạn xử lý. Model đang cấu hình trong workspace là **`gpt-6-luna`**; đây không phải model được hard-code hoặc tự chọn mặc định. `.env.example` để trống model và dùng `AI_MODE=mock`.
- Hai bộ mẫu cuối cùng: **`mock-samples/`** và **`manual-test-samples/`**.
- Giữ nguyên các decision về raw/candidate/final, ảnh nguồn, review, audit/revision và export gate. Block JSON không thay thế điều kiện duyệt trước khi export.

## 2. Sửa lỗi tích hợp OpenAI

### Công việc đã hoàn tất

- [x] Chẩn đoán `PROVIDER_HTTP_400` bằng request tổng hợp, không đưa API key vào log/chat/report.
- [x] Sửa schema `bbox`: mảng đồng nhất gồm đúng 4 số hoặc `null`, thay cho tuple tạo JSON Schema không được provider chấp nhận.
- [x] Giữ validation độ dài 4 ở ứng dụng; không bỏ kiểm tra tọa độ chỉ để request được chấp nhận.
- [x] Thêm regression test cho JSON Schema, bbox hợp lệ/không hợp lệ và xử lý HTTP 400 không retry như lỗi tạm thời.
- [x] Gọi OpenAI thật với một PDF tổng hợp và xác nhận tạo được document/result/report.
- [x] Chuyển endpoint chẩn đoán OpenAI sang `manual-test-samples/MT-01-clean-receipt.pdf` theo cách tách bộ mẫu hiện hành.

### Tiêu chí chấp nhận

Request dùng schema hợp lệ; thiếu căn cứ vẫn trả `null`/giá trị ứng viên và review theo decision cũ. Kiểm tra kết nối thành công không được ghi thành benchmark accuracy hoặc kết quả PASS cho toàn bộ live suite.

Mã liên quan: [reader schema](../packages/contracts/index.ts), [OpenAI reader](../packages/ai-reader/index.ts), [backend diagnostics](../apps/backend/main.ts).

## 3. Khắc phục MCP crash khi đọc PDF scan

### Công việc đã hoàn tất

- [x] Xác định `MCP_UNAVAILABLE` xuất hiện do crash native của renderer khi trộn hai phiên bản canvas.
- [x] Đồng bộ `@napi-rs/canvas` ở phiên bản **1.0.11**, dùng chung với PDF.js; cập nhật lockfile.
- [x] Thêm regression PDF chứa ảnh PNG/JPEG, chạy renderer trong child process để crash trở thành test failure; kiểm tra pixels có được vẽ thực sự.
- [x] Kiểm tra render 14 PDF scan/17 trang bằng renderer ứng dụng và qua MCP thật.
- [x] Khôi phục các task bị gián đoạn; xác nhận task chuyển sang chờ review và report mở được.
- [x] Tăng timeout khởi tạo kết nối MCP lên **30 giây** để hỗ trợ cold start trong Docker.

### Tiêu chí chấp nhận

Render scan không làm MCP mất kết nối; health/API/report hoạt động sau xử lý. Kết quả kiểm tra render không được diễn giải thành khả năng AI đọc đúng nội dung scan.

Mã liên quan: [document tools](../packages/document-tools/index.ts), [MCP client](../packages/mcp-client/index.ts), [render regression test](../tests/document-tools.spec.ts).

## 4. Tách bộ mẫu và công cụ tạo mẫu

### Cấu trúc cuối cùng

| Bộ mẫu | Nội dung | Phạm vi sử dụng hiện tại |
|---|---|---|
| [`mock-samples/`](../mock-samples/README.md) | 10 PDF có lớp text/nhãn cố định, manifest và `.truth.json` | Mock reader; smoke/integration; browser E2E; thử mock thủ công; 10 baseline cho live regression tự động |
| [`manual-test-samples/`](../manual-test-samples/README.md) | 14 PDF scan, tổng 17 trang; preview, checklist, catalog HTML | Manual test OpenAI; chẩn đoán OpenAI; integration kiểm tra render/MCP |

### Công việc đã hoàn tất

- [x] Đổi tên thư mục fixture cuối cùng thành `mock-samples/`, cập nhật source, scripts, tests, Docker COPY, README và plan hiện hành.
- [x] Tách bộ scan khỏi bộ fixture text. Các mẫu scan bao gồm mờ, nhạt, lệch góc, fax, bóng đổ, chữ viết tay/gạch đè, Việt/Anh/Pháp, nhiều tài liệu và nhiều bệnh nhân.
- [x] Có tình huống ngày mơ hồ, currency không rõ/định dạng khác, flag ngoài chuẩn/thiếu, mất trường, không rõ ranh giới và tổng tiền không khớp.
- [x] PDF scan chỉ chứa ảnh; đã kiểm tra số trang, khả năng render và không có lớp text ẩn.
- [x] Có catalog HTML, ảnh preview, `expected/*.json`, manifest, hướng dẫn và ZIP để sử dụng thủ công.
- [x] API `/session` trả `sample_set` theo mode; trang upload hiển thị hướng dẫn đúng bộ mẫu. Mock gợi ý PDF; OpenAI chấp nhận PDF/PNG/JPEG.
- [x] Giữ nguyên việc người dùng có thể upload tài liệu riêng trong OpenAI mode; bộ mẫu là hướng dẫn kiểm thử, không phải giới hạn đường dẫn upload.

### Lệnh hiện hành

| Lệnh | Tác dụng |
|---|---|
| `npm run mock-samples:generate` | Tạo lại 10 fixture text và truth/manifest; có thể ghi đè fixture, chỉ chạy khi cần tái tạo |
| `npm run mock-samples:extract:mock` | Upload fixture vào backend mock và lưu JSON kết quả |
| `npm run manual-test-samples:generate` | Tạo bộ scan; script từ chối ghi đè bộ đã có manifest |

Mẫu chữ viết tay được tạo bằng AI, không phải holdout chữ người viết thực. Checklist cho phần che/mất/mờ không được dùng làm căn cứ để model đoán nội dung không nhìn thấy. Live regression dùng 10 fixture text vẫn là baseline tự động, không đại diện cho benchmark chất lượng scan.

Mã liên quan: [sample-set routing](../packages/contracts/sample-sets.ts), [mock generator](../scripts/generate-mock-samples.ts), [manual generator](../scripts/generate-manual-test-samples.mjs).

## 5. Docker Compose và cấu hình port/env

### Công việc đã hoàn tất

- [x] Compose mặc định chạy backend và MongoDB bằng `docker compose up -d --build --wait`; backend tự khởi động MCP.
- [x] `APP_PORT` điều khiển cả port host được publish và port backend trong container, mặc định **4000**.
- [x] `APP_URL` suy ra theo port nếu không khai báo; cấu hình URL tường minh vẫn được hỗ trợ. Validate port trong dải TCP hợp lệ.
- [x] Mặc định publish loopback; MongoDB host port mặc định **27019**, có thể cấu hình bằng `MONGODB_EXPOSE_PORT`.
- [x] Compose đặt URI MongoDB nội bộ và `STORAGE_ROOT=/app/runtime`; giữ dữ liệu qua volumes `mongo-data` và `app-data`.
- [x] Tách Docker targets `runtime` và `test`; runtime chỉ giữ dependencies production, test image có source/dev dependencies/fixtures.
- [x] Backend và test container chạy cùng user `node`, tránh lỗi quyền khi dùng chung volume report.
- [x] Profile `test` chạy smoke/integration, dùng DB test riêng và lưu report chung volume với backend; không cấp key/cấu hình gọi OpenAI thật cho service test này.
- [x] Thêm healthcheck MongoDB và backend, thứ tự khởi động theo database readiness và restart policy.
- [x] Hướng dẫn recreate sau đổi `.env`; restart thông thường không nạp env mới. Đổi code cần build lại image.
- [x] Test/report CLI in URL theo cấu hình port; các lệnh host phù hợp nạp `.env`.

### Phân biệt đã kiểm chứng và cần kiểm chứng lại

Đã build/chạy stack Compose riêng, kiểm tra upload/report và đổi port 4127 → 4128 qua env/recreate; dữ liệu được giữ nguyên và Origin theo port mới. Đây là kiểm chứng chức năng đổi port; tài liệu vận hành vẫn dùng **4000**.

- [x] Đã build/chạy lại runtime/test images cuối sau đổi tên `mock-samples/`, JSON và UI table. Smoke/integration trong Linux containers và kiểm tra UI/API bằng browser PASS; xem evidence trong manual-review-table-plan.

Mã liên quan: [Compose](../compose.yaml), [Dockerfile](../Dockerfile), [env example](../.env.example), [config validation](../packages/contracts/config.ts).

## 6. Manual test: block JSON kết quả

### Công việc đã hoàn tất

- [x] Thêm block **JSON kết quả** ngay sau phần tổng quan task.
- [x] Hiển thị snapshot đầy đủ từ API, thụt dòng, chỉ đọc và có vùng cuộn; không cắt dữ liệu.
- [x] Ẩn/xóa JSON khi task đang `queued` hoặc `processing`, tránh hiển thị dữ liệu cũ khi chuyển task. Khi xử lý kết thúc, kể cả trạng thái lỗi, có thể xem snapshot tương ứng.
- [x] Cập nhật JSON sau approve, lưu draft, confirm correction, chọn task khác hoặc reload.
- [x] JSON phản ánh status/revision, giá trị cuối, review status và final confidence mới nhất.
- [x] Dùng `textContent` để nội dung tài liệu được hiển thị như văn bản, không thực thi HTML trong dữ liệu.
- [x] Browser test so sánh JSON với API và kiểm tra toàn bộ chuỗi upload → approve → draft → correction → reload.

### Tiêu chí chấp nhận

JSON bằng snapshot API của task đang xem; thao tác review cập nhật JSON cùng với UI. Xem JSON không đồng nghĩa dữ liệu đã được duyệt hoặc được phép export.

Mã liên quan: [manual page](../public/manual.html), [browser test](../tests/run.ts).

## 7. README và đường dẫn report cho người mới

### Công việc đã hoàn tất

- [x] Lấy Docker làm luồng chính: chuẩn bị → chạy → cấu hình OpenAI → upload/review → test → kết quả → thao tác thường dùng.
- [x] Tách cách chạy Node và cấu hình nâng cao vào phần mở rộng để luồng đọc ban đầu gọn hơn.
- [x] Dùng port mặc định 4000 trong các hướng dẫn và URL; đổi port được giải thích riêng qua env.
- [x] Ghi model đang cấu hình trong workspace, phân biệt với env mẫu không tự chọn model.
- [x] Phân biệt rõ `mock-samples/` và `manual-test-samples/`, link hướng dẫn/catalog và cách upload PDF thay vì truth/checklist JSON.
- [x] Dùng `TEST_RUN_ID` tạo theo thời gian; in URL theo đúng run vừa chạy, không đưa link của một run ví dụ chưa tồn tại như report có sẵn.
- [x] Tách report lịch sử offline khỏi report của đợt người dùng vừa chạy.
- [x] Hướng dẫn copy report từ Docker volume về host, giải thích dữ liệu host/Docker không tự chuyển qua lại và retention HTML/ảnh 30 ngày.
- [x] Thêm hướng dẫn log/status/recreate/build/dừng và bảng xử lý lỗi thường gặp.
- [x] Làm rõ smoke/integration không gọi OpenAI thật; healthcheck không xác nhận chất lượng hoặc khả năng truy cập provider từ xa.

## 8. Bằng chứng kiểm chứng đang có

Các số dưới đây thuộc các đợt khác nhau, không phải một lần chạy thống nhất trên cùng artifact Docker cuối cùng.

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Unit tests | 37 PASS sau bổ sung policy review table | `npm test`, gồm schema bbox, render, config port và sample-set routing |
| Smoke + integration hiện hành | 12 smoke + 73 integration PASS | [Report review table](http://127.0.0.1:4000/test-reports/table-review-implementation-20261019/index.html) |
| Browser JSON | 2 browser cases PASS, kiểm tra upload/review/JSON/reload | [Report browser review table](http://127.0.0.1:4000/test-reports/table-review-implementation-20261019/index.html) |
| Compose operations | Runtime/test build, upload, report, port/env/recreate/persistence đã PASS tại thời điểm chạy | [Report offline](../outputs/compose-operations-check/index.html), [deployment checks](../outputs/compose-operations-check/deployment-validation.json) |
| OpenAI thật | Đã có request/PDF tổng hợp thành công và report được tạo | Chỉ xác nhận integration ở thời điểm đó; không phải kết quả benchmark 10 tài liệu |
| Toàn bộ 14 scan | Render/MCP đã kiểm tra; chưa nghiệm thu chất lượng extraction qua OpenAI | [Manifest và checklist](../manual-test-samples/manifest.json) |

Hai browser cases dùng ID có trong catalog integration; không cộng thêm thành 87 case độc lập. Report local cần backend/storage có đúng run và chưa hết hạn; bản lịch sử offline trong `outputs/` được quản lý riêng.

## 9. Các phần còn chờ nghiệm thu

- [ ] Người dùng cấu hình/quyết định chạy bộ **10 live OpenAI documents**; lưu kết quả và phân biệt PASS/FAIL/SKIPPED/NOT_RUN thực tế. Người dùng đã chọn tự chạy phần này, không tự động gọi thêm model chỉ vì cập nhật plan.
- [ ] Đánh giá chất lượng extraction trên **14 manual scan**, đối chiếu bằng mắt; không gán PASS dựa trên checklist hoặc việc render thành công.
- [ ] Có ground truth được reviewer độc lập xác nhận, holdout scan/chữ viết tay thực, đo độ chính xác đa ngôn ngữ và calibration confidence/chi phí/latency trước khi tuyên bố chất lượng.
- [x] Rebuild/revalidate Docker artifact cuối cùng đã hoàn tất trong đợt review table; giữ link evidence ở plan tương ứng.

Các giới hạn của bản đầu vẫn áp dụng: chưa có xác thực/phân quyền đa người dùng, chưa nghiệm thu production; chưa có UI regroup tài liệu hoặc xử lý chunk/merge cho file vượt giới hạn. Chi tiết ở [project context](../context/project-context.md), [test strategy](test-strategy.md) và [implementation status](implementation-status.md).


## 10. Review table đã triển khai

- [x] Table theo document, filter và panel nguồn/sửa; chỉ field `requires_review=true` và pending mới có hành động xác nhận.
- [x] Backend guard cho approve/correct/structure review; field không bắt buộc hoặc đã duyệt mở vòng review bằng draft. Lý do review tách khỏi warning; blocking validation vẫn chặn task.
- [x] Điểm Sau kiểm tra chỉ hiển thị khi confirmed/corrected; JSON giữ nguyên semantics confidence và đồng bộ với audit/revision.
- [x] Giữ draft khi conflict; chuyển task/hash không dùng lẫn snapshot/audit; responsive và số/Unicode/HTML nguồn được kiểm tra bằng browser.
- [x] 37 unit + 12 smoke + 73 integration PASS, browser PASS và artifact Docker cuối được nghiệm thu bằng dữ liệu giả. Không benchmark AI hoặc gọi OpenAI thật ở đợt này.

Xem [plan và evidence triển khai table](manual-review-table-plan.md). Các phần live OpenAI/14 scan chất lượng/holdout độc lập ở mục 9 vẫn chưa nghiệm thu đầy đủ.
