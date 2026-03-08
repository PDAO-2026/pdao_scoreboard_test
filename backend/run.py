from flask import Flask, render_template, request, redirect, jsonify, session, url_for
from functools import wraps
from flask_cors import CORS
from flasgger import Swagger, swag_from
import requests, json, os, re, hashlib
from datetime import timedelta

app = Flask(__name__, static_url_path='/pdao_be/static')
CORS(app, resources={r"/pdao_be/api/*": {"origins": "*"}})

# Swagger configuration
try:
    swagger_config = {
        "headers": [],
        "specs": [
            {
                "endpoint": 'apispec',
                "route": '/pdao_be/api/apispec.json',
                "rule_filter": lambda rule: True,
                "model_filter": lambda tag: True,
            }
        ],
        "static_url_path": "/flasgger_static",
        "swagger_ui": True,
        "specs_route": "/pdao_be/api/docs/"
    }
    swagger = Swagger(app, config=swagger_config)
    print("Swagger initialized successfully")
except ImportError:
    print("Flasgger not installed. Install with: py -3 -m pip install flasgger")
    swagger = None

# for using local runs file
local_flag = False
LOCAL_RUNS_PATH = "backend_file/PDAO2025_result.json"

STATUS_PATH = "backend_file/status.json"
ACCOUNT_PATH = "backend_file/account.json"
CONFIG_PATH = "backend_file/scoreboard.json"
DATA_PATH = "backend_file/contest_data.json"
SESSION_KEY_PATH = "backend_file/session_key.txt"

# config data
contest_data, problem_meta, team_info = None, None, None
sid, token = None, None

# 讀取配置檔案
def load_config():
    global sid, token, contest_data
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"Configuration file '{CONFIG_PATH}' not found.")
    except json.JSONDecodeError:
        raise ValueError(f"Configuration file '{CONFIG_PATH}' is not valid JSON.")
    if not config.get("sid") or not config.get("token"):
        raise ValueError("Invalid configuration: 'sid' and 'token' are required.")
    try:
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            contest_data = json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"Contest data file '{DATA_PATH}' not found.")
    except json.JSONDecodeError:
        raise ValueError(f"Contest data file '{DATA_PATH}' is not valid JSON.")
    sid = config.get("sid")
    token = config.get("token")

# 載入封板狀態
def load_frozen():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config.get("frozen", True)
    except FileNotFoundError:
        raise FileNotFoundError(f"Configuration file '{CONFIG_PATH}' not found.")
    except json.JSONDecodeError:
        raise ValueError(f"Configuration file '{CONFIG_PATH}' is not valid JSON.")

def save_frozen(frozen):
    global sid, token
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        config = {"sid": sid, "token": token, "frozen": frozen}
        json.dump(config, f, indent=2)

