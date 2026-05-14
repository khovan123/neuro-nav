# PRODUCT SPECIFICATION: NEURO-NAV (THE DEVELOPERS MICRO-OS)

**Version:** 1.5.0
**Target Platform:** Chromium-based Browsers (Chrome, Edge) & Windows/WSL2 Environment
**Architecture Pattern:** Clean Architecture & Event-Driven Services

## 1. Narrative Charter Statement

Neuro-Nav là một Hệ điều hành vi mô (Micro-OS) tích hợp thẳng vào trình duyệt, được thiết kế chuyên biệt cho kỹ sư phần mềm. Bằng cách kết hợp mô hình quản lý phiên bản (Git-flow), trí tuệ nhân tạo cục bộ (ONNX Runtime WASM) và giao thức mạng P2P (WebRTC), dự án giải quyết triệt để tình trạng phân mảnh ngữ cảnh khi xử lý các hệ thống phức tạp (như microservices hay nested repositories). Toàn bộ dữ liệu được lưu trữ và tính toán 100% tại máy khách (Client-side), đảm bảo tốc độ phản hồi tính bằng mili-giây và bảo mật riêng tư tuyệt đối.

---

## 2. System Architecture Design

Hệ thống tuân thủ Clean Architecture, tách biệt thành 4 phân lớp:

1. **Presentation Layer (UI/UX):** Xây dựng bằng ReactJS + Tailwind CSS v4. Quản lý State bằng Redux Toolkit. Giao diện Glassmorphism tối màu, hiệu ứng micro-animation, responsive trong popup 380×540px.
2. **Background Processing (Service Worker):** Đóng vai trò là Message Broker. Quản lý hàng đợi sự kiện, WebSocket daemon connection (exponential backoff), alarm scheduler, và Native Messaging bridge.
3. **Local Core Engine:**
   * *Embedding Pipeline:* Sử dụng `@huggingface/transformers` + ONNX Runtime WASM (`all-MiniLM-L6-v2`) trong Web Worker qua Offscreen Document, tuân thủ MV3 Service Worker constraints.
   * *Search Index:* Orama in-memory DB cho full-text + semantic search (lên tới 5,000 pages).
   * *Graph Store:* IndexedDB lưu trữ browsing graph (nodes, edges), hỗ trợ lọc theo branch.
4. **External Interfaces:**
   * Local WebSocket Server `:9500` (giao tiếp realtime Extension ↔ CLI).
   * Local HTTP Server `:9498` (fallback REST API cho CLI).
   * WebRTC Data Channels (Đồng bộ P2P không cần máy chủ).
   * Chrome Native Messaging API (Tự động khởi động daemon từ extension).

---

## 3. Trạng Thái Phát Triển & Lộ Trình

*Nguyên tắc thực thi: Mỗi Phase yêu cầu hoàn thiện 100% Core Logic, pass toàn bộ build trước khi chuyển sang Phase tiếp theo.*

### PHASE 1: THE FOUNDATION (Hạ tầng Cốt lõi & Quản lý Session) — ✅ HOÀN THÀNH

* **1.1. Core Boilerplate & UI:** ReactJS + Tailwind CSS v4 (CSS-first config). Message Passing bridge giữa Popup ↔ Service Worker. Design system với HSL tokens, glassmorphism, micro-animations.
* **1.2. Active State Management:** Real-time tab tracking, IndexedDB persistence.
* **1.3. Smart Workspaces:** Lưu/khôi phục bộ tab dưới dạng JSON. Export/Import workspaces.
* **1.4. Auto-Pruning:** Chrome Alarm dọn dẹp dữ liệu cũ mỗi 24h.

### PHASE 2: VERSION CONTROL & TERMINAL (Git-flow & CLI Integration) — ✅ HOÀN THÀNH

* **2.1. Session Branching:** Checkout/switch nhánh trình duyệt. Mỗi branch lưu snapshot tabs độc lập. **Browsing graph được tách riêng theo từng branch.**
* **2.2. Stash & Pop Memory:** Đóng băng toàn bộ tabs vào bộ nhớ tạm, khôi phục nguyên vẹn.
* **2.3. WebSocket Daemon (nav-server):** Port `:9500` (WS) + `:9498` (HTTP). Exponential backoff reconnection với HTTP probe để tránh `ERR_CONNECTION_REFUSED` noise trong console.
* **2.4. `nav` CLI Tool:** CLI tự khởi động daemon, hỗ trợ `checkout`, `branch`, `stash`, `search`, `scan`, `status`, `setup-native-host`.
* **2.5. Native Messaging:** Extension tự động spawn daemon qua `com.neuronav.daemon` host manifest. Graceful fallback nếu host chưa được cài.

### PHASE 3: THE BRAIN (Trí tuệ nhân tạo cục bộ - Local Embedding) — ✅ HOÀN THÀNH

* **3.1. DOM Text Extraction:** Content script trích xuất nội dung sau `document_idle` qua `requestIdleCallback`.
* **3.2. Local Vectorization (WASM):** `@huggingface/transformers` + ONNX Runtime WASM trong Web Worker, chạy qua Offscreen Document bridge (MV3 compliant). Model `all-MiniLM-L6-v2` (~22MB, cached IndexedDB).
* **3.3. Semantic Command Palette:** `Cmd/Ctrl + K` mở search overlay. Orama in-memory DB tìm kiếm ngữ nghĩa. Chunk upsert bằng direct ID-based removal (không dùng full-text search để tránh duplicate).
* **3.4. Auto-Tagging:** Phân loại trang tự động (`tech`, `docs`, `social`, `media`, `shopping`, `email`).

