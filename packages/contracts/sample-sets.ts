// Text fixtures belong to mock/automated regression; image-only scans belong to manual AI testing.
export const MOCK_SAMPLE_DIR = 'mock-samples';
export const MANUAL_TEST_SAMPLE_DIR = 'manual-test-samples';
export function sampleSetForMode(mode: 'mock' | 'openai' | 'disabled') {
  if (mode === 'mock')
    return {
      directory: MOCK_SAMPLE_DIR,
      accept: '.pdf',
      description:
        'Chế độ mock: chọn PDF có lớp text trong mock-samples/. Bộ này dùng để thử luồng ứng dụng, không đọc scan hoặc chữ viết tay.',
    };
  if (mode === 'openai')
    return {
      directory: MANUAL_TEST_SAMPLE_DIR,
      accept: '.pdf,.png,.jpg,.jpeg',
      description:
        'Chế độ OpenAI: dùng manual-test-samples/ để thử PDF scan, ảnh mờ, chữ viết tay và nhiều loại tài liệu. Bạn cũng có thể upload tài liệu của mình. Có thể phát sinh chi phí API.',
    };
  return null;
}
