# Our Diary v2 — PWA + GAS JSON API

ไดอารี่คู่รักแบบ "ลื่นเหมือนแอป" ติดตั้งลงหน้าจอโฮมมือถือได้ (PWA)
GAS ทำหน้าที่แค่ **API คืน JSON** ส่วนหน้าเว็บ host แยกบน CDN ฟรี → เปิดทันที ไม่ติด latency ของ HtmlService
ข้อมูล + รูป **ยังอยู่ Google Sheet / Drive เหมือนเดิม**

## โครงสร้าง
```
OurDiary-PWA/
├─ Code.gs            ← วางใน Google Apps Script (Backend/API)
├─ index.html         ← Frontend PWA  ┐
├─ manifest.json                      ├─ อัปขึ้น GitHub Pages / Netlify
├─ service-worker.js                  │
└─ icons/                             ┘
   ├─ icon-192.png  icon-512.png  icon-maskable-512.png
```

---

## ส่วนที่ 1 — Deploy Backend (GAS API)

1. ไปที่ https://script.google.com → **New project**
2. วางเนื้อหา `Code.gs` ทับไฟล์ Code.gs เดิม
3. เพิ่มฟังก์ชันชั่วคราวเพื่อตั้งค่าครั้งแรก แล้ว **Run `_init` ครั้งเดียว** (กด Authorize อนุญาตสิทธิ์):
   ```js
   function _init() {
     setPin('123456');                                     // ← เปลี่ยนรหัส
     setReminderEmails('you@gmail.com,partner@gmail.com');  // ← อีเมลทั้งคู่
     setup();
   }
   ```
4. **Deploy ➜ New deployment ➜ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**  ⚠️ ต้องเป็น "Anyone" (ไม่ใช่ "Anyone with Google account") เพื่อให้ frontend ต่าง origin เรียก API ได้
   - กด Deploy → **คัดลอก URL ที่ลงท้าย `/exec`**

> ความเป็นส่วนตัวมาจาก **PIN** ที่รู้กันแค่สองคน ทุก action (ยกเว้น login) ต้องส่ง token ที่ได้จากการ login เท่านั้น ใครไม่มี PIN เรียก API ก็ไม่ได้ข้อมูล

---

## ส่วนที่ 2 — Deploy Frontend (PWA)

1. เปิด `index.html` แก้บรรทัดบนสุดของ `<script>`:
   ```js
   const API_URL = 'https://script.google.com/macros/s/XXXX/exec'; // ← URL /exec จากขั้นที่ 1
   ```
2. อัปทั้งโฟลเดอร์ (index.html, manifest.json, service-worker.js, icons/) ขึ้น host ฟรีอันใดอันหนึ่ง:

   **ตัวเลือก A — GitHub Pages**
   - สร้าง repo ใหม่ (เช่น `our-diary`) → อัปไฟล์ทั้งหมดเข้า root
   - Settings ➜ Pages ➜ Branch: `main` / folder `/root` ➜ Save
   - ได้ URL: `https://<username>.github.io/our-diary/`

   **ตัวเลือก B — Netlify (ง่ายสุด)**
   - https://app.netlify.com ➜ ลาก-วางโฟลเดอร์ทั้งอันลงหน้า "deploy" → ได้ URL ทันที

3. (ไม่บังคับ) กลับไป GAS รัน `setAppUrl('https://...ลิงก์ PWA...')` เพื่อให้อีเมลเตือนมีปุ่มเปิดแอป

---

## ส่วนที่ 3 — ติดตั้งลงมือถือ

- **iPhone (Safari):** เปิด URL ➜ ปุ่ม Share ➜ **Add to Home Screen**
- **Android (Chrome):** เปิด URL ➜ เมนู ⋮ ➜ **Add to Home screen / Install app**

เปิดจากไอคอนจะเป็นแบบเต็มจอ ไม่มีแถบเบราว์เซอร์ เหมือนแอปจริง

---

## ทำไม v2 เร็วกว่า v1
| | v1 (HtmlService) | v2 (PWA + API) |
|---|---|---|
| โหลดหน้า | ผ่าน iframe sandbox GAS (ช้า) | จาก CDN (ทันที) |
| ดึงข้อมูล | หลาย `google.script.run` | **1 call** `bootstrap` |
| รูป | ขอใหม่ทุกครั้งทีละไฟล์ | cache ใน **IndexedDB** โหลดครั้งเดียว |
| offline | เปิดไม่ได้ | เปิด shell ได้ (service worker) |

---

## แก้ปัญหาที่เจอบ่อย
- **เรียก API แล้ว error CORS** → ตรวจว่า Deploy ตั้ง "Who has access = **Anyone**" และใช้ URL ลงท้าย `/exec` (ไม่ใช่ `/dev`)
- **แก้โค้ด GAS แล้วไม่อัปเดต** → ต้อง **Deploy ➜ Manage deployments ➜ Edit ➜ New version** ทุกครั้ง (URL เดิมแต่ต้อง bump version)
- **รูปไม่ขึ้นหลังแก้** → ล้าง cache: ปิดแอปแล้วเปิดใหม่ หรือถอน/ติดตั้ง PWA ใหม่
- **เปลี่ยน PIN** → รัน `setPin('รหัสใหม่')` ใน GAS (ทุกคนต้อง login ใหม่)

## หมายเหตุความปลอดภัย
PIN เก็บเป็น SHA-256 hash, token = 16 ตัวแรกของ hash. เหมาะกับการใช้ส่วนตัวสองคน
ไม่ใช่ระบบความปลอดภัยระดับองค์กร — อย่าใส่ข้อมูลอ่อนไหวมาก และอย่าแชร์ URL+PIN ให้คนอื่น
