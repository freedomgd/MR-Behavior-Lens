# MR Behavior Lens

VSCode extension ที่อ่าน GitLab Merge Request แล้วตอบคำถามเดียว: **"code ที่แก้ไป เปลี่ยน behavior อะไรบ้าง"** — ออกมาเป็น review + before/after Mermaid sequence diagram (🔴 flow เดิมที่หายไป / 🟢 flow ใหม่) ที่คลิกกลับไป code ได้

[English → README.md](README.md)

## ติดตั้ง

ติดตั้งจาก [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=sinjmenaruchi.mr-behavior-lens) (ค้น "MR Behavior Lens") — ถ้าจะพัฒนา/รันจาก source ดู [CONTRIBUTING.md](CONTRIBUTING.md)

> **เรื่องค่าใช้จ่าย:** การรีวิวใช้ LLM — กิน Copilot quota หรือ Anthropic API credit ของคุณ (มี budget guard + dashboard ให้ดูตลอด ดูหัวข้อ "ประหยัด token ยังไง")

## Setup ครั้งแรก

| ขั้น | ทำอะไร |
|---|---|
| 1 | `MR Lens: Set GitLab Token` — PAT scope `read_api` (public project ข้ามได้; ถ้าจะ post comment ต้อง scope `api`) หรือใส่ผ่าน setting `mrLens.gitlab.token` สำหรับ enterprise ที่ manage settings จากส่วนกลาง |
| 2 | เลือก LLM: ถ้ามี GitHub Copilot / enterprise LM provider login อยู่ ใช้ได้เลย (default `auto`) หรือ `MR Lens: Set Anthropic API Key` |
| 3 | ตั้ง `mrLens.gitlab.url` ถ้าเป็น self-hosted / enterprise GitLab (default `https://gitlab.com`) |
| 4 | (optional) `MR Lens: Select LLM Model…` — เลือก model จาก list ที่ active อยู่ หรือพิมพ์ model id เองได้ |

`mrLens.gitlab.projectId` เว้นว่างได้ — จะ derive จาก git remote ของ workspace หรือถามตอนรัน

## ใช้งาน

- **`MR Lens: Review Merge Request…`** — เลือก MR จาก list → ได้ panel ที่มี tab ต่อ behavior group: summary, behavior changes, findings, sequence diagram (คลิก `[file:line]` เพื่อเปิด code; ถ้าไฟล์ไม่อยู่ใน workspace จะเปิด GitLab)
- **Post comment กลับไปที่ MR** — ปุ่ม 💬 ท้ายแต่ละ finding โพสต์เป็น inline comment บน diff ที่ `file:line` นั้น (ถ้าตำแหน่งไม่อยู่ใน diff จะ fallback เป็น comment ธรรมดาพร้อมอ้างอิงไฟล์), ปุ่ม **💬 Comment on MR** ใน header โพสต์ comment อิสระ — ทั้งคู่เปิด input box ให้แก้ข้อความก่อนโพสต์เสมอ (ต้อง token scope `api`)
- **`MR Lens: Token Usage`** — dashboard การใช้ token: วันนี้ / 7 วัน / ทั้งหมด, กราฟรายวัน, breakdown ต่อ MR, request ล่าสุด
- **`MR Lens: Clear Review Cache`** — ล้าง cache ผลรีวิว

## ประหยัด token ยังไง

1. **Pre-process ฝั่งเครื่อง (0 token)** — กรอง lockfiles/generated/binary, ตัด diff ที่ยาวเกิน, ดึงชื่อ function ด้วย regex
2. **Pipeline 2 stage** — Stage A ใช้ model ถูก (`claude-haiku-4-5` / Copilot ตัวเล็ก) จัดกลุ่ม diff เป็น behavior groups ก่อน แล้ว Stage B ใช้ model หลัก (`claude-sonnet-5` / Copilot ตัวใหญ่) วิเคราะห์ทีละกลุ่ม
3. **Budget guard** — ถ้า input เกิน `mrLens.tokenBudget` (default 30k) จะถามก่อนส่ง
4. **Cache ตาม diff hash** — เปิดรีวิว MR เดิมซ้ำ = 0 token
5. **LSP context แบบ cap** — แนบ callers/callees เฉพาะกลุ่มที่จำเป็น ไม่เกิน `mrLens.contextBytesPerGroup` (4KB)

## Settings

| Setting | Default | ความหมาย |
|---|---|---|
| `mrLens.gitlab.url` | `https://gitlab.com` | base URL ของ GitLab instance (self-hosted / enterprise ได้) |
| `mrLens.gitlab.token` | ว่าง | GitLab PAT ผ่าน settings (ชนะ token ใน secret storage; ระวังเป็น plain text) |
| `mrLens.provider` | `auto` | `auto` = ลอง VSCode LM (Copilot/enterprise) ก่อน fallback Anthropic |
| `mrLens.model.classify` / `analyze` | ว่าง | override model ต่อ stage — ตั้งง่ายสุดผ่าน `MR Lens: Select LLM Model…` |
| `mrLens.tokenBudget` | 30000 | เพดาน input token ก่อนถาม confirm |
| `mrLens.maxGroups` | 5 | จำนวน behavior group สูงสุดต่อ MR |
| `mrLens.contextBytesPerGroup` | 4096 | เพดาน LSP context ต่อกลุ่ม |
