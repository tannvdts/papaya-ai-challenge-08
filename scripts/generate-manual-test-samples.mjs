import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { join, resolve } from 'node:path';
const root = resolve('manual-test-samples');
if (existsSync(join(root, 'manifest.json')))
  throw Error(
    'Existing samples found. Preserve them; choose a new directory/version before regenerating.',
  );
await mkdir(join(root, 'previews'), { recursive: true });
await mkdir(join(root, 'expected'), { recursive: true });
const font = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].find(existsSync);
if (font) GlobalFonts.registerFromPath(font, 'FixtureUnicode');
const W = 1240,
  H = 1754;
function page(
  title,
  subtitle,
  rows,
  {
    patient = 'Demo Patient A01',
    hospital = 'LOTUS DEMO CLINIC',
    date = '23/04/2026',
    note = '',
  } = {},
) {
  const c = createCanvas(W, H),
    x = c.getContext('2d');
  x.fillStyle = '#fcfbf7';
  x.fillRect(0, 0, W, H);
  const text = (s, y, size = 25, color = '#202936') => {
    x.fillStyle = color;
    x.font = `${size}px FixtureUnicode, Arial`;
    x.fillText(s, 85, y);
  };
  text('SYNTHETIC TEST ONLY - NOT FOR MEDICAL USE', 65, 19, '#777');
  text(hospital, 135, 36);
  text(title, 205, 34);
  text(subtitle, 250, 20, '#666');
  x.strokeStyle = '#9aabb5';
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(85, 280);
  x.lineTo(1150, 280);
  x.stroke();
  text('Patient / Bệnh nhân: ' + patient, 330);
  text('Date / Ngày: ' + date, 375);
  let y = 450;
  for (const r of rows) {
    if (Array.isArray(r)) {
      x.fillStyle = '#eef0ed';
      x.fillRect(75, y - 28, 1080, 48);
      r.forEach((t, i) => {
        x.fillStyle = '#222';
        x.font = '22px FixtureUnicode, Arial';
        x.fillText(t, 85 + i * (1030 / r.length), y);
      });
    } else text(r, y, 24);
    y += 65;
  }
  if (note) {
    text(note, 1530, 21, '#555');
  }
  text('Fictional data. This document is for software testing only.', 1660, 20, '#777');
  return c.toBuffer('image/png');
}
function receipt(opts = {}) {
  return page(
    'RECEIPT / HÓA ĐƠN',
    'Reference: DEMO-REC-001',
    [
      ['Service', 'Qty', 'Unit price', 'Line total'],
      ['Consultation', '1', '100.00', '100.00'],
      ['Lab panel', '1', '50.00', '50.00'],
      ['Follow-up', '1', '0.00', '0.00'],
      'Subtotal: 150.00',
      'Tax: 15.00',
      'Discount: 10.00',
      'Refund: 5.00',
      'Grand total: ' + (opts.total ?? '150.00'),
      'Currency: ' + (opts.currency ?? 'USD'),
      'Payment method: Card',
    ],
    opts,
  );
}
const lab = (opts = {}) =>
  page(
    'LABORATORY REPORT',
    'Specimen: DEMO-SAMPLE-001',
    [
      ['Test', 'Result', 'Unit', 'Reference', 'Flag'],
      ['Glucose', '110', 'mg/dL', '70 - 100', opts.flag ?? 'HH'],
      ['Sodium', '140', 'mmol/L', '135 - 145', opts.missing ? '' : 'normal'],
      ['Potassium', '3.2', 'mmol/L', '3.5 - 5.1', 'L'],
      'Flag values above are copied from the instrument output.',
    ],
    { hospital: 'LOTUS DEMO LABORATORY', ...opts },
  );
const discharge = (n = 1) =>
  page(
    'DISCHARGE SUMMARY / GIẤY RA VIỆN',
    `Reference: DEMO-DIS-001 - page ${n} of 2`,
    n === 1
      ? [
          'Admission date: 23/04/2026',
          'Discharge date: 25/04/2026',
          'Primary diagnosis: Viêm họng / Pharyngitis',
          'Secondary diagnosis: None documented',
          'Procedures performed: Examination',
        ]
      : [
          'Attending physician: Dr. Demo',
          'Discharge instructions: Nghỉ ngơi, theo dõi theo hướng dẫn.',
          'Follow the fictional printed care instructions.',
          'No medication instructions in this test fixture.',
        ],
    { patient: 'Demo Patient D01', date: '25/04/2026' },
  );
