PDAO Scoreboard & Admin Webapp
================

Build Instruction
-----------------

First, install a modern verison of node.js (node 6.0+ and [nvm][nvm] is highly recommended).
After activating a node environment, we can install the dependencies.

Then you need to install python3 and its packages, and you also need to install wsgi production server for flask.


If you work on Linux, you can simply use the command `./setup.sh` to establish the environment.
If not, you can use the following to build the application:
```
sudo apt install nodejs npm python3-flask python3-flask-cors python3-requests gunicorn -y
npm install;npm run build
```

Then you need to build the contest data by the Buildtool, make sure use have check the csv file the folder:
```
cd BuildTool;python3 BuildTool.py
```
How to deploy scoreboard and admin server:
- Scoreboard:
    
    The directory `dist/` will contain the file tree of the built web application,
    which can be served using *static* web servers.
    For web servers, we recommend [`http-server -c-1`][http-server] (disable cache) or [nginx][nginx] or apache server.

    For development, try `npm start --verbose`.
- Admin and api for scoreboard:

    The directory `backend/` will contain the webapp for admin and api. If you are on Linux, you can simply use the shell script `start.sh ${listen port}` in the root folder, and you can stop the server by the `stop_server.sh`

    If you want to start the server without using the script, you can simply use the command in the directory `backend/`
    ```
    gunicorn -b 0.0.0.0:${listen port} --workers=8 --threads=8 server:app
    ```

    For development, you can use `python3 run.py` in the directory `backend/`

The scoreboard webapp is adapted from [Spotboard](https://github.com/spotboard/spotboard)

[nvm]: https://github.com/creationix/nvm
[http-server]: https://www.npmjs.com/package/http-server
[nginx]: http://nginx.org/



## Getting Started
**Windows ver.**

要先去裝 node.js

開前端記分板：
```bash
npm install
npm run build
python -m http.server 3001 -d dist
```
之後去瀏覽器開 `localhost:3001`

開後端：
先裝套件
```bash
pip3 install flask flask-cors requests
```
到 /backend 資料夾下執行
```bash
python3 run.py 
```
**氣球分發系統**<br>
用瀏覽器開 `localhost:3000/pdao_be/admin` 輸入帳密

**api docs**<br>
用瀏覽器開 `localhost:3000/pdao_be/api/docs`


## 專案結構

- `/src` : 放記分板相關檔案
- `/backend` : 放 api 和分氣球系統相關檔案

## 開始使用

### github 拿 code

**複製專案庫 (repo)：**<br>
第一次弄的時候要把 repo 拉到自己的電腦：
```bash
git clone https://github.com/ffting/pdao_scoreboard_test.git
cd pdao_scoreboard_test
```

之後只要更新分支就好

```bash
git pull origin main
```


## Git 工作流程

⚠️ **重要提醒**：**絕對不要直接在 `main` 分支上進行開發或推送 commit！**

### 開發流程

1. **創建任務分支**：

   ```bash
   # 從 main 分支建立新的任務分支
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix-name
   ```

2. **進行開發**：
   - 在新分支上進行你的開發工作
   - 定期進行小的 commit

3. **提交前檢查**：<br>
   在推送程式碼前，**必須**測試一下有沒有東西壞掉，確認是正常的再推

4. **推送分支並建立 PR**：

   ```bash
   git add .
   git commit -m "feat: your commit message"
   git push origin feature/your-feature-name
   ```

5. **建立 Pull Request**：
   - 前往 GitHub 建立 Pull Request
   - **重要**：請在 PR 中標記 (mention) 所有團隊成員進行程式碼審核
   - 在 PR description 中清楚描述你的變更內容

6. **等待審核**：
   - 等待至少一位團隊成員審核並 approve
   - 根據 review 意見進行必要的修改
   - 要看別人的 branch 可以 `git checkout -b "分支名稱"  origin/"分支名稱"`

7. **合併到 main**：
   - 審核通過後，才能將 PR 合併到 `main` 分支

### PR 範本

為確保 Pull Request 的品質和一致性，請使用以下範本建立 PR：

```markdown
## 變更類型

- [ ] ✨ 新功能 (feature)
- [ ] 🐛 錯誤修復 (bug fix)
- [ ] 📚 文件更新 (documentation)
- [ ] 🎨 程式碼重構 (refactor)
- [ ] ⚡ 效能優化 (performance)
- [ ] 🧪 測試相關 (test)
- [ ] 🔧 工具/配置變更 (tooling)

## 變更詳情

<!-- 詳細描述你做了什麼改變，為什麼要做這些改變 -->

## 測試清單

- [ ] 已在本地測試相關功能
- [ ] 已更新相關文件（如需要）
- [ ] 已添加或更新測試（如需要）

## 截圖/錄影

<!-- 如果有 UI 變更，請提供截圖或錄影 -->

## 備註

<!-- 任何其他需要審核者注意的事項 -->
```
