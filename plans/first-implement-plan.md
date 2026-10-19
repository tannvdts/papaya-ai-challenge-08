# First implementation plan — Medical Document Extractor

Trạng thái thực thi: xem [implementation-status.md](implementation-status.md) để phân biệt phần đã có, bằng chứng test và phần còn mở. Các mục dưới giữ đặc tả/acceptance mục tiêu.

Ngày lập: 19/10/2026. Cập nhật kiến trúc: Node.js/TypeScript, NestJS, MongoDB và MCP local.

Nguồn yêu cầu chuẩn: [project-context.md](../context/project-context.md). Phân tích, phương án và câu hỏi còn mở: [brainstorm.md](../context/brainstorm.md). Kiến trúc và tracking quyết định: [architecture.md](../diagrams/architecture.md). Ma trận smoke/integration theo risk và decision: [test-strategy.md](test-strategy.md). Nếu phát sinh thay đổi nghiệp vụ, cập nhật context trước hoặc cùng implementation. Tài liệu này chỉ tổ chức triển khai, không tự phê duyệt các lựa chọn đang mở; chưa có chức năng hoặc benchmark nào được xác nhận đã hoàn thành.

Quy tắc tham chiếu:

- Context mục 2, 4–8: schema, N documents, confidence, ngày/tiền/cờ, ảnh nguồn, review và HTML/TTL.
- Context mục 9–11: kiểm soát kỹ thuật, tiêu chí đánh giá và phạm vi bản đầu.
- Architecture: nguồn tham chiếu kiến trúc hiện tại, phân chia AI/MCP, tools và mô hình dữ liệu.
- Brainstorm mục 2–6: căn cứ lựa chọn AI, phương án, thử nghiệm kỹ thuật và rủi ro/đánh đổi; Node.js, NestJS và MongoDB đã được người dùng chốt.
- Brainstorm mục 7: danh sách vấn đề cần chốt; mục 11 của plan theo dõi công việc xử lý chúng.
- Context có ưu tiên nếu phương án hoặc chi tiết triển khai chưa thống nhất với yêu cầu; phải giải quyết mâu thuẫn trước khi tiếp tục phần phụ thuộc.

## 1. Mục tiêu phiên bản đầu

Từ một PDF/ảnh tạo một `document_scan_task`, tách N tài liệu, trích xuất bằng OpenAI, lưu JSON và ảnh bằng chứng, tạo HTML local có link trong output, chặn dữ liệu chưa được xác nhận và dọn report sau 30 ngày.

Đầu ra nghiệm thu:

1. Ứng dụng local chạy được theo README, nhận file và cung cấp trạng thái task.
2. JSON version hóa chứa N document, confidence, raw/normalized/candidate values, ảnh nguồn, validation, review status và report link.
3. Report HTML offline dễ đối chiếu, nhóm theo từng tài liệu, màu confidence, ảnh trường và ảnh trang.
4. Một trang manual test upload → xem N results/ảnh nguồn → approve/sửa và xác nhận; backend cập nhật trạng thái/final confidence, audit và chặn sử dụng tiếp khi chưa đạt điều kiện.
5. Bộ 10 tài liệu mẫu đúng cơ cấu đề, ground truth độc lập và báo cáo đánh giá; bổ sung tình huống khó để kiểm tra các quyết định mở rộng.
6. Một trang HTML tổng hợp kết quả smoke/integration/OpenAI live; live chạy riêng đủ 10 documents baseline 3/3/2/2, field-level diff, nguồn, trạng thái và usage. Chi tiết trong mục 11/14 của test-strategy.
7. Tích hợp OpenAI bằng cấu hình env, không sửa code để đổi key/model/cấu hình hỗ trợ; healthcheck phân biệt ứng dụng sống, dependency local và trạng thái cấu hình/kiểm chứng OpenAI.

## 2. Stack và cấu trúc triển khai

Quyết định đã chốt: hệ sinh thái Node.js/TypeScript, backend NestJS và database MongoDB. Backend điều phối workflow cố định, chủ động gọi MCP; AI chỉ đọc/hiểu tài liệu, không quyết định việc gọi tool. Chi tiết trong [architecture.md](../diagrams/architecture.md).

| Thành phần | Lựa chọn hiện tại |
|---|---|
| Backend/workflow | NestJS + TypeScript |
| Cấu hình và health | `@nestjs/config` + Zod; `@nestjs/terminus` và custom indicators |
| MCP local | MCP TypeScript SDK; backend là client, một server qua stdio |
| AI Reader | OpenAI Node SDK + Responses API; model chưa chốt |
| Contracts | Zod; schema cho AI, MCP và API cần cùng nguồn, có adapter tương thích |
| Database | MongoDB, Mongoose và `@nestjs/mongoose` |
| Tiền | decimal.js để tính, Decimal128 để lưu, chuỗi thập phân trong JSON |
| PDF/ảnh | PDF.js + canvas tương thích Node cho render, sharp cho crop; cần spike trước khi khóa |
| HTML | Handlebars + CSS/JS local, escape mặc định |
| Kiểm thử | Jest + Supertest; thêm kiểm thử MCP protocol và MongoDB thật trong môi trường test |

