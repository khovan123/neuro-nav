<div align="right">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/Language-English-blue?style=for-the-badge&logo=google-translate"></a>
  <a href="README-vi.md"><img alt="Tiếng Việt" src="https://img.shields.io/badge/Ngôn_ngữ-Tiếng_Việt-red?style=for-the-badge&logo=google-translate"></a>
</div>

<div align="center">
  <img src="./apps/extension/public/icons/icon-128.png" alt="Neuro-Nav Logo" width="128" />
  <h1>🧠 Neuro-Nav</h1>
  <p><strong>The Developer's Micro-OS: Context management, semantic search, and AI-powered browsing for software engineers.</strong></p>
  
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-v1.0.0-blue.svg" />
    <img alt="React" src="https://img.shields.io/badge/react-%2320232a.svg?style=flat&logo=react&logoColor=%2361DAFB" />
    <img alt="TailwindCSS" src="https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=flat&logo=tailwind-css&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white" />
    <img alt="Vite" src="https://img.shields.io/badge/vite-%23646CFF.svg?style=flat&logo=vite&logoColor=white" />
  </p>

  <p>
    <a href="#-giới-thiệu">Giới thiệu</a> •
    <a href="#-tính-năng-cốt-lõi">Tính năng</a> •
    <a href="#-ưu--nhược-điểm">Ưu & Nhược điểm</a> •
    <a href="#-hướng-dẫn-cài-đặt">Cài đặt</a> •
    <a href="#-hướng-dẫn-sử-dụng">Sử dụng</a>
  </p>
</div>

---

## 🌟 Giới thiệu

**Neuro-Nav** là một Chrome Extension thế hệ mới được xây dựng dành riêng cho Software Engineers, Researchers và Power Users — những người hàng ngày phải đối mặt với tình trạng phân mảnh thông tin, mở hàng chục tab trình duyệt cùng lúc và liên tục bị mất ngữ cảnh làm việc (context switching).

Neuro-Nav biến trình duyệt của bạn từ một "cửa sổ lướt web" thành một **Môi trường hoạt động thông minh (Micro-OS)**. Với công nghệ RAG hoàn toàn offline, hệ thống đồ thị mạng nhện (Graph Mapping) và quản lý tab theo phong cách Git-Flow, mọi tài liệu bạn đọc đều trở thành một phần của "bộ não kỹ thuật số".

## 🏷️ Release Notes (v1.0.0)

Phiên bản khởi chạy đầu tiên của Neuro-Nav. Bao gồm các chức năng cốt lõi đã hoàn thiện:
- **Core Framework:** Trải nghiệm mượt mà với React 18, Vite, Tailwind CSS v4 và chuẩn Manifest V3.
- **Git-flow Tabs:** Hỗ trợ Branching (`feat/*`, `chill/*`...), Stash & Pop, cùng hệ thống Workspace Management.
- **Semantic Search:** Tích hợp bộ máy tìm kiếm cục bộ (Orama in-memory), index tối đa 5,000 trang gần nhất qua phím tắt `Cmd+K`.
- **Graph Visualization:** Vẽ bản đồ 2D quá trình lướt web (Browsing Telemetry) tự động bằng D3.js.
- **P2P Sync:** Tính năng chia sẻ không-máy-chủ, đồng bộ Workspace ngang hàng qua giao thức WebRTC (PeerJS).
- **Auto-Maintenance:** Tiến trình chạy ngầm giúp dọn rác bộ nhớ tự động mỗi 24h và trích xuất dữ liệu DOM không gây giật lag (sử dụng `requestIdleCallback`).

## ✨ Tính năng cốt lõi

### 1. 🔀 Git-Flow Tabs & Smart Workspaces
Thay vì quản lý tab thủ công, hãy gom chúng lại thành các luồng làm việc.
* **Workspace:** Lưu toàn bộ tab của một dự án (VD: *Next.js docs, Supabase, Github*) vào một Workspace định dạng JSON. Dễ dàng import/export.
* **Branching (Nhánh):** Sử dụng `nav checkout feat/auth` để lưu toàn bộ tab hiện tại và chuyển sang một set tab hoàn toàn mới chỉ trong 1 click.
* **Stash & Pop:** Màn hình quá lộn xộn? "Stash" (giấu) tất cả các tab vào bộ nhớ tạm để có một màn hình sạch sẽ, và "Pop" (phục hồi) lại nguyên vẹn khi bạn cần.

