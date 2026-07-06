const $ = (id) => document.getElementById(id);
const els = {
  input: $('photoInput'), count: $('countStatus'), grid: $('previewGrid'), start: $('startOcrBtn'),
  upload: $('uploadCard'), ocr: $('ocrCard'), result: $('resultCard'), bar: $('progressBar'), progress: $('progressText'),
  integrity: $('integrityBox'), resultList: $('resultList'), debugList: $('debugList'), rerun: $('rerunBtn'), dl: $('downloadJsonBtn')
};
let files = []; let results = [];

els.input.addEventListener('change', () => { files = [...els.input.files]; renderPreview(); });
els.start.addEventListener('click', runOcr);
els.rerun.addEventListener('click', () => location.reload());
els.dl.addEventListener('click', downloadJson);

function renderPreview(){
  els.grid.innerHTML='';
  files.forEach(f=>{
    const div=document.createElement('div'); div.className='preview';
    const img=document.createElement('img'); img.src=URL.createObjectURL(f);
    const s=document.createElement('span'); s.textContent=f.name;
    div.append(img,s); els.grid.appendChild(div);
  });
  els.start.disabled = files.length !== 4;
  if(files.length===0){els.count.className='status muted'; els.count.textContent='尚未選取照片';}
  else if(files.length===4){els.count.className='status ok'; els.count.textContent='✓ 照片張數：4 / 4，可以開始辨識';}
  else {els.count.className='status warn'; els.count.textContent=`⚠ 照片張數：${files.length} / 4，請剛好選 4 張`;}
}

async function runOcr(){
  results=[]; els.upload.classList.add('hidden'); els.ocr.classList.remove('hidden'); setProgress(2,'載入 OCR 引擎…');
  const worker = await Tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: '0123456789.-° posPOS精度驗證數據各角度吸頭位置XxYy[]mm偏移量實裝座標SEQ吸嘴編號 '
  });
  for(let i=0;i<files.length;i++){
    setProgress(5 + i*23, `處理第 ${i+1} / ${files.length} 張：讀取圖片與裁切螢幕…`);
    const image = await loadImage(files[i]);
    const screen = detectScreenRect(image);
    const posSel = detectPosSelection(image, screen);
    const typeGuess = posSel ? 'position' : 'precision';

    const rois = buildRois(image, screen, typeGuess);
    setProgress(10 + i*23, `第 ${i+1} 張：辨識標題…`);
    const titleOcr = await ocrCanvas(worker, rois.title);
    const type = decideType(titleOcr.text, posSel);

    let parsed = { rows: [], values: [] };
    let tableOcr, posOcr = {text:'', confidence:0};
    if(type === 'precision'){
      setProgress(15 + i*23, `第 ${i+1} 張：辨識精度驗證表格…`);
      tableOcr = await ocrCanvas(worker, rois.precisionTable);
      parsed = parsePrecisionRows(tableOcr.text);
    } else {
      setProgress(15 + i*23, `第 ${i+1} 張：辨識吸頭位置表格…`);
      posOcr = await ocrCanvas(worker, rois.posButtons);
      tableOcr = await ocrCanvas(worker, rois.positionTable);
      parsed = parsePositionRows(tableOcr.text);
    }

    const name = type === 'precision' ? '精度驗證' : (posSel ? `Pos${posSel}` : guessPosFromText(posOcr.text));
    results.push({
      filename: files[i].name, type, name, pos: posSel || null,
      confidence: Math.round(((titleOcr.confidence||0)+(tableOcr.confidence||0)+(posOcr.confidence||0))/ (type==='precision'?2:3)),
      screen, parsed,
      ocr: {title:titleOcr, table:tableOcr, pos:posOcr},
      crops: {title: rois.title.dataUrl, table: (type==='precision'?rois.precisionTable.dataUrl:rois.positionTable.dataUrl), pos: rois.posButtons.dataUrl}
    });
  }
  await worker.terminate();
  setProgress(100,'完成');
  showResults();
}

function setProgress(p,t){ els.bar.style.width=`${p}%`; els.progress.textContent=t; }

function loadImage(file){
  return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=URL.createObjectURL(file); });
}

function canvasFromImage(img, maxW=1600){
  const scale = Math.min(1, maxW/img.naturalWidth);
  const c=document.createElement('canvas'); c.width=Math.round(img.naturalWidth*scale); c.height=Math.round(img.naturalHeight*scale);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height); return c;
}