```text
context/project-context.md
context/brainstorm.md
plans/first-implement-plan.md
plans/test-strategy.md
diagrams/architecture.md
readme.md
apps/
  backend/             # NestJS: API, workflow worker, AI Reader, review UI
  mcp-server/          # MCP stdio; Nest application context cho DI/storage
packages/
  contracts/           # Zod, DTO, tool contracts, schema versions
  domain/              # validation, confidence, review gate
  document-tools/      # PDF/text, render, crop và evidence
  storage/             # MongoDB/Mongoose, filesystem, audit, repositories
  reporting/           # Handlebars, offline assets, retention
  mcp-client/          # kết nối stdio, errors, timeout và retry policy
  ai-reader/           # OpenAI adapter, prompts, input/output mapping
tests/                 # unit, integration, MCP và end-to-end
mock-samples/         # PDF text cho mock/automated baseline, truth và manifest
manual-test-samples/   # PDF scan cho manual test OpenAI, preview và checklist
runtime/               # file gốc, ảnh, report; gitignored
outputs/               # deliverables người dùng, nếu có
```

Chạy HTTP server bind `127.0.0.1`. Backend quản lý vòng đời một MCP process local qua stdio; chỉ dùng stderr cho log của MCP server. MongoDB lưu công việc bền; worker claim bằng thao tác atomic và lease, heartbeat/recovery khi bị ngắt. Bản đầu chưa cần Redis/BullMQ.

MCP server là cổng ghi nghiệp vụ/lưu trữ. UI, worker và scheduler đi qua backend/MCP; không dựng đường ghi thẳng bỏ qua gate. File/ảnh không đưa vào MongoDB; tools trả artifact IDs và metadata thay vì base64 lớn.

### Giai đoạn 0 — Spike và hạ tầng tối thiểu

- Dựng workspace Node/TypeScript, NestJS backend và MCP server; khóa phiên bản dependency sau kiểm tra tài liệu hiện hành.
- Dựng ConfigModule, env schema, HealthModule và MCP tool `get_system_health` theo mục 2.1–2.2; không gọi OpenAI lúc startup hoặc khi polling healthcheck.
- Chạy smoke test MCP initialize/list/call qua stdio, tái kết nối khi server bị ngắt, lỗi và timeout có cấu trúc.
- Spike PDF.js trên Node với canvas phù hợp, render chữ đa ngôn ngữ, lấy text/tọa độ, kiểm tra crop sau scale/rotate. sharp chỉ cắt ảnh đã render; không giả định tự render được mọi PDF.
- Dựng MongoDB local single-node replica set cho transaction review + audit + revision pointer; ghi rõ cách chạy trong README.
- Thử Zod → schema Structured Outputs hỗ trợ thực tế; không giả định mọi schema Zod đều được provider chấp nhận.
- Kiểm tra round-trip decimal.js ↔ Decimal128 ↔ chuỗi JSON; dữ liệu vượt độ biểu diễn phải bị cảnh báo/chặn, không âm thầm làm tròn.

Nghiệm thu: PDF → ảnh → crop đúng vị trí; NestJS gọi MCP thực tế; MongoDB transaction hoạt động; không cần API AI để chạy các smoke test hạ tầng.

### 2.1. Cấu hình OpenAI hoàn toàn qua env

Mục tiêu: sau khi adapter được triển khai, chỉ cập nhật env và restart backend là tích hợp được OpenAI; không sửa source, không rebuild ứng dụng chỉ để đổi key/model. Đây là contract của ứng dụng, không có nghĩa mọi biến bên dưới được SDK tự đọc. ConfigService phải ánh xạ và validate rõ ràng.

| Env | Vai trò / quy tắc |
|---|---|
| `AI_MODE` | `openai` mặc định; `disabled` hoặc `mock` chỉ khi chủ động chọn cho local/test, không fallback ngầm |
| `OPENAI_API_KEY` | Bắt buộc trong openai mode; chỉ backend/AI Reader được nhận |
| `OPENAI_MODEL` | Bắt buộc trong openai mode; model phải hỗ trợ input và structured output của Reader |
| `OPENAI_BASE_URL` | Mặc định endpoint OpenAI chính thức; tùy chọn endpoint tương thích đã kiểm chứng, không hứa tích hợp mọi provider chỉ bằng đổi URL |
| `OPENAI_PROJECT_ID`, `OPENAI_ORG_ID` | Tùy chọn theo tài khoản; ánh xạ sang client nếu có |
| `OPENAI_TIMEOUT_MS` | Timeout request, số nguyên dương; ví dụ ban đầu 60000, điều chỉnh qua benchmark |
| `OPENAI_MAX_RETRIES` | Retry kỹ thuật hữu hạn; ví dụ 2; một tầng quản lý retry, tránh nhân số lượt SDK × workflow |
| `AI_MAX_CALLS_PER_TASK` | Budget số request thực gửi mỗi task, gồm retry/đọc lại; cấu hình nguyên dương, task vượt budget chuyển lỗi/review, không gọi tiếp âm thầm |
| `MONGODB_URI` | URI replica set local/test phù hợp, chỉ truyền tới process có trách nhiệm database |
| `STORAGE_ROOT`, `APP_PORT` | Vùng file được quản lý và port để dựng URL local thật |
| `HEALTHCHECK_TIMEOUT_MS`, `HEALTHCHECK_CACHE_TTL_MS` | Timeout/cache kết quả dependency local, phải có timestamp và không coi cache quá hạn là hiện trạng |

