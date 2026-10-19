# Mock samples

10 PDF có lớp text và nhãn cố định cho mock reader, smoke/integration tests. Để thử mock trên trang manual-test, chọn PDF trong thư mục này. Không phải scan/OCR, không dùng bộ này để đánh giá chất lượng đọc scan/chữ viết tay.

Bộ scan cho manual test bằng OpenAI nằm tại [manual-test-samples](../manual-test-samples/README.md).

- `npm run mock-samples:generate`: tạo PDF, truth JSON và manifest. Có thể ghi đè fixtures, chỉ chạy khi cần tái tạo.
- `npm run mock-samples:extract:mock`: upload 10 PDF vào backend đang chạy chế độ mock, lưu JSON vào extraction-results/mock/.
- `.truth.json`: kết quả kỳ vọng cho test tự động, không upload lên trang manual test.

Bộ live test tự động cũ vẫn dùng 10 PDF này làm baseline để so sánh với truth JSON. Đây là regression test trên fixture có lớp text; manual test chất lượng scan dùng manual-test-samples riêng. Không coi kết quả baseline là benchmark chất lượng scan thực tế.
