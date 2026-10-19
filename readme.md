# Medical Document Extractor

Upload tài liệu y tế PDF/ảnh → xem dữ liệu trích xuất và ảnh nguồn → kiểm tra, sửa và xác nhận kết quả.

Hướng dẫn dưới đây dùng **Docker Compose** và port mặc định **4000**. Không cần cài Node.js để chạy theo cách này.

## 1. Chuẩn bị

- Cài và mở Docker Desktop, hoặc dùng Docker Engine với Docker Compose v2.
- Mở terminal tại thư mục project chứa `compose.yaml` và `package.json`.
- Đảm bảo port **4000** (ứng dụng) và **27019** (MongoDB) chưa bị chương trình khác sử dụng. Nếu backend Node của project đang chạy trong terminal khác, nhấn `Ctrl+C` tại terminal đó để dừng.

Tạo file cấu hình cho lần đầu:

```bash
cp .env.example .env
```

**Nếu đã có `.env`, giữ file hiện tại**, không copy đè vì có thể mất API key đã cấu hình.

## 2. Chạy ứng dụng

```bash
docker compose up -d --build --wait
docker compose ps
```

Lần đầu cần tải image và cài dependencies nên sẽ lâu hơn những lần sau. Thành công khi hai service `backend` và `mongodb` đều hiển thị `healthy`.