### 2. 🧠 The Brain: Orama Local Semantic Search
Dữ liệu của bạn, nằm trên máy của bạn.
* **DOM Extraction:** Bóc tách phần văn bản cốt lõi của các bài báo, tài liệu lập trình sau 15 giây bạn đọc. Loại bỏ quảng cáo và menu rác.
* **In-Memory Search:** Lưu trữ tối đa 5,000 trang gần nhất bằng cơ sở dữ liệu Orama siêu nhẹ (< 80MB RAM).
* **Command Palette:** Bấm `Cmd/Ctrl + K` để gọi thanh tìm kiếm. Gõ "cách config RAM WSL" và Neuro-Nav sẽ tìm lại đúng thread StackOverflow bạn đã đọc 2 tuần trước.

### 3. 🌐 Môi trường Cộng sinh (Symbiotic) & P2P
* **WebRTC Peer-to-Peer:** Gửi toàn bộ Workspace JSON cho đồng nghiệp mà không cần qua bất kỳ server trung gian nào. Kết nối siêu tốc độ ngay cả khi chỉ dùng mạng LAN.
* **Intent Blocker (Ngăn xao nhãng):** Khi bạn đang ở nhánh code (`feat/*`), extension sẽ hiển thị cảnh báo bằng giao diện Glassmorphism nếu bạn lỡ tay gõ URL vào Facebook hay Reddit.

### 4. 🕸️ Telemetry: Bản đồ sao (Graph Mapping)
* Trực quan hóa toàn bộ lịch sử duyệt web thành một bản đồ mạng nhện 2D (D3.js). Nhìn rõ các luồng click và sự liên kết giữa các nguồn tài liệu research.

---

## ⚖️ Ưu & Nhược điểm

### ✅ Ưu điểm (Pros)
* **100% Privacy & Offline:** Mọi dữ liệu (Vector DB, Tabs, History) đều được xử lý cục bộ trên IndexedDB của trình duyệt. Không có dữ liệu nào bị gửi về Cloud.
* **Hiệu năng cực cao:** Sử dụng React + Tailwind CSS v4, gói extension chỉ nặng ~300KB.
* **UX Đột phá:** Giao diện tối giản mang âm hưởng Glassmorphism, thiết kế "Tech/Neuro" tối màu không làm chói mắt.
* **Tối ưu RAM:** Có cơ chế Auto-Pruning (dọn rác 24h/lần) và giới hạn index thông minh giúp Chrome không bị phình to.

### ❌ Nhược điểm (Cons)
* **Chỉ hỗ trợ Desktop:** Các tính năng mạnh mẽ về quản lý tab và P2P không khả dụng trên trình duyệt Mobile.
* **Đang trong giai đoạn v1.0.0:** Tính năng đồng bộ P2P tuy đã hoạt động nhưng nếu gửi khối dữ liệu quá lớn (vài trăm MB vector) có thể gây đơ luồng chính cục bộ.
* **Chưa có WebGPU LLM:** Tạm thời đã lược bỏ tính năng load mô hình AI (như Phi-3) bằng card đồ họa để giữ dung lượng nhẹ cho bản phát hành đầu tiên.

---

## 💻 Nền tảng Hỗ trợ

| Nền tảng | Trạng thái | Ghi chú |
| :--- | :---: | :--- |
| **Google Chrome** | ✅ Hoàn hảo | Hỗ trợ 100% tính năng (từ bản 114+). |
| **Microsoft Edge** | ✅ Tốt | Hoạt động mượt mà. Khuyên dùng Edge Chromium bản mới nhất. |
| **Brave** | ✅ Tốt | Chạy tốt, nhưng tính năng P2P WebRTC có thể bị chặn bởi Shields (cần cấu hình lại). |
| **Arc Browser** | ⚠️ Hạn chế | Các phím tắt `Cmd+K` có thể xung đột với phím tắt mặc định của Arc. |
| **Firefox / Safari** | ❌ Không hỗ trợ | Sử dụng các API riêng của Chromium (`chrome.debugger`, `Manifest V3` nâng cao). |
| **Mobile (Android/iOS)** | ❌ Không hỗ trợ | Extension hiện tại chỉ thiết kế dành cho Desktop. |

---

## 🚀 Hướng dẫn Cài đặt

1. Clone repository này về máy:
   ```bash
   git clone https://github.com/neuro-nav/neuro-nav.git
   cd neuro-nav/apps/extension
   ```
2. Cài đặt dependencies và build:
   ```bash
   npm install
   npm run build
   ```
3. Cài đặt vào Google Chrome:
   * Mở `chrome://extensions/`
   * Bật chế độ **Developer mode** ở góc phải trên.
   * Chọn **Load unpacked** và trỏ đến thư mục `apps/extension/dist/`.

*(Hoặc bạn có thể tải thẳng file `neuro-nav-extension.zip` từ trang Releases và kéo thả vào Chrome).*

---

## 💡 Hướng dẫn Sử dụng

