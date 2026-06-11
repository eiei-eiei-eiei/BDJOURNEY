# Our Diary — บริบทโปรเจกต์ (อ่านก่อนเริ่มงานทุกครั้ง)

ไดอารี่คู่รักส่วนตัวสำหรับ 2 คน แนวเดียวกับแอป Journey
ปลดล็อกด้วย PIN ตัวเลขร่วม 1 ชุด (ไม่แยกชื่อคนเขียน)

## สถาปัตยกรรม — มี 2 ส่วนที่ deploy คนละที่ (สำคัญมาก)

1. **Backend = `Code.gs`** → วางใน Google Apps Script ทำหน้าที่ JSON API ล้วน
   - ตอบทุก request ผ่าน `doGet` (อ่าน) / `doPost` (เขียน) → คืน JSON ผ่าน `ContentService`
   - **ห้ามใช้ HtmlService** (v1 เคยใช้แล้วช้า จึงเปลี่ยนมาเป็น API)
   - routing รวมอยู่ที่ฟังก์ชัน `handle_()` แยกตาม `action`
   - POST รับ body เป็น text/plain (เลี่ยง CORS preflight)

2. **Frontend = `index.html` + `manifest.json` + `service-worker.js` + `icons/`**
   → static PWA host บน GitHub Pages / Netlify
   - SPA วานิลลา ไม่มี framework, ไม่มี build step
   - เรียก API ผ่าน `fetch` (`apiGet`/`apiPost`) — ต้องตั้งค่า `const API_URL` บนสุดของ `<script>` เป็น URL `/exec` ของ GAS
   - รูป cache ใน **IndexedDB** (store ชื่อ `photos`) โหลดครั้งเดียว

## ข้อมูล
- **Google Sheet** 2 แท็บ: `Entries`, `Anniversaries` (สร้างอัตโนมัติโดย `setup()`)
  - Entries: `id, entryDate(yyyy-mm-dd), createdAt, updatedAt, title, body, mood, weather, location, photoIds(comma)`
  - Anniversaries: `id, title, date, recurring, remindDaysBefore, note`
- **Google Drive** โฟลเดอร์ "Our Diary — Photos" เก็บไฟล์รูป, Sheet เก็บแค่ `fileId`
- Config เก็บใน **Script Properties**: `PIN_HASH, SPREADSHEET_ID, DRIVE_FOLDER_ID, REMIND_EMAILS, APP_URL`

## Auth
- `PIN_HASH` = SHA-256 ของ PIN, `token` = 16 ตัวแรกของ hash
- ทุก action ยกเว้น `login` ต้องส่ง `token` → ตรวจที่ `checkToken_()`

## Features
Timeline / Calendar / Throwback ("วันนี้ในอดีต") / Anniversaries + เตือน email (daily trigger 08:00 → `dailyReminder`)

## ข้อตกลงการเขียนโค้ด (ตามที่เจ้าของชอบ)
- Clean code + คอมเมนต์ภาษาไทยกำกับ
- **Performance:** อ่าน/เขียน Sheet แบบ batch (`getValues`/`setValues`) เสมอ — **ห้าม `getValue`/`setValue` ใน loop**
- การคำนวณวันที่ (throwback, นับถอยหลังครบรอบ) ต้องแม่นยำ ดูฟังก์ชัน `daysUntilNext_`

## ขั้นตอน deploy / sync
- แก้ `Code.gs` แล้วต้อง push ขึ้น GAS ด้วย **clasp** (`clasp push`) แล้ว **Manage deployments → New version** มิฉะนั้น URL เดิมยังรันโค้ดเก่า
- GAS Web App ต้องตั้ง access = **Anyone** (ไม่ใช่ Anyone with Google account) ไม่งั้น frontend ต่าง origin โดน CORS บล็อก
- แก้ frontend แล้วอัปไฟล์ขึ้น host ใหม่ (Netlify ลากวาง / GitHub Pages commit)

## งานที่ค้าง / ไอเดียต่อยอด (v3)
- บีบขนาดรูปฝั่ง client ก่อนอัป (canvas resize) ลดพื้นที่ Drive + เร็วขึ้น
- ค้นหา/แท็ก, mood chart รายเดือน, export PDF รายปี
- สคริปต์ย้ายข้อมูลจาก v1 → v2 (ถ้าเคยใช้ v1 ไปแล้ว)

## ไฟล์ที่ห้ามลืม
- v1 เดิม (HtmlService) อยู่โฟลเดอร์ `../OurDiary` — เก็บไว้อ้างอิง ไม่ใช้ต่อแล้ว