const rx = () =>
  page(
    'PRESCRIPTION / ORDONNANCE',
    'Fictional medicine names - not treatment guidance',
    [
      'Doctor: Dr. Demo',
      'Médicament: Demo medicine A (fictional)',
      'Dose: 1 unit',
      'Fréquence: une fois par jour',
      'Durée: 3 jours',
      'Quantité: 3',
    ],
    { patient: 'Demo Patient P01' },
  );
async function degrade(buf, kind) {
  let img = sharp(buf);
  if (kind === 'skew')
    return img.rotate(4, { background: '#d8d5cd' }).jpeg({ quality: 48 }).toBuffer();
  if (kind === 'low-contrast')
    return img
      .resize(780)
      .grayscale()
      .linear(0.28, 160)
      .blur(0.65)
      .jpeg({ quality: 32 })
      .toBuffer();
  if (kind === 'fax')
    return sharp(await img.resize(620).grayscale().threshold(170).png().toBuffer())
      .resize(W, H, { kernel: 'nearest' })
      .png()
      .toBuffer();
  if (kind === 'blur')
    return sharp(await img.resize(90).blur(1.5).png().toBuffer())
      .resize(W, H)
      .jpeg({ quality: 12 })
      .toBuffer();
  if (kind === 'photo') {
    const raw = await img.removeAlpha().raw().toBuffer();
    let seed = 12345;
    for (let y = 0; y < H; y++)
      for (let xx = 0; xx < W; xx++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = (seed % 17) - 8;
        const shade = 0.62 + (0.33 * xx) / W;
        for (let k = 0; k < 3; k++) {
          const i = (y * W + xx) * 3 + k;
          raw[i] = Math.max(0, Math.min(255, raw[i] * shade + noise));
        }
      }
    return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .rotate(-3, { background: '#aaa69d' })
      .jpeg({ quality: 38 })
      .toBuffer();
  }
  return img.png().toBuffer();
}
const samples = [];
async function emit(id, title, pages, types, risks, expected) {
  const filename = id + '.pdf',
    pdf = new PDFDocument({
      autoFirstPage: false,
      info: { Title: id + ' - synthetic scanned fixture' },
    }),
    stream = createWriteStream(join(root, filename));
  pdf.pipe(stream);
  for (const image of pages) {
    pdf.addPage({ size: 'A4', margin: 0 });
    pdf.image(image, 0, 0, { fit: [595.28, 841.89], align: 'center', valign: 'center' });
  }
  pdf.end();
  await finished(stream);
  await sharp(pages[0])
    .resize({ width: 310 })
    .png()
    .toFile(join(root, 'previews', id + '.png'));
  const entry = {
    id,
    title,
    file: filename,
    page_count: pages.length,
    document_types: types,
    risks,
    expected,
    synthetic: true,
    image_only: true,
  };
  samples.push(entry);
  await writeFile(join(root, 'expected', id + '.json'), JSON.stringify(entry, null, 2));
}
const common = {
  dates: 'All extracted dates require explicit human confirmation.',
  gate: 'Any field/classification/segmentation confidence <0.5 must keep aggregate <0.5 and block downstream use until review.',
  evidence: 'Evidence must point to the uploaded scan, grouped by document.',
};
await emit(
  'MT-01-clean-receipt',
  'Baseline: hóa đơn rõ, thuế/giảm giá/hoàn tiền/dòng 0',
  [receipt()],
  ['receipt'],
  ['date review', 'tax/discount/refund/zero'],
  {
    document_count: 1,
    patient: 'Demo Patient A01',
    currency: 'USD',
    grand_total: '150.00',
    tax: '15.00',
    discount: '10.00',
    refund: '5.00',
    zero_line: true,
    arithmetic: '100+50+0+15-10-5=150',
  },
);
await emit(
  'MT-02-faded-vietnamese',
  'Scan nhạt, tiếng Việt, ngày mơ hồ',
  [
    await degrade(
      receipt({
        hospital: 'PHÒNG KHÁM DEMO HOA SEN',
        patient: 'Nguyễn An Demo',
        date: '03/04/2026',
      }),
      'low-contrast',
    ),
  ],
  ['receipt'],
  ['Vietnamese', 'low contrast', 'ambiguous date'],
  {
    date: {
      raw: '03/04/2026',
      normalized: null,
      confidence_below: 0.5,
      review: true,
      source_image: true,
    },
    patient: 'Nguyễn An Demo',
  },
);
await emit(
  'MT-03-european-money',
  'Tiếng Pháp, định dạng tiền khác chuẩn',
  [
    await degrade(
      page(
        'REÇU MÉDICAL',
        'Document fictif / démonstration',
        [
          ['Prestation', 'Quantité', 'Prix', 'Total'],
          ['Consultation', '1', '1.234,56', '1.234,56'],
          'Total payé: 1.234,56',
          'Devise / Currency: EUR',
          'Paiement: carte',
        ],
        { patient: 'Demo Patient F01' },
      ),
      'photo',
    ),
  ],
  ['receipt'],
  ['French', 'shadow', 'European separators'],
  {
    currency: 'EUR',
    grand_total_raw: '1.234,56',
    review: true,
    no_silent_conversion: true,
    decision:
      'Preserve raw and source crop. Current parser may leave normalized value null; reviewer confirms decimal interpretation.',
  },
);
await emit(
  'MT-04-unknown-currency',
  'Ký hiệu $ không xác định đơn vị tiền',
  [receipt({ currency: '$', date: '23/04/2026' })],
  ['receipt'],
  ['unknown currency'],
  {
    currency: { raw: '$', confidence_below: 0.5, review: true, source_image: true },
    no_currency_guess: true,
  },
);
await emit(
  'MT-05-skewed-lab-flags',
  'Xét nghiệm lệch góc, cờ HH và L',
  [await degrade(lab(), 'skew')],
  ['lab_report'],
  ['rotation', 'noncanonical flags'],
  {
    flags: ['HH', 'normal', 'L'],
    noncanonical_flags: {
      canonical: null,
      retain_raw: true,
      confidence_below: 0.5,
      source_image: true,
      review: true,
    },
    never_infer_from_reference_range: true,
  },
);
await emit(
  'MT-06-fax-missing-flag',
  'Bản fax, thiếu cờ sodium',
  [await degrade(lab({ missing: true, flag: 'high' }), 'fax')],
  ['lab_report'],
  ['fax', 'missing field'],
  { sodium_flag: null, missing_flag_confidence_below: 0.5, never_infer_normal: true, review: true },
);
await emit(
  'MT-07-discharge-two-pages',
  'Giấy ra viện hai trang, Việt/Anh',
  [discharge(1), await degrade(discharge(2), 'low-contrast')],
  ['discharge_summary'],
  ['page continuity', 'Vietnamese/English'],
  {
    document_count: 1,
    pages: [1, 2],
    patient: 'Demo Patient D01',
    admission_date: '23/04/2026',
    discharge_date: '25/04/2026',
    primary_diagnosis: 'Viêm họng / Pharyngitis',
    preserve_language: true,
  },
);
// Two similar forms with the separator, titles and identities partly occluded: boundary is intentionally uncertain.
const mixed = createCanvas(W, H),
  mx = mixed.getContext('2d');
