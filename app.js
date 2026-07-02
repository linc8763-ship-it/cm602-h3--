const photoInput = document.getElementById('photoInput');
const countStatus = document.getElementById('countStatus');
const previewGrid = document.getElementById('previewGrid');
const startOcrBtn = document.getElementById('startOcrBtn');
const ocrCard = document.getElementById('ocrCard');
const resultCard = document.getElementById('resultCard');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const integrityBox = document.getElementById('integrityBox');
const resultList = document.getElementById('resultList');
const rerunBtn = document.getElementById('rerunBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');

let selectedFiles = [];
let ocrResults = [];

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

photoInput.addEventListener('change', () => {
  selectedFiles = Array.from(photoInput.files || []);
  renderPreviews();
});

startOcrBtn.addEventListener('click', runOcr);
rerunBtn.addEventListener('click', () => {
  selectedFiles = [];
  ocrResults = [];
  photoInput.value = '';
  previewGrid.innerHTML = '';
  resultCard.classList.add('hidden');
  ocrCard.classList.add('hidden');
  updateCountStatus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

downloadJsonBtn.addEventListener('click', () => {
  syncEditedValues();
  const blob = new Blob([JSON.stringify(ocrResults, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cm602_h3_ocr_${formatTimestamp()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function renderPreviews() {
  previewGrid.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const div = document.createElement('div');
    div.className = 'preview';
    div.innerHTML = `<img src="${url}" alt="photo ${idx + 1}"><div>${idx + 1}. ${escapeHtml(file.name)}</div>`;
    previewGrid.appendChild(div);
  });
  updateCountStatus();
}

function updateCountStatus() {
  const n = selectedFiles.length;
  countStatus.className = 'status';
  if (n === 0) {
    countStatus.classList.add('muted');
    countStatus.textContent = '尚未選取照片';
    startOcrBtn.disabled = true;
  } else if (n < 4) {
    countStatus.classList.add('warn');
    countStatus.textContent = `已選取 ${n} / 4 張，請補齊 4 張照片`;
    startOcrBtn.disabled = true;
  } else if (n > 4) {
    countStatus.classList.add('err');
    countStatus.textContent = `已選取 ${n} 張，一次只需 4 張照片`;
    startOcrBtn.disabled = true;
  } else {
    countStatus.classList.add('ok');
    countStatus.textContent = '已選取 4 / 4 張，可以開始 OCR 辨識';
    startOcrBtn.disabled = false;
  }
}

async function runOcr() {
  if (selectedFiles.length !== 4) return;
  ocrCard.classList.remove('hidden');
  resultCard.classList.add('hidden');
  startOcrBtn.disabled = true;
  ocrResults = [];
  window.scrollTo({ top: ocrCard.offsetTop - 10, behavior: 'smooth' });

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    progressText.textContent = `正在辨識第 ${i + 1} / 4 張：${file.name}`;
    setProgress((i / selectedFiles.length) * 100);
    try {
      const image = await fileToDataURL(file);
      const { data } = await Tesseract.recognize(image, 'eng+chi_tra', {
        logger: m => {
          if (m.status === 'recognizing text') {
            const base = (i / selectedFiles.length) * 100;
            const span = 100 / selectedFiles.length;
            setProgress(base + (m.progress || 0) * span);
          }
        }
      });
      const text = data.text || '';
      ocrResults.push({
        fileName: file.name,
        type: classifyImage(text, file.name),
        values: extractValues(text),
        rawText: text,
        confidence: Math.round(data.confidence || 0)
      });
    } catch (error) {
      ocrResults.push({
        fileName: file.name,
        type: '辨識失敗',
        values: [],
        rawText: String(error),
        confidence: 0
      });
    }
  }

  setProgress(100);
  progressText.textContent = 'OCR 完成，請確認結果。';
  renderResults();
  resultCard.classList.remove('hidden');
  window.scrollTo({ top: resultCard.offsetTop - 10, behavior: 'smooth' });
  startOcrBtn.disabled = false;
}

function classifyImage(text, fileName) {
  const s = `${text}\n${fileName}`.toLowerCase();
  if (/精度|verification|accuracy|cpk|校驗|驗證/.test(s)) return '精度驗證';
  if (/pos\s*1|position\s*1|nozzle\s*1|吸頭.*1|位置.*1/.test(s)) return 'Pos1';
  if (/pos\s*2|position\s*2|nozzle\s*2|吸頭.*2|位置.*2/.test(s)) return 'Pos2';
  if (/pos\s*3|position\s*3|nozzle\s*3|吸頭.*3|位置.*3/.test(s)) return 'Pos3';
  if (/offset|偏移|吸頭位置/.test(s)) return '吸頭位置偏移量';
  return '未判斷';
}

function extractValues(text) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const rows = [];
  const anglePattern = /(-?\d{1,3})\s*(?:°|度|deg)?/;
  const decimalPattern = /[-+]?\d*\.\d+|[-+]?\d+/g;

  for (const line of lines) {
    const decimals = (line.match(decimalPattern) || [])
      .map(v => Number(v))
      .filter(v => Number.isFinite(v));

    // Common screen rows contain angle + X + Y. Keep rows with at least 2 small decimal values.
    const smallDecimals = decimals.filter(v => Math.abs(v) < 10 && !Number.isInteger(v));
    if (smallDecimals.length >= 2) {
      const angleMatch = line.match(anglePattern);
      rows.push({
        angle: angleMatch ? angleMatch[1] : '',
        x: smallDecimals[0],
        y: smallDecimals[1],
        sourceLine: line
      });
    }
  }

  // Fallback: take decimal pairs from whole text.
  if (rows.length === 0) {
    const nums = (text.match(/[-+]?\d*\.\d+/g) || []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      rows.push({ angle: '', x: nums[i], y: nums[i + 1], sourceLine: '自動配對' });
    }
  }

  return rows.slice(0, 16);
}

function renderResults() {
  renderIntegrity();
  resultList.innerHTML = '';
  ocrResults.forEach((r, idx) => {
    const item = document.createElement('div');
    item.className = 'resultItem';
    const rowsHtml = r.values.length ? r.values.map((v, vi) => `
      <div class="kvGrid" data-row="${vi}">
        <div class="kv"><label>角度</label><input data-idx="${idx}" data-row="${vi}" data-key="angle" value="${escapeHtml(v.angle ?? '')}"></div>
        <div class="kv"><label>X</label><input data-idx="${idx}" data-row="${vi}" data-key="x" value="${escapeHtml(v.x ?? '')}"></div>
        <div class="kv"><label>Y</label><input data-idx="${idx}" data-row="${vi}" data-key="y" value="${escapeHtml(v.y ?? '')}"></div>
        <div class="kv"><label>來源列</label><input value="${escapeHtml(v.sourceLine ?? '')}" readonly></div>
      </div>`).join('') : '<div class="status warn">未抓到 X/Y 數值，請確認原始 OCR 文字。</div>';

    item.innerHTML = `
      <div class="resultHead">
        <strong>${escapeHtml(r.fileName)}</strong>
        <span class="typeTag">${escapeHtml(r.type)}</span>
      </div>
      <div class="status ${r.confidence >= 60 ? 'ok' : r.confidence >= 35 ? 'warn' : 'err'}">OCR 信心值：${r.confidence}%</div>
      ${rowsHtml}
      <details>
        <summary>查看原始 OCR 文字</summary>
        <textarea readonly>${escapeHtml(r.rawText)}</textarea>
      </details>
    `;
    resultList.appendChild(item);
  });
}

function renderIntegrity() {
  integrityBox.innerHTML = '';
  const expected = ['Pos1', 'Pos2', 'Pos3', '精度驗證'];
  const counts = Object.create(null);
  ocrResults.forEach(r => counts[r.type] = (counts[r.type] || 0) + 1);

  addCheck(selectedFiles.length === 4, `照片張數：${selectedFiles.length} / 4`);
  expected.forEach(type => addCheck(counts[type] === 1, `${type}：${counts[type] || 0} 張`));
  const unknown = ocrResults.filter(r => r.type === '未判斷' || r.type === '辨識失敗' || r.type === '吸頭位置偏移量').length;
  addCheck(unknown === 0, `未完成分類照片：${unknown} 張`);
  const missingValues = ocrResults.filter(r => !r.values || r.values.length === 0).length;
  addCheck(missingValues === 0, `無 X/Y 數值照片：${missingValues} 張`);
}

function addCheck(ok, text) {
  const div = document.createElement('div');
  div.className = `checkItem ${ok ? 'ok' : 'warn'}`;
  div.textContent = `${ok ? '✓' : '⚠'} ${text}`;
  integrityBox.appendChild(div);
}

function syncEditedValues() {
  document.querySelectorAll('input[data-idx]').forEach(input => {
    const idx = Number(input.dataset.idx);
    const row = Number(input.dataset.row);
    const key = input.dataset.key;
    if (ocrResults[idx] && ocrResults[idx].values[row]) {
      const val = input.value.trim();
      ocrResults[idx].values[row][key] = key === 'angle' ? val : Number(val);
    }
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setProgress(percent) {
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function formatTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
