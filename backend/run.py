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
CP_PHASE_ENDED_MARK = "backend_file/.cp_phase_ended"
CONTEST_WINDOWS_PATH = "backend_file/contest_windows.json"

# config data
contest_data, problem_meta, team_info = None, None, None
sid, token = None, None

# ==== Time-windowed scoring state ====
# CP submissions with submissionTime > CP_END_MINUTE are dropped, so that any
# CP runs made during the Opt phase don't keep accumulating CP score.
# The cp_phase_ended flag is persisted to a marker file so all gunicorn
# workers agree on the state; once flipped on, we never flip it back.
DEFAULT_CP_END_MINUTE = 120
DEFAULT_OPT_PROBLEM_IDS = [2083, 2084]

def is_cp_phase_ended():
    return os.path.exists(CP_PHASE_ENDED_MARK)

def mark_cp_phase_ended():
    # Only write the marker once; subsequent calls are no-ops.
    if not os.path.exists(CP_PHASE_ENDED_MARK):
        try:
            with open(CP_PHASE_ENDED_MARK, "w") as f:
                f.write("1")
        except OSError:
            # Fall back silently; the in-process call sites can retry later.
            pass

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

def load_contest_windows():
    """Read the CP/Opt window config from its dedicated file.

    Kept in its own JSON file so it survives scoreboard.json rewrites from
    BuildTool.py and the frozen toggle. Returns (cp_end_minute, opt_ids_set),
    falling back to sensible defaults when the file is missing or malformed.
    """
    try:
        with open(CONTEST_WINDOWS_PATH, "r", encoding="utf-8") as f:
            windows = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return DEFAULT_CP_END_MINUTE, set(DEFAULT_OPT_PROBLEM_IDS)

    try:
        cp_end = int(windows.get("cp_end_minute", DEFAULT_CP_END_MINUTE))
    except (TypeError, ValueError):
        cp_end = DEFAULT_CP_END_MINUTE
    opt_ids_raw = windows.get("opt_problem_ids", DEFAULT_OPT_PROBLEM_IDS) or DEFAULT_OPT_PROBLEM_IDS
    try:
        opt_ids = {int(x) for x in opt_ids_raw}
    except (TypeError, ValueError):
        opt_ids = set(DEFAULT_OPT_PROBLEM_IDS)
    return cp_end, opt_ids

def load_freeze_run_id():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        freeze_run_id = config.get("freeze_run_id")
        if freeze_run_id is None:
            return None
        return int(freeze_run_id)
    except FileNotFoundError:
        raise FileNotFoundError(f"Configuration file '{CONFIG_PATH}' not found.")
    except json.JSONDecodeError:
        raise ValueError(f"Configuration file '{CONFIG_PATH}' is not valid JSON.")
    except (TypeError, ValueError):
        return None

def save_frozen(frozen, freeze_run_id=None):
    global sid, token
    config = {
        "sid": sid,
        "token": token,
        "frozen": bool(frozen)
    }
    if frozen and freeze_run_id is not None:
      config["freeze_run_id"] = int(freeze_run_id)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
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

        # Time-window filtering: any CP submission after the CP window closes
        # is dropped so it never contributes to the CP score. Detecting a single
        # submission past the CP window also flips cp_phase_ended, which gates
        # the /opt_scores endpoint.
        cp_end_minute, opt_problem_ids = load_contest_windows()
        runs_list = data["data"].get("runs", []) or []
        filtered_runs = []
        for run in runs_list:
            try:
                submission_minute = int(run.get("submissionTime", 0))
            except (TypeError, ValueError):
                submission_minute = 0
            try:
                problem_id = int(run.get("problem"))
            except (TypeError, ValueError):
                problem_id = None

            is_opt = problem_id in opt_problem_ids
            if submission_minute > cp_end_minute:
                mark_cp_phase_ended()
                if not is_opt:
                    # CP submission after the CP window: drop entirely.
                    continue
            filtered_runs.append(run)
        data["data"]["runs"] = filtered_runs

        # Manual freeze: once enabled, mask all runs after the frozen run id.
        if load_frozen() and not admin:
            freeze_run_id = load_freeze_run_id()
            if freeze_run_id is None:
                return {"success": False, "error": "Missing freeze_run_id while frozen is enabled"}

            for run in data["data"]["runs"]:
                if int(run.get("id", -1)) > freeze_run_id:
                    run["result"] = "Pending"
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
    payload = request.get_json(silent=True) or {}
    Frozen_flag = bool(payload.get("frozen", True))

    freeze_run_id = None
    if Frozen_flag:
        existing_frozen = load_frozen()
        existing_run_id = load_freeze_run_id()

        # Reuse existing freeze point when available.
        if existing_frozen and existing_run_id is not None:
            freeze_run_id = existing_run_id
        else:
          # Lock to the latest run id from contest API.
            current_runs = load_runs(admin=True)
            if not current_runs.get("success", False):
                return jsonify({
                    "success": "False",
                    "status": "False",
            "error": "Unable to determine freeze run id"
                }), 500

            runs = current_runs["data"]["data"].get("runs", [])
        freeze_run_id = int(runs[-1].get("id", -1)) if runs else -1

    save_frozen(Frozen_flag, freeze_run_id)
    return jsonify({"success": "True", "status": "True" if Frozen_flag else "False", "error": "Null"})

@app.route("/pdao_be/api/opt_scores", methods=["GET"], endpoint="api-opt_scores")
def get_opt_scores():
    """
    取得 opt 題目的分數資訊
    ---
    tags:
      - Scores
    parameters:
      - in: query
        name: view_id
        type: integer
        description: PDOGS 的 view ID（預設為 60）
      - in: query
        name: auth_token
        type: string
        description: 認證 token（預設從配置讀取）
    responses:
      200:
        description: 成功取得 opt 分數資訊
        schema:
          type: object
          properties:
            success:
              type: boolean
            data:
              type: array
              items:
                type: object
                properties:
                  team_id:
                    type: integer
                  team_name:
                    type: string
                  total_score:
                    type: number
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
    try:
        global token
        # 從參數或配置中獲取 view_id 和 auth_token
        view_id = request.args.get("view_id", "60")
        auth_token = request.args.get("auth_token", token)

        if not auth_token:
            return jsonify({"success": False, "error": "Auth token not configured"}), 400

        # Gate: while we're still in the CP phase, do not expose any Opt
        # scores (even if PDOGS has earlier submissions on record). Return
        # an empty score dict so every team displays zero on the frontend.
        if not is_cp_phase_ended():
            return jsonify({"success": True, "view_id": str(view_id), "data": {}})

        # 呼叫外部 PDOGS API
        url = f"https://be.pdogs.ntu.im/team-project-scoreboard/view/{view_id}"
        headers = {
            "Auth-Token": auth_token,
            "Content-Type": "application/json"
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        
        if data.get("success", False):
            # 構建分數字典，以 team_id 為 key，total_score 為 value
            scores = {}
            for team_data in data.get("data", []):
                team_id = str(team_data.get("team_id"))
                total_score = team_data.get("total_score", 0)
                scores[team_id] = total_score
            
            return jsonify({"success": True, "view_id": str(view_id), "data": scores})
        else:
            return jsonify({"success": False, "error": data.get("error", "Unknown error")}), 500
            
    except requests.exceptions.RequestException as e:
        return jsonify({"success": False, "error": f"API request failed: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": f"Error: {str(e)}"}), 500

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
    import os
    is_dev = os.environ.get("FLASK_ENV") == "development"
    app.run(host="0.0.0.0", port=3002, debug=is_dev)