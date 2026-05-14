<div align="right">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/Language-English-blue?style=for-the-badge&logo=google-translate"></a>
  <a href="README-vi.md"><img alt="Tiếng Việt" src="https://img.shields.io/badge/Ngôn_ngữ-Tiếng_Việt-red?style=for-the-badge&logo=google-translate"></a>
</div>

<div align="center">
  <img src="./apps/extension/public/icons/icon-128.png" alt="Neuro-Nav Logo" width="128" />
  <h1>🧠 Neuro-Nav</h1>
  <p><strong>The Developer's Micro-OS: Context management, semantic search, and AI-powered browsing for software engineers.</strong></p>
  
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-v1.5.0-blue.svg" />
    <img alt="React" src="https://img.shields.io/badge/react-%2320232a.svg?style=flat&logo=react&logoColor=%2361DAFB" />
    <img alt="TailwindCSS" src="https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=flat&logo=tailwind-css&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white" />
    <img alt="Vite" src="https://img.shields.io/badge/vite-%23646CFF.svg?style=flat&logo=vite&logoColor=white" />
    <img alt="ONNX" src="https://img.shields.io/badge/ONNX_Runtime-WASM-orange.svg" />
  </p>

  <p>
    <a href="#-giới-thiệu">Giới thiệu</a> •
    <a href="#-tính-năng-cốt-lõi">Tính năng</a> •
    <a href="#-kiến-trúc">Kiến trúc</a> •
    <a href="#-hướng-dẫn-cài-đặt">Cài đặt</a> •
    <a href="#-cli-bridge-lệnh-nav">CLI</a>
  </p>
</div>

---

## 🌟 Giới thiệu

**Neuro-Nav** là một Chrome Extension thế hệ mới được xây dựng dành riêng cho Software Engineers, Researchers và Power Users — những người hàng ngày phải đối mặt với tình trạng phân mảnh thông tin, mở hàng chục tab trình duyệt cùng lúc và liên tục bị mất ngữ cảnh làm việc (context switching).

Neuro-Nav biến trình duyệt của bạn từ một "cửa sổ lướt web" thành một **Môi trường hoạt động thông minh (Micro-OS)**. Với công nghệ AI embedding hoàn toàn offline, hệ thống đồ thị mạng nhện (Graph Mapping) theo từng phiên làm việc và quản lý tab theo phong cách Git-Flow, mọi tài liệu bạn đọc đều trở thành một phần của "bộ não kỹ thuật số".

## 🏷️ Release Notes (v1.5.0)

Phiên bản mới nhất của Neuro-Nav. Bao gồm các cải tiến đáng kể:
- **Chuyển phiên không phá hủy:** Checkout sử dụng Collapse + Discard thay vì xóa tab — group cũ vẫn hiển thị trên tab bar, giải phóng RAM mà không mất dữ liệu.
- **Bảo vệ Race Condition:** Bộ chặn `groupsBeingClosed` ngăn auto-save ghi đè dữ liệu khi group đang bị đóng.
- **Nhận diện Branch theo Group:** Popup đọc tên Chrome group của tab hiện tại thay vì dựa vào window mapping cũ.
- **Ghi nhớ trang Navigation:** Popup nhớ trang cuối cùng (Sessions, History...) khi mở lại.
- **Hiệu suất Tab List:** Debounce sự kiện tab (200ms) và loại bỏ flash-clear, xóa hiện tượng giật.
- **Gộp Web Map:** Đồ thị duyệt web giờ được nhúng trực tiếp trong trang History.
- **Core Framework:** Trải nghiệm mượt mà với React 18, Vite, Tailwind CSS v4 (CSS-first config) và chuẩn Manifest V3.
- **Git-flow Tabs:** Hỗ trợ Branching (`feat/*`, `chill/*`...), Stash & Pop, cùng hệ thống Workspace Management.
- **AI Search on-device:** Tìm kiếm vector cục bộ bằng `all-MiniLM-L6-v2` qua ONNX Runtime WASM. Toàn bộ inference chạy trên máy bạn.
- **Semantic Search:** Bộ máy tìm kiếm cục bộ (Orama in-memory DB), index tối đa 5,000 trang gần nhất qua phím tắt `Cmd+K`.
- **P2P Sync:** Đồng bộ Workspace ngang hàng qua WebRTC (PeerJS).
- **CLI Bridge:** Quy trình làm việc ưu tiên terminal với lệnh `nav`, auto-daemon.
- **Build tối ưu:** Bundle production đã minify (~1.4MB JS, giảm ~60%).

## ✨ Tính năng cốt lõi