# 載入帳號資料
def load_accounts():
    if not os.path.exists(ACCOUNT_PATH):
        raise FileNotFoundError(f"Account file '{ACCOUNT_PATH}' not found.")
    with open(ACCOUNT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_accounts(accounts):
    with open(ACCOUNT_PATH, "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2)

# 載入題目與隊伍資訊
def load_contest_metadata():
    global contest_data, problem_meta, team_info
    data = contest_data
    problem_meta = {
        p["id"]: {"name": p["name"], "color": p["color"], "title": p["title"]}
        for p in data.get("problems", [])
    }
    team_info = {
        t["id"]: {
            "name": re.sub(r"\s*\(.*?\)", "", t["name"]),
            "position": t.get("position","??"),
            "section": t.get("section","??"),
        }
        for t in data.get("teams", [])
    }

def load_status():
    if not os.path.exists(STATUS_PATH):
        return {}
    with open(STATUS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_status(status):
    with open(STATUS_PATH, "w", encoding="utf-8") as f:
        json.dump(status, f)

def load_runs(admin=False):
    global sid, token
    try:
        if local_flag:
            with open(LOCAL_RUNS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            url = f"https://be.pdogs.ntu.im/hardcode/team-contest-scoreboard/{sid}/runs"
            headers = {
                "auth-token": token,
                "Content-Type": "application/json"
            }
            res = requests.get(url, headers=headers, timeout=3)
            res.raise_for_status()
            data = res.json()
        if data["success"] == False:
            return {"success": False, "error": data["error"]}
        contestTime = data["data"]["time"]["contestTime"]
        timestamp = data["data"]["time"]["timestamp"]
        #if end and flag is frozen bypass admin
        if load_frozen() and contestTime <= timestamp and not admin:
            left,right = -1, len(data["data"]["runs"])
            while left + 1 < right:
                mid = (left + right) // 2
                if data["data"]["runs"][mid]["submissionTime"] * 60 + 3600 > contestTime:
                    right = mid
                else:
                    left = mid
            for i in range(left+1, len(data["data"]["runs"])):
                data["data"]["runs"][i]["result"] = "Pending"
        return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}

def extract_first_yes_runs(runs):
    seen = set()
    result = []
    for run in runs:
        key = (run["team"], run["problem"])
        if ("Yes" in run["result"]) and key not in seen:
            result.append(run)
            seen.add(key)
    return result

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in', False) or session.get('username', None) not in load_accounts():
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def login_required_error(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in', False) or session.get('username', None) not in load_accounts():
            return (jsonify({"success": False, "error": "NoPermission"}))
        return f(*args, **kwargs)
    return decorated_function

# flask app routes

@app.route("/pdao_be/admin", endpoint="index")
@login_required
def admin():
    contest_data = {"problems": problem_meta, "teams": team_info}
    return render_template("admin/index.html", contest_data=contest_data, current_user=session.get("username"))

@app.route("/pdao_be/admin/statistics", endpoint="stat")
@login_required
def statistics():
    sec = request.args.get("sec")
    if sec is None:
        sec = "pro"
    return render_template("admin/stat.html", contest_data=contest_data, current_user=session.get("username"), req_sec = sec)

@app.route("/pdao_be/admin/login", methods=["GET", "POST"], endpoint="login")
def login():
    error = False
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        accounts = load_accounts()

        if username in accounts and accounts[username] == hashlib.sha256(password.encode('utf-8')).hexdigest():
            session['logged_in'] = True
            session['username'] = username
            return redirect(url_for("index"))  # 預設回首頁
        error = True
    return render_template("admin/login.html", error=error)

@app.route("/pdao_be/admin/logout", endpoint="logout")
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route("/pdao_be/admin/login_status", endpoint="login_status")
def login_status():
    status = session.get('logged_in', False) and session.get('username', None) in load_accounts()
    return jsonify({"logged_in": status, "username": session.get("username", None)})

@app.route("/pdao_be/api/contest_data", methods=["GET"], endpoint="api-contest_data")
def contest_data_api():
    """
    取得比賽資料
    ---
    tags:
      - Contest
    responses:
      200:
        description: 成功取得比賽資料
        schema:
          type: object
          properties:
            problems:
              type: array
              items:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string
                  color:
                    type: string
            teams:
              type: array
              items:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string
                  position:
                    type: string
                  section:
                    type: string
    """
    global contest_data
    return jsonify(contest_data)

@app.route("/pdao_be/api/account_modify", methods=["POST"], endpoint="api-account_modify")
@login_required
def add_account():
    """
    新增或修改帳號
    ---
    tags:
      - Account
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required:
            - username
            - password
          properties:
            username:
              type: string
              description: 帳號名稱
            password:
              type: string
              description: 密碼
    responses:
      200:
        description: 成功新增或修改帳號
        schema:
          type: object
          properties:
            success:
              type: boolean
            method:
              type: string
              enum: [add, edit]
      400:
        description: 缺少必要參數
        schema:
          type: object
          properties:
            success:
              type: boolean
            error:
              type: string
    """
    data = request.json
    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        return jsonify({"success": False, "error": "Missing username or password"}), 400

    accounts = load_accounts()
    exist = (username in accounts)
    accounts[username] = hashlib.sha256(password.encode('utf-8')).hexdigest()
    save_accounts(accounts)
    return jsonify({"success": True, "method": "edit" if exist else "add"})

@app.route("/pdao_be/api/account_delete", methods=["POST"], endpoint="api-account_delete")
@login_required
def delete_account():
    """
    刪除目前登入的帳號
    ---
    tags:
      - Account
    responses:
      200:
        description: 刪除成功，並登出
        schema:
          type: object
          properties:
            success:
              type: boolean
      403:
        description: 未登入或剩最後一個帳號
        schema:
          type: object
          properties:
            success:
              type: boolean
            error:
              type: string
      404:
        description: 帳號不存在
        schema:
          type: object
          properties:
            success:
              type: boolean
            error:
              type: string
    """
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "Not logged in"}), 403

    accounts = load_accounts()
    if username in accounts:
        if len(accounts) <= 1:
            return jsonify({"success": False, "error": "Last account"}), 403
        del accounts[username]
        save_accounts(accounts)
        session.pop('logged_in', None)
        session.pop('username', None)
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Account not found"}), 404

@app.route("/pdao_be/api/runs", methods=["GET"], endpoint="api-runs")
def get_runs():
    """
    取得（可能封板處理過的）賽況資料
    ---
    tags:
      - Runs
    responses:
      200:
        description: 成功取得賽況資料
        schema:
          type: object
      500:
        description: 取得失敗
        schema:
          type: object
          properties:
            success:
              type: boolean
            error:
              type: string
    """
    res = load_runs()
    if res.get("success", False):
        return jsonify(res.get("data"))
    else:
        return jsonify(res), 500
    
@app.route("/pdao_be/api/runs/admin", methods=["GET"], endpoint="api-runs_admin")
@login_required_error
def get_runs_admin():
    """
    取得完整賽況資料（管理員）
    ---
    tags:
      - Runs
    responses:
      200:
        description: 成功取得賽況資料
        schema:
          type: object
      500:
        description: 取得失敗
        schema:
          type: object
          properties:
            success:
              type: boolean
            error:
              type: string
    """
    res = load_runs(True)
    if res.get("success", False):
        return jsonify(res.get("data"))
    else:
        return jsonify(res), 500

@app.route("/pdao_be/api/runs/balloon", methods=["GET"], endpoint="api-runs_balloon")
@login_required_error
def api_runs():
    """
    取得首次 AC（氣球）列表（管理員）
    ---
    tags:
      - Runs
    responses:
      200:
        description: 回傳首次 AC 清單與時間資訊
        schema:
          type: object
          properties:
            success:
              type: boolean
            data:
              type: array
              items:
                type: object
            time:
              type: object
      500:
        description: 取得失敗
        schema:
          type: object
          properties:
            success:
              type: boolean
            error:
              type: string
    """
    first = {}
    res = load_runs()
    if res.get("success", False):
        data = res.get("data")
    else:
        return jsonify(res), 500
    runs = data["data"]["runs"]
    yes_runs = extract_first_yes_runs(runs)
    status = load_status()
    # for run in yes_runs or run["id"] == first[run["problem"]]:
    for run in yes_runs:
        if run["problem"] not in first:
            first[run["problem"]] = run.get("id")
            run["fst"] = True
        else:
            run["fst"] = False
        run["made"] = status.get(str(run["id"]), {}).get("made", False)
        run["sent"] = status.get(str(run["id"]), {}).get("sent", False)
    
    return jsonify({"success": True, "error": "Null", "data": yes_runs, "time": data["data"]["time"]})

@app.route("/pdao_be/api/update_status", methods=["POST"], endpoint="api-update_status")
@login_required
def update_status():
    """
    更新某筆氣球狀態
    ---
    tags:
      - Runs
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          required: [id, field, value]
          properties:
            id:
              type: string
              description: run ID
            field:
              type: string
              enum: [made, sent]
            value:
              type: boolean
    responses:
      200:
        description: 狀態更新成功
        schema:
          type: object
          properties:
            success:
              type: boolean
    """
    status = load_status()
    run_id = str(request.json.get("id"))
    field = request.json.get("field")  # 'made' or 'sent'
    value = bool(request.json.get("value"))
    if run_id not in status:
        status[run_id] = {"made": False, "sent": False}
    if field == "made":
        status[run_id]["sent"] = False
    status[run_id][field] = value
    save_status(status)
    return jsonify({"success": True})

@app.route("/pdao_be/api/frozen", methods=["GET"], endpoint="api-frozen_get")
@login_required
def frozen_status():
    """
    取得封板狀態
    ---
    tags:
      - Contest
    responses:
      200:
        description: 成功取得封板狀態
        schema:
          type: object
          properties:
            status:
              type: string
              enum: [True, False]
    """
    Frozen_flag = load_frozen()
    return jsonify({"status": "True" if Frozen_flag else "False"})

@app.route("/pdao_be/api/frozen", methods=["POST"], endpoint="api-frozen_post")
@login_required
def frozen():
    """
    設定封板狀態
    ---
    tags:
      - Contest
    parameters:
      - in: body
        name: body
        required: true
        schema:
          type: object
          properties:
            frozen:
              type: boolean
              description: 是否封板
    responses:
      200:
        description: 成功設定封板狀態
        schema:
          type: object
          properties:
            success:
              type: string
            status:
              type: string
              enum: [True, False]
            error:
              type: string
    """
    Frozen_flag = request.json.get("frozen", True)
    save_frozen(Frozen_flag)
    return jsonify({"success": "True", "status": "True" if Frozen_flag else "False", "error": "Null"})

def Initialize():
    secret_key = None
    try:
        load_config()
        load_accounts()
        load_runs()
        load_contest_metadata()
        load_status()
        with open(SESSION_KEY_PATH, "r") as f:
            secret_key = f.read().strip()
    except Exception as e:
        print(f"Error loading configuration: {e}")
        exit(1)
    app.secret_key = hashlib.sha256(secret_key.encode('utf-8')).hexdigest()
    app.permanent_session_lifetime = timedelta(hours=1)

Initialize()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)