- Bàn giao `.env.example` có mô tả/default không chứa key thật, `.env` gitignored; test có env mock riêng.
- Validate và parse env tại startup bằng Zod. Openai mode thiếu key/model hoặc timeout/budget sai thì fail-fast với tên biến lỗi, không lộ giá trị secret. Disabled/mock không cần key nhưng phải hiển thị rõ không sẵn sàng scan OpenAI thật.
- Model có cấu hình hợp lệ chưa chứng minh account có quyền hoặc hỗ trợ vision/schema. Chỉ xác nhận sau kiểm tra provider thực tế; không tự fallback model và không tuyên bố health xanh đồng nghĩa chất lượng đọc đạt.
- Key mới/model mới cập nhật bằng restart có graceful shutdown, task dở phục hồi bằng checkpoint/lease; bản đầu không hot reload secret.
- Lưu fingerprint cấu hình không chứa secret và model/prompt/schema thực tế theo run để kiểm soát cache; đổi model làm cache cũ không tương thích. Kết quả verify gắn đúng cấu hình/credential hiện tại, đổi cấu hình trả lại `not_checked`.
- Không chuyển toàn bộ env backend sang MCP child; allowlist riêng, không truyền `OPENAI_API_KEY` cho tools không dùng AI. Không dump env/URI trong health, report hoặc log.

Nghiệm thu: adapter mock chứng minh client/request nhận đúng env; đổi key/model và restart không cần sửa code; gọi API thật sau khi có key hợp lệ để xác nhận quyền, model và input/schema thực tế.

### 2.2. Healthcheck và kiểm tra kết nối OpenAI

Dùng Nest HealthModule/Terminus cho HTTP và custom indicators. Backend lấy thông tin dependency do MCP sở hữu qua tool `get_system_health`, không tạo đường ghi DB ngoài MCP.

| Endpoint / tool | Kiểm tra | Kết quả |
|---|---|---|
| `GET /health/live` | Process HTTP còn phản hồi, trạng thái shutdown | 200 khi sống, 503 khi shutting down; không phụ thuộc DB/MCP/OpenAI |
| `GET /health/ready` | Sẵn sàng nhận scan OpenAI: MCP handshake/ping + required tool catalog, MongoDB ping/replica-set và trạng thái kiểm chứng transaction, storage truy cập được, worker heartbeat, AI_MODE và env hợp lệ | 200 khi đủ dependency local/cấu hình; 503 khi không đủ. OpenAI remote ghi `not_checked` nếu chưa verify, không coi là provider online |
| `GET /health` | Tổng quan capability: scan, review/report, từng dependency, cấu hình OpenAI và lần verify gần nhất | Mã theo scan readiness 200/503, kèm từng capability để không nhầm thiếu AI là mọi chức năng đều hỏng |
| MCP `get_system_health` | Database/storage và phiên bản tool; không gọi model, không trả secret | Kết quả typed, latency, checked_at, mã lỗi an toàn; backend timeout hữu hạn |
| `POST /diagnostics/openai/verify` | Người dùng chủ động kiểm tra một request nhỏ dùng ảnh giả lập và schema Reader tối thiểu, không dùng hồ sơ thật | Tốn token; timeout/budget/cooldown rõ, trả kết quả auth/model/khả năng input-schema được thử; không xác nhận độ chính xác nghiệp vụ |

- Readiness là readiness local/config, không bảo đảm OpenAI đang online hoặc còn quota. Trả riêng `configuration_valid`, `verification_status`, `last_verified_at`, last provider error và cấu hình fingerprint đã kiểm tra; không đưa các trạng thái khác nhau vào cùng một boolean gây hiểu nhầm.
- Không gọi provider định kỳ từ healthcheck; không dùng một request list models như bằng chứng model đọc ảnh/schema được. Verify thực chỉ chạy theo thao tác người dùng hoặc test integration chủ động.
- Có timeout riêng và cache ngắn cho local indicators; deep startup probe có thể ghi/đọc/xóa một file tạm ở vùng health riêng, không sửa dữ liệu task. Kiểm tra transaction sâu chạy ở startup/test, polling không mở transaction liên tục.
- MongoDB/MCP/storage lỗi thì fail-closed với thao tác phụ thuộc; thiếu OpenAI không tự chặn xem/review dữ liệu đã lưu khi các dependency tương ứng vẫn tốt. Healthcheck không thay thế kiểm tra quyền, revision hoặc export gate.
- Verify có bảo vệ request và quyền; chỉ trả lỗi đã redact. Nhận 401/403/429/timeout thì báo rõ loại lỗi an toàn; 429 không được coi luôn là key sai. Không tự chuyển mock hoặc provider khác.

Nghiệm thu: kiểm thử từng dependency down/recovery, thiếu env, disabled/mock, provider chưa verify, stale verification sau đổi env, timeout và graceful shutdown. Polling health liên tục phải tạo 0 AI requests.

## 3. Giai đoạn 1 — Contract và bộ dữ liệu