mx.fillStyle = 'white';
mx.fillRect(0, 0, W, H);
mx.drawImage(await loadImage(receipt({ patient: 'Demo Patient A01' })), 0, 0, W, H / 2);
mx.drawImage(await loadImage(lab({ patient: 'Demo Patient B02' })), 0, H / 2, W, H / 2);
mx.fillStyle = '#eee9df';
mx.fillRect(65, 145, 1080, 40);
mx.fillRect(65, H / 2 + 60, 1080, 130);
mx.fillRect(0, H / 2 - 12, W, 25);
await emit(
  'MT-08-uncertain-boundary-patients',
  'Hai tài liệu trên một trang, che một phần danh tính',
  [await degrade(mixed.toBuffer('image/png'), 'low-contrast')],
  ['receipt', 'lab_report'],
  ['same-page segmentation', 'uncertain patient boundary'],
  {
    intended_document_count: 2,
    intended_patients: ['Demo Patient A01', 'Demo Patient B02'],
    decision:
      'If boundaries or patient identity cannot be established from visible pixels, lower segmentation confidence below 0.5, retain source and require structural review. Never assert the occluded identity from this sidecar.',
    exact_count_not_acceptance_requirement_when_ambiguous: true,
  },
);
await emit(
  'MT-09-mixed-bundle',
  'Một file: hóa đơn + xét nghiệm + đơn thuốc, khác bệnh nhân',
  [receipt({ patient: 'Demo Patient A01' }), lab({ patient: 'Demo Patient B02' }), rx()],
  ['receipt', 'lab_report', 'prescription'],
  ['multiple document types', 'multiple patients'],
  {
    document_count: 3,
    one_scan_task: true,
    patients: ['Demo Patient A01', 'Demo Patient B02', 'Demo Patient P01'],
    never_merge_patients: true,
  },
);
const handwritingPath = join(root, 'assets', 'handwritten-prescription.png');
await access(handwritingPath);
await emit(
  'MT-10-handwritten-prescription',
  'Đơn thuốc có chữ viết tay và dòng bị gạch đè',
  [await readFile(handwritingPath)],
  ['prescription'],
  ['handwriting', 'crossed-out unreadable line', 'ambiguous date'],
  {
    ground_truth_status:
      'Generated image must be reviewed against visible pixels; prompt text is not verified ground truth.',
    date: { raw_intended: '03/04/2026', confidence_below: 0.5, review: true },
    illegible_handwriting: { value: 'candidate or null', review: true, source_image: true },
    never_invent_crossed_out_drug: true,
  },
);
await emit(
  'MT-11-unreadable-scan',
  'Scan hỏng/mờ nghiêm trọng',
  [await degrade(receipt(), 'blur')],
  [],
  ['unreadable document'],
  {
    unreadable_fields: null,
    confidence_below: 0.5,
    source_image: true,
    review: true,
    decision:
      'Allow an unsupported/uncertain classification outcome; do not require a document type the pixels cannot justify. No hallucinated values.',
  },
);
const cut = createCanvas(W, H),
  cx = cut.getContext('2d');