### 1. 🔀 Git-Flow Tabs & Smart Workspaces
Thay vì quản lý tab thủ công, hãy gom chúng lại thành các luồng làm việc.
* **Workspace:** Lưu toàn bộ tab của một dự án (VD: *Next.js docs, Supabase, Github*) vào một Workspace định dạng JSON. Dễ dàng import/export.
* **Branching (Phiên làm việc):** Sử dụng `nav checkout feat/auth` để lưu toàn bộ tab hiện tại và chuyển sang một set tab hoàn toàn mới chỉ trong 1 click.
* **Stash & Pop:** Màn hình quá lộn xộn? "Stash" (giấu) tất cả các tab vào bộ nhớ tạm để có một màn hình sạch sẽ, và "Pop" (phục hồi) lại nguyên vẹn khi bạn cần.

### 2. 🧠 AI Search on-device
Dữ liệu của bạn, nằm trên máy của bạn. Không phụ thuộc cloud.
* **Vector Embeddings:** Các trang web được embedding bằng `all-MiniLM-L6-v2` chạy cục bộ qua ONNX Runtime WASM. Không cần API key hay kết nối mạng.
* **DOM Extraction:** Bóc tách phần văn bản cốt lõi của các bài báo, tài liệu lập trình tại thời điểm `document_idle` qua `requestIdleCallback`. Loại bỏ quảng cáo và menu rác.
* **In-Memory Search:** Lưu trữ tối đa 5,000 trang gần nhất bằng cơ sở dữ liệu Orama siêu nhẹ.
* **Command Palette:** Bấm `Cmd/Ctrl + K` để gọi thanh tìm kiếm. Gõ "cách config RAM WSL" và Neuro-Nav sẽ tìm lại đúng thread StackOverflow bạn đã đọc 2 tuần trước.
* **Smart Upsert:** Index chunk sử dụng direct ID-based removal để tránh lỗi duplicate khi re-crawl trang.

### 3. 🌐 Môi trường Cộng sinh (Symbiotic) & P2P
* **WebRTC Peer-to-Peer:** Gửi toàn bộ Workspace JSON cho đồng nghiệp mà không cần qua bất kỳ server trung gian nào. Kết nối siêu tốc độ ngay cả khi chỉ dùng mạng LAN.
* **Intent Blocker (Ngăn xao nhãng):** Khi bạn đang ở nhánh code (`feat/*`), extension sẽ hiển thị cảnh báo nếu bạn lỡ tay mở URL vào Facebook hay Reddit.

### 4. 🕸️ Bản đồ duyệt web theo phiên (Per-Branch Graph)
* Trực quan hóa lịch sử duyệt web thành một bản đồ mạng nhện 2D (D3.js force-directed layout).
* **Tách riêng theo phiên:** Mỗi phiên làm việc (branch) có bản đồ riêng — nodes và edges được ghi và lọc theo branch, nên chuyển phiên sẽ chỉ hiển thị context duyệt web tương ứng.
* **Cluster visualization:** Gom nhóm theo domain bằng convex hull, phân loại bằng màu sắc (tech, docs, social, media, shopping, email).
* **Thuật toán scoring:** `log(visits) × recency × log(linkCount)` — trang quan trọng hơn hiển thị node lớn hơn.

### 5. 🖥️ Terminal-First Workflow
* **CLI Bridge:** Chạy `nav checkout`, `nav search`, `nav stash` trực tiếp từ terminal.
* **Auto-Daemon:** Daemon tự khởi động và tự tắt — không cần cấu hình thủ công.
* **Native Messaging:** Extension tự động khởi động daemon khi chưa chạy, qua Chrome Native Messaging API.
* **Project Scan:** `nav scan .` phát hiện tech stack và đồng bộ context vào extension.
* **Kết nối bền vững:** Exponential backoff (tối đa 2 phút) với HTTP probe trước khi khởi tạo WebSocket. Không gây noise trong console khi daemon offline.

---

## 🏗️ Kiến trúc

```
neuro-nav/
├── apps/
│   └── extension/              # Chrome Extension (React + Vite + Tailwind v4)
│       ├── src/
│       │   ├── background/     # Service Worker — message broker & alarm scheduler
│       │   ├── core/           # Domain entities & use-cases
│       │   ├── infrastructure/ # Database, search index, AI pipeline
│       │   ├── popup/          # React UI (pages, components)
│       │   └── shared/         # Messaging, UI primitives, utilities
│       ├── offscreen.html      # Offscreen Document cho AI inference
│       └── public/             # Static assets, manifest.json
└── packages/
    ├── nav-server/             # WebSocket + HTTP daemon (:9500 / :9498)
    └── nav-cli/                # Terminal CLI (lệnh `nav`)
        └── native-host.ts      # Chrome Native Messaging host
```