- Định nghĩa contracts TypeScript/Zod cùng các ví dụ hợp lệ/không hợp lệ trước khi nối model; validate cả input/output MCP tại ranh giới.
- Định nghĩa collections, index, optimistic concurrency, transaction và artifact manifest theo architecture; tách document lớn thành record theo document/chunk, không nhúng toàn task thành một record không giới hạn.
- Tool contract gồm task/revision, operation ID cho thao tác thay đổi, lỗi có mã và tham chiếu artifact; actor/role lấy từ ngữ cảnh backend được tin cậy.
- Task: `scan_task_id`, file metadata/hash, trạng thái xử lý, revision, N documents, confidence, review gate và report metadata.
- Document: ID riêng, loại, trang/vùng nguồn, confidence phân tách/phân loại, fields và validation.
- Field: `raw_value`, `normalized_value`, `candidate_value`, `extraction_confidence`, `effective_confidence`, `requires_review`, `review_status`, lý do, evidence references.
- Evidence: `evidence_id`, task/document/field path, page index quy ước rõ, bounding box theo hệ tọa độ đã công bố, ảnh crop và ảnh trang.
- Report: URL thực tế, đường dẫn nội bộ, revision, `created_at`, `expires_at`; API không lộ đường dẫn filesystem tùy ý.
- Tách lỗi chặn và warning; phân biệt “không thấy”, “không đọc được”, “không áp dụng”, “ngoài phạm vi”.
- Giữ schema bốn loại và mở rộng tiền với currency/tax/discount/refund khi có nguồn; không thay thế các trường bắt buộc gốc.
- Tạo 10 mẫu giả lập đúng cơ cấu 3/3/2/2 và ground truth do người kiểm tra. Tạo composite file từ các mẫu để kiểm thử N documents.
- Bổ sung các biến thể: đa ngôn ngữ, ngày mơ hồ, nhiều bệnh nhân/cùng loại, bảng qua trang, thuế/giảm giá/hoàn tiền/0, currency thiếu, cờ ngoài chuẩn, chữ viết tay khó, trường thiếu, trang không hỗ trợ.

Nghiệm thu: schema biểu diễn được mọi quyết định đã chốt; bộ ground truth không lấy trực tiếp từ output model để làm đáp án.

## 4. Giai đoạn 2 — Tiếp nhận file và ảnh nguồn

- Tạo task cho mỗi lần upload; lưu file gốc, hash và metadata, không khử trùng bằng cách tái dùng approve cũ.
- Kiểm tra định dạng thực, dung lượng, số trang; xử lý rõ file hỏng, PDF mã hóa hoặc không hỗ trợ.
- Render từng trang với độ phân giải cấu hình; giữ bản nguồn và thông tin phép xoay/scale để truy vết tọa độ crop.
- Lưu file dưới thư mục do ứng dụng tạo theo task ID, không dùng filename người dùng như đường dẫn tin cậy.
- Trạng thái đề xuất: `queued`, `processing`, `awaiting_review`, `ready`, `failed`. Report có trạng thái vòng đời riêng để report hết hạn không biến task thành failed.
- Ghi nhận từng bước hoàn thành để không tạo nhiều bản kết quả không kiểm soát khi retry.

Nghiệm thu: một file tạo đúng một task trong lần tiếp nhận; đọc được ảnh trang offline; đầu vào lỗi có thông báo rõ, không được xem như trích xuất thành công.

## 5. Giai đoạn 3 — Tích hợp OpenAI và phân tách N tài liệu

- Tích hợp Reader qua ConfigService theo mục 2.1; không hardcode key/model/base URL, không commit key. Kiểm tra cấu hình trước request và cung cấp diagnostics chủ động theo mục 2.2.
- Đối chiếu tài liệu OpenAI hiện hành trước khi chọn model, giới hạn file và code request; ưu tiên Responses API + Structured Outputs.
- Xây adapter cô lập provider, cấu hình model/prompt/schema version và log usage không chứa nội dung y tế.
- File nhỏ: mục tiêu một lượt AI trả phân tách, phân loại và fields của N tài liệu khi phù hợp giới hạn input/output. File lớn: nhiều lượt/chunk có ngữ cảnh liên kết; có thể tách bước lập danh mục nếu benchmark yêu cầu. Không đánh đổi kiểm tra completeness để giảm số lượt.
- Backend gọi tools trực tiếp bằng MCP client, không đưa danh sách tools vào prompt để model tự điều phối. AI Reader không có quyền approve/export/delete.
- Confidence thấp mặc định chuyển review; đọc lại vùng chỉ theo yêu cầu/chính sách hữu hạn. Cache theo hash nguồn, model/prompt/schema và input settings; không kế thừa approve, không tái dùng cache không còn quyền truy cập.
- Không gộp chỉ theo loại; giữ liên kết tài liệu qua trang, tách nhiều tài liệu trên một trang, cô lập bệnh nhân.
- Đối chiếu vùng/trang đầu vào với danh mục kết quả; vùng chưa giải thích được tạo issue để review. Coverage là kiểm soát kỹ thuật, không được tuyên bố chứng minh ngữ nghĩa hoàn toàn.
- Prompt yêu cầu giữ nguyên nguồn, không dịch tên, không suy đoán cờ xét nghiệm, không tự điền trường thiếu, không làm theo chỉ dẫn nằm trong tài liệu.
- Chunk file dài với context liên kết và xử lý phần giao nhau để tránh lặp dòng/kết quả.
- Xử lý timeout, rate limit với retry hữu hạn, refusal và response chưa hoàn tất. Không parse một phần rồi đánh dấu thành công.