### PHASE 4: TELEMETRY & VISUALIZATION — ✅ HOÀN THÀNH

* **4.1. Browsing Graph:** D3.js force-directed graph. Convex hull clustering theo domain. **Graph nodes được ghi và lọc theo branch hiện tại** — mỗi branch có bản đồ duyệt web riêng.
* **4.2. Score Algorithm:** `log(visits) × recency × log(linkCount)` — nodes quan trọng hiển thị lớn hơn.
* **4.3. Category Legend:** Color-coded bằng palette HSL cho từng loại (tech, docs, social, media...).

### PHASE 5: SYMBIOTIC ENVIRONMENT (P2P & Ecosystem) — ✅ HOÀN THÀNH

* **5.1. P2P WebRTC Sync:** PeerJS-based handshake. Gửi/nhận Workspace JSON qua WebRTC Data Channels. Không qua server trung gian.
* **5.2. Project Auto-Discovery:** `nav scan [path] [--watch]` quét `package.json`, `.git`, stack detection.

### PHASE 6: BUILD & PRODUCTION OPTIMIZATION — ✅ HOÀN THÀNH

* **6.1. Minified Builds:** Vite build với `minify: true`, giảm ~60% bundle size (JS ~3.3MB → ~1.4MB).
* **6.2. Source Maps:** Enabled cho debugging.
* **6.3. Chunk Size Management:** Warning limit 1000KB cho embedding worker (~870KB, ML library).
* **6.4. Quiet Transformers Plugin:** Custom Vite plugin chuyển đổi `console.warn` → `console.log` cho HuggingFace library noise.
* **6.5. Native Tooltips:** Sử dụng `title` attribute thay vì CSS tooltip để tránh bị clip bởi popup viewport boundary.

### PHASE 7: TAB LIFECYCLE & UX POLISH — ✅ HOÀN THÀNH

* **7.1. Collapse/Expand Checkout:** Chuyển phiên sử dụng `chrome.tabGroups.update({ collapsed: true })` + `chrome.tabs.discard()` thay vì xóa tab. Group vẫn hiển thị trên tab bar, đồng thời giải phóng RAM.
* **7.2. Bảo vệ Race Condition Auto-save:** Bộ chặn `groupsBeingClosed` ngăn debounced auto-save ghi đè IndexedDB bằng mảng rỗng khi group đang bị đóng.
* **7.3. Nhận diện Branch theo Group:** Popup xác định branch đang active bằng cách đọc tên Chrome group của tab hiện tại, không dựa vào window mapping cũ — chính xác cả khi nhiều group cùng tồn tại.
* **7.4. Ghi nhớ trang Navigation:** Trang nav cuối cùng được lưu vào `chrome.storage.local` và khôi phục khi mở lại popup.
* **7.5. Hiệu suất Tab List:** Debounce sự kiện tab (200ms batching) và loại bỏ flash-clear (`setTabs([])`) để xóa bỏ hiện tượng giật trong danh sách Open Tabs.
* **7.6. Gộp Web Map:** Xóa mục "Web Map" riêng lẻ — đồ thị duyệt web giờ được nhúng trong trang History.

---

## 4. Quyết Định Kỹ Thuật

### 1. CLI Transport Mechanism (MV3 Sandbox)

**Quyết định: Companion WebSocket server**

WebSocket server chạy ở process riêng biệt (nav-server), không nằm trong Background Script. CLI chỉ cần kết nối tới `ws://127.0.0.1:9500`. Extension kết nối vào cùng daemon với exponential backoff (max 2 phút) và silent HTTP probe trước khi mở WebSocket.

### 2. P2P Signaling

**Quyết định: PeerJS Cloud**

Sử dụng PeerJS Cloud cho handshake ban đầu qua Peer-ID ngắn gọn. Dữ liệu thực sự truyền P2P qua WebRTC Data Channels, đảm bảo riêng tư.

### 3. AI Pipeline Architecture (MV3)

**Quyết định: Offscreen Document + Web Worker**

Service Workers không thể khởi tạo Web Workers trực tiếp. Sử dụng Offscreen Document làm bridge, hosting ONNX inference worker trong DOM context chuẩn. Pipeline: Service Worker → Offscreen Document → Web Worker (ONNX Runtime WASM).

### 4. TailwindCSS Version

**Quyết định: TailwindCSS v4**

CSS-first config (không cần `tailwind.config.js`). Giảm bundle size, tăng tốc build. Custom `@theme` block với HSL design tokens.

### 5. Bundle Size Strategy

**Quyết định: Minify + Accept ML overhead**

Extension bundle ~1.4MB JS (minified). WASM binary ~21.5MB (ONNX Runtime). Đây là chi phí tất yếu cho local ML — chấp nhận để giữ offline-first architecture. Lazy model loading khi cần embedding lần đầu.

### 6. Tab Group Lifecycle (Collapse vs Close)

**Quyết định: Collapse + Discard (không phá hủy)**

Chrome Extension API không có phương thức tương đương lệnh "Close Group" trên giao diện (ẩn group nhưng vẫn giữ lại). Sử dụng `chrome.tabs.remove()` sẽ xóa hoàn toàn group. Giải pháp: dùng `chrome.tabGroups.update({ collapsed: true })` thu gọn group trên tab bar, sau đó `chrome.tabs.discard()` từng tab để ngủ đông RAM. Cách này giữ nguyên danh tính group, tránh mất dữ liệu, và cho phép user click vào label để mở rộng lại thủ công.

---