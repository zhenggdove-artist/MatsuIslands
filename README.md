# Matsu Islands｜霧島電台

以馬祖海島、霧氣與戰地聚落為題材的輕量 3D 遊戲原型。專案由原始的 Backrooms 3D 編輯器互動概念重新整理而成，保留角色漫遊、第三人稱視角與空間建造核心，適合直接發佈到 GitHub Pages。

## 遊戲內容

- WASD 移動、Shift 奔跑、Space 跳躍、滑鼠旋轉視角、滾輪縮放
- 三座可互動信號台與完成目標回饋
- `B` 切換空間建造模式
- 可放置防風牆、觀景台、石柱、引路燈，並支援旋轉與移除
- 場景自動儲存到 `localStorage`，也可匯出 JSON
- 桌面與觸控裝置皆有基礎操作介面
- 提供 `window.render_game_to_text()` 與 `window.advanceTime(ms)` 測試介面

## 本機預覽

這個網站使用 ES Modules，請透過本機伺服器開啟，不要直接雙擊 HTML：

```powershell
python -m http.server 8000
```

接著開啟 `http://localhost:8000/`。

## 發佈 GitHub Pages

1. 將檔案 commit 並 push 到 `main` branch。
2. 在 GitHub repository 開啟 **Settings → Pages**。
3. **Build and deployment** 選擇 **Deploy from a branch**。
4. Branch 選 `main`，資料夾選 `/(root)`，按 **Save**。
5. 等待 GitHub 完成部署，網址通常會是 `https://zhenggdove-artist.github.io/MatsuIslands/`。

## 檔案

- `index.html`：介面與 GitHub Pages 進入點
- `styles.css`：視覺樣式與響應式配置
- `game.js`：3D 場景、角色控制、建造、儲存與任務邏輯