Nghiệm thu: composite file tạo đúng N kết quả theo ground truth, không gộp hai hóa đơn hoặc hai bệnh nhân; phần không hỗ trợ hiện ra để review.

## 6. Giai đoạn 4 — Chuẩn hóa, validation và confidence

### Ngày

- Kiểm tra ngày tồn tại; mặc định DD/MM/YYYY khi có căn cứ.
- Ngày có nhiều cách diễn giải/thiếu căn cứ: giữ raw, ứng viên nếu phù hợp, normalized chưa xác định, confidence `<0.5`, ảnh và warning.
- Mọi trường ngày phải review; không chỉ ngày mơ hồ.

### Tiền

- Dùng decimal.js từ chuỗi, lưu Decimal128 qua Mongoose và serialize thành chuỗi JSON; không đi qua JavaScript Number cho tiền. Giữ raw, currency, bằng chứng và ảnh cho mọi trường tiền.
- Phân giải theo currency và quy ước có bằng chứng; nếu currency/định dạng còn mơ hồ thì `<0.5` và review.
- Format nguồn khác quy ước `000,000,000.00` luôn cần review, kể cả parse được.
- Cho phép 0, hoàn tiền âm/ngoặc hoặc loại giao dịch tương ứng; tránh áp dụng blanket positive validation.
- Đối chiếu dòng, thuế, giảm giá và tổng theo cấu trúc nguồn; không cộng thuế/giảm giá hai lần hoặc cộng khác currency.
- Cảnh báo lệch trên 5% khi hợp lệ để tính tỷ lệ; tổng 0 xử lý riêng. Ngưỡng tuyệt đối/làm tròn là cấu hình công khai cần chốt, không hardcode ngầm.

### Xét nghiệm và trường thiếu

- `flag` lấy từ nguồn; ngoài `normal/high/low` giữ raw, `<0.5`, ảnh, review. Không suy ra từ khoảng tham chiếu.
- Chữ viết tay khó: ứng viên hoặc null, `<0.5`, ảnh, review.
- Không đọc được: null, `<0.5`, ảnh. Không thấy: null, `<0.5`, tham chiếu trang đã kiểm tra.

### Confidence/gate

- Áp dụng rule caps độc lập với điểm AI. Giá trị bị buộc thấp tối đa 0.49, không làm tròn lên 0.5; không coi 0.49 là xác suất hiệu chuẩn.
- Tính min đệ quy gồm trường con, segmentation, classification và coverage; không bỏ trường thiếu, không lấy trung bình.
- Xử lý confidence NaN/ngoài khoảng/thiếu và task rỗng theo hướng chặn.
- `requires_review` độc lập confidence, gate chặn mọi trường bắt buộc còn pending và mọi validation error chặn.

Nghiệm thu: một trường con 0.49 làm document và task dưới 0.5; ngày rõ confidence cao vẫn bị gate chặn khi chưa xác nhận.

## 7. Giai đoạn 5 — Bằng chứng và giao diện review local

- Crop theo tọa độ có kiểm tra giới hạn và hệ tọa độ. Cho phép nhiều evidence cho một trường qua trang.
- Nếu crop không đáng tin thì hiện nguyên trang và yêu cầu kiểm tra, không gắn ảnh sai như bằng chứng chắc chắn.
- Giữ ngữ cảnh nhãn/cột/currency; nối crop tới trang gốc.
- Trang review đơn giản: xem tài liệu/ảnh, raw/candidate/normalized, sửa giá trị, confirm và lý do. Hiện rõ những trường đang chặn task.
- Review thao tác qua backend có kiểm tra revision và bảo vệ request thay đổi trạng thái; không approve bằng link GET hoặc HTML tĩnh.
- Lưu audit reviewer/thời điểm/trước-sau/lý do; chỉ thay effective confidence theo quy ước review, giữ extraction confidence.
- Dùng MongoDB transaction + revision compare-and-swap để lưu review, audit và current revision pointer nhất quán; export chỉ đọc revision đã commit hoàn chỉnh. Xác minh actor từ backend, không tin reviewer name trong payload.
- Chạy lại hoặc sửa nguồn tạo revision và vô hiệu hóa xác nhận liên quan; tính lại gate và report.
- Endpoint/export cho downstream kiểm tra gate tại backend. JSON/report chẩn đoán vẫn xem được khi task bị chặn.

### Trang manual test local