function detectScreenRect(img){
  // 以目前 CM602 拍照構圖為基準，優先用固定比例；若之後拍照角度相近會比全圖 OCR 穩定很多。
  const w=img.naturalWidth, h=img.naturalHeight;
  return { x: Math.round(w*0.028), y: Math.round(h*0.335), w: Math.round(w*0.94), h: Math.round(h*0.535) };
}
function rel(screen, x,y,w,h){ return {x:screen.x+screen.w*x, y:screen.y+screen.h*y, w:screen.w*w, h:screen.h*h}; }
function clampRect(r, img){
  return {x:Math.max(0,Math.round(r.x)), y:Math.max(0,Math.round(r.y)), w:Math.min(img.naturalWidth-Math.max(0,Math.round(r.x)),Math.round(r.w)), h:Math.min(img.naturalHeight-Math.max(0,Math.round(r.y)),Math.round(r.h))};
}

function cropCanvas(img, r, scale=3, binary=true){
  r=clampRect(r,img);
  const out=document.createElement('canvas'); out.width=Math.max(1,Math.round(r.w*scale)); out.height=Math.max(1,Math.round(r.h*scale));
  const ctx=out.getContext('2d'); ctx.imageSmoothingEnabled=true; ctx.drawImage(img,r.x,r.y,r.w,r.h,0,0,out.width,out.height);
  if(binary){
    const im=ctx.getImageData(0,0,out.width,out.height); const d=im.data;
    for(let i=0;i<d.length;i+=4){
      let g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
      g = Math.max(0, Math.min(255, (g-105)*1.7+128));
      const v = g>135 ? 255 : 0; d[i]=d[i+1]=d[i+2]=v;
    }
    ctx.putImageData(im,0,0);
  }
  out.dataUrl=out.toDataURL('image/jpeg',0.85); return out;
}

function buildRois(img, screen, typeGuess){
  return {
    title: cropCanvas(img, rel(screen, .13,.07,.54,.095), 3, true),
    posButtons: cropCanvas(img, rel(screen, .33,.30,.32,.15), 4, false),
    positionTable: cropCanvas(img, rel(screen, .035,.500,.285,.340), 4, true),
    precisionTable: cropCanvas(img, rel(screen, .06,.18,.64,.43), 3, true)
  };
}

