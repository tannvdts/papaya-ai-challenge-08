# Implementation status

Ngày cập nhật: 19/10/2026. Đây là trạng thái triển khai và bằng chứng, khác với yêu cầu/plan mục tiêu. Xem [README](../readme.md) để chạy và [test strategy](test-strategy.md) để đối chiếu phạm vi từng case.

## Đã có trong bản local

- NestJS/TypeScript backend, env validation, live/ready/capability health và OpenAI Node SDK adapter. Mock mode là lựa chọn chủ động, không giả OCR/AI thật.
- Một MCP server stdio với input schemas, MongoDB/Mongoose storage, tools cho ingestion/evidence/validation/review/report/export/health. Backend không cấp tools cho model.
- MongoDB 7 replica set local, transaction review + audit + revision, optimistic concurrency, idempotent review operation và worker claim/lease/heartbeat. Mất MCP có reconnect hữu hạn.
- PDF → ảnh trang, text nguồn, PNG/JPEG normalize và crop bbox; bbox không chắc fallback cả trang. Kiểm tra loại/dung lượng/trang và image pixels.
- Output contract v1, ngày mơ hồ/flag/currency/handwriting caps, missing fields null, số thập phân chính xác và tổng hợp confidence min.
- Manual page upload/result/source/approve/draft/correct, trạng thái/final confidence tính ở backend, audit/revision và export gate. Rerun UI và trình regroup tài liệu chưa có; upload lại là task mới.
- Scan report offline có màu/nhãn/evidence, test report chung theo run ID, assets riêng và cleanup 30 ngày. Link hết hạn không phụ thuộc việc xóa vật lý đã hoàn tất.
- 10 PDF synthetic 3/3/2/2, truth JSON và manifest; runtime prompt và writeup prompt engineering. Ground truth được khai báo riêng với output model nhưng chưa có xác nhận của reviewer độc lập.
- Dockerfile, Compose, lockfile, CI workflow và scripts build/start/test/report. CI workflow đã viết nhưng chưa được xác minh trên GitHub Actions remote.

## Bằng chứng kiểm thử

- Unit suite: 25 tests đã PASS; TypeScript build PASS.
- Vòng `implementation-001`: 12 smoke và 73 integration IDs đã PASS sau sửa lỗi; browser Chromium đã thực hiện upload → result → approve date → ready → reload. Lịch sử attempts giữ cả những lần lỗi trước sửa.
- Vòng cuối `TEST_RUN_ID=acceptance-20261019`: **12 smoke PASS + 73 integration PASS, 10 live SKIPPED**, không còn FAIL/NOT_RUN trong catalog hiện tại. Chromium upload/result/approve/ready/reload/ảnh nguồn PASS; screenshot trong run. Lịch sử các lần FAIL trước sửa vẫn nằm ở attempts.
- Tests dùng NestJS/MCP/MongoDB/filesystem thật, provider fake có điều khiển ở các cases deterministic; không chứng minh model thật đọc đúng mọi ảnh.
- Ngày 19/10/2026 người dùng chọn tự cấu hình OpenAI và chạy sau. Mười LIVE-01–10 được ghi SKIPPED khi thiếu key/model; không tính vào số đạt hoặc accuracy.
- `npm audit --omit=dev` đã trả 0 vulnerabilities sau cập nhật PDF.js/sharp. Full audit còn advisory moderate trong chuỗi dependency dev của Jest; không dùng `--force` downgrade để che kết quả.
- Docker image `medical-document-extractor:local` build PASS. Container Linux chạy trên port validation riêng đã upload/render/crop/report một PDF synthetic thành công; container và database validation riêng đã được dọn.

## Các lỗi đã được tests phát hiện và sửa

1. Shared page hạ segmentation confidence nhưng chưa tính lại tổng → evaluate lại trước commit.
2. API dùng null-coalescing khiến normalized null bị thay lại bằng chuỗi mơ hồ → giữ value null, ứng viên riêng.
3. Precision mặc định khi nhân Decimal làm mất phần lẻ của số lớn → clone precision 50, kiểm tra ngưỡng Decimal128 trước lưu.
4. Save draft không được kế thừa final 1.0 trước đó → trạng thái pending và score bị chặn đến khi confirm hợp lệ.
5. Test harness đọc pre-update lease thay vì post-update → sửa native MongoDB returnDocument, tránh nhầm lỗi harness với lỗi sản phẩm.

## Phạm vi chưa nghiệm thu / giới hạn thật

