# Prompt brief — Từ brainstorm đến cải tiến sau implementation

Ngày tổng hợp/cập nhật: 19/10/2026. Phạm vi hiện tại: P01–P30.

## 1. Mục đích và phạm vi

Tài liệu tóm tắt các prompt và vòng phản hồi giữa người dùng và AI trong phiên làm việc về Medical Document Extractor. Mục đích là giúp người đánh giá theo dõi cách người dùng phân rã bài toán, khai thác phản biện của AI, quyết định phạm vi, chuyển brainstorm thành kế hoạch có thể kiểm tra và tiếp tục cải tiến sau khi dùng ứng dụng thực tế.

Đây là bản tóm tắt có diễn giải theo thứ tự trao đổi, không phải transcript nguyên văn. Nội dung được tổng hợp từ lịch sử chat và các tài liệu đã tạo; không có timestamp từng lượt, số token hoặc thông số model của phiên chat được xác minh. Không suy diễn các thông tin này.

Đề bài tham chiếu: [AI Challenge 08 — Medical Document Extractor](https://github.com/papaya-insurtech/pumpkin/blob/main/Hiring/AI_Engineering_Challenges/AI_Challenge_08.md).

Tại thời điểm kết thúc P20, phạm vi đã làm: phân tích yêu cầu, quyết định nghiệp vụ, kiến trúc, kế hoạch kiểm thử và tài liệu vận hành dự kiến. Chưa triển khai ứng dụng, chưa chạy test hoặc OpenAI API thật, chưa có 10 file mẫu/extraction results để chứng minh chất lượng.

## 2. Cách phân biệt nguồn quyết định

- **Người dùng yêu cầu/chốt:** ràng buộc hoặc thay đổi trực tiếp trong prompt.
- **AI đề xuất:** lựa chọn, cách diễn giải hoặc thiết kế được AI đưa ra; không mặc định là đã được người dùng phê duyệt từng chi tiết.
- **Artifact:** tài liệu được tạo/cập nhật để giữ kết quả trao đổi.
- **Đã đặc tả** khác **đã triển khai** và **đã kiểm chứng**. Tài liệu này giữ rõ ba trạng thái, không coi số lượng testcase hay report thiết kế là kết quả chạy thật.

## 3. Lịch sử prompt và vòng phản hồi

Các prompt dưới đây được tóm tắt, không đặt trong dấu trích dẫn nguyên văn.

### P01 — Investigate đề bài trước khi chọn giải pháp

**Người dùng:** cung cấp link challenge, yêu cầu phân tích bài toán hiện tại, đầu ra, giới hạn kỹ thuật/độ chính xác khi có và không có AI, rủi ro và cách tích hợp ChatGPT/OpenAI.

**AI:** đọc đề, phân tích so sánh, đề xuất AI đọc tài liệu kết hợp code validation và người kiểm tra; nêu giới hạn confidence tự khai và nhu cầu benchmark. Kiểm tra tài liệu OpenAI chính thức cho tích hợp. Hai dòng rủi ro trong prompt ban đầu bị trùng, AI công khai diễn giải thành rủi ro có và không dùng AI.

**Kết quả:** có cơ sở phân tích và các câu hỏi nghiệp vụ cần làm rõ; chưa nhảy ngay vào implementation.

### P02 — Làm rõ dữ liệu đầu vào và yêu cầu review

**Người dùng:** xác nhận tài liệu đa ngôn ngữ, một file có nhiều loại, mặc định ngày DD/MM/YYYY nhưng ngày mơ hồ phải cảnh báo/giảm confidence; có thuế/giảm giá/hoàn tiền/0; cờ xét nghiệm lấy từ nguồn. Bắt buộc kiểm tra ngày, flag, chữ viết tay khó và tiền khác format chung. Yêu cầu AI tìm rủi ro còn lại.

**AI:** chỉ ra việc cùng document_type chưa đủ để gom tài liệu, rủi ro nhầm bệnh nhân, định dạng ngày/tiền, cờ ngoài chuẩn và warning không chặn workflow. Làm rõ thang confidence 0–1 vì cách viết ban đầu `<5` không phù hợp.

**Kết quả:** requirements đi từ chức năng extraction tổng quát sang các ngoại lệ và điều kiện cho phép dùng dữ liệu.

### P03 — Chốt ngưỡng confidence và quy tắc xử lý ngoại lệ

**Người dùng:** chốt `<0.5`; áp dụng các gợi ý phân tách; không chuẩn hóa thiếu căn cứ; giữ chuỗi gốc và ảnh tiền; currency không rõ và flag ngoài chuẩn phải giảm confidence. Bất kỳ confidence thành phần dưới 0.5 phải làm confidence tổng dưới 0.5. Yêu cầu định nghĩa thang điểm.

**AI:** đề xuất dải confidence, màu, tổng hợp bằng min, review độc lập với confidence và tách điểm AI ban đầu khỏi điểm sau review.

**Kết quả:** có review gate và ngưỡng rõ. Quy ước effective confidence 1.0 sau xác nhận là đề xuất AI được ghi vào thiết kế, biểu thị đã được người dùng kiểm tra, không phải xác suất AI đúng 100%.

### P04 — Yêu cầu bằng chứng ảnh và đơn vị scan_task

**Người dùng:** yêu cầu lưu ảnh nguồn cho ngày mơ hồ, currency không rõ, flag ngoài chuẩn, chữ viết tay khó, boundaries/patient không rõ, vùng không đọc được; mỗi file tạo một scan_task, quản lý ảnh theo task. Cho phép chọn tên phù hợp.

**AI:** đặt tên `document_scan_task`, liên kết task → N documents → fields → page/crop evidence; phân biệt không đọc được với không có trường để không tạo crop giả.

**Kết quả:** traceability của từng giá trị trở thành yêu cầu thiết kế, không chỉ là metadata bổ sung.

### P05 — Report HTML local, màu confidence và lưu 30 ngày

**Người dùng:** bổ sung link report trong output; nhóm theo document, liệt kê fields/confidence/ảnh; dùng màu confidence, mở local và lưu 30 ngày.

**AI:** đề xuất HTML offline với assets tương đối, report snapshot và vòng đời cleanup. Nêu giới hạn HTML không tự xóa; nếu ứng dụng tắt thì xóa vật lý khi chạy lại.

**Kết quả:** mở rộng đầu ra từ JSON sang báo cáo có thể đối chiếu bằng mắt; TTL report không tự áp lên file gốc/bằng chứng chính.

### P06 — Lưu context và implementation plan

**Người dùng:** yêu cầu tạo `context/project-context.md` ghi yêu cầu gốc, so sánh AI/không AI, giới hạn/quyết định; tạo `plans/first-implement-plan.md`.

**AI:** tạo hai file, tổng hợp các quyết định thành giai đoạn và tiêu chí nghiệm thu. Đưa ra stack ban đầu là đề xuất, chưa phải ràng buộc người dùng.

**Kết quả:** chuyển lịch sử chat thành artifact để triển khai có điểm tham chiếu.

### P07 — Hỏi cách tách context và brainstorm

**Người dùng:** hỏi có nên tách context khỏi brainstorm.

**AI:** đề xuất context giữ yêu cầu/decisions đã chốt; brainstorm giữ phân tích, phương án, giả định và câu hỏi mở; plan giữ thứ tự thực hiện.

**Kết quả:** xác định vai trò và mức độ thẩm quyền khác nhau của từng tài liệu.

### P08 — Thực hiện tách tài liệu, giữ nguyên nội dung đã thống nhất

**Người dùng:** yêu cầu tách `project-context.md` và `brainstorm.md`, cập nhật plan và tham chiếu, giữ đầy đủ nội dung.

**AI:** tạo `context/brainstorm.md`, cập nhật context/plan, đối chiếu các bullet/table cũ và kiểm tra liên kết.

**Kết quả:** bảo toàn yêu cầu khi tái cấu trúc, tránh phương án chưa chốt bị đọc thành yêu cầu chính thức.

### P09 — Đề xuất kiến trúc dùng AI tối thiểu và MCP tools

**Người dùng:** yêu cầu AI đọc tài liệu; việc nào làm bằng MCP được thì tạo tool; đưa ra solution để duyệt.

**AI:** đề xuất backend điều phối cố định, một MCP server local, AI Reader riêng. Phân biệt backend gọi tools trực tiếp với để model chọn tools: MCP tự nó không đảm bảo giảm AI calls. Nêu boundaries, catalog tools, lưu trữ và recovery.

**Kết quả:** tách đọc/hiểu bằng AI khỏi validation, tính tiền, crop, report, review và cleanup bằng code. Các chi tiết transport/SDK vẫn là thiết kế cần thử nghiệm.

### P10 — Người dùng chọn hệ sinh thái Node.js và NestJS

**Người dùng:** thay stack đề xuất bằng Node.js, backend NestJS.

**AI:** chuyển hướng sang TypeScript monorepo, MCP TypeScript SDK, thư viện Node cho schema, PDF/ảnh, tiền và HTML; giữ nguyên trách nhiệm AI/MCP.

**Kết quả:** Node.js/TypeScript và NestJS là quyết định từ người dùng, không phải lựa chọn tự phát của AI.

### P11 — Người dùng chọn MongoDB

**Người dùng:** yêu cầu database MongoDB.

**AI:** đề xuất Mongoose, metadata trong MongoDB, artifacts trên filesystem, decimal.js/Decimal128, revision và cleanup riêng. Làm rõ TTL index không xóa file trên filesystem.

**Kết quả:** MongoDB thay SQLite/Prisma trong phương án trao đổi. Mongoose, transaction/replica set và layout collections là thiết kế AI đề xuất để đáp ứng yêu cầu.

### P12 — Cập nhật plan và lưu kiến trúc để tracking

**Người dùng:** yêu cầu cập nhật plan và tạo `diagrams/architecture.md`.

**AI:** tạo sơ đồ component/scan/review/retention, catalog MCP, lưu trữ, decision log; đồng bộ context/brainstorm/plan sang stack mới.

**Kết quả:** có artifact theo dõi kiến trúc và trạng thái đã chốt/cần spike, chưa tuyên bố hệ thống đã chạy.

### P13 — Tích hợp OpenAI bằng env và thêm healthcheck

**Người dùng:** yêu cầu chỉ cập nhật env là cấu hình được OpenAI; thêm healthcheck vào plan.

**AI:** mô tả env cho key/model/endpoint/timeout/retry/budget, validate startup và restart thay hot reload. Đề xuất live/ready/capability và verify provider chủ động; polling không gọi AI. Cấu hình đúng không được coi là provider đã được kiểm chứng.

**Kết quả:** tách cấu hình khỏi code, phân biệt local health với kết nối provider và tránh chi phí AI do health polling.

### P14 — Mở rộng smoke/integration để cover rủi ro và decisions

**Người dùng:** yêu cầu bộ testcase đa dạng cho smoke/integration, bao phủ các case có risk và decision.

**AI:** tạo `plans/test-strategy.md`, phân biệt infrastructure/components thật với provider fake; lập fixtures, expected results, traceability R/ARCH, failure/recovery/concurrency và suite OpenAI live riêng.

**Kết quả:** kế hoạch kiểm thử có oracle và mapping, không chỉ checklist tên test hoặc tỷ lệ code coverage.

### P15 — Một trang test report và OpenAI thật trên 10 documents

**Người dùng:** yêu cầu report smoke/integration/OpenAI thật trên một page; đổi sáu nhóm live test thành đủ 10 documents.

**AI:** chuyển LIVE-01–10 thành các document độc lập theo cơ cấu 3/3/2/2; giữ preflight/composite/holdout riêng. Thiết kế report theo test_run_id, counts/status, field-level diff, evidence và usage, kể cả khi chỉ chạy một phần.

**Kết quả:** có tiêu chí quan sát kết quả trực quan; không dùng một API call thành công hoặc skipped tests để chứng minh đọc đúng 10 documents.

### P16 — Một trang manual test để upload, xem, approve và sửa

**Người dùng:** yêu cầu trang upload document → xem result → approve/update value → cập nhật trạng thái và final confidence.

**AI:** đặc tả `/manual-test`, field review/correction, final value/confidence tính bởi backend, min cấp document/task, audit/revision và conflict. Đề xuất không cho nhập confidence tùy ý để bypass gate; thêm 8 case browser integration.

**Kết quả:** đóng vòng human review. Manual corrections không được ghi đè kết quả AI ban đầu, ground truth hoặc verdict automated tests.

### P17 — README để người khác có thể tiếp cận và vận hành

**Người dùng:** yêu cầu giới thiệu bài toán/giải pháp/giới hạn, link architecture, deploy, chạy các suites, xem report và manual test.

**AI:** tạo `readme.md`, ghi env/commands/routes dự kiến và trạng thái chưa có implementation; đồng bộ script names và TEST_RUN_ID trong plan/test strategy.

**Kết quả:** có entrypoint cho người đánh giá, không trình bày commands hoặc report links dự kiến như đã chạy được.

### P18 — Audit lại tài liệu với đề gốc

**Người dùng:** yêu cầu đối chiếu toàn bộ tài liệu với link requirement ban đầu.

**AI:** đọc lại nguồn gốc, kiểm tra tài liệu/artifacts, chỉ ra nội dung đã cover, các khác biệt có chủ đích và chi tiết chưa khóa: schema mapping, công thức lệch 5%, flag ngoài chuẩn, acceptance trước manual correction. Xác nhận chưa có code/fixtures/test evidence; không sửa tài liệu trong lượt audit.

**Kết quả:** có bước kiểm tra scope drift sau nhiều yêu cầu mở rộng, thay vì coi lượng tài liệu nhiều là bằng chứng hoàn thành challenge.

### P19 — Làm rõ coverage của plan khác trạng thái hoàn thành

**Người dùng:** hỏi lại plan đã có hạng mục cho tất cả specs ban đầu chưa.

**AI:** xác nhận có coverage ở mức kế hoạch; phân biệt với việc chi tiết contract đã khóa và implementation đã đạt. Giữ các điểm cần hoàn thiện từ audit, không tuyên bố requirement đã được chứng minh bằng runtime.

**Kết quả:** thống nhất cách hiểu: có kế hoạch cho mọi nhóm yêu cầu, chưa đồng nghĩa sẵn sàng nộp bài hoặc mọi chi tiết đã được quyết định.

### P20 — Lưu prompt brief để đánh giá quá trình làm việc với AI

**Người dùng:** yêu cầu file `prompt-brief.md` ở root để tóm tắt prompt trong brainstorm/planning cho bài test AI engineering.

**AI:** tạo tài liệu này, theo dõi nguồn quyết định, các vòng làm rõ/correction, artifacts và giới hạn bằng chứng.

**Kết quả:** lịch sử làm việc có thể được đọc cùng các tài liệu yêu cầu/kiến trúc/plan, nhưng không thay thế transcript đầy đủ.

### P21 — Execute plan và kiểm chứng implementation

**Người dùng:** yêu cầu execute plan. Khi AI hỏi về cấu hình OpenAI thật, người dùng chọn tự cấu hình và chạy sau; không gửi API key trong chat.

**AI:** triển khai NestJS/MCP/MongoDB, contracts, validation, UI review, HTML/retention, adapter env, fixtures và runners. Dùng Docker replica set, SDK HTTP fake và Chromium thật để kiểm tra; sửa lỗi mà tests phát hiện, giữ lịch sử attempts. Chuyển README từ lệnh dự kiến sang cách chạy thực tế và ghi rõ giới hạn.

**Bằng chứng local:** 25 unit tests PASS; run acceptance-20261019 có 12 smoke + 73 integration PASS, 10 live SKIPPED; manual browser flow và Docker Linux upload/report PASS. Mẫu/ground truth synthetic chưa được người kiểm tra độc lập xác nhận; không tuyên bố OpenAI đọc đúng 10 tài liệu hoặc production ready.

**Artifact/trạng thái:** [implementation-status](plans/implementation-status.md), source code, package/lock/env example, compose/Dockerfile, tests và [report offline](outputs/acceptance-report/index.html). Các phần ghi “chưa có implementation” ở P01–20 là snapshot lịch sử planning, không mô tả trạng thái sau P21.

### Các prompt chọn lọc sau implementation (P22–P30)

Phần này gộp các lượt trao đổi cùng mục tiêu và chuẩn hóa cách diễn đạt để dễ đánh giá. Nội dung **không phải trích dẫn nguyên văn**; các yêu cầu khởi động lại, hỏi vị trí file hoặc xác nhận lặp được lược bỏ. Yêu cầu của người dùng, chẩn đoán do AI đưa ra và kết quả kiểm chứng vẫn được phân biệt.

### P22 — Hoàn thiện cấu hình và cách vận hành thực tế

**Ý prompt được biên tập:** chuyển ứng dụng sang port mặc định 4000 để tránh xung đột; làm rõ cách cấu hình OpenAI qua `.env`, áp dụng cấu hình sau khi thay đổi và model đang dùng.

**AI thực hiện:** cập nhật port/URL và hướng dẫn chạy; phân biệt cấu hình hợp lệ với việc gọi provider thành công. Ghi model ứng dụng đang cấu hình là `gpt-6-luna`, không mô tả đó là model được hard-code hoặc tự chọn khi env để trống.

**Kết quả/đối chiếu:** [env example](.env.example), [config](packages/contracts/config.ts), [README](readme.md). Người dùng tự cấu hình credentials trong env; API key không được đưa vào brief.

### P23 — Dùng lỗi provider làm đầu vào cho vòng sửa và kiểm chứng

**Ý prompt được biên tập:** phản ánh lỗi `PROVIDER_HTTP_400` xuất hiện khi manual test để AI điều tra và khắc phục.

**AI thực hiện:** tái hiện bằng dữ liệu tổng hợp, xác định schema bbox không được OpenAI chấp nhận, đổi sang mảng đồng nhất đúng bốn số hoặc null và bổ sung regression tests. Nguyên nhân kỹ thuật và giải pháp là kết quả điều tra của AI, không phải chi tiết người dùng đã chỉ định sẵn.

**Kết quả/đối chiếu:** schema được sửa; một PDF tổng hợp đã đi qua OpenAI thật và tạo result/report. Đây là bằng chứng tích hợp, không chứng minh độ chính xác trên cả bộ tài liệu. Xem [reader schema](packages/contracts/index.ts) và [enhancement plan](plans/post-implementation-enhancement-plan.md).

### P24 — Bổ sung mẫu kiểm thử gần với rủi ro đầu vào

**Ý prompt được biên tập:** tạo bộ manual-test riêng có PDF dạng scan đa dạng, chất lượng thấp và chữ viết tay, thay vì chỉ dùng các PDF text hiện có.

**AI thực hiện:** tạo 14 PDF scan/17 trang, gồm mờ, nhạt, lệch góc, fax, bóng đổ, nhiều ngôn ngữ/tài liệu/bệnh nhân và các tình huống ngày, tiền, flag, mất trường hoặc không rõ ranh giới. Bổ sung catalog, preview, checklist và ZIP; kiểm tra PDF chỉ chứa ảnh.

**Kết quả/đối chiếu:** [manual-test-samples](manual-test-samples/README.md), [catalog](manual-test-samples/index.html). Dữ liệu giả; chữ viết tay được tạo bằng AI. Checklist là căn cứ đối chiếu thủ công, không phải verdict PASS hay ground truth đã được reviewer độc lập xác nhận.

### P25 — Điều tra lỗi MCP từ quá trình dùng scan thực tế

**Ý prompt được biên tập:** phản ánh `MCP_UNAVAILABLE` trong quá trình manual test và yêu cầu khôi phục chức năng.

**AI thực hiện:** kiểm tra crash native, xác định renderer nạp hai phiên bản canvas; đồng bộ dependency, thêm regression cho PDF ảnh và kiểm tra cả bộ scan qua MCP. Tăng thời gian khởi tạo MCP để phù hợp cold start Docker là điều chỉnh kỹ thuật do AI thực hiện.

**Kết quả/đối chiếu:** các task bị gián đoạn đã xử lý tiếp và tạo report; render/MCP regression PASS. Không dùng kết quả render để khẳng định AI đọc đúng scan. Xem [render regression](tests/document-tools.spec.ts), [MCP client](packages/mcp-client/index.ts) và [implementation status](plans/implementation-status.md).

### P26 — Chuẩn hóa deployment và tài liệu vận hành

**Ý prompt được biên tập:** cải tiến Docker Compose để deploy dễ hơn; cấu hình port expose qua env; hướng dẫn OpenAI/env, chạy smoke/integration và lấy kết quả trong README.

**AI thực hiện:** tổ chức runtime/test images, Compose backend/MongoDB và test service, volumes, healthcheck, user dùng chung và env-derived port/URL. Kiểm tra stack riêng, đổi port qua recreate, giữ dữ liệu và phục vụ report. Viết README theo quy trình vận hành thay vì dàn trải nội dung thiết kế.

**Kết quả/đối chiếu:** [Compose](compose.yaml), [Dockerfile](Dockerfile), [README](readme.md), [report kiểm chứng Compose](outputs/compose-operations-check/index.html). Người dùng tiếp tục chốt mọi URL hướng dẫn dùng port mặc định 4000. Kiểm chứng Compose thuộc artifact tại thời điểm chạy; thay đổi sau đó cần được phân biệt với lần build đã kiểm chứng.

### P27 — Kiểm tra lại tài liệu do AI tạo từ góc nhìn người mới

**Ý prompt được biên tập:** chỉ ra link report trong README không mở được; yêu cầu audit và tối ưu tài liệu để người mới dễ làm theo.

**AI thực hiện:** xác nhận đã trình bày run ID ví dụ chưa có report theo cách gây nhầm; sửa hướng dẫn để URL được in theo đúng `TEST_RUN_ID` vừa chạy. Tách report lịch sử khỏi report mới, Docker khỏi cách chạy Node và nội dung nâng cao; kiểm tra link và tên lệnh.

**Kết quả/đối chiếu:** README có luồng chuẩn bị → chạy → OpenAI → upload/review → test/report, bảng thao tác và xử lý lỗi. Vòng này ghi nhận một lỗi trong đầu ra tài liệu của AI được người dùng phát hiện và sửa, không coi nội dung AI viết là đúng mặc định.

### P28 — Làm rõ phạm vi fixture rồi chốt tên phù hợp

**Ý prompt được biên tập:** phân biệt bộ mẫu mock với manual scan trong code; kiểm tra bộ fixture đang phục vụ những loại test nào; chốt tên `mock-samples/` vì bộ này được dùng rộng hơn smoke test.

**AI thực hiện:** cập nhật directory/constants, generator/export scripts, API sample-set metadata, hướng dẫn upload theo mode, Docker và tài liệu. Giữ riêng `manual-test-samples/` cho manual OpenAI; công khai việc 10 fixture text vẫn được dùng làm baseline live regression tự động.

**Kết quả/đối chiếu:** [mock-samples](mock-samples/README.md), [sample-set routing](packages/contracts/sample-sets.ts). Tên hiện hành là `mock-samples/` và `manual-test-samples/`; các tên trung gian chỉ còn ý nghĩa trong lịch sử. Sau lần đổi tên cuối: 34 unit, 12 smoke và 73 integration tests PASS; không tuyên bố Docker đã build lại ở lượt đổi tên đó.

### P29 — Bổ sung JSON để đối chiếu kết quả manual test

**Ý prompt được biên tập:** sau khi xử lý file xong, cần một block in JSON trên trang manual test; đảm bảo người dùng biết các file manual samples nằm ở đâu.

**AI thực hiện:** hiển thị JSON snapshot đầy đủ, có thụt dòng/vùng cuộn; ẩn trong lúc xử lý và cập nhật theo approve, draft, correction hoặc reload. Render bằng textContent. Hướng dẫn bộ mẫu nằm trong README và trên trang upload theo chế độ.

**Kết quả/đối chiếu:** [manual page](public/manual.html); Chromium kiểm tra JSON bằng API snapshot, đồng bộ status/revision/giá trị/confidence sau review và giữ đúng sau reload. Xem [browser report](http://127.0.0.1:4000/test-reports/manual-json-result-20261019/index.html). Xem JSON không bỏ qua export gate.

### P30 — Tổng hợp trạng thái cuối và tiếp tục ghi nhận cách làm việc với AI

**Ý prompt được biên tập:** tổng hợp các update/enhance sau implementation thành một file plan theo nội dung latest; bổ sung có chọn lọc các prompt sau implementation vào prompt brief với cách trình bày chuyên nghiệp.

**AI thực hiện:** đối chiếu code, cấu hình, report và lịch sử; tạo plan phân biệt đã triển khai, đã kiểm chứng và còn chờ nghiệm thu. Bổ sung P22–P30 dưới dạng diễn giải, giữ snapshot P01–P21 và không hồi tố gán quyết định kỹ thuật của AI cho người dùng.

**Kết quả/đối chiếu:** [post-implementation enhancement plan](plans/post-implementation-enhancement-plan.md) và bản cập nhật prompt brief này. Các câu hỏi vận hành lặp được lược bớt; các vòng phát hiện lỗi, sửa tài liệu và điều chỉnh naming được giữ vì thể hiện quá trình kiểm tra và phản hồi.


## 4. Các quyết định thể hiện rõ sự điều hướng của người dùng

| Chủ đề | Người dùng trực tiếp yêu cầu/chốt | Phần AI phân tích hoặc đề xuất thêm |
|---|---|---|
| Dữ liệu đầu vào | Đa ngôn ngữ, một file nhiều loại, có refund/discount/0 | Tách theo tài liệu thực, cùng loại khác bệnh nhân, page/region refs |
| Confidence | `<0.5`, lan điểm thấp lên tổng | Min đệ quy, thang màu, tách extraction/effective/final và review semantics |
| Bằng chứng | Lưu ảnh nguồn theo tình huống, quản lý theo scan_task | Task/document/field IDs, bbox, crop fallback và provenance |
| Chuẩn hóa | Không ép chuyển đổi khi thiếu căn cứ, giữ currency/raw/flag gốc | Metadata normalized/candidate, kiểm tra bằng code và review gate |
| Kiến trúc | AI đọc, MCP cho công việc làm bằng code | Workflow cố định, một local MCP server stdio, service boundaries |
| Stack | Node.js, NestJS, MongoDB | Mongoose, replica set/transaction, Decimal128, thư viện Node và monorepo |
| Tích hợp | OpenAI qua env, healthcheck | Validation/restart, readiness khác provider verification, 0 AI polling |
| Báo cáo | Scan HTML/30 ngày, một page test report | Snapshot/revision, asset isolation, manifest/cleanup và partial-run reporting |
| Kiểm thử | Risk/decision coverage, OpenAI thật trên 10 documents | Risk IDs/ARCH mapping, fixtures, fault injection, deterministic/live split |
| Manual test | Upload/result/approve/edit, trạng thái và final confidence | Backend gate, audit, conflict, giữ immutable extraction và test verdict |
| Tài liệu | Tạo context/plan, tách brainstorm, architecture, README, audit và brief | Cấu trúc tài liệu, liên kết và trạng thái chưa triển khai |
| Vận hành sau implementation | Port 4000, Compose, env/port expose và README vận hành | Runtime/test images, volumes/user, healthcheck, recreate và kiểm chứng stack riêng |
| Fixture và quan sát dữ liệu | Scan đa dạng/chữ viết tay, tách bộ mẫu, chốt tên mock-samples, block JSON | Dataset/checklist, sample-set metadata, JSON snapshot và browser regression |
| Kiểm tra đầu ra AI | Phản ánh lỗi provider/MCP và link report hỏng; yêu cầu audit README | Chẩn đoán nguyên nhân, sửa code/docs, kiểm chứng và giới hạn tuyên bố |

## 5. Điểm có thể quan sát khi đánh giá cách sử dụng AI

Đây là mô tả hành vi trong phiên, không phải chấm điểm người dùng hoặc cam kết chất lượng giải pháp.

- **Khởi đầu bằng hiểu bài toán:** yêu cầu AI phân tích đầu ra, trade-offs và giới hạn trước khi code.
- **Làm rõ bằng các quyết định cụ thể:** bổ sung ngôn ngữ, đa tài liệu, ngày mơ hồ, tiền và cờ xét nghiệm thay vì chỉ yêu cầu AI tự chọn defaults.
- **Yêu cầu phản biện:** chủ động hỏi còn rủi ro nào sau vòng clarification, sau đó bổ sung ảnh nguồn và gate để xử lý rủi ro.
- **Sửa và giới hạn đề xuất AI:** điều chỉnh ngưỡng sang 0.5, thay stack sang Node/NestJS/MongoDB, tăng live test từ nhóm scenario thành 10 documents.
- **Kiểm soát AI scope:** định hướng AI chỉ đọc tài liệu, chuyển việc xác định được sang MCP/code; yêu cầu health/config và kiểm thử để kiểm soát vận hành.
- **Tạo khả năng kiểm chứng:** yêu cầu testcases theo risks/decisions, test report trực quan và trang manual review.
- **Quản lý artifact và scope drift:** tách context khỏi brainstorm, lưu architecture/plan và quay lại audit theo nguồn ban đầu.
- **Làm rõ mức độ hoàn thành:** hỏi riêng coverage của plan thay vì đồng nhất với việc đã triển khai hoặc đã PASS tests.
- **Phản hồi dựa trên sử dụng thực tế:** cung cấp lỗi provider/MCP, yêu cầu mẫu scan khó và dữ liệu JSON để đối chiếu kết quả.
- **Kiểm tra tài liệu và naming:** phát hiện report URL không hợp lệ; hỏi lại phạm vi sử dụng fixture rồi chốt tên phù hợp; yêu cầu tài liệu dễ tiếp cận cho người mới.
- **Duy trì traceability sau triển khai:** yêu cầu plan latest và cập nhật prompt brief, thay vì để các thay đổi chỉ tồn tại trong chat.

## 6. Artifact hiện có để người đánh giá đối chiếu

| Artifact | Vai trò và trạng thái |
|---|---|
| [Project context](context/project-context.md) | Yêu cầu gốc, mở rộng và các quy tắc nghiệp vụ |
| [Brainstorm](context/brainstorm.md) | Phân tích AI/không AI, risks, lựa chọn và điểm mở |
| [Implementation plan](plans/first-implement-plan.md) | Giai đoạn, env/health, review, deploy/test/report dự kiến |
| [Architecture](diagrams/architecture.md) | Sơ đồ, AI/MCP boundaries, persistence, tools và decision tracking |
| [Test strategy](plans/test-strategy.md) | 95 testcase IDs: 12 smoke, 73 integration, 10 live documents; tại P20 chưa có code/kết quả, trạng thái mới xem enhancement plan |
| [README](readme.md) | Hướng dẫn vận hành hiện hành: Docker/env/OpenAI, manual test, smoke/integration và lấy report |
| [Post-implementation enhancement plan](plans/post-implementation-enhancement-plan.md) | Trạng thái cuối của các cập nhật, bằng chứng và phần còn chờ nghiệm thu |
| [Mock samples](mock-samples/README.md) / [manual samples](manual-test-samples/README.md) | Hai bộ fixture có mục đích riêng; không tự đại diện cho benchmark accuracy |
| [Implementation status](plans/implementation-status.md) | Lịch sử triển khai, lỗi, kết quả kiểm chứng và giới hạn |
| [Prompt brief](prompt-brief.md) | Tóm tắt lịch sử prompt và nguồn quyết định của phiên này |

Audit ở P18–P19 được trả trong chat, chưa có file audit riêng. Tài liệu trong `work/` là scratch/snapshot hỗ trợ chỉnh sửa, không phải deliverables hoặc bằng chứng test đã chạy.

## 7. Giới hạn tại thời điểm P20 và việc tiếp tục cần làm

- Chưa có code, build/deploy, 10 tài liệu mẫu thực tế, kết quả extraction hoặc report test thực. Các lệnh và URL trong README vẫn là dự kiến.
- Coverage requirement ở mức plan đã được xác nhận; schema JSON mở rộng/mapping `value` và confidence, công thức mismatch 5% và biểu diễn flag ngoài chuẩn còn cần khóa theo audit. Việc tạo brief không tự giải quyết các điểm này.
- Quy tắc cho phép số 0/hoàn tiền là thay đổi người dùng đã chốt so với yêu cầu số tiền dương của đề. Tiền dùng chuỗi thập phân trong JSON là phương án kỹ thuật được AI đề xuất để bảo toàn độ chính xác, khác ví dụ số JSON trong đề; cần công bố rõ contract.
- Không đồng nhất prompt tạo kế hoạch với prompt runtime dùng để trích xuất. **File này chưa thay thế writeup prompt engineering cho AI Reader** mà đề yêu cầu: sau implementation cần lưu prompt/schema thực, phiên bản, ví dụ, thử nghiệm, lỗi và cách sửa, cùng trade-off chi phí/chất lượng.
- Chưa có căn cứ chấm khả năng coding, độ chính xác model hoặc hiệu quả tiết kiệm AI của kiến trúc. Cần kiểm thử components thật, OpenAI thật và dữ liệu holdout.
- Khi tiếp tục, bổ sung ID lượt trao đổi mới theo cùng cấu trúc: mục tiêu prompt → phản hồi AI → quyết định người dùng → artifact thay đổi → bằng chứng. Không hồi tố đánh dấu một đề xuất chưa duyệt là quyết định đã được người dùng chốt.


## 8. Trạng thái hiện hành sau các vòng cải tiến

Mục 7 giữ snapshot trước implementation tại P20; không được dùng các phát biểu “chưa có code/test” ở đó để mô tả trạng thái hiện tại. Các số test theo từng đợt không được cộng thành một lần chạy duy nhất hoặc coi browser cases trùng ID là coverage mới độc lập.

- Code hiện có backend/MCP/MongoDB, OpenAI reader, review/export gate, Docker, report và manual UI có JSON. Tên bộ mẫu cuối là `mock-samples/` và `manual-test-samples/`.
- Sau đổi tên fixture cuối: 34 unit tests, 12 smoke và 73 integration tests PASS. Hai browser cases cho JSON cũng PASS ở đợt riêng; chúng dùng ID có trong catalog integration.
- OpenAI thật đã xử lý được PDF tổng hợp và tạo report, nhưng **chưa nghiệm thu đầy đủ 10 live documents**, chưa benchmark extraction trên toàn bộ 14 manual scan hoặc holdout chữ viết tay thực.
- Compose operations đã được kiểm chứng ở đợt riêng. Full Docker build gần nhất nằm trước lần đổi tên cuối sang `mock-samples/` và bổ sung JSON; cần rebuild/revalidate artifact cuối như enhancement plan ghi nhận.
- Đây là tóm tắt các yêu cầu và phản hồi đã xảy ra, không phải transcript đầy đủ, hồ sơ chi phí/token hoặc chứng nhận khả năng AI. Prompt runtime và writeup kỹ thuật xem [prompt engineering](prompts/prompt-engineering.md).