Mở **[trang upload và kiểm tra kết quả](http://127.0.0.1:4000/manual-test)**.

File cấu hình mẫu dùng `AI_MODE=mock`, cho phép thử luồng ứng dụng mà không gọi OpenAI. Upload [PDF text mẫu](mock-samples/DOC-REC-01.pdf) để thử. Để đọc scan, ảnh hoặc chữ viết tay, cấu hình OpenAI ở bước tiếp theo.

## 3. Kết nối OpenAI

Sửa các dòng sau trong `.env`; thay phần `<...>` bằng thông tin của bạn:

```dotenv
AI_MODE=openai
OPENAI_API_KEY=<API key của bạn>
OPENAI_MODEL=<model có quyền truy cập, hỗ trợ ảnh và Structured Outputs>
OPENAI_BASE_URL=https://api.openai.com/v1
```

Model đang được cấu hình và đã dùng để kiểm tra kết nối trong workspace này là **`gpt-6-luna`**. Bạn có thể đặt `OPENAI_MODEL=gpt-6-luna` nếu tài khoản có quyền truy cập. `.env.example` để trống model; ứng dụng không tự chọn model khi chưa cấu hình.

Giữ `APP_PORT=4000`. Không commit API key hoặc đưa key vào report.

Áp dụng cấu hình mới:

```bash
docker compose up -d --force-recreate --wait backend
```

Tải lại trang manual test trước khi upload. **Đổi `.env` cần recreate; `docker compose restart` không nạp cấu hình mới.** Không cần build lại chỉ để đổi key/model.

Healthcheck chỉ kiểm tra ứng dụng và cấu hình, không gọi OpenAI. Một task đọc thành công qua chế độ `openai` mới xác nhận được kết nối provider hoạt động; thao tác này có thể phát sinh chi phí API.

## 4. Thử upload và xác nhận kết quả

1. Mở [Manual test](http://127.0.0.1:4000/manual-test), chọn PDF/PNG/JPEG và upload.
2. Chờ xử lý, xem bảng field theo từng tài liệu, giá trị, điểm AI, trạng thái review và panel ảnh nguồn. Block **JSON kết quả** hiển thị đầy đủ dữ liệu của task và tự cập nhật sau khi lưu nháp, sửa hoặc approve.
3. Chỉ field **Cần xác nhận** mới có nút **Xác nhận**. Field **Không bắt buộc** không cần approve thêm. Muốn sửa, chọn **Sửa**; với field không bắt buộc hoặc đã duyệt, **Lưu nháp** trước rồi **Xác nhận sửa** kèm căn cứ. Lưu nháp mở lại review và giữ chặn export.
4. Cột **Sau kiểm tra** hiển thị `—` khi chưa được người xác nhận, khác với điểm AI. Những trường cần kiểm tra vẫn giữ trạng thái chờ review. Chỉ export khi hệ thống cho phép; approve của người kiểm tra được lưu riêng với confidence AI ban đầu.

Chọn mẫu theo chế độ đang chạy:

| Bộ mẫu | Dùng để làm gì | Chế độ |
|---|---|---|
| [`mock-samples/`](mock-samples/README.md) | 10 PDF có lớp text, thử luồng cơ bản | `mock` |
| [`manual-test-samples/`](manual-test-samples/README.md) | 14 PDF scan: mờ, lệch, chữ viết tay, nhiều ngôn ngữ/tài liệu | `openai` |

Mở [catalog scan có preview và checklist](manual-test-samples/index.html) để chọn tình huống. Upload **file PDF**, không upload `.truth.json` hoặc file checklist. Toàn bộ là dữ liệu giả; chữ viết tay trong bộ scan được tạo bằng AI.

## 5. Chạy smoke test và integration test

Giữ Docker đang chạy. Hai bộ test này **không gọi OpenAI thật**, không cần API key: smoke kiểm tra luồng chính; integration kiểm tra các thành phần và tình huống lỗi/quy tắc dữ liệu.

Chạy lần lượt trong **cùng một terminal**. Lệnh đầu tự tạo mã đợt test (`TEST_RUN_ID`) theo thời gian; hai suite dùng chung mã để gộp kết quả:

```bash
export TEST_RUN_ID=check-$(date +%Y%m%d-%H%M%S)
docker compose --profile test build tests
docker compose run --rm tests npm run test:smoke
docker compose run --rm tests npm run test:integration
```

Đọc phần tổng kết sau mỗi lệnh: `failures: 0` nghĩa là suite không có case FAIL; lệnh trả exit code khác 0 khi có lỗi. Nếu smoke fail, vẫn có thể chạy integration để thu đủ kết quả. Test tạo database riêng và xóa sau khi chạy, giữ lại report.

### Xem kết quả vừa chạy

Trong cùng terminal, in link của **đúng đợt test vừa chạy**:

```bash
echo "http://127.0.0.1:4000/test-reports/$TEST_RUN_ID/index.html"
```

Mở URL được in ra. Backend phải đang chạy. **URL chỉ có report sau khi test đã tạo kết quả**; không dùng một run ID bất kỳ. Runner cũng in `test_report_url` khi hoàn tất.

Report tổng hợp smoke/integration trên một trang. `PASS`/`FAIL` là kết quả đã chạy; `NOT_RUN` là chưa chạy, không phải PASS. Các case OpenAI thật chưa chạy vẫn có thể hiển thị `NOT_RUN`; smoke/integration không đánh giá độ chính xác AI.

### Lấy report về máy để xem offline

```bash
mkdir -p outputs
docker compose cp "backend:/app/runtime/test-reports/$TEST_RUN_ID" ./outputs/
echo "outputs/$TEST_RUN_ID/index.html"
```

Mở file HTML theo đường dẫn vừa in. Cùng thư mục có `results.json` chứa chi tiết. HTML/ảnh report trong runtime giữ 30 ngày; bản copy ra `outputs/` cần tự quản lý thời gian lưu.

**Report kiểm chứng có sẵn trong project:** [12 smoke + 73 integration PASS](outputs/compose-operations-check/index.html). Đây là kết quả lịch sử, không phải đợt bạn vừa chạy; Docker volume mới không tự có report lịch sử này.

## 6. Các thao tác thường dùng

| Nhu cầu | Lệnh |
|---|---|
| Xem trạng thái | `docker compose ps` |
| Xem log | `docker compose logs --tail=100 -f backend mongodb` |
| Áp dụng `.env` mới | `docker compose up -d --force-recreate --wait backend` |
| Áp dụng code mới | `docker compose up -d --build --wait backend` |
| Restart, giữ cấu hình hiện tại | `docker compose restart backend mongodb` |
| Dừng, giữ dữ liệu | `docker compose down` |
| Chạy lại sau khi dừng | `docker compose up -d --wait` |

`Ctrl+C` khi xem log chỉ thoát chế độ theo dõi log. Database và file/report được giữ trong Docker volumes `mongo-data` và `app-data`. **Không thêm `-v` vào lệnh `down` nếu muốn giữ dữ liệu.**

### Khi gặp lỗi

| Hiện tượng | Kiểm tra / xử lý |
|---|---|
| Không mở được trang | Chạy `docker compose ps`, rồi xem log nếu service chưa `healthy`. |
| Báo port đã được sử dụng | Dừng chương trình đang chiếm port; chỉ chạy một backend trên port 4000. |
| Scan/ảnh không có kết quả trong mock | Đặt `AI_MODE=openai`, điền key/model, recreate backend và tải lại trang. |
| Đổi `.env` nhưng chưa có tác dụng | Dùng lệnh recreate ở bảng trên, thay vì chỉ restart. |
| `MCP_UNAVAILABLE` | Kiểm tra trạng thái MongoDB và log backend; build/chạy lại backend nếu đang dùng image cũ. |
| Link report không mở được | Dùng `test_report_url` của đợt đã chạy, kiểm tra đúng backend/storage và report chưa hết hạn. |
| Bị từ chối thao tác sau restart | Tải lại trang để nhận phiên thao tác mới. |

[Health](http://127.0.0.1:4000/health) trả thông tin MongoDB/storage; [liveness](http://127.0.0.1:4000/health/live) kiểm tra tiến trình. Trong mock mode, `/health` có thể trả HTTP 503 vì chưa bật đọc bằng OpenAI, trong khi container vẫn healthy và luồng mock/review hoạt động.

### Format code khi phát triển

Sau `npm ci`, chạy `npm run format` để format code bằng Prettier hoặc `npm run format:check` để kiểm tra mà không sửa file. CI chạy bước kiểm tra này trước bộ test. Cấu hình nằm trong `.prettierrc.json`; `.prettierignore` loại trừ dữ liệu runtime, fixtures, tài liệu và file cấu hình bí mật.

## 7. Cấu hình bổ sung và cách chạy khác

<details>
<summary>Đổi port và giới hạn xử lý</summary>

- `APP_PORT=4000` điều khiển cả port public và port backend trong container. Nếu đổi, recreate backend và thay port trong các URL hướng dẫn tương ứng.
- Mặc định `APP_URL` tự suy ra từ `APP_PORT`. Nếu `.env` cũ có `APP_URL`, sửa hoặc bỏ dòng đó khi đổi port. Nếu dùng `localhost`, đặt `APP_URL=http://localhost:4000` và truy cập nhất quán bằng URL này.
- `MONGODB_EXPOSE_PORT=27019` là port MongoDB trên host. Khi đổi port này, áp dụng lại Compose; nếu chạy Node trên host, sửa cả `MONGODB_URI` và `TEST_MONGODB_URI` tương ứng.
- Các tùy chọn OpenAI, giới hạn số trang/dung lượng, timeout và reviewer có trong [.env.example](.env.example).
- Compose tự đặt đường dẫn runtime và URI MongoDB nội bộ; không cần sửa hai giá trị này để chạy Docker.

</details>

<details>
<summary>Chạy Node.js trên host thay cho backend Docker</summary>

Cần Node.js ≥22.13 và npm; đã tạo `.env` ở bước 1. Đặt `STORAGE_ROOT=./runtime` và `MONGODB_URI` cho host như `.env.example`. Dùng một cách chạy backend tại một thời điểm:

```bash
docker compose stop backend
docker compose up -d --wait mongodb
npm ci
npm run build
npm run start:prod
```

Mở `http://127.0.0.1:4000/manual-test`. Sau khi sửa `.env`, dừng backend bằng `Ctrl+C` rồi chạy lại `npm run start:prod`; không cần build chỉ để đổi env.

Chạy test trong terminal khác:

```bash
export TEST_RUN_ID=host-$(date +%Y%m%d-%H%M%S)
npm run test:smoke
npm run test:integration
echo "http://127.0.0.1:4000/test-reports/$TEST_RUN_ID/index.html"
```

Report ở `runtime/test-reports/<TEST_RUN_ID>/index.html`. MongoDB test mặc định dùng `127.0.0.1:27019`; có thể cấu hình `TEST_MONGODB_URI` với tên DB placeholder `DB`, runner sẽ thay bằng DB test riêng.

Dữ liệu/report của cách chạy host và Docker nằm ở hai nơi riêng, **không tự chuyển qua lại**. Muốn mở report qua URL, backend phải dùng đúng storage đã tạo report; cũng có thể mở HTML offline.

</details>

## Tài liệu tham chiếu

- [Plan tổng hợp cập nhật sau implementation](plans/post-implementation-enhancement-plan.md), [review table và bằng chứng triển khai](plans/manual-review-table-plan.md).

- [Kiến trúc](diagrams/architecture.md), [yêu cầu và quyết định](context/project-context.md), [output contract](context/output-contract.md).
- [Test strategy / OpenAI live tests](plans/test-strategy.md), [trạng thái triển khai và giới hạn](plans/implementation-status.md).

Ứng dụng hiện dành cho vận hành local, chưa có đăng nhập/phân quyền đa người dùng; mặc định chỉ truy cập từ máy đang chạy ứng dụng.