1. **Khởi động:** Click vào icon bộ não của Neuro-Nav trên thanh công cụ của Chrome hoặc bấm phím tắt `Ctrl + Shift + N` (Windows) / `Cmd + Shift + N` (Mac).
2. **Lưu nhánh làm việc:** Ở mục **Branches**, chọn prefix `feat/` và gõ tên task (ví dụ: `login-api`), bấm Create. Hệ thống sẽ gom các tab hiện tại vào nhánh này.
3. **Tìm kiếm bằng AI:** Bất cứ lúc nào đang lướt web, bấm `Cmd/Ctrl + K` để gọi Command Palette, gõ từ khóa ý nghĩa để lục lọi lại những trang tài liệu bạn đã đọc.
4. **Chia sẻ P2P:** Chuyển sang tab **Peers**, lấy `Peer ID` của bạn gửi cho đồng nghiệp. Nhập ID của đồng nghiệp để kết nối trực tiếp và bấm *Share Workspace*.

---

## 🖥️ CLI Bridge (lệnh `nav`)

Điều khiển trình duyệt từ terminal. CLI sẽ **tự động khởi động daemon** nền — không cần cấu hình thủ công.

### Kiến trúc

```
Terminal (nav-cli)  ── WebSocket ──→  nav-daemon (:9500)  ←── WebSocket ──  Chrome Extension
                    ── HTTP POST ──→  nav-daemon (:9498)
```

> **Toàn bộ giao tiếp chỉ diễn ra trên máy cục bộ** (`127.0.0.1`). Không có dữ liệu nào rời khỏi máy bạn.

### Cài đặt

**Từ source (khuyến nghị):**

```bash
# Clone repo xong, chạy:
cd packages/nav-server && npm link
cd ../nav-cli && npm link @neuro-nav/server && npm link
```

Sau khi link xong, lệnh `nav` khả dụng ở bất kỳ đâu trong terminal.

**Từ npm** *(sắp có — sau khi publish):*

```bash
npm install -g @neuro-nav/cli
```

### Bảng lệnh

Chạy `nav help` để xem toàn bộ các lệnh khả dụng:

| Lệnh | Mô tả |
| :--- | :--- |
| `nav help` | Hiển thị toàn bộ lệnh khả dụng |
| `nav checkout <tên>` | Chuyển nhánh trình duyệt (viết tắt) |
| `nav branch list` | Liệt kê tất cả các nhánh đã lưu |
| `nav branch checkout <tên>` | Chuyển sang một nhánh |
| `nav branch create <tên>` | Tạo và kích hoạt nhánh mới |
| `nav branch delete <id>` | Xóa nhánh theo ID |
| `nav workspace list` | Liệt kê tất cả workspace đã lưu |
| `nav stash` | Cất toàn bộ tab hiện tại vào bộ nhớ tạm |
| `nav stash pop` | Khôi phục stash gần nhất |
| `nav stash list` | Xem danh sách các stash |
| `nav search <từ khóa>` | Tìm kiếm ngữ nghĩa các trang đã index |
| `nav status` | Kiểm tra kết nối daemon & extension |
| `nav ping` | Test kết nối nhanh |

### Ví dụ sử dụng

```bash
# Chuyển ngữ cảnh trình duyệt sang nhánh feature
nav checkout feat/auth-system

# Cất tab hiện tại và bắt đầu mới
nav stash
nav branch create feat/new-api

# Tìm lại trang bạn đọc tuần trước
nav search "kubernetes helm values"

# Kiểm tra hệ thống đã kết nối chưa
nav status
# → Daemon:    ● Đang chạy
# → Extension: ● Đã kết nối
```

### Biến môi trường

| Biến | Mặc định | Mô tả |
| :--- | :--- | :--- |
| `NAV_SERVER` | `ws://127.0.0.1:9500` | URL WebSocket cho nav-daemon |
| `NAV_HTTP` | `http://127.0.0.1:9498` | URL HTTP cho nav-daemon |

### Cơ chế hoạt động

1. Bạn gõ `nav checkout feat/auth` trên terminal.
2. CLI thử kết nối tới WebSocket daemon. Nếu daemon chưa chạy, CLI sẽ **tự động khởi động daemon** chạy nền.
3. Daemon chuyển tiếp lệnh tới Service Worker của Chrome Extension.
4. Extension lưu lại các tab hiện tại, mở các tab của nhánh mới, và gửi phản hồi thành công qua cùng kênh liên lạc.
5. Daemon tự tắt sau **10 phút** không hoạt động để tiết kiệm tài nguyên.

---

<div align="center">
  <sub>Được thiết kế với 💜 dành cho những người thợ xây dựng tương lai.</sub>
</div>