function detectPosSelection(img, screen){
  // 第五階段：改用三個固定按鈕區域的「青綠色分數」判斷。
  // 不再用整個 ROI 的重心，避免 Pos1/Pos3 因拍照角度或裁切偏移被誤判成 Pos2。
  const r = clampRect(rel(screen,.33,.30,.32,.15), img);
  const c=document.createElement('canvas'); c.width=Math.round(r.w); c.height=Math.round(r.h);
  const ctx=c.getContext('2d'); ctx.drawImage(img,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
  const im=ctx.getImageData(0,0,c.width,c.height);

  // 依實機畫面，三顆 pos 按鈕約佔 ROI 的左/中/右三段；每段只看中間按鈕本體，避開文字與邊框。
  const boxes=[
    {x0:0.03,x1:0.31,y0:0.12,y1:0.78},
    {x0:0.35,x1:0.64,y0:0.12,y1:0.78},
    {x0:0.68,x1:0.97,y0:0.12,y1:0.78}
  ];
  const scores=boxes.map(b=>greenScore(im,c.width,c.height,b));
  const max=Math.max(...scores); const idx=scores.indexOf(max);
  const second=[...scores].sort((a,b)=>b-a)[1] || 0;

  // 精度驗證畫面在這個 ROI 不是 pos 按鈕，會有零散色塊；提高門檻避免誤判。
  // 選取的青綠色按鈕通常分數明顯高於其他兩格。
  if(max < 0.030) return null;
  if(max < second * 1.45 && max < 0.085) return null;
  return idx+1;
}

function greenScore(im,w,h,b){
  const x0=Math.floor(w*b.x0), x1=Math.floor(w*b.x1), y0=Math.floor(h*b.y0), y1=Math.floor(h*b.y1);
  let score=0, total=0;
  for(let y=y0;y<y1;y++){
    for(let x=x0;x<x1;x++){
      const i=(y*w+x)*4; const R=im.data[i],G=im.data[i+1],B=im.data[i+2];
      total++;
      // CM602 選取色：青綠色，G/B 高、R 低；用連續分數而非硬切，提升不同光線下的穩定度。
      const cyan = Math.max(0, Math.min(G,B)-R-18) / 180;
      const bright = Math.max(0, Math.min(G,B)-75) / 180;
      if(G>90 && B>75 && R<175 && cyan>0) score += Math.min(1, cyan) * Math.min(1, bright);
    }
  }
  return total ? score/total : 0;
}
async function ocrCanvas(worker, canvas){
  const res = await worker.recognize(canvas);
  return { text: res.data.text || '', confidence: Math.round(res.data.confidence || 0) };
}
function decideType(text,posSel){
  const t=(text||'').replace(/\s/g,'');
  const low=t.toLowerCase();
  if(t.includes('精') || t.includes('驗') || low.includes('seq')) return 'precision';
  if(t.includes('各') || t.includes('角') || t.includes('吸') || low.includes('pos')) return 'position';
  if(posSel) return 'position';
  return 'precision';
}
function guessPosFromText(text){
  const t=(text||'').toLowerCase(); if(t.includes('pos1')) return 'Pos1'; if(t.includes('pos2')) return 'Pos2'; if(t.includes('pos3')) return 'Pos3'; return '未判斷';
}

function normalizeText(text){
  return (text||'').replace(/−|–|—/g,'-').replace(/,/g,'.').replace(/O/g,'0').replace(/o/g,'0').replace(/\|/g,'1');
}
function nums(line){ return (normalizeText(line).match(/-?\d+(?:\.\d+)?/g)||[]).map(Number); }

function decimalTokens(text){
  const t=normalizeText(text);
  return (t.match(/-?\d+\.\d{2,3}/g)||[]).map(v=>Number(v));
}
function parsePositionRows(text){
  const angleOrder=[0,45,90,135,180,-135,-90,-45];
  const t=normalizeText(text);
  const values=decimalTokens(t).filter(v=>Math.abs(v)<1);
  const rows=[];
  // 固定 CM602 吸頭位置表：每列 X/Y 兩個小數。優先用小數對，不依賴角度 OCR。
  for(let i=0;i+1<values.length && rows.length<8;i+=2){
    const x=values[i], y=values[i+1];
    if(Math.abs(x)<1 && Math.abs(y)<1){ rows.push({angle:angleOrder[rows.length],x:round3(x),y:round3(y),source:`pair ${rows.length+1}`}); }
  }
  // 若 OCR 把前幾列切掉，只顯示部分資料，也仍回傳已抓到的值，讓現場可手動補。
  return {rows, values:rows};
}

function parsePrecisionRows(text){
  const lines=normalizeText(text).split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const rows=[];
  for(const line of lines){
    const n=nums(line); if(n.length<5) continue;
    // 偏移量 X/Y 通常是每列最後三個數值中的前兩個：X, Y, A。
    const small=n.filter(v=>Math.abs(v)<1 || Math.abs(v)===0);
    if(small.length<2) continue;
    const x=small[small.length-3] ?? small[small.length-2];
    const y=small[small.length-2] ?? small[small.length-1];
    const seqGuess=n.find(v=>v>=1 && v<=12) ?? rows.length+1;
    const nozzleGuess=[...n].find(v=>v>=1 && v<=3) ?? ((rows.length%3)+1);
    if(isFinite(x)&&isFinite(y)&&Math.abs(x)<1&&Math.abs(y)<1){
      rows.push({seq:Math.round(seqGuess), nozzle:Math.round(nozzleGuess), x:round3(x), y:round3(y), source:line});
    }
  }
  // 若逐列 OCR 不穩，改用全表小數序列重建 12 列：每列最後 3 個偏移數值 X/Y/A。
  if(rows.length<8){
    const all=decimalTokens(text);
    const offsetCandidates=all.filter(v=>Math.abs(v)<1);
    const rebuilt=[];
    for(let i=0; i+2<offsetCandidates.length && rebuilt.length<12; i+=3){
      const x=offsetCandidates[i], y=offsetCandidates[i+1];
      if(Math.abs(x)<1 && Math.abs(y)<1){ rebuilt.push({seq:rebuilt.length+1, nozzle:(rebuilt.length%3)+1, x:round3(x), y:round3(y), source:`rebuilt ${rebuilt.length+1}`}); }
    }
    if(rebuilt.length>rows.length) return {rows:rebuilt, values:rebuilt};
  }
  return {rows:rows.slice(0,12), values:rows.slice(0,12)};
}
function round3(v){ return Math.round(v*1000)/1000; }

function showResults(){
  els.ocr.classList.add('hidden'); els.result.classList.remove('hidden');
  renderIntegrity(); renderResultCards(); renderDebug();
}
function renderIntegrity(){
  const pos1=results.filter(r=>r.name==='Pos1').length;
  const pos2=results.filter(r=>r.name==='Pos2').length;
  const pos3=results.filter(r=>r.name==='Pos3').length;
  const precision=results.filter(r=>r.type==='precision').length;
  const unclassified=results.filter(r=>r.name==='未判斷').length;
  const noData=results.filter(r=>(r.parsed.rows||[]).length===0).length;
  const items=[
    [results.length===4,`照片張數：${results.length} / 4`], [pos1===1,`Pos1：${pos1} 張`], [pos2===1,`Pos2：${pos2} 張`], [pos3===1,`Pos3：${pos3} 張`],
    [precision===1,`精度驗證：${precision} 張`], [unclassified===0,`未完成分類照片：${unclassified} 張`], [noData===0,`無 X/Y 數值照片：${noData} 張`]
  ];
  els.integrity.innerHTML=items.map(([ok,msg])=>`<div class="checkItem ${ok?'ok':'warn'}">${ok?'✓':'⚠'} ${msg}</div>`).join('');
}
function renderResultCards(){
  els.resultList.innerHTML='';
  results.forEach((r,idx)=>{
    const div=document.createElement('div'); div.className='resultCard';
    div.innerHTML=`<div class="resultHead"><b>${escapeHtml(r.filename)}</b><span class="pill">${r.name} · ${r.confidence}%</span></div>`;
    if(r.type==='position'){
      div.innerHTML += `<div class="field"><label>照片分類</label><select onchange="results[${idx}].name=this.value; renderIntegrity()"><option ${r.name==='Pos1'?'selected':''}>Pos1</option><option ${r.name==='Pos2'?'selected':''}>Pos2</option><option ${r.name==='Pos3'?'selected':''}>Pos3</option><option ${r.name==='未判斷'?'selected':''}>未判斷</option></select></div>`;
      div.innerHTML += miniPositionTable(r.parsed.rows,idx);
    } else {
      div.innerHTML += `<div class="field"><label>照片分類</label><input value="精度驗證" disabled></div>`;
      div.innerHTML += miniPrecisionTable(r.parsed.rows,idx);
    }
    els.resultList.appendChild(div);
  });
}
function miniPositionTable(rows,idx){
  if(!rows.length) return '<div class="status warn">⚠ 未抓到吸頭位置 X/Y 表格，請看下方 OCR 原文。</div>';
  return `<div class="rowData"><table class="miniTable"><thead><tr><th>角度</th><th>X</th><th>Y</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${r.angle}°</td><td><input value="${r.x}" onchange="results[${idx}].parsed.rows[${i}].x=Number(this.value)"></td><td><input value="${r.y}" onchange="results[${idx}].parsed.rows[${i}].y=Number(this.value)"></td></tr>`).join('')}</tbody></table></div>`;
}
function miniPrecisionTable(rows,idx){
  if(!rows.length) return '<div class="status warn">⚠ 未抓到精度驗證 X/Y 表格，請看下方 OCR 原文。</div>';
  return `<div class="rowData"><table class="miniTable"><thead><tr><th>SEQ</th><th>吸嘴</th><th>X偏移</th><th>Y偏移</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${r.seq}</td><td>${r.nozzle}</td><td><input value="${r.x}" onchange="results[${idx}].parsed.rows[${i}].x=Number(this.value)"></td><td><input value="${r.y}" onchange="results[${idx}].parsed.rows[${i}].y=Number(this.value)"></td></tr>`).join('')}</tbody></table></div>`;
}
function renderDebug(){
  els.debugList.innerHTML=results.map(r=>`<div class="debugItem"><b>${escapeHtml(r.filename)} · ${r.name}</b><p>表格裁切</p><img src="${r.crops.table}"><p>Pos 裁切</p><img src="${r.crops.pos}"><p>標題 OCR</p><pre>${escapeHtml(r.ocr.title.text)}</pre><p>表格 OCR</p><pre>${escapeHtml(r.ocr.table.text)}</pre><p>Pos OCR</p><pre>${escapeHtml(r.ocr.pos.text)}</pre></div>`).join('');
}
function downloadJson(){
  const blob=new Blob([JSON.stringify(results,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`cm602_h3_ocr_${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click();
}
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

if('serviceWorker' in navigator){ navigator.serviceWorker.register('./service-worker.js').catch(()=>{}); }
