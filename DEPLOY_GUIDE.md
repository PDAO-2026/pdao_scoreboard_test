# PDAO Scoreboard 架設與維護說明

## 架構概覽

- **前端**：靜態檔案（dist/），透過 pm2 serve 在 port 3001
- **後端**：Flask app（backend/run.py），透過 gunicorn 在 port 3002
- **nginx**：`^~` /scoreboard/ proxy 到 3001，/pdao_be proxy 到 3002
- **PDAO 官網**：Next.js，已佔用 port 3000（/pdao → localhost:3000）
- **網址**：https://ntu.im/scoreboard/
- **Admin**：https://ntu.im/pdao_be/admin（帳號 PDAO，密碼 pdao2026）

## 重要檔案

| 檔案 | 說明 |
|------|------|
| `src/config.js` | 前端設定（apiBase URL、更新間隔等） |
| `backend/backend_file/scoreboard.json` | 後端設定（sid、auth token）— 不在 git 裡 |
| `backend/backend_file/contest_data.json` | 隊伍與題目資料 — 不在 git 裡 |
| `backend/backend_file/account.json` | Admin 帳密 — 不在 git 裡 |
| `BuildTool/TeamsData.csv` | 隊伍名單 |
| `BuildTool/ProblemsData.csv` | 題目列表 |

## 分段計分設定（CP/Opt 時間窗口）

比賽分兩階段：CP 階段結束後，CP 遲交的提交不算分；Opt 階段開始後才會顯示 pdogs 的 opt 分數。

在 `backend/backend_file/scoreboard.json` 加入 `contest_windows` 區塊：

```json
{
    "sid": "43",
    "token": "...",
    "frozen": true,
    "contest_windows": {
        "cp_end_minute": 120,
        "opt_problem_ids": [2083, 2084]
    }
}
```

- `cp_end_minute`：CP 窗口截止（分鐘）。提交時間 ≤ 這個值的 CP 題才算分。
- `opt_problem_ids`：哪些 problem id 算 Opt 題（其餘都視為 CP）。

**運作機制**：
1. `/pdao_be/api/runs` 過濾掉 `submissionTime > cp_end_minute` 的 CP 題提交。
2. 只要偵測到任何一筆提交時間 > `cp_end_minute`，就在 `backend/backend_file/.cp_phase_ended` 建立 marker 檔（多 worker 共用）。
3. 有 marker 之前，`/pdao_be/api/opt_scores` 回空 dict（前端顯示 0 分）；之後才透傳 pdogs 的真實分數。

**重置（重開比賽或測試）**：
```bash
rm backend/backend_file/.cp_phase_ended
pm2 restart scoreboard-backend
```

## Auth Token（每 5 天更新一次）

- pdogs 的 auth-token 有效期 **5 天**
- 存在 `backend/backend_file/scoreboard.json`
- 過期後計分板會抓不到資料

### 更新 Token 步驟

1. 到 https://pdogs.ntu.im 登入，從瀏覽器 DevTools > Application > Local Storage 拿新的 auth-token
2. 到 server 更新：
   ```bash
   ssh peggy@ntu.im
   cd ~/pdao_scoreboard
   source venv/bin/activate
   cd BuildTool && python3 BuildTool.py
   # 選 3 (Create/Edit PDOGS api Credit File) → sid: 44 → 貼新 token
   cd ..
   pm2 restart scoreboard-backend
   ```

## 日常操作

```bash
ssh peggy@ntu.im

# 查看狀態
pm2 status
pm2 logs scoreboard-backend --lines 20

# 重啟服務
pm2 restart scoreboard-backend
pm2 restart scoreboard-frontend
```

## 更新程式碼

### 1. 本地修改 & 推上去
```bash
cd ~/pdao_scoreboard_test

# 修改程式碼...
# 如果改了前端(src/)，要重新 build
npm run build
grunt # 也可以
git add <修改的檔案>
git commit -m "描述"
git push origin test-for-submission-2
```

### 2. Server 上更新
```bash
ssh peggy@ntu.im
cd ~/pdao_scoreboard

# 拉最新（用 pull 不會清掉 backend_file/）
git pull origin test-for-submission-2

# 改 config.js 指向 ntu.im 再 build
sed -i 's|http://localhost:3002|https://ntu.im|g' src/config.js
sed -i 's|http://localhost:8080|https://ntu.im|g' src/config.js
npm run build

# 重啟
pm2 restart scoreboard-backend
pm2 restart scoreboard-frontend
pm2 save
```