cx.drawImage(await loadImage(receipt()), 0, 0);
cx.fillStyle = '#fcfbf7';
cx.fillRect(80, 344, 1070, 55);
cx.fillRect(80, 940, 1070, 65);
await emit(
  'MT-12-missing-date-and-total',
  'Ngày và tổng tiền bị mất khỏi bản scan',
  [cut.toBuffer('image/png')],
  ['receipt'],
  ['missing required fields', 'no arithmetic substitution'],
  {
    date: null,
    grand_total: null,
    confidence_below: 0.5,
    missing_warning: true,
    decision:
      'Do not reconstruct erased required values from arithmetic or original fixture. Retain page evidence when no field box exists.',
  },
);
await emit(
  'MT-13-total-mismatch',
  'Tổng tiền không khớp chi tiết trên 5%',
  [receipt({ total: '200.00' })],
  ['receipt'],
  ['arithmetic mismatch'],
  {
    printed_grand_total: '200.00',
    computed_total: '150.00',
    mismatch_over_5_percent: true,
    review: true,
    do_not_rewrite_printed_total: true,
  },
);
await emit(
  'MT-14-french-prescription-photo',
  'Đơn thuốc tiếng Pháp, bóng đổ và nhiễu',
  [await degrade(rx(), 'photo')],
  ['prescription'],
  ['French', 'photo shadow', 'noise'],
  {
    document_count: 1,
    patient: 'Demo Patient P01',
    medicine: 'Demo medicine A (fictional)',
    preserve_original_frequency: 'une fois par jour',
    preserve_original_duration: '3 jours',
  },
);
await writeFile(
  join(root, 'manifest.json'),
  JSON.stringify({ version: 1, synthetic: true, common_rules: common, samples }, null, 2),
);
const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
let html =
  '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Manual test samples</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;padding:0 24px;color:#213047;background:#f5f6f8}h1{font-size:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;padding:20px;border:1px solid #d4dce5;border-radius:10px}img{width:155px;float:left;margin:0 18px 12px 0}p{line-height:1.6}pre{white-space:pre-wrap;font-size:12px;clear:both}a{color:#1764ad}.notice{padding:18px;background:#fff0c7}</style><h1>Bộ mẫu manual test</h1><p class="notice">14 PDF chỉ chứa ảnh scan, không có lớp text. Dữ liệu giả hoàn toàn. Các lỗi mờ, mất chữ, chữ viết tay là chủ đích. Không dùng cho y tế. Đây là tình huống kiểm tra, chưa phải kết quả test OpenAI.</p><p>Chọn PDF, upload tại <a href="http://127.0.0.1:4000/manual-test">Manual test</a>, đối chiếu kết quả, ảnh nguồn và luồng approve/update. Mỗi lần upload tạo một scan_task. Mọi ngày cần xác nhận; confidence &lt; 0.5 ở bất kỳ thành phần nào phải chặn kết quả dùng tiếp.</p><p>Mẫu MT-10 được tạo bằng AI: kiểm tra giá trị thật trên ảnh trước khi xem là đáp án. Mẫu MT-08/11 có thể không xác định được đủ tài liệu; hệ thống phải thể hiện bất định.</p><div class="grid">';