- OpenAI thật, chất lượng multilingual/handwriting, chi phí và calibration chưa đo. Người dùng sẽ cấu hình `.env` và chạy live sau.
- Baseline dùng nhãn key:value để dễ đối chiếu, chưa đủ đa layout/ngoài Latin/handwriting thật. DOC-RX-02 là trường thiếu, không đại diện nhận dạng chữ viết tay thực tế.
- File trong giới hạn gửi một request; chunk/merge ngữ nghĩa cho file lớn, dedup sâu qua chunks và holdout đa dạng còn cần bổ sung. Bản hiện tại từ chối input vượt giới hạn, không âm thầm drop trang.
- Tools kiểm tra vùng/trang có tham chiếu, không chứng minh AI không bỏ sót nội dung ngữ nghĩa. Không cho score cao thay thế đánh giá completeness trên ground truth.
- Manual structure confirmation không thay thế trình sửa grouping/source phức tạp. Nếu grouping sai và chưa giải quyết được thì giữ block, không approve cho xong.
- Ngưỡng tiền tuyệt đối, rounding theo currency, required downstream fields và retention file gốc/evidence chính còn cần nghiệp vụ xác định; không coi ready là phê duyệt bồi thường.
- Local trusted session, chưa có hệ thống login nhiều người dùng, authorization tenant hay triển khai production. Không public trực tiếp.
- MongoDB/filesystem không có transaction chung; có file staging/manifest, revision pointer và export kiểm tra artifact. Reconciliation toàn diện và stress nhiều workers vẫn cần đánh giá thêm.
- Testcase ID PASS phản ánh các assertions đã thực thi trong code, không chứng minh mọi tổ hợp/biến thể mô tả đã bao phủ; cần mở rộng fault injection và fixtures sau benchmark.
- Test reports hiện lưu normalized JSON/manifest trên filesystem theo run ID; collections test_runs/test_case_results trong thiết kế chưa được dùng. Rendering service dùng chung với MCP tool; CLI có thể dựng report khi backend/DB không chạy.
- Chưa push GitHub hoặc publish; không có yêu cầu push repo trong phiên này.

## Lịch sử nghiệm thu

| Mốc | Trạng thái |
|---|---|
| Local MongoDB replica set | Đã khởi động và dùng trong integration tests |
| Browser manual flow | Đã chạy trên Chromium; screenshot ở report run |
| Acceptance run / Docker build cuối | 85 catalog cases PASS, 10 SKIPPED; Docker build + Linux upload/report PASS |
| OpenAI live 10 documents | Hoãn theo lựa chọn người dùng, SKIPPED khi thiếu cấu hình |

Bản report bàn giao: [HTML offline](../outputs/acceptance-report/index.html), [results JSON](../outputs/acceptance-report/results.json). Bản copy outputs nằm ngoài cleanup runtime 30 ngày.


## Sửa lỗi MCP khi đọc PDF scan (2026-10-19)

MCP crash native (SIGSEGV trong skia) khi PDF chứa ảnh: ứng dụng dùng `@napi-rs/canvas` 0.1.100 trong khi PDF.js 6.4.299 nạp canvas 1.0.11 riêng. Đồng bộ dependency trực tiếp thành 1.0.11, lockfile chỉ còn một bản canvas dùng chung (npm ls xác nhận deduped).

Kiểm chứng: 28 Jest tests PASS, gồm regression PDF ảnh PNG/JPEG chạy trong child process và kiểm tra pixels; 73 integration cases PASS, trong đó IT-DOC-08 render cả 14 manual PDF scan/17 trang qua MCP thật. Report: `runtime/test-reports/run-1792405522756/index.html`. Hai task scan bị gián đoạn đã tự chạy tiếp thành `awaiting_review`; health và API task trả HTTP 200. Bộ 14 scan chỉ được kiểm chứng render/MCP, chưa được chấm chất lượng extraction qua OpenAI toàn bộ.


## Vận hành Compose (2026-10-19)

Compose mặc định chạy backend/MongoDB bằng `up -d --build --wait`; profile test có image dev dependencies riêng. Backend/tests cùng user node để dùng chung volume report. APP_PORT điều khiển host/container port; APP_URL mặc định suy ra theo APP_PORT. Đổi .env dùng recreate. MCP startup timeout tăng từ 10 lên 30 giây để hỗ trợ cold start trong Docker.

Kiểm chứng stack riêng (không dùng key OpenAI): runtime/test images build PASS; 12 smoke và 73 integration PASS trong Linux containers; upload tổng hợp HTTP 201, report scan/test HTTP 200. Thay APP_PORT 4127 → 4128 qua env/recreate PASS, Origin cập nhật đúng và giữ task/report cũ. 31 Jest tests PASS cho config/domain/render regression. Report lưu tại `outputs/compose-operations-check/index.html`, chi tiết deploy ở `outputs/compose-operations-check/deployment-validation.json`; bản runtime phục vụ tại `/test-reports/compose-operations-check/index.html`. Đã dọn stack/volumes kiểm chứng riêng sau khi copy report, không xóa dữ liệu project đang chạy trên host. README là tài liệu vận hành chính; tài liệu thiết kế được giữ trong context/plans/diagrams.


