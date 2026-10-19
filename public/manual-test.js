'use strict';
let token = '',
  current = null,
  poll = null,
  selected = null,
  editing = null,
  filter = 'all',
  busy = false,
  loadVersion = 0;
const $ = (s) => document.querySelector(s),
  el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
const reasonLabels = {
  DATE_REVIEW_REQUIRED: 'Ngày tháng cần xác nhận',
  LAB_FLAG_REVIEW_REQUIRED: 'Cờ xét nghiệm cần xác nhận',
  LOW_CONFIDENCE: 'Điểm trích xuất thấp',
  DRAFT_PENDING: 'Có điều chỉnh chưa được xác nhận',
  MISSING_FIELD: 'Thiếu hoặc không đọc được trường',
  HANDWRITING_UNCERTAIN: 'Chữ viết tay chưa rõ',
  AMBIGUOUS_DATE: 'Ngày có nhiều cách diễn giải',
  DATE_FORMAT_UNCLEAR: 'Định dạng ngày chưa rõ',
  INVALID_DATE: 'Ngày không hợp lệ',
  CURRENCY_UNCLEAR: 'Đơn vị tiền tệ chưa rõ',
  MONEY_FORMAT_UNCLEAR: 'Định dạng tiền chưa rõ',
  NON_STANDARD_MONEY_FORMAT: 'Tiền khác định dạng chuẩn',
  FLAG_OUTSIDE_ENUM: 'Cờ xét nghiệm ngoài normal/high/low',
  TOTAL_MISMATCH: 'Tổng tiền không khớp chi tiết',
  MONEY_UNRESOLVED: 'Chưa đối chiếu được số tiền',
  UNRESOLVED_VALUE: 'Giá trị chưa được làm rõ',
  DECIMAL_PRECISION: 'Cần kiểm tra độ chính xác số tiền',
};
const labels = {
  doctor_name: 'Bác sĩ',
  patient_name: 'Bệnh nhân',
  hospital_name: 'Bệnh viện',
  lab_name: 'Phòng xét nghiệm',
  date: 'Ngày tài liệu',
  admission_date: 'Ngày nhập viện',
  discharge_date: 'Ngày ra viện',
  grand_total: 'Tổng tiền',
  payment_method: 'Thanh toán',
  currency: 'Đơn vị tiền tệ',
  tax: 'Thuế',
  discount: 'Giảm giá',
  refund: 'Hoàn tiền',
  attending_physician: 'Bác sĩ điều trị',
  discharge_instructions: 'Hướng dẫn ra viện',
  'diagnosis.primary': 'Chẩn đoán chính',
  'diagnosis.secondary': 'Chẩn đoán phụ',
};
const leafLabels = {
  name: 'Tên',
  description: 'Nội dung',
  quantity: 'Số lượng',
  unit_price: 'Đơn giá',
  total: 'Thành tiền',
  test_name: 'Tên xét nghiệm',
  result: 'Kết quả',
  unit: 'Đơn vị',
  reference_range: 'Khoảng tham chiếu',
  flag: 'Cờ xét nghiệm',
  dosage: 'Liều dùng',
  frequency: 'Tần suất',
  duration: 'Thời gian dùng',
};
const typeLabels = {
  receipt: 'Hóa đơn',
  prescription: 'Đơn thuốc',
  lab_report: 'Kết quả xét nghiệm',
  discharge_summary: 'Giấy ra viện',
};
const stateLabels = {
  queued: 'Đang chờ',
  processing: 'Đang xử lý',
  awaiting_review: 'Chờ kiểm tra',
  ready: 'Sẵn sàng',
  failed: 'Xử lý thất bại',
};
const errorLabels = {
  REVIEW_NOT_REQUIRED:
    'Trường này không thuộc vòng xác nhận đang chờ. Hãy tải dữ liệu mới hoặc bắt đầu bằng Lưu nháp nếu muốn sửa.',
  STRUCTURE_REVIEW_NOT_REQUIRED: 'Tài liệu không cần xác nhận cấu trúc thêm.',
  FIELD_VALIDATION_REQUIRED: 'Cần giải quyết lỗi dữ liệu trước khi xác nhận trường này.',
  REVIEW_REASON_REQUIRED: 'Cần ghi lý do hoặc căn cứ kiểm tra.',
  MISSING_VALUE_REASON_REQUIRED: 'Cần ghi lý do khi xác nhận trường thiếu.',
  INVALID_CORRECTION: 'Giá trị sửa chưa hợp lệ. Hãy đối chiếu nguồn và kiểm tra định dạng.',
  LOCAL_SESSION_REQUIRED: 'Phiên thao tác đã thay đổi. Tải lại trang để tiếp tục.',
};
function nameFor(path) {
  if (labels[path]) return labels[path];
  const m = path.match(/^(items|tests|medications|procedures_performed)\.(\d+)(?:\.(.+))?$/);
  if (!m) return path;
  const kind = {
    items: 'Dòng',
    tests: 'Xét nghiệm',
    medications: 'Thuốc',
    procedures_performed: 'Thủ thuật',
  }[m[1]];
  return kind + ' ' + (Number(m[2]) + 1) + (m[3] ? ' · ' + (leafLabels[m[3]] || m[3]) : '');
}
function show(value) {
  return value === null || value === undefined ? 'Không có giá trị' : String(value);
}
function active() {
  return current && ['ready', 'awaiting_review'].includes(current.status);
}
function required(f) {
  return f.requires_review && f.review_status === 'pending';
}
function blocking(d, f) {
  return (d.validation_errors || []).filter((e) => e.blocking && e.path === f.path);
}
function attention(d, f) {
  return required(f) || blocking(d, f).length > 0;
}
function score(n) {
  const x = el(
    'span',
    Number(n).toFixed(3),
    'score ' + (n < 0.5 ? 'low' : n < 0.8 ? 'mid' : 'high'),
  );
  return x;
}
function button(text, fn, cls = 'btn', write = false) {
  const b = el('button', text, cls);
  b.type = 'button';
  b.disabled = write && (busy || !active());
  if (write) b.dataset.write = 'true';
  b.onclick = fn;
  return b;
}
function link(text, url) {
  const a = el('a', text);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
function notice(value) {
  const message =
    value instanceof Error ? errorLabels[value.message] || value.message : value || '';
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
async function api(url, method = 'GET', body) {
  const headers = { 'x-review-token': token };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Không thực hiện được yêu cầu');
  return data;
}
function pairs() {
  return (current?.documents || []).flatMap((d) => (d.field_list || []).map((f) => ({ d, f })));
}
function find(ref) {
  const d = current?.documents?.find((d) => d.document_id === ref?.documentId);
  return { d, f: d?.field_list?.find((f) => f.path === ref?.path) };
}
function artifact(path) {
  return (
    '/artifacts/' +
    encodeURIComponent(current.task_id) +
    '/' +
    path.split('/').map(encodeURIComponent).join('/')
  );
}
function select(d, f, edit = false) {
  if (busy) return;
  if (
    editing &&
    (editing.documentId !== d.document_id || editing.path !== f.path) &&
    !confirm('Bỏ nội dung đang sửa để chuyển trường?')
  )
    return;
  selected = { documentId: d.document_id, path: f.path };
  if (edit)
    editing = {
      taskId: current.task_id,
      ...selected,
      value: f.final_value ?? '',
      reason: '',
      revision: current.revision,
      conflict: false,
    };
  else if (editing && (editing.documentId !== d.document_id || editing.path !== f.path))
    editing = null;
  renderPanel();
  renderTables();
  if (edit) {
    $('#source-panel textarea')?.focus({ preventScroll: true });
    $('#source-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
async function list() {
  try {
    const tasks = await api('/api/tasks');
    $('#task-list').replaceChildren();
    for (const t of tasks)
      $('#task-list').append(
        button(
          t.filename + ' · ' + (stateLabels[t.status] || t.status),
          () => {
            if (busy) return;
            if (editing && !confirm('Bỏ nội dung đang sửa để chuyển task?')) return;
            editing = null;
            selected = null;
            filter = 'all';
            void load(t.task_id);
          },
          'btn',
        ),
      );
  } catch (e) {
    notice(e);
  }
}
async function audit() {
  const taskId = current.task_id,
    revision = current.revision;
  try {
    const events = await api('/api/tasks/' + taskId + '/audit');
    if (current?.task_id === taskId && current.revision === revision)
      $('#audit').textContent = JSON.stringify(
        events.filter((e) => e.revision <= revision),
        null,
        2,
      );
  } catch (e) {
    if (current?.task_id === taskId)
      notice('Đã có kết quả nhưng chưa tải được lịch sử kiểm tra: ' + e.message);
  }
}
async function load(id, keepEdit = false) {
  const version = ++loadVersion;
  clearTimeout(poll);
  try {
    const task = await api('/api/tasks/' + encodeURIComponent(id));
    if (version !== loadVersion) return;
    current = task;
    if (!keepEdit) editing = null;
    history.replaceState(null, '', '#task=' + id);
    render();
    await audit();
    if (['queued', 'processing'].includes(current.status))
      poll = setTimeout(() => void load(id, true), 1500);
  } catch (e) {
    notice(e);
  }
}
async function submit(d, f, action, value, reason) {
  if (busy) return;
  const savedEdit = editing ? { ...editing } : null;
  busy = true;
  notice('');
  render();
  try {
    const task = await api('/api/tasks/' + current.task_id + '/review', 'POST', {
      document_id: d.document_id,
      path: f?.path ?? null,
      action,
      value,
      reason,
      expected_revision: savedEdit?.revision ?? current.revision,
      operation_id: crypto.randomUUID(),
    });
    current = task;
    if (action === 'draft' && savedEdit) {
      const latest = find(savedEdit).f;
      editing = {
        ...savedEdit,
        value: latest?.final_value ?? '',
        revision: task.revision,
        conflict: false,
      };
    } else editing = null;
    render();
    await audit();
    await list();
  } catch (e) {
    if (e.message === 'REVISION_CONFLICT') {
      try {
        current = await api('/api/tasks/' + current.task_id);
        editing = savedEdit ? { ...savedEdit, conflict: true } : null;
        render();
        notice(
          'Dữ liệu đã thay đổi ở phiên khác. Nội dung đang nhập được giữ lại; đối chiếu bản mới trước khi tiếp tục.',
        );
      } catch (refresh) {
        notice(refresh);
      }
    } else notice(e);
  } finally {
    busy = false;
    render();
  }
}
function confirmField(d, f) {
  if (!required(f) || !active()) return;
  if (f.final_value === null) {
    select(d, f, true);
    return;
  }
  if (blocking(d, f).length) {
    select(d, f, true);
    return;
  }
  void submit(d, f, 'approve', undefined, 'Đã đối chiếu giá trị hiện tại với ảnh nguồn');
}
function renderSummary() {
  const t = current;
  $('#summary').dataset.status = t.status;
  $('#summary').replaceChildren();
  const top = el('div', undefined, 'top'),
    heading = el('div');
  heading.append(
    el('h2', '2. Kết quả · ' + (stateLabels[t.status] || t.status)),
    el('p', t.filename, 'muted'),
    el('p', t.task_id + ' · phiên bản ' + t.revision, 'mini muted'),
  );
  const actions = el('div', undefined, 'buttons');
  if (t.report) actions.append(link('Mở report', t.report.url));
  const exp = button(
    'Xuất kết quả',
    async () => {
      try {
        const result = await api('/api/tasks/' + t.task_id + '/export', 'POST', {
          expected_revision: t.revision,
        });
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
          ),
          a = el('a');
        a.href = url;
        a.download = 'scan-' + t.task_id + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        notice(e);
      }
    },
    'btn primary',
  );
  exp.id = 'export';
  exp.disabled = t.status !== 'ready' || busy;
  actions.append(exp);
  top.append(heading, actions);
  $('#summary').append(top);
  const all = pairs(),
    need = all.filter(({ d, f }) => attention(d, f)).length,
    done = all.filter(({ f }) => f.review_status !== 'pending').length,
    auto = all.filter(({ f }) => !f.requires_review && f.review_status === 'pending').length;
  const stats = el('div', undefined, 'stats');
  for (const [n, label] of [
    [need, 'Trường cần xử lý'],
    [auto, 'Không bắt buộc xác nhận'],
    [done, 'Đã được người kiểm tra'],
    [Number(t.confidence ?? 0).toFixed(3), 'Điểm trích xuất AI'],
  ]) {
    const s = el('div', undefined, 'stat');
    s.append(el('strong', String(n)), el('span', label));
    stats.append(s);
  }
  $('#summary').append(stats);
  const banner = el(
    'div',
    undefined,
    'banner ' + (t.status === 'ready' ? 'good' : t.status === 'failed' ? 'bad' : ''),
  );
  banner.append(
    el(
      'strong',
      t.status === 'ready'
        ? 'Đã hoàn tất các xác nhận bắt buộc'
        : t.status === 'failed'
          ? 'Task xử lý thất bại'
          : active()
            ? `Còn ${need} trường cần xử lý`
            : 'Đang xử lý tài liệu',
    ),
  );
  if (t.error) banner.append(el('p', t.error, 'error'));
  if (active() && !t.coverage)
    banner.append(
      el(
        'p',
        'Chưa bao phủ đủ trang/tài liệu. Không thể mở export chỉ bằng xác nhận field. Cần kiểm tra toàn bộ nguồn.',
      ),
    );
  if (active() && need === 0 && t.status !== 'ready')
    banner.append(
      el('p', 'Kiểm tra lỗi validation hoặc loại/bệnh nhân/ranh giới tài liệu bên dưới.'),
    );
  if (need)
    banner.append(
      el(
        'p',
        'Chỉ trường có yêu cầu kiểm tra mới có nút xác nhận; điểm AI cao không thay thế quy tắc ngày/cờ xét nghiệm.',
        'mini',
      ),
    );
  $('#summary').append(banner);
  for (const p of t.pages || [])
    $('#summary').append(link('Trang ' + p.number + ' ', artifact('pages/' + p.image)));
  $('#review-area').hidden = !all.length;
  for (const b of $('#filters').querySelectorAll('[data-filter]')) {
    const counts = { all: all.length, pending: need, done };
    b.textContent =
      { all: 'Tất cả', pending: 'Cần xử lý', done: 'Đã kiểm tra' }[b.dataset.filter] +
      ' (' +
      counts[b.dataset.filter] +
      ')';
    b.classList.toggle('active', filter === b.dataset.filter);
    b.setAttribute('aria-pressed', String(filter === b.dataset.filter));
  }
}
function renderTables() {
  $('#results').replaceChildren();
  for (const d of current.documents || []) {
    const article = el('article', undefined, 'card');
    article.dataset.document = d.document_id;
    const head = el('div', undefined, 'dochead'),
      titles = el('div');
    titles.append(
      el('h3', typeLabels[d.document_type] || d.document_type),
      el('p', d.document_id, 'mini muted'),
    );
    head.append(titles, el('span', 'Trang ' + d.pages.join(', '), 'tag'));
    article.append(head);
    const info = el('div', undefined, 'doc-info');
    if (d.requires_structure_review) {
      info.append(
        el('p', 'Cần kiểm tra loại tài liệu, bệnh nhân hoặc ranh giới.', 'error'),
        button(
          'Xác nhận nguồn và ranh giới',
          () => {
            const reason = prompt(
              'Chỉ xác nhận sau khi đối chiếu toàn bộ trang. Nếu phân nhóm sai, giữ chặn và xử lý lại. Lý do/căn cứ:',
            );
            if (reason?.trim()) void submit(d, null, 'confirm_structure', undefined, reason);
          },
          'btn',
          true,
        ),
      );
    }
    if (d.validation_errors?.length) {
      for (const e of d.validation_errors)
        info.append(el('p', (reasonLabels[e.code] || e.message) + ' · ' + e.path, 'error mini'));
    }
    article.append(info);
    const wrap = el('div', undefined, 'tablewrap'),
      table = el('table');
    table.append(
      el('caption', (typeLabels[d.document_type] || d.document_type) + ' — giá trị và kiểm tra'),
    );
    const thead = el('thead'),
      header = el('tr');
    for (const label of [
      'Trường',
      'Giá trị hiện tại',
      'Điểm AI',
      'Sau kiểm tra',
      'Trạng thái',
      'Thao tác',
    ]) {
      const th = el('th', label);
      th.scope = 'col';
      header.append(th);
    }
    thead.append(header);
    table.append(thead);
    const body = el('tbody');
    let count = 0;
    for (const f of d.field_list || []) {
      if (
        (filter === 'pending' && !attention(d, f)) ||
        (filter === 'done' && f.review_status === 'pending')
      )
        continue;
      count++;
      const tr = el('tr');
      tr.dataset.path = f.path;
      if (attention(d, f)) tr.classList.add('pendingrow');
      if (selected?.documentId === d.document_id && selected.path === f.path)
        tr.classList.add('selected');
      const name = el('td');
      name.append(el('div', nameFor(f.path), 'fieldname'), el('code', f.path));
      const value = el('td');
      value.append(el('div', show(f.final_value), 'value'));
      if (f.raw_value !== f.final_value && f.raw_value !== null)
        value.append(el('small', 'Gốc: ' + f.raw_value));
      value.append(button('Xem nguồn', () => select(d, f), 'link'));
      const ai = el('td');
      ai.title = 'Điểm trích xuất sau quy tắc kiểm tra; điểm model gốc: ' + f.confidence;
      ai.append(score(f.extraction_confidence));
      const reviewed = el('td');
      reviewed.append(
        f.review_status === 'pending' ? el('span', '—', 'muted') : score(f.final_confidence),
      );
      const status = el('td');
      status.append(
        el(
          'span',
          blocking(d, f).length
            ? 'Cần xử lý lỗi'
            : required(f)
              ? 'Cần xác nhận'
              : f.review_status === 'corrected'
                ? 'Đã điều chỉnh'
                : f.review_status === 'confirmed'
                  ? 'Đã xác nhận'
                  : 'Không bắt buộc',
          'status ' + (attention(d, f) ? 'need' : f.review_status !== 'pending' ? 'done' : ''),
        ),
      );
      if (attention(d, f))
        for (const code of f.review_reasons?.length ? f.review_reasons : ['REVIEW_REQUIRED'])
          status.append(el('small', reasonLabels[code] || 'Cần kiểm tra theo quy tắc dữ liệu'));
      const action = el('td', undefined, 'actions');
      if (required(f) && active() && !blocking(d, f).length) {
        const label =
          f.final_value === null ? (f.missing ? 'Xác nhận thiếu' : 'Làm rõ giá trị') : 'Xác nhận';
        const b = button(label, () => confirmField(d, f), 'btn primary', true);
        b.dataset.action = 'approve';
        action.append(b);
      }
      action.append(button('Sửa', () => select(d, f, true), 'link', true));
      tr.append(name, value, ai, reviewed, status, action);
      body.append(tr);
    }
    if (!count) {
      const tr = el('tr'),
        td = el('td', 'Không có trường phù hợp bộ lọc.', 'empty');
      td.colSpan = 6;
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    article.append(
      wrap,
      el(
        'div',
        '“—” ở cột Sau kiểm tra nghĩa là chưa được người xác nhận; không phải trường bị thiếu.',
        'tablefoot',
      ),
    );
    $('#results').append(article);
  }
}
function renderPanel() {
  const panel = $('#source-panel');
  panel.replaceChildren();
  const { d, f } = find(selected);
  if (!d || !f) {
    panel.append(
      el('h3', 'Đối chiếu ảnh nguồn'),
      el('p', 'Chọn một trường để xem nguồn hoặc sửa giá trị.', 'muted'),
    );
    return;
  }
  const head = el('div', undefined, 'source-head');
  head.append(el('h3', nameFor(f.path)), el('span', 'Trang ' + f.page, 'tag'));
  panel.append(head, el('code', f.path));
  const page = current.pages?.find((p) => p.number === f.page);
  const full = f.evidence?.source_image ?? (page ? 'pages/' + page.image : null),
    crop = f.evidence?.image ?? full;
  if (crop && full) {
    const a = link('', artifact(full)),
      img = el('img');
    img.src = artifact(crop);
    img.alt = 'Nguồn ' + f.path;
    img.onerror = () => {
      img.hidden = true;
      notice('Chưa mở được ảnh nguồn của ' + f.path + '. Hãy kiểm tra trang gốc.');
    };
    a.append(img);
    panel.append(a, link('Mở trang nguồn đầy đủ', artifact(full)));
    if (!f.evidence || f.evidence.fallback)
      panel.append(el('p', 'Đang dùng cả trang vì không có vùng crop chắc chắn.', 'mini muted'));
  } else
    panel.append(
      el('p', 'Không có ảnh/crop của trường này. Đối chiếu các trang nguồn của task.', 'muted'),
    );
  const facts = el('dl', undefined, 'facts');
  for (const [label, v] of [
    ['Giá trị gốc', f.raw_value],
    ['Ứng viên', f.candidate_value],
    ['Giá trị chuẩn hóa', f.normalized_value],
    ['Giá trị hiện tại', f.final_value],
  ])
    facts.append(el('dt', label), el('dd', show(v)));
  panel.append(facts);
  for (const code of f.review_reasons || [])
    panel.append(el('p', reasonLabels[code] || code, 'mini muted'));
  if (!editing || editing.documentId !== d.document_id || editing.path !== f.path) return;
  const form = el('form', undefined, 'editor');
  form.onsubmit = (e) => e.preventDefault();
  form.append(el('h3', 'Điều chỉnh giá trị'));
  if (/(?:^|_)date$/.test(f.path))
    form.append(
      el('p', 'Nhập ngày đã làm rõ theo YYYY-MM-DD. Không suy đoán ngày còn mơ hồ.', 'mini muted'),
    );
  const valueLabel = el('label', 'Giá trị'),
    value = el('textarea');
  value.value = editing.value;
  value.maxLength = 20000;
  value.setAttribute('aria-label', f.path + ' value');
  value.oninput = () => {
    editing.value = value.value;
  };
  valueLabel.append(value);
  const reasonLabel = el('label', 'Lý do / căn cứ đối chiếu'),
    reason = el('textarea');
  reason.value = editing.reason;
  reason.maxLength = 2000;
  reason.setAttribute('aria-label', f.path + ' reason');
  reason.oninput = () => {
    editing.reason = reason.value;
  };
  reasonLabel.append(reason);
  form.append(valueLabel, reasonLabel);
  if (editing.conflict) {
    const conflict = el('div', undefined, 'conflict');
    conflict.append(
      el('p', 'Bản mới trên server: ' + show(f.final_value)),
      button('Đã đối chiếu, dùng phiên bản mới', () => {
        editing.revision = current.revision;
        editing.conflict = false;
        notice('Đã nhận phiên bản mới. Kiểm tra nội dung rồi gửi lại.');
        renderPanel();
      }),
    );
    form.append(conflict);
  }
  const buttons = el('div', undefined, 'buttons');
  buttons.append(
    button(
      'Huỷ',
      () => {
        editing = null;
        renderPanel();
      },
      'btn',
      true,
    ),
  );
  const draft = button(
    'Lưu nháp',
    () => void submit(d, f, 'draft', editing.value === '' ? null : editing.value, editing.reason),
    'btn',
    true,
  );
  draft.disabled = draft.disabled || editing.conflict;
  buttons.append(draft);
  if (required(f)) {
    const confirmButton = button(
      f.missing && editing.value === '' ? 'Xác nhận thiếu' : 'Xác nhận sửa',
      () => {
        if (!editing.reason.trim()) {
          notice('Cần ghi lý do hoặc căn cứ kiểm tra.');
          reason.focus();
          return;
        }
        if (!editing.value && !f.missing) {
          notice('Cần làm rõ giá trị trước khi xác nhận.');
          value.focus();
          return;
        }
        void submit(
          d,
          f,
          f.missing && editing.value === '' ? 'approve' : 'correct',
          editing.value === '' ? null : editing.value,
          editing.reason,
        );
      },
      'btn primary',
      true,
    );
    confirmButton.disabled = confirmButton.disabled || editing.conflict;
    confirmButton.dataset.action = 'confirm-edit';
    buttons.append(confirmButton);
  } else
    form.append(
      el('p', 'Lưu nháp để mở vòng review mới. Sau khi lưu, trường sẽ cần xác nhận.', 'mini muted'),
    );
  form.append(buttons);
  panel.append(form);
}
function render() {
  if (!current) return;
  const all = pairs();
  if (!find(selected).f) {
    const first = all.find(({ d, f }) => attention(d, f)) || all[0];
    selected = first ? { documentId: first.d.document_id, path: first.f.path } : null;
  }
  const complete = !['queued', 'processing'].includes(current.status);
  $('#json-result').hidden = !complete;
  $('#result-json').textContent = complete ? JSON.stringify(current, null, 2) : '';
  renderSummary();
  renderTables();
  renderPanel();
}
for (const b of $('#filters').querySelectorAll('[data-filter]'))
  b.onclick = () => {
    filter = b.dataset.filter;
    renderSummary();
    renderTables();
  };
$('#upload').onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  if (editing && !confirm('Bỏ nội dung đang sửa để upload tài liệu khác?')) return;
  const form = new FormData(e.target),
    submitButton = e.target.querySelector('button');
  submitButton.disabled = true;
  notice('');
  try {
    const t = await api('/api/tasks', 'POST', form);
    editing = null;
    selected = null;
    filter = 'all';
    await load(t.task_id);
    await list();
  } catch (err) {
    notice(err);
  } finally {
    submitButton.disabled = false;
  }
};
(async () => {
  try {
    const s = await api('/session');
    token = s.token;
    $('#session').textContent = 'Mode: ' + s.mode + ' · người kiểm tra: ' + s.reviewer;
    $('#sample-guide').textContent =
      s.sample_set?.description ?? 'Chức năng đọc tài liệu đang tắt.';
    $('#document').accept = s.sample_set?.accept ?? '.pdf,.png,.jpg,.jpeg';
    $('#upload button').disabled = s.mode === 'disabled';
    await list();
    const id = location.hash.match(/^#task=([\w-]+)$/)?.[1];
    if (id) await load(id);
  } catch (e) {
    notice(e);
  }
})();
window.addEventListener('hashchange', () => {
  const id = location.hash.match(/^#task=([\w-]+)$/)?.[1];
  if (!id || id === current?.task_id) return;
  if (busy) {
    history.replaceState(null, '', '#task=' + current.task_id);
    return;
  }
  if (editing && !confirm('Bỏ nội dung đang sửa để chuyển task?')) {
    history.replaceState(null, '', '#task=' + current.task_id);
    return;
  }
  editing = null;
  selected = null;
  filter = 'all';
  void load(id);
});