- Route UI dự kiến `/manual-test`; NestJS phục vụ trang Handlebars và JS/CSS local. Một trang có khu upload, danh sách task, nguồn và results/review, không cần framework frontend mới ở bản đầu.
- Upload PDF/ảnh bằng request multipart; validation trước xử lý, một upload tạo một task, phản hồi task ID rồi polling trạng thái có backoff/timeout. Polling chỉ đọc, không tạo task hoặc gọi AI mới.
- Nhóm results theo document ID, hiển thị source pages và crop cạnh field; có filter cần review, lỗi validation, pending/confirmed/corrected và confidence màu + nhãn.
- Mỗi field hiện raw/ứng viên, giá trị hiện tại, extraction confidence và final confidence. API contract có `final_value`, `final_confidence` (alias effective confidence), `review_status` và lý do; không tạo hai trường effective/final có thể mâu thuẫn trong storage.
- Thao tác Approve hoặc Edit → Save draft → Confirm correction. Save draft về pending, hủy hiệu lực approve trước đó của field liên quan; approve/correct hợp lệ final confidence 1.0 nhưng extraction confidence giữ nguyên.
- Nếu approve document, backend mở rộng thành tập field/segmentation confirmations minh bạch, kiểm tra đủ evidence và validation; document button không được tự clear mọi warnings hoặc pending không được xem xét.
- Có khu xác nhận loại/boundaries/patient và source refs khi các thành phần này đang chặn; chưa thể sửa an toàn thì giữ block và giải thích. Thay grouping/source tạo revision, chỉ giữ xác nhận cũ cho phần còn chứng minh không thay đổi.
- Server dùng đúng rules validation/gate đã chốt, tính lại document/task final confidence bằng min. Rule caps giữ ở kết quả AI; review chỉ giải quyết khi người dùng đã xác nhận/sửa rõ ý nghĩa, không xóa blocking errors bằng cách nâng điểm.
- Nếu field/day/currency vẫn thiếu căn cứ hoặc dữ liệu downstream bắt buộc còn thiếu thì chưa được ready dù đã bấm approve. Cho xác nhận thiếu chỉ theo trường hợp nghiệp vụ cho phép.
- Request submit có expected_revision/operation ID, actor từ backend; thiếu quyền từ chối, stale revision 409 và UI yêu cầu tải bản mới/đối chiếu, không âm thầm ghi đè.
- Thành công cập nhật UI bằng payload server, lưu audit + revision transaction; report snapshot tạo lại với revision đúng và expires_at cũ. Report generation lỗi hiển thị riêng, không làm mất review đã commit hoặc giả report mới thành công.
- Mọi field edit/approve/refresh không gọi AI. Nút rerun riêng có hiển thị khả năng phát sinh chi phí và không tự kế thừa review. Manual corrections không làm thay kết quả automated test/ground truth đã lưu.

Nghiệm thu: upload thật qua browser → xem kết quả/ảnh → approve/sửa hợp lệ → trạng thái và final confidence được tính lại, reload vẫn đúng. Không thể gọi thẳng export để bỏ qua pending review; approve/correct truy vết được; revision cũ không ghi đè kết quả mới. Test IT-MANUAL-01–08 theo test-strategy.

## 8. Giai đoạn 6 — HTML report và thời hạn 30 ngày

- Dựng `reports/<scan_task_id>/index.html` và assets tương đối, offline, không CDN; lưu bản ảnh report riêng với bằng chứng chính.
- Nhóm theo document ID, hiển thị loại/trang, confidence phân tách/phân loại, toàn bộ fields/list items, warnings và validation.
- Áp dụng dải màu chính xác theo context, có điểm và nhãn chữ; badge review độc lập màu.
- Hiển thị ảnh trường, click xem lớn/trang nguồn; khi không có crop thì giải thích và hiển thị tham chiếu trang.
- Hiển thị task ID, revision, thời điểm tạo/cập nhật và hạn dùng; report là snapshot chỉ đọc.
- Trả `report.url` từ cấu hình server local thật và `expires_at` trong JSON. Mở trực tiếp index.html vẫn có ảnh.
- Autoescape mọi text/attribute; chỉ cho URL ảnh nội bộ đã kiểm tra; chặn path traversal và truy cập chéo task.
- Thiết lập `expires_at = initial_report_created_at + 30 ngày`, lưu timestamp có timezone; tái tạo sau review giữ hạn cũ.
- Kiểm tra hạn trước phục vụ HTML và từng asset; link hết hạn trả HTTP 410 kèm thông báo. Dọn khi khởi động và định kỳ khi chạy bằng scheduler gọi MCP cleanup.
- MongoDB TTL index không xóa file filesystem; giữ report metadata để biết expires_at, retry cleanup và trả 410. Chỉ dùng TTL cho dữ liệu tạm độc lập nếu cần, không dùng để thay cleanup report.
- Cleanup idempotent, an toàn với report đang tạo; chỉ xóa report và asset riêng, không xóa file gốc/bằng chứng chính. Dùng ghi file tạm rồi đổi tên để tránh báo cáo nửa chừng.
- Tài liệu hướng dẫn nêu rõ máy/ứng dụng tắt sẽ dọn khi chạy lại; không hứa xóa đúng hạn tuyệt đối. Chưa cài tác vụ hệ điều hành nếu không có yêu cầu tiếp theo.

Nghiệm thu: mở report qua link và trực tiếp offline, ảnh đầy đủ; clock giả lập kiểm tra trước/đúng/sau hạn, cả HTML và ảnh đều bị từ chối sau hạn; dữ liệu chính còn nguyên.

## 9. Giai đoạn 7 — Kiểm thử, đánh giá và bàn giao

Testcase chi tiết, fixture, expected result và mapping risk/decision được quản lý trong [test-strategy.md](test-strategy.md). Đây là nguồn theo dõi kiểm thử cho từng giai đoạn, không đợi đến cuối mới chạy.

### Chiến lược thực thi bắt buộc