### AI Pipeline (Tuân thủ Manifest V3)

```
Service Worker           Offscreen Document         Web Worker
┌──────────────┐    ┌───────────────────┐    ┌─────────────────────┐
│ embeddings   │───▶│ offscreen.html    │───▶│ embedding.worker.ts │
│ Service      │    │ message bridge    │    │ ONNX Runtime WASM   │
│              │◀───│                   │◀───│ all-MiniLM-L6-v2    │
└──────────────┘    └───────────────────┘    └─────────────────────┘
```

> Service Workers không thể khởi tạo Web Workers trực tiếp. Offscreen Document đóng vai trò cầu nối, hosting ONNX inference worker trong DOM context chuẩn.

### Build Output

| File | Kích thước | Gzip | Nội dung |
| :--- | :--- | :--- | :--- |
| `embedding-worker.js` | 870 KB | 228 KB | HuggingFace Transformers + ONNX bindings |
| `popup.js` | 247 KB | 74 KB | Toàn bộ popup pages & Redux store |
| `index.js` | 206 KB | 62 KB | React + ReactDOM shared chunk |
| `searchIndex.js` | 86 KB | 28 KB | Orama search engine |
| `background.js` | 25 KB | 8 KB | Service Worker |
| ONNX WASM | 21.5 MB | 5 MB | ML inference runtime (cached) |

---

## ⚖️ Ưu & Nhược điểm

### ✅ Ưu điểm (Pros)
* **100% Privacy & Offline:** Mọi dữ liệu (Vector DB, Tabs, History, Graph) đều được xử lý cục bộ trên IndexedDB. AI model chạy on-device qua WASM — không gửi dữ liệu về Cloud.
* **Bundle tối ưu:** Extension JS ~1.4MB sau khi minify (không tính WASM model). AI inference chạy trong worker thread riêng.
* **UX Đột phá:** Giao diện tối giản mang âm hưởng Glassmorphism, thiết kế "Tech/Neuro" tối màu, hiệu ứng micro-animation.
* **Tối ưu RAM:** Có cơ chế Auto-Pruning (dọn rác 24h/lần) và giới hạn index thông minh giúp Chrome không bị phình to.
* **Context theo phiên:** Browsing graph, trạng thái tab, workspace đều được tách riêng theo từng phiên làm việc (branch).

### ❌ Nhược điểm (Cons)
* **Chỉ hỗ trợ Desktop:** Các tính năng mạnh mẽ về quản lý tab và P2P không khả dụng trên trình duyệt Mobile.
* **Tải model lần đầu:** Lần đầu khởi chạy sẽ tải ONNX model ~22MB (cache trong IndexedDB cho các lần sau).
* **Chưa có WebGPU LLM:** Tạm thời chưa tích hợp mô hình ngôn ngữ lớn (như Phi-3) bằng card đồ họa — sẽ có trong phiên bản tiếp theo.

---

## 💻 Nền tảng Hỗ trợ

| Nền tảng | Trạng thái | Ghi chú |
| :--- | :---: | :--- |
| **Google Chrome** | ✅ Hoàn hảo | Hỗ trợ 100% tính năng (từ bản 114+). |
| **Microsoft Edge** | ✅ Tốt | Hoạt động mượt mà. Khuyên dùng Edge Chromium bản mới nhất. |
| **Brave** | ✅ Tốt | Chạy tốt, nhưng tính năng P2P WebRTC có thể bị chặn bởi Shields (cần cấu hình lại). |
| **Arc Browser** | ⚠️ Hạn chế | Các phím tắt `Cmd+K` có thể xung đột với phím tắt mặc định của Arc. |
| **Firefox / Safari** | ❌ Không hỗ trợ | Sử dụng các API riêng của Chromium (Manifest V3, `chrome.offscreen`). |
| **Mobile (Android/iOS)** | ❌ Không hỗ trợ | Extension hiện tại chỉ thiết kế dành cho Desktop. |

---

## 🚀 Hướng dẫn Cài đặt

### 1. Extension

```bash
git clone https://github.com/neuro-nav/neuro-nav.git
cd neuro-nav
npm install
npm run build
```

Cài đặt vào Google Chrome:
1. Mở `chrome://extensions/`
2. Bật chế độ **Developer mode** ở góc phải trên.
3. Chọn **Load unpacked** và trỏ đến thư mục `apps/extension/dist/`.

### 2. CLI

```bash
# Từ source (monorepo):
npm run build:all
cd packages/nav-server && npm link
cd ../nav-cli && npm link @neuro-nav/server && npm link
```

Sau khi link xong, lệnh `nav` khả dụng ở bất kỳ đâu trong terminal.

### 3. Native Messaging (Auto-Start Daemon)

