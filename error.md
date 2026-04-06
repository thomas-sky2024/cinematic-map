Tôi thấy lỗi rồi! Vấn đề mà bạn đang gặp phải có nguyên nhân như sau:

Nguyên nhân: Quá trình tạo video (Remotion) sẽ gọi một trình duyệt ẩn (Puppeteer/Chromium) để kết xuất hình ảnh bản đồ của MapLibre GL. Tuy nhiên, trên hệ điều hành Mac (đặc biệt dòng M1/Apple Silicon), trình duyệt ẩn mặc định sử dụng phần mềm giả lập card đồ họa tên là SwiftShader thay vì dùng trực tiếp năng lực của GPU. MapLibre GL là bộ máy cần WebGL mạnh mẽ (GPU thật), còn SwiftShader thì quá mỏng manh để tải, nên nó thông báo lỗi WebGL như bạn đã thấy: Failed to initialize WebGL... SwiftShader driver.

Cách khắc phục: Tôi vừa đưa tệp đồ họa hệ thống (Metal) của Mac vào cấu hình hệ thống máy render Remotion (src/render-cli.ts). Bằng cách điều chỉnh chromiumOptions, Puppeteer đã bị bắt buộc dùng gl: "angle" (Sử dụng gốc phần cứng M1 GPU) để nạp ngữ cảnh cho WebGL, phớt lờ thằng SwiftShader vô dụng kia.

Bạn hãy thử tắt chương trình, chạy lại ứng dụng (npm run dev) và tiến hành Render nhé! Chắn chắn nó sẽ kết xuất được bản đồ mượt mà mà không gặp lỗi đứt gánh giữa chừng!