## Tách bộ mẫu theo chế độ (2026-10-19)

Đổi `samples/` thành `smoke-samples/` cho mock/smoke/integration fixtures, đổi script tạo/export theo tên thư mục. `manual-test-samples/` dùng cho manual test OpenAI và endpoint diagnostics. API `/session` trả `sample_set` theo AI_MODE; UI hiển thị hướng dẫn và loại file phù hợp. Mười fixture text vẫn giữ cho live regression tự động với truth JSON, không dùng thay bộ manual scan. Docker runtime/test images chứa đúng thư mục mới.

Kiểm chứng: 34 Jest tests PASS; 12 smoke + 73 integration PASS, report `/test-reports/sample-set-separation-20261019/index.html`. Backend port 4000 đã restart; mode OpenAI trả sample_set `manual-test-samples`, trang manual test HTTP 200. Không gọi OpenAI thật trong đợt kiểm tra này.

Docker runtime/test build PASS sau đổi thư mục; kiểm tra runtime image offline xác nhận chứa `smoke-samples/DOC-REC-01.pdf` và `manual-test-samples/MT-01-clean-receipt.pdf`, routing bộ mẫu theo mode đúng.


## Đổi tên mock fixtures (2026-10-19)

Đổi `smoke-samples/` thành `mock-samples/` để phản ánh phạm vi dùng trong mock, smoke/integration, browser E2E và live baseline tự động. Đồng bộ tên scripts, npm commands, `MOCK_SAMPLE_DIR`, session/UI, Docker COPY và tài liệu hiện hành. `manual-test-samples/` giữ nguyên. Các bản report/lịch sử cũ giữ nguyên tên đường dẫn tại thời điểm chạy.

Kiểm chứng: 34 unit + 12 smoke + 73 integration PASS; report `/test-reports/mock-samples-rename-20261019/index.html`. Kiểm tra đường dẫn Docker COPY và link README PASS; không chạy lại Docker build hoặc OpenAI thật cho lần đổi tên này.


## JSON trên trang manual test (2026-10-19)

Thêm block JSON kết quả có thụt dòng, cuộn và chỉ đọc; ẩn trong khi queued/processing, hiển thị snapshot đầy đủ của task sau xử lý và đồng bộ sau approve/draft/correction hoặc chuyển task. Render bằng textContent để giữ nội dung nguồn dưới dạng văn bản.

Chromium E2E PASS: JSON bằng API snapshot sau upload; cập nhật status/revision/final confidence khi approve; cập nhật giá trị khi lưu nháp/xác nhận sửa; reload giữ nguyên JSON. Report `/test-reports/manual-json-result-20261019/index.html` (2 browser cases PASS). Trang đang chạy port 4000 đã phục vụ block mới, không cần restart backend vì HTML được đọc mỗi request.


## Review table — implementation hoàn tất (2026-10-19)

Manual UI chuyển sang table theo document, filter/count và panel nguồn/sửa. Field không bắt buộc không có xác nhận trực tiếp; sửa chủ động qua draft mở vòng review. Backend suy ra review_reasons, đánh dấu field có blocking error và từ chối confirm ngoài vòng hợp lệ, giữ nguyên idempotency/revision/audit/gate. Điểm sau review chỉ hiện cho confirmed/corrected; JSON giữ snapshot đầy đủ. Client giữ draft khi conflict và tránh lẫn task/revision trong audit.

Kiểm chứng: 37 unit, 12 smoke và 73 integration PASS; Chromium table/source/JSON/draft/correction/reload/conflict/multiple-documents/mobile PASS. Có một attempt lỗi hash navigation được giữ và đã sửa/rerun. Runtime/test Docker build cuối PASS, Linux smoke/integration 85 PASS. Browser chạy trên Docker bằng prescription giả xác nhận doctor không có Approve, gọi approve trực tiếp trả 409, ngày được duyệt thì ready và AI score không đổi. Không gọi OpenAI thật và không review task của người dùng để kiểm thử.

Report host: `/test-reports/table-review-implementation-20261019/index.html`; report Docker được copy về host: `/test-reports/docker-table-review-20261019/index.html`. Capture, offline report và deployment checks ở `outputs/manual-review-table-acceptance/`. App port 4000 đã cập nhật; chỉ dọn stack kiểm chứng riêng port 4128. [Plan đầy đủ](manual-review-table-plan.md).