- Triển khai suite smoke với NestJS, MCP stdio, MongoDB replica set, render/crop và filesystem thật; Reader fake để kiểm tra nhanh, không tốn AI.
- Integration deterministic dùng OpenAI HTTP fake cho boundary provider, nhưng giữ các component nội bộ thật. Bao phủ input hợp lệ, ngoại lệ, giá trị biên, dependency failure/recovery, concurrency và retry.
- Integration OpenAI live gồm LIVE-01–10, một testcase riêng cho từng document baseline 3 receipts/3 discharge summaries/2 labs/2 prescriptions; composite/holdout và preflight giữ như bước/biến thể bổ sung, không thay baseline; dùng ground truth độc lập; chạy chủ động có key/budget, ghi config/model/version/usage. Không có key thì SKIPPED, không báo PASS tích hợp thật.
- Manual page end-to-end kiểm tra upload, xem result, edit/approve, final confidence, audit, reload và conflict bằng browser thật; không chỉ gọi endpoint.
- Report/UI end-to-end kiểm tra trên browser và mở HTML offline. Màu, nhãn, ảnh đúng field/trang, gate và expiry phải kiểm tra chức năng, không chỉ snapshot HTML.
- Test data đa dạng theo matrix: đa ngôn ngữ, composite documents, cùng loại khác bệnh nhân, nhiều trang/cùng trang, ngày mơ hồ, tiền/currency/refund/0, flag ngoài chuẩn, viết tay, thiếu/không đọc được, input độc hại.
- Thêm scripts dự kiến `test:smoke`, `test:integration`, `test:integration:live`, `test:e2e`, `test:report`. Nhận `TEST_RUN_ID` để gộp suites cùng đợt; không tái dùng ID cho đợt mới. Report ở `runtime/test-reports/<test_run_id>/index.html`, normalized results và manifest đi kèm; trả/in test_report_url. Hiện đây là kế hoạch, chưa có test code hoặc executable scripts.
- Mỗi testcase ghi risk/decision IDs, expected/actual, fixture/version, evidence và trạng thái. Smoke/P0 deterministic phải PASS; BLOCKED/SKIPPED/NOT_RUN không được coi là đã cover bằng thực nghiệm.
- Mỗi thay đổi decision/risk phải cập nhật ma trận; case phụ thuộc ngưỡng/định nghĩa chưa chốt ghi BLOCKED, không tự đặt yêu cầu để có test xanh.

### Trang tổng hợp kết quả test

- Triển khai result contract chung, JSON reporters từng suite và aggregator theo test_run_id; MCP tool `generate_test_report` tạo một HTML có nhóm smoke/integration/OpenAI thật trên cùng trang.
- Live luôn có đủ 10 hàng baseline, kể cả SKIPPED/BLOCKED/NOT_RUN, kèm expected/actual diff từng document/field, source images, confidence, gate, attempts và usage/cost. Preflight/composite/holdout riêng để không làm sai denominator 10 documents.
- HTML offline, filter/status/legend, summary đúng; partial run có cảnh báo, không mất lỗi của attempt cũ. Trả test_report_url và manifest; không gọi AI để viết báo cáo.
- Tách test report theo test_run_id khỏi scan report theo scan_task_id; tái dùng cơ chế retention 30 ngày với manifest riêng. Giữ ảnh test đủ xem offline, không phụ thuộc scan link đã hết hạn.
- Implement IT-TREPORT-01–05 cùng reporter; chi tiết schema/bố cục và nghiệm thu trong mục 14 của test-strategy.

### Kiểm thử logic có tác động nghiệp vụ

- Confidence min, giá trị biên 0.5, số chưa làm tròn, trường/list item thiếu, task rỗng.
- Ngày DD/MM rõ/mơ hồ/không hợp lệ; nguồn không đủ căn cứ không bị chuẩn hóa âm thầm.
- Tiền đa định dạng, currency thiếu, 0, hoàn tiền, thuế/giảm giá đã bao gồm, tổng 0 và lệch 5%.
- Cờ ngoài chuẩn và cờ thiếu không tự thành normal.
- Review gate, confirm/correct, audit, revision, export bị chặn.
- Vòng đời report, asset hết hạn, cleanup không xóa dữ liệu chính, escape nội dung độc hại.

### Kiểm thử tích hợp và xem thực tế

- Dùng provider giả lập cho lỗi API, partial response, refusal, timeout và retry.
- Kiểm tra env parsing/fail-fast, thay env và restart không sửa code, redaction secret, allowlist MCP child env, invalid model và không fallback ngầm.
- Health tests: liveness độc lập dependency; readiness 503 khi MCP/MongoDB/storage/worker lỗi; disabled AI vẫn cho review phù hợp; polling 0 provider calls.
- Diagnostics verify: ảnh giả lập, quyền/cooldown, budget, lỗi 401/403/429/timeout và reset kết quả khi cấu hình đổi; không dùng kết quả cũ làm bằng chứng cấu hình mới.
- Kiểm thử MCP qua transport thật, tool replay idempotent, worker lease/recovery; MongoDB transaction, stale revision, review đồng thời và audit nhất quán.
- Xác minh tạo report, validation, crop, cleanup và review không phát sinh AI call; ghi số call/token/chi phí mỗi task.
- Kiểm tra Decimal128 round-trip và JSON money là chuỗi, không mất phần thập phân.
- Kiểm tra lỗi filesystem giữa hai bước DB update để bảo đảm artifact/report đang tạo không bị export như bản hoàn chỉnh.
- Chạy API thật trên bộ mẫu sau khi có key/budget phù hợp; báo rõ phần nào mock, phần nào đã chạy thật.
- Kiểm tra file nhiều loại, cùng loại nhiều bệnh nhân, nhiều trang và nhiều tài liệu trên một trang.
- Mở HTML bằng trình duyệt, kiểm tra ảnh, phóng to, đường dẫn offline, tiếng Việt/ngôn ngữ khác, bảng dài và màu/nhãn.
- Kiểm tra không có dữ liệu y tế thật hoặc secret trong repository, report mẫu và log bàn giao.

