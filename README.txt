CM602 H3 iOS版補正工具（PWA）

使用方式：
1. 將整個資料夾上傳到 HTTPS 網站，例如 GitHub Pages、公司內部網站或 NAS Web Station。
2. 用 iPhone Safari 打開 index.html。
3. 分享 > 加入主畫面，即可像 App 一樣使用。
4. 上傳 4 張照片後按「開始辨識」。
5. 核對數值後按「產生補正 Excel」。

注意：
- iOS 不能直接安裝我在這裡產出的原生 App；此版本是 iOS 可用的 PWA 網頁版。
- OCR 使用 Tesseract.js CDN，第一次使用需要連網。
- 預設填入規則：pos1/pos2/pos3 輸入 5-12 列；精度驗證輸入 28-39 列。
- 若你的 Excel 欄位與預設不同，可修改 app.js 裡的 colMap 與 validation cols。