Để extension tự khởi động daemon:

```bash
# Tìm extension ID tại chrome://extensions
nav setup-native-host --extension-id=<extension-id-của-bạn>
```

Lệnh này cài đặt Native Messaging host manifest để extension có thể spawn daemon khi cần. Reload extension sau khi setup.

---

## 💡 Hướng dẫn Sử dụng

1. **Khởi động:** Click vào icon Neuro-Nav trên thanh công cụ Chrome hoặc bấm phím tắt `Ctrl+Shift+N` (Windows) / `Cmd+Shift+N` (Mac).
2. **Lưu phiên làm việc:** Ở mục **Sessions**, chọn prefix `feat/` và gõ tên task (ví dụ: `login-api`), bấm Create. Hệ thống sẽ gom các tab hiện tại vào phiên này.
3. **Tìm kiếm bằng AI:** Bất cứ lúc nào đang lướt web, bấm `Cmd/Ctrl + K` để gọi Command Palette, gõ từ khóa ý nghĩa để lục lọi lại những trang tài liệu bạn đã đọc.
4. **Bản đồ duyệt web:** Chuyển sang tab **History** để xem bản đồ trực quan và dòng thời gian duyệt web của phiên hiện tại.
5. **Chia sẻ P2P:** Chuyển sang tab **Team**, lấy ID của bạn gửi cho đồng nghiệp. Nhập ID của đồng nghiệp để kết nối trực tiếp và bấm *Share Workspace*.

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

### Bảng lệnh

Chạy `nav help` để xem toàn bộ các lệnh khả dụng:

| Lệnh | Mô tả |
| :--- | :--- |
| `nav help` | Hiển thị toàn bộ lệnh khả dụng |
| `nav init` | Thiết lập lần đầu (tạo secret key) |
| `nav checkout <tên>` | Chuyển phiên trình duyệt (viết tắt) |
| `nav branch list` | Liệt kê tất cả các phiên đã lưu |
| `nav branch checkout <tên>` | Chuyển sang một phiên |
| `nav branch checkout <tên> --new` | Tạo phiên mới và chuyển sang |
| `nav branch create <tên>` | Tạo và kích hoạt phiên mới |
| `nav branch delete <id>` | Xóa phiên theo ID |
| `nav workspace list` | Liệt kê tất cả workspace đã lưu |
| `nav stash` | Cất toàn bộ tab hiện tại vào bộ nhớ tạm |
| `nav stash pop` | Khôi phục stash gần nhất |
| `nav stash list` | Xem danh sách các stash |
| `nav search <từ khóa>` | Tìm kiếm ngữ nghĩa các trang đã index |
| `nav scan [path] [--watch]` | Quét thư mục dự án để phát hiện tech stack |
| `nav status` | Kiểm tra kết nối daemon & extension |
| `nav ping` | Test kết nối nhanh |
| `nav setup-native-host` | Cài đặt Chrome Native Messaging host |

### Ví dụ sử dụng

```bash
# Chuyển ngữ cảnh trình duyệt sang phiên feature
nav checkout feat/auth-system

# Cất tab hiện tại và bắt đầu mới
nav stash
nav branch create feat/new-api

# Tìm lại trang bạn đọc tuần trước
nav search "kubernetes helm values"

# Quét dự án để phát hiện tech stack
nav scan . --watch

# Kiểm tra hệ thống đã kết nối chưa
nav status
# → Server:    ● Đang chạy
# → Extension: ● Đã kết nối

# Cài đặt auto-start cho daemon
nav setup-native-host --extension-id=abcdef1234567890
```

### Biến môi trường

| Biến | Mặc định | Mô tả |
| :--- | :--- | :--- |
| `NAV_SERVER` | `ws://127.0.0.1:9500` | URL WebSocket cho nav-daemon |
| `NAV_HTTP` | `http://127.0.0.1:9498` | URL HTTP cho nav-daemon |
| `NAV_SECRET` | *(default token)* | Token xác thực cho daemon |

### Cơ chế hoạt động

1. Bạn gõ `nav checkout feat/auth` trên terminal.
2. CLI thử kết nối tới WebSocket daemon. Nếu daemon chưa chạy, CLI sẽ **tự động khởi động daemon** chạy nền.
3. Daemon chuyển tiếp lệnh tới Service Worker của Chrome Extension.
4. Extension lưu lại các tab hiện tại, mở các tab của phiên mới, và gửi phản hồi thành công qua cùng kênh liên lạc.
5. Daemon tự tắt sau **10 phút** không hoạt động để tiết kiệm tài nguyên.

---

<div align="center">
  <sub>Được thiết kế với 💜 dành cho những người thợ xây dựng tương lai.</sub>
</div>