**注意**：不要用 `git reset --hard`，會清掉 `backend_file/`（不在 git 裡），清掉的話要重跑 BuildTool。

## config.js 注意事項

apiBase 在本地和 server 不同：

- **本地**：`http://localhost:3002/pdao_be/api/runs`
- **Server**：`https://ntu.im/pdao_be/api/runs`

git 裡存的是 localhost 版本。每次在 server 上 pull 完都要用 sed 改成 ntu.im 再 build。

## 從零部署（全新 server）

```bash
# 1. Clone
cd ~
git clone -b test-for-submission-2 https://github.com/PDAO-2026/pdao_scoreboard_test.git pdao_scoreboard
cd pdao_scoreboard

# 2. 前端
npm install
npm run build

# 3. Python venv
python3 -m venv venv
source venv/bin/activate
pip install flask flask-cors flasgger requests gunicorn

# 4. BuildTool
cd BuildTool && python3 BuildTool.py
# 選 1 → title: PDAO 2026 test → sid: 44 → token → 密碼: pdao2026 → lazy judge: n
cd ..

# 5. 改 config.js 指向 server
sed -i 's|http://localhost:3002|https://ntu.im|g' src/config.js
npm run build

# 6. 啟動後端（用 gunicorn）
pm2 start "cd /home/peggy/pdao_scoreboard/backend && /home/peggy/pdao_scoreboard/venv/bin/gunicorn -w 2 -b 0.0.0.0:3002 run:app" --name scoreboard-backend

# 7. 啟動前端（不要加 --spa）
pm2 serve dist 3001 --name scoreboard-frontend

# 8. 儲存
pm2 save
```

## 本地開發

```bash
# 後端（terminal 1）
cd ~/pdao_scoreboard_test/backend && python3 run.py

# 前端（terminal 2）
cd ~/pdao_scoreboard_test && npm run build && npx serve dist -p 3001
```

後端：http://localhost:3002 | 前端：http://localhost:3001

## Nginx 設定

### Cache 設定

在 `/etc/nginx/nginx.conf` 的 `http {}` 裡面加：

```nginx
proxy_cache_path /var/cache/nginx/scoreboard levels=1:2 keys_zone=scoreboard_cache:10m inactive=10m max_size=100m;
```

需要手動建立 cache 目錄：

```bash
sudo mkdir -p /var/cache/nginx/scoreboard
```

### Proxy 設定

已加在 `/etc/nginx/sites-enabled/default` 的 SSL server block 裡，放在 `location /pdao` 的上面：

```nginx
location /pdao_be {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # Cache API responses
    proxy_cache scoreboard_cache;
    proxy_cache_valid 200 5s;       # 200 回應快取 5 秒
    proxy_cache_valid 404 1m;
    proxy_cache_use_stale error timeout updating;
    proxy_cache_lock on;            # 同時多人請求只打一次後端
    add_header X-Cache $upstream_cache_status;  # 方便 debug
}

location = /scoreboard {
    return 301 /scoreboard/;
}

location ^~ /scoreboard/ {
    proxy_pass http://localhost:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

驗證 cache 是否生效：

```bash
curl -I https://ntu.im/pdao_be/api/runs
```

## 踩過的坑

1. **nginx 安全規則擋 config.js**：nginx 有 regex rule 擋所有路徑含 `config` 的請求。解法是 scoreboard location 用 `^~`，優先級高於 regex。
2. **CSP 擋 Handlebars eval()**：nginx 的 CSP 不允許 unsafe-eval。解法是把 Handlebars.compile 改成手動拼字串（已修完，不需要改 CSP）。
3. **port 3000 被 pdao website 佔用**：後端改用 3002。
4. **pm2 serve --spa 把 CSS/JS 回傳成 text/html**：不要用 --spa flag。
5. **git reset --hard 清掉 backend_file/**：因為在 .gitignore，reset 後要重跑 BuildTool。用 git pull 就沒這問題。
6. **防火牆擋外部 port**：不能直接用 ntu.im:3001，必須透過 nginx proxy。

## 計分規則

- **排名公式**：0.6 × opt_score + 0.4 × cp_score，同分看 CP 罰時
- **CP 罰時**：第 4 次繳交開始每次 +10 min
- **最佳化計分**：score = x × ((S_i - B) / (S_best - B))^1.5，B = 10000000
- **CP 每題配分**：目前預設 100/12，之後需更新