### Đánh giá chất lượng

- So ground truth: classification, field accuracy, độ đầy đủ danh sách/trang, hallucination, phát hiện tình huống cần review.
- Đo riêng kết quả AI trước review và kết quả cuối sau review; không dùng điểm 1.0 do người xác nhận để chứng minh AI chính xác.
- Báo thời gian, token/chi phí, tỷ lệ cần review và lỗi còn lọt ở các trường được phép sử dụng tiếp.
- Tách bộ dùng chỉnh prompt và bộ kiểm tra khác mẫu. Không suy rộng tỷ lệ trên 10 mẫu thành chất lượng production.
- Không tự đặt KPI accuracy không có căn cứ. Nếu chưa đạt, báo lỗi và giữ gate thay vì làm đẹp confidence.

### Bàn giao

- [readme.md](../readme.md) là entrypoint giới thiệu bài toán/giải pháp/giới hạn, architecture, deploy, chạy suites, xem report và manual test. Hiện lệnh/routes ghi rõ dự kiến; chỉ đổi thành đã chạy sau kiểm chứng.
- Khi có code, cung cấp lockfile, `.env.example`, Compose service `mongodb` khởi tạo replica set và scripts `build`, `start:prod`, `start:dev` tương ứng hướng dẫn; không tuyên bố deploy được nếu chưa có artifacts.
- README: cài Node/MongoDB replica set, cấu hình key/model, chạy NestJS + MCP stdio, upload, xem JSON/report, review, retention và giới hạn.
- Đồng bộ sơ đồ và decision log trong architecture khi thay đổi module, tool contract hoặc luồng dữ liệu; cập nhật mapping testcase theo risk/decision trong test-strategy.
- Bàn giao một trang report HTML tổng hợp ba suite với test_report_url, normalized results JSON và run manifest; OpenAI live theo dõi đủ 10 baseline documents.
- Bàn giao kết quả từng suite và từng testcase/subcase, gồm các case chưa chạy/bị chặn, bằng chứng và diff với ground truth; không dùng code coverage thay cho coverage nghiệp vụ.
- `.env.example` không có key thật, bảng biến/default/required, cách cập nhật env + restart; health endpoints và diagnostics với lưu ý chi phí. Dependency lock và lệnh chạy kiểm thử.
- 10 tài liệu giả lập, ground truth, extraction results, report mẫu và writeup prompt engineering.
- Danh sách hạn chế còn lại và kết quả đo thực tế. Chuẩn bị nội dung repo; không mặc định push hoặc publish nếu chưa được yêu cầu.

## 10. Thứ tự và ước lượng sơ bộ

Ước lượng dưới đây là kế hoạch ban đầu cho phạm vi mở rộng, không phải thời hạn đã cam kết. Phụ thuộc chất lượng mẫu, model và yêu cầu sửa lỗi thực nghiệm.

| Nhóm công việc | Ước lượng |
|---|---|
| Spike Node/PDF/MCP/MongoDB, env/health, contract, dữ liệu mẫu và skeleton | 1–2 ngày |
| Ingestion, segmentation/extraction OpenAI | 1–2 ngày |
| Validation, confidence, evidence | 1–2 ngày |
| Review gate, audit, HTML, retention | 1–2 ngày |
| Tích hợp, đánh giá và tài liệu | 1–2 ngày |

Tổng tham khảo: 5–10 ngày làm việc cho một người, chưa gồm đánh giá production hoặc chuẩn bị dữ liệu thật. Chỉ chốt lại sau giai đoạn 1 và một lần chạy thử pipeline. Bản demo trong 4–6 giờ cần giảm phạm vi và ghi rõ các phần chưa có, không coi là hoàn thành toàn bộ đặc tả.

## 11. Các điểm cần hoàn thiện nhưng không cản trở dựng skeleton

Danh sách câu hỏi và trạng thái lựa chọn được lưu tại mục 7 của [brainstorm.md](../context/brainstorm.md). Các mục dưới đây là công việc cần thực hiện trong plan, không phải các quyết định nghiệp vụ mới.

- Model cụ thể, key, ngân sách và giới hạn trang/dung lượng: cấu hình, xác nhận trước benchmark API thật.
- Tập ngôn ngữ ưu tiên và độ khó viết tay: mô tả rõ trong benchmark; không hứa hỗ trợ mọi ngôn ngữ ngang nhau.
- Ngưỡng tiền tuyệt đối, làm tròn, trường bắt buộc downstream: tách cấu hình, chưa tự coi là quyết định đã chốt.
- Thời hạn lưu file gốc/bằng chứng chính: tách khỏi TTL report 30 ngày.
- Reviewer identity: bản local có thể bắt đầu bằng cấu hình danh tính rõ ràng; không tuyên bố có authentication nhiều người dùng nếu chưa xây.
- Xóa vật lý đúng hạn khi ứng dụng đóng và chia sẻ report ngoài máy: ngoài phạm vi local đầu tiên, cần yêu cầu riêng.