for (const s of samples)
  html += `<article><img src="previews/${s.id}.png" alt="Preview ${s.id}"><h2>${esc(s.id)}</h2><p>${esc(s.title)}</p><p>${s.page_count} trang · ${esc(s.risks.join(', '))}</p><p><a href="${s.file}">Mở PDF</a> · <a href="expected/${s.id}.json">Kỳ vọng</a></p><details><summary>Chi tiết kiểm tra</summary><pre>${esc(JSON.stringify(s.expected, null, 2))}</pre></details></article>`;
await writeFile(join(root, 'index.html'), html + '</div></html>');
await writeFile(
  join(root, 'README.md'),
  `# Manual test samples\n\n14 PDF scan dùng dữ liệu giả, 4 document_type; không có lớp text ẩn. Mở [catalog](index.html) để xem preview và kỳ vọng từng mẫu. Upload file PDF vào http://127.0.0.1:4000/manual-test với AI_MODE=openai. Mock reader chỉ đọc lớp text trong mock-samples/ nên không đọc được bộ này. Không upload JSON, README hoặc ảnh preview.\n\n## Cách kiểm tra\n\n1. Upload từng PDF và kiểm tra một scan_task được tạo.\n2. Đối chiếu số tài liệu, bệnh nhân, các giá trị nhìn thấy trên scan với expected/*.json. Với phần bị mất/che/mờ, sidecar không phải bằng chứng để AI suy ra giá trị.\n3. Kiểm tra raw_value, giá trị ứng viên/null, warning, confidence, crop ảnh nguồn. Mọi ngày, cờ xét nghiệm và giá trị tiền khác chuẩn cần review theo decision của project.\n4. Mọi thành phần confidence <0.5 phải kéo tổng <0.5; kết quả chưa review không được export/dùng tiếp.\n5. Thử approve, sửa giá trị và lưu draft; kiểm tra trạng thái, final confidence, report và audit sau review.\n\n## Lưu ý\n\nMờ, lệch góc, nhạt, bóng đổ, mất trường, chữ gạch đè là chủ đích. Dữ liệu và tên thuốc giả, không có giá trị y tế. Mẫu chữ viết tay MT-10 do imagegen tạo, chưa phải chữ người viết thực hoặc ground truth đã xác minh độc lập. Mẫu khác dựng layout rồi raster hóa bằng code; chất lượng được biến đổi cố định để tái lập. Không thay thế holdout từ scan thực tế.\n\nMT-08: 2 tài liệu trên 1 trang có ranh giới/danh tính bị che một phần; chấp nhận bất định kèm review thay vì ép đúng số document. MT-11: có thể không phân loại được; bắt buộc không bịa dữ liệu. MT-12: ngày/tổng tiền bị xóa khỏi ảnh; không được lấy từ số cộng hay metadata.\n\nChưa chạy OpenAI trên 14 mẫu này; catalog ghi kỳ vọng, không ghi PASS giả.\n\n## Tái tạo\n\nChạy npm run manual-test-samples:generate sau khi chuyển bộ hiện tại sang thư mục phiên bản khác. Script chủ động từ chối ghi đè manifest. Giữ assets/handwritten-prescription.png làm nguồn chữ viết tay, chạy trên macOS có Arial Unicode hoặc Linux có DejaVu Sans. Đầu ra PDF chứa ảnh, expected JSON là oracle cho người đối chiếu, không nạp vào reader.\n\n${samples.map((s) => `- [${s.id}](${s.file}): ${s.title}`).join('\n')}\n`,
);
console.log(
  JSON.stringify({
    directory: root,
    pdfs: samples.length,
    pages: samples.reduce((a, s) => a + s.page_count, 0),
  }),
);
