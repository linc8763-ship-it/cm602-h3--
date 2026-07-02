let parsed = {pos: {}, validation: []};
const angles = ["0","45","90","135","180","-135","-90","-45"];

function nums(line){return (line.match(/-?\d+\.\d+|-?\d+/g)||[]).map(Number)}
function normalize(t){return t.replace(/−/g,'-').replace(/—/g,'-').replace(/–/g,'-').replace(/[，]/g,'.')}

function parseText(){
  const text = normalize(document.getElementById('ocrText').value);
  const blocks = text.split(/(?=pos\s*[123]|精度|SEQ|吸頭位置偏移量)/i);
  parsed = {pos:{}, validation:[]};
  // Parse pos blocks: expect eight angle lines with X Y.
  for(const b of blocks){
    let p = (b.match(/pos\s*([123])/i)||[])[1];
    if(!p) continue;
    const rows=[];
    b.split(/\n/).forEach(line=>{
      const n=nums(line); if(n.length>=3){
        const a=n[0]; if([0,45,90,135,180,-135,-90,-45].includes(a)) rows.push({angle:a,x:n[n.length-2],y:n[n.length-1]});
      }
    });
    if(rows.length>=8) parsed.pos[p]=rows.slice(0,8);
  }
  // Fallback: if text from photos lacks explicit pos labels, take all 8-row XY angle tables in order as pos1,pos2,pos3.
  if(Object.keys(parsed.pos).length<3){
    const rows=[];
    text.split(/\n/).forEach(line=>{const n=nums(line); if(n.length>=3){const a=n[0]; if([0,45,90,135,180,-135,-90,-45].includes(a)) rows.push({angle:a,x:n[n.length-2],y:n[n.length-1]});}});
    for(let i=0;i<3;i++){ const part=rows.slice(i*8,(i+1)*8); if(part.length===8) parsed.pos[String(i+1)]=part; }
  }
  // Validation: lines with seq, nozzle number, mount coords, offset x/y/a. Keep last 12 rows with 8+ numeric values.
  const v=[];
  text.split(/\n/).forEach(line=>{const n=nums(line); if(n.length>=8){v.push({seq:n[0],nozzle:n[1],mx:n[2],my:n[3],ma:n[4],x:n[5],y:n[6],a:n[7]});}});
  parsed.validation = v.slice(-12);
  renderResult();
}

function renderResult(){
  let html='';
  for(const p of ['1','2','3']){
    html += `<h3>pos${p}</h3><table><tr><th>角度</th><th>X</th><th>Y</th></tr>`;
    (parsed.pos[p]||[]).forEach(r=>html += `<tr><td>${r.angle}</td><td>${r.x.toFixed(3)}</td><td>${r.y.toFixed(3)}</td></tr>`);
    html += '</table>';
  }
  html += '<h3>精度驗證</h3><table><tr><th>SEQ</th><th>吸嘴</th><th>座標X</th><th>座標Y</th><th>A</th><th>偏移X</th><th>偏移Y</th><th>偏移A</th></tr>';
  parsed.validation.forEach(r=>html += `<tr><td>${r.seq}</td><td>${r.nozzle}</td><td>${r.mx}</td><td>${r.my}</td><td>${r.ma}</td><td>${r.x}</td><td>${r.y}</td><td>${r.a}</td></tr>`);
  html += '</table>';
  document.getElementById('result').innerHTML=html;
}

async function readExcel(){
  const f=document.getElementById('excelFile').files[0];
  if(f) return await f.arrayBuffer();
  return await (await fetch('template.xlsx')).arrayBuffer();
}
function cell(ws, addr, val){ if(!ws[addr]) ws[addr]={t:'n'}; ws[addr].v=val; ws[addr].t=typeof val==='number'?'n':'s'; }
function exportXlsx(){
  const wb=XLSX.read(new Uint8Array(window.excelBuf), {type:'array', cellStyles:true});
  const name=document.getElementById('sheetName').value.trim();
  const ws=wb.Sheets[name] || wb.Sheets[wb.SheetNames[0]];
  // Default mapping: rows 5-12, columns B:C=pos1 X/Y, D:E=pos2 X/Y, F:G=pos3 X/Y.
  const colMap={1:['B','C'],2:['D','E'],3:['F','G']};
  for(const p of [1,2,3]) (parsed.pos[p]||[]).forEach((r,i)=>{cell(ws, colMap[p][0]+(5+i), r.x); cell(ws, colMap[p][1]+(5+i), r.y);});
  // Validation rows 28-39, columns B:I = SEQ/nozzle/mountX/mountY/mountA/offX/offY/offA.
  const cols=['B','C','D','E','F','G','H','I'];
  parsed.validation.forEach((r,i)=>{[r.seq,r.nozzle,r.mx,r.my,r.ma,r.x,r.y,r.a].forEach((v,j)=>cell(ws, cols[j]+(28+i), v));});
  XLSX.writeFile(wb, `CM602_H3_${document.getElementById('head').value}_補正.xlsx`);
}

document.getElementById('ocrBtn').onclick=async()=>{
  const files=[...document.getElementById('images').files];
  let out='';
  for(const f of files){
    out += `\n\n--- ${f.name} ---\n`;
    const r=await Tesseract.recognize(f,'eng',{logger:m=>{}});
    out += r.data.text;
  }
  document.getElementById('ocrText').value=out; parseText();
};
document.getElementById('parseBtn').onclick=parseText;
document.getElementById('exportBtn').onclick=async()=>{window.excelBuf=await readExcel(); exportXlsx();};
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
